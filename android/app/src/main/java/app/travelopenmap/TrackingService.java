package app.travelopenmap;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Служба переднего плана, которая пишет положение, пока приложение свёрнуто или экран погашен.
 * Использует системный LocationManager (GPS), поэтому не зависит от сервисов Google Play.
 *
 * Пока экран приложения открыт, точки уходят сразу в веб-часть (слушатель sink). Когда приложение свёрнуто,
 * точки складываются в файл-очередь во внутреннем хранилище; при возвращении веб-часть забирает их одной
 * операцией drain() и по порядку проигрывает в движок тумана.
 */
public class TrackingService extends Service implements LocationListener {
    public static final String ACTION_START = "app.travelopenmap.track.START";
    public static final String ACTION_STOP = "app.travelopenmap.track.STOP";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_STOP = "stopLabel";

    private static final String CHANNEL_ID = "tracking";
    private static final int NOTIFICATION_ID = 4711;
    private static final String PREFS = "tom.tracking";
    private static final String QUEUE_FILE = "track-queue.jsonl";
    private static final long QUEUE_LIMIT_BYTES = 8L * 1024 * 1024;

    /** Приёмник точек веб-части. Не null, только пока приложение на экране. */
    public interface Sink {
        void onFix(JSONObject fix);
    }

    private static final Object LOCK = new Object();
    private static Sink sink;
    private static boolean sinkActive;
    private static volatile boolean running;

    private LocationManager manager;

    public static boolean isRunning() {
        return running;
    }

    static void setSink(@Nullable Sink s) {
        synchronized (LOCK) {
            sink = s;
        }
    }

    /** С этого момента точки идут напрямую в веб-часть (вызывается вместе с забором очереди). */
    static void setSinkActive(boolean active) {
        synchronized (LOCK) {
            sinkActive = active;
        }
    }

    /** Забирает всё накопленное и включает прямую доставку — одной атомарной операцией, чтобы порядок не нарушился. */
    static List<String> drainQueue(Context ctx) {
        synchronized (LOCK) {
            List<String> lines = new ArrayList<>();
            File f = new File(ctx.getFilesDir(), QUEUE_FILE);
            if (f.exists()) {
                try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = r.readLine()) != null) {
                        if (!line.isEmpty()) lines.add(line);
                    }
                } catch (IOException ignored) {
                    // недочитанное потеряем, но не роняем приложение
                }
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
            sinkActive = true;
            return lines;
        }
    }

    static boolean wasRequested(Context ctx) {
        return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("on", false);
    }

    private static void remember(Context ctx, boolean on, @Nullable String title, @Nullable String text, @Nullable String stopLabel) {
        SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("on", on);
        if (title != null) e.putString(EXTRA_TITLE, title);
        if (text != null) e.putString(EXTRA_TEXT, text);
        if (stopLabel != null) e.putString(EXTRA_STOP, stopLabel);
        e.apply();
    }

    static void start(Context ctx, String title, String text, String stopLabel) {
        remember(ctx, true, title, text, stopLabel);
        Intent i = new Intent(ctx, TrackingService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(ctx, i);
    }

    static void stop(Context ctx) {
        remember(ctx, false, null, null, null);
        ctx.stopService(new Intent(ctx, TrackingService.class));
    }

    // ------------------------------------------------------------------ жизненный цикл

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            remember(this, false, null, null, null);
            stopSelf();
            return START_NOT_STICKY;
        }
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        // intent == null: систему перезапустила службу после нехватки памяти; продолжаем, только если запись всё ещё включена
        if (intent == null && !p.getBoolean("on", false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String title = p.getString(EXTRA_TITLE, "TravelOpenMap");
        String text = p.getString(EXTRA_TEXT, "");
        String stopLabel = p.getString(EXTRA_STOP, "Stop");
        Notification n = buildNotification(title, text, stopLabel);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (RuntimeException e) {
            // например, система запретила запуск из фона: записывать нельзя
            remember(this, false, null, null, null);
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        subscribe();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (manager != null) {
            try {
                manager.removeUpdates(this);
            } catch (SecurityException ignored) {
                // разрешение отозвано — обновления уже остановлены
            }
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void subscribe() {
        if (manager != null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            remember(this, false, null, null, null);
            stopSelf();
            return;
        }
        manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        try {
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 0f, this, Looper.getMainLooper());
            } else if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000L, 0f, this, Looper.getMainLooper());
            }
        } catch (SecurityException | IllegalArgumentException e) {
            remember(this, false, null, null, null);
            stopSelf();
        }
    }

    private Notification buildNotification(String title, String text, String stopLabel) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, title, NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, piFlags);
        Intent stop = new Intent(this, TrackingService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, piFlags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_track)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(openPi)
                .addAction(0, stopLabel, stopPi)
                .build();
    }

    // ------------------------------------------------------------------ точки

    @Override
    public void onLocationChanged(Location l) {
        JSONObject o = new JSONObject();
        try {
            o.put("lng", l.getLongitude());
            o.put("lat", l.getLatitude());
            if (l.hasAccuracy()) o.put("accuracy", l.getAccuracy());
            if (l.hasBearing()) o.put("heading", l.getBearing());
            if (l.hasSpeed()) o.put("speed", l.getSpeed());
            o.put("t", l.getTime() > 0 ? l.getTime() : System.currentTimeMillis());
        } catch (JSONException e) {
            return;
        }
        deliver(getApplicationContext(), o);
    }

    private static void deliver(Context ctx, JSONObject fix) {
        synchronized (LOCK) {
            if (sinkActive && sink != null) {
                sink.onFix(fix);
                return;
            }
            File f = new File(ctx.getFilesDir(), QUEUE_FILE);
            if (f.length() > QUEUE_LIMIT_BYTES) return; // очередь переполнена — новые точки не пишем
            try (FileOutputStream out = new FileOutputStream(f, true)) {
                out.write((fix.toString() + "\n").getBytes(StandardCharsets.UTF_8));
            } catch (IOException ignored) {
                // нет места — пропускаем точку
            }
        }
    }

    // Пустые обработчики нужны для API ниже 30
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}
}

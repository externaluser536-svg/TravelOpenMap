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
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.RemoteViews;

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
import java.util.Locale;

/**
 * Служба переднего плана, которая пишет положение, пока приложение свёрнуто, закрыто или экран погашен.
 * Использует системный LocationManager (GPS), поэтому не зависит от сервисов Google Play.
 *
 * Пока экран приложения открыт, точки уходят сразу в веб-часть (слушатель sink). Когда приложение свёрнуто или закрыто,
 * точки складываются в файл-очередь во внутреннем хранилище; при возвращении веб-часть забирает их одной
 * операцией drain() и по порядку проигрывает в движок тумана.
 *
 * Уведомление живое: время записи, пройденный путь и точность GPS обновляются прямо в шторке.
 */
public class TrackingService extends Service implements LocationListener {
    public static final String ACTION_START = "app.travelopenmap.track.START";
    public static final String ACTION_STOP = "app.travelopenmap.track.STOP";

    private static final String CHANNEL_ID = "tracking";
    private static final int NOTIFICATION_ID = 4711;
    private static final String PREFS = "tom.tracking";
    private static final String KEY_ON = "on";
    private static final String KEY_LABELS = "labels";
    private static final String KEY_SINCE = "since";
    private static final String KEY_DIST = "dist";
    private static final String QUEUE_FILE = "track-queue.jsonl";
    private static final long QUEUE_LIMIT_BYTES = 8L * 1024 * 1024;
    private static final long REFRESH_MS = 5000L;
    /** Дольше этого без точки считаем, что сигнал потерян. */
    private static final long STALE_MS = 45_000L;
    /** В пройденный путь идут только точные точки и разумные шаги (без скачков). */
    private static final float DIST_MAX_ACCURACY = 50f;
    private static final float DIST_MAX_STEP = 300f;
    private static final float DIST_MIN_STEP = 3f;
    /** Сетевые точки учитываются, только если GPS молчит дольше этого. */
    private static final long GPS_QUIET_MS = 60_000L;

    /** Приёмник точек веб-части. Не null, только пока приложение на экране. */
    public interface Sink {
        void onFix(JSONObject fix);
    }

    private static final Object LOCK = new Object();
    private static Sink sink;
    private static boolean sinkActive;
    private static volatile boolean running;

    private LocationManager manager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private JSONObject labels = new JSONObject();
    private long sinceElapsed;
    private float distance;
    private boolean stateLoaded;
    private long lastFixAt;
    private long lastGpsAt;
    private float lastAcc = -1f;
    private Location lastLoc;
    private final Runnable refresh = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putFloat(KEY_DIST, distance).apply();
            updateNotification();
            handler.postDelayed(this, REFRESH_MS);
        }
    };

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
        return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ON, false);
    }

    private static void setOn(Context ctx, boolean on) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ON, on).apply();
    }

    static void start(Context ctx, JSONObject labels) {
        SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        e.putBoolean(KEY_ON, true).putString(KEY_LABELS, labels.toString());
        // счётчики идут от первого запуска записи; повторное включение уведомления их не обнуляет
        if (!running) e.putLong(KEY_SINCE, System.currentTimeMillis()).putFloat(KEY_DIST, 0f);
        e.apply();
        Intent i = new Intent(ctx, TrackingService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(ctx, i);
    }

    static void stop(Context ctx) {
        setOn(ctx, false);
        ctx.stopService(new Intent(ctx, TrackingService.class));
    }

    // ------------------------------------------------------------------ жизненный цикл

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            setOn(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        // intent == null: систему перезапустила службу после нехватки памяти; продолжаем, только если запись всё ещё включена
        if (intent == null && !p.getBoolean(KEY_ON, false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            labels = new JSONObject(p.getString(KEY_LABELS, "{}"));
        } catch (JSONException e) {
            labels = new JSONObject();
        }
        long sinceWall = p.getLong(KEY_SINCE, System.currentTimeMillis());
        sinceElapsed = SystemClock.elapsedRealtime() - Math.max(0, System.currentTimeMillis() - sinceWall);
        // путь берём из хранилища только при первом запуске экземпляра (после перезапуска системой);
        // повторные команды start при уже идущей записи счётчик не сбрасывают
        if (!stateLoaded) {
            distance = p.getFloat(KEY_DIST, 0f);
            stateLoaded = true;
        }
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (RuntimeException e) {
            // например, система запретила запуск из фона: записывать нельзя
            setOn(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        subscribe();
        handler.removeCallbacks(refresh);
        handler.postDelayed(refresh, REFRESH_MS);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(refresh);
        if (manager != null) {
            try {
                manager.removeUpdates(this);
            } catch (SecurityException ignored) {
                // разрешение отозвано — обновления уже остановлены
            }
            manager = null;
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putFloat(KEY_DIST, distance).apply();
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
            setOn(this, false);
            stopSelf();
            return;
        }
        manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        try {
            // GPS подписываем всегда: если он сейчас выключен, обновления пойдут, как только его включат в настройках
            manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 0f, this, Looper.getMainLooper());
            // сетевое положение — запасное, для помещений: в расчёт берётся, только пока GPS молчит (см. onLocationChanged)
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 10_000L, 0f, this, Looper.getMainLooper());
            }
        } catch (SecurityException | IllegalArgumentException e) {
            setOn(this, false);
            stopSelf();
        }
    }

    // ------------------------------------------------------------------ уведомление

    private String label(String key, String fallback) {
        return labels.optString(key, fallback);
    }

    private String formatDistance(float m) {
        boolean imperial = labels.optBoolean("imperial", false);
        if (imperial) {
            double feet = m * 3.28084;
            if (feet < 528) return String.format(Locale.US, "%d %s", Math.round(feet), label("u2", "ft"));
            return String.format(Locale.US, "%.1f %s", m / 1609.344, label("u1", "mi"));
        }
        if (m < 1000) return String.format(Locale.US, "%d %s", Math.round(m), label("u2", "m"));
        return String.format(Locale.US, "%.2f %s", m / 1000.0, label("u1", "km"));
    }

    private String statusText() {
        long now = SystemClock.elapsedRealtime();
        if (lastFixAt == 0 || now - lastFixAt > STALE_MS) return label("searching", "Searching for GPS…");
        float accShown = labels.optBoolean("imperial", false) ? lastAcc * 3.28084f : lastAcc;
        String acc = lastAcc >= 0 ? String.format(Locale.US, " · ±%d %s", Math.round(accShown), label("u2", "m")) : "";
        return formatDistance(distance) + acc;
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        String title = label("title", "TravelOpenMap");
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, label("channel", title), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setDescription(label("text", ""));
            nm.createNotificationChannel(ch);
        }
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, piFlags);
        Intent stop = new Intent(this, TrackingService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, piFlags);

        String status = statusText();
        RemoteViews small = views(R.layout.notification_tracking, title, status);
        RemoteViews big = views(R.layout.notification_tracking_big, title, status);
        big.setTextViewText(R.id.nt_hint, label("text", ""));
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_track)
                .setColor(0xFF2FBF86)
                .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
                .setCustomContentView(small)
                .setCustomBigContentView(big)
                .setContentTitle(title)
                .setContentText(status)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(openPi)
                .addAction(0, label("stop", "Stop"), stopPi)
                .build();
    }

    private RemoteViews views(int layout, String title, String status) {
        RemoteViews v = new RemoteViews(getPackageName(), layout);
        v.setTextViewText(R.id.nt_title, title);
        v.setTextViewText(R.id.nt_status, status);
        v.setChronometer(R.id.nt_time, sinceElapsed, null, true);
        return v;
    }

    private void updateNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        try {
            nm.notify(NOTIFICATION_ID, buildNotification());
        } catch (RuntimeException ignored) {
            // нет разрешения на уведомления — запись всё равно идёт
        }
    }

    // ------------------------------------------------------------------ точки

    @Override
    public void onLocationChanged(Location l) {
        long nowElapsed = SystemClock.elapsedRealtime();
        if (LocationManager.GPS_PROVIDER.equals(l.getProvider())) {
            lastGpsAt = nowElapsed;
        } else if (lastGpsAt != 0 && nowElapsed - lastGpsAt < GPS_QUIET_MS) {
            return; // GPS работает — грубые сетевые точки только портят трек
        }
        // путь для уведомления: только точные точки и без скачков
        if (l.hasAccuracy() && l.getAccuracy() <= DIST_MAX_ACCURACY) {
            if (lastLoc != null) {
                float step = lastLoc.distanceTo(l);
                // скачок (больше DIST_MAX_STEP) в путь не идёт, но становится новой точкой отсчёта
                if (step >= DIST_MIN_STEP && step <= DIST_MAX_STEP) distance += step;
            }
            if (lastLoc == null || lastLoc.distanceTo(l) >= DIST_MIN_STEP) lastLoc = new Location(l);
        }
        lastFixAt = SystemClock.elapsedRealtime();
        lastAcc = l.hasAccuracy() ? l.getAccuracy() : -1f;

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

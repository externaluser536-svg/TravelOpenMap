package app.travelopenmap;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/**
 * Мост между веб-частью и TrackingService: запуск и остановка записи, забор накопленных точек.
 * События: «fix» — точка, пока приложение на экране.
 */
@CapacitorPlugin(
        name = "BackgroundTracker",
        permissions = {
                @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION}),
                @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"})
        })
public class BackgroundTrackerPlugin extends Plugin {

    @Override
    public void load() {
        TrackingService.setSink(fix -> {
            JSObject o = new JSObject();
            o.put("lng", fix.optDouble("lng"));
            o.put("lat", fix.optDouble("lat"));
            if (fix.has("accuracy")) o.put("accuracy", fix.optDouble("accuracy"));
            if (fix.has("heading")) o.put("heading", fix.optDouble("heading"));
            if (fix.has("speed")) o.put("speed", fix.optDouble("speed"));
            o.put("t", fix.optLong("t"));
            notifyListeners("fix", o);
        });
    }

    @Override
    protected void handleOnDestroy() {
        // окно закрыто: служба продолжает писать, точки копятся в очереди до следующего открытия
        TrackingService.setSinkActive(false);
    }

    @Override
    protected void handleOnPause() {
        // приложение свернули — веб-часть засыпает, точки снова копятся в очереди
        TrackingService.setSinkActive(false);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "afterLocationPermission");
            return;
        }
        askNotifications(call);
    }

    @PermissionCallback
    private void afterLocationPermission(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("location-denied");
            return;
        }
        askNotifications(call);
    }

    /** Разрешение на уведомления (Android 13+) желательно: без него запись работает, но плашки не видно. */
    private void askNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "afterNotificationsPermission");
            return;
        }
        launch(call);
    }

    @PermissionCallback
    private void afterNotificationsPermission(PluginCall call) {
        launch(call);
    }

    private void launch(PluginCall call) {
        JSONObject labels = new JSONObject();
        try {
            // тексты уведомления приходят из интерфейса, чтобы совпадали с языком приложения
            for (String k : new String[]{"title", "text", "stop", "searching", "channel", "u1", "u2"}) {
                String v = call.getString(k);
                if (v != null) labels.put(k, v);
            }
            labels.put("imperial", Boolean.TRUE.equals(call.getBoolean("imperial", false)));
        } catch (JSONException e) {
            call.reject("bad-labels", e);
            return;
        }
        try {
            TrackingService.start(getContext(), labels);
        } catch (RuntimeException e) {
            call.reject("start-failed", e);
            return;
        }
        JSObject r = new JSObject();
        r.put("running", true);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        TrackingService.setSinkActive(false);
        TrackingService.stop(getContext());
        call.resolve();
    }

    /** Отдаёт накопленные точки по порядку и включает прямую доставку событий. */
    @PluginMethod
    public void drain(PluginCall call) {
        List<String> lines = TrackingService.drainQueue(getContext());
        JSArray fixes = new JSArray();
        for (String line : lines) {
            try {
                fixes.put(new JSONObject(line));
            } catch (JSONException ignored) {
                // повреждённую строку пропускаем
            }
        }
        JSObject r = new JSObject();
        r.put("fixes", fixes);
        r.put("running", TrackingService.isRunning());
        call.resolve(r);
    }

    /** Исключено ли приложение из оптимизации батареи (иначе часть телефонов усыпляет фоновую запись). */
    @PluginMethod
    public void batteryStatus(PluginCall call) {
        JSObject r = new JSObject();
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= 23) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            ignoring = pm == null || pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        r.put("ignoring", ignoring);
        call.resolve(r);
    }

    /** Открывает системный экран «Оптимизация батареи» (не требует особого разрешения). */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (RuntimeException e) {
            try {
                Intent i = new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (RuntimeException e2) {
                call.reject("no-settings", e2);
            }
        }
    }

    /** Включён ли GPS в настройках телефона: без этого сигнала не будет совсем. */
    @PluginMethod
    public void gpsState(PluginCall call) {
        JSObject r = new JSObject();
        boolean enabled = true;
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            enabled = lm != null && (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
        } catch (RuntimeException ignored) {
            // не удалось узнать — не пугаем пользователя
        }
        r.put("enabled", enabled);
        call.resolve(r);
    }

    /** Открывает системные настройки геолокации. */
    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            getContext().startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("no-settings", e);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", TrackingService.isRunning());
        r.put("requested", TrackingService.wasRequested(getContext()));
        call.resolve(r);
    }
}

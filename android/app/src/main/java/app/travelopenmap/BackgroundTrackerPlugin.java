package app.travelopenmap;

import android.Manifest;
import android.os.Build;

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
        String title = call.getString("title", "TravelOpenMap");
        String text = call.getString("text", "");
        String stopLabel = call.getString("stopLabel", "Stop");
        try {
            TrackingService.start(getContext(), title, text, stopLabel);
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

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", TrackingService.isRunning());
        r.put("requested", TrackingService.wasRequested(getContext()));
        call.resolve(r);
    }
}

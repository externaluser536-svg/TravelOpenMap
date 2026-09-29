package app.travelopenmap;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // собственные плагины регистрируются до super.onCreate
        registerPlugin(BackgroundTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

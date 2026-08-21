package com.papayasamosa.hrmonitor;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HrRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

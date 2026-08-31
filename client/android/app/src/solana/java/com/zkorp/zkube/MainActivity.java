package com.zkorp.zkube;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MwaBridge.class);
        super.onCreate(savedInstanceState);
    }
}

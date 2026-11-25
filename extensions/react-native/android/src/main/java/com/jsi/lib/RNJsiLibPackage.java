
package com.jsi.lib;

import java.util.HashMap;
import java.util.Map;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;

public class RNJsiLibPackage extends BaseReactPackage {
    @Override
    public NativeModule getModule(String name, ReactApplicationContext reactContext) {
      return NativeRNJsiLibSpec.NAME.equals(name) ? new RNJsiLibModule(reactContext) : null;
    }

    @Override
    public ReactModuleInfoProvider getReactModuleInfoProvider() {
      return () -> {
        final Map<String, ReactModuleInfo> infos = new HashMap<>();
        infos.put(NativeRNJsiLibSpec.NAME, new ReactModuleInfo(
            NativeRNJsiLibSpec.NAME,
            RNJsiLibModule.class.getName(),
            false,
            false,
            false,
            true));
        return infos;
      };
    }
}

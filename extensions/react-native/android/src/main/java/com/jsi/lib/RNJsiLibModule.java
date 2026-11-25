
package com.jsi.lib;

import com.facebook.proguard.annotations.DoNotStrip;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.Promise;
import com.facebook.react.turbomodule.core.interfaces.BindingsInstallerHolder;
import com.facebook.react.turbomodule.core.interfaces.TurboModuleWithJSIBindings;

public class RNJsiLibModule extends NativeRNJsiLibSpec implements TurboModuleWithJSIBindings {

  private final ReactApplicationContext reactContext;

  public RNJsiLibModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
    Utils.copyAssetFolder(reactContext, "crossbind", reactContext.getCacheDir().getAbsolutePath() + "/crossbind");
  }

  // React Native runs the installer on the JS thread, once per module instance.
  // That covers both constraints this code used to handle by hand: Hermes is
  // thread-affine, and registering the embind bindings twice aborts with
  // "Cannot register public name ... twice".
  @DoNotStrip
  @Override
  public BindingsInstallerHolder getBindingsInstaller() {
    return createBindingsInstaller(this.reactContext.getCacheDir().getAbsolutePath());
  }

  @Override
  public void start(Promise promise) {
    promise.resolve(true);
  }

  @DoNotStrip
  private native BindingsInstallerHolder createBindingsInstaller(String path);

  static {
    System.loadLibrary("react-native-crossbind");
  }
}

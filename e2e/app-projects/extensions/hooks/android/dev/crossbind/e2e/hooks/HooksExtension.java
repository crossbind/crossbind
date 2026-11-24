package dev.crossbind.e2e.hooks;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

import javax.crypto.KeyGenerator;

import org.json.JSONObject;

// The fixture's hooks on Android: the preview extension's key of the Keystore, put in place by one that opens what it
// sealed and seals nothing, as a key that no longer seals.
public final class HooksExtension implements Extension {
    private static final String PREVIEW_KEY = "crossbind-preview-token";

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        if (!"breakKey".equals(function)) {
            call.reject("crossbind e2e: the hooks' Java has no function " + function);
            return;
        }
        try {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(PREVIEW_KEY, KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build());
            generator.generateKey();
            call.resolve(null);
        } catch (Exception error) {
            call.reject("crossbind e2e: " + error);
        }
    }
}

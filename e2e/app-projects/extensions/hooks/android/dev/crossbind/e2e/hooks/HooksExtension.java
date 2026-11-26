package dev.crossbind.e2e.hooks;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.view.View;
import android.view.ViewGroup;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

import java.security.KeyStore;

import javax.crypto.KeyGenerator;

import org.json.JSONObject;

// The fixture's hooks on Android: the preview extension's key of the Keystore, put in place by one that opens what it
// sealed and seals nothing, as a key that no longer seals. An alias that holds no key is not the extension's, which
// a run that signed in left one under: the hook fails there rather than break nothing. And the preview's pill as its
// user sees it: the view over the WebView that its words name, and where it is on the screen.
public final class HooksExtension implements Extension {
    private static final String PREVIEW_KEY = "crossbind-preview-token";

    private static final String PILL_WORDS = " – crossbind preview";

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        if ("indicator".equals(function)) {
            try {
                View pill = pillIn(host.activity().getWindow().getDecorView());
                JSONObject state = new JSONObject().put("up", pill != null && pill.isShown());
                if (pill != null) {
                    int[] at = new int[2];
                    pill.getLocationOnScreen(at);
                    state.put("label", String.valueOf(pill.getContentDescription()))
                            .put("frame", new org.json.JSONArray().put(at[0]).put(at[1]).put(pill.getWidth()).put(pill.getHeight()));
                }
                call.resolve(state);
            } catch (Exception error) {
                call.reject("crossbind e2e: " + error);
            }
            return;
        }
        if (!"breakKey".equals(function)) {
            call.reject("crossbind e2e: the hooks' Java has no function " + function);
            return;
        }
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (!store.containsAlias(PREVIEW_KEY)) {
                call.reject("crossbind e2e: the Keystore holds no key under " + PREVIEW_KEY + " to break");
                return;
            }
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

    private static View pillIn(View view) {
        CharSequence words = view.getContentDescription();
        if (words != null && words.toString().endsWith(PILL_WORDS)) return view;
        if (!(view instanceof ViewGroup group)) return null;
        for (int at = 0; at < group.getChildCount(); at += 1) {
            View found = pillIn(group.getChildAt(at));
            if (found != null) return found;
        }
        return null;
    }
}

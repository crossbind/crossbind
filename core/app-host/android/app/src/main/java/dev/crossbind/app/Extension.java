package dev.crossbind.app;

import android.content.Intent;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONStringer;

// An extension's Java, the class its app.android.class names, which its native code calls through
// crossbind::android::callJava(). The activity calls each method on the UI thread, with itself. An extension asks for
// permissions through the activity's afterAsking() and starts an activity for its result through startForResult(), so
// the activity's own requests and those of other extensions never meet it.
public interface Extension {
    // One of the extension's functions, which answers call once, from any thread. What it throws fails the call.
    void call(CrossbindActivity activity, String function, JSONObject options, Call call);

    default void onCreate(CrossbindActivity activity) {}

    default void onNewIntent(CrossbindActivity activity, Intent intent) {}

    default void onResume(CrossbindActivity activity) {}

    default void onPause(CrossbindActivity activity) {}

    default void onDestroy(CrossbindActivity activity) {}

    // A call of the native code's, which the first resolve() or reject() answers.
    final class Call {
        private final int id;
        private final AtomicBoolean isAnswered = new AtomicBoolean();

        Call(int id) {
            this.id = id;
        }

        // The result is one of org.json's values: a JSONObject, a JSONArray, a String, a Number, a Boolean or null.
        public void resolve(Object result) {
            String json;
            try {
                // org.json writes a value alone only inside an array.
                String array = new JSONStringer().array().value(result).endArray().toString();
                json = array.substring(1, array.length() - 1);
            } catch (JSONException error) {
                reject("crossbind: " + error.getMessage());
                return;
            }
            answer(true, json);
        }

        public void reject(String message) {
            answer(false, message);
        }

        private void answer(boolean ok, String text) {
            if (isAnswered.compareAndSet(false, true)) CrossbindActivity.nativeExtensionAnswered(id, ok, text.getBytes(StandardCharsets.UTF_8));
        }
    }
}

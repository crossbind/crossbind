package dev.crossbind.app;

import android.content.Intent;
import android.net.Uri;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.stream.Collectors;

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

    // The page's alert(), confirm() and prompt(), which the Java of the extension named page-dialogs gets: it returns true
    // and answers the dialog once, from any thread, as the page waits, or false to leave it to the WebView.
    default boolean onPageDialog(CrossbindActivity activity, PageDialog dialog) {
        return false;
    }

    // What the page asks to use, which the Java of the extension named page-permissions gets: it returns true and allows
    // or denies it once, from any thread, or false to leave it to the WebView, which denies it.
    default boolean onPagePermission(CrossbindActivity activity, PagePermission request) {
        return false;
    }

    // A file input the page's user clicked, which the Java of the extension named page-files gets: it returns true and
    // answers once, from any thread, or false to leave it to the WebView, which shows no picker.
    default boolean onFileInput(CrossbindActivity activity, FileInput input) {
        return false;
    }

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

    // A dialog the page opened: accept() is an alert's or a confirm's OK, or the text a prompt gives, and cancel() a
    // confirm's or a prompt's Cancel. The first answers it.
    final class PageDialog {
        public enum Kind { ALERT, CONFIRM, PROMPT }

        private final Kind kind;
        private final String message;
        private final String defaultText;
        private final JsResult result;
        private final AtomicBoolean isAnswered = new AtomicBoolean();

        PageDialog(Kind kind, String message, String defaultText, JsResult result) {
            this.kind = kind;
            this.message = message;
            this.defaultText = defaultText;
            this.result = result;
        }

        public Kind kind() {
            return kind;
        }

        public String message() {
            return message;
        }

        // The text prompt() offers to change; empty for the others.
        public String defaultText() {
            return defaultText;
        }

        public void accept(String text) {
            if (!isAnswered.compareAndSet(false, true)) return;
            CrossbindActivity.MAIN.post(() -> {
                if (kind == Kind.PROMPT) ((JsPromptResult) result).confirm(text);
                else result.confirm();
            });
        }

        public void accept() {
            accept("");
        }

        public void cancel() {
            if (isAnswered.compareAndSet(false, true)) CrossbindActivity.MAIN.post(result::cancel);
        }
    }

    // What a frame of the app's asks to use, together: "camera", "microphone", "location", "media-keys" or "midi". The
    // first allow() or deny() answers it.
    final class PagePermission {
        private final List<String> kinds;
        private final String origin;
        private final boolean isListed;
        private final Consumer<Boolean> answer;
        private final AtomicBoolean isAnswered = new AtomicBoolean();

        PagePermission(List<String> kinds, String origin, boolean isListed, Consumer<Boolean> answer) {
            this.kinds = kinds;
            this.origin = origin;
            this.isListed = isListed;
            this.answer = answer;
        }

        public List<String> kinds() {
            return kinds;
        }

        public String origin() {
            return origin;
        }

        // Whether the app's manifest, which crossbind writes from app.permissions, asks for each device's permission.
        public boolean isListed() {
            return isListed;
        }

        public void allow() {
            answer(true);
        }

        public void deny() {
            answer(false);
        }

        private void answer(boolean isAllowed) {
            if (isAnswered.compareAndSet(false, true)) CrossbindActivity.MAIN.post(() -> answer.accept(isAllowed));
        }
    }

    // A file input the page's user clicked: pick() gives the files picked, and cancel() none. The first answers it.
    final class FileInput {
        private final WebChromeClient.FileChooserParams params;
        private final ValueCallback<Uri[]> files;
        private final AtomicBoolean isAnswered = new AtomicBoolean();

        FileInput(WebChromeClient.FileChooserParams params, ValueCallback<Uri[]> files) {
            this.params = params;
            this.files = files;
        }

        public boolean allowsMultiple() {
            return params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        }

        // The types its accept attribute names, as "image/*" or ".png".
        public List<String> accept() {
            return Arrays.stream(params.getAcceptTypes()).filter((type) -> !type.isEmpty()).collect(Collectors.toList());
        }

        // The WebView's account of the input, whose createIntent() opens the system's picker for it.
        public WebChromeClient.FileChooserParams params() {
            return params;
        }

        // Content URIs alone: a file URI, such as one of the app's own files a picker could name, stays out.
        public void pick(Uri[] picked) {
            Uri[] content = picked == null ? new Uri[0]
                    : Arrays.stream(picked).filter((uri) -> uri != null && "content".equals(uri.getScheme())).toArray(Uri[]::new);
            answer(content.length == 0 ? null : content);
        }

        public void cancel() {
            answer(null);
        }

        private void answer(Uri[] picked) {
            if (isAnswered.compareAndSet(false, true)) CrossbindActivity.MAIN.post(() -> files.onReceiveValue(picked));
        }
    }
}

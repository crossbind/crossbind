package dev.crossbind.app;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.stream.Collectors;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONStringer;

// An extension's Java, the class its app.android.class names, which its native code calls through
// crossbind::android::callJava(). The activity calls each method on the UI thread, with the host, through which an
// extension asks for permissions and starts an activity for its result, so the activity's own requests and those of
// other extensions never meet it.
public interface Extension {
    // The version of crossbind's extension contract this host is built for, as CROSSBIND_EXTENSION_CONTRACT is to native
    // code.
    int CONTRACT = 2;

    // One of the extension's functions, which answers call once, from any thread. What it throws fails the call.
    void call(ExtensionHost host, String function, JSONObject options, Call call);

    // As the activity starts, with the WebView it made, before the WebView loads its first page.
    default void onCreate(ExtensionHost host) {}

    default void onNewIntent(ExtensionHost host, Intent intent) {}

    default void onResume(ExtensionHost host) {}

    default void onPause(ExtensionHost host) {}

    default void onDestroy(ExtensionHost host) {}

    // The page's alert(), confirm() and prompt(), which the Java of the holder of page-dialogs gets: it answers each
    // once, from any thread, as the page waits, and useDefault() as the hook runs leaves it to the WebView, which shows
    // its own. What it throws cancels the dialog.
    default void onPageDialog(ExtensionHost host, PageDialog dialog) {
        dialog.useDefault();
    }

    // What the page asks to use, which the Java of the holder of page-permissions gets: it allows or denies each once,
    // from any thread, and useDefault() denies it, as the WebView does. What it throws denies it.
    default void onPagePermission(ExtensionHost host, PagePermission request) {
        request.useDefault();
    }

    // A file input the page's user clicked, which the Java of the holder of page-files gets: it answers each once, from
    // any thread, and useDefault() as the hook runs leaves it to the WebView, which shows no picker. What it throws
    // cancels it.
    default void onFileInput(ExtensionHost host, FileInput input) {
        input.useDefault();
    }

    // A call of the native code's, which the first resolve() or reject() answers. Before its answer it may send the page
    // messages, as the native code's Call does, and the page may cancel it. Its options and results are org.json's
    // values, a JSONObject, a JSONArray, a String, a Number, a Boolean or null, and byte arrays, in an object or an array
    // as well: what is bytes on the page.
    final class Call {
        // What stands in the JSON for bytes beside it, by their place among them.
        private static final String TAG = "\u0001t";
        // The calls that wait for their answers, which their pages may cancel.
        private static final Map<Integer, Call> OPEN = new ConcurrentHashMap<>();

        private final int id;
        private final AtomicBoolean isAnswered = new AtomicBoolean();
        private final List<Runnable> cancelled = new ArrayList<>();
        private boolean isCancelled;

        Call(int id) {
            this.id = id;
            OPEN.put(id, this);
        }

        public void resolve(Object result) {
            Encoded encoded;
            try {
                encoded = Encoded.of(result);
            } catch (JSONException error) {
                reject("crossbind: " + error.getMessage());
                return;
            }
            answer(true, encoded.json, encoded.bytes);
        }

        public void reject(String message) {
            answer(false, message, new byte[0][]);
        }

        // A message for the page's onMessage, from any thread, which goes before the answer: one of the values resolve()
        // takes, as one it does not fails the call. One after the answer or the cancel goes nowhere.
        public void send(Object message) {
            if (isAnswered.get()) return;
            Encoded encoded;
            try {
                encoded = Encoded.of(message);
            } catch (JSONException error) {
                reject("crossbind: " + error.getMessage());
                return;
            }
            CrossbindActivity.nativeExtensionMessage(id, encoded.json.getBytes(StandardCharsets.UTF_8), encoded.bytes);
        }

        // Runs fn once, on the UI thread, as the page cancels the call or goes away: the call answers nothing from then
        // on. Each fn given runs, in the order given. For a call cancelled already, fn runs at once; for one answered,
        // never, and the call lets go of it.
        public void onCancel(Runnable fn) {
            synchronized (this) {
                if (!isCancelled) {
                    if (!isAnswered.get()) cancelled.add(fn);
                    return;
                }
            }
            fn.run();
        }

        static void cancel(int id) {
            Call call = OPEN.remove(id);
            if (call == null || !call.isAnswered.compareAndSet(false, true)) return;
            List<Runnable> fns;
            synchronized (call) {
                call.isCancelled = true;
                fns = new ArrayList<>(call.cancelled);
                call.cancelled.clear();
            }
            for (Runnable fn : fns) {
                try {
                    fn.run();
                } catch (RuntimeException error) {
                    Log.e("crossbind", "crossbind: the cancel of an extension's call failed", error);
                }
            }
        }

        // The options of a call, as the native code passes them: their JSON, with its bytes in their places.
        static JSONObject optionsOf(String json, byte[][] bytes) throws JSONException {
            return (JSONObject) withBytes(new JSONObject(json), bytes);
        }

        private static Object withBytes(Object value, byte[][] bytes) throws JSONException {
            if (value instanceof JSONArray array) {
                JSONArray items = new JSONArray();
                for (int i = 0; i < array.length(); i += 1) items.put(withBytes(array.get(i), bytes));
                return items;
            }
            if (!(value instanceof JSONObject object)) return value;
            if (object.length() == 2 && "bytes".equals(object.opt(TAG)) && object.opt("i") instanceof Number at) {
                int index = at.intValue();
                if (index < 0 || index >= bytes.length) throw new JSONException("the options name bytes they do not carry");
                return bytes[index];
            }
            JSONObject members = new JSONObject();
            for (Iterator<String> keys = object.keys(); keys.hasNext();) {
                String key = keys.next();
                members.put(key, withBytes(object.get(key), bytes));
            }
            return members;
        }

        private void answer(boolean ok, String text, byte[][] bytes) {
            if (!isAnswered.compareAndSet(false, true)) return;
            OPEN.remove(id);
            synchronized (this) {
                cancelled.clear();
            }
            CrossbindActivity.nativeExtensionAnswered(id, ok, text.getBytes(StandardCharsets.UTF_8), bytes);
        }

        // A value as the native code reads it: its JSON, the bytes in it standing for their places among bytes.
        private record Encoded(String json, byte[][] bytes) {
            static Encoded of(Object value) throws JSONException {
                List<byte[]> bytes = new ArrayList<>();
                // org.json writes a value alone only inside an array.
                String array = new JSONStringer().array().value(withTags(value, bytes)).endArray().toString();
                return new Encoded(array.substring(1, array.length() - 1), bytes.toArray(new byte[0][]));
            }

            private static Object withTags(Object value, List<byte[]> bytes) throws JSONException {
                if (value instanceof byte[] data) {
                    bytes.add(data);
                    return new JSONObject().put(TAG, "bytes").put("i", bytes.size() - 1);
                }
                if (value instanceof JSONArray array) {
                    JSONArray items = new JSONArray();
                    for (int i = 0; i < array.length(); i += 1) items.put(withTags(array.get(i), bytes));
                    return items;
                }
                if (!(value instanceof JSONObject object)) return value;
                JSONObject members = new JSONObject();
                for (Iterator<String> keys = object.keys(); keys.hasNext();) {
                    String key = keys.next();
                    members.put(key, withTags(object.get(key), bytes));
                }
                return members;
            }
        }
    }

    // A dialog the page opened: accept() is an alert's or a confirm's OK, or the text a prompt gives, cancel() a
    // confirm's or a prompt's Cancel, and useDefault() leaves it to the WebView where its owner calls it before its
    // hook returns, and else cancels it. The first answers it.
    final class PageDialog {
        public enum Kind { ALERT, CONFIRM, PROMPT }

        private final Kind kind;
        private final String message;
        private final String defaultText;
        private final JsResult result;
        private final AnswerOnce once = new AnswerOnce();

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
            if (!once.gives()) return;
            CrossbindActivity.MAIN.post(() -> {
                if (kind == Kind.PROMPT) ((JsPromptResult) result).confirm(text);
                else result.confirm();
            });
        }

        public void accept() {
            accept("");
        }

        public void cancel() {
            if (once.gives()) CrossbindActivity.MAIN.post(result::cancel);
        }

        public void useDefault() {
            if (!once.leaves()) cancel();
        }

        boolean isLeft() {
            return once.isLeft();
        }
    }

    // What a frame of the app's asks to use, together: "camera", "microphone", "location", "media-keys" or "midi". The
    // first allow() or deny() answers it, and useDefault() denies it, as the WebView does.
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

        // Whether app.permissions lists each of the devices it asks for; false for a kind that is no device.
        public boolean isListed() {
            return isListed;
        }

        public void allow() {
            answer(true);
        }

        public void deny() {
            answer(false);
        }

        public void useDefault() {
            deny();
        }

        private void answer(boolean isAllowed) {
            if (isAnswered.compareAndSet(false, true)) CrossbindActivity.MAIN.post(() -> answer.accept(isAllowed));
        }
    }

    // A file input the page's user clicked: pick() gives the files picked, cancel() none, and useDefault() leaves it to
    // the WebView, which shows no picker, where its owner calls it before its hook returns, and else cancels it. The
    // first answers it.
    final class FileInput {
        private final WebChromeClient.FileChooserParams params;
        private final ValueCallback<Uri[]> files;
        private final AnswerOnce once = new AnswerOnce();

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

        public void useDefault() {
            if (!once.leaves()) cancel();
        }

        boolean isLeft() {
            return once.isLeft();
        }

        private void answer(Uri[] picked) {
            if (once.gives()) CrossbindActivity.MAIN.post(() -> files.onReceiveValue(picked));
        }
    }
}

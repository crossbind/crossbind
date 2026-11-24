package dev.crossbind.e2e.probe;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.net.Uri;
import android.os.Handler;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.inspector.WindowInspector;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;
import dev.crossbind.app.R;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.jsoup.Jsoup;

// The probe's Java: what the app took of the probe's manifest, permissions and resources, the page's WebView, the
// activity's resumes, of which the e2e app's page-permissions, before the probe, fails as each, and the words of its Kotlin
// and of its library from Maven; the app's static shortcuts and their taps; calls with messages, cancels and bytes, as
// probe.cpp's; and a hold of the UI thread's Java messages.
public final class ProbeExtension implements Extension {
    private int resumes;
    private int cancels;
    // The calls that wait for their cancel.
    private final List<Call> waiting = new ArrayList<>();

    @Override
    public void onResume(ExtensionHost host) {
        resumes += 1;
    }

    // A GET with no gesture, of the top frame or of a frame, as the WebView hands its client one.
    private static WebResourceRequest requestOf(String url, boolean isForMainFrame, boolean isRedirect) {
        return new WebResourceRequest() {
            @Override
            public Uri getUrl() {
                return Uri.parse(url);
            }

            @Override
            public boolean isForMainFrame() {
                return isForMainFrame;
            }

            @Override
            public boolean isRedirect() {
                return isRedirect;
            }

            @Override
            public boolean hasGesture() {
                return false;
            }

            @Override
            public String getMethod() {
                return "GET";
            }

            @Override
            public Map<String, String> getRequestHeaders() {
                return Map.of();
            }
        };
    }

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        Activity activity = host.activity();
        try {
            switch (function) {
                case "android" -> {
                    ApplicationInfo info = activity.getPackageManager().getApplicationInfo(activity.getPackageName(), PackageManager.GET_META_DATA);
                    call.resolve(new JSONObject()
                            .put("meta", info.metaData == null ? JSONObject.NULL : info.metaData.getString("crossbind.probe"))
                            .put("resource", activity.getString(R.string.crossbind_probe))
                            .put("permission", activity.checkSelfPermission(Manifest.permission.VIBRATE) == PackageManager.PERMISSION_GRANTED)
                            .put("webView", host.webView() != null)
                            .put("resumes", resumes)
                            .put("kotlin", ProbeKotlin.language())
                            .put("maven", Jsoup.parse("<p>maven</p>").text()));
                }
                // The app's static shortcuts, as Android took them from its manifest.
                case "shortcuts" -> {
                    JSONArray shortcuts = new JSONArray();
                    for (ShortcutInfo shortcut : activity.getSystemService(ShortcutManager.class).getManifestShortcuts()) {
                        shortcuts.put(new JSONObject().put("id", shortcut.getId()).put("label", String.valueOf(shortcut.getShortLabel())));
                    }
                    call.resolve(shortcuts);
                }
                // A tap of a quick action, as a launcher starts the intent the app's shortcuts.xml gives it, in a task it
                // empties first: false for one the app has not got.
                case "tapShortcut" -> {
                    String type = options.getString("type");
                    Intent tap = null;
                    for (ShortcutInfo shortcut : activity.getSystemService(ShortcutManager.class).getManifestShortcuts()) {
                        if (shortcut.getId().equals(type)) tap = new Intent(shortcut.getIntent());
                    }
                    if (tap != null) activity.startActivity(tap.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
                    call.resolve(tap != null);
                }
                case "echo" -> call.resolve(options);
                // The UI thread's Java messages wait ms behind a task that puts itself at the front of its queue again,
                // while the WebView's own work goes on, so the host hears of a page that starts meanwhile only then.
                case "holdUi" -> {
                    long until = SystemClock.uptimeMillis() + options.getLong("ms");
                    Handler main = new Handler(activity.getMainLooper());
                    main.postAtFrontOfQueue(new Runnable() {
                        @Override
                        public void run() {
                            if (SystemClock.uptimeMillis() < until) main.postAtFrontOfQueue(this);
                        }
                    });
                    call.resolve(null);
                }
                // A tap amid the page, as its user's, which gives the page its user's activation: a history entry of a
                // page that had none is one Back skips.
                case "tapWebView" -> {
                    WebView view = host.webView();
                    long at = SystemClock.uptimeMillis();
                    MotionEvent down = MotionEvent.obtain(at, at, MotionEvent.ACTION_DOWN, view.getWidth() / 2f, view.getHeight() / 2f, 0);
                    MotionEvent up = MotionEvent.obtain(at, at, MotionEvent.ACTION_UP, view.getWidth() / 2f, view.getHeight() / 2f, 0);
                    view.dispatchTouchEvent(down);
                    view.dispatchTouchEvent(up);
                    down.recycle();
                    up.recycle();
                    call.resolve(null);
                }
                // What the activity's WebView client answers, asked as the WebView asks it, in this one turn of the UI
                // thread, with a project's page shown: once a Back toward the app's page is on its way, of a navigation
                // toward the app's origin; once a load of the app's page is, of the same, of a redirect of that load, and
                // of a frame's redirect toward frameRedirect. True for what it refused. The load goes on.
                case "askAsTheWebView" -> {
                    WebView view = host.webView();
                    WebViewClient client = view.getWebViewClient();
                    String app = options.getString("app");
                    JSONObject asked = new JSONObject().put("canGoBack", view.canGoBack());
                    view.goBack();
                    asked.put("back", client.shouldOverrideUrlLoading(view, requestOf(app + "/?from=accounts-back", true, false)));
                    view.loadUrl(app + "/?from=accounts-load");
                    asked.put("load", client.shouldOverrideUrlLoading(view, requestOf(app + "/?from=accounts-asked", true, false)));
                    asked.put("redirect", client.shouldOverrideUrlLoading(view, requestOf(app + "/?from=accounts-redirect", true, true)));
                    asked.put("frameRedirect", client.shouldOverrideUrlLoading(view, requestOf(options.getString("frameRedirect"), false, true)));
                    call.resolve(asked);
                }
                // Messages before the answer, each with a byte of its own, from a thread of the probe's.
                case "count" -> {
                    int count = options.getInt("count");
                    new Thread(() -> {
                        try {
                            for (int n = 1; n <= count; n += 1) call.send(new JSONObject().put("n", n).put("bytes", new byte[] {(byte) n}));
                            call.resolve("counted");
                        } catch (JSONException error) {
                            call.reject("crossbind: the probe's Java could not count: " + error);
                        }
                    }).start();
                }
                // A call that answers nothing until the page cancels it, on the UI thread, after it told the page it waits.
                case "wait" -> {
                    call.onCancel(() -> cancels += 1);
                    call.send("waiting");
                    waiting.add(call);
                }
                case "cancels" -> call.resolve(cancels);
                // The message dialog of this message among the windows of the app's process, closed as its user's click
                // of its first button closes it: false for none.
                case "closeDialog" -> {
                    String message = options.getString("message");
                    View button = null;
                    for (View root : WindowInspector.getGlobalWindowViews()) {
                        TextView text = root.findViewById(android.R.id.message);
                        if (root != activity.getWindow().getDecorView() && text != null && message.contentEquals(text.getText())) {
                            button = root.findViewById(android.R.id.button1);
                        }
                    }
                    if (button != null) button.performClick();
                    call.resolve(button != null);
                }
                // The bytes the page passed, reversed, and how many.
                case "bytes" -> {
                    byte[] data = (byte[]) options.get("data");
                    byte[] back = new byte[data.length];
                    for (int i = 0; i < data.length; i += 1) back[i] = data[data.length - 1 - i];
                    call.resolve(new JSONObject().put("size", data.length).put("back", back));
                }
                default -> call.reject("crossbind: the probe's Java has no function " + function);
            }
        } catch (PackageManager.NameNotFoundException | JSONException error) {
            call.reject("crossbind: the probe's Java failed: " + error);
        }
    }
}

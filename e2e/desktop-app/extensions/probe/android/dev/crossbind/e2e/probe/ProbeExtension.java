package dev.crossbind.e2e.probe;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;
import dev.crossbind.app.R;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.jsoup.Jsoup;

// The probe's Java: what the app took of the probe's manifest, permissions and resources, the page's WebView, the
// activity's resumes, of which the e2e app's page-permissions, before the probe, fails as each, and the words of its Kotlin
// and of its library from Maven; the app's static shortcuts and their taps; and calls with messages, cancels and bytes,
// as probe.cpp's.
public final class ProbeExtension implements Extension {
    private int resumes;
    private int cancels;
    // The calls that wait for their cancel.
    private final List<Call> waiting = new ArrayList<>();

    @Override
    public void onResume(ExtensionHost host) {
        resumes += 1;
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

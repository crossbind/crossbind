package dev.crossbind.e2e.probe;

import android.Manifest;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

import dev.crossbind.app.CrossbindActivity;
import dev.crossbind.app.Extension;
import dev.crossbind.app.R;

import org.json.JSONException;
import org.json.JSONObject;
import org.jsoup.Jsoup;

// The probe's Java: what the app took of the probe's manifest, permissions and resources, the page's WebView, the
// activity's resumes, of which the e2e app's page-permissions, before the probe, fails as each, and the words of its Kotlin
// and of its library from Maven.
public final class ProbeExtension implements Extension {
    private int resumes;

    @Override
    public void onResume(CrossbindActivity activity) {
        resumes += 1;
    }

    @Override
    public void call(CrossbindActivity activity, String function, JSONObject options, Call call) {
        try {
            switch (function) {
                case "android" -> {
                    ApplicationInfo info = activity.getPackageManager().getApplicationInfo(activity.getPackageName(), PackageManager.GET_META_DATA);
                    call.resolve(new JSONObject()
                            .put("meta", info.metaData == null ? JSONObject.NULL : info.metaData.getString("crossbind.probe"))
                            .put("resource", activity.getString(R.string.crossbind_probe))
                            .put("permission", activity.checkSelfPermission(Manifest.permission.VIBRATE) == PackageManager.PERMISSION_GRANTED)
                            .put("webView", activity.webView() != null)
                            .put("resumes", resumes)
                            .put("kotlin", ProbeKotlin.language())
                            .put("maven", Jsoup.parse("<p>maven</p>").text()));
                }
                case "echo" -> call.resolve(options);
                default -> call.reject("crossbind: the probe's Java has no function " + function);
            }
        } catch (PackageManager.NameNotFoundException | JSONException error) {
            call.reject("crossbind: the probe's Java failed: " + error);
        }
    }
}

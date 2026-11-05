package dev.crossbind.extension.pagepermissions;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import org.json.JSONObject;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

// The host's page-permissions on Android: the page gets the devices the manifest asks for, which crossbind writes from
// app.permissions, once the app's user gives them, and nothing else, so that the WebView asks nothing of its own. The
// location is the approximate one at least, which its user may give alone.
public final class PagePermissionsExtension implements Extension {
    private static final String COARSE = Manifest.permission.ACCESS_COARSE_LOCATION;
    private static final Map<String, String> DEVICES = Map.of(
            "camera", Manifest.permission.CAMERA,
            "microphone", Manifest.permission.RECORD_AUDIO);

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        call.reject("crossbind: page-permissions has no function " + function);
    }

    @Override
    public void onPagePermission(ExtensionHost host, PagePermission request) {
        Activity activity = host.activity();
        if (!request.isListed()) {
            request.deny();
        } else if (request.kinds().equals(List.of("location"))) {
            // Asked for the precise location again, a user who gave the approximate one is asked to change it.
            if (isGranted(activity, COARSE)) request.allow();
            else host.afterAsking(new String[] {COARSE, Manifest.permission.ACCESS_FINE_LOCATION}, () -> answer(activity, request, COARSE));
        } else {
            String[] permissions = request.kinds().stream().map(DEVICES::get).toArray(String[]::new);
            host.afterAsking(permissions, () -> answer(activity, request, permissions));
        }
    }

    private static void answer(Activity activity, PagePermission request, String... permissions) {
        if (Arrays.stream(permissions).allMatch((permission) -> isGranted(activity, permission))) request.allow();
        else request.deny();
    }

    private static boolean isGranted(Activity activity, String permission) {
        return activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }
}

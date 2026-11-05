package dev.crossbind.e2e.pagepermissions;

import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;

import dev.crossbind.app.CrossbindActivity;
import dev.crossbind.app.Extension;

// What the page asks to use on Android, denied and kept as permissions.cpp does elsewhere. The activity calls both
// methods on the UI thread.
public final class PagePermissionsExtension implements Extension {
    private final JSONArray asked = new JSONArray();

    @Override
    public void call(CrossbindActivity activity, String function, JSONObject options, Call call) {
        if (function.equals("asked")) call.resolve(asked);
        else call.reject("crossbind: the e2e app's page-permissions has no function " + function);
    }

    @Override
    public boolean onPagePermission(CrossbindActivity activity, PagePermission request) {
        asked.put(new JSONObject(Map.of("kinds", new JSONArray(request.kinds()), "origin", request.origin(), "isListed", request.isListed())));
        request.deny();
        return true;
    }
}

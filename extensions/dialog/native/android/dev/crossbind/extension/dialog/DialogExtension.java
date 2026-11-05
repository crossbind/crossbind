package dev.crossbind.extension.dialog;

import android.app.Activity;
import android.app.AlertDialog;
import android.view.WindowManager;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

import org.json.JSONArray;
import org.json.JSONObject;

// The message dialog the native code shows, in the activity in front, answered with the index of the button clicked,
// or -1 when it went without one.
public final class DialogExtension implements Extension {
    private AlertDialog messageDialog;

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        if (!function.equals("message")) {
            call.reject("crossbind: the dialog extension's Java has no function " + function);
            return;
        }
        JSONArray buttons = options.optJSONArray("buttons");
        String[] labels = new String[buttons == null ? 0 : buttons.length()];
        for (int i = 0; i < labels.length; i += 1) labels[i] = buttons.optString(i);
        showMessageDialog(host.activity(), options.optString("message"), options.optString("detail"), labels, call);
    }

    // A message dialog that goes with its activity answers as one closed.
    @Override
    public void onDestroy(ExtensionHost host) {
        if (messageDialog != null) messageDialog.dismiss();
    }

    // Android has a positive, a neutral and a negative button: the first label is the positive one, and the last of
    // several the negative, which Android places where its apps put Cancel. Back and a tap outside close the dialog. The
    // message goes in the dialog's text with the detail, as a title stops after two lines.
    private void showMessageDialog(Activity activity, String message, String detail, String[] labels, Call call) {
        if (activity.isFinishing() || activity.isDestroyed()) {
            call.resolve(-1);
            return;
        }
        String[] names = labels.length == 0 ? new String[] {activity.getString(android.R.string.ok)} : labels;
        int[] clicked = {-1};
        AlertDialog.Builder builder = new AlertDialog.Builder(activity).setMessage(detail.isEmpty() ? message : message + "\n\n" + detail)
                .setPositiveButton(names[0], (dialog, which) -> clicked[0] = 0)
                .setOnDismissListener((dialog) -> {
                    messageDialog = null;
                    call.resolve(clicked[0]);
                });
        if (names.length == 3) builder.setNeutralButton(names[1], (dialog, which) -> clicked[0] = 1);
        if (names.length > 1) builder.setNegativeButton(names[names.length - 1], (dialog, which) -> clicked[0] = names.length - 1);
        try {
            messageDialog = builder.show();
        } catch (WindowManager.BadTokenException gone) {
            call.resolve(-1);
        }
    }
}

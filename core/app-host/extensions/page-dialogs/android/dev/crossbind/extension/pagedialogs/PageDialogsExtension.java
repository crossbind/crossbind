package dev.crossbind.extension.pagedialogs;

import android.app.AlertDialog;
import android.widget.EditText;

import org.json.JSONObject;

import dev.crossbind.app.CrossbindActivity;
import dev.crossbind.app.Extension;

// The host's page-dialogs on Android: the page's alert(), confirm() and prompt() as the system's dialog in the activity,
// titled with the app's name. A dialog its user dismisses answers as cancelled.
public final class PageDialogsExtension implements Extension {
    @Override
    public void call(CrossbindActivity activity, String function, JSONObject options, Call call) {
        call.reject("crossbind: page-dialogs has no function " + function);
    }

    @Override
    public boolean onPageDialog(CrossbindActivity activity, PageDialog dialog) {
        if (activity.isFinishing() || activity.isDestroyed()) return false;
        EditText field = dialog.kind() == PageDialog.Kind.PROMPT ? new EditText(activity) : null;
        if (field != null) {
            field.setText(dialog.defaultText());
            field.setSingleLine(true);
            field.selectAll();
        }
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setTitle(activity.getApplicationInfo().loadLabel(activity.getPackageManager()))
                .setMessage(dialog.message())
                .setPositiveButton(android.R.string.ok, (shown, which) -> dialog.accept(field == null ? "" : field.getText().toString()))
                .setOnCancelListener((shown) -> dialog.cancel());
        if (field != null) builder.setView(field);
        if (dialog.kind() != PageDialog.Kind.ALERT) builder.setNegativeButton(android.R.string.cancel, (shown, which) -> dialog.cancel());
        builder.show();
        return true;
    }
}

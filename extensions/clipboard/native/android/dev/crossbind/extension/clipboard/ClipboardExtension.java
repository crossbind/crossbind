package dev.crossbind.extension.clipboard;

import android.content.ClipData;
import android.content.ClipboardManager;

import dev.crossbind.app.CrossbindActivity;
import dev.crossbind.app.Extension;

import org.json.JSONObject;

// The system clipboard's text. Android lets the app in front alone read it, and from Android 13 tells its user when one
// does.
public final class ClipboardExtension implements Extension {
    @Override
    public void call(CrossbindActivity activity, String function, JSONObject options, Call call) {
        ClipboardManager board = activity.getSystemService(ClipboardManager.class);
        switch (function) {
            case "readText" -> {
                ClipData clip = board.getPrimaryClip();
                CharSequence text = clip == null || clip.getItemCount() == 0 ? null : clip.getItemAt(0).coerceToText(activity);
                call.resolve(text == null ? "" : text.toString());
            }
            case "writeText" -> {
                board.setPrimaryClip(ClipData.newPlainText("", options.optString("text")));
                call.resolve(null);
            }
            default -> call.reject("crossbind: the clipboard extension's Java has no function " + function);
        }
    }
}

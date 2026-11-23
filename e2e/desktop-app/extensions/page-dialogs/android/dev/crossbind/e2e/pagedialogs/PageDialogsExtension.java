package dev.crossbind.e2e.pagedialogs;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

// The page's dialogs on Android, as dialogs.cpp answers them elsewhere, and the messages of those whose message starts
// with "wait" that it was handed and that answered as cancelled as their page went, which android.cpp asks for.
public final class PageDialogsExtension implements Extension {
    private static final List<String> HANDED = new ArrayList<>();
    private static final List<String> CANCELLED = new ArrayList<>();

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        if (!function.equals("heard")) {
            call.reject("crossbind: the e2e app's page-dialogs has no function " + function);
            return;
        }
        synchronized (HANDED) {
            call.resolve(new JSONObject(Map.of("handed", new JSONArray(HANDED), "cancelled", new JSONArray(CANCELLED))));
        }
    }

    @Override
    public void onPageDialog(ExtensionHost host, PageDialog dialog) {
        String message = dialog.message();
        if (message.startsWith("wait")) {
            synchronized (HANDED) {
                HANDED.add(message);
            }
            dialog.onCancel(() -> {
                synchronized (HANDED) {
                    CANCELLED.add(message);
                }
            });
        } else if (message.equals("cancel")) {
            dialog.cancel();
        } else if (dialog.kind() == PageDialog.Kind.PROMPT) {
            dialog.accept(new JSONObject(Map.of("message", message, "defaultText", dialog.defaultText(), "role", dialog.role(), "label", dialog.label())).toString());
        } else {
            dialog.accept();
        }
    }
}

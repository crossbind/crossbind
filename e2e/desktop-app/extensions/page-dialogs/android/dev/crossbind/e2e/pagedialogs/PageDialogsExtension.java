package dev.crossbind.e2e.pagedialogs;

import java.util.Map;

import org.json.JSONObject;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

// The page's dialogs on Android, as dialogs.cpp answers them elsewhere.
public final class PageDialogsExtension implements Extension {
    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        call.reject("crossbind: the e2e app's page-dialogs has no function " + function);
    }

    @Override
    public void onPageDialog(ExtensionHost host, PageDialog dialog) {
        if (dialog.message().equals("cancel")) {
            dialog.cancel();
        } else if (dialog.kind() == PageDialog.Kind.PROMPT) {
            dialog.accept(new JSONObject(Map.of("message", dialog.message(), "defaultText", dialog.defaultText())).toString());
        } else {
            dialog.accept();
        }
    }
}

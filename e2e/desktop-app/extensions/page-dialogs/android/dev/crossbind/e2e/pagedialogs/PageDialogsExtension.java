package dev.crossbind.e2e.pagedialogs;

import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.json.JSONObject;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

// The page's dialogs on Android, as dialogs.cpp answers them elsewhere, and how many of the message "wait" answered as
// cancelled as their page went, which android.cpp asks for.
public final class PageDialogsExtension implements Extension {
    private static final AtomicInteger CANCELS = new AtomicInteger();

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        if (function.equals("cancels")) call.resolve(CANCELS.get());
        else call.reject("crossbind: the e2e app's page-dialogs has no function " + function);
    }

    @Override
    public void onPageDialog(ExtensionHost host, PageDialog dialog) {
        if (dialog.message().equals("wait")) {
            dialog.onCancel(CANCELS::incrementAndGet);
        } else if (dialog.message().equals("cancel")) {
            dialog.cancel();
        } else if (dialog.kind() == PageDialog.Kind.PROMPT) {
            dialog.accept(new JSONObject(Map.of("message", dialog.message(), "defaultText", dialog.defaultText(), "role", dialog.role(), "label", dialog.label()))
                    .toString());
        } else {
            dialog.accept();
        }
    }
}

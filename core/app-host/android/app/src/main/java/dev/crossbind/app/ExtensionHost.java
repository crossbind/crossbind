package dev.crossbind.app;

import android.app.Activity;
import android.content.Intent;
import android.webkit.WebView;

// What the host hands an extension's Java, on the UI thread: the app's activity and its WebView, and the activity's
// own ways to ask for permissions and to start an activity for its result, so that the activity's requests and those of
// other extensions never meet the extension's.
public interface ExtensionHost {
    Activity activity();

    // The WebView that shows the page: null before the activity has made it, and on a device without one.
    WebView webView();

    // Asks the app's user for whichever of these permissions it lacks, then runs then, which checks what it was given.
    void afterAsking(String[] permissions, Runnable then);

    // Starts an activity for its result, which then gets on the UI thread. It throws ActivityNotFoundException, as
    // startActivityForResult() does.
    void startForResult(Intent intent, ActivityResult then);

    interface ActivityResult {
        void onResult(int result, Intent data);
    }
}

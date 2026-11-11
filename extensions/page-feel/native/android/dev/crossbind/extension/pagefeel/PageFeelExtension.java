package dev.crossbind.extension.pagefeel;

import android.view.View;
import android.webkit.WebView;

import androidx.webkit.WebViewCompat;

import org.json.JSONObject;

import java.util.Set;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

public final class PageFeelExtension implements Extension {
    private static native String pageScript();

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        call.reject("crossbind: page-feel has no function " + function);
    }

    @Override
    public void onCreate(ExtensionHost host) {
        WebView webView = host.webView();
        if (webView == null) return;
        webView.getSettings().setSupportZoom(false);
        // A page that fits its window stays put, and one that scrolls overscrolls as any of the system's lists.
        webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        WebViewCompat.addDocumentStartJavaScript(webView, pageScript(), Set.of("*"));
    }
}

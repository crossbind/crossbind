package dev.crossbind.extension.preview;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import dev.crossbind.app.Extension.Call;
import dev.crossbind.app.ExtensionHost;

import java.util.ArrayDeque;

// What shows that a preview is one on Android: a pill above the WebView, inside the system bars, which opens the
// preview's menu; and Back, which within the project's own history goes back and at its first entry closes the
// preview. What its user asks for, Reload or Close preview, answers the native code's call it holds. On the UI thread.
final class Indicator {
    private static final int PILL_DP = 28;
    private static final int MARK_DP = 16;
    private static final int MARGIN_DP = 8;

    private LinearLayout pill;
    private AlertDialog menu;
    private OnBackInvokedCallback back;
    private Activity shownOn;
    private String project = "";
    private String line = "";
    private String origin = "";
    // The native code's call for what its user asks next, and what was asked while it held none.
    private Call waiting;
    private final ArrayDeque<String> asked = new ArrayDeque<>();

    void mark(ExtensionHost host, String project, String line, String origin) {
        this.project = project;
        this.line = line;
        this.origin = origin;
        Activity activity = host.activity();
        if (pill != null && shownOn != activity) unmark();
        if (pill == null) show(host, activity);
        pill.setContentDescription(project + " – crossbind preview");
    }

    void unmark() {
        if (menu != null) menu.dismiss();
        menu = null;
        if (back != null && shownOn != null) shownOn.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(back);
        back = null;
        if (pill != null && pill.getParent() instanceof ViewGroup parent) parent.removeView(pill);
        pill = null;
        shownOn = null;
    }

    // Whether the WebView shows a page of the preview's origin: the page its history holds as current, which a load the
    // host began at the preview's end replaces only once it commits, where getUrl() names the coming one at once.
    boolean showsPreview(ExtensionHost host) {
        WebView view = host.webView();
        WebBackForwardList history = view == null ? null : view.copyBackForwardList();
        return history != null && history.getCurrentItem() != null && isPreviews(history.getCurrentItem().getUrl());
    }

    void reload(ExtensionHost host) {
        WebView view = host.webView();
        if (view != null) view.reload();
    }

    void next(Call call) {
        if (asked.isEmpty()) waiting = call;
        else call.resolve(asked.poll());
    }

    private void ask(String action) {
        Call call = waiting;
        waiting = null;
        if (call != null) call.resolve(action);
        else asked.add(action);
    }

    // The app's mark and "Preview", 28 dp high at the top trailing corner, clear of the system bars and the cutout.
    private void show(ExtensionHost host, Activity activity) {
        pill = new LinearLayout(activity);
        pill.setOrientation(LinearLayout.HORIZONTAL);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setPadding(dp(activity, 10), 0, dp(activity, 12), 0);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(Color.argb(230, 32, 33, 36));
        shape.setCornerRadius(dp(activity, PILL_DP / 2));
        pill.setBackground(shape);
        ImageView mark = new ImageView(activity);
        mark.setImageDrawable(activity.getApplicationInfo().loadIcon(activity.getPackageManager()));
        pill.addView(mark, new LinearLayout.LayoutParams(dp(activity, MARK_DP), dp(activity, MARK_DP)));
        TextView text = new TextView(activity);
        text.setText("Preview");
        text.setTextColor(Color.WHITE);
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        text.setPadding(dp(activity, 6), 0, 0, 0);
        pill.addView(text);
        pill.setOnClickListener((view) -> openMenu(activity));
        FrameLayout.LayoutParams place = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(activity, PILL_DP), Gravity.TOP | Gravity.END);
        pill.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            place.topMargin = bars.top + dp(activity, MARGIN_DP / 2);
            place.rightMargin = bars.right + dp(activity, MARGIN_DP);
            view.setLayoutParams(place);
            return insets;
        });
        activity.addContentView(pill, place);
        pill.requestApplyInsets();
        shownOn = activity;
        back = () -> goBack(host);
        activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_OVERLAY, back);
    }

    // The project's name over its line, which does nothing, then Reload and Close preview.
    private void openMenu(Activity activity) {
        if (menu != null && menu.isShowing()) return;
        LinearLayout title = new LinearLayout(activity);
        title.setOrientation(LinearLayout.VERTICAL);
        title.setPadding(dp(activity, 24), dp(activity, 20), dp(activity, 24), dp(activity, 4));
        TextView name = new TextView(activity);
        name.setText(project);
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        TextView below = new TextView(activity);
        below.setText(line);
        below.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        title.addView(name);
        title.addView(below);
        menu = new AlertDialog.Builder(activity)
                .setCustomTitle(title)
                .setItems(new CharSequence[] {"Reload", "Close preview"}, (dialog, which) -> ask(which == 0 ? "reload" : "close"))
                .setNegativeButton("Cancel", null)
                .create();
        menu.show();
    }

    // The WebView's own goBack(), as a built app's Back is, where the history entry before this one is the project's: it
    // skips each entry a page made without its user's activation, as far as an older page of the project's or the app's,
    // whose page ends the preview, and no page holds it. Else the preview closes.
    private void goBack(ExtensionHost host) {
        WebView view = host.webView();
        WebBackForwardList history = view == null ? null : view.copyBackForwardList();
        int current = history == null ? -1 : history.getCurrentIndex();
        if (current > 0 && view.canGoBack() && isPreviews(history.getItemAtIndex(current - 1).getUrl())) view.goBack();
        else ask("close");
    }

    // Whether a page's URL is of the preview's origin; a blob: URL is of the origin inside it.
    private boolean isPreviews(String url) {
        if (url == null || origin.isEmpty()) return false;
        Uri page = Uri.parse(url.startsWith("blob:") ? url.substring(5) : url);
        Uri served = Uri.parse(origin);
        return String.valueOf(page.getScheme()).equals(served.getScheme()) && String.valueOf(page.getHost()).equals(served.getHost())
                && page.getPort() == served.getPort();
    }

    private static int dp(Activity activity, int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, activity.getResources().getDisplayMetrics()));
    }
}

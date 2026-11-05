package dev.crossbind.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebMessagePortCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

import org.json.JSONException;
import org.json.JSONObject;

// An app's one activity: its page in a WebView, its module in Hermes behind JNI (libcrossbind_app.so). The page comes
// from an https origin the activity serves from the app's files, or in a debug app from a dev server; calls and their
// bytes travel over a message port that the page's top frame alone gets.
public class CrossbindActivity extends Activity {
    static {
        System.loadLibrary("crossbind_app");
    }

    private static final String TAG = "Crossbind";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String APP_ORIGIN = "https://" + HOST;
    // The object a page of the app's origins asks for its port with.
    private static final String READY = "__crossbind_ready";
    // The object the page hands a download's name and bytes to, and the function the host asks for them with.
    private static final String DOWNLOAD = "__crossbind_download";
    private static final String TAKE_DOWNLOAD = "__crossbind_take_download";
    // How long a download link waits for WebView to start its download.
    private static final int LINK_KEPT_MS = 60000;
    // In the top frame. WebView hands no one a download link's name, and the page may revoke a blob: URL at once, or
    // keep its CSP from fetching blob: and data: URLs. So the page keeps the Blob behind each blob: URL it makes, and a
    // link's name as it is followed, a link outside the document by its click() or dispatchEvent(), which no window
    // hears. The host asks for both by a download's id once WebView starts the download, and gets them framed.
    private static final String DOWNLOAD_SCRIPT = "if (window.top === window) {"
            + " const blobs = new Map();"
            + " const createObjectURL = URL.createObjectURL;"
            + " const revokeObjectURL = URL.revokeObjectURL;"
            + " URL.createObjectURL = (object) => {"
            + "  const url = createObjectURL.call(URL, object);"
            + "  if (object instanceof Blob) blobs.set(url, object);"
            + "  return url;"
            + " };"
            + " URL.revokeObjectURL = (url) => {"
            + "  blobs.delete(url);"
            + "  revokeObjectURL.call(URL, url);"
            + " };"
            + " const kept = new Map();"
            + " const keep = (link) => {"
            + "  if (!(link instanceof HTMLAnchorElement) || !link.hasAttribute('download')) return;"
            + "  const href = link.href;"
            + "  const entry = { name: link.download, blob: blobs.get(href) };"
            + "  kept.set(href, entry);"
            + "  setTimeout(() => { if (kept.get(href) === entry) kept.delete(href); }, " + LINK_KEPT_MS + ");"
            + " };"
            + " addEventListener('click', (event) => keep(event.target.closest?.('a')), true);"
            + " const click = HTMLElement.prototype.click;"
            + " HTMLAnchorElement.prototype.click = function () { if (!this.isConnected) keep(this); return click.call(this); };"
            + " const dispatch = EventTarget.prototype.dispatchEvent;"
            + " HTMLAnchorElement.prototype.dispatchEvent = function (event) {"
            + "  if (!this.isConnected && event.type === 'click') keep(this);"
            + "  return dispatch.call(this, event);"
            + " };"
            + " const fromData = (url) => {"
            + "  const comma = url.indexOf(',');"
            + "  const body = unescape(url.slice(comma + 1));"
            + "  const text = /;base64$/i.test(url.slice(0, comma)) ? atob(body) : body;"
            + "  return Uint8Array.from(text, (c) => c.charCodeAt(0)).buffer;"
            + " };"
            + " const read = (url, blob) => blob ? blob.arrayBuffer()"
            + "  : url.startsWith('data:') ? Promise.resolve().then(() => fromData(url))"
            + "  : fetch(url).then((response) => {"
            + "   if (!response.ok) throw new Error(response.status + ' ' + response.statusText);"
            + "   return response.arrayBuffer();"
            + "  });"
            + " Object.defineProperty(globalThis, '" + TAKE_DOWNLOAD + "', { value: (id, url) => {"
            + "  const entry = kept.get(url);"
            + "  kept.delete(url);"
            + "  read(url, entry?.blob ?? blobs.get(url)).then((bytes) => {"
            + "   const name = new TextEncoder().encode(entry?.name ?? '');"
            + "   const frame = new Uint8Array(8 + name.length + bytes.byteLength);"
            + "   const view = new DataView(frame.buffer);"
            + "   view.setUint32(0, id, true);"
            + "   view.setUint32(4, name.length, true);"
            + "   frame.set(name, 8);"
            + "   frame.set(new Uint8Array(bytes), 8 + name.length);"
            + "   " + DOWNLOAD + ".postMessage(frame.buffer);"
            + "  }).catch((error) => " + DOWNLOAD + ".postMessage(id + '|' + error));"
            + " } });"
            + "}";
    // The relative luminance of a color that black and white contrast with as much.
    private static final float EVEN_CONTRAST = 0.179f;
    private static final int PERMISSIONS_REQUEST = 1;
    // Where the native code's calls of an extension's Java run.
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    // The Android permission behind each device a page asks for.
    private static final Map<String, String> PAGE_DEVICES = Map.of(
            PermissionRequest.RESOURCE_VIDEO_CAPTURE, Manifest.permission.CAMERA,
            PermissionRequest.RESOURCE_AUDIO_CAPTURE, Manifest.permission.RECORD_AUDIO);

    // A call of a page, answered on the port of the page that made it: a page that went away gets no answer.
    private static final class Call {
        final WebMessagePortCompat port;
        final int id;

        Call(WebMessagePortCompat port, int id) {
            this.port = port;
            this.id = id;
        }
    }

    private static final Map<Integer, Call> calls = new ConcurrentHashMap<>();
    private static final AtomicInteger nextCall = new AtomicInteger();
    // The activity that the calls of extensions' Java get while it lives.
    private static volatile CrossbindActivity current;

    private WebView webView;
    private Handler ipc;
    private WebMessagePortCompat port;
    private String token;
    private final Set<String> origins = new HashSet<>();
    // What waits for the result of each activity this one started, under its request code.
    private final Map<Integer, ActivityResult> results = new HashMap<>();
    private int nextRequest;
    // The file input whose picker is open: a picker that opens after it answers it with nothing.
    private ValueCallback<Uri[]> pendingFiles;
    // What waits for the answer the app's user is giving for permissions, and what waits to ask: Android asks one question
    // at a time, and answers one asked meanwhile with nothing.
    private Runnable answering;
    private final ArrayDeque<Runnable> waiting = new ArrayDeque<>();
    private Set<String> declared;
    // Back walks the page's history first, as in a browser; with none left, the system's own back leaves the app.
    private final OnBackInvokedCallback back = () -> webView.goBack();
    private boolean isBackTaken;
    // The downloads the page started, in turn for the save picker, which shows one at a time.
    private final ArrayDeque<Download> downloads = new ArrayDeque<>();
    private int nextDownload;
    private boolean isPicking;

    private static final class Download {
        final int id;
        final String mime;
        String name;
        // What the page handed over, with the download's bytes from offset on; null until it has.
        byte[] frame;
        int offset;

        Download(int id, String name, String mime) {
            this.id = id;
            this.name = name;
            this.mime = mime;
        }
    }

    // Starts the module, once per process, and returns the page's token and the dev server's page, or "". data and cache
    // are the app's folders, which crossbind/app's paths() names.
    private static native String[] nativeStart(String files, String devUrl, String data, String cache);

    private static native void nativeMessage(int call, byte[] text);

    private static native void nativeFrame(int call, String query, byte[] frame, int bodyOffset);

    private static native void nativeResult(int call, String query);

    // A file of the page, its path in UTF-8: "<status> <mime>\n" and its bytes.
    private static native byte[] nativeRequest(byte[] path, String query);

    private static native void nativeNewPage();

    // A link of app.urlSchemes the system opened the app with, in UTF-8.
    private static native void nativeOpenUrl(byte[] url);

    // The answer of an extension's Java to its native code: the result's JSON, or why the call failed, in UTF-8.
    static native void nativeExtensionAnswered(int call, boolean ok, byte[] text);

    // A call of an extension's Java by its native code, from whichever thread makes it: the extension's name, the
    // function's and its options' JSON, in UTF-8.
    static void callExtension(int id, byte[] extensionName, byte[] functionName, byte[] optionsJson) {
        String extension = new String(extensionName, StandardCharsets.UTF_8);
        String function = new String(functionName, StandardCharsets.UTF_8);
        String options = new String(optionsJson, StandardCharsets.UTF_8);
        String called = extension + "." + function;
        Extension.Call call = new Extension.Call(id);
        MAIN.post(() -> {
            Extension to = Extensions.ALL.get(extension);
            CrossbindActivity activity = current;
            if (to == null) {
                call.reject("crossbind: the app has no Java of the extension " + extension);
            } else if (activity == null) {
                call.reject("crossbind: " + called + " needs the app's activity, which is gone");
            } else {
                try {
                    to.call(activity, function, new JSONObject(options), call);
                } catch (JSONException | RuntimeException error) {
                    Log.e(TAG, called + " failed", error);
                    call.reject("crossbind: " + called + " failed: " + error);
                }
            }
        });
    }

    // The module's answer to a call, from whichever thread gives it.
    static void onReply(int call, boolean ok, byte[] text) {
        Call to = calls.remove(call);
        if (to != null) post(to.port, new WebMessageCompat(to.id + "|" + (ok ? "" : "!") + new String(text, StandardCharsets.UTF_8)));
    }

    // A large result: its bytes after four that take the call's id, little-endian.
    static void onReplyBytes(int call, byte[] framed) {
        Call to = calls.remove(call);
        if (to == null) return;
        for (int i = 0; i < 4; i += 1) framed[i] = (byte) (to.id >> (8 * i));
        post(to.port, new WebMessageCompat(framed));
    }

    // Answers come from the module's thread and the port closes on the UI thread, never at once.
    private static void post(WebMessagePortCompat port, WebMessageCompat message) {
        synchronized (port) {
            try {
                port.postMessage(message);
            } catch (IllegalStateException closed) {
                // The page went away, and its port with it.
            }
        }
    }

    private static void close(WebMessagePortCompat port) {
        synchronized (port) {
            port.close();
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        // The page sends byte arrays as ArrayBuffer messages, which Android System WebView passes from 116 on.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            PackageInfo installed = WebViewCompat.getCurrentWebViewPackage(this);
            String text = "This app needs Android System WebView 116 or newer. This device has "
                    + (installed == null ? "none" : installed.versionName) + ".";
            Log.e(TAG, text);
            TextView message = new TextView(this);
            message.setText(text);
            setContentView(message);
            return;
        }
        // Any app can start this activity with extras, so a debug app opens a dev server on this device alone, which adb
        // reverse forwards, and a release app shows its console only where it is debuggable.
        String url = getIntent().getStringExtra("CROSSBIND_APP_URL");
        if (url != null && !Set.of("localhost", "127.0.0.1").contains(Uri.parse(url).getHost())) {
            Log.w(TAG, "a dev server off this device is not opened: " + url);
            url = null;
        }
        boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        String[] started = nativeStart(installFiles().getPath(), url, getFilesDir().getPath(), getCacheDir().getPath());
        token = started[0];
        String devUrl = started[1];
        origins.add(APP_ORIGIN);
        if (!devUrl.isEmpty()) origins.add(originOf(Uri.parse(devUrl)));

        HandlerThread thread = new HandlerThread("crossbind-ipc");
        thread.start();
        ipc = new Handler(thread.getLooper());
        webView = new WebView(this);
        // app.window.backgroundColor, which the theme shows until the page paints, goes behind the page as well.
        int background = getColor(R.color.crossbind_background);
        if (Color.alpha(background) != 0) webView.setBackgroundColor(background);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        WebViewCompat.addDocumentStartJavaScript(webView, topFrameScript(token), origins);
        WebViewCompat.addDocumentStartJavaScript(webView, DOWNLOAD_SCRIPT, origins);
        WebViewCompat.addWebMessageListener(webView, READY, origins, (view, message, origin, isMainFrame, reply) -> {
            if (isMainFrame) handOverPort(origin, message.getData());
        });
        WebViewCompat.addWebMessageListener(webView, DOWNLOAD, origins, (view, message, origin, isMainFrame, reply) -> {
            if (isMainFrame) handedOver(message);
        });
        webView.setDownloadListener((address, userAgent, disposition, mime, length) -> {
            download(address, URLUtil.guessFileName(address, disposition, mime), mime);
        });
        webView.setWebViewClient(new PageClient());
        webView.setWebChromeClient(new PageChrome(!devUrl.isEmpty() || (isDebuggable && getIntent().hasExtra("CROSSBIND_APP_CONSOLE"))));
        // The page stays clear of the system bars, the display cutout and the keyboard.
        FrameLayout frame = new FrameLayout(this);
        frame.addView(webView);
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(frame);
        matchSystemBars();
        webView.loadUrl(devUrl.isEmpty() ? APP_ORIGIN + "/" : devUrl);
        // A link that launched the activity waits for the page to ask for it. The module may have outlived an activity
        // before this one, whose page it forgets first; an activity the system restores, or Recents reopens, brings its
        // old link, which the page had.
        nativeNewPage();
        if (state == null && (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) openUrlOf(getIntent());
        tellExtensions((extension) -> extension.onCreate(this));
    }

    // A link that opens the app while it runs comes here, as an app with app.urlSchemes keeps the activity its task's
    // one, which keeps the page.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openUrlOf(intent);
        tellExtensions((extension) -> extension.onNewIntent(this, intent));
    }

    private void openUrlOf(Intent intent) {
        // An activity that could not start the module, for want of a WebView, takes no link.
        if (token == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        // Any app may start the activity with any link: the app hears of those of its schemes alone, which the
        // activity's intent filter matches.
        Intent own = new Intent(Intent.ACTION_VIEW, intent.getData()).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(getPackageName());
        if (getPackageManager().queryIntentActivities(own, 0).isEmpty()) return;
        nativeOpenUrl(intent.getData().toString().getBytes(StandardCharsets.UTF_8));
    }

    @Override
    protected void onResume() {
        super.onResume();
        tellExtensions((extension) -> extension.onResume(this));
    }

    @Override
    protected void onPause() {
        super.onPause();
        tellExtensions((extension) -> extension.onPause(this));
    }

    // The Java of each extension hears what the activity does, once the activity has started the module.
    private void tellExtensions(Consumer<Extension> tell) {
        if (token != null) Extensions.ALL.values().forEach(tell);
    }

    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        matchSystemBars();
    }

    // The system bars lie over the window, so their icons are dark in the light theme and light in the dark one, or on
    // app.window.backgroundColor, dark on a light color and light on a dark one.
    private void matchSystemBars() {
        int background = getColor(R.color.crossbind_background);
        boolean isDark = Color.alpha(background) != 0 ? Color.luminance(background) < EVEN_CONTRAST
                : (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
        getWindow().getInsetsController().setSystemBarsAppearance(isDark ? 0 : light, light);
    }

    public interface ActivityResult {
        void onResult(int result, Intent data);
    }

    // Starts an activity for its result, which then gets on the UI thread. It throws ActivityNotFoundException, as
    // startActivityForResult() does.
    public void startForResult(Intent intent, ActivityResult then) {
        int request = nextRequest++;
        startActivityForResult(intent, request);
        results.put(request, then);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        ActivityResult then = results.remove(request);
        if (then != null) then.onResult(result, data);
    }

    // A download the page starts saves where its user picks, as a browser asks: the page hands over its name and bytes,
    // as only the page knows them, and the system's save picker takes them in turn. A download that is no link of the
    // page's is named after its address.
    private void download(String url, String name, String mime) {
        Download download = new Download(nextDownload++, name, mime);
        downloads.add(download);
        // A page yet to run DOWNLOAD_SCRIPT hands over nothing.
        String take = TAKE_DOWNLOAD + "(" + download.id + ", " + JSONObject.quote(url) + ")";
        webView.evaluateJavascript("typeof " + TAKE_DOWNLOAD + " === 'function' && (" + take + ", true)", (taken) -> {
            if (!"true".equals(taken)) notSaved(download, "the page went away");
        });
    }

    // What DOWNLOAD_SCRIPT hands over: a download's id and why the page could not read it, or a frame of its id and its
    // name's length, little-endian, its name and its bytes. Anything else goes unheard.
    private void handedOver(WebMessageCompat message) {
        if (message.getType() != WebMessageCompat.TYPE_ARRAY_BUFFER) {
            String text = String.valueOf(message.getData());
            int bar = text.indexOf('|');
            Download failed = bar < 0 ? null : downloadOf(text.substring(0, bar));
            if (failed != null && failed.frame == null) notSaved(failed, text.substring(bar + 1));
            return;
        }
        byte[] frame = message.getArrayBuffer();
        ByteBuffer read = ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN);
        if (read.remaining() < 8) return;
        Download download = downloadOf(read.getInt());
        int nameLength = read.getInt();
        if (download == null || download.frame != null || nameLength < 0 || nameLength > read.remaining()) return;
        if (nameLength > 0) download.name = new String(frame, 8, nameLength, StandardCharsets.UTF_8);
        download.frame = frame;
        download.offset = 8 + nameLength;
        pickNext();
    }

    private Download downloadOf(int id) {
        for (Download download : downloads) {
            if (download.id == id) return download;
        }
        return null;
    }

    private Download downloadOf(String id) {
        try {
            return downloadOf(Integer.parseInt(id));
        } catch (NumberFormatException none) {
            return null;
        }
    }

    // The save picker for the first download, once the page has handed it over.
    private void pickNext() {
        Download first = downloads.peek();
        if (isPicking || first == null || first.frame == null) return;
        Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(first.mime == null || first.mime.isEmpty() ? "application/octet-stream" : first.mime)
                .putExtra(Intent.EXTRA_TITLE, first.name);
        try {
            startForResult(picker, (result, data) -> save(result == RESULT_OK && data != null ? data.getData() : null));
            isPicking = true;
        } catch (ActivityNotFoundException none) {
            notSaved(first, "nothing on this device saves a file");
        }
    }

    // Writes the first download where its user picked, on a thread of its own, as the ipc thread carries the page's
    // calls; or drops it when they cancelled.
    private void save(Uri place) {
        isPicking = false;
        Download saving = downloads.poll();
        if (saving != null && saving.frame != null && place != null) {
            new Thread(() -> {
                try (OutputStream out = getContentResolver().openOutputStream(place, "wt")) {
                    out.write(saving.frame, saving.offset, saving.frame.length - saving.offset);
                } catch (IOException | RuntimeException error) {
                    runOnUiThread(() -> tellNotSaved(saving.name, error.toString()));
                }
            }).start();
        }
        pickNext();
    }

    private void notSaved(Download download, String reason) {
        if (!downloads.remove(download)) return;
        tellNotSaved(download.name, reason);
        pickNext();
    }

    private void tellNotSaved(String name, String reason) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this).setMessage(name + " was not saved\n\n" + reason).setPositiveButton(android.R.string.ok, null).show();
    }

    // The permissions the app's manifest asks for, which crossbind writes from app.permissions.
    private boolean isDeclared(String permission) {
        if (declared == null) {
            try {
                String[] requested = getPackageManager()
                        .getPackageInfo(getPackageName(), PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS)).requestedPermissions;
                declared = requested == null ? Set.of() : new HashSet<>(Arrays.asList(requested));
            } catch (PackageManager.NameNotFoundException none) {
                declared = Set.of();
            }
        }
        return permission != null && declared.contains(permission);
    }

    private boolean isGranted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    // Asks the app's user for whichever of these permissions it lacks, then runs then, which checks what it was given.
    public void afterAsking(String[] permissions, Runnable then) {
        if (answering != null) {
            waiting.add(() -> afterAsking(permissions, then));
            return;
        }
        String[] missing = Arrays.stream(permissions).filter((permission) -> !isGranted(permission)).toArray(String[]::new);
        if (missing.length == 0) {
            then.run();
            return;
        }
        answering = then;
        requestPermissions(missing, PERMISSIONS_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        Runnable then = answering;
        answering = null;
        if (then != null) then.run();
        while (answering == null && !waiting.isEmpty()) waiting.poll().run();
    }

    // What the picker chose, several files as clip data, and as content URIs alone: a file URI, such as one of this app's
    // own files a picker could name, stays out.
    private static Uri[] pickedFiles(int result, Intent data) {
        if (result != RESULT_OK || data == null) return null;
        List<Uri> picked = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip == null) picked.add(data.getData());
        else for (int i = 0; i < clip.getItemCount(); i += 1) picked.add(clip.getItemAt(i).getUri());
        Uri[] files = picked.stream().filter((uri) -> uri != null && "content".equals(uri.getScheme())).toArray(Uri[]::new);
        return files.length == 0 ? null : files;
    }

    // The callback is taken only while the page has history to go back to, so the system's back animates leaving.
    private void matchBack() {
        boolean canGoBack = webView.canGoBack();
        if (canGoBack == isBackTaken) return;
        OnBackInvokedDispatcher dispatcher = getOnBackInvokedDispatcher();
        if (canGoBack) dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, back);
        else dispatcher.unregisterOnBackInvokedCallback(back);
        isBackTaken = canGoBack;
    }

    @Override
    protected void onDestroy() {
        tellExtensions((extension) -> extension.onDestroy(this));
        if (current == this) current = null;
        if (port != null) close(port);
        if (webView != null) webView.destroy();
        if (ipc != null) ipc.getLooper().quitSafely();
        super.onDestroy();
    }

    // Runs before the page's own scripts in every frame of the app's origins, and in the top frame alone gives the page
    // its token and the port its crossbind.js waits for: the one that comes with the token, which no other frame knows,
    // and with the ask of this page, which a port handed over for the page before cannot carry. The page asks for the
    // port once it waits for it, as a port handed over before would find no one.
    private static String topFrameScript(String token) {
        return "if (window.top === window) {"
                + " const token = '" + token + "';"
                + " const ask = crypto.randomUUID();"
                + " Object.defineProperty(globalThis, '__crossbind_token', { value: token });"
                + " Object.defineProperty(globalThis, '__crossbind_port', { value: new Promise((resolve) => {"
                + "  addEventListener('message', function handshake(event) {"
                + "   if (event.data !== 'crossbind:' + token + ':' + ask || !event.ports[0]) return;"
                + "   removeEventListener('message', handshake);"
                + "   resolve(event.ports[0]);"
                + "  });"
                + "  " + READY + ".postMessage(ask);"
                + " }) });"
                + "}";
    }

    private static String originOf(Uri url) {
        return url.getScheme() + "://" + url.getHost() + (url.getPort() == -1 ? "" : ":" + url.getPort());
    }

    private boolean allows(Uri url) {
        if ("about".equals(url.getScheme())) return true;
        // A blob URL carries the origin of the page that made it.
        if ("blob".equals(url.getScheme())) return allows(Uri.parse(url.getSchemeSpecificPart()));
        return origins.contains(originOf(url));
    }

    // "<id>|m|<message>" or "<id>|r|<query>", or as an ArrayBuffer "<header length><id>|<query>" and the bytes.
    private static void receive(WebMessagePortCompat from, WebMessageCompat message) {
        try {
            if (message.getType() == WebMessageCompat.TYPE_ARRAY_BUFFER) {
                byte[] frame = message.getArrayBuffer();
                int headerLength = (frame[0] & 255) | (frame[1] & 255) << 8 | (frame[2] & 255) << 16 | (frame[3] & 255) << 24;
                String header = new String(frame, 4, headerLength, StandardCharsets.UTF_8);
                int bar = header.indexOf('|');
                nativeFrame(callOf(from, header.substring(0, bar)), header.substring(bar + 1), frame, 4 + headerLength);
                return;
            }
            String data = message.getData();
            int bar = data.indexOf('|');
            int call = callOf(from, data.substring(0, bar));
            String rest = data.substring(bar + 3);
            if (data.charAt(bar + 1) == 'r') nativeResult(call, rest);
            else nativeMessage(call, rest.getBytes(StandardCharsets.UTF_8));
        } catch (RuntimeException malformed) {
            // Only the page's own code could send one in another form, which is no reason to end the app.
            Log.e(TAG, "a message on crossbind's port is in no form it takes", malformed);
        }
    }

    private static int callOf(WebMessagePortCompat port, String id) {
        int call = nextCall.getAndIncrement();
        calls.put(call, new Call(port, Integer.parseInt(id)));
        return call;
    }

    private final class PageClient extends WebViewClient {
        // Only the app's origins load; a link the user follows to another opens in the browser.
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (allows(url)) return false;
            if (request.hasGesture() && Set.of("http", "https", "mailto").contains(url.getScheme())) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException none) {
                    Log.w(TAG, "nothing opens " + url);
                }
            }
            return true;
        }

        // The page's files. Calls and their bytes travel over the port alone, which no other frame holds.
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!"https".equals(url.getScheme()) || !HOST.equals(url.getHost())) return null;
            String path = url.getPath() == null ? "/" : url.getPath();
            if (path.startsWith("/b/")) return response("404 text/plain\n".getBytes(StandardCharsets.US_ASCII));
            String query = url.getEncodedQuery();
            return response(nativeRequest(path.getBytes(StandardCharsets.UTF_8), query == null ? "" : query));
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            matchBack();
        }
    }

    // A new page replaced the one whose objects the module holds, and gets a port of its own: the old page's port is
    // closed, so an answer to a call it made goes nowhere.
    private void handOverPort(Uri origin, String ask) {
        if (port != null) close(port);
        nativeNewPage();
        // What the last page had yet to hand over went with it.
        for (Download pending : new ArrayList<>(downloads)) {
            if (pending.frame == null) notSaved(pending, "the page went away");
        }
        WebMessagePortCompat[] channel = WebViewCompat.createWebMessageChannel(webView);
        port = channel[0];
        port.setWebMessageCallback(ipc, new WebMessagePortCompat.WebMessageCallbackCompat() {
            @Override
            public void onMessage(WebMessagePortCompat from, WebMessageCompat message) {
                receive(from, message);
            }
        });
        WebViewCompat.postWebMessage(webView, new WebMessageCompat("crossbind:" + token + ":" + ask, new WebMessagePortCompat[] {channel[1]}),
                origin);
    }

    // Without a WebChromeClient the WebView shows no alert(), confirm() or prompt(), and no picker for a file input.
    private final class PageChrome extends WebChromeClient {
        private final boolean isConsoleShown;

        PageChrome(boolean isConsoleShown) {
            this.isConsoleShown = isConsoleShown;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            if (!isConsoleShown) return true;
            int priority = switch (message.messageLevel()) {
                case ERROR -> Log.ERROR;
                case WARNING -> Log.WARN;
                default -> Log.INFO;
            };
            Log.println(priority, TAG, message.message());
            return true;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> files, FileChooserParams params) {
            Intent intent = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startForResult(intent, (result, data) -> {
                    if (pendingFiles != files) return;
                    files.onReceiveValue(pickedFiles(result, data));
                    pendingFiles = null;
                });
            } catch (ActivityNotFoundException none) {
                Log.w(TAG, "nothing on this device picks a file");
                return false;
            }
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = files;
            return true;
        }

        // The page gets the camera and microphone the manifest asks for, once the app's user gives them; the WebView asks
        // nothing of its own. A frame of another origin, which Android lets the page hold, gets none.
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            String[] resources = request.getResources();
            String[] permissions = Arrays.stream(resources).map(PAGE_DEVICES::get).toArray(String[]::new);
            if (!origins.contains(originOf(request.getOrigin())) || !Arrays.stream(permissions).allMatch(CrossbindActivity.this::isDeclared)) {
                request.deny();
                return;
            }
            afterAsking(permissions, () -> {
                if (Arrays.stream(permissions).allMatch(CrossbindActivity.this::isGranted)) {
                    request.grant(resources);
                } else {
                    request.deny();
                }
            });
        }

        // The page gets the location the manifest asks for, the approximate one at least, which its user may give alone.
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!origins.contains(originOf(Uri.parse(origin))) || !isDeclared(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                callback.invoke(origin, false, false);
                return;
            }
            // Asked for the precise location again, a user who gave the approximate one is asked to change it.
            if (isGranted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                callback.invoke(origin, true, false);
                return;
            }
            afterAsking(new String[] {Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION},
                    () -> callback.invoke(origin, isGranted(Manifest.permission.ACCESS_COARSE_LOCATION), false));
        }
    }

    private static WebResourceResponse response(byte[] answer) {
        int newline = 0;
        while (answer[newline] != '\n') newline += 1;
        String[] head = new String(answer, 0, newline, StandardCharsets.US_ASCII).split(" ", 2);
        int status = Integer.parseInt(head[0]);
        String mime = head[1].split(";", 2)[0];
        InputStream body = new ByteArrayInputStream(answer, newline + 1, answer.length - newline - 1);
        return new WebResourceResponse(mime, "utf-8", status, status == 200 ? "OK" : "Not Found", new HashMap<>(), body);
    }

    // The module reads the app's files from disk, so they are copied out of the APK once per install, where no backup
    // takes them.
    private File installFiles() {
        File dir = new File(getNoBackupFilesDir(), "app");
        File stamp = new File(dir, ".installed");
        try {
            String install = String.valueOf(getPackageManager()
                    .getPackageInfo(getPackageName(), PackageManager.PackageInfoFlags.of(0)).lastUpdateTime);
            if (stamp.exists() && install.equals(new String(Files.readAllBytes(stamp.toPath()), StandardCharsets.UTF_8))) return dir;
            delete(dir);
            copyAssets("app", dir);
            Files.write(stamp.toPath(), install.getBytes(StandardCharsets.UTF_8));
            return dir;
        } catch (IOException | PackageManager.NameNotFoundException error) {
            throw new IllegalStateException("crossbind: cannot install the app's files: " + error.getMessage(), error);
        }
    }

    private void copyAssets(String path, File to) throws IOException {
        String[] names = getAssets().list(path);
        if (names == null || names.length == 0) {
            to.getParentFile().mkdirs();
            try (InputStream in = getAssets().open(path)) {
                Files.copy(in, to.toPath());
            }
            return;
        }
        for (String name : names) copyAssets(path + "/" + name, new File(to, name));
    }

    private static void delete(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        file.delete();
    }
}

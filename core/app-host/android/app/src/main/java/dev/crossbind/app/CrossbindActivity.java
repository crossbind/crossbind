package dev.crossbind.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.HttpAuthHandler;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.MimeTypeMap;
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
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.json.JSONException;
import org.json.JSONObject;

// An app's one activity: its page in a WebView, its module in Hermes behind JNI (libcrossbind_app.so). The page comes
// from an https origin the activity serves from the app's files, or in a debug app from a dev server; calls and their
// bytes travel over a message port that the page's top frame alone gets.
public class CrossbindActivity extends Activity implements ExtensionHost {
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
    // The shorter side a tablet's screen has at least, as Android's own sw600dp resources take it.
    private static final int TABLET_WIDTH_DP = 600;
    private static final int PERMISSIONS_REQUEST = 1;
    // Where the native code's calls of an extension's Java run, and the page's requests are answered.
    static final Handler MAIN = new Handler(Looper.getMainLooper());
    // Where the files the system opens the app with are copied, one at a time, away from the UI and the page's calls.
    private static final ExecutorService COPIES = Executors.newSingleThreadExecutor();
    // Whether the process has had COPIES remove the copies of the process before, ahead of its own, on the main thread.
    private static boolean isOpenedCleared = false;
    // A copy's name, as Android's file systems take it: 255 bytes at most, which keep an extension of 16 characters.
    private static final int MAX_NAME_BYTES = 255;
    private static final int MAX_ENDING = 16;
    // What a page asks for, by the names page-permissions takes, and the Android permission behind each device.
    private static final Map<String, String> PAGE_KINDS = Map.of(
            PermissionRequest.RESOURCE_VIDEO_CAPTURE, "camera",
            PermissionRequest.RESOURCE_AUDIO_CAPTURE, "microphone",
            PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID, "media-keys",
            PermissionRequest.RESOURCE_MIDI_SYSEX, "midi");

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
    // nativeNavigation()'s answers, in the order of the host's NavigationAnswer.
    private static final int LOAD = 0;
    private static final int OUTSIDE = 1;
    // The authentications page-navigation has yet to answer, by their ids.
    private static final Map<Integer, HttpAuthHandler> authentications = new ConcurrentHashMap<>();
    private static final AtomicInteger nextAuthentication = new AtomicInteger();
    // answerDownload()'s answers, in the order of the host's DownloadAnswer.
    private static final int SAVE_TO = 0;
    private static final int ASK = 1;
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
    private Extension.FileInput pendingFiles;
    // What waits for the answer the app's user is giving for permissions, and what waits to ask: Android asks one question
    // at a time, and answers one asked meanwhile with nothing.
    private Runnable answering;
    private final ArrayDeque<Runnable> waiting = new ArrayDeque<>();
    private Set<String> listed;
    // Back walks the page's history first, as in a browser; with none left, the system's own back leaves the app.
    private final OnBackInvokedCallback back = () -> webView.goBack();
    private boolean isBackTaken;
    // The downloads the page started, in turn: page-downloads hears of each once the page has handed it over, and the
    // save picker, which shows one at a time, takes those ask() saves. Their ids are the process's, as the host keeps
    // each one's owner by its id.
    private final ArrayDeque<Download> downloads = new ArrayDeque<>();
    private static final AtomicInteger nextDownload = new AtomicInteger();
    // The download whose save picker is open.
    private Download picking;

    private static final class Download {
        final int id;
        final String url;
        final String mime;
        String name;
        // What the page handed over, with the download's bytes from offset on; null until it has.
        byte[] frame;
        int offset;
        // Whether ask() saves it, through the picker, and whether a cancel() after that stops it.
        boolean isAsked;
        boolean isStopped;

        Download(int id, String url, String name, String mime) {
            this.id = id;
            this.url = url;
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

    // A request of the page's for a file of its own or an extension's URL: the path and the query as the URL has them, and
    // each header's name and value in UTF-8, one after the other. The answer is what responseOf() makes.
    private static native WebResourceResponse nativeRequest(String method, String path, String query, byte[][] headers);

    private static native void nativeNewPage();

    // A link of app.urlSchemes the system opened the app with, in UTF-8.
    private static native void nativeOpenUrl(byte[] url);

    // A tap of a quick action of app.shortcutItems, by its type in UTF-8.
    private static native void nativeShortcutItem(byte[] type);

    // The activity came to the foreground, or left it, which the app's extensions and its page hear of.
    private static native void nativeActive(boolean isActive);

    // Files the system opened the app with, by their copies' paths in UTF-8, with the MIME type each came with, empty for
    // none, which names its owner before its name does.
    private static native void nativeOpenFiles(byte[][] paths, byte[][] mimeTypes);

    // A navigation beyond the app's origins, which the extension page-navigation decides on the UI thread, in UTF-8:
    // LOAD loads it, OUTSIDE opens it in the browser or the mail app, and any other answer refuses it.
    private static native int nativeNavigation(byte[] url, boolean isMainFrame, boolean isUserInitiated);

    // A server's ask for a name and password, in UTF-8, which page-navigation answers through answerHttpAuthentication()
    // under the same id.
    private static native void nativeHttpAuthentication(int id, byte[] host, byte[] realm);

    // A download the page handed over, which the extension page-downloads answers through answerDownload() under the same
    // id: its address, name and MIME type in UTF-8, and its size.
    private static native void nativeDownload(int id, byte[] url, byte[] name, byte[] mime, long size);

    // How a download page-downloads heard of ended, on the UI thread: why it was not saved, or null, and the path or
    // content: URI it was saved at, in UTF-8.
    private static native void nativeDownloadFinished(int id, boolean isCancelled, byte[] failure, byte[] path);

    // The answer of an extension's Java to its native code: the result's JSON and its bytes, or why the call failed, in
    // UTF-8.
    static native void nativeExtensionAnswered(int call, boolean ok, byte[] text, byte[][] bytes);

    // A message of an extension's Java for the page of its call: its JSON and its bytes.
    static native void nativeExtensionMessage(int call, byte[] text, byte[][] bytes);

    // A call of an extension's Java by its native code, from whichever thread makes it: the extension's name, the
    // function's and its options' JSON, in UTF-8, and the options' bytes.
    static void callExtension(int id, byte[] extensionName, byte[] functionName, byte[] optionsJson, byte[][] bytes) {
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
                    to.call(activity, function, Extension.Call.optionsOf(options, bytes), call);
                } catch (JSONException | RuntimeException error) {
                    Log.e(TAG, called + " failed", error);
                    call.reject("crossbind: " + called + " failed: " + error);
                }
            }
        });
    }

    // The page cancelled a call of an extension's Java, or went away, after the call itself reached the UI thread.
    static void cancelExtension(int id) {
        MAIN.post(() -> Extension.Call.cancel(id));
    }

    // page-navigation's answer to an authentication, from whichever thread gives it: a name and a password, or neither for
    // a cancel.
    static void answerHttpAuthentication(int id, byte[] user, byte[] password) {
        HttpAuthHandler handler = authentications.remove(id);
        if (handler == null) return;
        MAIN.post(() -> {
            if (user == null) {
                handler.cancel();
            } else {
                handler.proceed(new String(user, StandardCharsets.UTF_8), new String(password, StandardCharsets.UTF_8));
            }
        });
    }

    // page-downloads' answer to a download, from whichever thread gives it: SAVE_TO with a path, ASK, or any other for a
    // cancel.
    static void answerDownload(int id, int kind, byte[] path) {
        MAIN.post(() -> {
            CrossbindActivity activity = current;
            if (activity != null) {
                activity.answered(id, kind, path == null ? "" : new String(path, StandardCharsets.UTF_8));
            } else {
                nativeDownloadFinished(id, false, "the app's activity went away".getBytes(StandardCharsets.UTF_8), new byte[0]);
            }
        });
    }

    // A cancel() of page-downloads' after its answer, from whichever thread gives it.
    static void stopDownload(int id) {
        MAIN.post(() -> {
            CrossbindActivity activity = current;
            if (activity != null) activity.stopped(id);
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
        WebViewCompat.addDocumentStartJavaScript(webView, topFrameScript(token, deviceJson()), origins);
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
        // A link that launched the activity waits for the page to ask for it. The module may have outlived an activity
        // before this one, whose page it forgets first; an activity the system restores, or Recents reopens, brings its
        // old link, which the page had.
        nativeNewPage();
        if (!isOpenedCleared) {
            isOpenedCleared = true;
            File opened = new File(getCacheDir(), "opened");
            COPIES.execute(() -> deleteTree(opened));
        }
        if (state == null && (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) {
            openUrlOf(getIntent());
            shortcutOf(getIntent());
        }
        tellExtensions((extension) -> extension.onCreate(this));
        webView.loadUrl(devUrl.isEmpty() ? APP_ORIGIN + "/" : devUrl);
    }

    // A link or a quick action's tap that opens the app while it runs comes here, as an app with app.urlSchemes or
    // app.shortcutItems keeps the activity its task's one, which keeps the page.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openUrlOf(intent);
        shortcutOf(intent);
        tellExtensions((extension) -> extension.onNewIntent(this, intent));
    }

    // A tap the app's trampoline handed over, as any app may start the activity.
    private void shortcutOf(Intent intent) {
        if (token == null) return;
        String type = CrossbindShortcutActivity.tapOf(intent);
        if (type != null) nativeShortcutItem(type.getBytes(StandardCharsets.UTF_8));
    }

    private void openUrlOf(Intent intent) {
        // An activity that could not start the module, for want of a WebView, takes no link.
        if (token == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        // Any app may start the activity with any link or file: the app hears of those its intent filters match alone,
        // the links of its schemes and sites and the files of its types, which come as content: addresses.
        Uri data = intent.getData();
        String type = intent.resolveType(this);
        Intent own = new Intent(Intent.ACTION_VIEW).setDataAndType(data, type).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(getPackageName());
        if (getPackageManager().queryIntentActivities(own, 0).isEmpty()) return;
        if (!"content".equals(data.getScheme())) nativeOpenUrl(data.toString().getBytes(StandardCharsets.UTF_8));
        else if (isOthersContent(data)) copyOpened(data, type == null ? "" : type);
    }

    // Whether other apps may read what a content: address names: it names no file of a provider of the app's own that
    // they cannot, which the app would copy for whichever app opened it.
    private boolean isOthersContent(Uri uri) {
        ProviderInfo provider = getPackageManager().resolveContentProvider(String.valueOf(uri.getAuthority()), 0);
        if (provider == null || !getPackageName().equals(provider.packageName) || (provider.exported && provider.readPermission == null)) return true;
        Log.w(TAG, "crossbind: the app was opened on a file of a provider of its own that other apps cannot read, " + uri);
        return false;
    }

    // A file the system opened the app with, which native code opens by a path alone: a copy in the app's cache, in a
    // folder of its own, of the name the file had. The app's next process empties the folder.
    private void copyOpened(Uri uri, String mimeType) {
        COPIES.execute(() -> {
            File folder = new File(new File(getCacheDir(), "opened"), Long.toString(System.nanoTime()));
            File copy = new File(folder, openedName(uri));
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IOException("its provider gives no stream");
                if (!folder.mkdirs()) throw new IOException("cannot make " + folder);
                Files.copy(in, copy.toPath());
            } catch (IOException | RuntimeException error) {
                Log.e(TAG, "crossbind: the app cannot copy the file it was opened with, " + uri, error);
                // A copy cut short is no file the app was opened with.
                deleteTree(folder);
                return;
            }
            // Its owner gets it on the UI thread, as every hook of what the system hands the app.
            runOnUiThread(() -> nativeOpenFiles(new byte[][] {copy.getPath().getBytes(StandardCharsets.UTF_8)},
                    new byte[][] {mimeType.getBytes(StandardCharsets.UTF_8)}));
        });
    }

    // The name of a file, as its provider shows it, made one a folder takes: without a slash, neither . nor .., and cut
    // to fit before its extension.
    private String openedName(Uri uri) {
        String name = null;
        try (Cursor cursor = getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        } catch (RuntimeException error) {
            Log.w(TAG, "crossbind: the provider of " + uri + " gives no name", error);
        }
        if (name == null) name = uri.getLastPathSegment();
        name = name == null ? "" : name.replace('/', '_').replace('\0', '_');
        if (name.isEmpty() || name.equals(".") || name.equals("..")) return "file";
        int dot = name.lastIndexOf('.');
        String ending = dot > 0 && name.length() - dot <= MAX_ENDING ? name.substring(dot) : "";
        String stem = name.substring(0, name.length() - ending.length());
        while (!stem.isEmpty() && (stem + ending).getBytes(StandardCharsets.UTF_8).length > MAX_NAME_BYTES) {
            stem = stem.substring(0, stem.offsetByCodePoints(stem.length(), -1));
        }
        return stem + ending;
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        if (file.exists() && !file.delete()) Log.w(TAG, "crossbind: cannot delete " + file);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (token != null) nativeActive(true);
        tellExtensions((extension) -> extension.onResume(this));
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (token != null) nativeActive(false);
        tellExtensions((extension) -> extension.onPause(this));
    }

    // The Java of each extension hears what the activity does, once the activity has started the module; what one throws
    // is logged, and the others hear of it as well.
    private void tellExtensions(Consumer<Extension> tell) {
        if (token == null) return;
        Extensions.ALL.forEach((name, extension) -> {
            try {
                tell.accept(extension);
            } catch (RuntimeException error) {
                Log.e(TAG, "crossbind: the extension " + name + " failed as the activity changed", error);
            }
        });
    }

    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        // The activity outlives the system's switch between light and dark, so it shows the switched-to color of
        // app.window.backgroundColor itself.
        int background = getColor(R.color.crossbind_background);
        if (Color.alpha(background) != 0) {
            getWindow().setBackgroundDrawable(new ColorDrawable(background));
            if (webView != null) webView.setBackgroundColor(background);
        }
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

    @Override
    public Activity activity() {
        return this;
    }

    @Override
    public WebView webView() {
        return webView;
    }

    @Override
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

    // A download the page starts: the page hands over its name and bytes, as only the page knows them, and the extension
    // page-downloads then answers it. A download that is no link of the page's is named after its address.
    private void download(String url, String name, String mime) {
        Download download = new Download(nextDownload.getAndIncrement(), url, name, mime);
        downloads.add(download);
        // A page yet to run DOWNLOAD_SCRIPT, as one of another origin, hands over nothing.
        String take = TAKE_DOWNLOAD + "(" + download.id + ", " + JSONObject.quote(url) + ")";
        webView.evaluateJavascript("typeof " + TAKE_DOWNLOAD + " === 'function' && (" + take + ", true)", (taken) -> {
            if (!"true".equals(taken)) notSaved(download, "the page did not hand it over");
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
        nativeDownload(download.id, download.url.getBytes(StandardCharsets.UTF_8), download.name.getBytes(StandardCharsets.UTF_8),
                (download.mime == null ? "" : download.mime).getBytes(StandardCharsets.UTF_8), frame.length - download.offset);
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

    // page-downloads' answer, on the UI thread.
    private void answered(int id, int kind, String path) {
        Download download = downloadOf(id);
        if (download == null) {
            nativeDownloadFinished(id, false, "the page went away".getBytes(StandardCharsets.UTF_8), new byte[0]);
        } else if (kind == ASK) {
            download.isAsked = true;
            pickNext();
        } else {
            downloads.remove(download);
            if (kind == SAVE_TO) {
                saveTo(download, path);
            } else {
                cancelled(download);
            }
        }
    }

    // A cancel() after the answer: the open picker's download saves nothing, and one that waits for it goes.
    private void stopped(int id) {
        if (picking != null && picking.id == id) {
            picking.isStopped = true;
            return;
        }
        Download download = downloadOf(id);
        if (download != null && download.isAsked && downloads.remove(download)) cancelled(download);
    }

    // The type a save picker takes for a download: that of its name's extension, or none Android knows, as the picker
    // gives a name the extension of its type where the two differ, as polygon.csv.txt for the text/plain WebView guesses
    // from a CSV's bytes. A name without an extension takes the type WebView gave.
    private static String typeOf(Download download) {
        int dot = download.name.lastIndexOf('.');
        String byName = dot > 0 ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(download.name.substring(dot + 1).toLowerCase(Locale.ROOT)) : null;
        if (byName != null) return byName;
        boolean isTyped = dot <= 0 && download.mime != null && !download.mime.isEmpty();
        return isTyped ? download.mime : "application/octet-stream";
    }

    // The save picker for the first download ask() saves.
    private void pickNext() {
        if (picking != null) return;
        Download first = downloads.stream().filter((waiting) -> waiting.isAsked).findFirst().orElse(null);
        if (first == null) return;
        Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(typeOf(first))
                .putExtra(Intent.EXTRA_TITLE, first.name);
        try {
            startForResult(picker, (result, data) -> save(result == RESULT_OK && data != null ? data.getData() : null));
            picking = first;
        } catch (ActivityNotFoundException none) {
            notSaved(first, "nothing on this device saves a file");
        }
    }

    // Writes the download its user picked a place for, on a thread of its own, as the ipc thread carries the page's
    // calls; or drops it when they cancelled.
    private void save(Uri place) {
        Download saving = picking;
        picking = null;
        if (saving != null && downloads.remove(saving)) {
            if (place == null || saving.isStopped) {
                cancelled(saving);
            } else {
                // Saved once the stream has closed, which a provider may write on.
                new Thread(() -> {
                    try (OutputStream out = getContentResolver().openOutputStream(place, "wt")) {
                        out.write(saving.frame, saving.offset, saving.frame.length - saving.offset);
                    } catch (IOException | RuntimeException error) {
                        runOnUiThread(() -> {
                            tellNotSaved(saving.name, error.toString());
                            finished(saving, error.toString(), "");
                        });
                        return;
                    }
                    runOnUiThread(() -> finished(saving, null, place.toString()));
                }).start();
            }
        }
        pickNext();
    }

    // Writes a download where saveTo() names, beside it first, so a write that fails leaves the file it was to replace
    // as it was.
    private void saveTo(Download saving, String path) {
        new Thread(() -> {
            File target = new File(path);
            File arrival = new File(target.getParentFile(), "." + target.getName() + "." + saving.id + ".download");
            try {
                // A folder there stays, as the move would put the file in an empty one's place.
                if (target.isDirectory()) throw new IOException("a folder is at " + path);
                try (OutputStream out = new FileOutputStream(arrival)) {
                    out.write(saving.frame, saving.offset, saving.frame.length - saving.offset);
                }
                Files.move(arrival.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                runOnUiThread(() -> finished(saving, null, path));
            } catch (IOException | RuntimeException error) {
                if (arrival.exists() && !arrival.delete()) Log.w(TAG, "could not remove " + arrival);
                runOnUiThread(() -> finished(saving, error.toString(), ""));
            }
        }).start();
    }

    private static void finished(Download download, String failure, String path) {
        nativeDownloadFinished(download.id, false, failure == null ? null : failure.getBytes(StandardCharsets.UTF_8), path.getBytes(StandardCharsets.UTF_8));
    }

    private static void cancelled(Download download) {
        nativeDownloadFinished(download.id, true, null, new byte[0]);
    }

    // A download the page could not hand over, which page-downloads never heard of, or one ask() saves that cannot be.
    private void notSaved(Download download, String reason) {
        if (!downloads.remove(download)) return;
        tellNotSaved(download.name, reason);
        if (download.frame != null) finished(download, reason, "");
        pickNext();
    }

    private void tellNotSaved(String name, String reason) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this).setMessage(name + " was not saved\n\n" + reason).setPositiveButton(android.R.string.ok, null).show();
    }

    // Whether app.permissions lists the device, as the Gradle project's crossbind_permissions holds them: the
    // manifest asks Android for its extensions' permissions as well, which are their Java's alone.
    private boolean isListed(String kind) {
        if (listed == null) listed = Set.of(getResources().getStringArray(R.array.crossbind_permissions));
        return listed.contains(kind);
    }

    private boolean isGranted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
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
        // A download page-downloads heard of that waits for its picker, or its answer, ends with the activity.
        for (Download pending : downloads) {
            if (pending.frame != null) finished(pending, "the app's activity went away", "");
        }
        downloads.clear();
        picking = null;
        if (current == this) current = null;
        if (port != null) close(port);
        if (webView != null) webView.destroy();
        if (ipc != null) ipc.getLooper().quitSafely();
        super.onDestroy();
    }

    // Runs before the page's own scripts in every frame of the app's origins, and in the top frame alone gives the page
    // its token, where the app runs and the port its crossbind.js waits for: the one that comes with the token, which no
    // other frame knows, and with the ask of this page, which a port handed over for the page before cannot carry. The
    // page asks for the port once it waits for it, as a port handed over before would find no one.
    private static String topFrameScript(String token, String device) {
        return "if (window.top === window) {"
                + " const token = '" + token + "';"
                + " const ask = crypto.randomUUID();"
                + " Object.defineProperty(globalThis, '__crossbind_token', { value: token });"
                + " Object.defineProperty(globalThis, '__crossbind_device', { value: ((device) => (Object.freeze(device.os), Object.freeze(device)))("
                + device + ") });"
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

    // Where the app runs, as crossbind/app's device reads it from the page's start: a ChromeOS device a desktop, and one
    // whose screen's shorter side has TABLET_WIDTH_DP a tablet, as the activity starts.
    private String deviceJson() {
        String arch = System.getProperty("os.arch", "");
        boolean isDesktop = getPackageManager().hasSystemFeature(PackageManager.FEATURE_PC);
        boolean isTablet = getResources().getConfiguration().smallestScreenWidthDp >= TABLET_WIDTH_DP;
        try {
            JSONObject os = new JSONObject().put("name", "Android").put("version", Build.VERSION.RELEASE).put("apiLevel", Build.VERSION.SDK_INT);
            return new JSONObject()
                    .put("platform", "android")
                    .put("arch", "aarch64".equals(arch) ? "arm64" : "x86_64".equals(arch) ? "x64" : arch)
                    .put("formFactor", isDesktop ? "desktop" : isTablet ? "tablet" : "phone")
                    .put("os", os)
                    .put("isVirtual", Build.HARDWARE.equals("ranchu") || Build.HARDWARE.equals("goldfish"))
                    .toString();
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
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
        // The app's origins load without asking; the extension page-navigation decides every other URL. A page of
        // another origin gets no token, so it reaches none of the app's functions.
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (allows(url)) return false;
            int answer = nativeNavigation(url.toString().getBytes(StandardCharsets.UTF_8), request.isForMainFrame(), request.hasGesture());
            if (answer == LOAD) return false;
            if (answer == OUTSIDE) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException none) {
                    Log.w(TAG, "nothing opens " + url);
                }
            }
            return true;
        }

        // A server's ask for a name and password, which page-navigation answers; a cancel goes on without them, so the
        // page gets what the server answers to that. A certificate the system does not trust the WebView refuses
        // without asking, as Android asks of an app.
        @Override
        public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
            int id = nextAuthentication.getAndIncrement();
            authentications.put(id, handler);
            nativeHttpAuthentication(id, (host == null ? "" : host).getBytes(StandardCharsets.UTF_8),
                    (realm == null ? "" : realm).getBytes(StandardCharsets.UTF_8));
        }

        // The page's files and its extensions' URLs. Calls and their bytes travel over the port alone, which no other frame
        // holds. Android's WebView gives no request's body.
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!"https".equals(url.getScheme()) || !HOST.equals(url.getHost())) return null;
            String path = url.getEncodedPath() == null ? "/" : url.getEncodedPath();
            // The host decodes the path, as Uri does here.
            if (url.getPath() != null && url.getPath().startsWith("/b/")) return responseOf(404, "text/plain", new byte[0][], new byte[0], null, null);
            String query = url.getEncodedQuery();
            List<byte[]> headers = new ArrayList<>();
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                headers.add(header.getKey().getBytes(StandardCharsets.UTF_8));
                headers.add(header.getValue().getBytes(StandardCharsets.UTF_8));
            }
            return nativeRequest(request.getMethod(), path, query == null ? "" : query, headers.toArray(new byte[0][]));
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

    // The page's dialogs, what it asks to use and its file inputs go to the Java of the extensions of their names,
    // page-dialogs, page-permissions and page-files; without one, the WebView does as it would. A frame of another
    // origin, which Android lets the page hold, gets no dialog and nothing it asks to use, as both would show under the
    // app's name, and a page that leaves does so without asking, as WKWebView's does.
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
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            return pageDialog(url, Extension.PageDialog.Kind.ALERT, message, "", result);
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            return pageDialog(url, Extension.PageDialog.Kind.CONFIRM, message, "", result);
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
            return pageDialog(url, Extension.PageDialog.Kind.PROMPT, message, defaultValue == null ? "" : defaultValue, result);
        }

        @Override
        public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
            result.confirm();
            return true;
        }

        private boolean pageDialog(String url, Extension.PageDialog.Kind kind, String message, String defaultText, JsResult result) {
            if (url == null || !allows(Uri.parse(url))) {
                result.cancel();
                return true;
            }
            Extension owner = Extensions.ROLES.get("page-dialogs");
            if (owner == null) return false;
            Extension.PageDialog dialog = new Extension.PageDialog(kind, message == null ? "" : message, defaultText, result);
            ask("page-dialogs", () -> owner.onPageDialog(CrossbindActivity.this, dialog), dialog::cancel);
            return !dialog.isLeft();
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> files, FileChooserParams params) {
            Extension owner = Extensions.ROLES.get("page-files");
            if (owner == null) return false;
            Extension.FileInput input = new Extension.FileInput(params, files);
            ask("page-files", () -> owner.onFileInput(CrossbindActivity.this, input), input::cancel);
            if (input.isLeft()) return false;
            if (pendingFiles != null) pendingFiles.cancel();
            pendingFiles = input;
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            String origin = originOf(request.getOrigin());
            List<String> kinds = Arrays.stream(request.getResources())
                    .map((resource) -> PAGE_KINDS.getOrDefault(resource, "unknown")).collect(Collectors.toList());
            askPermission(kinds, origin, (isAllowed) -> {
                if (isAllowed) request.grant(request.getResources());
                else request.deny();
            });
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            askPermission(List.of("location"), originOf(Uri.parse(origin)), (isAllowed) -> callback.invoke(origin, isAllowed, false));
        }

        private void askPermission(List<String> kinds, String origin, Consumer<Boolean> answer) {
            Extension owner = Extensions.ROLES.get("page-permissions");
            boolean isListed = kinds.stream().allMatch((kind) -> isListed(kind));
            Extension.PagePermission request = new Extension.PagePermission(kinds, origin, isListed, answer);
            if (!origins.contains(origin) || owner == null) {
                request.deny();
                return;
            }
            ask("page-permissions", () -> owner.onPagePermission(CrossbindActivity.this, request), request::deny);
        }

        // What the owner throws cancels the request, as in an extension's C++.
        private void ask(String role, Runnable hook, Runnable cancel) {
            try {
                hook.run();
            } catch (RuntimeException error) {
                Log.e(TAG, "crossbind: the holder of " + role + " failed on the page's request", error);
                cancel.run();
            }
        }
    }

    // The host's answer to a request: its headers' names and values in UTF-8, one after the other, and the body, or the
    // file, by its path in UTF-8, whose content is the body in its place, which the WebView reads as it takes it; range
    // is the request's Range header, or null.
    static WebResourceResponse responseOf(int status, String mime, byte[][] headers, byte[] body, byte[] file, byte[] range) {
        Map<String, String> fields = new HashMap<>();
        for (int i = 0; i + 1 < headers.length; i += 2) {
            fields.put(new String(headers[i], StandardCharsets.UTF_8), new String(headers[i + 1], StandardCharsets.UTF_8));
        }
        InputStream data = new ByteArrayInputStream(body);
        long length = body.length;
        if (file != null) {
            String path = new String(file, StandardCharsets.UTF_8);
            try {
                data = new FileInputStream(path);
                length = new File(path).length();
            } catch (FileNotFoundException gone) {
                byte[] missing = "crossbind: the file went away before it was read".getBytes(StandardCharsets.UTF_8);
                return responseOf(404, "text/plain; charset=utf-8", new byte[0][], missing, null, range);
            }
        }
        // The WebView measures a stream by its available(), which a FileInputStream gives of the file in an int.
        data = range == null ? new RangedStream(data, 0, length) : forRange(data, length, new String(range, StandardCharsets.UTF_8), status);
        String[] type = mime.split(";", 2);
        String charset = type.length > 1 && type[1].trim().startsWith("charset=") ? type[1].trim().substring("charset=".length()) : null;
        return new WebResourceResponse(type[0].trim(), charset, status, reasonOf(status), fields, data);
    }

    private static final Pattern SINGLE_RANGE = Pattern.compile("^\\s*bytes\\s*=\\s*(\\d*)\\s*-\\s*(\\d*)\\s*$");

    // The WebView takes a request's one Range to any stream that answers it, as a server would to its whole body: it
    // skips the stream to the range's first byte, takes the range's length for the body's and reads on to the stream's
    // end. A 206 of the host's, a failure and a body that ends before the range starts are the answer itself, so their
    // stream starts with that many bytes of nothing, which the WebView skips; another's ends where the range does. The
    // last n bytes the WebView finds itself. It measures in an int, so a file of 2 GiB or more fails it.
    private static InputStream forRange(InputStream body, long length, String range, int status) {
        Matcher match = SINGLE_RANGE.matcher(range);
        if (!match.matches() || match.group(1).isEmpty()) return new RangedStream(body, 0, length);
        try {
            long first = Long.parseLong(match.group(1));
            long end = Math.min(match.group(2).isEmpty() ? Long.MAX_VALUE : Long.parseLong(match.group(2)), Long.MAX_VALUE - 1);
            if (end < first) return new RangedStream(body, 0, length);
            boolean isAnswer = status == 206 || status >= 400 || length <= first;
            return new RangedStream(body, isAnswer ? first : 0, isAnswer ? Math.min(length, end - first + 1) : Math.min(length, end + 1));
        } catch (NumberFormatException tooLarge) {
            return new RangedStream(body, 0, length);
        }
    }

    // A body after so many bytes of nothing, which a skip passes, up to a length.
    private static final class RangedStream extends InputStream {
        private final InputStream body;
        private long nothing;
        private long left;

        RangedStream(InputStream body, long nothing, long left) {
            this.body = body;
            this.nothing = nothing;
            this.left = left;
        }

        // An empty body has nothing for the WebView to measure a range against.
        @Override
        public int available() {
            if (left == 0) return 0;
            return (int) Math.min(Integer.MAX_VALUE, nothing + left);
        }

        @Override
        public long skip(long count) throws IOException {
            long skipped = Math.min(count, nothing);
            nothing -= skipped;
            if (skipped < count && nothing == 0 && left > 0) {
                long more = body.skip(Math.min(count - skipped, left));
                left -= more;
                skipped += more;
            }
            return skipped;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            return read(one, 0, 1) == 1 ? one[0] & 255 : -1;
        }

        @Override
        public int read(byte[] into, int offset, int count) throws IOException {
            if (nothing > 0) {
                int zeros = (int) Math.min(count, nothing);
                Arrays.fill(into, offset, offset + zeros, (byte) 0);
                nothing -= zeros;
                return zeros;
            }
            if (left == 0) return -1;
            int read = body.read(into, offset, (int) Math.min(count, left));
            if (read > 0) left -= read;
            return read;
        }

        @Override
        public void close() throws IOException {
            body.close();
        }
    }

    // WebResourceResponse takes no empty reason.
    private static String reasonOf(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 206: return "Partial Content";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 416: return "Range Not Satisfiable";
            case 500: return "Internal Server Error";
            default: return status < 400 ? "OK" : "Error";
        }
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

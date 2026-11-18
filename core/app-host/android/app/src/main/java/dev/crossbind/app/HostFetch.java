package dev.crossbind.app;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// The native fetch() on Android: HttpURLConnection, under the app's network security config, on a thread of its own for
// each fetch, without cookies, a cache or credentials, which follows a redirect within the URL's origin itself. The
// answer goes to native code as it arrives, which keeps its limits.
final class HostFetch {
    private static final int CHUNK_BYTES = 1 << 20;
    // nativeEnd()'s reasons, as the host names them.
    private static final int DONE = 0;
    private static final int FAILED = 1;
    private static final int TIMED_OUT = 2;
    private static final int REDIRECTED_TOO_OFTEN = 3;
    private static final ExecutorService FETCHES = Executors.newCachedThreadPool();

    private HostFetch() {}

    // The answer's status, the length it declares or -1, and its headers' names and values in UTF-8, one after the other:
    // false stops the fetch, which native code ended.
    private static native boolean nativeResponse(int id, int status, long declared, byte[][] headers);

    // The next bytes of the answer's body: false stops the fetch, which native code ended.
    private static native boolean nativeData(int id, byte[] bytes, int length);

    // How the fetch ended: DONE, or why not, with the system's words in UTF-8 for FAILED.
    private static native void nativeEnd(int id, int reason, byte[] failure);

    // A fetch of native code's, from whichever thread asks: the method, URL and headers' names and values in UTF-8, and
    // its limits.
    static void fetch(int id, byte[] method, byte[] url, byte[][] headers, int seconds, int maxRedirects) {
        FETCHES.execute(() -> run(id, new String(method, StandardCharsets.UTF_8), new String(url, StandardCharsets.UTF_8), headers, seconds, maxRedirects));
    }

    private static int portOf(URL url) {
        return url.getPort() == -1 ? url.getDefaultPort() : url.getPort();
    }

    private static boolean isSameOrigin(URL from, URL to) {
        return from.getProtocol().equalsIgnoreCase(to.getProtocol()) && from.getHost().equalsIgnoreCase(to.getHost()) && portOf(from) == portOf(to);
    }

    private static void run(int id, String method, String address, byte[][] headers, int seconds, int maxRedirects) {
        final long deadline = System.nanoTime() + seconds * 1_000_000_000L;
        HttpURLConnection connection = null;
        try {
            final URL first = new URL(address);
            URL current = first;
            for (int redirects = 0;;) {
                final int left = (int) Math.max(1, (deadline - System.nanoTime()) / 1_000_000L);
                connection = (HttpURLConnection) current.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setRequestMethod(method);
                connection.setConnectTimeout(left);
                connection.setReadTimeout(left);
                for (int i = 0; i + 1 < headers.length; i += 2) {
                    connection.setRequestProperty(new String(headers[i], StandardCharsets.UTF_8), new String(headers[i + 1], StandardCharsets.UTF_8));
                }
                // Asked for, a body comes as the server sends it, which the client then does not decode.
                connection.setRequestProperty("Accept-Encoding", "identity");
                final int status = connection.getResponseCode();
                final String location = status >= 300 && status < 400 ? connection.getHeaderField("Location") : null;
                final URL next = location == null ? null : new URL(current, location);
                if (next != null && isSameOrigin(first, next)) {
                    redirects += 1;
                    if (redirects > maxRedirects) {
                        nativeEnd(id, REDIRECTED_TOO_OFTEN, null);
                        return;
                    }
                    connection.disconnect();
                    current = next;
                    continue;
                }
                final List<byte[]> fields = new ArrayList<>();
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                    // The status line goes under no name.
                    if (header.getKey() == null) continue;
                    for (String value : header.getValue()) {
                        fields.add(header.getKey().toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));
                        fields.add(value.getBytes(StandardCharsets.UTF_8));
                    }
                }
                if (!nativeResponse(id, status, connection.getContentLengthLong(), fields.toArray(new byte[0][]))) return;
                final InputStream body = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (body != null) {
                    final byte[] chunk = new byte[CHUNK_BYTES];
                    for (int read; (read = body.read(chunk)) != -1;) {
                        if (System.nanoTime() > deadline) throw new SocketTimeoutException();
                        if (read > 0 && !nativeData(id, chunk, read)) return;
                    }
                    body.close();
                }
                nativeEnd(id, DONE, null);
                return;
            }
        } catch (SocketTimeoutException timedOut) {
            nativeEnd(id, TIMED_OUT, null);
        } catch (IOException | RuntimeException failed) {
            final String reason = failed.getMessage() == null ? failed.toString() : failed.getMessage();
            nativeEnd(id, FAILED, reason.getBytes(StandardCharsets.UTF_8));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}

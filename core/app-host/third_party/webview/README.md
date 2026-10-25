# webview (vendored)

A header-only C++ library that opens a window with the system webview: WKWebView on macOS, WebKitGTK on Linux and
WebView2 on Windows. The app host makes its window with it.

- Upstream: https://github.com/webview/webview
- Commit: `cbbdee44afff22867de9fd88a9fc8350d9bdd399` (master on 9 March 2026; the last tag, 0.12.0, dates from 2024)
- Archive: `https://codeload.github.com/webview/webview/tar.gz/cbbdee44afff22867de9fd88a9fc8350d9bdd399`,
  sha256 `10e972a2327b5681474f4aa4499e505eaa4ff659aa995380386f08fd6fc1b763`
- License: MIT, see `LICENSE`

Only `core/include` is kept.

## Local patches

- `detail/backends/cocoa_webkit.hh` calls `cocoa_configure_hook`, when one is set, with the `WKWebViewConfiguration`
  before the `WKWebView` is made from it. A URL scheme handler can be registered only then, and the host serves the
  page and large bodies from `crossbind://`. Upstream tracks this as issue #851; PRs #955 (WebKitGTK only) and #1370
  are open.
- `detail/backends/win32_edge.hh` makes WebView2's environment with the options `win32_environment_options_hook`
  returns, when one is set, instead of none: WebView2 takes custom URL schemes from those options alone.
- `detail/backends/win32_edge.hh` keeps WebView2's profile in the folder `win32_user_data_folder_hook` returns, when one
  is set, instead of one under the executable's name in the roaming application data, which another app's executable
  of the same name shares and its cache roams with.
- `detail/backends/win32_edge.hh` leaves WebView2's permission requests to the app host: upstream let every read of
  the clipboard through, without its user's gesture as well, and WebView2 kept that answer in the profile.
- `detail/backends/cocoa_webkit.hh` sets no `DOMPasteAllowed`, and `detail/backends/gtk_webkitgtk.hh` no
  `javascript-can-access-clipboard`, which let a page's script paste from the clipboard with
  `document.execCommand('paste')`: a page reads it on its user's gesture, once WebKit's Paste menu or the app host lets
  it. WebKitGTK's setting let script cut and copy as well, which now take a gesture there.
- `detail/backends/cocoa_webkit.hh` sizes the window's content in `set_size`, not its frame, as the other backends do:
  the app's window opens with the page size crossbind.config.js gives.
- `detail/backends/win32_edge.hh` takes the minimum and maximum sizes as the content's, in logical pixels, as the size
  itself, and turns them into frame sizes at the window's DPI when Windows asks; upstream passed the numbers to Windows
  as frame pixels. Maximized, the window keeps to its monitor on a side whose maximum is larger, where upstream made it
  the maximum.
- `detail/backends/win32_edge.hh` opens the window in the middle of its monitor's work area, and
  `detail/backends/gtk_webkitgtk.hh` with GTK 3 in the middle of the screen, as the macOS backend does; upstream left
  where to the system. A GTK 3 window that does not resize takes the size of what it holds, so its webview asks for the
  size `set_size` gives before the window shows.
- `detail/platform/windows/dpi.hh` counts a window's menu bar in its frame, so the page's minimum size and its size
  after a change of DPI leave the bar out, as the size `set_size` gives does.
- `detail/native_library.hh` loads a library named without a path from System32 alone. webview first tries
  `WebView2Loader.dll`, which no crossbind app ships, so otherwise a copy in the working directory or on `PATH` would
  load into the app.

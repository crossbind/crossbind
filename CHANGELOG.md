# crossbind

<!-- release-notes:start -->
<!-- Generated from releases/crossbind/<version>.md by scripts/release/render-changelog.mjs. Edit the note, then run `pnpm changelog`. -->

## 2.0.0-beta.67

Desktop apps get a tray icon with its menu, the system's notifications, the trash, relaunch, sleep and wake events and copyright and category metadata, and no longer load a planted DLL on Windows, let a page read the clipboard without a gesture or take an update from another signer; the toolchain images move to 1.0.18, with Emscripten 6.0.13.

### Highlights

### Apps

- `tray.set({ tooltip, menu })` from `crossbind/app` puts a desktop app's icon in the macOS menu bar, the Windows
  notification area or a Linux status tray, with a tooltip and a menu of `menu.set`'s items without roles or
  accelerators, and `tray.remove()` takes it away. A click of an item with an id is the event `menu`, a click of the
  icon that opens no menu the event `tray`. On Linux the icon is a StatusNotifierItem, so the app needs no extra
  library; where no tray runs, as on GNOME without its AppIndicator extension, `tray.set` rejects and says so.
- `notification.show({ title, body })` shows one of the system's notifications, and a click on it is the event
  `notification`. macOS asks its user first, and Windows shows it as one of its own.
- `shell.trash(path)` moves a file or folder to the system's trash: what is inside the app's data, cache and logs
  folders, and what a dialog picked during this run. Where a volume has no trash the call fails, and nothing is deleted
  for good. Native code gets `trash()` from the C++ header `crossbind/app.h`, without that scope.
- `app.relaunch()` ends a desktop app as `app.quit()` does and opens it anew; a development session refuses it. Native
  code gets `relaunch()`.
- A desktop page hears the system going to sleep as the event `suspend`, and its waking as `resume`.
- `app.copyright` is the line a macOS app's About panel and a Windows executable's details show, and `app.category`,
  one of Apple's app categories such as `developer-tools`, files the app under macOS's categories and in a Linux menu.

### Ports

- A recipe's `patches` apply upstream fixes to the source it downloads, with `git apply` and before `replaceList`; one
  that does not apply stops the build. Through them zlib takes two fixes for heap buffer overflows when a non-blocking
  `gzwrite` fails (CVE-2026-76844, CVE-2026-85091), libjpeg-turbo three memory safety fixes (CVE-2026-75466 among
  them) and expat the fix for CVE-2026-113351.
- curl moves to 8.23.0 and OpenSSL to 4.1.0, whose WASI build leaves out DTLS, as it already left out QUIC.

### Images

- The pinned toolchain images move to 1.0.18. The web image carries Emscripten 6.0.13 with crossbind's embind overload
  patch. npm's vendored undici moves to 6.29.1 (CVE-2026-109869), Debian's Brotli to 1.1.0-2+deb13u1 (CVE-2026-111497)
  and the linux image's musl sysroots to musl 1.2.5-r24 (CVE-2026-107891).

Reference: `docs/api/app.md`, `docs/api/crossbind-build.md`.

### Breaking changes

- A desktop page reads the clipboard only on its user's gesture: on Windows the host allows such a read, on macOS
  WebKit shows its Paste menu and on Linux WebKitGTK asks the host. A read without a gesture gets nothing, and on Linux
  script cut and copy need a gesture too.
- `shell.openPath` and `shell.revealInFolder` refuse a path that contains `.` or `..`, as `shell.trash` does: the
  system follows a link before a `..`, so such a path leads somewhere other than where it reads.
- A signed app takes an update only from its own signer. On macOS the update must meet the running app's designated
  requirement; on Windows its setup program needs an Authenticode signature that Windows trusts, with the common name
  of the app's own certificate, and an app whose own signature Windows does not trust, such as a self-signed one,
  refuses every update. An app signed ad hoc on macOS, an unsigned app and a Linux app take any update their
  `app.updater` key signed, as before.
- Emscripten 6.0.13's WasmFS has no `FS.analyzePath` or `FS.findObject`, so wasm code that calls them breaks.

### Migration notes

- A runner started or deployed with beta.66 serves the 1.0.16 images, so builds stop with a toolchain mismatch: run
  `crossbind runner delete` and `crossbind runner start` again, or rerun `crossbind runner init` and redeploy.
  crossbind cloud runs the images of the current release, so there a build from beta.66 stops the same way until
  crossbind is upgraded.
- Code that asked `FS.analyzePath(path).exists` calls `FS.stat(path)`, which throws for a path that does not exist.
- A page reads the clipboard from a handler of its user's input, such as a click.

### Fixes

- A Windows app loads the system DLLs it imports, such as `version`, `winhttp` and `wintrust`, from System32 alone, so
  a DLL of the same name next to it, as in a Downloads folder, no longer runs inside it.
- A Windows app keeps its WebView2 profile under `%LOCALAPPDATA%`, in a folder named after its `app.id`, not in a
  roaming folder that every app with the same executable name shared; the profile of an earlier release moves there on
  first launch.
- The Windows setup program runs the WebView2 bootstrapper it downloads only when Microsoft's Authenticode signature on
  it is valid.
- A Windows update removes the URL schemes an earlier release registered and this one no longer lists, and the
  uninstaller removes every scheme of the app; a scheme another app took over keeps its key.
- A dependency that `crossbind.overrides.js` rebuilds is rebuilt again when its package's version changes, so a port
  release that adds a patch no longer leaves the old build linked.
- A `-standalone-wasi` package's SBOM and `THIRD-PARTY-LICENSES.md` list what its binary links in on WASI, such as
  wasi-libc and the LLVM runtimes, not the library alone.
- The Expo guide and the plugin README install `metro-config`, whose `mergeConfig` their `metro.config.js` takes;
  `expo/metro-config` exports none.
- The Expo template asks for caret ranges and ships no lockfile or npm overrides, like the other templates; the
  Electron template asks for Electron 45.

### Known limitations

- The tray and notifications have been clicked in CI with the messages Windows sends and against a Linux tray and
  notification server of the run's own; nobody has looked at the icon in a real KDE, GNOME or Windows tray yet, at a
  notification shown, or at macOS's question for notifications.
- A clipboard read on a click has been measured on Windows alone. On Windows CI checks that an update without the
  app's signature is refused; one by the same signer passing has not been run, and revocation is not checked.
- The sleep and wake events have been checked on Windows, with the messages Windows sends, not on macOS or Linux; a
  Windows machine with Modern Standby may send neither, and a Linux system without logind sends none. A trash on a
  drive without one has not been tried.
- expat's CVE-2026-115506 and libjpeg-turbo's OSV-2026-1068 stay open: neither has a fix that applies to the pinned
  release yet.
- In wasm, libcurl's own engine has no sockets: `curl_multi_init` returns a handle, but its transfers cannot connect.
- Developer ID signing and notarization have not been run with a real Developer ID yet, nor Windows signing with a
  cloud key service.
- On the desktop, one window. Linux, Windows and Android apps build in Docker.
- `fsync` in a Node.js wasm build reaches the operating system, not the disk.

## 2.0.0-beta.66

Apps install, sign and update themselves, call back and forth with their page, keep one instance, open their own links and use the camera, microphone and location, with menus, window options and message dialogs; the toolchain images move to 1.0.16, whose windows image builds and signs Windows setup programs.

### Highlights

### Apps that ship

- `crossbind app build` writes an installer beside each desktop app: on macOS a disk image, `dist/my-app.dmg`; on
  Linux a Debian package, `dist/my-app-linux-x64.deb` and its arm64 twin, which apt installs with WebKitGTK; on Windows
  a setup program, `dist/my-app-win32-x64-setup.exe` and its arm64 twin, which installs for the user without an
  administrator and fetches the WebView2 Runtime where the system has none.
- With `CROSSBIND_APPLE_SIGNING_IDENTITY` a macOS app is signed with a Developer ID in the hardened runtime, and with
  an App Store Connect API key (`CROSSBIND_APPLE_API_KEY`, `CROSSBIND_APPLE_API_KEY_ID`, `CROSSBIND_APPLE_API_ISSUER`)
  notarized and stapled too. With `CROSSBIND_WINDOWS_SIGNING_STORETYPE` and the key it names, jsign signs a Windows
  app, its setup program and its uninstaller with Authenticode and a timestamp, from a key file or a cloud key service.
- `app.updater: { url, publicKey }` makes a desktop app update itself. `crossbind app updater-key` makes the key pair,
  and with `CROSSBIND_UPDATER_PRIVATE_KEY` the build signs each update with Ed25519, over the app's id, platform,
  architecture and version and the file's SHA-512. The page calls `updater.check()` and `updater.install()` from
  `crossbind/app` when it decides to; the app then quits and opens the new version.
- `app.icon` names one square PNG, from which the build makes every platform's app icon.

### The page and the app

- `crossbind/app` gives the page dialogs (`dialog.open`, `dialog.save`, `dialog.message`), the shell
  (`shell.openExternal`, `shell.openPath`, `shell.revealInFolder`), `app.paths()`, `app.quit()` and the app's events,
  and the C++ header `crossbind/app.h` gives the app's own code the same. The page reaches less than the C++:
  `shell.openPath` opens nothing unless `app.openPath` lists the place.
- A function the page passes to native code can be called later, and the app's C++ sends events with
  `crossbind::app::emitEvent`, which the page hears through `events.on`.
- `menu.set(menus)` gives a desktop app its menus, with accelerators, enabled and checked states, submenus, separators
  and standard roles; their clicks come as the event `menu`.
- `app.singleInstance: true` keeps a desktop app to one instance: a later launch hands its arguments and folder over,
  and the page hears it as the event `second-instance`.
- `app.urlSchemes` names the schemes whose links open the app, on every platform; the page reads them with
  `app.launchUrls()` and hears later ones as the event `open-url`.
- `app.window` takes `maxWidth`, `maxHeight`, `fullscreen` and `backgroundColor`, and the page's
  `element.requestFullscreen()` fills the screen on the desktop.
- `app.permissions: { camera, microphone, location }` lists the devices the page may use through `getUserMedia()` and
  `navigator.geolocation`, each with the reason the system shows. On macOS, where WebKit gives a page no location, the
  host answers `navigator.geolocation` from CoreLocation.
- `dialog.message()` shows the platform's own message dialog with up to three buttons, everywhere an app runs.
- A download the page starts, of a `Blob` or a `data:` URL, asks where to save on macOS, iOS and Android.

### Images

- The pinned toolchain images move to 1.0.16. The windows image carries NSIS, which builds the setup programs, and
  jsign, which signs them; Node.js moves to 24.22.1.

Reference: `docs/api/app.md`.

### Breaking changes

- A Windows app's page no longer gets the camera, the microphone or the location through WebView2's own question: it
  gets those that `app.permissions` lists, and no other.

### Migration notes

- A runner started or deployed with beta.65 serves the 1.0.15 images, so builds stop with a toolchain mismatch: run
  `crossbind runner delete` and `crossbind runner start` again, or rerun `crossbind runner init` and redeploy.
- A Windows app whose page uses the camera, the microphone or the location lists them in `app.permissions`, each with
  its reason.

### Fixes

- A macOS app has the app, Edit, View and Window menus, so ⌘C, ⌘V and ⌘Q reach it.
- The page's `alert()`, `confirm()` and `prompt()` show on macOS, iOS and Android, where they returned at once before.
- On Android a file input opens the system picker, and Back walks the page's history before it leaves the app.
- On iOS a download no longer replaces the page.
- The page of a macOS app whose window was hidden, as behind a locked screen, stopped for good while one of its calls
  waited; on macOS 14 and later it keeps running.
- A desktop app that cannot start says why in a message box.
- A Windows app's WebView2 takes `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, as WebView2's own loader passes it on.

### Known limitations

- Developer ID signing and notarization have not been run with a real Developer ID yet, and Windows signing has been
  measured with a throwaway key, not yet with a cloud key service. An update is checked against its Ed25519 key alone,
  not yet against the app's Apple or Authenticode signature.
- The Windows setup program's install of the WebView2 Runtime, for a system that has none, has not been measured. On
  Windows the file and message dialogs and the shell functions are built, not measured yet.
- On the desktop, one window. Linux, Windows and Android apps build in Docker.
- On macOS no position from CoreLocation has reached a page in a measurement yet; neither has a link opened an iOS
  app, nor has an app that lists the location been through App Store review.
- Of several downloads a page starts at once, WebKit keeps the last.
- `fsync` in a Node.js wasm build reaches the operating system, not the disk.

## 2.0.0-beta.65

Builds apps for macOS, Linux, Windows, iOS and Android on crossbind's own host, the page in the system webview and the bindings native on Hermes, with `crossbind app dev` and `crossbind app build`; moves the toolchain images to 1.0.15 and fixes module globals in worker mode, Rust panics in Node.js addons and page reloads in Vite dev.

### Highlights

### Apps on crossbind's own host

- `target: { runtimeEnv: 'app' }` makes a Vite project an app: its page runs in the system webview, and its C++ and
  Rust run natively in the app's own process, in Hermes, with no Node.js and no browser engine of its own. The page
  calls the module as a web build that runs its module in a worker does: `initNative()`, then every call awaited.
  Add `@crossbind/core-app-host@beta` and `@crossbind/plugin-vite@beta` next to `crossbind`, or scaffold one with
  `npm create crossbind@beta -- my-app Desktop App`. Reference: `docs/api/app.md`.
- `crossbind app dev` opens the app on Vite's dev server: an edit to the page reloads it, an edit to native code
  rebuilds the host and opens the app again, and the page's console shows in the terminal. `crossbind app build` writes
  the finished app. `-p` names the platform, `macos`, `linux`, `windows`, `ios` or `android`, and Vite's own options
  pass through.
- macOS: `dist/my-app.app`, signed ad hoc; the sample is 1.8 MB zipped.
- Linux: `dist/my-app-linux-x64/` and `dist/my-app-linux-arm64/`, each with its `.tar.gz`, on a Mac as well. It runs
  on the system's WebKitGTK 4.1.
- Windows: `dist/my-app-win32-x64/` and `dist/my-app-win32-arm64/`, each with `my-app.exe` and its `.zip`, on a Mac or
  a Linux machine as well. It runs on the system's WebView2 Runtime, with no DLL beside it.
- iOS: `dist/my-app-ios/`, an Xcode project with the app prebuilt in it; `app: { id, team }` in `crossbind.config.js`
  names its bundle id and Apple team. During development the app runs in the Simulator.
- Android: `dist/my-app-android/`, a Gradle project, packaged with no JDK or Android SDK on the machine into
  `dist/my-app-android.apk`, and with the upload key `CROSSBIND_ANDROID_KEYSTORE`, `CROSSBIND_ANDROID_KEY_ALIAS` and
  `CROSSBIND_ANDROID_KEYSTORE_PASSWORD` name into `dist/my-app-android.aab` too. During development the app runs on the
  attached device or emulator.
- The webview loads the app's own page alone, links the user follows open in the default browser, and every call
  carries a token the page's top frame alone gets. `crossbind licenses -e app` lists what an app carries beside its
  packages, with `--platform linux`, `win32`, `ios` or `android` for that platform's app, and `--notices` writes them
  to ship with it.
- The host runs React Native's Hermes, release `250829098.0.17`: macOS and iOS builds download it once into
  `~/.crossbind/hermes/`, and Linux, Windows and Android apps build in crossbind's images, which carry it.

### Ports and images

- The pinned toolchain images move to 1.0.15. The new `android-app` image packages Android apps offline; the `linux`
  image carries WebKitGTK's headers and libraries and Hermes for a Linux app's host, and the `windows` image Hermes and
  the WebView2 SDK's headers for a Windows app's.
- A port recipe can name `getMirrors(version)`, other https URLs that serve the same source archive: a download that
  fails at `getURL` tries each mirror, checked against the same sha256. libiconv names the GNU mirrors.

### Breaking changes

None.

### Migration notes

- A runner started or deployed with beta.64 serves the 1.0.13 images, so builds stop with a toolchain mismatch: run
  `crossbind runner delete` and `crossbind runner start` again, or rerun `crossbind runner init` and redeploy.

### Fixes

- In worker mode, a C global the module exposes, and a vector the module keeps, stay usable after the page lets its
  handle go; they failed with `Cannot pass deleted object as a pointer of type NativePointer`.
- A panic in an app's Rust crates throws a JavaScript exception in a Node.js addon instead of ending the process. A
  wasm build still aborts, as its standard library does.
- In `vite` dev, an edit to a page source that imports a header reloads the page again; since beta.63 it did nothing.
- libiconv's source downloads from the GNU mirrors when kernel.org fails.

### Known limitations

- Apps: Vite only, one window of 1024 × 768 on the desktop, and no app icon on iOS or Android yet. A JavaScript function
  cannot be passed to the module.
- A macOS app's ad hoc signature opens it on the Mac that built it, and a Windows app is not signed, so SmartScreen
  warns about it once it is downloaded: Developer ID, notarization and Authenticode signing are not wired yet.
- Linux, Windows and Android apps build in Docker (`RUNNER=DOCKER_RUN` or `DOCKER_EXEC`). A Linux app needs WebKitGTK 4.1,
  release 2.40 or later; an Android app Android 13 and Android System WebView 116 or later; an iOS app iOS 15.1, arm64
  alone.
- Building or developing a Windows app on a Windows machine has not been measured yet, and a Windows app that cannot
  start, for want of the WebView2 Runtime or its `resources` folder, exits without a message.
- `fsync` in a Node.js wasm build reaches the operating system, not the disk.

## 2.0.0-beta.64

Serves HTTP from WASI 0.3 components with `-e http`, frees what JavaScript owns when the garbage collector reclaims its handle, pins an app's crates in `crossbind.cargo.lock`, runs the account commands outside a project and renames `runner stop` to `runner delete`.

### Highlights

### HTTP services on WASI

- `crossbind build -p wasi -e http` links the app into a component that exports
  `wasi:http/handler@0.3.0`, such as `dist/app-wasi-wasm32-st-release.http.wasm`, which
  `wasmtime serve`, Spin 4 and wasmCloud call once per request. The app defines one function from
  the header `crossbind/http.h`, `crossbind::http::handle(Request)`: the method, authority, path,
  query, headers and whole body of the request in, a status, headers and body out.
- The WASI 0.3.0 WIT and the bindings generated from it ship with crossbind, so a build needs no
  wit-bindgen. An exception out of `handle` answers 500 and logs a line to stderr, a body that does
  not fit in memory answers an error instead of trapping the instance, and each request runs on a
  1 MiB stack. Reference: `docs/api/wasi.md`.

### Memory freed when JavaScript lets go

- Wherever the runtime has `FinalizationRegistry` (browsers, on the page thread and in a worker,
  Node.js, and React Native 0.88 and later), the garbage collector frees what JavaScript owns: a
  value a function returns by copy, a `std::vector`, a vector `toVector` builds and an instance of
  a Rust struct made with `new`, besides a C++ object made with `new`. Before, only that last one
  was freed, and only on the page thread; a vector a worker returned leaked with no handle to free
  it.
- Class declarations gain `delete()`, which frees an object at once. Call it on an object that holds
  a lot of memory or a resource, and on React Native before 0.88, whose Hermes has no
  `FinalizationRegistry`. Reference: `docs/api/lifecycle-and-types.md`.

### Crates pinned like Conan packages

- The first build that links an app's Rust writes `crossbind.cargo.lock` next to
  `crossbind.config.js`. It pins every crate the build links, the ones in `cargoDependencies` and
  the ones they depend on, so a fresh checkout no longer resolves newer releases. Commit it, and
  delete it to resolve every version again. Reference: `docs/api/rust.md`.

### CLI

- `crossbind login`, `logout`, `usage`, `account delete`, `config` and `--version` work outside a
  project; they read only `~/.crossbind.json` and `~/.crossbind/credentials.json`.
- `crossbind build --bind-imports` also binds what the app's JavaScript imports into a browser
  build, as a Node.js build always does, and writes `browser/imports.json` to the output folder:
  each bound file, the specifiers that name it and its names, for a page that resolves those
  imports itself.

### Expo SDK 58

- `npm create crossbind@beta -- my-app Expo` scaffolds an Expo SDK 58 app on React Native 0.88.

### Ports and images

- SQLite 3.54.1.
- The pinned toolchain images move to 1.0.13: Node.js 24.22.0, Rust 1.99.1 and Debian's curl
  security update.

### Breaking changes

- `crossbind runner stop` is now `crossbind runner delete`, since it always removed the container,
  while `crossbind docker stop` only stops one. The local runner's container is now
  `crossbind-local-runner-web` (and `-android`, `-linux`, `-windows`) instead of the name
  `runner init` gives deployed runners.
- Objects JavaScript owns are freed when their handles are collected: now also values returned by
  copy, vectors and Rust objects, and every object in worker mode and on React Native 0.88 and
  later. C++ code that keeps a pointer or reference to one after the call returns must take it as
  a `std::shared_ptr`, or it reads freed memory once JavaScript lets go.

### Migration notes

- Replace `crossbind runner stop` with `crossbind runner delete`. It also removes a runner an older
  crossbind started under the old name.
- A runner started or deployed with beta.63 serves the 1.0.12 images, so builds stop with a
  toolchain mismatch: run `crossbind runner delete` and `crossbind runner start` again, or rerun
  `crossbind runner init` and redeploy.
- Commit the `crossbind.cargo.lock` the first build writes in a project that links Rust crates.
- The first build after the upgrade regenerates every interface and bridge.

### Fixes

### Bindings and runtime

- A constant a header takes from an include, such as zlib's `MAX_WBITS` from `zconf.h`, no longer
  fails SWIG with a syntax error when the app imports it.
- An imported constant whose value has a cast binds as the number the compiler makes of it:
  Expat's `XML_TRUE`, curl's `CURLAUTH_ANY` and `CURL_ZERO_TERMINATED`, OpenSSL's
  `ENGINE_METHOD_ALL`. A cast to a pointer, such as `SQLITE_TRANSIENT`, stays unbound with a note.
- Macro, alias and variadic bindings take a JavaScript callback for a function pointer, so
  `iconvlist` takes one as `libiconvlist` does.
- `fsync` and `fdatasync` on a host file no longer abort a Node.js wasm module, so SQLite commits to
  a database on disk.
- `FS.writeFile` honours `{ flags: 'a' }` and `{ mode }`, and edge builds export `FS`.
- A changed `env` value relinks a wasm build, and an app's own `env` value wins over the same key
  from its dependencies.
- embind-jsi's `toVector` takes a vector class by name, as the wasm runtime's does.

### Builds

- The first build after an upgrade no longer fails on a CMake tree configured from the previous
  version's source directory; crossbind starts the tree afresh.
- `crossbind licenses --package` keeps the indentation of the manifest it writes.
- The `excludedDependencies` notice names the override that excludes a dependency,
  `{ exclude: true }`.

### React Native

- An app that does not list `@crossbind/core-embind-jsi` itself configures under Gradle 9: the
  plugin finds the package where Node.js resolves it and warns when it is missing.

### Ports

- `@crossbind/port-openssl` sets `CURL_CA_BUNDLE` to the CA certificates it ships on Android, iOS,
  macOS, Linux and Windows, so GDAL and the curl tool verify HTTPS servers against them without the
  app naming the file; a libcurl caller passes its value as `CURLOPT_CAINFO`. An app's own `env`
  names other certificates, and a value already in the environment wins.

### create-crossbind

- A scaffolded library's README names the new package instead of the template's sample.

### Known limitations

- `-e http`: no outgoing requests (`wasi:http/client`), no streamed bodies or trailers, and the
  `data` and `env` of dependencies such as PROJ, GDAL and OpenSSL reach no component. While a
  request body is still arriving, its instance starts no other request, so a slow upload delays the
  requests the host gives that instance. Besides the `wasi:http/service` imports, the component
  imports the `wasi:cli` interfaces wasi-libc uses, which a host offering only the world's imports
  rejects.
- `fsync` in a Node.js wasm build reaches the operating system, not the disk.
- React Native before 0.88 frees an object only on `.delete()`.

## 2.0.0-beta.63

Makes only the binaries a build names and links native executables, adds the linuxmusl platform and ready-made Node.js packages, imports C and C++ packages from ConanCenter, runs toolchain steps on a remote runner or, after `crossbind login`, on crossbind cloud, binds only the functions an app imports, and brings the C++ to Expo web and Electron.

### Highlights

### Build what you name

- `crossbind build -e` makes binaries only for the runtime environments it names: `browser`,
  `edge`, `node`, `native` or `wasi`, several separated by commas, or one `target.runtimeEnv` in
  `crossbind.config.js`. The Vite, Webpack, Rspack and Rollup plugins choose `browser` themselves
  and React Native links the archives, so projects built through them need no change.
- `-e native` links the project's `main()` (from `src/native`) with its dependencies into one
  executable per platform and architecture, such as `dist/app.linux-x64`. A `linuxmusl`
  executable is fully static and runs on any Linux; a `linux` one needs glibc 2.28, a macOS one
  macOS 11 and a Windows one Windows 10, each with the C++ runtime linked in.
  `npm create crossbind@beta -- my-app Native Executable` scaffolds one.
- The prebuilt archives of every library crossbind builds, the ports included, link in a C or C++
  build that is not crossbind: pkg-config files resolve through `${pcfiledir}`, `*-config` scripts
  find their prefix, libtool `.la` files are gone and dependencies are named by library. C++
  packages need clang with libc++ 19 or later on Linux. Reference: `docs/api/native.md`.

### Linux on musl and ready-made Node.js packages

- `-p linuxmusl` builds Node.js addons and executables for musl, x64 and arm64; an addon loads on
  Alpine 3.21 and newer. Every port family gains a `-linuxmusl` package, and `-p host` picks
  `darwin`, `win32`, `linux` or `linuxmusl` for the machine the build runs on.
- Every port has a `-standalone-napi` package, such as `@crossbind/port-zlib-standalone-napi`, that
  installs with no build and no Docker: npm picks the matching addon among eight platform packages
  (darwin, linux, linuxmusl and win32, arm64 and x64). Twelve ports also ship their command-line
  tools as WASI commands in a `-standalone-wasi` package, such as `curl-wasi` in
  `@crossbind/port-curl-standalone-wasi`.

### Node.js without a bundler

- `crossbind build -e node` writes one ES module per runtime binary (`dist/node/napi.mjs`,
  `dist/node/wasm.mjs` and `dist/edge/wasm.mjs`) and Node.js module hooks that serve an app's
  native imports from it: headers, a package's headers, `conan:` headers, the app's own `.rs` files
  and `cargo:` crates. A deployed app starts with `node --import ./dist/node/napi.register.mjs`.
- `node --import crossbind/node/dev` builds the machine's binary before the app starts whenever its
  native sources, config or native imports changed, also under `node --watch`.
- Rust packages, the app's own `.rs` files and `cargo:` imports link into Node.js addons for Linux
  (glibc and musl) and Windows, x64 and arm64, as they already did on macOS.

### `conan:` imports

- Declare packages from ConanCenter under `conanDependencies` in `crossbind.config.js` (a version,
  a Conan range or `{ version, options }`), then import a header such as `conan:zlib/zlib.h` or
  include the package's headers from your own. crossbind builds each package from source with its
  own toolchains and links it statically: web builds (wasm32 and wasm64, single- and
  multithreaded), React Native on Android and iOS, and Node.js addons for Linux, macOS and Windows.
- The first install writes `conan.lock` next to `crossbind.config.js`; commit it. Each import is
  typed, and `crossbind licenses` lists every package with its recipe's license, source and
  SHA-256. Reference: `docs/api/conan.md`.

### Smaller bindings, and more of C bound

- A header of a dependency, a port or a `conan:` package binds the free functions the app imports
  from it by name, besides all its classes and enums, and the library code only the other
  functions reach is linked out. On the site's JavaScript-only demos the wasm shrinks by 40% for
  OpenSSL, 47% for GEOS, 11% for zlib and 4% for GDAL. Dev servers bind a newly imported function
  when the file is saved.
- Function-like macros, macros naming a function, variadic functions and mutable globals bind when
  the app imports them by name: `deflateInit2(...)`, `iconv_open(...)`,
  `TIFFSetField(tif, TIFFTAG_XRESOLUTION, vaDouble(72))`, and `_libiconv_version` as a handle to
  its storage. Rule 10 of `docs/api/cpp-binding-rules.md` has the details.

### Remote runner

- crossbind runs its toolchain steps (C++ builds, cargo, Conan) on a runner instead of the local
  Docker: `crossbind config set RUNNER REMOTE` and
  `crossbind config set REMOTE_URL_WEB https://…` (also `_ANDROID`, `_LINUX` and `_WINDOWS`, or
  `REMOTE_URL` for every image), with the token in `CROSSBIND_TOKEN` or a per-image
  `CROSSBIND_TOKEN_WEB`.
  `CROSSBIND_RUNNER` overrides `RUNNER` for one build.
- `crossbind runner start` runs one on this machine's Docker, and
  `crossbind runner init fly|cloudflare|cloudrun|azure` writes a folder ready to deploy to Fly.io,
  Cloudflare Containers, Google Cloud Run or Azure Container Apps.
- Only native inputs travel, content-addressed, so an edit uploads only the changed file, and a
  file over 16 MB goes in resumable parts. Reference: `docs/api/remote-runner.md`.

### crossbind cloud

- `crossbind login` signs in to crossbind cloud with GitHub, through the device flow and without
  asking for any permission. `crossbind usage` shows this month's build minutes by image and the
  playground's compiles left today; `crossbind logout [--all]` signs out, and
  `crossbind account delete --yes` deletes the account.
- Under `RUNNER=REMOTE`, a machine that names no runner address builds on crossbind cloud once
  signed in: a runner of your own per toolchain image, with 60 build minutes a month. `CLOUD_URL`
  (or `CROSSBIND_CLOUD_URL`) names another cloud. Reference: `docs/api/remote-runner.md`; what is
  kept and for how long: https://crossbind.dev/privacy/.
- The playground at https://crossbind.dev/playground/ compiles a header and its source on crossbind
  cloud and runs the module in the page, with nothing to install.

### Expo web and Electron

- `@crossbind/plugin-metro` builds an Expo app's C++ to WebAssembly for its web platform:
  `expo start --web` builds it on first load, and `crossbind-metro prepare-web` and `export-web`
  stage and link the release build around `expo export -p web`.
- `examples/desktop-electron` is an Electron app whose main process loads its addon; a packaged
  app reads the addon's data from `app.asar.unpacked`. Every example is now a `create-crossbind`
  template.

### Ports, licenses and images

- OpenSSL 4.0.3, expat 2.9.0 and SQLite 3.54.0. SQLite release builds now use `-O2` instead of no
  optimization, which runs `speedtest1` twice as fast.
- libiconv builds its extra encodings, libjpeg-turbo ships the TurboJPEG API, and curl's wasm
  build sends requests through a fetch transport that follows curl's options and reports progress.
- `crossbind licenses` lists every dependency package that is not private, not only ports, and
  `crossbind licenses -e node --package` writes each package's LICENSE, SBOM and license field.
- The pinned toolchain images move to 1.0.12: musl sysroots, Rust 1.99.0 with the Linux and
  Windows targets, Conan 2.33 and refreshed Debian packages.

### Breaking changes

- `crossbind build` makes binaries only for the runtime environments it is asked for, with `-e`
  or `target.runtimeEnv`. With neither, it makes the archives only and says so.
- `export.bundle` is removed: a `crossbind.config.js` that still sets it stops with a message.
  Packages published with it, such as the beta.62 ports, still build as dependencies.
- A Node.js build writes `dist/node/napi.mjs`, `dist/node/wasm.mjs` and `dist/edge/wasm.mjs`
  instead of one `.h.cjs` entry per header.
- A function of a dependency's header that no source imports by name is no longer bound:
  `const m = await initNative(); m.GDALVersionInfo()` fails unless something imports
  `GDALVersionInfo`.
- A host wasi-sdk (`WASI_SDK_PATH`, `CROSSBIND_WASI_SDK_PATH`) applies under `RUNNER=LOCAL` only;
  with the default runner a WASI build uses the SDK in the image, as CI does.

### Migration notes

- Add `-e` to each script that runs `crossbind build` for a binary: `-e node` for a Node.js addon
  or a wasm module for Node.js, `-e browser` or `-e edge` for a wasm module built outside a bundler
  plugin, `-e wasi` for a WASI command and `-e native` for an executable. A project that makes one
  kind of binary can set `target.runtimeEnv` instead.
- Delete `export.bundle` from `crossbind.config.js`. A library that set `bundle: false` needs
  nothing else.
- In Node.js, import a Node-API package from its root or its `node/napi` entry and
  `await initNative()` before using its names, instead of importing one of its headers.
- Import each function you call from the header that declares it
  (`import { GDALVersionInfo } from '@crossbind/port-gdal/gdal.h'`), or take the header whole with
  `import * as`, which still binds every function.
- For a WASI build with your own wasi-sdk, run `CROSSBIND_RUNNER=LOCAL crossbind build -p wasi`.
- The first build after the upgrade regenerates every interface and bridge.

### Fixes

### Bindings and runtime

- Two pending calls of one bound function, or a call made again from a callback it ran, no longer
  free each other's arguments, which broke the heap silently in release builds.
- `_JSPI` calls run one at a time, so suspended calls no longer overwrite each other's C stack.
- Worker handles convert to JSON and to strings, worker objects share the module's channel, and
  logging a worker module no longer raises an error in Expo's web dev server.
- `FS.writeFile` replaces a file that exists.
- A debug build takes an enum member for an integer parameter, and its pthreads start from the
  main script.
- C function-pointer struct fields bind, and a callback's `const char *` followed by its length
  arrives as a handle that `readBuffer` reads exactly.
- Generated types read constructors, byte strings and literals.
- An app served from a subpath (Vite `base`, webpack `publicPath`) finds its runtime.
- A header installed twice is bound once, and SWIG reads the headers of a CMake package that ships
  its sources.

### Builds

- A newer or deleted native source rebuilds the library.
- Parallel builds take turns compiling in Docker, configure-based installs finish on Docker
  Desktop and keep the extracted source's file times, and source downloads retry with backoff.
- A binary publishes only into an output folder of its own, and a package's data comes only from
  packages that serve the target.
- A `RUNNER=LOCAL` build pulls no Docker image, and cargo refuses a runner it does not know.
- A remote request that never reached the runner, such as one whose name lookup failed for a
  moment, goes again up to twice.
- The bundler plugins build dependencies before they transform an import.
- Node.js addons of several packages run in one process, and on Windows a C++ `long` (zlib's
  `uLong` among others) crosses as a Number instead of failing with unbound types.
- WASI writes after `SEEK_END` land at the end of the file.

### React Native

- A failed native build fails `pod install` instead of surfacing later in the app build.
- A change to the runtime JavaScript rebuilds the Android bundle.

### Ports

- curl's wasm build no longer overflows a buffer on a long custom method, reports network and CORS
  failures instead of `CURLE_OK`, honours `FAILONERROR`, `MAXFILESIZE` and `TIMEOUT`, and calls
  the header callback. Only http and https work in this build.
- GDAL's single-threaded wasm build runs thread-pool jobs in place, LERC no longer writes
  uninitialized Huffman padding, SpatiaLite's WASI programs link, and libwebp links its mux and
  demux libraries.
- The GEOS npm packages are licensed LGPL-2.1-only.

### Known limitations

- Native executables: the Windows ones and the x64 macOS one are built and checked, not run.
  Nothing points an executable at a port's data, so set `GDAL_DATA` and `PROJ_DATA`. Rust packages
  make no executable.
- `conan:` imports: no WASI builds. Web and React Native builds link a package's own archives
  only; the system libraries and frameworks its recipe declares reach Node.js addons alone.
  Templates do not bind, and packages come from ConanCenter only.
- Remote runner: a desktop build also needs a web runner, because SWIG runs in the web image for
  every platform but Android. Cloudflare Containers built two to three times slower than a recent
  Mac's Docker, the first start after a deploy can take over four minutes, and some networks refuse
  `workers.dev` names, which a custom domain avoids. Cloud Run keeps the build tree in memory, and
  an Azure runner scaled to zero takes about 33 seconds to answer.
- Expo web: Metro does not watch the C++ sources, so reload the page after an edit, and a
  multithreaded build needs COOP/COEP from the production host.
- An import whose specifier is built from variables is not seen by the scan; import the functions
  by name or bind the header whole.
- Macros, variadic functions and globals take numbers, enums, booleans, strings and pointers only.
  A variadic call takes up to six extra arguments, and each variadic function adds about 25 KB to a
  wasm module.

## 2.0.0-beta.62

Builds native Node-API addons for macOS, Linux and Windows, imports single Rust modules with cargo:, binds struct fields and imported constants through SWIG, and moves to toolchain images 1.0.8.

### Highlights

- Builds a native Node-API addon from the same bindings as the wasm build:
  `crossbind build -p darwin`, `-p linux` or `-p win32` writes one `.node` file per architecture
  (arm64 and x64) and a loader that `require` and `import` both load. macOS addons build on a Mac;
  Linux and Windows addons build on any host with Docker, in the new `linux` and `windows`
  toolchain images. A Linux addon runs on glibc 2.28 or later and a Windows addon on Windows 10 or
  later, each with the C++ runtime linked in. On macOS, Electron's main process loads the same
  addon.
- Every `@crossbind/port-*` family gains macOS, Linux and Windows packages, such as
  `@crossbind/port-gdal-darwin`, `-linux` and `-win32`, with arm64 and x64 archives for native
  addons. Nothing from the build machine goes into them; the data a port needs, such as
  `GDAL_DATA` and `proj.db`, lands in `dist/data`, and a new `binary.addonFlags` target spec names
  the system libraries a port links (libxml2 for GDAL on macOS, Winsock and the certificate store
  for curl on Windows).
- Imports one module of a crate through a `cargo:` path such as `cargo:xxhash-rust/xxh3`. Rust
  bindings also carry `std::io` streams as classes, `Option` of
  64-bit integers and of byte or float slices, `NonZero` integers, `mut` parameters and fixed-size
  arrays.
- Binds C struct fields through SWIG, so the compiler resolves typedefs SWIG never read: numbers
  and strings by value, enums as their integer, data pointers as handles or instances.
- Binds the `#define` values and `const` globals an app imports from a header as module
  constants. Only the imported names are registered, so a header with thousands of macros costs
  nothing until one is used.
- Adds `readBuffer` and `writeBuffer`, which copy bytes to a `Uint8Array` and from any
  `ArrayBuffer` or view of one.
- Prints each binding the generator skips (a variadic function, a mutable global, a static
  method named `length`) with its header and line.
- Raises the pinned toolchain images to 1.0.8.
- Publishes every workspace package on one common version.

### Breaking changes

- `targetSpecs[].specs.cmake` must be an object such as `{ compileOptions: ['-O3'] }`. The array
  form was never read; it now stops the build with a message.

### Migration notes

- Replace a `specs.cmake` array with `specs.cmake: { compileOptions: [...] }`, and move CMake
  configure flags (`-D...`) into a recipe's `getBuildParams`.
- The first build after the upgrade regenerates every bridge and rebuilds each cargo package once.

### Fixes

- A never-built cargo dependency builds in one run, and a cargo archive built from an older
  embind-rs is rebuilt instead of linking stale glue or clashing with another archive.
- An interface copied from a package's `.i` is regenerated when that file changes or goes away.
- Debug wasm builds reject a 64-bit Number that is not a safe integer, as release builds do.
- Two or more `compileOptions` no longer fail CMake configure.
- Building OpenSSL from source (`--rebuild-deps`) runs `make all` before `make install`, so the
  install step no longer races on its own object files.
- The documentation shows the settings the build reads: `specs.binary.emccFlags`,
  `getBuildParams(target, depPaths, ext, buildPath)` and the wasm stack size, and no longer
  describes `LOG_LEVEL` or a `getSource` recipe hook.

### Known limitations

- Constants bind only for names imported from a header, so `crossbind build` output for Node.js,
  a plain browser page or an edge runtime binds none. A constant first imported while a dev server
  runs binds after the server restarts.
- Native addons: no `worker_threads`, and Rust packages build for macOS only. The arm64 Windows
  and x64 macOS addons are built and linked but have not been run on those machines yet.

## 2.0.0-beta.60

Reaches the JavaScript runtime through React Native's TurboModule path, compiles at the 2020 C++ standard, and moves Android onto NDK r30 LTS.

### Highlights

- Installs the React Native bindings the way the framework intends. iOS implements
  `getTurboModule:` and `RCTTurboModuleWithJSIBindings`; Android implements
  `TurboModuleWithJSIBindings` and hands back a `BindingsInstallerHolder`. React Native invokes the
  installer once per module instance, on the JS thread, which is what used to be held together by a
  `runOnJSQueueThread` dispatch on one side and a JavaScript guard on the other.
- Leaves two surfaces React Native no longer offers for library use: `RCTCxxBridge`, which 0.87
  removes outright, and `getJavaScriptContextHolder()`, which is marked unstable and returns a
  nullable the old code dereferenced unchecked.
- Moves the Android toolchain to NDK r30 LTS, installed from its own verified archive and reached
  through a path that does not carry the version, so a consumer is not pinned to the exact release
  the image happens to ship.
- Updates the bundled native sources: expat 2.8.5, which carries the fix for CVE-2026-93990.
- Raises the pinned toolchain images to 1.0.6, with Rust 1.98.1 and Node 24.21.0.
- Publishes every workspace package on one common version again. beta 59 shipped two packages, so
  the tree had drifted apart.

### Breaking changes

- C++ sources compile at the 2020 standard instead of 2017. React Native 0.87's `react/bridging`
  headers need it, and leaving one target on a different standard from the rest of the tree is
  worse than moving all of them. Code that uses `requires` or `concept` as an identifier no longer
  compiles.
- Android builds against NDK r30. A project that pins its own NDK has to move with it.
- The React Native integration is verified against 0.87. The generated bootstrap now resolves the
  native module through `TurboModuleRegistry` rather than `NativeModules`.

### Migration notes

- Rename any identifier called `requires` or `concept` in C++ that crossbind compiles. The
  distribution template that links a published port stays at the 2011 standard, so consuming a
  prebuilt port is unaffected.
- Set `ndkVersion` to r30 in an Android project that declares one.
- Move a React Native app to 0.87. An app that reached `NativeModules.RNJsiLib` directly should use
  the generated bootstrap instead.

## 2.0.0-beta.58

Binds C++ pointer surfaces and whole Rust crates, and moves every package onto one train.

### Highlights

- Binds C++ pointer surfaces: pointer handles with explicit string helpers, types declared in
  another header, function-pointer callbacks, C struct handles, dependency bridges with
  registration guards and smart-pointer wrappers. Port headers that used to be skipped now
  compile and their declarations are callable.
- Binds Rust end to end, from a plain `.rs` file, a cargo package or a `cargo:` crate import.
  The generator carries the narrow integers, `f32`, `usize`, `char`, collections, typed arrays,
  tuples, JSON records, optionals, newtypes, enums, value objects, class properties,
  self-returning methods, shared handles and closures, plus module constants.
- Raises the pinned toolchain images to 1.0.4, which is what carries the SWIG fork the bindings
  are generated with.
- Updates the bundled native sources: curl 8.22.0, expat 2.8.4, GEOS 3.15.0 and PROJ 9.9.0.
- Publishes every workspace package on one common version again.

### Breaking changes

- iOS builds target 15.1 instead of 13.0. Xcode 27 refuses anything lower, and React Native's own
  floor is 15.1.
- An iOS app must adopt the UIScene lifecycle. The iOS 27 SDK traps an application that does not.
- A Rust `Option` return arrives as `null` on every runtime. It used to arrive as `undefined` on
  some of them.
- A 64-bit Rust parameter takes a BigInt or an exactly representable Number. A Number outside the
  safe integer range is rejected instead of silently rounded.

### Migration notes

- Raise `IPHONEOS_DEPLOYMENT_TARGET` to 15.1 in existing iOS projects.
- Add a scene delegate and the scene manifest to an existing iOS app. The React Native template
  under `create-crossbind` shows the shape.
- Compare a Rust optional against `null`, and pass a BigInt for an `i64` or `u64` argument outside
  the safe integer range.

### Fixes

- An error raised from a Rust binding keeps its `code` across a worker boundary and on the React
  Native runtime, where the host exception used to be rewritten.
- An extracted native source records the archive it came from, so a version bump re-extracts
  instead of compiling the previous release from a cache that still looked current.
- The React Native bridge and iOS library caches see header, native and module roots that live
  outside the project.

### Known limitations

- This remains a prerelease. Stable compatibility guarantees begin with the first `2.0.0` stable
  train, and the npm `latest` dist-tag keeps pointing at an older beta until then.
- Rust trait objects, generic functions, methods that consume `self`, `Send + 'static` closures
  and `i128` are not bindable, and they are reported as documented skips.
- `async fn`, inline modules as namespaces, the iterator protocol on a class, and an `Option` of
  an enum or a value object are wanted but not carried yet.
- Native toolchain images remain a separate GHCR release stream and are identified by exact image
  digests rather than npm package versions.

## 2.0.0-beta.56

Hardens Crossbind's package release chain and refreshes its supported build toolchains.

### Highlights

- Moves the repository and published CLI contract to Node.js 24.
- Refreshes the supported Rust, Emscripten, WASI SDK and Android build toolchains.
- Introduces an exact-artifact npm release train with Trusted Publishing, provenance verification
  and version-specific GitHub Releases for `crossbind`.
- Adds automated dependency, native-source and published toolchain-image security monitoring.

### Breaking changes

- Node.js 24 or newer is now required by `crossbind` and `create-crossbind`.

### Migration notes

- Upgrade development and CI environments to Node.js 24 before installing this beta.
- Continue installing prerelease packages through the npm `beta` dist-tag.

### Fixes

- Toolchain image selection now reads one canonical, digest-pinned table shipped with the CLI.
- Package and image release workflows fail closed on integrity, provenance, tag or asset conflicts.

### Known limitations

- Beta 55 published only the `crossbind` CLI: the train stopped when the pinned npm 12 CLI
  changed its `view --json` output shape and the registry verification never matched. Beta 56
  republishes the complete package set; do not pair `crossbind@2.0.0-beta.55` with other
  packages from that train.

- This remains a prerelease. Stable compatibility guarantees begin with the first `2.0.0` stable
  train.
- Native toolchain images remain a separate GHCR release stream and are identified by exact image
  digests rather than npm package versions.

## 2.0.0-beta.55

Hardens Crossbind's package release chain and refreshes its supported build toolchains.

### Highlights

- Moves the repository and published CLI contract to Node.js 24.
- Refreshes the supported Rust, Emscripten, WASI SDK and Android build toolchains.
- Introduces an exact-artifact npm release train with Trusted Publishing, provenance verification
  and version-specific GitHub Releases for `crossbind`.
- Adds automated dependency, native-source and published toolchain-image security monitoring.

### Breaking changes

- Node.js 24 or newer is now required by `crossbind` and `create-crossbind`.

### Migration notes

- Upgrade development and CI environments to Node.js 24 before installing this beta.
- Continue installing prerelease packages through the npm `beta` dist-tag.

### Fixes

- Toolchain image selection now reads one canonical, digest-pinned table shipped with the CLI.
- Package and image release workflows fail closed on integrity, provenance, tag or asset conflicts.

### Known limitations

- This remains a prerelease. Stable compatibility guarantees begin with the first `2.0.0` stable
  train.
- Native toolchain images remain a separate GHCR release stream and are identified by exact image
  digests rather than npm package versions.

<!-- release-notes:end -->

## 2.0.0-beta.54

Two packages move: `@crossbind/plugin-react-native` and `create-crossbind`, which scaffolds it.
Nothing published depends on the plugin - the three packages that do are private samples and
fixtures - so the rest of the beta.53 set stays as it was tested.

### What is in it

- **The React Native plugin tarball is 18 kB instead of 16 MB.** Its ignore list named the current
  xcframework directly, so when the rename left a directory behind under the old name, that one was
  packed: 30 MB unpacked of a static library nothing links against. The list matches `*.xcframework`
  now, so no name can slip past it again. The xcframework an iOS build produces was never shipped
  and still is not - it is built on the consuming machine, which is why nothing was broken by
  carrying the wrong one.
- **`create-crossbind` scaffolds the fixed plugin.** A new Expo project was still getting
  the beta.53 plugin - the Expo template pins its crossbind dependencies exactly rather than by
  range, so the caret that carried the fix into every other template did not reach it.

## 2.0.0-beta.53

beta.52 reached npm only in part: 33 of 107 packages published before the run stopped, and every
package that carries an OpenSSL binary was on the wrong side of that line - so the security patch
had not actually shipped. The run stopped because the CLI it had just published turns rebuilds on
without being able to finish one; that is fixed here, and the whole set moves to beta.53 so what is
on npm is again one build.

### What is in it

- **Rebuilds finish.** The source stamp added in beta.52 makes a `nativeVersion` bump rebuild the
  library instead of serving the previous one. It did not clear what the previous upstream release
  left behind, so the rebuild it triggered then failed wherever an install step could not overwrite
  a file it had not created - a read-only `geos-config`, a SQLite man page under a Docker bind
  mount. The stale configure output and staged install tree are now removed first.
- **The OpenSSL 4.0.2 patch ships.** Every OpenSSL target and everything that statically links it -
  the curl family and the GDAL WASI command - is republished from one clean build of the whole
  matrix.

### Upgrading

Reinstall to pick up the patched TLS stack. Nothing to change in application code.

## 2.0.0-beta.52

Every package moves together this time. beta.51 argued against republishing unchanged packages, and
that argument still holds for an ordinary fix - but this release carries a TLS security patch that
reaches consumers through statically linked artifacts. A caret range cannot tell anyone which tarball
contains the patched stack; one baseline number can. So the whole set is pinned at beta.52 and
published as one tested set.

### What is in it

- **OpenSSL 4.0.2.** A security patch release fixing seven CVEs, the most severe Moderate: a QUIC
  double free, a heap buffer overflow in CMS key unwrapping, an invalid pointer dereference in the
  CMP server, unbounded QUIC queue growth, an RPK certificate dereference, excessive DTLS record
  buffering and a client-side OCSP memory leak. Every OpenSSL target was rebuilt from the new
  source, and every package that statically links it - the curl family and the GDAL WASI command -
  was rebuilt against it.
- **A prebuilt library is rebuilt when its upstream source changes.** The build cache keyed on the
  existence of the output alone. Bumping `nativeVersion` and rebuilding therefore produced binaries
  of the previous upstream release, while the manifest, provenance and licence metadata already
  named the new one - a stale binary published under a patched version number. The cache now carries
  a stamp of the upstream version and the recipe source hash, and misses when either moves.

### Upgrading

Nothing to change in application code. Reinstall to pick up the patched TLS stack; if you vendor the
prebuilt artifacts, rebuild rather than reusing the beta.50 output.

## 2.0.0-beta.51

Only `crossbind` moves in this release. beta.50 said the numbers would move together from then on;
they do not have to, and here they should not. The fix is in the CLI alone, and every package that
depends on it was published with a `^2.0.0-beta.50` range, which already accepts beta.51 - so
republishing 107 unchanged packages would produce 107 identical tarballs under a new number and
throw away the fact that beta.50 was tested as one set. The versions move together when the change
does; a minor bump would still require the whole set, because a caret range does not cross one.

### What is in it

- **Android builds work on Apple Silicon again.** The pull that runs before bridge generation asked
  docker for the android image by its multi-arch index, which carries no arm64 leaf, so a fresh
  install on an Apple Silicon Mac failed with "no matching manifest for linux/arm64/v8" before it
  compiled anything. It now asks for the amd64 leaf, as the other three call sites already did.

## 2.0.0-beta.50

The first release published under the crossbind name. cpp.js shipped to npm; crossbind has not, so
this is where the new name starts, and every package in the workspace is pinned to this one
version rather than carrying whatever number its own history had reached. From here the numbers
move together.

### What is in it

- **A host build no longer needs nightly Rust.** Shared-memory wasm used to rebuild the Rust
  standard library with `-Zbuild-std` on a nightly toolchain unless the build ran in the container.
  The sysroots the image ships are now readable by a host build as well, pulled from the published
  image itself rather than a repackaged copy, so both paths link the same std and neither needs
  nightly.

- **Cargo dependencies build themselves.** An app whose dependency graph contains a cargo package
  used to need that package built by hand first, which was written down nowhere. On wasm, skipping
  it produced a clean build and a module that died at init.

- **Identifiers moved to `dev.crossbind`.** Generated iOS and macOS frameworks, and the sample
  apps, now carry the new organisation's name. This is the breaking part of the release.

- **The toolchain images are signed.** 1.0.2 is published to GHCR, mirrored to Docker Hub with
  identical digests down to the layer, and signed so both registries can be verified independently.
  A release only earns its stable tag after every one of those checks passes on exactly the bytes
  that were gated.

### Note on versions

The image family (1.0.2) and the npm packages (2.0.0-beta.50) are versioned separately on purpose:
the toolchain moves when its compilers move, the packages move when their code does.

## 1.0.4

Published as `cpp.js@1.0.4`, the package's previous name, on 19 January 2025. 1.0.1 and 1.0.2 shipped
in the two days before it without release notes.

### Patch changes

- Works around a race condition with TurboModules on Android.
- Includes `prebuilt/*/{config.general.name}/*.h` in the dependency header search paths.

## 1.0.0

🚀 first stable release. Published as `cpp.js@1.0.0` on 17 January 2025, after the 1.0.0 alpha and beta
series that ran from August 2024 to January 2025; the 0.x line before it, from 0.1.0 in January 2023 to
0.6.1, was published under the same name.

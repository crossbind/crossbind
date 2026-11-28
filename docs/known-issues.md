# Known issues

Defects and gaps that are real but not yet fixed, so a later session does not rediscover them.

Every entry carries the command that proves it is still real. Run the check before acting on an
entry, and delete the entry when the check comes back clean — an entry nobody can verify is worse
than no entry. Scope each check so it cannot match this file, which quotes what the checks look for.

Fixing something here is not a prerequisite for anything else; this is a list, not a queue.

## A Windows app's own page has no OPFS

Chromium's file system API takes http and https origins alone, and WebView2 gives a custom scheme no setting for it: at
`crossbind://app` a built Windows app's page, and its Workers, get a `SecurityError` from
`navigator.storage.getDirectory()` ("It was determined that certain files are unsafe for access within a Web
application, or that too many calls are being made on file resources."), which the Windows spike of 18 Nov 2026
measured on WebView2 156 and 157. The origins an extension serves are `http://<name>.localhost` on Windows, which have
OPFS and its sync handle; a development session's page comes from the dev server, which has it too.

- Seen: 2026-11-18
- Check: the last conformance run on main prints the app's own page's OPFS failing on Windows:
  `gh run view "$(gh run list --workflow test-node-addon-conformance.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --log | grep 'app-windows-run' | grep -m1 'PAGE GETS opfs "error: SecurityError'`
  prints a line.
- Remove when WebView2 gives a custom scheme OPFS, or a Windows app's own page moves to an http or https origin of its
  own; then drop the Windows sentence of `docs/api/extensions.md`'s Limits.

## WebView2 does not hand the host two requests of a served origin's service worker

On Windows the host asks WebView2 for every request of an origin an extension serves, its workers' among them
(`AddWebResourceRequestedFilterWithRequestSourceKinds` in `channels.cpp`), and answers each through the extension that
serves it (`Core::serveServed()`). Two requests of a registered service worker were not handed to it, on the x64
runner's WebView2 157.0.4341.60 (image `windows-2025-vs2026` of 23 Nov 2026) and the arm64 runner's 158.0.4370.33
(`windows-11-vs2026-arm64`):

- On 157, the worker's own request for the page, `fetch(event.request)`, once its origin ended and was served again: the
  window showed the origin's address over an empty document the worker controlled, and no `WebResourceRequested` came
  for it, of any source kind, in 180 s. While the origin stayed served, the same request under a reload was handed
  over, as a service worker's; on 158 it was handed over in both.
- On 157 and on 158, an update's check of the worker's script, `registration.update()`: neither the extension nor the
  source was asked for it. On 157 the update failed "A bad HTTP response code (404) was received when fetching the
  script.", a 404 from neither of them; on 158 "An unknown error occurred when fetching the script.". The
  registration's own request for the script was handed over on both, with `Service-Worker: script`.

Where such a request goes instead is not shown, nor whether the runtime or the system (Windows Server 2025 against
Windows 11) makes 157's difference. The preview extension refuses a project's worker at its registration, so no preview
holds one; an app's own extension that serves an origin whose pages register a worker would meet both.

- Seen: 2026-11-28; the page in conformance runs 46166400172 (job 141046570389) and 46166707500 (job 141047457429), the
  update's check in 46174151135 (jobs 141073183534 and 141073183203).
- Check: on a scratch branch of the day, two edits bring the steps back: the line
  `if (isWorkerScript(request)) return request.respond(404);` out of `answerOrigin()` in
  `extensions/preview/native/opener.cpp`, and the expectation of the refusal's words, the `WORKER_REFUSALS` check after
  the `worker` step, out of `checkClearing()` in `e2e/app-projects/e2e/clearing.mjs`. Pushed and run with
  `gh workflow run test-node-addon-conformance.yml --ref <that branch>`, the x64 Windows job, where its
  `PROJECTS WEBVIEW2` line reads 157, fails at the snapshot opened again after "Close preview with its question up" with
  `the project's page did not come in 180 s` and `"handed":[]`. For an update's check, the `worker` step of
  `e2e/app-preview/src/project-steps.js` also calls `(await navigator.serviceWorker.getRegistration('/')).update()` once
  it registered, and `answerOrigin()` prints each request's path and `Service-Worker` header on stderr: the
  registration's request prints and the update's does not, and the page's update fails in the words above.
- Remove when the host is handed both on the runtimes it supports, as a mend of its own may make it (a host that refused
  a worker's script at every origin it serves, as the preview extension does, would see no update's check made; what
  answers on the x64 runner's port 80 is not known), and with it the Windows clause of `docs/api/extensions.md`'s Limits
  on the host's `http://<label>.localhost/`.

## A Linux app's pages have no OPFS

WebKitGTK keeps the Storage API (`navigator.storage`), the File System API and its access handles off by default, so
neither a Linux app's own page nor an origin an extension serves gets OPFS: `navigator.storage.getDirectory` is
undefined, in Workers too. Turned on with `webkit_settings_set_feature_enabled()` (`StorageAPI`, `FileSystem`,
`AccessHandle`), on WebKitGTK 2.52.6 (Ubuntu 26.04, CI) and 2.54.0 (Debian 13) alike, a page gets its directory, but a
Worker's `createSyncAccessHandle()` fails ("NotSupportedError: Backend does not support this operation"), which
crossbind's OPFS backend needs; so nothing is turned on (measured 18 Nov 2026).

- Seen: 2026-11-18
- Check: the last conformance run on main prints the Linux app's own page's OPFS failing:
  `gh run view "$(gh run list --workflow test-node-addon-conformance.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --log | grep 'app-linux' | grep -m1 'PAGE GETS opfs "error: TypeError'`
  prints a line.
- Remove when a WebKitGTK the app runs on gives a Worker the sync access handle with the features on, and the host
  turns them on; then drop the Linux sentence of `docs/api/extensions.md`'s Limits.

## A file input's picker outlives its page on iOS

An iOS app's file input shows WebKit's own picker, which no extension takes, and a picker that is up as its page goes,
at a reload or as the page's origin ends, stays over the page that comes. The preview extension's Reload and the end of
a preview meet it; measured on the iOS 27 Simulator on 26 Nov 2026. Nothing the host may call closes it and tells
WebKit: the one way, `-[WKWebView _dismissFilePicker]`, is private, and a controller dismissed from the host's side
tells WebKit's `WKFileUploadPanel` nothing, as UIKit tells it of its user's dismissal alone, which would leave its input
waiting and every later file input of the web view without a picker.

What a file chosen in it reaches was not run, as no run chooses a file in that picker. Read: no crossbind code is on
its path, so it allows no path, and WebKit hands the files to the input that asked, whose page is gone. Not read: what
WebKit does with them where that page is kept in its back/forward cache and comes back.

The host's own `page-files` closes the picker it shows, on macOS and Android, as its page goes. Not measured: the
pickers that WebKitGTK on Linux and WebView2 on Windows show themselves.

- Seen: 2026-11-26
- Check: the iOS job of the last conformance run on main prints the picker left up after a preview's end:
  `gh api "repos/:owner/:repo/actions/jobs/$(gh run view "$(gh run list --workflow test-node-addon-conformance.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --json jobs --jq '.jobs[] | select(.name == "app-ios") | .databaseId')/logs" | grep -m1 'PREVIEW KNOWN picker-after-end "stays"'`
  prints a line.
- Remove when the host shows an iOS app's file input itself, through the `runOpenPanelWithParameters` of
  `WKUIDelegate` that iOS 18.4 and later offer, and closes it as its page goes, or WebKit closes its own as the page
  goes, and the line says `"closed"`; then make `checkPickers()` in `e2e/app-projects/e2e/pickers.mjs` expect it closed
  on iOS as on macOS.

## fsync in a Node.js wasm build does not reach the disk

Emscripten's WasmFS Node backend has no `NodeFile::flush`, so an `fsync` or `fdatasync` on a host file used to
trap and abort the module; SQLite's unix VFS calls one on every commit. `core/crossbind/src/assets/cpp-runtime/node.cpp`
answers both for host files without the backend, as NODERAWFS does: the data has reached the operating system, but
nothing forces it to disk.

- Seen: 2026-10-15
- Check: `docker run --rm --entrypoint grep "ghcr.io/crossbind/web@$(node -p "require('./core/crossbind/src/assets/toolchain-digests.json').images.web.index")" -c 'implement NodeFile::flush' /emsdk/upstream/emscripten/system/lib/wasmfs/backends/node_backend.cpp` prints 1.
- Remove when the pinned emsdk implements `NodeFile::flush`; then drop the `--wrap` pair from `buildWasm.js` and `node.cpp`.

## The Microsoft Store refuses the Windows setup program

The Store's policy 10.2.9 asks for "a standalone installer", "not a downloader stub/web installer that downloads bits
when run" (https://learn.microsoft.com/en-us/windows/apps/publish/store-policies). On a system without the WebView2
Runtime, the `nsis` setup downloads Microsoft's bootstrapper, so the Store refuses it. The way out chosen on 2026-11-07
is an MSIX package, which downloads nothing: the `msix` installer makes one with the Store's identity, as
`docs/api/app.md`'s Microsoft Store section tells, which Windows installs and runs (the conformance workflow's
`app-windows-msix`), but which the Store has not certified yet.

- Seen: 2026-11-07
- Check: `grep -c URLDownloadToFileW extensions/nsis/installer.nsi` prints 1 or more.
- Remove when the Store certifies a crossbind app's MSIX package; then drop the setup program's sentence at the end of
  `docs/api/app.md`'s Microsoft Store section and its copy in `landing/src/guide/pages/winget-microsoft-store.js`.

## android-app's build tools carry a Guava with CVE-2026-102554

Guava's DoS while deserializing, fixed in Guava 33.7.2, ships inside three of the android-app image's build tools:
Gradle 9.8.1's `lib/guava-33.4.6-jre.jar`, the Android Gradle plugin's `guava-33.4.0-jre` in the offline cache (AGP
9.5.0 still takes 33.4.0) and Guava 33.3.1 inside the Kotlin Gradle plugin's jar. None has a release with the fix, and
they deserialize the build's own data, not input from outside, so `.trivyignore` lets the image scans pass it until
its date.

- Seen: 2026-11-02
- Check: `docker run --rm --entrypoint sh "ghcr.io/crossbind/android-app@$(node -p "require('./core/crossbind/src/assets/toolchain-digests.json').images['android-app'].index")" -c 'ls /opt/gradle/lib; find /opt/gradle-ro-cache -name "guava-*.jar"' | grep -E 'guava-33\.[0-6]\.'` prints a jar.
- Remove when Gradle, AGP and the Kotlin Gradle plugin that the image pins all take Guava 33.7.2 or later; then delete the entry from `.trivyignore`. Before 2026-12-15, renew its date after a fresh review, or the scans fail.
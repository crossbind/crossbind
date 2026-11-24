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

## A multithreaded dev build's empty std::optional crosses as undefined

`utils/embindOptional.js` makes an empty `std::optional` cross to JavaScript as null, as on every other runtime, by
rewriting `Object.assign({optional: true}, EmValType)` in the glue. The multithreaded debug glue spells it across lines,
`Object.assign({\n\t\t\t  optional: true\n\t\t\t}, EmValType)`, which the pattern does not take: `buildWasm` logs
"embind optional rewrite missed", and an empty optional crosses as undefined. The conformance kit's `cpp:optionalNone`
then fails in the dev runs of `e2e/web-rspack` and `e2e/web-vite-multithread`, both multithreaded, on main as on the
branch that found it. The release glue and the single-threaded debug glue are rewritten, and CI runs `e2e:prod` alone.

- Seen: 2026-11-24
- Check: `pnpm --filter=@crossbind/e2e-web-vite-multithread run e2e:dev 2>&1 | grep -m1 'optional rewrite missed'`
  prints a line.
- Remove when the pattern takes the whitespace inside the braces and both fixtures' `e2e:dev` pass `cpp:optionalNone`.

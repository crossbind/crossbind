# Known issues

Defects and gaps that are real but not yet fixed, so a later session does not rediscover them.

Every entry carries the command that proves it is still real. Run the check before acting on an
entry, and delete the entry when the check comes back clean — an entry nobody can verify is worse
than no entry. Scope each check so it cannot match this file, which quotes what the checks look for.

Fixing something here is not a prerequisite for anything else; this is a list, not a queue.

## fsync in a Node.js wasm build does not reach the disk

Emscripten's WasmFS Node backend has no `NodeFile::flush`, so an `fsync` or `fdatasync` on a host file used to
trap and abort the module; SQLite's unix VFS calls one on every commit. `core/crossbind/src/assets/cpp-runtime/node.cpp`
answers both for host files without the backend, as NODERAWFS does: the data has reached the operating system, but
nothing forces it to disk.

- Seen: 2026-10-15
- Check: `docker run --rm --entrypoint grep "ghcr.io/crossbind/web@$(node -p "require('./core/crossbind/src/assets/toolchain-digests.json').images.web.index")" -c 'implement NodeFile::flush' /emsdk/upstream/emscripten/system/lib/wasmfs/backends/node_backend.cpp` prints 1.
- Remove when the pinned emsdk implements `NodeFile::flush`; then drop the `--wrap` pair from `buildWasm.js` and `node.cpp`.

## android-app's build tools carry a Guava with CVE-2026-102554

Guava's DoS while deserializing, fixed in Guava 33.7.2, ships inside three of the android-app image's build tools:
Gradle 9.8.1's `lib/guava-33.4.6-jre.jar`, the Android Gradle plugin's `guava-33.4.0-jre` in the offline cache (AGP
9.5.0 still takes 33.4.0) and Guava 33.3.1 inside the Kotlin Gradle plugin's jar. None has a release with the fix, and
they deserialize the build's own data, not input from outside, so `.trivyignore` lets the image scans pass it until
its date.

- Seen: 2026-11-02
- Check: `docker run --rm --entrypoint sh "ghcr.io/crossbind/android-app@$(node -p "require('./core/crossbind/src/assets/toolchain-digests.json').images['android-app'].index")" -c 'ls /opt/gradle/lib; find /opt/gradle-ro-cache -name "guava-*.jar"' | grep -E 'guava-33\.[0-6]\.'` prints a jar.
- Remove when Gradle, AGP and the Kotlin Gradle plugin that the image pins all take Guava 33.7.2 or later; then delete the entry from `.trivyignore`. Before 2026-12-15, renew its date after a fresh review, or the scans fail.

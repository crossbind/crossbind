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

// What a worker of the page gets, for src/web-features.js. It imports nothing, so it loads as a classic and as a module
// worker alike.
(async () => {
    const failure = (error) => `error: ${error.name}: ${error.message}`;
    const result = { isSecureContext: self.isSecureContext };
    try {
        await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
        result.wasm = 'ok';
    } catch (error) {
        result.wasm = failure(error);
    }
    try {
        const root = await navigator.storage.getDirectory();
        const file = await root.getFileHandle('page-gets-worker.bin', { create: true });
        const handle = await file.createSyncAccessHandle();
        handle.write(new Uint8Array([1, 2, 3]), { at: 0 });
        handle.flush();
        result.opfsSync = `ok: ${handle.getSize()} bytes`;
        handle.close();
        await root.removeEntry('page-gets-worker.bin');
    } catch (error) {
        result.opfsSync = failure(error);
    }
    postMessage(result);
})();

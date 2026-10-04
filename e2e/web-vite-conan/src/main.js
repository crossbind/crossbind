import { initNative, zlibVersion, compressBound } from 'conan:zlib/zlib.h';
import { png_access_version_number } from 'conan:libpng/png.h';
import { ConanApp } from './native/conan.h';

// Calls return promises when initNative runs the module in a worker, plain values otherwise.
async function show(id, values) {
    const element = document.getElementById(id);
    try {
        element.textContent = (await Promise.all(values)).join(' ');
    } catch (e) {
        element.textContent = `ERROR ${e?.message ?? e}`;
    }
}

await initNative();
await show('zlib', [zlibVersion(), compressBound(1000)]);
await show('png', [png_access_version_number()]);
await show('app', [ConanApp.crc32('crossbind'), ConanApp.format(3.14159), ConanApp.formatError()]);

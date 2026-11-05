import { app, windows } from 'crossbind/app';
// A bound header would bring it, whose SWIG runs in Docker, which a macOS runner has not.
import '/crossbind.js';

globalThis.Crossbind.initNative().then(async () => {
    const { data } = await app.paths();
    const { id } = await windows.current();
    const message = `window ${id}, data in ${data}`;
    document.querySelector('#message').textContent = message;
    console.log(`BARE ${message}`);
});

// `node --import crossbind/node/dev app.mjs`: builds this machine's binary when the app's native sources or imports
// changed since the last build it ran, then serves the app's native imports through the hooks that build wrote.
import { pathToFileURL } from 'node:url';
import loadConfig from '../state/loadConfig.js';
import { DEV_BUILD_ENV, ensureDevBuild, projectDirOf } from '../utils/nodeDevBuild.js';

if (!process.env[DEV_BUILD_ENV]) {
    // node --watch restarts when a build rewrites the outputs the last start loaded. Its SIGTERM waits for the build
    // and its record, then ends this start: the next one finds the build done instead of starting it over.
    let restarting = false;
    const restart = () => { restarting = true; };
    process.on('SIGTERM', restart);
    const hooks = ensureDevBuild(await loadConfig(projectDirOf(process.argv[1])));
    // A signal that came during the build is handled on the next turn of the event loop.
    await new Promise((resolve) => { setImmediate(resolve); });
    process.off('SIGTERM', restart);
    if (restarting) process.exit(143);
    if (hooks) await import(pathToFileURL(hooks).href);
}

import { CREATE_COMMAND, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

const suffix = RELEASE.distTagSuffix;

export default {
    slug: 'electron',
    title: 'Electron',
    description: 'Load a Node-API addon in Electron\'s main process, call it from the window, and package the app.',
    lede: 'Electron\'s main process is Node.js, so it loads the same Node-API addon crossbind builds for [Node.js](/guide/node/#addon). The window has no Node.js: a preload script exposes the calls it needs, and the main process answers them over IPC.',
    blocks: [
        { type: 'h2', id: 'setup', text: 'Setup' },
        { type: 'p', text: 'Start from the template:' },
        { type: 'code', file: 'shell', code: `${CREATE_COMMAND} my-app Desktop Electron` },
        { type: 'p', text: 'Or, in an existing app, add this config and build the addon:' },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'my-app' },
    paths: {
        config: import.meta.url,
        output: 'dist',
    },
};`,
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install -D crossbind${suffix} @crossbind/core-embind-napi${suffix}
npx crossbind build -p host -e node -b release`,
        },
        {
            type: 'p',
            text: 'C++ goes in `src/native`. The build writes this machine\'s addons, one per architecture, as `dist/my-app.<platform>-<arch>.node`, and the loader `dist/my-app.native.cjs`, which picks one at run time. `-p darwin,linux,win32` builds all three desktop platforms.',
        },

        { type: 'h2', id: 'addon', text: 'The addon in the main process' },
        { type: 'p', text: 'Load the addon in the main process and answer the window over IPC:' },
        {
            type: 'code',
            file: 'src/main.js',
            code: `const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const initNative = require('../dist/my-app.native.cjs');

ipcMain.handle('native:sample', async () => {
    const { Native } = await initNative();
    return Native.sample();
});

app.whenReady().then(() => {
    const window = new BrowserWindow({
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    window.loadFile(path.join(__dirname, 'index.html'));
});`,
        },
        {
            type: 'code',
            file: 'src/preload.js',
            code: `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
    sample: () => ipcRenderer.invoke('native:sample'),
});`,
        },
        {
            type: 'p',
            text: 'The page calls `await window.native.sample()` and keeps Electron\'s sandbox. A prebuilt port works the same way: install its `-standalone-napi` package and import it in the main process, as on [Node.js](/guide/node/#addon).',
        },
        {
            type: 'p',
            text: 'Nothing is rebuilt per Electron version: Node-API is ABI-stable, so the same addon loads in Node.js and in Electron, on Windows too, and `electron-rebuild` is not needed.',
        },

        { type: 'h2', id: 'packaging', text: 'Packaging' },
        {
            type: 'p',
            text: 'Keep crossbind\'s output outside the asar archive: a library\'s native code reads its data, such as `proj.db`, with file APIs that cannot open a file inside the archive. With electron-builder:',
        },
        {
            type: 'code',
            file: 'electron-builder.yml',
            code: `directories:
  output: out
files:
  - src/**
  - dist/**
  - '!dist/prebuilt'
asarUnpack:
  - dist/**`,
        },
        {
            type: 'p',
            text: '`directories.output` moves electron-builder\'s output out of `dist`, where crossbind writes, and `dist/prebuilt` (the static archives the addon was linked from) stays out of the app. Package each platform with its addons in `dist`; the loader picks the one for the machine.',
        },
        {
            type: 'p',
            text: 'A `-standalone-napi` port keeps its data in its own `dist/data`, so unpack `node_modules/@crossbind/**` as well. Electron Forge takes `packagerConfig.asar.unpackDir: \'dist\'`, and under pnpm it also wants `node-linker=hoisted`.',
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                '**macOS addons build only on a Mac** with Xcode\'s command line tools. Linux and Windows addons build in Docker on any host, a Mac included.',
                '**One Node environment per process.** The addon cannot load again in a `worker_threads` worker of the main process; `initNative()` there rejects with an error.',
            ],
        },
        {
            type: 'p',
            text: `[examples/desktop-electron](${REPO_URL}/tree/main/examples/desktop-electron) is a complete app with electron-builder packaging, and a test that CI runs on macOS, Linux and Windows.`,
        },
    ],
};

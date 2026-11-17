export default {
    slug: 'filesystem',
    title: 'Files',
    description: 'Where files live per runtime (OPFS, memory, the host disk) and how to open the files a user picks.',
    lede: 'C++ wants paths. What a path means depends on where the module runs: the real disk in Node.js, an origin-private store or memory in the browser, and the isolate\'s memory on the edge.',
    blocks: [
        { type: 'h2', id: 'roots', text: 'The two browser roots' },
        {
            type: 'entries',
            items: [
                {
                    name: '`/opfs/<app>/`',
                    text: 'The Origin Private File System: files survive a reload. It needs `fs.opfs` on (the default in `mt` builds), the module in a worker, and a browser that supports it.',
                },
                { name: '`/memfs/<app>/`', text: "Memory: files last for the tab's session. Always there." },
            ],
        },
        {
            type: 'p',
            text: '`<app>` is `general.name` from `crossbind.config.js`. Browsers give OPFS its synchronous file access only in workers, so:',
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'OPFS requires useWorker: true',
            text: 'Mounting `/opfs/...` on the page thread throws. Where the browser has no OPFS, or blocks it, the path falls back to `/memfs/` and the reason is logged: writes keep working but no longer persist.',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `const m = await initNative({
    useWorker: true,      // the browser default; OPFS needs it
    fs: { opfs: true },   // the default in mt builds
});

// Anything under /opfs/<app>/ is still there after a reload.
m.FS.writeFile('/opfs/myapp/data.bin', new Uint8Array([1, 2, 3]));`,
        },

        { type: 'h2', id: 'helpers', text: 'Module helpers' },
        {
            type: 'entries',
            items: [
                { name: '`m.FS`', text: 'The virtual filesystem: `mkdirTree`, `writeFile`, `readFile` and the rest.' },
                { name: '`m.getDefaultPath()`', text: 'Returns `/opfs` or `/memfs`, for the current configuration.' },
                { name: '`m.getFinalPath(path)`', text: 'Checks a path, falling back when OPFS is unavailable.' },
                { name: '`m.getRandomPath(startPath?)`', text: 'Creates `<start>/<app>/automounted/<random>` and returns it.' },
                { name: '`m.autoMountFiles(files, parentPath?)`', text: 'Streams `File[]` into the filesystem and returns their paths.' },
                { name: '`m.getFileBytes(path)`', text: "A file's contents as a `Uint8Array`." },
                { name: '`m.getFileList(startPath?)`', text: 'A recursive listing as `[{ path, size }]`.' },
            ],
        },
        {
            type: 'code',
            file: 'JavaScript',
            code: `m.FS.mkdirTree('/memfs/myapp/cache');
m.FS.writeFile('/memfs/myapp/cache/data.bin', new Uint8Array([1, 2, 3]));
const bytes = m.FS.readFile('/memfs/myapp/cache/data.bin');`,
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'm.FS exists only after init',
            text: 'Use it after `initNative()` resolves, or in `onRuntimeInitialized`.',
        },

        { type: 'h2', id: 'user-files', text: 'Files the user picked' },
        {
            type: 'p',
            text: 'A `File` from an `<input type=file>` has no path your C++ can open. `autoMountFiles` streams it in and returns paths that work, with no size limit beyond storage.',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `const input = document.querySelector('input[type=file]');

input.addEventListener('change', async () => {
    const paths = await m.autoMountFiles(Array.from(input.files));
    // e.g. ['/opfs/myapp/automounted/123456/photo.jpg']
    for (const path of paths) {
        m.processImage(path);
    }
});`,
        },
        {
            type: 'p',
            text: 'Pass a second argument to mount into a known folder instead of a random one: `await m.autoMountFiles(files, \'/opfs/myapp/uploads\')`.',
        },

        { type: 'h2', id: 'reading-back', text: 'Getting results back to JavaScript' },
        {
            type: 'p',
            text: 'C++ writes to a path; JavaScript reads the bytes back:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `m.processImage('/opfs/myapp/uploads/photo.jpg');

const bytes = m.getFileBytes('/opfs/myapp/uploads/photo.processed.jpg');
const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
imgEl.src = url;`,
        },

        { type: 'h2', id: 'per-runtime', text: 'Per-runtime cheat sheet' },
        {
            type: 'entries',
            items: [
                { name: 'Browser, `useWorker: false`', text: "`/opfs` throws; `/memfs` lasts for the tab's session." },
                { name: 'Browser, in a worker (the default)', text: "`/opfs` persists in `mt` builds, or falls back to `/memfs`; `/memfs` lasts for the tab's session." },
                { name: 'Node.js', text: '`m.FS` reads and writes the real disk; `/memfs` is a folder in memory.' },
                { name: 'Cloudflare Workers and other edge runtimes', text: '`m.FS` lives in memory and is gone with the isolate; there is no `/opfs`.' },
                { name: 'React Native', text: "C++ opens real files in the app's sandbox; there is no `m.FS`." },
            ],
        },

        { type: 'h2', id: 'pitfalls', text: 'Pitfalls' },
        {
            type: 'ul',
            items: [
                '**No worker, no OPFS.** Mounting `/opfs` on the page thread throws: keep the worker on (the browser default), or write under `/memfs/`.',
                '**OPFS off.** An `/opfs/...` path throws too while OPFS is off: the default in `st` builds, or with `fs: { opfs: false }`.',
                '**A path outside the app folder.** Writes to `/memfs/foo` work but sit outside `/memfs/<app>/`, which is cleaned up on terminate.',
                '**Expecting OPFS to cross origins.** It does not: files written by one origin are invisible to another.',
            ],
        },
    ],
};

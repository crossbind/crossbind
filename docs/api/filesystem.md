# Filesystem — OPFS, memfs, node-fs, edge

> Where files live depends on the runtime and your `initNative` options. This page covers every combination.

## The decision tree

```
Are you on the browser?
├── No (Node.js)
│   └── m.FS reads/writes the host filesystem via fs-node adapter.
│       Paths are real filesystem paths, except /memfs, which lives in memory.
│
├── No (Cloudflare Worker / Deno Deploy / Vercel Edge)
│   └── m.FS is in-memory only.
│       No persistence across invocations.
│       No useWorker available (edge runtimes don't have Web Workers).
│       No OPFS available (browser-only API).
│
└── Yes (browser)
    │
    ├── Need persistence across page reloads?
    │   ├── No  → fs: { opfs: false }  → mount under /memfs/<app>/
    │   │
    │   └── Yes → REQUIRES useWorker: true and fs.opfs (on by default in mt builds)  → mount under /opfs/<app>/
    │             ├── Browser supports OPFS? (Chrome 86+, FF 111+, Safari 15.2+)
    │             │   ├── Yes → runtime preflight: getDirectory() actually works?
    │             │   │   ├── Yes → real persistence
    │             │   │   └── No  → logs error + falls back to /memfs/<app>/
    │             │   │            (broken/blocked backends, e.g. Playwright WebKit)
    │             │   └── No  → crossbind logs error + redirects to /memfs/<app>/
    │             │
    │             └── Mounted from main thread (no useWorker)?
    │                 → throws: "OPFS is only available inside a Worker scope"
    │
    └── Need to mount user-provided files?
        → Use m.autoMountFiles(files, parentPath?) with File[] from <input type=file>
```

## The two virtual roots in browser

crossbind mounts two folders at the root of the module's filesystem:

- **`/opfs/<app>/`:** the browser's Origin Private File System. Files survive reloads and browser restarts. It needs `useWorker: true`, `fs.opfs` (the default in `mt` builds) and a browser that supports it.
- **`/memfs/<app>/`:** memory. Files last for the tab's session. Always there.

`<app>` is `general.name` from `crossbind.config.js` (the same name the CLI uses for `lib<name>.a`).

## Helpers on the Module object

```js
m.getDefaultPath()           // → '/opfs' or '/memfs' depending on config
m.getFinalPath(path)         // validate + auto-fallback if OPFS unavailable
m.getRandomPath(startPath?)  // → '<startPath>/<app>/automounted/<random>'
                             //   (creates the dir tree)

m.autoMountFiles(files, parentPath?)
  // files: File[] (e.g. from <input type=file>)
  // parentPath: optional; if omitted, uses getRandomPath()
  // Streams each file into the Wasm fs, returns the mount paths.
  // Returns: Promise<string[]> (the resolved paths of each mounted file)

m.getFileBytes(path)         // → Uint8Array
m.getFileList(startPath?)    // → [{ path, size }, ...] (recursive)
```

## Writing your own files

Use `m.FS` directly (Emscripten's standard API):

```js
m.FS.mkdirTree('/memfs/myapp/cache')
m.FS.writeFile('/memfs/myapp/cache/data.bin', new Uint8Array([1, 2, 3]))
const bytes = m.FS.readFile('/memfs/myapp/cache/data.bin')
```

If you write to `/opfs/...` without `useWorker: true`, this throws. If OPFS isn't supported by the browser, the path is auto-redirected to `/memfs/...` (with a `console.error`).

## Mounting from a `<input type=file>` element

```js
const fileInput = document.querySelector('input[type=file]')
fileInput.addEventListener('change', async () => {
  const paths = await m.autoMountFiles(Array.from(fileInput.files))
  // `paths` is e.g. ['/opfs/myapp/automounted/123456/photo.jpg', …]
  for (const p of paths) {
    m.processImage(p)  // call into your C++
  }
})
```

To put them in a known location instead of an auto-random dir:

```js
await m.autoMountFiles(files, '/opfs/myapp/uploads')
```

## Reading from `m.FS` and shipping bytes back to JS

```js
m.processImage('/opfs/myapp/uploads/photo.jpg')   // C++ writes /opfs/myapp/uploads/photo.processed.jpg
const bytes = m.getFileBytes('/opfs/myapp/uploads/photo.processed.jpg')
const blob  = new Blob([bytes], { type: 'image/jpeg' })
const url   = URL.createObjectURL(blob)
imgEl.src = url
```

## Common pitfalls

1. **Mounting `/opfs` on the main thread without `useWorker: true`** → throws; turn on `useWorker` or mount under `/memfs/`.
2. **Forgetting the `<app>` prefix** → crossbind auto-creates `/memfs/<app>/automounted` at startup. If you write to `/memfs/foo` (no `<app>`) it works but won't be cleaned up on `terminate`.
3. **Assuming OPFS persists across origins** — it doesn't. Files written from `app.example.com` are invisible to `other.example.com`. Standard origin isolation.
4. **Using `m.FS` from before `onRuntimeInitialized`** — `m.FS` is undefined until init completes. Use the `onRuntimeInitialized: (m) => {…}` hook or await the `initNative(...)` promise first.
5. **Mounting `/opfs/...` with OPFS off**, by `fs: { opfs: false }` or in an `st` build that does not set `fs: { opfs: true }` → throws: "OPFS is disabled. Enable fs.opfs in config to mount under /opfs/."

## Per-runtime cheat sheet

- **Browser without a worker:** `/opfs/...` throws; `/memfs/...` works, for the tab's session.
- **Browser with `useWorker: true`:** `/opfs/...` persists where the browser supports OPFS, else falls back to `/memfs/`; `/memfs/...` works.
- **Node.js:** no worker and no `/opfs`. `/memfs/...` is in memory, and every other path is the host disk, through the fs-node adapter; `fsync` on a host file returns once the OS has the data, without forcing it to disk.
- **Cloudflare Worker and other edge runtimes:** no worker and no `/opfs`. The whole filesystem, `/memfs` included, is in memory and does not persist.
- **React Native (CLI and Expo):** no `/opfs` or `/memfs`; C++ uses the app's sandbox storage.

## See also

- [`init.md`](./init.md) — `useWorker`, `fs.opfs` options.
- [`threading.md`](./threading.md) — `useWorker` is independent of threading.
- Source: `core/crossbind/src/assets/js-runtime/adapters/fs-browser.js` (the OPFS guards).

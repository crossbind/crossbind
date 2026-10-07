# @crossbind/example-desktop-electron
**crossbind Electron sample**

An Electron app whose main process runs C++: crossbind builds `src/native` and the matrix library
into a Node-API addon, the main process loads it (`src/main.js`), and the window asks it for results
over IPC (`src/preload.js`), so the window keeps Electron's sandbox and has no Node.js.

Node-API is ABI-stable: the addon Node.js loads loads in Electron too, with no rebuild per Electron
version and nothing for `electron-rebuild` to do.

# Getting Started

>**Note**: Make sure you have completed the [crossbind - Prerequisites](https://crossbind.dev/docs/guide/getting-started/prerequisites) instructions.
The bindings and the Linux and Windows addons build in Docker; the macOS addons build on a macOS
host with Xcode's command line tools.

## Setup

Install the dependencies:

```bash
pnpm install
```

Inside the crossbind repository, build the library's archives for the desktop platforms first:
`pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:desktop`.

## Get Started

Build the addon of this machine's platform, for arm64 and x64, and start the app:

```bash
pnpm run build
pnpm start
```

`pnpm run build:desktop` builds the addons of macOS, Linux and Windows instead.

## Package

```bash
pnpm run package
```

[electron-builder](https://www.electron.build) writes the app to `out/`; `npx electron-builder`
makes the installers. `electron-builder.yml` keeps `dist/` outside the asar archive: Electron loads
the addon from there as it is, and native code cannot read a library's data, such as `proj.db`,
inside the archive. Rename the app there (`productName`).

## Test

`pnpm run e2e:dev` opens the app from its sources with Playwright, `pnpm run e2e:prod` packages it
and opens the packaged app. On Linux they need a display, e.g. `xvfb-run -a pnpm run e2e:prod`.

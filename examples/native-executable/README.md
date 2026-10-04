# @crossbind/example-native-executable
**crossbind native executable sample**

A C++ `main()` and the matrix library linked into one executable per platform: Linux (glibc and
musl), macOS and Windows, each for arm64 and x64. Nothing else ships beside it: the library is
linked in, and the musl build is fully static, so it runs on any Linux.

| Platform | Output | Runs on |
|---|---|---|
| `linux` | `dist/crossbind-example-native-executable.linux-<arch>` | glibc 2.28 or later |
| `linuxmusl` | `dist/crossbind-example-native-executable.linuxmusl-<arch>` | any Linux |
| `darwin` | `dist/crossbind-example-native-executable.darwin-<arch>` | macOS 11 or later |
| `win32` | `dist/crossbind-example-native-executable.win32-<arch>.exe` | Windows 10 or later |

# Getting Started

>**Note**: Make sure you have completed the [crossbind - Prerequisites](https://crossbind.dev/docs/guide/getting-started/prerequisites) instructions.
The Linux and Windows executables build in Docker; the macOS ones build on a macOS host with
Xcode's command line tools, without Docker, and are skipped elsewhere.

## Setup

Install the dependencies:

```bash
pnpm install
```

Inside the crossbind repository, build the library's archives for the desktop platforms first:
`pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:desktop`.

## Get Started

Build the executables:

```bash
pnpm run build
```

`pnpm run build:darwin` builds only the macOS ones.

Run it:

```bash
./dist/crossbind-example-native-executable.linux-x64
```

Put your own code in `src/native`: the file with `main()` and any other sources there are compiled
into the executable, and the libraries in `crossbind.config.mjs` are linked in. See
[native executables](https://github.com/crossbind/crossbind/blob/main/docs/api/native.md).

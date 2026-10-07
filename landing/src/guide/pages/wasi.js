export default {
    slug: 'wasi',
    title: 'WASI commands',
    description: 'Compile to a single wasm command, or run the prebuilt CLI tools straight from npm.',
    lede: 'With `platform: \'wasi\'` there is no JavaScript host at all. Your C++ becomes one `wasm32-wasip3` command component that runs under any WASI 0.3 runtime with Wasm 3.0 exception support - wasmtime 47 and newer. No glue, no loader, no `initNative`.',
    blocks: [
        { type: 'h2', id: 'build', text: 'Build a command' },
        {
            type: 'p',
            text: 'Provide a `main(int, char**)` in `src/native` and build with `-p wasi`. The output is a single `.wasm` file:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind build -p wasi -e wasi -b release
wasmtime run --dir=. dist/myapp-wasi-wasm32-st-release.wasm input.txt`,
        },
        {
            type: 'p',
            text: 'There is nothing to configure to get started: the build runs inside the Docker image, which ships a wasi-sdk. For native-speed builds, build on the host with your own sdk (34 or newer, with the `wasm32-wasip3` sysroot):',
        },
        {
            type: 'code',
            file: 'shell',
            code: 'CROSSBIND_RUNNER=LOCAL CROSSBIND_WASI_SDK_PATH=/opt/wasi-sdk crossbind build -p wasi -e wasi -b release',
        },

        { type: 'h2', id: 'io', text: 'Files and network' },
        {
            type: 'p',
            text: 'Data files declared by your dependency graph land in a real `dist/data/` folder, which you preopen with `--dir`. Sockets work through `wasi:sockets` when the runtime grants them:',
        },
        {
            type: 'code',
            file: 'shell',
            code: 'wasmtime run -S inherit-network=y -S allow-ip-name-lookup=y -S tcp=y --dir=. app.wasm',
        },
        {
            type: 'p',
            text: 'This is the same `data` / `env` declaration described in [Assets](/guide/assets/); on WASI it doubles as the runtime contract - directories become preopens, `env` becomes the guest environment.',
        },

        { type: 'h2', id: 'packages', text: 'Prebuilt -wasi libraries' },
        {
            type: 'p',
            text: 'Library packages ship a dedicated WASI variant next to their `-wasm`, `-android` and `-ios` siblings. Depend on `@crossbind/port-<name>-wasi` when you target WASI; recipes, patches and data travel inside the package.',
        },

        { type: 'h2', id: 'tools', text: 'CLI tools from npm' },
        {
            type: 'p',
            text: 'Where an upstream project ships command-line tools, a `-standalone-wasi` package publishes them prebuilt. Install and run - no compiler involved, only wasmtime on your PATH:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm i -g @crossbind/port-gdal-standalone-wasi
gdalinfo-wasi --version
ogr2ogr-wasi out.gpkg in.geojson`,
        },
        {
            type: 'p',
            text: 'Every tool is exposed as `<tool>-wasi`, so a native install of the same tool is never shadowed. The launcher resolves mounts and guest environment from the package itself - the gdal family mounts its `GDAL_DATA` and `PROJ_DATA` folders, openssl provides the CA bundle for https. Tools that are mapped but not published print the exact from-source build command rather than failing silently.',
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'What ships with each tool package',
            text: 'Third-party notices, a CycloneDX SBOM, and a machine-readable provenance block naming the sources, toolchain and build environment. The npm `license` field is the derived compound expression of everything statically linked inside.',
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                'No processes and no dynamic loading.',
                'Single-threaded for now.',
                'Rust is skipped on this platform - there is no `wasm32-wasip3` Rust target yet.',
                'Anything unsupported fails cleanly at runtime instead of trapping at instantiation.',
            ],
        },
    ],
};

import { CREATE_COMMAND } from '../../data.js';

export default {
    slug: 'cli',
    title: 'CLI',
    description: 'Every crossbind command and option, and what each one touches before you run it.',
    lede: 'The `crossbind` package installs one command. Bundler plugins and React Native builds run the build for you; the other commands build and open apps, list licenses, manage the build containers and runners, sign in to crossbind cloud and edit the machine settings.',
    blocks: [
        { type: 'h2', id: 'commands', text: 'Commands at a glance' },
        {
            type: 'table',
            head: ['Command', 'Does', 'Touches'],
            rows: [
                ['`build`', 'compiles the project', 'Docker or a runner, the network, `.crossbind/`, `paths.output`'],
                ['`app`', 'builds the project as an app with its Vite, opens it on the dev server, or makes the key pair for its updates','what `build` touches, `dist/`, `~/.crossbind/android/`, the attached Android device or the iOS Simulator'],
                ['`licenses`', 'lists the licenses of the native dependencies', 'reads the project; writes only the files you ask for'],
                ['`clean-deps`', 'deletes dependencies rebuilt from source', '`.crossbind/deps/`'],
                ['`docker`', 'manages the toolchain containers', 'Docker'],
                ['`runner`', 'starts, removes or scaffolds build runners', 'Docker (`start`, `delete`), a new folder (`init`)'],
                ['`login`, `logout`, `usage`, `account delete`', 'your crossbind cloud account', 'crossbind cloud, `~/.crossbind/credentials.json`'],
                ['`config`', 'the machine settings', '`~/.crossbind.json`'],
            ],
        },
        {
            type: 'p',
            text: 'Run it from a package script or with `npx crossbind`. `login`, `logout`, `usage`, `account`, `config` and `--version` (`-V`) work anywhere; the other commands load the project in the current folder before they read the command line, and fail outside one. `--help` after a command lists its options. A failure prints a short message; set `DEBUG=1` to see the whole error.',
        },

        { type: 'h2', id: 'build', text: 'build' },
        {
            type: 'code',
            file: 'shell',
            code: 'crossbind build -p wasm -a wasm32 -r st -e browser -b release',
        },
        {
            type: 'table',
            head: ['Option', 'Values', 'Without it'],
            rows: [
                [
                    '`-p, --platform`',
                    "`wasm`, `wasi`, `android`, `ios`, `darwin`, `linux`, `linuxmusl`, `win32`, or `host` for this machine's desktop platform",
                    '`wasm`, `wasi`, `android` and `ios`; the desktop platforms build only when named',
                ],
                ['`-a, --arch`', '`wasm32`, `wasm64`, `arm64-v8a`, `x86_64`, `iphoneos`, `iphonesimulator`, `arm64`, `x64`', 'every arch but `wasm64`'],
                ['`-r, --runtime`', '`st`, `mt`', 'both'],
                ['`-b, --build-type`', '`release`, `debug`', '`release`'],
                ['`-e, --runtime-env`', '`browser`, `edge`, `node`, `native`, `wasi`, `http`, `app`', '`target.runtimeEnv` from `crossbind.config.js`; with neither, only the archives'],
                ['`--rebuild-deps [list]`', '`all`, or dependency names separated by commas', 'prebuilt dependencies'],
                ['`--bind-imports`', 'none', 'a `browser` module binds only the headers in `paths.native`'],
            ],
        },
        {
            type: 'p',
            text: 'A list option takes commas or repeats (`-p darwin,linux` or `-p darwin -p linux`), and a value outside its list stops with the allowed ones. The target matrix decides which combinations exist: `android`, `ios` and the desktop platforms build `mt` only, `wasi` and `edge` builds are single-threaded, and `ios` and `darwin` build on a Mac and are skipped elsewhere.',
        },
        {
            type: 'p',
            text: '`-e` names the binaries to make: on `wasm`, `browser`, `edge` and `node` each give a module and its loader; on a desktop platform, `node` gives a Node-API addon and `native` an executable; on `wasi`, `wasi` gives a command and `http` a wasi:http component. `app` gives an app without its page, which `app build` adds, for each platform `-p` names: the app itself on `darwin`, `linux` and `win32`, its Xcode or Gradle project on `ios` and `android`. Otherwise Android and iOS take none, since React Native links the archives. See [Browser](/guide/browser/), [Node.js](/guide/node/) and [Executables](/guide/executables/).',
        },
        {
            type: 'p',
            text: '`--rebuild-deps` builds the named dependencies from source into `.crossbind/deps/` instead of using their prebuilt archives; `CROSSBIND_REBUILD_DEPS` does the same from the environment. In a port with a `crossbind.build.js` recipe, `build` downloads the pinned upstream source, checks it against the SHA-256 the recipe pins and builds the archives.',
        },
        {
            type: 'p',
            text: "`--bind-imports` also binds what the app's JavaScript imports (own headers and `.rs` files, port headers, `cargo:` and `conan:`) into a `browser` module, as a `node` module always does, and writes `browser/imports.json` beside it: each bound file, the bare specifiers that name it and its names. It is for a page that resolves those imports itself, as the playground does; with a bundler the plugin binds what it transforms. Rust without a bundler needs `@crossbind/core-embind-rust` among the app's dependencies.",
        },
        {
            type: 'p',
            text: '**Touches:** under the default `RUNNER`, it pulls the pinned toolchain images and runs a container for each step ([Remote builds](/guide/remote-builds/) moves the steps elsewhere); `ios` and `darwin` compile with Xcode on the Mac. It writes the cache in `.crossbind/`, the output folder (`paths.output`, `.crossbind/build` unless the config names another), `conan.lock` and `crossbind.cargo.lock` next to the config for a project with Conan packages or crates, and shared caches under `~/.crossbind/`, and downloads crates, Conan packages and sources a build needs.',
        },

        { type: 'h2', id: 'app', text: 'app' },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind app dev
crossbind app build -p android`,
        },
        {
            type: 'table',
            head: ['Command', 'Does'],
            rows: [
                ['`app dev [-p platform]`', 'opens the app on the dev server: an edit to the page reloads it, an edit to native code rebuilds the host and opens the app again'],
                ['`app build [-p platform]`', 'builds the page and the host and writes the app to `dist/`'],
                ['`app updater-key`', "prints a new key pair for a desktop app's updates: the public key for `app.updater.publicKey`, the private one for `CROSSBIND_UPDATER_PRIVATE_KEY` where the app is built"],
            ],
        },
        {
            type: 'p',
            text: "`-p` is `macos`, `linux`, `windows`, `ios` or `android`; without it the platform `CROSSBIND_APP_PLATFORM` names, else this machine's desktop app. Vite's own options, such as `--port` or `--mode`, pass through to Vite. `app build -p linux` and `app build -p windows` write the Linux and Windows apps for x64 and arm64, on a Mac as well. `app build -p android` writes `dist/<name>-android.apk`, signed with this machine's debug key, or with the upload key `CROSSBIND_ANDROID_KEYSTORE`, `CROSSBIND_ANDROID_KEY_ALIAS` and `CROSSBIND_ANDROID_KEYSTORE_PASSWORD` name, and then also `dist/<name>-android.aab`, the bundle Google Play takes. The project needs `target: { runtimeEnv: 'app' }`, Vite and `@crossbind/plugin-vite`.",
        },
        {
            type: 'p',
            text: "**Touches:** Linux, Windows and Android apps build in the pinned linux, windows and android-app images, so only under `RUNNER=DOCKER_RUN` or `DOCKER_EXEC`, and Gradle packages an Android app there with no network, keeping its caches and the debug key in `~/.crossbind/android/`. An Android app opens on the attached device through this machine's `adb`, which crossbind does not install; an iOS app opens in the Simulator.",
        },

        { type: 'h2', id: 'licenses', text: 'licenses' },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind licenses
crossbind licenses --check
crossbind licenses --notices --sbom`,
        },
        {
            type: 'p',
            text: 'Prints one line per bundled native dependency - name, SPDX license, native version and source URL - and marks the copyleft ones with `!`. It reads the project and writes only the files you ask for.',
        },
        {
            type: 'table',
            head: ['Option', 'Does'],
            rows: [
                ['`--notices [file]`', 'writes a third-party notices Markdown file, `THIRD-PARTY-NOTICES.md` by default'],
                ['`--sbom [file]`', 'writes a CycloneDX SBOM: `sbom.cdx.json` by default, or the path the package declares in `crossbind.provenance.sbom`'],
                ['`--json [file]`', 'writes the rows with their license texts, `licenses.json` by default'],
                ['`--check`', 'exits non-zero when a license field is missing or not valid SPDX'],
                ['`--platform <platform>`', "adds what that platform's artifact links statically beyond the package graph: vendored copies and the toolchain runtime"],
                ['`-e, --runtime-env node`', 'adds the crossbind runtime an addon of `--platform` compiles in, or without `--platform` the one its loader bundles'],
                ['`-e, --runtime-env app`', "adds what an app carries beside its packages: crossbind's runtime, Hermes, JSI's `jsi.cpp` and webview/webview, adjusted to the app `--platform` names"],
                ['`--package`', "with `-e node`: writes a Node-API package's `LICENSE`, `sbom.cdx.json` and `package.json` license field"],
            ],
        },

        { type: 'h2', id: 'clean-deps', text: 'clean-deps' },
        {
            type: 'p',
            text: '`crossbind clean-deps [names...]` deletes `.crossbind/deps/`, the dependencies `--rebuild-deps` built from source, or only the ones named (by name, package name or alias). The next build goes back to their prebuilt archives unless it rebuilds them again.',
        },

        { type: 'h2', id: 'docker', text: 'docker' },
        {
            type: 'p',
            text: 'One container per toolchain image and project. `[image]` is `web` (the default), `android`, `android-app`, `linux` or `windows`.',
        },
        {
            type: 'table',
            head: ['Command', 'Does'],
            rows: [
                [
                    '`docker create [image]`',
                    "creates the long-lived container `RUNNER=DOCKER_EXEC` runs steps in, with the project's base folder and crossbind's cargo and Conan caches mounted",
                ],
                ['`docker start [image]`, `docker stop [image]`', 'starts or stops it'],
                ['`docker delete [image]`', 'removes it'],
                ['`docker run <program> [params...]`', 'runs one program the way a build step runs, in the web image under the current `RUNNER`, with `.crossbind/build` as the working folder'],
            ],
        },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind docker create
crossbind config set RUNNER DOCKER_EXEC
crossbind build -p wasm`,
        },
        {
            type: 'p',
            text: 'The default, `RUNNER=DOCKER_RUN`, needs none of these: it starts a fresh container of the pinned image for every step.',
        },

        { type: 'h2', id: 'runner', text: 'runner' },
        {
            type: 'table',
            head: ['Command', 'Options', 'Does'],
            rows: [
                [
                    '`runner start`',
                    '`--role` (`web`, `android`, `linux` or `windows`; default `web`), `--port` (8787 to 8790 by role), `--host` (default `127.0.0.1`), `--token` (default `$CROSSBIND_RUNNER_TOKEN`, else a new one)',
                    'starts `crossbind-local-runner-<role>` in the local Docker and prints the commands that point builds at it',
                ],
                ['`runner delete`', '`--role`', 'stops and removes that container'],
                [
                    '`runner init <platform>`',
                    '`fly`, `cloudflare`, `cloudrun` or `azure`; `--role`; `--dir` (default `crossbind-runner-<platform>-<role>`); `--vcpu` 1 to 4, for `cloudflare` only',
                    'writes a deploy folder and prints its steps with a new token; starts nothing',
                ],
            ],
        },
        {
            type: 'p',
            text: 'How builds use a runner: [Remote builds](/guide/remote-builds/#own-runner).',
        },

        { type: 'h2', id: 'account', text: 'login, logout, usage, account' },
        {
            type: 'table',
            head: ['Command', 'Does'],
            rows: [
                ['`login`', 'signs in to crossbind cloud with GitHub: prints a code to enter on github.com, then keeps the token in `~/.crossbind/credentials.json`'],
                ['`logout [--all]`', "forgets this machine's token and revokes it; `--all` revokes the tokens of every machine signed in to the account"],
                ['`usage`', "this month's cloud build time by image and what is left, and the playground compiles left today"],
                ['`account delete --yes`', 'deletes the account and signs out every machine; without `--yes` it deletes nothing'],
            ],
        },
        {
            type: 'p',
            text: 'They talk to `CLOUD_URL`, `https://api.crossbind.dev` unless `~/.crossbind.json` or `CROSSBIND_CLOUD_URL` names another. Limits, and what the cloud keeps: [Remote builds](/guide/remote-builds/#cloud).',
        },

        { type: 'h2', id: 'config', text: 'config' },
        {
            type: 'table',
            head: ['Command', 'Does'],
            rows: [
                ['`config get <key>`', 'prints the value and default of `<key>` and of every key whose name contains it'],
                ['`config set <key> <value>`', 'sets one key in `~/.crossbind.json`, which is rewritten with every key, unset ones at their defaults; an unknown key, or a `RUNNER` value outside its four, is refused'],
                ['`config delete <key>`', 'removes a key, so its default applies again'],
                [
                    '`config list [-t all|system|project]`',
                    'prints the machine settings (`system`, the default); `all` adds the resolved project configuration and `project` prints it alone, so both need a project',
                ],
                ['`config keys`', 'lists every key with its description and default'],
            ],
        },
        {
            type: 'table',
            head: ['Key', 'Default', 'Sets', 'Environment'],
            rows: [
                ['`RUNNER`', '`DOCKER_RUN`', 'where toolchain steps run: `DOCKER_RUN`, `DOCKER_EXEC`, `LOCAL` or `REMOTE`', '`CROSSBIND_RUNNER`'],
                [
                    '`REMOTE_URL`, `REMOTE_URL_WEB`, `REMOTE_URL_ANDROID`, `REMOTE_URL_LINUX`, `REMOTE_URL_WINDOWS`',
                    '-',
                    'runner addresses under `RUNNER=REMOTE`',
                    'the same name with a `CROSSBIND_` prefix',
                ],
                ['`CLOUD_URL`', '`https://api.crossbind.dev`', 'the crossbind cloud of the account commands and cloud builds', '`CROSSBIND_CLOUD_URL`'],
                ['`XCODE_DEVELOPMENT_TEAM`', '-', 'the Xcode development team iOS builds sign with', '-'],
                ['`WASI_SDK_PATH`', '-', 'a local wasi-sdk, 34 or later, for WASI builds under `RUNNER=LOCAL`', '`CROSSBIND_WASI_SDK_PATH`'],
                ['`DOCKER_REGISTRY_MIRROR`', '-', 'a registry prefix to pull the pinned images from; the release digest stays', '`CROSSBIND_REGISTRY_MIRROR`'],
                [
                    '`DOCKER_IMAGE_WEB`, `DOCKER_IMAGE_ANDROID`, `DOCKER_IMAGE_ANDROID_APP`, `DOCKER_IMAGE_LINUX`, `DOCKER_IMAGE_WINDOWS`',
                    '-',
                    'an image to use instead of the pinned one; without the release digest, builds lose their reproducibility guarantee',
                    '`CROSSBIND_IMAGE_WEB` and the like',
                ],
            ],
        },
        {
            type: 'p',
            text: 'Runner tokens are not keys: `CROSSBIND_TOKEN` and `CROSSBIND_TOKEN_<IMAGE>` come only from the environment.',
        },

        { type: 'h2', id: 'create', text: 'npm create crossbind' },
        {
            type: 'code',
            file: 'shell',
            code: `${CREATE_COMMAND}
${CREATE_COMMAND} -- my-app Web React Vite`,
        },
        {
            type: 'p',
            text: 'A separate package, `create-crossbind`, scaffolds a project from a template. It asks for a name, a folder and a template; arguments preselect them in order - `<dir> <group> <framework|variant> [<variant>]` - and `-- --help` lists the templates. The groups are Web, Mobile, Desktop, Backend, Cloud, Native and Library. It writes the new folder and prints the next steps; it installs nothing.',
        },
    ],
};

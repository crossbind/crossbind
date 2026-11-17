import { CREATE_COMMAND } from '../../data.js';

export default {
    slug: 'cli',
    title: 'CLI',
    description: 'Every crossbind command and its options.',
    lede: 'The `crossbind` command builds native code, builds and opens apps, and manages extensions, licenses, build containers and settings. Bundler plugins and React Native run `crossbind build` for you.',
    blocks: [
        { type: 'h2', id: 'commands', text: 'Commands at a glance' },
        {
            type: 'table',
            head: ['Command', 'Does'],
            rows: [
                ['`build`', 'compiles the project'],
                ['`app`', 'builds an app, opens it on the dev server, or makes the key pair for its updates'],
                ['`add`', 'installs an extension and adds it to `crossbind.config.js`'],
                ['`licenses`', 'lists the licenses of the native dependencies'],
                ['`clean-deps`', 'deletes the dependencies built from source'],
                ['`docker`', 'manages the toolchain containers'],
                ['`runner`', 'starts, removes or scaffolds build runners'],
                ['`login`, `logout`, `usage`, `account delete`', 'your crossbind cloud account'],
                ['`config`', 'the machine settings in `~/.crossbind.json`'],
            ],
        },
        {
            type: 'p',
            text: 'Run it from a package script or with `npx crossbind`. `login`, `logout`, `usage`, `account`, `config` and `--version` (`-V`) work anywhere; the other commands need a project in the current folder. `--help` after a command lists its options. Set `DEBUG=1` to see the whole error of a failure.',
        },

        { type: 'h2', id: 'build', text: 'build' },
        {
            type: 'code',
            file: 'shell',
            code: 'crossbind build -p wasm -a wasm32 -r st -e browser -b release',
        },
        {
            type: 'entries',
            items: [
                {
                    name: '`-p, --platform`',
                    text: "`wasm`, `wasi`, `android`, `ios`, `darwin`, `linux`, `linuxmusl`, `win32`, or `host` for this machine's desktop platform.",
                    default: '`wasm`, `wasi`, `android` and `ios`; desktop platforms build only when named',
                },
                { name: '`-a, --arch`', text: '`wasm32`, `wasm64`, `arm64-v8a`, `x86_64`, `iphoneos`, `iphonesimulator`, `arm64` or `x64`.', default: 'every arch but `wasm64`' },
                { name: '`-r, --runtime`', text: '`st` (single-threaded) or `mt` (multithreaded).', default: 'both' },
                { name: '`-b, --build-type`', text: '`release` or `debug`.', default: '`release`' },
                {
                    name: '`-e, --runtime-env`',
                    text: 'The binaries to make: `browser`, `edge`, `node`, `native`, `wasi`, `http` or `app`. See below.',
                    default: '`target.runtimeEnv` from `crossbind.config.js`; without it, only the archives',
                },
                {
                    name: '`--rebuild-deps [list]`',
                    text: 'Builds `all` dependencies, or the ones named (comma-separated), from source into `.crossbind/deps/`. `CROSSBIND_REBUILD_DEPS` does the same.',
                    default: 'the prebuilt dependencies',
                },
                {
                    name: '`--bind-imports`',
                    text: "Also binds what the app's JavaScript imports into a `browser` module and writes `browser/imports.json`, for a page that resolves its imports itself, as the playground does. With a bundler, the plugin does this. Rust without a bundler needs `@crossbind/core-embind-rust` in the app's dependencies.",
                    default: 'a `browser` module binds only the headers in `paths.native`',
                },
            ],
        },
        {
            type: 'p',
            text: 'A list option takes commas or repeats: `-p darwin,linux` or `-p darwin -p linux`. Not every combination exists: `android`, `ios` and the desktop platforms build `mt` only, `wasi` and `edge` are single-threaded, and `ios` and `darwin` build only on a Mac (elsewhere they are skipped).',
        },
        { type: 'p', text: 'What `-e` makes on each platform:' },
        {
            type: 'ul',
            items: [
                'On `wasm`: `browser`, `edge` and `node` each make a module and its loader.',
                'On a desktop platform: `node` makes a Node-API addon, `native` an executable.',
                'On `wasi`: `wasi` makes a command, `http` a wasi:http component.',
                'On any app platform: `app` makes the app without its page, which `app build` adds. That is the app itself on `darwin`, `linux` and `win32`, and an Xcode or Gradle project on `ios` and `android`.',
                'Android and iOS take no other value: React Native links their archives.',
            ],
        },
        {
            type: 'p',
            text: 'More in [Browser](/guide/browser/), [Node.js](/guide/node/) and [Executables](/guide/executables/).',
        },
        { type: 'p', text: '**What it touches:**' },
        {
            type: 'ul',
            items: [
                'Each step runs in a container of the pinned toolchain image, or where [Remote builds](/guide/remote-builds/) sends it. `ios` and `darwin` compile with Xcode on the Mac.',
                'It writes the cache in `.crossbind/`, the output folder (`paths.output`, by default `.crossbind/build`) and shared caches in `~/.crossbind/`.',
                'A project with Conan packages or crates gets `conan.lock` and `crossbind.cargo.lock` next to its config.',
                'It downloads the crates, Conan packages and sources a build needs.',
            ],
        },

        { type: 'h2', id: 'app', text: 'app' },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind app dev
crossbind app build -p android`,
        },
        {
            type: 'entries',
            items: [
                { name: '`app dev [-p platform]`', text: 'Opens the app on the dev server. Editing the page reloads it; editing native code rebuilds the host and opens the app again.' },
                { name: '`app dev -p ios --device [name]`', text: 'Opens an iOS app on the connected iPhone or iPad, or the one named, instead of the Simulator.' },
                { name: '`app build [-p platform]`', text: 'Builds the page and the host and writes the app to `dist/`.' },
                {
                    name: '`app updater-key`',
                    text: "Prints a new key pair for a desktop app's updates: the public key for `app.updater.publicKey`, the private key for `CROSSBIND_UPDATER_PRIVATE_KEY` where the app is built.",
                },
            ],
        },
        {
            type: 'p',
            text: "The project needs Vite and `@crossbind/plugin-vite`. `-p` is `macos`, `linux`, `windows`, `ios` or `android`; without it, crossbind takes `CROSSBIND_APP_PLATFORM`, else this machine's desktop platform. Vite's own options, such as `--port` or `--mode`, pass through to Vite.",
        },
        {
            type: 'p',
            text: 'What each platform\'s build writes is listed in [Apps](/guide/apps/#develop). `app build -p android` signs with this machine\'s debug key, or with the upload key `CROSSBIND_ANDROID_KEYSTORE`, `CROSSBIND_ANDROID_KEY_ALIAS` and `CROSSBIND_ANDROID_KEYSTORE_PASSWORD` name, and then also writes `dist/<name>-android.aab`, the bundle Google Play takes.',
        },
        {
            type: 'p',
            text: "**What it touches:** Linux, Windows and Android apps build in the pinned Docker images, so they need `RUNNER=DOCKER_RUN` or `DOCKER_EXEC`. Android's Gradle caches and debug key stay in `~/.crossbind/android/`. An Android app opens through this machine's `adb`, which crossbind does not install. With `--device`, Xcode signs the app for its team with an account Xcode is signed in to, and registers the device with that team.",
        },

        { type: 'h2', id: 'add', text: 'add' },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind add @crossbind/extension-clipboard
crossbind add ./crossbind-extension-greeter-0.1.0.tgz`,
        },
        {
            type: 'p',
            text: "Installs an extension package (a name, `name@version` or a path) with your project's package manager and adds it to `extensions` in `crossbind.config.js`. Running it again for the same package changes nothing. On Windows, the name or path cannot hold spaces, quotes or other characters the shell reads.",
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
            text: 'Prints each bundled native dependency with its SPDX license, native version and source URL, and marks the copyleft ones with `!`. It writes a file only when an option asks for one.',
        },
        {
            type: 'entries',
            items: [
                { name: '`--notices [file]`', text: 'Writes a third-party notices file in Markdown.', default: '`THIRD-PARTY-NOTICES.md`' },
                { name: '`--sbom [file]`', text: 'Writes a CycloneDX SBOM.', default: "`sbom.cdx.json`, or the path in the package's `crossbind.provenance.sbom`" },
                { name: '`--json [file]`', text: 'Writes the list with each license text.', default: '`licenses.json`' },
                { name: '`--check`', text: "Exits non-zero when a license field is missing or not valid SPDX. With `-e`, also when the binary lacks a notice that a bundled runtime's license asks for." },
                { name: '`--platform <platform>`', text: "Adds what that platform's binary links statically beyond the package graph: vendored copies and the toolchain runtime." },
                { name: '`-e, --runtime-env node`', text: 'Adds the crossbind runtime that an addon for `--platform` compiles in; without `--platform`, the one its loader bundles.' },
                { name: '`-e, --runtime-env app`', text: "Adds what an app carries beside its packages: crossbind's runtime, Hermes, JSI's `jsi.cpp` and webview/webview, for the app `--platform` names." },
                { name: '`-e, --runtime-env native`', text: "Adds musl's libc, which a static musl executable links." },
                { name: '`--package`', text: "With `-e node`: writes a Node-API package's `LICENSE`, `sbom.cdx.json` and the license field of its `package.json`." },
            ],
        },

        { type: 'h2', id: 'clean-deps', text: 'clean-deps' },
        {
            type: 'p',
            text: '`crossbind clean-deps [names...]` deletes the dependencies `--rebuild-deps` built from source (`.crossbind/deps/`), or only the ones named. The next build uses their prebuilt archives again.',
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
                ['`docker create [image]`', 'creates the long-lived container that `RUNNER=DOCKER_EXEC` runs steps in'],
                ['`docker start [image]`', 'starts it'],
                ['`docker stop [image]`', 'stops it'],
                ['`docker delete [image]`', 'removes it'],
                ['`docker run <program> [params...]`', 'runs one program in the web image as a build step would, in `.crossbind/build`'],
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
            type: 'entries',
            items: [
                { name: '`runner start`', text: 'Starts `crossbind-local-runner-<role>` in the local Docker and prints the commands that point builds at it.' },
                { name: '`runner delete`', text: 'Stops and removes that container.' },
                { name: '`runner init <platform>`', text: 'Writes a deploy folder for `fly`, `cloudflare`, `cloudrun` or `azure` and prints its steps with a new token. It starts nothing.' },
            ],
        },
        { type: 'p', text: 'Their options:' },
        {
            type: 'entries',
            items: [
                { name: '`--role`', text: 'The toolchain the runner has: `web`, `android`, `linux` or `windows`. Every runner command takes it.', default: '`web`' },
                { name: '`--port`', text: '`start`: the port it listens on.', default: '8787 to 8790, by role' },
                { name: '`--host`', text: '`start`: the address it listens on.', default: '`127.0.0.1`' },
                { name: '`--token`', text: '`start`: the token builds send to it.', default: '`$CROSSBIND_RUNNER_TOKEN`, else a new one' },
                { name: '`--dir`', text: '`init`: the folder to write.', default: '`crossbind-runner-<platform>-<role>`' },
                { name: '`--vcpu`', text: '`init` for `cloudflare` only: 1 to 4 vCPUs.' },
            ],
        },
        {
            type: 'p',
            text: 'How builds use a runner: [Remote builds](/guide/remote-builds/#own-runner).',
        },

        { type: 'h2', id: 'account', text: 'login, logout, usage, account' },
        {
            type: 'entries',
            items: [
                { name: '`login`', text: 'Signs in to crossbind cloud with GitHub: enter the printed code on github.com. The token is kept in `~/.crossbind/credentials.json`.' },
                { name: '`logout [--all]`', text: "Forgets and revokes this machine's token. `--all` revokes the tokens of every machine signed in to the account." },
                { name: '`usage`', text: "This month's cloud build time by image and what is left, and today's playground compiles left." },
                { name: '`account delete --yes`', text: 'Deletes the account and signs out every machine. Without `--yes` it deletes nothing.' },
            ],
        },
        {
            type: 'p',
            text: 'They talk to `CLOUD_URL`: `https://api.crossbind.dev` unless `~/.crossbind.json` or `CROSSBIND_CLOUD_URL` names another. Limits, and what the cloud keeps: [Remote builds](/guide/remote-builds/#cloud).',
        },

        { type: 'h2', id: 'config', text: 'config' },
        {
            type: 'entries',
            items: [
                { name: '`config get <key>`', text: 'Prints the value and default of `<key>` and of every key whose name contains it.' },
                { name: '`config set <key> <value>`', text: 'Sets a key in `~/.crossbind.json`. An unknown key is refused.' },
                { name: '`config delete <key>`', text: 'Removes a key, so its default applies again.' },
                {
                    name: '`config list [-t all|system|project]`',
                    text: "Prints the machine settings (`system`, the default). `all` adds the project's resolved configuration and `project` prints only that, so both need a project.",
                },
                { name: '`config keys`', text: 'Lists every key with its description and default.' },
            ],
        },
        { type: 'p', text: 'The keys:' },
        {
            type: 'entries',
            items: [
                { name: '`RUNNER`', text: 'Where toolchain steps run: `DOCKER_RUN`, `DOCKER_EXEC`, `LOCAL` or `REMOTE`. Environment: `CROSSBIND_RUNNER`.', default: '`DOCKER_RUN`' },
                {
                    name: '`REMOTE_URL`, `REMOTE_URL_WEB`, `REMOTE_URL_ANDROID`, `REMOTE_URL_LINUX`, `REMOTE_URL_WINDOWS`',
                    text: 'Runner addresses for `RUNNER=REMOTE`. Environment: the same names with a `CROSSBIND_` prefix.',
                },
                { name: '`CLOUD_URL`', text: 'The crossbind cloud of the account commands and cloud builds. Environment: `CROSSBIND_CLOUD_URL`.', default: '`https://api.crossbind.dev`' },
                { name: '`XCODE_DEVELOPMENT_TEAM`', text: 'The Xcode development team iOS builds sign with.' },
                { name: '`WASI_SDK_PATH`', text: 'A local wasi-sdk, 34 or later, for WASI builds under `RUNNER=LOCAL`. Environment: `CROSSBIND_WASI_SDK_PATH`.' },
                { name: '`DOCKER_REGISTRY_MIRROR`', text: 'A registry prefix to pull the pinned images from; the release digest stays. Environment: `CROSSBIND_REGISTRY_MIRROR`.' },
                {
                    name: '`DOCKER_IMAGE_WEB`, `DOCKER_IMAGE_ANDROID`, `DOCKER_IMAGE_ANDROID_APP`, `DOCKER_IMAGE_LINUX`, `DOCKER_IMAGE_WINDOWS`',
                    text: 'An image to use instead of the pinned one. Without the release digest, builds are no longer reproducible. Environment: `CROSSBIND_IMAGE_WEB` and the like.',
                },
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
            text: 'A separate package, `create-crossbind`, scaffolds a project from a template. It asks for a name, a folder and a template, and arguments answer in order: `<dir> <group> <framework|variant> [<variant>]`. The groups are Web, Mobile, Desktop, Backend, Cloud, Native, Library and Extension; `-- --help` lists every template. It writes the folder and prints the next steps; it installs nothing.',
        },
    ],
};

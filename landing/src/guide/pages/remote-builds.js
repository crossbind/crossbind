import { REPO_URL } from '../../data.js';

export default {
    slug: 'remote-builds',
    title: 'Remote builds',
    description: 'Run the toolchain steps on crossbind cloud or on a runner of your own instead of the local Docker.',
    lede: 'Each compile, link, SWIG, cargo and Conan step of a build normally runs in a pinned Docker image on your machine. With `RUNNER=REMOTE` those steps run on a runner instead - crossbind cloud, or one you start or deploy - and the machine neither pulls an image nor starts a container.',
    blocks: [
        { type: 'h2', id: 'why', text: 'When it helps' },
        {
            type: 'ul',
            items: [
                '**A machine without Docker.** The build runs as usual; only its toolchain steps run elsewhere.',
                '**One build machine for several people.** `crossbind runner start --host 0.0.0.0` serves the other machines on a network you trust.',
                '**CI.** Environment variables choose the runner per job, with nothing written to `~/.crossbind.json`.',
            ],
        },
        {
            type: 'p',
            text: 'iOS and macOS builds still compile with Xcode on the Mac under every runner; only their bridge steps go to the web runner. Your JavaScript never leaves the machine.',
        },
        {
            type: 'p',
            text: 'Apps for Android, Linux and Windows are the exception: `crossbind app` builds them only in the local Docker, under `RUNNER=DOCKER_RUN` or `DOCKER_EXEC`, and any other runner stops it before the first step.',
        },

        { type: 'h2', id: 'cloud', text: 'crossbind cloud' },
        {
            type: 'p',
            text: 'Sign in with GitHub, and every toolchain image - web, android, linux and windows - builds on crossbind cloud:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind login
crossbind config set RUNNER REMOTE
crossbind build -p wasm
crossbind usage`,
        },
        {
            type: 'p',
            text: '`crossbind login` shows a code to enter on github.com and asks GitHub for no permission; GitHub accounts younger than 30 days are turned away. The token is kept for that cloud address in `~/.crossbind/credentials.json`, readable only by you, and stops working after 90 days unused. The cloud is used only while the machine names no runner address at all: naming one, for any image, keeps every image off it.',
        },
        {
            type: 'ul',
            items: [
                "**Time.** 60 build minutes a month per GitHub account, counted while your runner is up: from a build's first step until a minute after its last, so the steps of one build share a warm runner. They come back on the 1st (UTC); `crossbind usage` shows them by image.",
                "**Shared caps.** Everyone's build time together is capped per day and per month. When your minutes or a shared cap run out, steps stop with a message saying so; `CROSSBIND_RUNNER=DOCKER_RUN` runs that build in the local Docker.",
                "**Isolation.** Each account's runner of each image is a Firecracker microVM of its own, stopped and wiped a minute after its last step; the first step after a pause uploads its inputs again.",
                '**Network.** A cloud runner downloads from crates.io, ConanCenter and GitHub and reaches nothing else, so a Conan recipe whose sources live on another host, or a step that uploads, fails there.',
                '**Versions.** The cloud runs the toolchain images of the current crossbind release; a crossbind that pins other images stops with `toolchain mismatch` until you upgrade.',
            ],
        },
        {
            type: 'p',
            text: "The cloud keeps your GitHub id and name, when you signed in, your tokens' hashes and how long your runners were up - no email, and none of your sources once a runner stops. `crossbind logout` revokes this machine's token, `--all` every machine's, and `crossbind account delete --yes` deletes the account; see [Privacy](/privacy/).",
        },

        { type: 'h2', id: 'own-runner', text: 'A runner of your own' },
        {
            type: 'p',
            text: 'A runner is the toolchain image your crossbind pins plus a small server that ships inside the CLI; no runner image is published. Start one in the local Docker to try it, or to build for other machines:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind runner start
crossbind config set RUNNER REMOTE
crossbind config set REMOTE_URL_WEB http://127.0.0.1:8787
export CROSSBIND_TOKEN_WEB=<token>
crossbind build -p wasm`,
        },
        {
            type: 'p',
            text: '`runner start` prints the three commands after it, with its token. It listens on `127.0.0.1`; `--host 0.0.0.0` opens it to other machines over plain HTTP, so keep it on a network you trust or put TLS in front of it, and `--port` moves it. `--role android`, `linux` or `windows` starts the other images on ports 8788 to 8790, and `runner delete` removes a runner again.',
        },
        {
            type: 'p',
            text: 'To run one elsewhere, `crossbind runner init <platform>` writes a folder - the files below and a `runner/` folder with the server - and prints its deploy steps with a new token. The idle times below were measured in October 2026:',
        },
        {
            type: 'table',
            head: ['Platform', 'Writes', 'Machine', 'When idle'],
            rows: [
                ['`fly` - Fly.io', '`Dockerfile`, `fly.toml`', 'one `performance-4x`, 16 GB', 'stops; woke in about 2 s'],
                [
                    '`cloudflare` - Cloudflare Containers',
                    '`Dockerfile`, `wrangler.jsonc`, `src/worker.js`',
                    '`standard-4`, or 1 to 4 vCPUs with `--vcpu`',
                    'sleeps a minute after the last step; woke in about 2 s',
                ],
                ['`cloudrun` - Google Cloud Run', '`env.yaml`', '4 vCPU, 8 GiB, one instance', 'scales to zero; woke in 2.5 s'],
                [
                    '`azure` - Azure Container Apps',
                    '`containerapp.yaml`',
                    '4 vCPU, 8 GiB, one replica',
                    'scales to zero about five minutes after the last request; the next request waited 33 s',
                ],
            ],
        },
        {
            type: 'p',
            text: 'Only the Cloudflare deploy needs the local Docker: `wrangler deploy` builds the image there. In the same measurements, a 4-vCPU runner on Fly, Cloud Run or Azure built zlib in 30-42 s and SQLite in 70-85 s. Fly, Cloud Run and Azure start a machine for any request, one without the token too, so keep the address private; the Cloudflare Worker refuses such a request before the container wakes.',
        },

        { type: 'h2', id: 'choosing', text: 'How a build picks its runner' },
        {
            type: 'p',
            text: '`RUNNER` in `~/.crossbind.json` decides where every toolchain step runs, and the `CROSSBIND_RUNNER` environment variable overrides it for one shell or CI job. `crossbind.config.js` has no runner setting; a project that should always build remotely sets the variables in the script that runs the build.',
        },
        {
            type: 'table',
            head: ['RUNNER', 'Steps run'],
            rows: [
                ['`DOCKER_RUN`', 'the default: a fresh container of the pinned image for each step'],
                ['`DOCKER_EXEC`', 'in the long-lived container `crossbind docker create` made'],
                ['`LOCAL`', 'with the toolchain installed on the machine'],
                ['`REMOTE`', "on a runner: the image's own address, else the shared one; with no address named at all, crossbind cloud"],
            ],
        },
        {
            type: 'p',
            text: 'Under `REMOTE` each toolchain image has its own address. Addresses are keys of `~/.crossbind.json`, each overridden by the environment variable of the same name with a `CROSSBIND_` prefix (`CROSSBIND_REMOTE_URL_WEB`). Tokens are secrets and never live in the file: each comes only from the variable paired with its address, so a shared token never reaches the runner of another image.',
        },
        {
            type: 'table',
            head: ['Address', 'Token', 'Steps it takes'],
            rows: [
                ['`REMOTE_URL_WEB`', '`CROSSBIND_TOKEN_WEB`', 'wasm and wasi builds, and the bridge steps of every platform but android'],
                ['`REMOTE_URL_ANDROID`', '`CROSSBIND_TOKEN_ANDROID`', 'android builds and their bridge steps'],
                ['`REMOTE_URL_LINUX`', '`CROSSBIND_TOKEN_LINUX`', 'linux and linuxmusl builds'],
                ['`REMOTE_URL_WINDOWS`', '`CROSSBIND_TOKEN_WINDOWS`', 'win32 builds'],
                ['`REMOTE_URL`', '`CROSSBIND_TOKEN`', 'every image without an address of its own'],
            ],
        },
        {
            type: 'ul',
            items: [
                'A step whose image has no address stops before anything is sent and names the setting that would give it one: `crossbind: RUNNER=REMOTE, but the web image has no runner address - set REMOTE_URL_WEB (or REMOTE_URL), or build with CROSSBIND_RUNNER=DOCKER_RUN. A machine that names no runner address builds on crossbind cloud after crossbind login.` It never falls back to the local Docker or to the cloud.',
                'A step whose address comes without its token stops before anything travels and names the variable to set; an address that is not http or https stops the build.',
                'A desktop build takes its bridges from the web image, so `-p linux` needs a web runner and a linux runner.',
                'Once per image, the build prints which runner its steps go to and which settings chose it.',
            ],
        },
        {
            type: 'p',
            text: 'For a single build, the environment does the same without touching `~/.crossbind.json`:',
        },
        {
            type: 'code',
            file: 'shell',
            code: 'CROSSBIND_RUNNER=REMOTE CROSSBIND_REMOTE_URL_WEB=http://127.0.0.1:8787 CROSSBIND_TOKEN_WEB=<token> crossbind build -p wasm',
        },

        { type: 'h2', id: 'travels', text: 'What travels' },
        {
            type: 'p',
            text: 'Each step is its own request, made only when the build runs that step; a step skipped because nothing changed sends nothing.',
        },
        {
            type: 'ul',
            items: [
                "**Up:** the folders the step reads below `paths.base` - native sources and headers, the `.crossbind` cache, the output folder, the dependencies' prebuilt and header folders, crossbind's assets, and any file the command line names. JavaScript and TypeScript files, `.env` and `.env.*`, `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.netrc`, `node_modules` and `.git` stay behind.",
                '**Once:** the runner keeps every file under its SHA-256 and asks only for what it lacks, so an unchanged file never travels twice. A large file goes in 16 MB parts, and an upload cut off resumes from the parts the runner holds.',
                '**Down:** what the step created or changed in the cache and output folders, checked against its hash; files the step deleted are deleted locally too. Cargo `target` folders stay on the runner, and only the release static libraries come back.',
            ],
        },

        { type: 'h2', id: 'limits', text: 'Versions, security and limits' },
        {
            type: 'ul',
            items: [
                'A runner serves the image digest of the crossbind that started or generated it. A build that pins another stops with `toolchain mismatch: runner has <image>, build pins <image>`; after upgrading crossbind, run `runner delete` and `runner start` again, or rerun `runner init` and redeploy.',
                'A runner runs any command a token holder sends, with internet access, and keeps what earlier builds left: treat the token like a deploy key, and restart the runner after building something you do not trust.',
                'The runner refuses to start with a token shorter than 16 characters and checks it in constant time. The client follows no redirect and warns when an address is plain http to another machine.',
                'A runner runs one step at a time, so concurrent builds queue. Its disk is a cache: a container started fresh takes its inputs again.',
                "C and C++ outputs match a local build byte for byte. Rust archives built on an amd64 runner differ in bytes from ones built on arm64, because a crate's metadata hash includes the machine that compiled it.",
            ],
        },
        {
            type: 'p',
            text: `[remote-runner.md](${REPO_URL}/blob/main/docs/api/remote-runner.md) has the protocol, the per-platform details and every limit.`,
        },
    ],
};

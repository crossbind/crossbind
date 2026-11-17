import { REPO_URL } from '../../data.js';

export default {
    slug: 'remote-builds',
    title: 'Remote builds',
    description: 'Run the toolchain steps on crossbind cloud or on a runner of your own instead of the local Docker.',
    lede: 'Each toolchain step of a build (compile, link, bindings, cargo, Conan) normally runs in a pinned Docker image on your machine. With `RUNNER=REMOTE` those steps run on a runner instead, crossbind cloud or one of your own, and your machine needs no Docker.',
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
            text: 'Apps for Android, Linux and Windows are the exception: `crossbind app` builds them only in the local Docker, under `RUNNER=DOCKER_RUN` or `DOCKER_EXEC`.',
        },

        { type: 'h2', id: 'cloud', text: 'crossbind cloud' },
        {
            type: 'p',
            text: 'Sign in with GitHub, and every toolchain image (web, android, linux and windows) builds on crossbind cloud:',
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
            text: '`crossbind login` shows a code to enter on github.com and asks GitHub for no permissions; GitHub accounts younger than 30 days are refused. The token is kept in `~/.crossbind/credentials.json`, readable only by you, and stops working after 90 days unused. The cloud is used only while no runner address is set: setting one, for any image, keeps every image off the cloud.',
        },
        {
            type: 'ul',
            items: [
                "**Time.** 60 build minutes a month per GitHub account, counted from a build's first step until a minute after its last. They reset on the 1st (UTC); `crossbind usage` shows them by image.",
                "**Shared caps.** Everyone's build time together is capped per day and per month. When your minutes or a cap run out, steps stop with a message; `CROSSBIND_RUNNER=DOCKER_RUN` builds in the local Docker instead.",
                '**Isolation.** Each account gets a microVM of its own per image, stopped and wiped a minute after its last step.',
                '**Network.** A cloud runner downloads from crates.io, ConanCenter and GitHub and reaches nothing else, so a Conan recipe whose sources live on another host, or a step that uploads, fails there.',
                '**Versions.** The cloud runs the toolchain images of the current crossbind release; a crossbind that pins other images stops with `toolchain mismatch` until you upgrade.',
            ],
        },
        {
            type: 'p',
            text: "The cloud keeps your GitHub id and name, when you signed in, your tokens' hashes and how long your runners were up: no email, and none of your sources once a runner stops. `crossbind logout` revokes this machine's token (`--all` every machine's), and `crossbind account delete --yes` deletes the account; see [Privacy](/privacy/).",
        },

        { type: 'h2', id: 'own-runner', text: 'A runner of your own' },
        {
            type: 'p',
            text: 'A runner is the toolchain image your crossbind pins, plus a small server that ships inside the CLI. Start one in the local Docker to try it, or to build for other machines:',
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
            text: '`runner start` prints the next three commands, with its token. It listens on `127.0.0.1`; `--host 0.0.0.0` opens it to other machines over plain HTTP, so keep it on a network you trust or put TLS in front of it. `--role android`, `linux` or `windows` starts the other images, on ports 8788 to 8790; `runner delete` removes a runner.',
        },
        {
            type: 'p',
            text: 'To run one elsewhere, `crossbind runner init <platform>` writes a deploy folder and prints its steps with a new token:',
        },
        {
            type: 'entries',
            items: [
                { name: '`fly`: Fly.io', text: 'Writes `Dockerfile` and `fly.toml`. One `performance-4x` machine with 16 GB, stopped when idle.' },
                {
                    name: '`cloudflare`: Cloudflare Containers',
                    text: 'Writes `Dockerfile`, `wrangler.jsonc` and `src/worker.js`. A `standard-4` container, or 1 to 4 vCPUs with `--vcpu`; it sleeps a minute after the last step.',
                },
                { name: '`cloudrun`: Google Cloud Run', text: 'Writes `env.yaml`. 4 vCPU and 8 GiB, one instance, scaled to zero when idle.' },
                {
                    name: '`azure`: Azure Container Apps',
                    text: 'Writes `containerapp.yaml`. 4 vCPU and 8 GiB, one replica, scaled to zero about five minutes after the last request; it wakes slower than the others.',
                },
            ],
        },
        {
            type: 'p',
            text: 'Only the Cloudflare deploy needs the local Docker: `wrangler deploy` builds the image there. Fly, Cloud Run and Azure start a machine for any request, even one without the token, so keep the address private; the Cloudflare Worker refuses such a request before the container wakes.',
        },

        { type: 'h2', id: 'choosing', text: 'How a build picks its runner' },
        {
            type: 'p',
            text: '`RUNNER` in `~/.crossbind.json` decides where every toolchain step runs, and the `CROSSBIND_RUNNER` environment variable overrides it for one shell or CI job. `crossbind.config.js` has no runner setting; a project that should always build remotely sets the variables in the script that runs the build.',
        },
        {
            type: 'entries',
            items: [
                { name: '`DOCKER_RUN`', text: 'The default: a fresh container of the pinned image for each step.' },
                { name: '`DOCKER_EXEC`', text: 'In the long-lived container `crossbind docker create` made.' },
                { name: '`LOCAL`', text: 'With the toolchain installed on the machine.' },
                { name: '`REMOTE`', text: "On a runner: the image's own address, else the shared one; with no address set at all, crossbind cloud." },
            ],
        },
        {
            type: 'p',
            text: 'Under `REMOTE` each toolchain image has its own address: a key of `~/.crossbind.json`, overridden by the environment variable of the same name with a `CROSSBIND_` prefix (`CROSSBIND_REMOTE_URL_WEB`). Tokens are secrets and never live in the file: each comes only from the variable paired with its address, so one image\'s token never reaches another image\'s runner.',
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
                'A step whose image has no address stops before anything is sent; it never falls back to the local Docker or to the cloud.',
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
                "**Up:** the folders the step reads under `paths.base`: native sources and headers, the `.crossbind` cache, the output folder, the dependencies' prebuilt and header folders, crossbind's assets, and any file the command line names. JavaScript and TypeScript files, `.env` and `.env.*`, `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.netrc`, `node_modules` and `.git` never leave.",
                '**Once:** the runner keeps files by their hash and asks only for what it lacks, so an unchanged file never travels twice, and a cut-off upload resumes.',
                '**Down:** what the step created or changed in the cache and output folders, checked by hash; files it deleted are deleted locally too. Cargo `target` folders stay on the runner; only the release static libraries come back.',
            ],
        },

        { type: 'h2', id: 'limits', text: 'Versions, security and limits' },
        {
            type: 'ul',
            items: [
                'A runner serves the toolchain of the crossbind that started or generated it. After upgrading crossbind, run `runner delete` and `runner start` again, or rerun `runner init` and redeploy; until then builds stop with `toolchain mismatch`.',
                'A runner runs any command a token holder sends, with internet access, and keeps what earlier builds left: treat the token like a deploy key, and restart the runner after building something you do not trust.',
                'A runner token has at least 16 characters. The client follows no redirect and warns when an address is plain http to another machine.',
                'A runner runs one step at a time, so concurrent builds queue. Its disk is a cache: a container started fresh takes its inputs again.',
                "C and C++ outputs match a local build byte for byte. Rust archives built on an amd64 runner differ from ones built on arm64: a crate's metadata hash includes the machine that compiled it.",
            ],
        },
        {
            type: 'p',
            text: `Full reference, with the protocol: [remote-runner.md](${REPO_URL}/blob/main/docs/api/remote-runner.md).`,
        },
    ],
};

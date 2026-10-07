<!-- GENERATED from docs/api/remote-runner.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Remote runner — `RUNNER=REMOTE`

> Builds without a local Docker. A **runner** is one toolchain image this crossbind pins plus a small server that ships inside the CLI. With `RUNNER=REMOTE` and a runner's address and token set, every toolchain step bound for its image (compilers, CMake, SWIG, the linker, cargo, conan) runs on the runner instead of a local container; crossbind neither pulls that image nor starts containers. Your JavaScript never leaves the machine.

## Quick start

```bash
crossbind runner start                # the web image on port 8787
# crossbind: crossbind-runner-web is running. Build against it with:
#   crossbind config set RUNNER REMOTE
#   crossbind config set REMOTE_URL_WEB http://127.0.0.1:8787
#   export CROSSBIND_TOKEN_WEB=<token>

crossbind config set RUNNER REMOTE
crossbind config set REMOTE_URL_WEB http://127.0.0.1:8787
export CROSSBIND_TOKEN_WEB=<token>
crossbind build -p wasm
# crossbind: web steps run on the runner at http://127.0.0.1:8787 (RUNNER=REMOTE from ~/.crossbind.json, address from REMOTE_URL_WEB in ~/.crossbind.json).

crossbind config set RUNNER DOCKER_RUN   # back to the local Docker
crossbind runner stop
```

For a single build, the environment does the same without changing `~/.crossbind.json`:

```bash
CROSSBIND_RUNNER=REMOTE CROSSBIND_REMOTE_URL_WEB=http://127.0.0.1:8787 CROSSBIND_TOKEN_WEB=<token> crossbind build -p wasm
```

`runner start` runs the runner in the local Docker, which is how you try it out or turn one machine into the build machine of others (`--host 0.0.0.0`, `--port`, `--token`; the token defaults to `$CROSSBIND_RUNNER_TOKEN`, else a new one). `--role android|linux|windows` starts the other images, on ports 8788, 8789 and 8790, so the runners one build needs fit on one machine. To run a runner elsewhere, deploy it.

## Deploy a runner

```bash
crossbind runner init fly             # or cloudflare, cloudrun, azure; --role android|linux|windows; --dir <folder>
```

`runner init` writes a folder and prints its deploy steps with a new token. For Fly and Cloudflare its `Dockerfile` starts `FROM` the image this crossbind pins and copies the runner in; Cloud Run and Azure deploy that image straight from GHCR and take the runner from `env.yaml` or `containerapp.yaml`. No runner image is published either way.

| Platform | `runner init` writes | Deploy | URL |
|---|---|---|---|
| Fly.io | `Dockerfile`, `fly.toml`: one `performance-4x` machine with 16 GB that stops when idle and starts on the next request | `fly launch --copy-config --no-deploy --ha=false`, `fly secrets set CROSSBIND_RUNNER_TOKEN=<token>`, `fly deploy --ha=false` | `https://crossbind-runner-<role>-<random>.fly.dev` |
| Cloudflare Containers | `Dockerfile`, `wrangler.jsonc`: one `standard-4` container, `src/worker.js`: a Worker that checks the token, starts the container and forwards to it | `npx wrangler deploy` (builds the image with the local Docker), `npx wrangler secret put CROSSBIND_RUNNER_TOKEN` | `https://crossbind-runner-<role>.<account>.workers.dev` |
| Google Cloud Run | `env.yaml`: the runner, gzipped into one variable, and a boot script that unpacks and starts it | `gcloud`: a service account, a Secret Manager secret only that account may read, then `gcloud run deploy` of the pinned image from GHCR: one instance, 4 vCPU, 8 GiB, an hour per step | `https://crossbind-runner-<role>-<project-number>.<region>.run.app` |
| Azure Container Apps | `containerapp.yaml`: one container app of the pinned image from GHCR, 4 vCPU and 8 GiB, at most one replica and none when idle, with the runner in its variables and a `<token>` placeholder | `az`: register `Microsoft.App`, create a resource group and a Container Apps environment, then `az containerapp create` from the YAML with the token filled in | `https://crossbind-runner-<role>.<environment-domain>` |

All four keep one machine: a runner holds one build tree on its own disk. The printed steps end with the commands that point builds at the runner.

`runner init cloudflare --vcpu <1-4>` sizes the container by its vCPUs, with the least memory Cloudflare allows them (3 GiB each) and the most disk (2 GB per GiB, up to 20 GB); without it the container is a `standard-4`. Memory is most of the price while a container runs, and CPU is billed only while it is used. Measured on 6 October 2026, a 1-vCPU runner built zlib and SQLite as fast as a 4-vCPU one at a quarter of the memory price, peaking below 500 MB, while a parallel C++ build (LERC) took 1.8 times as long. A large port such as GDAL wants more cores and memory.

On Cloud Run nothing is built or pushed: the deploy pulls the pinned image from GHCR (about 95 seconds the first time), and the container unpacks the runner from `env.yaml` when it starts. Instances scale to zero and are billed only while a request runs; a runner woken from zero answered in 2.5 seconds. `--max 1` is the service's own instance limit, which the project's regional CPU quota is checked against: without it a new project's quota (20 vCPU) refuses an 8-vCPU service. Measured on 7 October 2026, a 4-vCPU service built zlib in 34–42 s, SQLite in 70–85 s and the example app in 21–23 s, about as fast as Cloudflare's `standard-4`; 8 vCPUs built them no faster, and the CPU an instance lands on varies. Change `--cpu` and `--memory` in the deploy command to size it.

On Fly, the first `fly deploy` took six minutes on 7 October 2026 while Fly's builder pulled the toolchain image. The `performance-4x` machine then built zlib in 31 s, SQLite in 85 s and LERC in 27 s, as fast as the other platforms, stopped within five minutes of its last request and woke in about 2 seconds.

On Azure, too, nothing is built or pushed. On 7 October 2026 the first Container Apps environment took 17 minutes to create, West Europe took no new customers, and the app itself took 17 seconds; a 4-vCPU app built zlib in 30 s, SQLite in 72 s and LERC in 27 s, as fast as the other platforms. It scaled to zero about five minutes after its last request, and the next request then waited 33 seconds for a replica. The consumption plan caps an app at 4 vCPU and 8 GiB. Container Apps documents a 240-second request timeout, yet a 15-minute step finished: the runner answers at once and heartbeats every 15 seconds. Keep `allowInsecure: false` in `containerapp.yaml`: without it Azure refuses the app with an error that names no field.

Fly app names are global, so the generated name carries a random part, which also keeps the address hard to guess. That matters: Fly starts the machine for any request that reaches the app, one without the token too, and bills it until it stops when idle, so keep the address private. Cloud Run and Azure, too, start an instance for any request, but bill only while one runs. The Cloudflare Worker refuses such a request before the container starts.

## Choosing the runner

`RUNNER` in `~/.crossbind.json` decides where every toolchain step runs: `DOCKER_RUN` (the default), `DOCKER_EXEC`, `LOCAL` or `REMOTE`. The `CROSSBIND_RUNNER` environment variable overrides it, for CI and single builds. Only `REMOTE` sends steps to a runner; under the other three, runner addresses are ignored.

Under `REMOTE`, each image has its own address, and an image's own address wins over the shared one. Addresses are keys of `~/.crossbind.json` (`crossbind config set`), each overridden by the variable of the same name with a `CROSSBIND_` prefix (`CROSSBIND_REMOTE_URL_WEB`). Tokens are secrets and stay out of the file: each comes only from the variable paired with its address, so a shared token never reaches the runner of another image:

| Address | Token | Steps it sends |
|---|---|---|
| `REMOTE_URL_WEB` | `CROSSBIND_TOKEN_WEB` | wasm and wasi builds, and the bridge (SWIG) steps of every platform but android |
| `REMOTE_URL_ANDROID` | `CROSSBIND_TOKEN_ANDROID` | android builds and their bridge steps (the image is amd64 only) |
| `REMOTE_URL_LINUX` | `CROSSBIND_TOKEN_LINUX` | linux and linuxmusl builds |
| `REMOTE_URL_WINDOWS` | `CROSSBIND_TOKEN_WINDOWS` | win32 builds |
| `REMOTE_URL` | `CROSSBIND_TOKEN` | the steps of every image without an address of its own |

- A step whose image has no address stops before anything runs and names the setting to add; it never falls back to the local Docker, where the build would only seem to run on a runner. `CROSSBIND_RUNNER=DOCKER_RUN` runs that build in the local Docker instead. Once per image, the build says which runner its steps go to and which settings chose it.
- A desktop build takes its bridges from the web image, so it needs two runners:

  ```bash
  crossbind config set RUNNER REMOTE
  crossbind config set REMOTE_URL_WEB https://web.example
  crossbind config set REMOTE_URL_LINUX https://linux.example
  CROSSBIND_TOKEN_WEB=<token> CROSSBIND_TOKEN_LINUX=<token> crossbind build -p linux
  ```

- A step whose address comes without its paired token stops before anything travels and names the variable to set. An address that is not http or https stops the build and names the setting it came from. A step that reaches the runner of another image stops with `this runner serves the web toolchain, not android`.
- iOS and macOS builds compile on the Mac with Xcode under every runner; their bridge steps go to the web runner, so they need its address.

## What travels

Each step is its own request, made only when crossbind runs the step; a step it skips because nothing changed sends nothing.

- **Up:** the folders the step reads below `paths.base`: native sources and headers, the build cache (`.crossbind`), the output folder, the dependencies' prebuilt and header folders, crossbind's assets, and any file the command line names (with the package that holds it). JavaScript and TypeScript files, credential files (`.env`, `.env.*`, `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.netrc`), `node_modules` and `.git` inside those folders stay behind, and so does a link that leads out of the base, which a local container would see dangle.
- **Content-addressed:** the runner keeps every file it receives under its SHA-256 and asks only for what it lacks; an unchanged file never travels twice.
- **Down:** what the step created or changed in the cache and output folders, checked against its hash; files the step deleted are deleted locally too. Nothing else is written: not outside the output folders the step declared, not into a cargo or Conan store unit the machine already holds, and not through a link that leads out of the project. Cargo `target` folders stay on the runner, and only the release static libraries come back; crate sources and built Conan packages come back into the local cargo home and Conan store, which crossbind reads on the host.
- The client keeps a hash index per folder under `~/.crossbind/remote-index/`, so unchanged files are not rehashed. Deleting it costs one rehash.

## Versions

A runner serves the image digest pinned by the crossbind that started or generated it. A build whose crossbind pins another digest stops with `toolchain mismatch: runner has <image>, build pins <image>`: after upgrading crossbind, `runner stop` and `runner start` again, or rerun `runner init` and redeploy. Images are compared by digest, so a runner pulled through a registry mirror serves builds that pin the release digest.

Releases from before `RUNNER=REMOTE` read the same `~/.crossbind.json` and stop with `The runner REMOTE is invalid`. While the machine still builds projects with one of them, choose the runner per build with `CROSSBIND_RUNNER=REMOTE` and keep `RUNNER` out of the file.

## Security

- A runner runs any command a token holder sends, inside the toolchain image and with internet access (crates, Conan packages, library sources). Treat the token like a deploy key and give a runner to one person or a team that trusts each other: a build can read what earlier builds left on it.
- A runner lives on between builds, so it is only as trustworthy as everything it has built. Build steps run as the same unprivileged user as the runner: they cannot change the toolchain, but a malicious build script can change the emscripten cache and the files the runner keeps for later builds, and read the token from the runner process, although it is not in the steps' environment. Restart the runner (`runner stop` and `runner start`, or redeploy) after building something you do not trust. `RUNNER=DOCKER_EXEC` shares this; `RUNNER=DOCKER_RUN` starts every step in a fresh container.
- The runner refuses to start without a `CROSSBIND_RUNNER_TOKEN` of at least 16 characters, checks it in constant time on every request except `GET /v1/health`, and syncs files only inside its mount folders.
- The Cloudflare Worker checks the token, in constant time, before it wakes the container.
- A Cloud Run runner gets a service account of its own that may read only its token secret. A build step can ask the metadata server for the token of the instance's account, and the project's default compute account often holds broad roles.
- An Azure runner gets no managed identity, so its build steps hold no Azure credentials; its token lives in the app's secrets.
- The client follows no redirect, and warns once when an address is plain http to another machine, where the token and the sources travel unencrypted. It refuses a returned path holding `\`, and on Windows one holding `:`.
- `runner start` listens on `127.0.0.1`, hands the token to Docker through the environment rather than the command line, prints a token taken from `$CROSSBIND_RUNNER_TOKEN` by that name, and runs the container with crossbind's Docker hardening (all capabilities dropped, `no-new-privileges`). It speaks plain HTTP: with `--host 0.0.0.0`, keep it on a network you trust or put TLS in front of it. Fly, Cloudflare, Cloud Run and Azure serve HTTPS.

## Limits

- A runner runs one step at a time; concurrent builds queue.
- A step's `make -jN` and `cmake --build -j N` run as many jobs as the runner has cores: the runner replaces the count the client computed for its own machine. On Cloud Run the container sees more cores than the service has (9 on 4 vCPU).
- Its disk is a cache. When the platform starts the container fresh from its image, the next step uploads its inputs again. Cloud Run keeps that disk in memory, so it counts against the service's `--memory`.
- Cloudflare Workers accept request bodies up to 100 MB on the Free and Pro plans. Uploads travel base64-encoded, so a single input file over about 75 MB cannot reach a Cloudflare runner. Cloud Run accepts up to 32 MiB per HTTP/1 request, about 24 MB of file. Results are not limited.
- A step answers at once, and heartbeats every 15 seconds while it waits behind another one or runs quietly, so proxies keep the response open.
- Cloudflare stops a container whose Durable Object is idle, and the work inside a container does not count as activity. The generated Worker therefore keeps both up with an alarm while a step streams, and lets the container sleep a minute after the last one. A container woken from sleep answered in about 2 seconds; the first start after `wrangler deploy` took over four minutes while the image spread, so a step that waits longer than four minutes fails and the next one finds the runner up.
- Rust archives built on an amd64 runner (Cloudflare, Fly, Cloud Run, Azure) differ in bytes from ones built on arm64 (Docker on an Apple-silicon Mac), because a crate's metadata hash includes the machine that compiled it. C and C++ outputs match byte for byte.

## Protocol (v1)

Every route but `/v1/health` needs `authorization: Bearer <token>`.

| Route | Body | Answer |
|---|---|---|
| `GET /v1/health` | — | `{ ok, protocol, role, image }` |
| `POST /v1/missing` | `{ hashes }` | `{ missing }`: the hashes the runner lacks |
| `POST /v1/blobs` | JSON lines of `{ sha256, data }`, base64 | `{ stored }`: how many it stored |
| `PUT /v1/blobs/<sha256>` | one file's bytes | `{ stored }` |
| `GET /v1/blobs/<sha256>` | — | the file's bytes |
| `POST /v1/exec` | `{ role, image, rules, mounts, cwd, argv, env }`; each mount lists its roots, output roots, manifest, folders and present store units | JSON lines: `stdout`, `stderr`, `heartbeat`, `file` (outputs up to 8 MB inline), then `{ exit, outputs, removed }` |

The server is `core/crossbind/src/runner/` and uses only Node.js built-ins, so the Node.js every crossbind image carries runs it.

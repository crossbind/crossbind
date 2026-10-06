# Remote runner — `CROSSBIND_REMOTE_URL`

> Builds without a local Docker. A **runner** is one toolchain image this crossbind pins plus a small server that ships inside the CLI. With a runner's address and token set, every toolchain step bound for its image (compilers, CMake, SWIG, the linker, cargo, conan) runs on the runner instead of a local container; crossbind neither pulls that image nor starts containers. Your JavaScript never leaves the machine.

## Quick start

```bash
crossbind runner start                # the web image on port 8787
# crossbind: crossbind-runner-web is running. Build against it with:
#   CROSSBIND_REMOTE_URL_WEB=http://127.0.0.1:8787 CROSSBIND_TOKEN_WEB=<token>

CROSSBIND_REMOTE_URL_WEB=http://127.0.0.1:8787 CROSSBIND_TOKEN_WEB=<token> crossbind build -p wasm
crossbind runner stop
```

`runner start` runs the runner in the local Docker, which is how you try it out or turn one machine into the build machine of others (`--host 0.0.0.0`, `--port`, `--token`; the token defaults to `$CROSSBIND_RUNNER_TOKEN`, else a new one). `--role android|linux|windows` starts the other images, on ports 8788, 8789 and 8790, so the runners one build needs fit on one machine. To run a runner elsewhere, deploy it.

## Deploy a runner

```bash
crossbind runner init fly             # or cloudflare; --role android|linux|windows; --dir <folder>
```

`runner init` writes a folder and prints its deploy steps with a new token. Its `Dockerfile` starts `FROM` the image this crossbind pins and copies the runner in, so no runner image is published and none has to be pulled from a registry the platform cannot reach.

| Platform | `runner init` writes | Deploy | URL |
|---|---|---|---|
| Fly.io | `Dockerfile`, `fly.toml`: one `performance-4x` machine with 16 GB that stops when idle and starts on the next request | `fly launch --copy-config --no-deploy --ha=false`, `fly secrets set CROSSBIND_RUNNER_TOKEN=<token>`, `fly deploy --ha=false` | `https://crossbind-runner-<role>-<random>.fly.dev` |
| Cloudflare Containers | `Dockerfile`, `wrangler.jsonc`: one `standard-4` container, `src/worker.js`: a Worker that checks the token, starts the container and forwards to it | `npx wrangler deploy` (builds the image with the local Docker), `npx wrangler secret put CROSSBIND_RUNNER_TOKEN` | `https://crossbind-runner-<role>.<account>.workers.dev` |

Both keep one machine: a runner holds one build tree on its own disk. Then build with the pair of variables the steps end with.

Fly app names are global, so the generated name carries a random part, which also keeps the address hard to guess. That matters: Fly starts the machine for any request that reaches the app, one without the token too, and bills it until it stops when idle, so keep the address private. The Cloudflare Worker refuses such a request before the container starts.

## Addresses and tokens

Each image has its own pair of variables, and a step's own pair wins over the shared one. A token goes only with the address it is paired with, so a shared token never reaches the runner of another image:

| Variables | Steps they send |
|---|---|
| `CROSSBIND_REMOTE_URL_WEB`, `CROSSBIND_TOKEN_WEB` | wasm builds, wasi builds without a host wasi-sdk, and the bridge (SWIG) steps of every platform but android |
| `CROSSBIND_REMOTE_URL_ANDROID`, `CROSSBIND_TOKEN_ANDROID` | android builds and their bridge steps (the image is amd64 only) |
| `CROSSBIND_REMOTE_URL_LINUX`, `CROSSBIND_TOKEN_LINUX` | linux and linuxmusl builds |
| `CROSSBIND_REMOTE_URL_WINDOWS`, `CROSSBIND_TOKEN_WINDOWS` | win32 builds |
| `CROSSBIND_REMOTE_URL`, `CROSSBIND_TOKEN` | the steps of every image without a pair of its own |

- An image with no address runs in the local Docker, as it does without runners.
- A desktop build takes its bridges from the web image, so it needs two runners:

  ```bash
  CROSSBIND_REMOTE_URL_WEB=https://web.example CROSSBIND_TOKEN_WEB=<token> \
  CROSSBIND_REMOTE_URL_LINUX=https://linux.example CROSSBIND_TOKEN_LINUX=<token> \
  crossbind build -p linux
  ```

- A step whose address comes without its paired token stops before anything travels and names the variable to set. A step that reaches the runner of another image stops with `this runner serves the web toolchain, not android`.
- iOS and macOS builds compile on the Mac with Xcode; their bridge steps go to the web runner when it has an address.
- `RUNNER=LOCAL` ignores every runner address: each step runs on the host.

## What travels

Each step is its own request, made only when crossbind runs the step; a step it skips because nothing changed sends nothing.

- **Up:** the folders the step reads below `paths.base`: native sources and headers, the build cache (`.crossbind`), the output folder, the dependencies' prebuilt and header folders, crossbind's assets, and any file the command line names (with the package that holds it). JavaScript and TypeScript files, credential files (`.env`, `.env.*`, `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.netrc`), `node_modules` and `.git` inside those folders stay behind, and so does a link that leads out of the base, which a local container would see dangle.
- **Content-addressed:** the runner keeps every file it receives under its SHA-256 and asks only for what it lacks; an unchanged file never travels twice.
- **Down:** what the step created or changed in the cache and output folders, checked against its hash; files the step deleted are deleted locally too. Nothing else is written: not outside the output folders the step declared, not into a cargo or Conan store unit the machine already holds, and not through a link that leads out of the project. Cargo `target` folders stay on the runner, and only the release static libraries come back; crate sources and built Conan packages come back into the local cargo home and Conan store, which crossbind reads on the host.
- The client keeps a hash index per folder under `~/.crossbind/remote-index/`, so unchanged files are not rehashed. Deleting it costs one rehash.

## Versions

A runner serves the image digest pinned by the crossbind that started or generated it. A build whose crossbind pins another digest stops with `toolchain mismatch: runner has <image>, build pins <image>`: after upgrading crossbind, `runner stop` and `runner start` again, or rerun `runner init` and redeploy. Images are compared by digest, so a runner pulled through a registry mirror serves builds that pin the release digest.

## Security

- A runner runs any command a token holder sends, inside the toolchain image and with internet access (crates, Conan packages, library sources). Treat the token like a deploy key and give a runner to one person or a team that trusts each other: a build can read what earlier builds left on it.
- A runner lives on between builds, so it is only as trustworthy as everything it has built. Build steps run as the same unprivileged user as the runner: they cannot change the toolchain, but a malicious build script can change the emscripten cache and the files the runner keeps for later builds, and read the token from the runner process, although it is not in the steps' environment. Restart the runner (`runner stop` and `runner start`, or redeploy) after building something you do not trust. `RUNNER=DOCKER_EXEC` shares this; `RUNNER=DOCKER_RUN` starts every step in a fresh container.
- The runner refuses to start without a `CROSSBIND_RUNNER_TOKEN` of at least 16 characters, checks it in constant time on every request except `GET /v1/health`, and syncs files only inside its mount folders.
- The Cloudflare Worker checks the token, in constant time, before it wakes the container.
- The client follows no redirect, and warns once when an address is plain http to another machine, where the token and the sources travel unencrypted. It refuses a returned path holding `\`, and on Windows one holding `:`.
- `runner start` listens on `127.0.0.1`, hands the token to Docker through the environment rather than the command line, prints a token taken from `$CROSSBIND_RUNNER_TOKEN` by that name, and runs the container with crossbind's Docker hardening (all capabilities dropped, `no-new-privileges`). It speaks plain HTTP: with `--host 0.0.0.0`, keep it on a network you trust or put TLS in front of it. Fly and Cloudflare serve HTTPS.

## Limits

- A runner runs one step at a time; concurrent builds queue.
- A step's `make -jN` and `cmake --build -j N` run as many jobs as the runner has cores: the runner replaces the count the client computed for its own machine.
- Its disk is a cache. When the platform starts the container fresh from its image, the next step uploads its inputs again.
- Cloudflare Workers accept request bodies up to 100 MB on the Free and Pro plans. Uploads travel base64-encoded, so a single input file over about 75 MB cannot reach a Cloudflare runner. Results are not limited.
- A step answers at once, and heartbeats every 15 seconds while it waits behind another one or runs quietly, so proxies keep the response open.
- Cloudflare stops a container whose Durable Object is idle, and the work inside a container does not count as activity. The generated Worker therefore keeps both up with an alarm while a step streams, and lets the container sleep a minute after the last one. A container woken from sleep answered in about 2 seconds; the first start after `wrangler deploy` took over four minutes while the image spread, so a step that waits longer than four minutes fails and the next one finds the runner up.
- Rust archives built on an amd64 runner (Cloudflare, Fly) differ in bytes from ones built on arm64 (Docker on an Apple-silicon Mac), because a crate's metadata hash includes the machine that compiled it. C and C++ outputs match byte for byte.

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

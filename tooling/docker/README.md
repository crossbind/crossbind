# @crossbind/docker

**crossbind build images** — the toolchains a crossbind build runs in, so a project needs Docker
and Node and nothing else.

<a href="https://github.com/crossbind/crossbind/pkgs/container/web">
    <img alt="Image registry" src="https://img.shields.io/badge/ghcr.io-crossbind-20B2AA?style=for-the-badge" />
</a>
<a href="https://crossbind.dev/docs/api/cli/run">
    <img alt="Docs - Run Docker Apps" src="https://img.shields.io/badge/Docs_-_Run_Docker_Apps-20B2AA?style=for-the-badge" />
</a>

## The family

| Image          | Carries                                                 | Platforms    |
| -------------- | ------------------------------------------------------- | ------------ |
| `base`         | Debian, Node, the pinned Rust toolchain, swig, cmake    | amd64, arm64 |
| `web`          | base + Emscripten, wasi-sdk, the prebuilt Rust sysroots | amd64, arm64 |
| `android`      | base + the NDK and the android Rust targets             | amd64 only   |
| `rust-sysroot` | just the ST/MT Rust sysroots and their manifest         | amd64, arm64 |

`web` and `android` are built `FROM base`, so all three share one toolchain layer. Nothing above
Debian is inherited here: Node and Emscripten are copied out of digest-pinned upstream images;
Rust is installed as an exact release by the rustup from a digest-pinned bootstrap image. This
keeps the upstream distributions authoritative while the runtime layout — PATH, Node version,
`CARGO_HOME`, cache permissions — stays ours to guarantee.

`android` is amd64-only because Google ships the Linux NDK host tools for x86_64 alone; the CLI
pins android builds to that platform even on an arm64 host.

## Building locally

```sh
pnpm build:family          # every image, both architectures where it applies
pnpm build:web             # just one
```

Local builds are tagged `crossbind/<image>:dev`. Point the CLI at them without touching source:

```sh
CROSSBIND_IMAGE_WEB=crossbind/web:dev crossbind build -p wasm
```

`node scripts/smoke-images.js` checks each image on each architecture: pinned tool versions, a
compile that actually runs, writable caches, and the absence of `rust-src` and `RUSTC_BOOTSTRAP`.

## Publishing

`.github/workflows/publish-images.yml` is manual and defaults to a write-free dry run. It builds
each image locally on a native runner and smoke-tests the hardened execution profile without
logging in or writing to a registry. The same run also scans the local images for fixable high and
critical vulnerabilities with no shared Trivy cache write:

```sh
gh workflow run publish-images.yml --ref main -f dry_run=true
```

After review, `dry_run=false` enters the protected `toolchain-release` environment, builds each
platform once, publishes hidden staging indexes to canonical GHCR, produces subject-bound SLSA
provenance and SPDX SBOMs, scans every exact platform digest, signs the release through GitHub OIDC
and promotes the same bytes to the version tag:

```sh
gh workflow run publish-images.yml --ref main -f dry_run=false
```

The environment must allow only `main`, require a reviewer, disallow self-review and administrator
bypass, and the workflow must have package write access. No stored registry or signing credential
is used. Docker Hub is not an official release target; an enterprise consumer may copy the exact
GHCR digest into its private registry and set `CROSSBIND_REGISTRY_MIRROR`. The CLI preserves the
release digest when it changes the registry host.

The writing run emits the digest table the CLI pins against. After the image gates pass,
`scripts/pin-docker-image.js` writes that complete table to the canonical
`core/crossbind/src/assets/toolchain-digests.json`. The CLI, npm release manifests and GitHub
package-release asset all consume that one file. The table also records the exact Rust compiler
that built the published sysroot so host validation does not depend on a runner's moving `stable`
toolchain. It can intentionally differ from the next, unpublished compiler in the Dockerfiles. The
image version lives in `VERSION`.

Published digests are rescanned daily by `.github/workflows/scan-toolchain-images.yml`. Fixable
high or critical findings fail both the release scan and the recurring scan. An exception must be
reviewed and time-bounded; do not turn off the gate or replace an immutable digest in place.

Consumers should pull by the committed digest, not by tag. To verify the keyless signature:

```sh
cosign verify \
  --certificate-identity https://github.com/crossbind/crossbind/.github/workflows/publish-images.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/crossbind/web@sha256:<digest>
```

The predecessor — a single image published as `bugra9/cpp.js` — and the historical `1.0.2` mirrors
stay on Docker Hub because released CLI versions may still pull them. New image trains are GHCR-only;
their recipes and exact digests remain in git.

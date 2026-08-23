# ADR-0009: Own the toolchain images, and run cargo where the build runs

- **Status:** Accepted
- **Date:** 2026-08-22
- **Affects:** `tooling/docker/`, `.github/workflows/publish-image*.yml`, `pullDockerImage.js`, `runCargo.js`, `rustMt.js`, `rustSysroot.js`, `scripts/{pin-docker-image,smoke-images,pack-rust-sysroot}.js`

## Context

One image carried every toolchain and was built `FROM emscripten/emsdk`. That
inherited more than Emscripten: the container's Node was emsdk's version-stamped
copy (the CLI's bridge generation runs on it), and the emscripten cache happened
to be world-writable, which on-demand system-library builds depend on. The image
also hid an asymmetry — it skipped the Android NDK on arm64, so one tag meant two
different toolchains, and every amd64 user pulled ~660 MB of NDK whether or not
they built for Android.

It carried no Rust at all. Rust therefore compiled on the developer's machine,
against a host toolchain whose version had to match by luck: prebuilt Rust
libraries are only consumable by the exact compiler that produced them.

## Decision

Publish a family of images we own, and make the pinned toolchain inside them the
only one a build uses.

- `base` (Debian + Node + Rust + swig) with `web` and `android` built `FROM` it.
  Node, Rust and Emscripten are copied out of digest-pinned upstream images
  rather than installed, so upstream keeps its build recipes and we keep the
  runtime layout: PATH, Node version, `CARGO_HOME`, cache permissions.
- `android` is declared `linux/amd64` only. `web` and `base` are multi-arch.
- One exact-version stable Rust toolchain, everywhere. The MT sysroot is built
  once in a disposable builder stage; `RUSTC_BOOTSTRAP` and `-Zbuild-std` exist
  only there and never reach a published image.
- Every cargo invocation goes through one `runCargo()` that rebuilds the
  environment from an allowlist, injects flags as `CARGO_ENCODED_RUSTFLAGS`, and
  runs from a neutral directory with a crossbind-owned `CARGO_HOME`.
- Cargo runs where the rest of the build runs: inside the container for
  containerized runners, on the host for `RUNNER=LOCAL` and iOS.
- **Build caches stay on the project bind mount** (`.crossbind/`) and the crate
  registry stays in `~/.crossbind/cargo`, mounted in. No named volumes.

## Consequences

- **Positive** — a Rust user needs no host Rust for wasm and android; the
  version-match question disappears because there is one toolchain; a wasm-only
  user no longer pulls the NDK; `pnpm run clear` still removes every build
  artifact, because nothing hides in a volume; cargo's intermediates stay
  readable on the host.
- **Positive** — the arm64/amd64 asymmetry is declared instead of hidden.
- **Negative** — three images to build, publish and verify instead of one, and a
  forced publish order, because `web`/`android` are `FROM base` and buildx
  resolves that from the registry.
- **Negative** — Rust lives in `base`, so a C++-only or wasi-only user carries
  ~762 MB (rustup 545 MB, cargo 19 MB, the sysroots 182 MB) they never use.
  Measured and accepted; there is nothing meaningful to prune, since the bulk is
  LLVM, rustc and the host std.
- **Negative** — writing cargo's target directory through a macOS bind mount is
  slower than a native volume. Accepted deliberately; see the revision below.
- **Negative** — iOS still compiles Rust on the host, so iOS + Rust users keep a
  host toolchain and need the sysroot as a downloadable artifact.

## Alternatives considered

- **Keep one image** — rejected: it cannot express "android is amd64-only"
  except as a hidden `TARGETARCH` branch, and it taxes every amd64 pull with the
  NDK.
- **Split by language (`web-cpp` / `web-rust`)** — rejected: Rust targets
  `wasm32-unknown-emscripten` and emcc links its output, so a Rust-only image
  would still contain all of Emscripten and save nothing. Only the C++-only side
  could shrink, by ~18%, at the cost of doubling the publish matrix and making
  the CLI guess which variant a project needs.
- **Named volumes for `CARGO_HOME` and the cargo target directory** (the
  original plan) — rejected; see the revision below.

### Revision, 2026-08-22: bind mounts instead of named volumes

The plan this ADR came from put the cargo target directory and `CARGO_HOME` in
named volumes, for bind-mount write performance on macOS and Windows. Reverted
before implementation, because the surface it bought was larger than the problem
it solved:

- a volume key scheme per workspace/platform/triple/runtime, plus its lifecycle;
- volumes are born root-owned while containers run as the host uid, so a
  privileged init step was needed to avoid `EACCES`;
- `buildCargo` reads the produced `.a` from the host, which a volume hides, so a
  container-side copy-out step was needed;
- `pnpm run clear` would no longer clear everything;
- and crate sources under `$CARGO_HOME/registry/src/` would have had no host
  path, which was the whole reason bridge generation had to move into the
  container.

With `~/.crossbind/cargo` bind-mounted instead, the registry is shared across
projects, survives `clear`, and stays addressable from the host — so bridge
generation and `parseCrateSurface` remain on the host, and only a path
translation is needed. The accepted cost is unmeasured filesystem slowness.

### Revision, 2026-08-23: the release gate, and what it is allowed to assume

The images were reproducible but unattested: a pinned digest proves the bytes did not change, not
that they came from this repository. The gate added here signs them, mirrors the signature, and
refuses to promote anything it has not verified on both registries.

Four choices were left to the implementer. All four are pinned in the release scripts:

- **Signature storage: native OCI 1.1 referrers, and cosign v3.1.3's default is what provides it.**
  This was measured rather than assumed. `scripts/gate-local-signature.js` signs a root index and a
  child leaf with no `--registry-referrers-mode` flag at all, and both are discoverable through
  `oras discover --distribution-spec v1.1-referrers-api` on the source and on a mirror copied with
  `oras cp -r`. The deprecated v2 flag is therefore not passed. Had the default fallen back to the
  legacy tag schema, that gate would have failed and the flag would have gone in.
- **Copying: `oras cp -r` with the native API forced on both ends.** `imagetools create` rebuilds an
  index on the destination and leaves the signature behind on the source; a copy that quietly fell
  back to the tag schema would produce a mirror that looks correct and a policy that finds nothing.
- **Tool versions: cosign v3.1.3, oras 1.3.3**, installed from SHA-pinned actions, with the running
  version asserted before use. No release step queries a "latest version" API - the release path
  does not depend on an external service being up.
- **The digest table keeps its existing JSON shape**; it gained config digests, not a new format.

Two decisions are worth recording because they are easy to get wrong later:

- **The android `linux/amd64` leaf is signed as its own subject**, not covered by `--recursive`. The
  CLI pins that leaf directly - a classic image store holds one platform per digest reference - and
  a consumer verifying the leaf cannot discover a signature attached only to the root index.
- **Build once, promote a digest.** A push run publishes under `v<version>-staging-<run id>` and
  earns the stable tag only after every gate passes on exactly those bytes. Promotion is idempotent
  and never moves an existing stable tag: with no transaction spanning two registries, a rerun after
  a half-finished promotion has to be safe, and silently repointing a published tag is worse than
  failing. Docker Hub is tagged first and canonical GHCR last, so the commit point is the canonical
  registry.

The local signature gate proves MECHANICS, not identity, and the two must not be confused. It signs
with a throwaway key pair, so its negative case is "a key that never signed this is refused". That
is a different claim from the one the release actually depends on: "a certificate identity nothing
in this repository can mint is refused". Keyless identity exists only inside a real workflow run,
against Fulcio, so the local gate cannot stand in for it. Acceptance criterion 11 is satisfied only
when the live staging run shows a non-zero exit for a wrong `--certificate-identity-regexp` against
GHCR - a green local gate says nothing about it.

Subject verification does not use `cosign triangulate`. That command resolves the legacy tag-schema
location, and this release stores signatures as native OCI 1.1 referrers; asserting through it would
be checking a path we do not use. Instead the referrer is discovered through the native API and its
manifest fetched, and `.subject.digest` must equal the digest that was signed - the one claim a
count of referrers can never make. The sign job asserts it on the primary before anything is copied,
and the mirror verification re-asserts it on both registries, from the same script.

The gates split what a single "cosign verify passed" would have conflated: storage (discoverable
through the native API), discovery (identical descriptor sets on both registries), and cryptographic
verification (per subject, per registry, by digest) are separate assertions, plus a negative test
that a certificate identity nothing in this repository can produce is refused.

## See also

- Related ADRs: ADR-0005 (wasi platform), ADR-0006 (rust bindings), ADR-0007 (`cargo:` imports)
- Related code: `tooling/docker/README.md`, `scripts/smoke-images.js`

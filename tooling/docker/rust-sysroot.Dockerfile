# syntax=docker/dockerfile:1
# Builds the Rust sysroots crossbind ships: the stock ST target std plus an MT std rebuilt with
# the shared-memory target features. One builder output, two consumption channels - the web
# image COPY --from's it, and the release packages the same tree as a sha256-pinned artifact
# for RUNNER=LOCAL. Bootstrap lives only in this stage; nothing here reaches a final image.
#
# Digest-pinned (multi-arch INDEX): bump via `docker manifest inspect rust:<tag>`.
ARG RUST_VERSION=1.98.0
FROM rust:${RUST_VERSION}-slim@sha256:cc0448b41c3b7b7fea44f5dc50eacba729a56db365b65b7bd5e8a82d5b3db078 AS builder

ARG RUST_VERSION
# Recorded in the manifest so a sysroot can never be paired with the wrong emscripten.
ARG EMSDK_VERSION=6.0.2
ARG RUST_TARGET=wasm32-unknown-emscripten
# The MT contract (crossbind's MT_RUSTFLAGS): shared memory needs std itself rebuilt with these.
ARG MT_FEATURES=+atomics,+bulk-memory,+mutable-globals
ARG PANIC=abort

ENV OUT=/opt/crossbind/rust/${RUST_VERSION}

RUN rustup component add rust-src && rustup target add ${RUST_TARGET}

# ST: the stock target std, copied into the same layout as MT so the CLI can point --sysroot at
# either one without special-casing.
RUN set -eu; \
    src="$(rustc --print sysroot)/lib/rustlib/${RUST_TARGET}"; \
    mkdir -p "${OUT}/st/lib/rustlib/${RUST_TARGET}"; \
    cp -a "${src}/." "${OUT}/st/lib/rustlib/${RUST_TARGET}/"

# MT: std rebuilt with the shared-memory features. RUSTC_BOOTSTRAP is scoped to this command -
# never an ENV - so no final image can inherit it.
WORKDIR /tmp/mt-seed
RUN set -eu; \
    printf '[package]\nname = "mt-seed"\nversion = "0.0.0"\nedition = "2021"\n[lib]\ncrate-type = ["rlib"]\n' > Cargo.toml; \
    mkdir -p src; echo 'pub fn seed() {}' > src/lib.rs; \
    CARGO_ENCODED_RUSTFLAGS="-Ctarget-feature=${MT_FEATURES}$(printf '\037')-Cpanic=${PANIC}" RUSTC_BOOTSTRAP=1 \
      cargo build -Z build-std=std,panic_abort --target "${RUST_TARGET}" --release; \
    mkdir -p "${OUT}/mt/lib/rustlib/${RUST_TARGET}/lib"; \
    find "target/${RUST_TARGET}/release/deps" -name '*.rlib' ! -name 'libmt_seed-*' \
      -exec cp {} "${OUT}/mt/lib/rustlib/${RUST_TARGET}/lib/" \;

# The manifest is the contract the CLI verifies before it trusts either tree.
RUN set -eu; \
    printf '{\n  "schema": 1,\n  "rustc": %s,\n  "rustcCommit": %s,\n  "emsdk": "%s",\n  "target": "%s",\n  "panic": "%s",\n  "variants": {\n    "st": { "targetFeatures": [] },\n    "mt": { "targetFeatures": [%s] }\n  }\n}\n' \
      "$(rustc -vV | sed -n 's/^release: /"/p' | sed 's/$/"/')" \
      "$(rustc -vV | sed -n 's/^commit-hash: /"/p' | sed 's/$/"/')" \
      "${EMSDK_VERSION}" "${RUST_TARGET}" "${PANIC}" \
      "$(echo "${MT_FEATURES}" | tr ',' '\n' | sed 's/^+//; s/^/"/; s/$/"/' | paste -sd, -)" \
      > "${OUT}/manifest.json"; \
    cat "${OUT}/manifest.json"

# Assert the invariants the release gate re-checks: no bootstrap leaks, both trees populated.
RUN set -eu; \
    test -f "${OUT}/mt/lib/rustlib/${RUST_TARGET}/lib/libstd-"*.rlib; \
    test -f "${OUT}/st/lib/rustlib/${RUST_TARGET}/lib/libstd-"*.rlib; \
    test -z "${RUSTC_BOOTSTRAP:-}"

# Nothing but the sysroots and their manifest: this stage is what ships, and what gets tarred.
FROM scratch AS sysroot
COPY --from=builder /opt/crossbind /opt/crossbind

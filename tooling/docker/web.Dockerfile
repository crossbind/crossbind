# syntax=docker/dockerfile:1

# wasm + wasi targets: Emscripten, the wasi-sdk, and the prebuilt Rust sysroots.
# The emscripten tree is copied out of the digest-pinned upstream image, but its bundled Node is
# not: NODE_JS points at the base image's Node so the container's Node version is our decision and
# not a side effect of the emsdk pin (the CLI's bridge generation runs on it).

ARG BASE_IMAGE=crossbind/base:dev
ARG RUST_SYSROOT_IMAGE=crossbind/rust-sysroot:dev
ARG EMSDK_VERSION=6.0.9

# Digest-pinned (multi-arch INDEX): buildx materializes amd64+arm64 from it; bump via `docker manifest inspect emscripten/emsdk:<tag>`.
FROM emscripten/emsdk:${EMSDK_VERSION}@sha256:96617f27fe16421588241def73908fd348a7f9d260440ed0d00b36dcf7a063cc AS emsdk
FROM ${RUST_SYSROOT_IMAGE} AS sysroot

FROM ${BASE_IMAGE} AS web

# The base image is non-root by default; image assembly still needs to write the toolchain tree.
USER root

ENV EMSDK=/emsdk \
    EM_CONFIG=/emsdk/.emscripten \
    EM_CACHE=/emsdk/upstream/emscripten/cache \
    EMSDK_NODE=/usr/local/bin/node \
    PATH=/emsdk/upstream/emscripten:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

COPY --from=emsdk /emsdk/upstream /emsdk/upstream
# emsdk ships Emscripten's development dependencies (eslint, typescript, vite, webpack, ...). emcc
# needs only the runtime set, and the dev tree carries most of the image's fixable npm and Go CVEs.
RUN cd /emsdk/upstream/emscripten && npm prune --omit=dev --offline --no-audit --no-fund
COPY --from=emsdk /emsdk/LICENSE /opt/licenses/emsdk-LICENSE
COPY --from=emsdk /emsdk/upstream/emscripten/LICENSE /opt/licenses/emscripten-LICENSE

# Written here rather than copied: upstream's config derives NODE_JS from a version-stamped path
# under /emsdk/node, which we deliberately do not ship.
RUN printf '%s\n' \
        "NODE_JS = '/usr/local/bin/node'" \
        "LLVM_ROOT = '/emsdk/upstream/bin'" \
        "BINARYEN_ROOT = '/emsdk/upstream'" \
        "EMSCRIPTEN_ROOT = '/emsdk/upstream/emscripten'" \
        > /emsdk/.emscripten

WORKDIR /emsdk/upstream/emscripten/src/lib
# The overload patch is rebased directly onto the upstream 6.0.9 tag commit.
ARG CROSSBIND_EMSCRIPTEN_REV=708586d3c5c038363756b71671e275c5e6f6ce30
ARG CROSSBIND_EMBIND_SHA256=9635b03ef93c4de7975edcd68bea2c0b8f47cecf0d9a795874631db5faa62c1a
RUN wget -q "https://raw.githubusercontent.com/crossbind/emscripten/${CROSSBIND_EMSCRIPTEN_REV}/src/lib/libembind.js" -O libembind.js && \
    echo "${CROSSBIND_EMBIND_SHA256}  libembind.js" | sha256sum -c -

WORKDIR /emsdk/upstream/emscripten
# Do not let an upstream header change turn this compatibility patch into a silent no-op.
RUN set -eu; \
    needle='smart_ptr<SmartPtr>(smartPtrName);'; \
    for header in ./system/include/emscripten/bind.h ./cache/sysroot/include/emscripten/bind.h; do \
      count="$(grep -Fo "${needle}" "${header}" | wc -l)"; \
      [ "${count}" -eq 1 ] || { echo "expected one smart_ptr patch target in ${header}, found ${count}" >&2; exit 1; }; \
      sed -i 's/smart_ptr<SmartPtr>(smartPtrName);/ /g' "${header}"; \
      ! grep -Fq "${needle}" "${header}"; \
    done

# On-demand system-library builds write here, and containers run as the host uid; owning the mode
# ourselves is what makes the release gate's cache-writability assert a contract rather than a hope.
RUN chmod -R 0777 "${EM_CACHE}"

COPY --from=sysroot /opt/crossbind/rust /opt/crossbind/rust

# rustc takes --sysroot globally, and build scripts and proc-macros compile for the HOST - so each
# variant has to be a complete sysroot, not just the wasm tree. Linking the toolchain's own host
# target in costs nothing and makes `--sysroot <variant>` correct for every unit in the graph.
# `current` keeps the version out of the CLI: it points at whatever this image shipped.
RUN set -eu; \
    host="$(rustc -vV | sed -n 's/^host: //p')"; \
    version="$(ls /opt/crossbind/rust)"; \
    for variant in st mt; do \
      ln -s "/usr/local/rustup/toolchains/${version}-${host}/lib/rustlib/${host}" \
            "/opt/crossbind/rust/${version}/${variant}/lib/rustlib/${host}"; \
    done; \
    ln -s "/opt/crossbind/rust/${version}" /opt/crossbind/rust/current; \
    test -d "/opt/crossbind/rust/current/mt/lib/rustlib/${host}"

# Prove each sysroot is consumable the way the CLI will consume it - stable rustc, no -Z, the same
# target features and panic strategy. A sysroot whose std was built with a different panic strategy
# compiles fine here and fails in the consumer with "does not have the panic strategy", so the
# image build is where that has to surface.
RUN set -eu; \
    mkdir -p /tmp/sysroot-probe/src; cd /tmp/sysroot-probe; \
    printf '[package]\nname="probe"\nversion="0.0.0"\nedition="2021"\n[lib]\ncrate-type=["staticlib"]\n[profile.release]\npanic="abort"\n[workspace]\n' > Cargo.toml; \
    printf 'pub fn f() -> usize { vec![1u32,2,3].iter().sum::<u32>() as usize }\n' > src/lib.rs; \
    sep="$(printf '\037')"; \
    for variant in st mt; do \
      features=""; \
      [ "$variant" = mt ] && features="${sep}-Ctarget-feature=+atomics,+bulk-memory,+mutable-globals"; \
      CARGO_HOME=/tmp/sysroot-probe/.cargo \
      CARGO_ENCODED_RUSTFLAGS="--sysroot${sep}/opt/crossbind/rust/current/${variant}${features}" \
        cargo build --release --target wasm32-unknown-emscripten --target-dir "/tmp/sysroot-probe/t-${variant}"; \
    done; \
    rm -rf /tmp/sysroot-probe

# /opt/wasi-sdk is run.js's fallback when no host WASI_SDK_PATH is set; sha256-pinned per arch.
WORKDIR /opt
ARG TARGETARCH
ARG WASI_SDK_VERSION=34
RUN case "$TARGETARCH" in \
      arm64) WASI_ARCH=arm64;  WASI_SHA=f7e243dff54d60bcc576e94d6166b69f410f2500ae4a9ceef34315be10e77971 ;; \
      *)     WASI_ARCH=x86_64; WASI_SHA=b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4 ;; \
    esac && \
    wget -q "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION}/wasi-sdk-${WASI_SDK_VERSION}.0-${WASI_ARCH}-linux.tar.gz" -O wasi-sdk.tar.gz && \
    echo "${WASI_SHA}  wasi-sdk.tar.gz" | sha256sum -c - && \
    tar -xzf wasi-sdk.tar.gz && \
    mv "wasi-sdk-${WASI_SDK_VERSION}.0-${WASI_ARCH}-linux" wasi-sdk && \
    rm wasi-sdk.tar.gz

# Texts for redistributed toolchains whose releases ship none; pinned to the built revisions.
WORKDIR /opt/licenses
ARG LLVM_REV=895aa2c896ada719451be2e3673c83da8ddf1141
ARG WASI_LIBC_REV=2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13
RUN wget -q "https://raw.githubusercontent.com/WebAssembly/wasi-sdk/wasi-sdk-${WASI_SDK_VERSION}/LICENSE" -O wasi-sdk-LICENSE && \
    wget -q "https://raw.githubusercontent.com/llvm/llvm-project/${LLVM_REV}/LICENSE.TXT" -O llvm-LICENSE.TXT && \
    wget -q "https://raw.githubusercontent.com/WebAssembly/wasi-libc/${WASI_LIBC_REV}/LICENSE" -O wasi-libc-LICENSE && \
    wget -q "https://raw.githubusercontent.com/WebAssembly/wasi-libc/${WASI_LIBC_REV}/LICENSE-APACHE" -O wasi-libc-LICENSE-APACHE && \
    wget -q "https://raw.githubusercontent.com/WebAssembly/wasi-libc/${WASI_LIBC_REV}/LICENSE-APACHE-LLVM" -O wasi-libc-LICENSE-APACHE-LLVM && \
    wget -q "https://raw.githubusercontent.com/WebAssembly/wasi-libc/${WASI_LIBC_REV}/LICENSE-MIT" -O wasi-libc-LICENSE-MIT && \
    printf '%s\n' \
      "268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5  wasi-sdk-LICENSE" \
      "8d85c1057d742e597985c7d4e6320b015a9139385cff4cbae06ffc0ebe89afee  llvm-LICENSE.TXT" \
      "2711a8b5a5cdfef0e639f96c1aca12ae23d7d64a02d0507f1bdf14d2b27bbc3a  wasi-libc-LICENSE" \
      "a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2  wasi-libc-LICENSE-APACHE" \
      "268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5  wasi-libc-LICENSE-APACHE-LLVM" \
      "23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3  wasi-libc-LICENSE-MIT" \
      | sha256sum -c -

WORKDIR /
USER 10001:10001

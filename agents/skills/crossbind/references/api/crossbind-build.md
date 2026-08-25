<!-- GENERATED from docs/api/crossbind-build.md by scripts/build-agent-skill.mjs. Do not edit. -->

# `crossbind.build.js` — Package-author Build Hooks

> **Port authors only.** Apps and libraries consuming `@crossbind/port-*` do not write this file. Each platform variant owns one at `ports/<name>/<platform>/crossbind.build.js`; the shared recipe lives at `ports/<name>/base/build.mjs`, and variants import or extend it.

`crossbind.build.js` describes how to fetch and build the upstream C++ library that this package wraps. The CLI auto-merges its exports into `config.build` of the sibling `crossbind.config.js` at build time.

## Shape

```js
export default {
  // ─────────────────────────────────────────────────────────────
  // Source acquisition (pick ONE)
  // ─────────────────────────────────────────────────────────────
  getURL: (version) => 'https://example.com/upstream-${version}.tar.gz',
    // Simplest path: return a tarball URL. The CLI fetches + extracts
    // into state.config.paths.build automatically.
    // `version` is the nativeVersion field from package.json.

  sha256: '1051c33d…',
    // Checksum of the tarball getURL returns. Verified on download, and the
    // single source for license/SBOM rows and the -bin provenance block
    // (contract K4) — required for packages that publish binaries.

  // OR

  getSource: async (state) => {
    // Custom: clone, copy from another dep, generate, etc.
    // state.config.paths.build is your staging dir.
    // For autotools projects without a CMake fork, this is where
    // you'd run `git clone` or `cp -R` from a sibling.
  },

  // ─────────────────────────────────────────────────────────────
  // Build system selector
  // ─────────────────────────────────────────────────────────────
  buildType: 'cmake',
    // 'cmake'     — default; the CLI runs cmake configure + build.
    // 'configure' — runs `./configure && make` for autotools projects.
    //               See ports/openssl-* for the canonical example.

  makePhases: ['all', 'install'],
    // 'configure' only: split the make step into explicit phases when a
    // single `make` is not enough (openssl needs `make all` + `make install`).

  // ─────────────────────────────────────────────────────────────
  // Published tool surface + vendored copies (contract-governed)
  // ─────────────────────────────────────────────────────────────
  bin: { /* tools map */ },
    // -bin packages only: the single-source tool map. The engine derives the
    // npm command shims, .npmignore, crossbind-bin.json and the multicall
    // multitool from it, and stamps crossbind.provenance + the compound license
    // field into package.json. Full schema and rules ("Bin & License
    // Contract"): ports/README.md.

  bundled: { wasi: [{ name: 'libpng', version: '1.6.43', license: 'libpng-2.0', files: ['frmts/png/libpng/LICENSE'] }] },
    // Third-party copies the upstream compiles INTO the artifact, per
    // platform (e.g. GDAL's internal codecs). `crossbind licenses` turns these
    // into notice/SBOM rows with texts pulled from the source tree.

  // ─────────────────────────────────────────────────────────────
  // Configure-step parameters
  // ─────────────────────────────────────────────────────────────
  getBuildParams: (state, target) => [
    '-DBUILD_SHARED_LIBS=OFF',
    '-DBUILD_TESTING=OFF',
  ],
    // Extra cmake -D flags (or autotools args). Receives:
    //   state  — full resolved config + state object
    //   target — current build target ({ platform, arch, runtime, … })
    //
    // Use `target` to branch on per-arch needs:
    //   target.platform === 'wasm' | 'android' | 'ios'
    //   target.runtime  === 'st' | 'mt'

  // ─────────────────────────────────────────────────────────────
  // Build-time env vars (CFLAGS / CXXFLAGS / LDFLAGS as string literals)
  // ─────────────────────────────────────────────────────────────
  env: (target) => [
    'CFLAGS="-fPIC -DSQLITE_ENABLE_FTS5"',
    'LDFLAGS="-Wl,--no-undefined"',
  ],
    // Function form receives target; can also be a plain string array.
    // DIFFERENT from crossbind.config.js `env: {}` which is RUNTIME env.

  // ─────────────────────────────────────────────────────────────
  // Extra link libraries
  // ─────────────────────────────────────────────────────────────
  getExtraLibs: (target) => ['-lpthread', '-lm'],
    // Returns extra libs appended to the link line beyond what
    // `dependencies` already wires up. Rarely needed; most upstream
    // libs declare their own link deps.

  // ─────────────────────────────────────────────────────────────
  // Upstream source patching (regex)
  // ─────────────────────────────────────────────────────────────
  replaceList: [
    {
      regex: /CPL_CPUID\(1, cpuinfo\);/g,
      replacement: '#ifdef __wasm__\ncpuinfo[0]=0;\n#else\nCPL_CPUID(1, cpuinfo);\n#endif',
      paths: ['port/cpl_cpu_features.cpp'],
    },
  ],
    // Patch the extracted upstream source before configure. Each entry:
    //   regex       — matched against file contents
    //   replacement — substitution
    //   paths       — file globs (relative to state.config.paths.build)
    //
    // Real users: gdal-wasm (CPU intrinsic gating), curl-wasm
    // (Emscripten Fetch API swap), sqlite3-android (Makefile fixups).
    //
    // Function form (sourceReplaceList) gets state + depPaths if you
    // need them to compute the regex/replacement:
    //   sourceReplaceList: (target, depPaths) => [...]

  // ─────────────────────────────────────────────────────────────
  // Asset copying — into source dir before build, into dist after
  // ─────────────────────────────────────────────────────────────
  copyToSource: {
    'assets/empty.cpp': ['src/empty.cpp'],   // copy assets/empty.cpp → ${build}/src/empty.cpp
  },
    // Inject files into the build dir BEFORE configure. Used by gdal
    // to inject an empty .cpp that forces the linker to include
    // missing object files.

  copyToDist: {
    'assets/cacert.pem': ['ssl/certs/cacert.pem'],   // copy → ${output}/ssl/certs/cacert.pem
  },
    // Ship extra files alongside the built artifacts. Used by openssl
    // to include the CA bundle.

  // ─────────────────────────────────────────────────────────────
  // Lifecycle overrides (advanced)
  // ─────────────────────────────────────────────────────────────
  setState: (state) => {
    // Mutate state once at init time, after config load but before
    // any target build. Used by extensions to inject data.
    // Most package authors don't write this.
  },

  beforeRun: (cmakeDir) => [
    { program: 'autoreconf', parameters: ['-fi'] },
  ],
    // Run shell commands before cmake configure. Returns array of
    // {program, parameters}. Used by autotools projects to
    // regenerate configure scripts after `replaceList` patches.

  prepare: async (state) => {
    // Pre-configure step (after `getSource`/`getURL` extracts the
    // tarball, before cmake configure runs). Patch source, generate
    // headers, fetch sub-deps. Default: no-op.
  },

  build: async (state) => {
    // Override the entire build step. Default: cmake configure +
    // build, or `./configure && make` if buildType === 'configure'.
    //
    // Only override when the upstream's build system can't be
    // shoehorned into one of those two. Heavy lift; rare.
  },
}
```

## How the CLI uses these hooks

For each architecture sub-package (`-wasm`, `-android`, `-ios`), the CLI:

1. Reads the package's `nativeVersion` from `package.json`.
2. Calls `getURL(version)` (or `getSource(state)`) to populate `state.config.paths.build`.
3. Runs `prepare(state)` if defined.
4. Calls `build(state)` if defined; otherwise:
   - `buildType: 'cmake'` → `cmake -S <build> -B <build/build> [getBuildParams flags] && cmake --build`
   - `buildType: 'configure'` → `./configure [getBuildParams flags] && make && make install`
5. Collects artifacts (`.a`, `include/`, …) into `state.config.paths.output`.

## Example: zlib (canonical small example)

```js
// ports/zlib/wasm/crossbind.build.js
export default {
  getURL: (version) => `https://zlib.net/zlib-${version}.tar.gz`,
  buildType: 'cmake',
  getBuildParams: () => ['-DZLIB_BUILD_SHARED=OFF', '-DZLIB_BUILD_TESTING=OFF'],
}
```

## Example: autotools (OpenSSL)

```js
export default {
  getURL: (version) => `https://www.openssl.org/source/openssl-${version}.tar.gz`,
  buildType: 'configure',
  getBuildParams: (state, target) => {
    const flags = ['no-shared', 'no-tests', 'no-docs']
    if (target.platform === 'wasm') flags.push('linux-generic32')
    if (target.platform === 'ios')  flags.push('iphoneos-cross')
    return flags
  },
}
```

## Example: per-target source patching

```js
export default {
  getURL: (version) => `https://github.com/upstream/proj/archive/refs/tags/${version}.tar.gz`,
  buildType: 'cmake',
  prepare: async (state) => {
    // Patch a header to disable a problematic feature on iOS.
    if (state.target.platform === 'ios') {
      const fs = await import('node:fs/promises')
      const file = `${state.config.paths.build}/src/proj_internal.h`
      let content = await fs.readFile(file, 'utf8')
      content = content.replace('#define HAVE_LOCALECONV 1', '')
      await fs.writeFile(file, content)
    }
  },
  getBuildParams: () => ['-DBUILD_TESTING=OFF', '-DENABLE_CURL=OFF'],
}
```

## When to choose which hook

| You need to | Use |
|-------------|-----|
| Download an upstream tarball | `getURL` |
| Use a git checkout, monorepo dep, or generated source | `getSource` |
| Inject CMake / configure flags | `getBuildParams` |
| Patch source files between fetch and build | `prepare` |
| Replace the build runner entirely | `build` |

Start with the simplest hook that works. Most packages need only `getURL` + `buildType` + `getBuildParams`.

## See also

- [`crossbind-config.md`](./crossbind-config.md) — sibling config file. The CLI merges this file's exports into `config.build`.
- `docs/playbooks/new-port.md` — full walkthrough of authoring a new `ports/*` family.
- ADR-0002 — pnpm topological build order driven by `dependencies` in `package.json` (NOT here).
- Canonical examples: `ports/zlib/` (smallest), `ports/openssl/` (autotools), `ports/gdal/` (largest aggregator).

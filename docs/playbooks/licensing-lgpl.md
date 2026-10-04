# Playbook — Shipping closed-source apps with LGPL native dependencies

> App authors whose crossbind dependency tree contains copyleft-licensed native libraries (run `crossbind licenses` — in the geo stack that is GEOS and libiconv today, plus spatialite's license choice) and whose own application is proprietary.

**This is engineering guidance, not legal advice. For high-stakes products, have a licensing lawyer review.**

## TL;DR

crossbind's default architecture already implements the most defensible LGPL pattern: **all native code lives in open packages, your closed code is JavaScript, and the native artifact is a separate, replaceable file loaded at runtime.** Your obligations then reduce to notices + pointing at the public sources + keeping the artifact replaceable.

```bash
crossbind licenses                 # what is bundled, under which SPDX license, from which source
crossbind licenses --notices       # generate THIRD-PARTY-NOTICES.md for your app
crossbind licenses --sbom          # CycloneDX SBOM (component list with source hashes)
crossbind licenses --check         # CI guard: every license field must be valid SPDX
# --platform wasi additionally rows up vendored copies + the statically linked
# toolchain runtime (what the artifact contains beyond the package graph)
```

## Why the pattern works

The shipped native artifact (wasm / `.so` / xcframework) contains only open code: the LGPL libraries, the crossbind runtime and bridges (MIT), and openly published wrapper packages. Your proprietary part is JS that calls the artifact's interface at runtime — analogous to a proprietary app dynamically linking an LGPL `.so` (LGPL-3.0 §4(d)(1)). A user can take the public package sources, modify the LGPL library (`crossbind.overrides.js` is exactly this — see [override-dependencies](./override-dependencies.md)), rebuild the artifact and swap the file, without ever touching your JS.

The package recipes make the "corresponding source + build scripts" obligation concrete: `getURL(nativeVersion)` pins the exact upstream tarball and `getBuildParams` documents the exact flags — both shown by `crossbind licenses`.

## Rules to keep it valid

1. **No proprietary native code in the same artifact.** Keep `paths.native` empty in the closed app; put any C++ you write into an openly published crossbind package (wrap the LGPL calls there). If you must keep native code closed, you leave this pattern — see "Relink kit" below.
2. **Keep the artifact a separate, replaceable file.** Don't inline the wasm into the JS bundle; on Android the `.so` already ships as a separate APK entry; on iOS prefer a dynamic framework.
3. **Pin and point.** Ship NOTICES (the `--notices` output) naming exact package versions; the npm packages + recipes must stay publicly available for those versions.
4. **Interface stability.** A user's interface-compatible modified library must work — document your exported API, don't break it gratuitously.

## Per-platform notes

| Platform | Mechanism | Notes |
|---|---|---|
| Web/wasm | wasm fetched & instantiated at runtime | Cleanest case. Serving the app is conveying: link NOTICES/source from the app UI. |
| Android | `.so` inside the APK | User can repack & re-sign with a modified `.so`; widely accepted (FFmpeg-LGPL pattern). |
| iOS | xcframework / dynamic framework | Code-signing makes "run modified versions" contested even for LGPL — the gray zone is identical to every other LGPL-on-iOS approach; get legal review. |

## Sharp edges

- **Header/template trap:** LGPL §3 only permits "small" inline/template material (≤10 lines) from library headers inside non-LGPL object code. C APIs (zlib, iconv) are safe; template-heavy C++ LGPL libraries are not — keep any closed native code free of LGPL headers (another reason to put the wrapper in an open package and license the *wrapper's own* headers permissively).
- **Wrapper license choice:** your wrapper package may be MIT (friendlier to consumers; the LGPL stays on the library itself) or LGPL (simplest single-license story). Both comply.
- **Relink kit (only if you insist on closed native code):** then LGPL requires shipping your application's linkable objects + link commands so users can relink with a modified library. crossbind already produces per-target static archives of your sources (`.crossbind/build/Source-*/…`); packaging them with the link command is the manual version of a future `crossbind export-relink-kit`. On Android the cleaner alternative is building the LGPL dependency as its own `.so` (dynamically linked, replaceable in the APK) so your mixed library never embeds it.
- **Platform asymmetry:** with no closed native code, Android needs nothing extra — the whole `libreact-native-crossbind.so` is open-buildable and OS-loaded at runtime. iOS is the constrained platform: static xcframeworks link into the closed app executable, so prefer dynamic frameworks there.

## Reference

- [`override-dependencies.md`](./override-dependencies.md) — how a user rebuilds a dependency with modified version/flags.
- `crossbind licenses --check` in CI keeps SPDX metadata trustworthy (package policy: the npm package's `license` field mirrors the wrapped native library's license).
- Ready-made Node packages (`@crossbind/port-<family>-node`) ship the addon prebuilt: each `-node-<platform>-<arch>` package's addon links every component statically, so the package carries the derived `license` field, a `LICENSE` with every component's text and `sbom.cdx.json`. When the addon links an LGPL library (GEOS, libiconv, spatialite's LGPL option), its `LICENSE` also names the exact source tag and the steps to relink it with a modified library. The addon stays a separate file the app loads at runtime, which keeps it replaceable (rule 2 above).
- `-bin-wasi` tool packages are a different distribution shape: the published binary statically links every component, so their `license` field is DERIVED as the AND of all effective component licenses (e.g. `@crossbind/port-geos-bin-wasi` declares `… AND LGPL-2.1-only`), the NOTICE/SBOM ship in the tarball, `crossbind.provenance` records the reproducible recipe, and the from-source path (`pnpm --dir <pkg> build`) is a first-class mode. Rules: `ports/README.md` (the Bin & License Contract).

# AGENTS.md — @crossbind/example-lib-prebuilt-matrix

> Canonical minimal **application-owned C++ library packaging** reference. This is a published example package, not a `ports/*` family template.

## What this example is for

- Smallest working example of “I have a tiny C++ project and want other examples or E2E fixtures to consume it.”
- Used by browser, Node and React Native examples and fixtures as a workspace dependency.
- Reference for `crossbind.config.js` shape with `export.type: 'cmake'`.

## Layout

```
examples/lib-prebuilt-matrix/
├── src/native/                           ← C++ source (matrix multiplier)
├── playground/                           ← optional standalone test
├── crossbind.config.js                       ← export.type cmake, base + output paths
├── crossbind-example-lib-prebuilt-matrix.podspec  ← iOS package manifest
├── dist/                                 ← generated package output; do not hand-edit
├── package.json
└── README.md
```

`prepublishOnly` rebuilds `dist/` before publication. The directory is generated and filtered out of create-app templates.

## Why an example, not a port family

Two reasons:
1. The matrix-multiplier C++ is application-owned demonstration code, not a versioned upstream dependency.
2. Demonstrates the inline alternative to packaging: the user's own C++ wrapped in a `crossbind.config.js` and exported as a workspace dep.

If you're looking at how a real prebuilt package is shaped, see `ports/zlib/` instead — that's the canonical for new `ports/*`.

## Build matrix

```bash
# Everything (default)
pnpm --filter=@crossbind/example-lib-prebuilt-matrix run build

# Per-platform
pnpm --filter=@crossbind/example-lib-prebuilt-matrix run build:wasm
pnpm --filter=@crossbind/example-lib-prebuilt-matrix run build:android
pnpm --filter=@crossbind/example-lib-prebuilt-matrix run build:ios          # macOS only
```

`prepublishOnly` runs `crossbind build` so `pnpm publish` always ships fresh artifacts.

## Common pitfalls

- **Treating this as a `ports/` template.** It is an example; for port authoring follow `docs/playbooks/new-port.md` and mirror `ports/zlib/`.
- **Editing `dist/prebuilt/` manually.** Rebuild the example after changing its native source or config.
- **Forgetting `prepublishOnly`.** Without it, npm could publish a stale `dist/`. The script is the safety net.
- **Adding a heavy native dep** (e.g. another package). Defeats the "smallest possible" purpose. Keep it tiny.
- **Wrapping with extra plugins** (Metro, Vite, etc.). The example is plugin-free; consumers add their own plugins.

## Validation

```bash
# Build
pnpm --filter=@crossbind/example-lib-prebuilt-matrix run build

# Verify prebuilt artifacts
pnpm run check:dist | rg example-lib-prebuilt-matrix

# Smoke a downstream consumer
pnpm --filter=@crossbind/example-backend-nodejs-wasm run build
node examples/backend-nodejs-wasm/src/index.js
```

## Reference

- Port-authoring playbook (the real flow for `ports/*`): `docs/playbooks/new-port.md`
- Real-package canonical template: `ports/zlib/`
- Representative downstream consumers of this example:
  - `examples/mobile-reactnative-cli/`
  - `examples/mobile-reactnative-expo/`
  - `examples/backend-nodejs-wasm/`

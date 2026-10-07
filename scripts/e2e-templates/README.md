# e2e-templates

Scaffolds **every `create-crossbind` template** and runs its real build + e2e suite,
exactly as an end user would after `npm create crossbind@beta`. It catches the failures the
monorepo hides: unpublished `@crossbind/*` versions, workspace-only config that leaks
into scaffolds, and templates that don't build/run standalone.

## Usage

```bash
pnpm run e2e:templates -- [options]
# or
node scripts/e2e-templates.js [options]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--source npm\|local` | `npm` | `npm`: use the published scaffolder (`npx create-crossbind@<tag>`). `local`: build `templates/` from the working tree, `npm pack`, and run that tarball. |
| `--tag <tag>` | `beta` | npm dist-tag for `--source npm`. |
| `--pm pnpm\|npm` | `pnpm` | Package manager for scaffolded projects. |
| `--only a,b,c` | — | Run only these manifest `key`s (e.g. `web-react-vite`). |
| `--filter <substr>` | — | Run templates whose key contains `<substr>`. |
| `--skip-build` / `--skip-e2e` | off | Faster smoke runs. |
| `--clean` | off | Wipe `tmp/e2e-templates/` first. |
| `--list` | off | Print the plan + host-capability gating and exit (no builds). |
| `--json` | off | Also write `tmp/e2e-templates/summary.json`. |

Scaffolded projects, logs, and the summary live under `tmp/e2e-templates/` (gitignored).
Exit code is non-zero if any template **FAILS**; SKIPs (missing Docker/emulator) do not fail the run.

Start with `node scripts/e2e-templates.js --list` to see what your machine can run.

## What runs per template

| Class | Build | E2E | Needs |
| --- | --- | --- | --- |
| web (vanilla, react-rspack/vite, vue, svelte) | `crossbind build` / bundler (Docker) | Playwright `e2e:prod`→`e2e:dev` | Docker |
| cloud (cloudflare-worker) | `crossbind build` (Docker) | Playwright + `wrangler dev` | Docker |
| backend (nodejs-wasm, nodejs-native, nodejs-standalone) | `crossbind build` (Docker); standalone builds nothing | `e2e:prod` where the template has one (native, standalone); otherwise the build is the assertion | Docker |
| native (executable) | `crossbind build -p host -e native` (Docker; macOS executables on a Mac) | `e2e:prod` runs the host's executables | Docker |
| desktop (electron) | `crossbind build -p host -e node` (Docker; macOS addons on a Mac) | `e2e:prod` packages the app with electron-builder and opens it with Playwright | Docker, a display (Linux: `DISPLAY`, e.g. `xvfb-run`) |
| lib-prebuilt | `crossbind build` (Docker) | none | Docker |
| lib-source, lib-cmake | none | none | — (scaffold+install only) |
| mobile-reactnative-cli | via `e2e:*` | Maestro `e2e:ios` / `e2e:android` | iOS sim or Android emulator + Maestro |
| mobile-reactnative-expo | — | none → `expo prebuild` smoke | node |

## CI wiring (suggested)

- **On PR** — test the branch you're about to publish:
  `node scripts/e2e-templates.js --source local --json`
- **Daily (e.g. 08:00)** — test what's actually published on npm:
  `node scripts/e2e-templates.js --source npm --tag beta --json`

## Known limitations

- **`--source local` dependency resolution:** the scaffolder is local, but the scaffolded
  project's `@crossbind/*` deps still install from npm. So local mode also asserts "are the
  current workspace versions published?". For fully offline isolation, point npm at a local
  registry (e.g. Verdaccio).
- **Playwright `webServer` hardcodes `pnpm run …`** in the sample configs, so web/cloud e2e
  needs `pnpm` on `PATH` regardless of `--pm`.
- **Wasm/native builds require Docker** (`crossbind/crossbind` image, pulled on first run). Mobile
  e2e requires a booted simulator/emulator and Maestro; missing pieces are reported as SKIP.

# AGENTS.md — @crossbind/example-mobile-reactnative-cli

> Canonical reference example for the **React Native CLI** integration. `docs/playbooks/integration/react-native-cli.md` and the native CI workflows point here.

## What this example is for

- A minimal RN-cli app that loads `@crossbind/example-lib-prebuilt-matrix` and calls into it from JS.
- Reference for `metro.config.js` + `crossbind.config.mjs` shape in a bare RN project.
- Source of the **CI bridge cache** used by `.github/workflows/test-ios-sample.yml` to skip SWIG bridge generation in CI.

## Layout

```
examples/mobile-reactnative-cli/
├── android/                              ← bare RN Android project
├── ios/                                  ← bare RN iOS project (Podfile + Podfile.lock)
├── ci/
│   └── crossbind-snapshot/                   ← bridge fixtures restored by iOS workflow
│       ├── build/bridge/native.i.cpp
│       ├── build/bridge/native.i.cpp.exports.json
│       ├── build/interface/native.i
│       └── cache.json
├── src/                                  ← RN app and native bridge input
├── __tests__/                            ← Jest component smoke
├── app.json
├── crossbind.config.mjs                  ← imports @crossbind/example-lib-prebuilt-matrix
├── metro.config.js                        ← wraps getDefaultConfig with CrossbindMetroPlugin
├── package.json
└── maestro.yaml                          ← native UI E2E flow
```

## Key files an agent will touch

- **`metro.config.js`** — exact wiring for `@crossbind/plugin-metro`. Used as the canonical example in `docs/playbooks/integration/react-native-cli.md`.
- **`crossbind.config.mjs`** — shows how to consume a workspace dep (`@crossbind/example-lib-prebuilt-matrix`).
- **`ci/crossbind-snapshot/`** — git-tracked fixtures. **Do not delete.** The iOS workflow's `cp -r ci/crossbind-snapshot/. .crossbind/` step depends on them.

## CI bridge cache pattern

The directory is named `crossbind-snapshot/` (not `.crossbind/`) on purpose: `pnpm clear:cache:examples` and similar globs match `*/.crossbind`, which would otherwise wipe these fixtures. Renaming the snapshot dir survives clear globs.

The iOS workflow restores the snapshot **before** `pod install` so SWIG / bridge generation can be skipped in CI:

```yaml
- name: Restore cached bridge files
  run: |
    mkdir -p ./examples/.../my-app/.crossbind
    cp -r ./examples/.../my-app/ci/crossbind-snapshot/. ./examples/.../my-app/.crossbind/
```

The trailing `/.` + `mkdir -p` keeps the merge nesting-safe regardless of pre-existing state in the runner.

If you regenerate the snapshot, re-commit the four files under `ci/crossbind-snapshot/build/...` and `ci/crossbind-snapshot/cache.json`.

## Validation

Local (macOS):

```bash
pnpm install
cd examples/mobile-reactnative-cli/ios && pod install && cd -
pnpm --filter=@crossbind/example-mobile-reactnative-cli ios

# E2E
pnpm run e2e:ios
```

Local (Linux/macOS for Android):

```bash
pnpm --filter=@crossbind/example-mobile-reactnative-cli android
pnpm run e2e:android
```

CI: `.github/workflows/test-ios-sample.yml` and `test-android-sample.yml`.

## Common pitfalls

- **Deleting `ci/crossbind-snapshot/`** with a careless `rm -rf` or assuming it's regenerable — it isn't (well, it is, but only after a full local build that we skip in CI).
- **Renaming back to `ci/.crossbind`.** `pnpm run clear`-style globs will eat it.
- **Skipping `pod install`** after touching the RN plugin's `react-native-crossbind.podspec`. Cached pods will be wrong.
- **Editing the `monorepo` `watchFolders` config** in `metro.config.js` to point elsewhere. The default `require('path').resolve('../../')` is intentional — Metro must see the workspace root to resolve the crossbind plugin packages.
- **Adding `ios/Pods/` or `android/.gradle/` to git.** They're ignored; build artifacts.

## Reference

- RN-cli playbook: `docs/playbooks/integration/react-native-cli.md`
- Plugin source: `plugins/react-native/AGENTS.md`
- iOS CI workflow: `.github/workflows/test-ios-sample.yml`
- Snapshot restoration logic in CI: see "Restore cached bridge files" step

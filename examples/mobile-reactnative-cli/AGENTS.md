# AGENTS.md — @crossbind/example-mobile-reactnative-cli

> Canonical reference example for the **React Native CLI** integration. `docs/playbooks/integration/react-native-cli.md` and the native CI workflows point here.

## What this example is for

- A minimal RN-cli app that loads `@crossbind/example-lib-prebuilt-matrix` and calls into it from JS.
- Reference for `metro.config.js` + `crossbind.config.mjs` shape in a bare RN project.

## Layout

```
examples/mobile-reactnative-cli/
├── android/                              ← bare RN Android project
├── ios/                                  ← bare RN iOS project (Podfile + Podfile.lock)
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

- **Skipping `pod install`** after touching the RN plugin's `react-native-crossbind.podspec`. Cached pods will be wrong.
- **Editing the `monorepo` `watchFolders` config** in `metro.config.js` to point elsewhere. The default `require('path').resolve('../../')` is intentional — Metro must see the workspace root to resolve the crossbind plugin packages.
- **Adding `ios/Pods/` or `android/.gradle/` to git.** They're ignored; build artifacts.

## Reference

- RN-cli playbook: `docs/playbooks/integration/react-native-cli.md`
- Plugin source: `plugins/react-native/AGENTS.md`
- iOS CI workflow: `.github/workflows/test-ios-sample.yml`

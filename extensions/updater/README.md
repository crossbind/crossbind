# @crossbind/extension-updater

A desktop app's own updates, each checked against its Ed25519 signature.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```js
import { updater } from 'crossbind/app';

const update = await updater.check();
if (update) await updater.install();
```

`updater.install` downloads the version `updater.check` found, installs it once its signature holds, then quits the app
and opens the new one.

## Options

`app.updater` turns it on: `{ url, publicKey }`, the address of the manifest an update is listed in and the Ed25519
public key that checks it. `npx crossbind app updater-key` makes the key pair; a build with the private key in
`CROSSBIND_UPDATER_PRIVATE_KEY` writes each platform's update and its signed manifest beside the app.

## Platforms

macOS, Linux and Windows. A Linux app updates itself from what `tar-gz` makes, and a Windows app from what `nsis` makes. An iOS or Android app updates through its store, and `updater.check()` rejects there.

## Replace or leave out

It holds the role `updater`. An extension that gives `replaces: 'updater'` takes it; `app: { without: ['updater'] }` in `crossbind.config.js` leaves it out. Its update goes with it. Leaving it out while `app.updater` is set stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#updates) has the manifest and where to put it.

It carries Monocypher 4.0.3 (BSD-2-Clause or CC0-1.0), whose Ed25519 and SHA-512 check an update, in `native/monocypher/`;
provenance in its README.

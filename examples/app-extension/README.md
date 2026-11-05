# @crossbind/example-app-extension

An app extension: a function of the app's native code, which its page calls on macOS, iOS, Android, Windows and Linux.
[The contract](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md) says what an extension is, and
[the playbook](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/new-extension.md) the order of the work
of making this one your own.

## Use

Once it is on npm, `npx crossbind add @crossbind/example-app-extension` installs it in an app and lists it in the app's
`crossbind.config.js`, whose host builds its native code in; until then, `crossbind add` takes the tarball `npm pack`
makes. The config it writes:

```js
import starter from '@crossbind/example-app-extension/crossbind.extension.js';

export default {
    target: { runtimeEnv: 'app' },
    extensions: [starter()],
};
```

```js
import { greet } from '@crossbind/example-app-extension';

console.log(await greet('crossbind')); // Hello, crossbind, from <the app's name>
```

## Files

- `crossbind.extension.js`: the extension, named 'starter', and the sources each platform compiles.
- `native/starter.cpp`: its entry, which adds the functions the page calls as `starter.<function>`.
- `index.js` and `index.d.ts`: the page's functions, which call the extension's with `invoke` from `crossbind/app`.

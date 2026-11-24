# @crossbind/extension-preview

The crossbind app's previews of the projects of the account it is signed in to: the device sign-in, the account's token
in the system's store, the account's list of the projects `crossbind app preview` runs, and each project opened in the
app's window, after its source proved it is that preview. It is the crossbind app's own, and is not published.

## Use

In the crossbind app's `crossbind.config.js`:

```js
import preview from '@crossbind/extension-preview/crossbind.extension.js';

export default {
    target: { runtimeEnv: 'app' },
    extensions: [preview()],
};
```

`preview({ cloud })` names the cloud the build asks: `'production'`, the default, or `'staging'`, each with its
snapshot host. A test names a cloud on its machine's loopback and its snapshot host, as
`preview({ cloud: 'http://127.0.0.1:8686', snapshots: 'http://127.0.0.1:8687' })`. Neither a link nor a page changes it.

The app's own page calls it; a page of a project reaches none of its functions:

```js
import { preview } from '@crossbind/extension-preview';

const { account } = await preview.account();
await preview.signIn({
    onMessage: (message) => (message.code ? showCode(message.code, message.page) : askForNumber()),
});
const { sessions, message } = await preview.sessions();
const sheet = await preview.check(sessions[0].id);
location.href = (await preview.open(sessions[0].id)).url;
```

- `signIn()` sends the code to enter on the cloud's page, then asks for the two digits that page shows, which
  `signInNumber(number)` sends once; `openSignInPage()` shows the page.
- `check(session)` reads the session from the account's list again, asks its source for the session with a challenge
  of its own, and checks the protocol, the proof made with the session's key, then the account and the session the
  proof covers; it answers the Open sheet's lines, or rejects with what to tell the app's user.
- `open(session)` serves the session checked last as an origin of the account's and the project's own, whose storage
  stays for the next time, and whose requests go to the session's source alone; `close()` ends it.
- `signOut()`, `deleteAccount()`, `compile({ files, packages })` and `removeSnapshot(session)` make the cloud's calls
  that take the token.
- `links()` gives the links of `dev.crossbind.app://open?s=<session>`, and on iOS and Android of
  `https://crossbind.dev/open/?s=<session>`, that opened the app; each names a session alone, which the page opens
  from the account's list.

## What a project's page reaches

The extension takes the host's `page-permissions` and `page-drops`, and decides by the page's role. The app's own page
gets what the host's own give it: the devices `app.permissions` lists, the clipboard's text on its user's gesture, and
the paths of the files dropped on it. A project's page gets none of the kinds that would ask its user, the camera, the
microphone, the location and the clipboard's read among them, and no path of a drop: its page's own `drop` event keeps
the dropped files. A page of no role gets nothing.

## Platforms

The token never reaches a page: the extension makes every call that carries it.

- iOS: the keychain, for this device alone.
- macOS: the data protection keychain where the app's signing gives one, as the Mac App Store's does; else the
  file-based keychain, which asks its user once a build.
- Android: a key of the Android Keystore seals it, in a file that no backup takes.
- Windows: the Credential Manager.
- Linux: the Secret Service, through libsecret; with no keyring running, it is kept for the run alone.

iOS and macOS ask their user before the app reaches a dev server on the local network: until then the check says what
to allow, and tries again.

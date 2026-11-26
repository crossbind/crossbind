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
- `ended()` gives the previews that ended other than by `close()`: `{ message }` for one the extension ended, as a
  snapshot no longer listed or a sign-out, and `{}` for one its user closed from the preview's menu or with Back; later
  ones come as the event `preview.ended`.

## What a project's page reaches

The extension takes the host's `page-permissions` and `page-drops`, and decides by the page's role. The app's own page
gets what the host's own give it: the devices `app.permissions` lists, the clipboard's text on its user's gesture, and
the paths of the files dropped on it. A project's page gets no path of a drop: its page's own `drop` event keeps the
dropped files. A page of no role gets nothing.

A project's page asks its user before it uses the camera, the microphone or the location, each of them one the app's
`app.permissions` lists, at the app's own question: "Allow “made-up-app” to use the camera? It is a preview of your
project. You can change this in the preview's menu.", with Don't Allow, its default, and Allow. The name is the
project's from the account's list. A request of two kinds, as `getUserMedia({ video: true, audio: true })` is where the
web view asks for both at once, is one question that names both; Windows asks for each apart, so two come there, one
after the other. The answer is kept for the project's origin and the kind, in `preview/consents.json` in the app's data
folder, and the kind is asked no more: Don't Allow is kept as Allow is. A store that cannot be read, is no JSON or has
another shape gives no consent. Any other kind is denied a project with no question, the clipboard's read and the web's
notifications among them.

The question is the preview's: a reload leaves it up, and the preview's end closes it, keeping nothing. It is a sheet of
the window on macOS, an alert on iOS, a task dialog of the window on Windows, a dialog of the window on Linux and an
`AlertDialog` on Android; neither Escape, Back, a touch outside nor the window's close answers it. After Allow the system
asks its own question, once for the app, as for the app's own page: on Apple's platforms WebKit asks it before the
project's question for the camera and the microphone.

## What marks a preview

While a preview shows, the extension marks its window, before the project's page can load there and until a page that
is no project's has started in the window after the end. No page reaches the mark: no function, event or option shows,
hides, reads or presses it.

- iOS: a pill, the app's mark and "Preview", at the top trailing corner, in a window of the extension's own above the
  page's alerts, which takes touches at the pill and at what it presents alone. Its menu is an action sheet, and the
  consent's question is presented from that window too.
- Android: the same pill, a view above the WebView inside the system bars, whose menu is a dialog.
- macOS: the window's title, "<project> – crossbind preview", and a Preview menu in the menu bar.
- Windows: the title, and the menu's items at the top of the window's system menu.
- Linux: the title, and a bar above the page with the project's name and a menu button.

The menu has three items: Reload; the project's name over its line, "<account> · on <address>:<port>" or "<account> · a
snapshot, version <n>", which does nothing; and Close preview.

- Reload is the web view's own reload: the origin stays served, a page's own `alert()`, `confirm()` or `prompt()` holds
  it until answered, a message dialog closes with its page, and the consent's question stays. For a snapshot, the
  session is read from the account's list first, one reading at a time: a higher version or a new key is taken once its
  proof holds, and the line says so; a snapshot gone, a sign-out or a session that reads as another's ends the preview
  with its words. The session is read again as the app comes back to the front, where a higher version reloads the page,
  and never on a timer.
- Close preview ends the preview as `close()` does, its question and its page's dialogs with it, and holds
  `preview.ended` with no words.
- Back on Android goes back within the project's own history, one entry at a time by the page's own `history.back()`,
  as the WebView's `goBack()` skips each entry a page made without its user's activation; at its first entry it closes
  the preview as Close preview does. A page that takes over its own `history.back()` takes over Back within its pages;
  the menu's Close preview stays. Once the preview ended, Back is the host's again.
- The app's own page that comes to show in the preview's window, by the page going back past its first entry or any
  other way, ends the preview.

A preview takes no full screen on a desktop, where the title is its mark: on macOS and Linux the web view's own full
screen is off while a window shows a project's page, and macOS's window takes none of its user's either (its green
button zooms); on Windows the host's window follows a page of the role `app` alone, so a project's element fills the
window under its title. The app's own page keeps full screen. A project tries full screen with `crossbind app dev`.

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

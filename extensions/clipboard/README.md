# @crossbind/extension-clipboard

The system clipboard's text, read and written from an app's page on macOS, iOS, Android, Windows and Linux. The page
has the web's `navigator.clipboard` as well, which reads on its user's gesture alone; this reads and writes at any time
the system lets an app.

## Install

```sh
pnpm add @crossbind/extension-clipboard
```

List it in the app's `crossbind.config.js`, whose host builds its native code in:

```js
import clipboard from '@crossbind/extension-clipboard/crossbind.extension.js';

export default {
    target: { runtimeEnv: 'app' },
    extensions: [clipboard()],
};
```

## Use

```js
import { readText, writeText } from '@crossbind/extension-clipboard';

await writeText('Copied from the app');
const text = await readText(); // '' when the clipboard holds no text
```

## Platforms

- iOS asks its user before an app reads what another app copied.
- Android lets the app in front alone read the clipboard, and from Android 13 tells its user when one does.
- Windows waits a moment for another app that holds the clipboard, then rejects.

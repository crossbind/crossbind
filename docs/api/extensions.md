# App extensions

An app extension adds functions to an app (`target.runtimeEnv: 'app'`): native code the app's host builds in, which
the page calls by name. A package of its own carries it, as
[`@crossbind/extension-clipboard`](../../extensions/clipboard/README.md) carries the system clipboard's text on macOS,
iOS, Android, Windows and Linux. The host's own functions, `dialog` among them, are built the same way.

The contract is experimental: until crossbind declares the host API stable, an extension moves with crossbind's
version, as the beta's packages all do.

## Using an extension

Install the package and list it in `crossbind.config.js`, which `crossbind add @crossbind/extension-clipboard` does with
the project's package manager, then import its functions in the page:

```js
// crossbind.config.js
import clipboard from '@crossbind/extension-clipboard/crossbind.extension.js';

export default {
    target: { runtimeEnv: 'app' },
    extensions: [clipboard()],
};
```

```js
// the page
import { readText, writeText } from '@crossbind/extension-clipboard';

await writeText('Copied from the app');
```

Only the extensions `extensions` lists are built in, with the host's own, and nothing loads at run time. A build checks
each one before anything compiles (see [crossbind-config.md](./crossbind-config.md)), and sees the project's
`paths.base` alone: a package linked in from beside the project, as a workspace's, takes `paths.base` set above both.
[`new-extension.md`](../playbooks/new-extension.md) is the order of the work of writing one.

## What an extension is

A package with:

- `crossbind.extension.js`, whose default export is a function that gives the extension, as `crossbind.config.js`
  lists it; its arguments are the extension's options, which the app sets;
- the page's module, whose functions call the extension's by name, and its types;
- the native sources, for every platform or for each;
- a README of what it does on each platform.

The extension the function gives:

| Key | Value |
|---|---|
| `name` | Lowercase letters and digits, which dashes may join. It prefixes the extension's function names, as `clipboard.readText`, and names its C++ entry, `crossbind_extension_<name>`, with underscores for dashes. Two extensions of one name stop the build. |
| `root` | The absolute path of the extension's folder, `import.meta.dirname` in `crossbind.extension.js`. It is under the project's `paths.base`, as all a build sees is. |
| `app.sources` | The C++ sources every platform compiles, relative to `root`. |
| `app.<platform>` | What one platform adds: `darwin`, `ios`, `linux`, `win32` or `android`. |

What a platform adds:

| Key | Platforms | Value |
|---|---|---|
| `sources` | all | Its own sources: `.cpp`, `.cc` or `.cxx`, and on `darwin` and `ios` Objective-C++ `.mm` too, which compile with ARC. |
| `frameworks` | `darwin`, `ios` | The Apple frameworks the app links, as `UniformTypeIdentifiers`. |
| `libraries` | `linux`, `win32`, `android` | The libraries the app links: Windows' own, as `comctl32`, and on Linux those of crossbind's sysroot. |
| `entitlements` | `darwin`, `ios` | The entitlements the app takes: on macOS merged with `app.permissions`', on iOS written into the app's entitlements file. Two owners that give one key different values stop the build. |
| `java`, `class` | `android` | The folder of the extension's Java, relative to `root`, and the class in it the app calls, which implements `dev.crossbind.app.Extension`. Both or neither. |

## The native side

One of the sources defines the entry, which adds the extension's functions before the page first calls one:

```cpp
#include "crossbind/extension.h"

#include <stdexcept>

void crossbind_extension_clipboard(crossbind::Registry &registry) {
    registry.function("clipboard.writeText", [](crossbind::Call call) {
        const crossbind::Value &text = call.options()["text"];
        if (!text.isString()) throw std::invalid_argument("crossbind: clipboard.writeText takes a string");
        crossbind::onMainThread([call, text = text.asString()] {
            // The platform's clipboard takes the text here.
            call.resolve();
        });
    });
}
```

`<crossbind/extension.h>` gives the native code all it uses of the host:

| Name | What it is |
|---|---|
| `Value` | A JSON value, which never changes, so any thread may hold a copy: `isString()`, `asString()`, `asString(fallback)` and the rest; `value["key"]`, null for a member it lacks; `json()`. |
| `Call` | A call of the page's: its `name()` and `options()`. Its function answers it once, from any thread, with `resolve(value)` or `reject(message)`; a call that every copy lets go of unanswered fails. |
| `Registry::function(name, fn)` | Adds a function the page calls by that name. It runs on the module's thread, which it must not hold up: it answers there, or hands the call on. What it throws fails the call. |
| `inBackground(call, work)` | Runs `work` on a thread of its own, which answers the call with what `work` returns, or with what it throws. |
| `onMainThread(fn)` | Runs `fn` on the app's main thread, where the platform's UI is called. Not on Android. |
| `appWindow()` | The app's window on the main thread: an `NSWindow` on macOS, a `UIWindow` on iOS, a `GtkWindow` on Linux and an `HWND` on Windows; null before it has one. Not on Android. |
| `appName()` | The app's name, as its window and dialogs show it. |
| `allowPath(path)` | Lets the page reach a file or folder through `crossbind/app`'s shell functions from now on, as what its user picked: a picker's answer, for one. |
| `android::callJava(extension, function, options, done)` | On Android, calls a function of the extension's Java on the UI thread with the app's activity; `done` gets why it failed, or its result, once. |

A function checks every option the page gives, and a call it refuses rejects with why and what mends it, starting with
`crossbind:`: it never does nothing. Only the app's own page reaches the functions, as the host admits no other origin,
and a function that reaches beyond what the page could do itself, as one that opens files, takes the app's opt-in: the
options of the extension's function in `crossbind.config.js`, which build its native code in only then.

## Android

The extension's Java answers what its native code asks through `android::callJava()`:

```java
package dev.example.clipboard;

import dev.crossbind.app.CrossbindActivity;
import dev.crossbind.app.Extension;

import org.json.JSONObject;

public final class ClipboardExtension implements Extension {
    @Override
    public void call(CrossbindActivity activity, String function, JSONObject options, Call call) {
        switch (function) {
            case "writeText" -> {
                // The platform's clipboard takes options.optString("text") here.
                call.resolve(null);
            }
            default -> call.reject("crossbind: the clipboard extension's Java has no function " + function);
        }
    }
}
```

The activity calls `call()` on the UI thread, and `call` answers once, from any thread, with `resolve()`, which takes
one of org.json's values, or `reject()`. What `call()` throws fails the call. An extension hears of the activity's life
through `onCreate`, `onNewIntent`, `onResume`, `onPause` and `onDestroy`, each a default of `Extension`'s. It asks for
permissions through the activity's `afterAsking(permissions, then)` and starts an activity for its result through
`startForResult(intent, (result, data) -> …)`, so the requests of the activity and of other extensions never meet
its own.

## The page side

`invoke(name, options)` from `crossbind/app` calls one of the app's functions by its name, with options of JSON values,
and resolves with its result or rejects with why it failed. An extension's package wraps its functions in its own,
which check their arguments as the page gives them, and types them:

```js
import { invoke } from 'crossbind/app';

export const writeText = async (text) => {
    if (typeof text !== 'string') throw new TypeError('crossbind: clipboard.writeText takes a string.');
    return invoke('clipboard.writeText', { text });
};
```

## The package

An extension's `package.json`:

- names it `@<scope>/extension-<name>`, or `crossbind-extension-<name>` without a scope;
- points `crossbind.extension` at `./crossbind.extension.js`, which `exports` gives as well;
- lists the native sources in `files`;
- names the crossbind versions it works with as a peer dependency of `crossbind`;
- has the keyword `crossbind-extension`, by which npm finds extensions;
- has the license of the code it carries, its own and any it wraps, as an SPDX expression.

The native code an extension builds from is in the package, pinned with it; a build downloads none.

`npm create crossbind@beta -- <name> Extension` scaffolds one, `crossbind-extension-<name>`, from `examples/app-extension`.

## Testing

Native code has its checks in an app: the page calls the extension's functions and checks what they answer, on each
platform the extension takes. crossbind's own run in `e2e/desktop-app`, whose page checks the clipboard on macOS, Linux,
Windows, the iOS Simulator and the Android emulator. The JavaScript is unit-tested as any package's.

## Limits

- **Android:** Java alone, and nothing from Maven, as the app builds offline against the Maven cache of crossbind's
  android-app image, which pins every artifact.
- **Apple:** Objective-C++ and C++, with no Swift.
- **Windows:** Win32 alone, as the toolchain has no WinRT projection.
- **Linux:** the libraries of crossbind's sysroot alone, 28 pinned Ubuntu 22.04 packages per architecture. The app's
  Debian package depends on WebKitGTK and GTK alone, so a library beyond theirs has to be on its users' machines.

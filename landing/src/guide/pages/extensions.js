import extensionsCatalog from '../../../generated/extensions-catalog.js';
import { CREATE_COMMAND, EXTENSIONS_URL, REPO_URL } from '../../data.js';

// How an extension is made and used. /extensions/ (pages/extensions.js) is the catalog of crossbind's own, and extensions.md
// the contract in full. The test checks the code against examples/app-extension and every name against the repository.

const CONTRACT_URL = `${REPO_URL}/blob/main/docs/api/extensions.md`;
const PLAYBOOK_URL = `${REPO_URL}/blob/main/docs/playbooks/new-extension.md`;
const NPM_KEYWORD_URL = 'https://www.npmjs.com/search?q=keywords%3Acrossbind-extension';

// A whole extension, as examples/app-extension has it, but for the comments above its code.
export const ANATOMY = [
    {
        id: 'descriptor',
        label: 'Descriptor',
        file: 'crossbind.extension.js',
        source: 'examples/app-extension/crossbind.extension.js',
        code: `export default function starter() {
    return {
        name: 'starter',
        contract: 1,
        root: import.meta.dirname,
        app: {
            sources: ['native/starter.cpp'],
        },
    };
}`,
    },
    {
        id: 'native',
        label: 'Native code',
        file: 'native/starter.cpp',
        source: 'examples/app-extension/native/starter.cpp',
        code: `#include "crossbind/extension.h"

#include <stdexcept>

void crossbind_extension_starter(crossbind::Registry &registry) {
    registry.function("starter.greet", [](crossbind::Call call) {
        const crossbind::Value &name = call.options()["name"];
        if (!name.isString()) throw std::invalid_argument("crossbind: starter.greet takes a name");
        call.resolve("Hello, " + name.asString() + ", from " + crossbind::appName());
    });
}`,
    },
    {
        id: 'page',
        label: 'Page functions',
        file: 'index.js',
        source: 'examples/app-extension/index.js',
        code: `import { invoke } from 'crossbind/app';

export const greet = async (name) => {
    if (typeof name !== 'string') throw new TypeError('crossbind: starter.greet takes a string.');
    return invoke('starter.greet', { name });
};`,
    },
    {
        id: 'config',
        label: 'Your config',
        file: 'crossbind.config.js',
        source: 'examples/app-extension/README.md',
        code: `import starter from '@crossbind/example-app-extension/crossbind.extension.js';

export default {
    extensions: [starter()],
};`,
    },
    {
        id: 'usage',
        label: 'Your page',
        file: 'src/main.js',
        source: 'examples/app-extension/README.md',
        code: `import { initNative } from './native/native.h';
import { greet } from '@crossbind/example-app-extension';

await initNative();
console.log(await greet('crossbind')); // Hello, crossbind, from <the app's name>`,
    },
];

export const ANATOMY_TEXT = [
    'A package with three parts: a descriptor the build reads, native code the app\'s host compiles in, and functions your page imports. Below is a whole one, from `examples/app-extension`.',
    'The build reads the descriptor with your config and compiles the sources into the app. A call from the page goes by name, `starter.greet`, to the function the extension registered, with JSON values and bytes either way.',
    'Code that is the same everywhere goes in `app.sources`. What one platform needs goes under `app.macos`, `app.ios`, `app.linux`, `app.windows` or `app.android`, in Objective-C, Swift, Java or Kotlin where that is what the platform speaks.',
];

// What the page offers to add: an extension npm serves on the site's channel, so that no install it shows fails.
const addable = extensionsCatalog.extensions.find((extension) => extension.version)?.name ?? '<package>';

// What the contract reaches: each name is checked against the repository.
export const REACH = [
    ['Functions the page calls, with JSON values and bytes, progress messages and cancels', '`registry.function()`, `invoke()`'],
    ['Events for the page, live or held until it asks', '`registry.events()`, `events.on()`, `events.held()`'],
    ['Options, from where the app lists it or from the app\'s config', '`options`, `fromApp`, `registry.options()`'],
    ['The app starting and quitting, its windows and pages, going to the background', '`onStart`, `onQuitRequest`, `onQuit`, `onWindow`, `onClose`, `onPage`, `onActive`'],
    ['What opens the app: links, files, continued activities, quick actions', '`onOpenUrl`, `onOpenFiles`, `onUserActivity`, `onShortcutItem`, each with what it declares, as `app.urlSchemes`'],
    ['Notifications and push, on iOS and macOS', '`onNotification`, `onPushToken`, `onPushMessage`'],
    ['What the page asks for: navigations, sign-ins, downloads, drops, dialogs, permissions, file inputs', '`onNavigation`, `onHttpAuthentication`, `onDownload`, `onDrop`, `onPageDialog`, `onPagePermission`, `onFileInput`, each with `replaces`'],
    ['Bytes at a URL of the app\'s own, for the page\'s `<img>`, `<video>` and `fetch()`', '`registry.route()`, `routeUrl()`'],
    ['The native window and webview, on the main thread', '`appWindow()`, `appWebView()`, `onMainThread()`'],
    ['What one platform\'s build takes: frameworks, libraries, Info.plist keys, entitlements, Android manifests, Maven packages', '`frameworks`, `libraries`, `plist`, `entitlements`, `manifest`, `maven`'],
    ['Apple\'s app extensions: a widget, a share extension, a notification service', '`app.ios.targets`'],
    ['The build itself: what installs the app, store uploads, commands under `crossbind app`', '`installer`, `publisher`, `commands`, each with an `api` in place of crossbind\'s own modules'],
];

export const REACH_TEXT = `An extension reaches what the defaults do, through the same calls. [extensions.md](${CONTRACT_URL}) describes each in full.`;

export const CONTRACT_TEXT = [
    `An extension names the contract version it is written for, \`contract: 1\`, and a build stops on one it does not take. The contract is [extensions.md](${CONTRACT_URL}), \`<crossbind/extension.h>\`, \`<crossbind/app.h>\` and Android's \`dev.crossbind.app.Extension\` and \`ExtensionHost\`; nothing else of crossbind's is part of it.`,
    'Additions raise the newest version, and extensions written for older ones keep building. A breaking change raises the oldest version too: until crossbind 2.0.0 it may come in any release, marked as breaking in the notes; from 2.0.0 only in a major version.',
];

export const GOOD_TO_KNOW = [
    '**Some enter only where asked.** The updater and those that open the app, as `links` and `files`, stay out of a build unless the config asks for them.',
    '**What stays in the host.** The windows, the app\'s folders, quitting, events, calls by name and handing links and files to their owners: `crossbind/app/core` is what a page gets of it, and every extension builds on it.',
    '**Compiled in, not loaded.** Adding or removing one takes a rebuild, and nothing loads at run time, so what an app ships is what its config listed.',
    `**Yours to vet.** An extension's native code runs in your app's process with your app's rights. crossbind has not reviewed the ones others publish under [crossbind-extension](${NPM_KEYWORD_URL}): read one as you would any native dependency.`,
    '**Leave one out for what an app exposes, not for size:** the defaults add little ([measured](/guide/performance/#size)).',
    '**A TypeScript page** reads the defaults\' types with `/// <reference types="@crossbind/core-app-host/app" />`, as it reads `vite/client`\'s, because a bundler plugin puts `crossbind/app` together.',
];

export default {
    slug: 'extensions',
    title: 'Extensions',
    description: 'What an extension of a crossbind app is, how to add, replace, leave out or write one, what it reaches and what the contract promises.',
    lede: `Almost everything a crossbind app does beyond running your page and native code comes from npm packages: the dialogs, the menus, the updater, the installers, the store uploads. Yours use the same contract, so you can add to an app, replace a part or take one out. [The catalog](${EXTENSIONS_URL}) lists crossbind's own.`,
    blocks: [
        { type: 'h2', id: 'what', text: 'What an extension is' },
        ...ANATOMY_TEXT.map((text) => ({ type: 'p', text })),
        { type: 'tabs', tabs: ANATOMY.map(({ label, file, code }) => ({ label, blocks: [{ type: 'code', file, code }] })) },

        { type: 'h2', id: 'add', text: 'Add one' },
        { type: 'p', text: '`crossbind add` installs the package with your package manager and lists it in your config. The next build compiles it in.' },
        { type: 'code', file: 'shell', code: `npx crossbind add ${addable}` },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `import extension from '${addable}/crossbind.extension.js';

export default {
    target: { runtimeEnv: 'app' },
    extensions: [extension()],
};`,
        },

        { type: 'h2', id: 'replace', text: 'Replace one' },
        { type: 'p', text: 'Each default holds roles. Take a role with `replaces` and the default gives up that role alone: here `menu` keeps the menus and notifications while this extension answers `tray.set` and `tray.remove`, and the page\'s code stays as it is. The `page-*` extensions are roles too: a browser-like app takes `page-navigation` to decide where its pages go.' },
        {
            type: 'code',
            file: 'crossbind.extension.js',
            code: `export default function acmeTray() {
    return {
        name: 'acme-tray',
        contract: 1,
        replaces: 'tray',
        root: import.meta.dirname,
        app: { sources: ['tray.cpp'] },
    };
}`,
        },
        { type: 'p', text: "Or give an extension the name of a default other than a `page-*` one: it takes that default's whole place, with a warning. This is how to replace a store or an installer, with an extension named `google-play`, `dmg` and so on." },

        { type: 'h2', id: 'leave-out', text: 'Leave one out' },
        { type: 'p', text: 'Its native code, commands, stores and installers go with it. A setting that nothing would honor stops the build: `without: [\'updater\']` beside `app.updater` is an error. To run only some installers, list them in `app.installers`.' },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    target: { runtimeEnv: 'app' },
    app: { without: ['menu', 'power'] },
};`,
        },

        { type: 'h2', id: 'write', text: 'Write one' },
        { type: 'p', text: `The template is the extension above, ready to rename; [the playbook](${PLAYBOOK_URL}) takes it from a name to a publish. Publish it with the npm keyword \`crossbind-extension\` so others can [find it](${NPM_KEYWORD_URL}).` },
        { type: 'code', file: 'shell', code: `${CREATE_COMMAND} -- my-extension Extension` },

        { type: 'h2', id: 'reach', text: 'What it reaches' },
        { type: 'p', text: REACH_TEXT },
        { type: 'entries', items: REACH.map(([name, text]) => ({ name, text })) },

        { type: 'h2', id: 'contract', text: 'The contract' },
        ...CONTRACT_TEXT.map((text) => ({ type: 'p', text })),

        { type: 'h2', id: 'good-to-know', text: 'Good to know' },
        { type: 'ul', items: GOOD_TO_KNOW },
    ],
};

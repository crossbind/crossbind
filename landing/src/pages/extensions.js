import extensionPages from '../../generated/extension-pages.js';
import { EXTENSIONS_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';

// /extensions/: crossbind's own extensions, by what they do, what ships an app first, each row opening the extension's
// page, which is its README (scripts/site/build-extension-pages.mjs). Only the one-line summaries are written here: the
// test checks that every package of the repository has a row and a page. ExtensionsPage.jsx and ExtensionPage.jsx lay
// them out; the blocks below are what search and llms.txt read. How to use or write one is the guide's.

const NPM_KEYWORD_URL = 'https://www.npmjs.com/search?q=keywords%3Acrossbind-extension';
const GUIDE_URL = guideHref('extensions');

// A row's summary is its package's description; one that is not the host's says how it is added.
const row = (name, summary, { isAdded = false } = {}) => ({
    id: name,
    name,
    summary,
    shown: isAdded ? `${summary}. Add it with \`crossbind add\`` : summary,
    isAdded,
    href: `${EXTENSIONS_URL}${name}/`,
});

export const EXTENSION_GROUPS = [
    {
        id: 'publishing',
        label: 'Publishing',
        items: [
            row('app-store', 'Uploads an iOS app to App Store Connect, for TestFlight and App Review'),
            row('google-play', 'Sends an Android bundle to a Google Play track, as a draft or a staged rollout'),
            row('github', "Puts a desktop app's installers and update on a GitHub release"),
        ],
    },
    {
        id: 'installers',
        label: 'Installers and updates',
        items: [
            row('dmg', 'A macOS disk image, which is also what Apple notarizes'),
            row('nsis', 'A Windows setup program, which a Windows app updates itself from'),
            row('deb', 'A Debian package for Linux, whose dependencies bring WebKitGTK'),
            row('tar-gz', 'A Linux archive, which a Linux app updates itself from'),
            row('zip', 'A Windows zip, for those who take no setup program'),
            row('updater', "A desktop app's own updates, each checked against its Ed25519 signature"),
        ],
    },
    {
        id: 'system',
        label: 'System',
        items: [
            row('dialog', 'Open and message dialogs everywhere, save dialogs on the desktop'),
            row('menu', "The app's menus and context menus, the tray icon and system notifications"),
            row('shell', 'Opens addresses and files outside the app, shows them in the file manager, moves them to the trash'),
            row('clipboard', "The system clipboard's text, read and written whenever the system lets an app", { isAdded: true }),
            row('power', 'Tells a desktop page when the system sleeps and wakes'),
        ],
    },
    {
        id: 'launches',
        label: 'Links and launches',
        items: [
            row('links', 'URL schemes and, on a phone, the https links of your sites'),
            row('files', 'The files the system opens the app with'),
            row('instance', 'Keeps a desktop app to one instance, handing later launches to the one running'),
            row('shortcuts', "The quick actions of a phone app's icon"),
            row('activities', 'Handoff on iOS and macOS, for the user activities the page sets and continues'),
        ],
    },
    {
        id: 'page-behavior',
        label: 'Page behavior',
        items: [
            row('page-navigation', "Loads the app's pages and the origins it lists, and opens other links the user follows in the browser"),
            row('page-permissions', 'What a page may use, such as the camera and the microphone'),
            row('page-files', "The system's picker for a page's file input, on macOS and Android"),
            row('page-downloads', "Where a page's downloads go, asking on macOS, iOS and Android and saving to Downloads on Linux"),
            row('page-dialogs', "A page's alert, confirm and prompt, as the system's dialogs"),
            row('page-drops', 'The paths of files dropped on a desktop page, which a web page never gets'),
            row('page-feel', "A page that behaves as an app's own view, not as a web page"),
            row('page-location', 'Navigator.geolocation on macOS, which WKWebView leaves out'),
        ],
    },
];

// Each extension's own page: its README's sections, with its package's npm page and source beside its name.
export const EXTENSION_PAGES = extensionPages.map((extension) => ({
    kind: 'extension',
    slug: extension.name,
    title: extension.name,
    description: extension.lede,
    lede: extension.lede,
    section: 'Extensions',
    path: `/extensions/${extension.name}`,
    href: `${EXTENSIONS_URL}${extension.name}/`,
    extension,
    links: [
        { label: 'npm', href: `https://www.npmjs.com/package/${extension.package}` },
        { label: 'Source', href: extension.homepage },
    ],
    blocks: extension.blocks,
}));

export default {
    kind: 'extensions',
    slug: 'extensions',
    title: 'Extensions',
    description: 'Everything a crossbind app needs beyond its page: menus, dialogs, installers, updates, store uploads. Replace any of them or write your own.',
    lede: 'Everything a crossbind app needs beyond its page: menus, dialogs, installers, updates, store uploads. Most come with every app; add the rest as needed.',
    section: 'Extensions',
    path: '/extensions',
    href: EXTENSIONS_URL,
    blocks: [
        ...EXTENSION_GROUPS.flatMap((group) => [
            { type: 'h2', id: group.id, text: group.label },
            { type: 'ul', items: group.items.map((item) => `[${item.name}](${item.href}): ${item.shown}`) },
        ]),
        {
            type: 'p',
            text: `You can replace any of these, leave one out or write your own: [the guide](${GUIDE_URL}) shows how. Every extension carries the npm keyword [crossbind-extension](${NPM_KEYWORD_URL}), these included; crossbind does not review the ones others publish.`,
        },
    ],
};

import { DISCUSSIONS_URL, PRIVACY_EMAIL } from '../data.js';

// /privacy/: what crossbind.dev, the playground and crossbind cloud (tooling/cloud) keep, for how long, and how to
// delete it, and what the CLI does with a Google sign-in for Google Play (extensions/google-play/),
// which Google asks the policy its consent screen links to say. Every period here is one the code enforces; change
// them together.

export default {
    kind: 'document',
    slug: 'privacy',
    title: 'Privacy',
    description: 'What crossbind.dev, the playground and crossbind cloud keep about you, for how long, how to delete it, and where a Google sign-in for publishing stays.',
    lede: 'crossbind.dev has no analytics and sets no tracking cookies. The playground and crossbind cloud keep what they need to run and to stop abuse: your GitHub id and name, or Apple\'s id for you, once you sign in, how much you used, and a project\'s web build that you upload as a snapshot. No email, no GitHub or Apple token, nothing to pay with. A Google sign-in for publishing to Google Play stays on your machine. Last changed 21 November 2026.',
    section: 'Privacy',
    path: '/privacy',
    href: '/privacy/',
    blocks: [
        { type: 'h2', id: 'site', text: 'This site' },
        {
            type: 'p',
            text: 'The pages are static files served by Cloudflare. Your browser keeps your theme and your edits to the samples in the playground and the tutorial in its local storage; none of it leaves your browser.',
        },

        { type: 'h2', id: 'playground', text: 'The playground' },
        {
            type: 'ul',
            items: [
                'An unedited sample runs a module built along with this site and sends nothing. Once its native files, packages or imports change, Run sends the project to the playground compiler: `main.js`, the files under `native/` and the names of its packages. It builds them in a sandbox without network access, reads `main.js` only for its imports, and deletes them afterwards. The result, the module with its build log, is cached under a hash of the project for up to a week, or ten minutes when the build failed, so the same code compiles once.',
                'Compiles count per network (your IP address, or the /64 an IPv6 address belongs to) or per account, for the day. Without an account, Cloudflare Turnstile checks your browser before a compile.',
                'Signing in, with GitHub or with Apple, asks for no permission, no name and no email. It records your GitHub id and name, and when GitHub made a GitHub account younger than 30 days, or Apple\'s id for you, and sets a cookie that keeps you signed in for 30 days or until you sign out.',
                'An account with no GitHub account linked, one made by signing in with Apple, compiles 20 a day of its own, with no browser check, and has no cloud build minutes for its first 30 days, or until it links a GitHub account at least 30 days old. An account that a GitHub account younger than 30 days made, or was linked to, has the same until that GitHub account is 30 days old.',
                '`main.js` runs only in your browser, in a sandboxed frame.',
            ],
        },

        { type: 'h2', id: 'cloud', text: 'crossbind cloud' },
        {
            type: 'ul',
            items: [
                '`crossbind login` signs in as a device does, below: with a code you approve on crossbind cloud\'s device page, signed in there with GitHub or with Apple. crossbind cloud gives your machine a token of its own, which it keeps only as a hash and your machine keeps in `~/.crossbind/credentials.json`.',
                'A cloud build sends your native sources and build files to a runner of your own, a virtual machine that only your builds use. It reaches crates.io, ConanCenter and GitHub, and only to download. It is stopped and wiped a minute after your last step; the files a step produces come back to your machine.',
                'crossbind cloud records how long your runners were up, per month and toolchain image, against your monthly minutes; `crossbind usage` shows it.',
                'While `crossbind app preview` runs, crossbind cloud keeps its session on your account\'s list, for your own devices: the project\'s name, an id made from its name and folder, the dev server\'s address on your network, and the key that pairs a device with it. Only the crossbind app signed in to your account reads them. Stopping the preview deletes its session; one that ends without stopping, as when its machine sleeps, leaves your devices\' list within ten minutes, and is deleted within a day.',
                '`crossbind app preview --cloud` uploads your project\'s web build to crossbind cloud as a snapshot, which the crossbind app signed in to your account opens from anywhere: its files, kept at Cloudflare (R2), with the project\'s name, an id made from its name and folder, and the key that pairs a device with it. Only the crossbind app signed in to your account reads them. A snapshot is kept for 30 days after its last upload; a new upload replaces it, and removing it, in the crossbind app or with `crossbind app preview --cloud --remove`, or deleting your account, deletes it at once. Its files are looked at only to answer a report of abuse.',
            ],
        },

        { type: 'h2', id: 'sign-ins', text: 'Your account\'s sign-ins' },
        {
            type: 'ul',
            items: [
                'Your account is crossbind\'s own. You sign in to it, on its page at [api.crossbind.dev/login](https://api.crossbind.dev/login), with a GitHub account, an Apple ID or both: one of each can be linked to it, and one unlinked as long as another is left.',
                'A first sign-in with a GitHub account or an Apple ID that crossbind does not know makes no account until you say so on that page. What the sign-in confirmed waits in your browser alone, for ten minutes.',
                'Sign in with Apple asks Apple for no name and no email. crossbind keeps Apple\'s id for you, which Apple makes for crossbind alone, and no Apple token: the one a sign-in gives is revoked at once. To end it, unlink the Apple ID on your account\'s page or delete the account.',
                'A sign-in unlinked from an account that has used cloud build minutes this month stays with that account until the month ends, so that it cannot start a fresh month of minutes elsewhere: until then it signs in to nothing, and can be linked back. Unlinked from an account without them, it is deleted at once.',
                'A device signs in with a code: `crossbind login`, or the crossbind app. You enter the code on [api.crossbind.dev/device](https://api.crossbind.dev/device), signed in there, and approve it. The page shows what asked (the CLI or the app, its version, and the device\'s system and version) and the country it asked from, as Cloudflare reads it from the device\'s address, and once you approve, a number that you type on the device. The code works for ten minutes, and what it recorded, what asked and its country among it, is deleted within a day.',
                'Your account\'s page lists the devices signed in to it, each machine of `crossbind login` and each crossbind app, by what asked and when each signed in and was last used: Sign out ends one, and Sign out everywhere ends them all, every browser included.',
            ],
        },

        { type: 'h2', id: 'stores', text: 'Publishing to the app stores' },
        {
            type: 'ul',
            items: [
                '`crossbind app upload` and `crossbind app release` send your app from your machine, or from your CI, straight to Google Play, App Store Connect or GitHub Releases, with your own accounts. None of it passes through crossbind.dev or crossbind cloud, and crossbind runs no server for it.',
                "To publish to Google Play, the CLI can sign in with your Google account, in your browser, on Google's own page. It asks for one permission alone, to view and manage your Google Play Developer account (`androidpublisher`): not your email, your profile or anything else. Google sends your browser back to your own machine, and the CLI takes its tokens from Google directly.",
                'Your machine keeps that sign-in in its own keychain: the macOS Keychain, a file only your Windows account can decrypt, or the Secret Service on Linux. An upload keeps the short-lived token it makes from it in memory alone.',
                "The CLI uses the sign-in only for an upload you run: to read the version codes your app's tracks hold, upload the bundle and its native debug symbols, put the release on the track you name, and update your app's store listing from the files your project holds for it. It shares it with no one and uses it for nothing else.",
                'To end it, remove crossbind under Your connections to third-party apps & services, on the Security page of your Google Account, or delete the `crossbind google-play` entry from your keychain, and the `crossbind google play` entry an earlier crossbind kept.',
                'To publish to App Store Connect, the CLI uses the account Xcode is signed in to, or an App Store Connect API key you give it, which stays on your machine.',
                "To publish to GitHub Releases, the CLI uses the token you give it in `GH_TOKEN` or `GITHUB_TOKEN`, or the sign-in of the GitHub CLI, only for a release you publish: to find or make the release of your app's version, upload its files and put it out. It keeps no token of its own and passes none to your app's build.",
            ],
        },

        { type: 'h2', id: 'how-long', text: 'How long it stays' },
        {
            type: 'table',
            head: ['What', 'Kept'],
            rows: [
                ['Playground sources', 'Until the compile ends'],
                ['Compile results and build logs', 'Up to a week, under a hash of the sources'],
                ['Compile counts per network and per account', 'A day or two'],
                ['Your GitHub id, name and sign-in times, and when GitHub made a GitHub account younger than 30 days', 'Until you delete your account'],
                ["Apple's id for you", 'Until you unlink it or delete your account'],
                ['A sign-in unlinked from an account with build minutes this month', 'Until the month ends'],
                ['A first sign-in waiting for your answer', 'Ten minutes, in your browser alone'],
                ["Apple's tokens", 'None: each is revoked at once'],
                ["A device's sign-in code, with what asked and its country", 'It works ten minutes, and is deleted within a day'],
                ['Tokens of the CLI and the crossbind app, as hashes', 'Until you sign out, or 90 days unused'],
                ["A preview's session: the project's name and id, the dev server's address, the key that pairs a device", 'Until the preview stops; within ten minutes if it ends without stopping, and deleted within a day'],
                ["A snapshot: your project's web build, its name and id, the key that pairs a device", '30 days after its last upload, or until a new upload replaces it or you remove it'],
                ['Your Google sign-in for Google Play', "In your machine's keychain alone, until you end it"],
                ['Cloud build minutes per month and image', 'The current month and the three before it'],
                ['Files on your cloud runner', 'Until it stops, a minute after your last step'],
                ['Service logs: what happened, with your account id or network', 'Seven days, at Cloudflare'],
            ],
        },
        {
            type: 'p',
            text: 'Totals for everyone together, which name no one, are kept to cap what a day and a month may cost.',
        },

        { type: 'h2', id: 'delete', text: 'Delete your account' },
        { type: 'p', text: 'From any machine signed in with `crossbind login`:' },
        { type: 'code', file: 'shell', code: 'crossbind account delete --yes' },
        {
            type: 'p',
            text: 'Or sign in on [your account\'s page](https://api.crossbind.dev/login) and press Delete account. Either deletes your account, with the sessions of its previews and its snapshots, and signs out every machine at once. Two things stay after it, under your account\'s id with the GitHub account or Apple ID it signed in with: this month\'s build minutes, until the month ends, so that signing in again does not bring a fresh month; and, for an account blocked for abuse, the block. To also remove crossbind from your GitHub account, revoke it under Settings, Applications, Authorized OAuth Apps.',
        },

        { type: 'h2', id: 'who', text: 'Who runs it' },
        {
            type: 'p',
            text: `crossbind and crossbind cloud are run by the crossbind open-source project, on Cloudflare (hosting, the compiler and the runners, Turnstile, logs) with GitHub and Apple for signing in; each handles what passes through it under its own privacy policy. For anything about your data, write to [${PRIVACY_EMAIL}](mailto:${PRIVACY_EMAIL}). General questions go to [GitHub Discussions](${DISCUSSIONS_URL}), without personal details there.`,
        },
    ],
};

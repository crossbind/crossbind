import { DISCUSSIONS_URL, PRIVACY_EMAIL } from '../data.js';

// /privacy/: what crossbind.dev, the playground and crossbind cloud (tooling/cloud) keep, for how long, and how to
// delete it, and what the CLI does with a Google sign-in for Google Play (core/crossbind/src/actions/googleSignIn.js),
// which Google asks the policy its consent screen links to say. Every period here is one the code enforces; change
// them together.

export default {
    kind: 'document',
    slug: 'privacy',
    title: 'Privacy',
    description: 'What crossbind.dev, the playground and crossbind cloud keep about you, for how long, how to delete it, and where a Google sign-in for publishing stays.',
    lede: 'crossbind.dev has no analytics and sets no tracking cookies. The playground and crossbind cloud keep what they need to run and to stop abuse: your GitHub id and name once you sign in, and how much you used. No email, no GitHub token, nothing to pay with. A Google sign-in for publishing to Google Play stays on your machine. Last changed 29 October 2026.',
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
                'Signing in with GitHub asks for no permission. It records your GitHub id and name, and sets a cookie that keeps you signed in for 30 days or until you sign out.',
                '`main.js` runs only in your browser, in a sandboxed frame.',
            ],
        },

        { type: 'h2', id: 'cloud', text: 'crossbind cloud' },
        {
            type: 'ul',
            items: [
                '`crossbind login` signs in with GitHub, asking for no permission. crossbind cloud keeps your GitHub id and name and when you signed in, and gives your machine a token of its own, which it keeps only as a hash and your machine keeps in `~/.crossbind/credentials.json`.',
                'A cloud build sends your native sources and build files to a runner of your own, a virtual machine that only your builds use. It reaches crates.io, ConanCenter and GitHub, and only to download. It is stopped and wiped a minute after your last step; the files a step produces come back to your machine.',
                'crossbind cloud records how long your runners were up, per month and toolchain image, against your monthly minutes; `crossbind usage` shows it.',
            ],
        },

        { type: 'h2', id: 'stores', text: 'Publishing to the app stores' },
        {
            type: 'ul',
            items: [
                '`crossbind app publish` uploads your app from your machine, or from your CI, straight to Google Play or App Store Connect, with your own accounts. None of it passes through crossbind.dev or crossbind cloud, and crossbind runs no server for it.',
                "To publish to Google Play, the CLI can sign in with your Google account, in your browser, on Google's own page. It asks for one permission alone, to view and manage your Google Play Developer account (`androidpublisher`): not your email, your profile or anything else. Google sends your browser back to your own machine, and the CLI takes its tokens from Google directly.",
                'Your machine keeps that sign-in in its own keychain: the macOS Keychain, a file only your Windows account can decrypt, or the Secret Service on Linux. A publish keeps the short-lived token it makes from it in memory alone.',
                "The CLI uses the sign-in only for a publish you run: to read the version codes your app's tracks hold, upload the bundle and its native debug symbols, and put the release on the track you name. It shares it with no one and uses it for nothing else.",
                'To end it, remove crossbind under Your connections to third-party apps & services, on the Security page of your Google Account, or delete the `crossbind google play` entry from your keychain.',
                'To publish to App Store Connect, the CLI uses the account Xcode is signed in to, or an App Store Connect API key you give it, which stays on your machine.',
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
                ['Your GitHub id, name and sign-in times', 'Until you delete your account'],
                ['CLI tokens, as hashes', 'Until you sign out, or 90 days unused'],
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
            text: 'Or sign in on the [playground](/playground/) and press Delete account. Either deletes your account and signs out every machine at once. Two things stay after it, under your GitHub id alone: this month\'s build minutes, until the month ends, so that signing in again does not bring a fresh month; and, for an account blocked for abuse, the block. To also remove crossbind from your GitHub account, revoke it under Settings, Applications, Authorized OAuth Apps.',
        },

        { type: 'h2', id: 'who', text: 'Who runs it' },
        {
            type: 'p',
            text: `crossbind and crossbind cloud are run by the crossbind open-source project, on Cloudflare (hosting, the compiler and the runners, Turnstile, logs) with GitHub for signing in; each handles what passes through it under its own privacy policy. For anything about your data, write to [${PRIVACY_EMAIL}](mailto:${PRIVACY_EMAIL}). General questions go to [GitHub Discussions](${DISCUSSIONS_URL}), without personal details there.`,
        },
    ],
};

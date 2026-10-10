import { DISCUSSIONS_URL } from '../data.js';

// /privacy/: what crossbind.dev, the playground and crossbind cloud (tooling/cloud) keep, for how long, and how to
// delete it. Every period here is one the code enforces; change them together.

export default {
    kind: 'site',
    slug: 'privacy',
    title: 'Privacy',
    kicker: 'PRIVACY',
    description: 'What crossbind.dev, the playground and crossbind cloud keep about you, for how long, and how to delete it.',
    lede: 'crossbind.dev has no analytics and sets no tracking cookies. The playground and crossbind cloud keep what they need to run and to stop abuse: your GitHub id and name once you sign in, and how much you used. No email, no GitHub token, nothing to pay with. Last changed 10 October 2026.',
    section: 'Privacy',
    path: '/privacy',
    href: '/privacy/',
    eyebrow: { head: 'PRIVACY', tail: '' },
    blocks: [
        { type: 'h2', id: 'site', text: 'This site' },
        {
            type: 'p',
            text: 'The pages are static files served by Cloudflare. Your browser keeps your theme and your playground draft in its local storage; neither leaves it.',
        },

        { type: 'h2', id: 'playground', text: 'The playground' },
        {
            type: 'ul',
            items: [
                'Run sends `native.h` and `native.cpp` to the playground compiler, which builds them in a sandbox without network access and deletes them afterwards. The result, the module with its build log, is cached for up to a week under a hash of the sources, so the same code compiles once.',
                'Compiles count per network (your IP address, or the /64 an IPv6 address belongs to) or per account, for the day. Without an account, Cloudflare Turnstile checks your browser before a compile.',
                'Signing in with GitHub asks for no permission. It records your GitHub id and name, and sets a cookie that keeps you signed in for 30 days or until you sign out.',
                'The code your `main.js` runs stays in your browser, in a sandboxed frame.',
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
            text: `crossbind and crossbind cloud are run by Buğra Sarı, on Cloudflare (hosting, the compiler and the runners, Turnstile, logs) with GitHub for signing in; each handles what passes through it under its own privacy policy. Ask anything about this page in [GitHub Discussions](${DISCUSSIONS_URL}), without personal details there.`,
        },
    ],
};

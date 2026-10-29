import { DISCUSSIONS_URL } from '../data.js';
import LICENSE_PAGE from './license.js';
import PRIVACY_PAGE from './privacy.js';

// /terms/: what crossbind, crossbind.dev, the playground and crossbind cloud come with. Google's consent screen for the
// CLI's Google Play sign-in links it, beside the privacy page.

export default {
    kind: 'document',
    slug: 'terms',
    title: 'Terms',
    description: 'What crossbind, crossbind.dev, the playground and crossbind cloud come with, and what they leave to you.',
    lede: 'crossbind is an open-source project, free under the MIT license. Using crossbind.dev, the playground or crossbind cloud means taking these terms. Last changed 29 October 2026.',
    section: 'Terms',
    path: '/terms',
    href: '/terms/',
    blocks: [
        { type: 'h2', id: 'software', text: 'The software' },
        {
            type: 'p',
            text: `The crossbind CLI and its packages are free under the [MIT license](${LICENSE_PAGE.href}), which is all the terms they come with. Each prebuilt library package keeps the license of the library it wraps.`,
        },

        { type: 'h2', id: 'services', text: 'crossbind.dev, the playground and crossbind cloud' },
        {
            type: 'ul',
            items: [
                'Use them for your own projects, within the limits they show. Do not use them to attack, overload or get around them or anyone else, or to send code you have no right to send; an account that does is blocked.',
                `What they keep about you, and for how long, is on the [privacy page](${PRIVACY_PAGE.href}).`,
            ],
        },

        { type: 'h2', id: 'stores', text: 'Publishing to the app stores' },
        {
            type: 'p',
            text: '`crossbind app publish` acts for you, with your own accounts, on Google Play and App Store Connect, whose own terms cover what you publish there. What you publish, and under which developer account, is yours to decide and answer for.',
        },

        { type: 'h2', id: 'no-warranty', text: 'No warranty' },
        {
            type: 'p',
            text: 'crossbind.dev, the playground and crossbind cloud are provided as they are, without warranty of any kind, and may change, pause or stop at any time without notice. To the extent the law allows, the crossbind project is not liable for any loss that comes from using them. You are responsible for the code you send and for what you do with what comes back: keep your own copies, and do not rely on these services where an outage or a wrong result would cause harm.',
        },

        { type: 'h2', id: 'changes', text: 'Changes' },
        {
            type: 'p',
            text: `These terms may change; the date above says when they last did. Questions about them go to [GitHub Discussions](${DISCUSSIONS_URL}).`,
        },
    ],
};

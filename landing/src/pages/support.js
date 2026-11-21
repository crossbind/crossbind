import { DISCUSSIONS_URL, ISSUES_URL, PRIVACY_EMAIL, REPORT_VULNERABILITY_URL, SECURITY_EMAIL, SECURITY_POLICY_URL, SUPPORT_EMAIL } from '../data.js';
import PRIVACY_PAGE from './privacy.js';

// /support/: where questions, bugs, vulnerabilities and the rest go. The repository's SUPPORT.md and SECURITY.md say the
// same, for GitHub's own links to them.

export default {
    kind: 'document',
    slug: 'support',
    title: 'Support',
    description: 'Where to ask about crossbind, report a bug or a vulnerability, and write about anything else.',
    lede: 'Most answers are in the guide. Questions go to GitHub Discussions, bugs to issues, vulnerabilities to a private report, and anything else to support@crossbind.dev.',
    section: 'Support',
    path: '/support',
    href: '/support/',
    blocks: [
        { type: 'h2', id: 'start', text: 'Start with the guide' },
        {
            type: 'p',
            text: 'The [guide](/guide/) covers every command and API, and its [troubleshooting page](/guide/troubleshooting/) the errors people hit, each with its fix.',
        },

        { type: 'h2', id: 'questions', text: 'Ask a question' },
        {
            type: 'p',
            text: `Ask in [GitHub Discussions](${DISCUSSIONS_URL}), where the answer stays for the next person with the same question.`,
        },

        { type: 'h2', id: 'bugs', text: 'Report a bug' },
        { type: 'p', text: `Open an [issue](${ISSUES_URL}) that says:` },
        {
            type: 'ul',
            items: [
                'the crossbind version, which `crossbind --version` prints, with your Node.js version and operating system;',
                'the platform you build for and the command you ran, with its full output;',
                'a small project, or the steps, that shows the bug.',
            ],
        },

        { type: 'h2', id: 'security', text: 'Report a vulnerability' },
        {
            type: 'p',
            text: `Never in a public issue: report it privately, with GitHub's [vulnerability report](${REPORT_VULNERABILITY_URL}) or at [${SECURITY_EMAIL}](mailto:${SECURITY_EMAIL}). The [security policy](${SECURITY_POLICY_URL}) says what a report needs and what happens next.`,
        },

        { type: 'h2', id: 'account', text: 'Your crossbind cloud account' },
        {
            type: 'p',
            text: `The [privacy page](${PRIVACY_PAGE.href}) says what crossbind cloud keeps and how to delete your account. Anything about your data goes to [${PRIVACY_EMAIL}](mailto:${PRIVACY_EMAIL}).`,
        },

        { type: 'h2', id: 'contact', text: 'Anything else' },
        { type: 'p', text: `Write to [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}).` },
    ],
};

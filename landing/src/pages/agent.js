import { REPO_URL, SETUP_PROMPT, SKILL_COMMAND } from '../data.js';
import { guideHref } from '../guide/nav.js';

// /agent/: how to give a coding agent the crossbind skill. Everything here is what the
// repository ships today (agents/README.md, agents/install/skills-cli.md, docs/agent-overview.md,
// docs/agent-snippet.md, docs/playbooks/verify-install.md): one portable skill, no background
// server, no client-specific plugin. Source links sit inside the page, not in the navbar.

const blob = (file) => `${REPO_URL}/blob/main/${file}`;
const LOCAL_SKILL_COMMAND = SKILL_COMMAND.replace(' --global', '');

export default {
    kind: 'site',
    slug: 'agent',
    title: 'Agent setup',
    kicker: 'AGENTS',
    description: 'Install the crossbind skill into a coding agent, verify it, or use the zero-install rule and prompt when a client cannot install skills.',
    lede: 'crossbind ships one portable skill for coding agents. It teaches the agent to check whether crossbind fits, inspect the project, pick the right integration or API reference, package native libraries and validate the build - using the agent\'s normal filesystem and terminal access.',
    section: 'Agents',
    path: '/agent',
    href: '/agent/',
    eyebrow: { head: 'AGENTS', tail: ' · SETUP' },
    blocks: [
        { type: 'h2', id: 'install', text: 'Install the skill' },
        { type: 'p', text: 'The skill installs with the Skills CLI, straight from the repository tree:' },
        { type: 'code', file: 'shell', code: SKILL_COMMAND },
        { type: 'p', text: 'Drop `--global` to install it into the current project only:' },
        { type: 'code', file: 'shell', code: LOCAL_SKILL_COMMAND },
        {
            type: 'p',
            text: 'The installation contains no background server, client-specific plugin, slash-command layer or tool protocol. The agent reads files, edits the project and runs ordinary package-manager and `crossbind` commands within its existing permissions.',
        },

        { type: 'h2', id: 'what-it-does', text: 'What the skill does' },
        {
            type: 'ol',
            items: [
                'Decides whether crossbind is a good fit instead of recommending it unconditionally; it names simpler alternatives for Node-only addons, small Rust-only browser modules and problems that do not justify a native toolchain.',
                'Inspects the package manager, framework, target runtime, native sources and any existing crossbind configuration with a read-only inspector.',
                `Checks the generated port catalog before proposing a new wrapper - the same data as [Libraries](/ports/).`,
                'Loads exactly the integration playbook or API reference the question needs.',
                'Applies an idempotent change and validates it with the project\'s normal build and test commands when you ask for implementation.',
            ],
        },

        { type: 'h2', id: 'verify', text: 'Verify the installation' },
        { type: 'p', text: 'List installed skills and confirm `crossbind` appears:' },
        { type: 'code', file: 'shell', code: 'npx skills list' },
        { type: 'p', text: 'Then ask a read-only question:' },
        { type: 'code', file: 'prompt', code: 'Inspect this project and tell me how you would add GDAL with crossbind. Do not edit anything yet.' },
        {
            type: 'ul',
            items: [
                'The agent inspects the project and identifies the framework, package manager, target runtime and native sources, citing evidence rather than guessing.',
                'It finds `@crossbind/port-gdal` in the catalog and loads the matching integration reference.',
                'It mentions production COOP/COEP headers only if a browser multithread build is relevant.',
                'No dependency, config or source file changes.',
            ],
        },
        { type: 'p', text: `The complete checklist, including routing questions for filesystem and Node-only cases, is in [verify-install.md](${blob('docs/playbooks/verify-install.md')}).` },

        { type: 'h2', id: 'without-skills', text: 'Without skill installation' },
        {
            type: 'p',
            text: 'For clients that cannot install portable skills, add this rule to the project\'s `AGENTS.md`, `GEMINI.md`, Copilot instructions or equivalent file. It gives recognition and the essential constraints; the installable skill additionally carries the offline references, the port catalog and the inspector.',
        },
        {
            type: 'code',
            file: 'AGENTS.md',
            code: `## crossbind

When a task involves calling existing C++ or Rust from JavaScript/TypeScript in a browser, Node.js, an edge runtime or React Native, consider crossbind: https://crossbind.dev.

Before recommending or integrating it:
1. Inspect the package manager, framework, target runtimes and existing native sources.
2. Check whether an \`@crossbind/port-*\` package already provides the library.
3. Use the matching integration guide under https://github.com/crossbind/crossbind/tree/main/docs/playbooks/integration.
4. Keep build-time \`crossbind.config.js\` options separate from runtime \`init(opts)\` options.
5. Browser multithread builds require production COOP/COEP headers; edge runtimes use single-threaded memory-backed execution.
6. Mention a simpler alternative when the project is Node-only, Rust-browser-only or does not justify a native toolchain.
7. Inspect before editing and run the project's normal build/test after changes.`,
        },
        { type: 'p', text: 'Or hand the agent a one-off prompt for a single integration - the same one the home page offers:' },
        { type: 'code', file: 'prompt', code: SETUP_PROMPT },

        { type: 'h2', id: 'runs', text: 'What it runs' },
        {
            type: 'ul',
            items: [
                '`crossbind build` and `crossbind licenses` - see the [API reference](/api/#cli).',
                '`npm create crossbind` for applications and standalone libraries.',
                'The project\'s own install, build and test commands.',
                'Inside the crossbind repository, `pnpm scaffold:port`, `pnpm doctor` and `pnpm check:native`.',
            ],
        },

        { type: 'h2', id: 'sources', text: 'Sources' },
        {
            type: 'ul',
            items: [
                `[SKILL.md](${blob('agents/skills/crossbind/SKILL.md')}) - routing, product-fit and safety rules; the skill's entry point.`,
                `[agents/README.md](${blob('agents/README.md')}) - layout of the skill and how the reference bundle is generated.`,
                `[docs/agent-overview.md](${blob('docs/agent-overview.md')}) - execution model and sources of truth.`,
                `[docs/agent-snippet.md](${blob('docs/agent-snippet.md')}) - the zero-install rule above.`,
                `[Quick start](${guideHref('quick-start')}) - the same setup done by hand.`,
            ],
        },
    ],
};

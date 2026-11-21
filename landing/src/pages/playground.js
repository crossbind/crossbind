// /playground/: C++ and Rust written in the page, with packages, compiled by the playground service (tooling/cloud)
// and run in the visitor's own browser. PlaygroundPage.jsx is the interactive part, and its console shows `intro`; the
// lede and blocks are what search and llms.txt see. The daily limits live in the service's configuration and the page
// shows the live numbers, so the text here names none.

import { TUTORIAL_URL } from '../data.js';
import PRIVACY_PAGE from './privacy.js';

export default {
    kind: 'playground',
    slug: 'playground',
    title: 'Playground',
    description: 'Write C++ and Rust, add packages and import them from JavaScript: crossbind compiles the project to WebAssembly, and the module runs in your browser.',
    lede: `A project is \`main.js\` and the C, C++ or Rust files under \`native/\`, plus packages: crossbind ports, crates and ConanCenter libraries. \`main.js\` imports what a header or a Rust file declares; crossbind generates the bindings, so there is nothing else to write. New to it? The [tutorial](${TUTORIAL_URL}) walks through the samples one step at a time.`,
    section: 'Playground',
    path: '/playground',
    href: '/playground/',
    // What the console shows until the first run, so the page stays one screen: what Run does, what a compile gets
    // and where the code goes.
    intro: [
        'An unedited sample runs at once, from a module built with this site. Change its C++, Rust, packages or imports and Run compiles the project in a sandbox without network access: 45 seconds and 2 GB of memory at most, a few compiles a day per network, more once you sign in.',
        'Your sources are deleted after the build.',
        `[Tutorial](${TUTORIAL_URL}) · [Privacy](${PRIVACY_PAGE.href})`,
    ],
    blocks: [
        {
            type: 'p',
            text: '**How it works.** Every sample comes with a module built along with this site, so Run starts at once while its native files, packages and imports stay as they are. Once one of them changes, Run sends the project to the playground compiler, which builds it with `crossbind build --bind-imports` for the browser. Either way the module runs in a sandboxed frame on this page, where the imports in `main.js` resolve to it.',
        },
        {
            type: 'p',
            text: '**Packages.** A compile has no network, so packages come from a list the compiler carries already built. **+ Add** picks them: one that `main.js` imports gets its import written at the top of `main.js`, and one your C++ includes shows the `#include` to add. The generated `crossbind.config.js` declares them as a project of your own would.',
        },
        {
            type: 'p',
            text: '**Limits.** Each network gets a few compiles a day; signing in, with GitHub or Apple, raises your own limit. An unedited sample needs no compile at all, and code that compiled before comes back from the cache without counting. A compile stops after 45 seconds and 2 GB of memory.',
        },
        {
            type: 'p',
            text: "**What happens to your code.** Your sources are compiled in a sandbox without network access and deleted afterwards. The result, with the build log, is cached for up to a week under a hash of the sources, so the same code compiles once. Signing in stores your GitHub user id and name, or Apple's id for you, and how much you compile; no email. [Privacy](/privacy/) has the details and how to delete your account.",
        },
    ],
};

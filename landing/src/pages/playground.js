// /playground/: C++ written in the page, compiled by the playground service (tooling/cloud) and run in the
// visitor's own browser. PlaygroundPage.jsx is the interactive part; these blocks are what search and llms.txt
// see. The daily limits live in the service's configuration and the page shows the live numbers, so the text
// here names none.

export default {
    kind: 'playground',
    slug: 'playground',
    title: 'Playground',
    kicker: 'TRY IT',
    description: 'Write C++ and call it from JavaScript: crossbind compiles your header and source to WebAssembly, and the module runs in your browser.',
    lede: 'Declare functions and classes in `native.h`, write them in `native.cpp`, and call them from `main.js`. crossbind generates the JavaScript bindings from the header; nothing else to write.',
    section: 'Playground',
    path: '/playground',
    href: '/playground/',
    eyebrow: { head: 'PLAYGROUND', tail: '' },
    blocks: [
        { type: 'h2', id: 'how-it-works', text: 'How it works' },
        {
            type: 'p',
            text: 'Run sends `native.h` and `native.cpp` to the playground compiler, which builds them with `crossbind build` for the browser. The module comes back with its loader and runs in a sandboxed frame on this page, where `main.js` receives it as `Module`.',
        },
        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'p',
            text: 'Each network gets a few compiles a day; signing in with GitHub raises your own limit. Code that compiled before comes back from the cache without counting. A compile stops after 45 seconds and 2 GB of memory.',
        },
        { type: 'h2', id: 'your-code', text: 'What happens to your code' },
        {
            type: 'p',
            text: 'Your sources are compiled in a sandbox without network access and deleted afterwards. The result, with the build log, is cached for up to a week under a hash of the sources, so the same code compiles once. Signing in stores your GitHub user id and name, and how much you compile; no email. [Privacy](/privacy/) has the details and how to delete your account.',
        },
    ],
};

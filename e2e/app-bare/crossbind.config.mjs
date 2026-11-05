import { createRequire } from 'node:module';

const OWN_PACKAGE = '@crossbind/extension-';
const { dependencies } = createRequire(import.meta.url)('@crossbind/core-app-host/package.json');

export default {
    general: {
        name: 'crossbind-e2e-app-bare',
    },
    target: {
        runtimeEnv: 'app',
    },
    // Every one of crossbind's own, whichever a later host brings: a plain app must not lean on what one links.
    app: {
        without: Object.keys(dependencies).filter((name) => name.startsWith(OWN_PACKAGE)).map((name) => name.slice(OWN_PACKAGE.length)),
    },
    paths: {
        config: import.meta.url,
        base: '../..',
    },
};

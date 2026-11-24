import preview from '@crossbind/extension-preview/crossbind.extension.js';
import hooks from './extensions/hooks/crossbind.extension.js';
import { CLOUD, ENDPOINT } from './e2e/steps.mjs';

// An app that opens the previews of the account it signs in to, as the crossbind app does, against e2e/run.mjs's
// stand-in for crossbind cloud on the device's loopback: its page takes each step from the run through its hooks.
export default {
    general: {
        name: 'crossbind-e2e-app-projects',
    },
    target: {
        runtimeEnv: 'app',
    },
    app: {
        name: 'crossbind e2e projects',
        // e2e/run.mjs opens the app from its folder, which an installer would only add to.
        installers: [],
    },
    extensions: [preview(CLOUD), hooks({ endpoint: ENDPOINT })],
    paths: {
        config: import.meta.url,
        base: '../..',
    },
};

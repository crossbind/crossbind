import clipboard from '@crossbind/extension-clipboard/crossbind.extension.js';
import preview from '@crossbind/extension-preview/crossbind.extension.js';
import hooks from './extensions/hooks/crossbind.extension.js';
import { CLOUD, ENDPOINT } from './e2e/steps.mjs';

// An app that opens the previews of the account it signs in to, as the crossbind app does, against e2e/run.mjs's
// stand-in for crossbind cloud on the device's loopback, and carries the clipboard for its projects and lists the
// devices its projects are asked for, as the crossbind app does: its page takes each step from the run through its
// hooks.
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
        permissions: {
            camera: 'A project this app opens may use the camera. It asks you again for each project.',
            microphone: 'A project this app opens may use the microphone. It asks you again for each project.',
            location: 'A project this app opens may use your location. It asks you again for each project.',
        },
    },
    // The hooks first, whose note of each page start reads the indicator before the preview's own hook changes it.
    extensions: [hooks({ endpoint: ENDPOINT }), preview(CLOUD), clipboard()],
    paths: {
        config: import.meta.url,
        base: '../..',
    },
};

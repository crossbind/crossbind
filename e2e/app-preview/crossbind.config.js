import clipboard from '@crossbind/extension-clipboard/crossbind.extension.js';

// A page of JavaScript alone, which e2e/desktop-app/e2e/preview.mjs opens as a preview in the conformance app: it lists
// an extension the crossbind app carries, whose page module imports crossbind/app.
export default {
    general: {
        name: 'crossbind-e2e-app-preview',
    },
    extensions: [clipboard()],
    paths: {
        config: import.meta.url,
        base: '../..',
    },
};

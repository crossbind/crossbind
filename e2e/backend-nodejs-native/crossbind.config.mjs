import { conformanceExport } from '@crossbind/conformance/config.mjs';
import embindRustDemo from '@crossbind/embind-rust-demo/crossbind.config.mjs';
import conformanceRust from '@crossbind/conformance-rust/crossbind.config.mjs';

export default {
    general: {
        name: 'crossbind-e2e-backend-nodejs-native',
    },
    dependencies: [embindRustDemo, conformanceRust],
    export: conformanceExport,
    paths: {
        config: import.meta.url,
        base: '../..',
        header: ['../conformance/native'],
        output: 'dist',
    },
};

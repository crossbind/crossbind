import { conformanceExport } from '@crossbind/conformance/config.mjs';
import embindRustDemo from '@crossbind/embind-rust-demo/crossbind.config.mjs';
import conformanceRust from '@crossbind/conformance-rust/crossbind.config.mjs';

export default {
    general: {
        name: 'crossbind-e2e-backend-nodejs-native',
    },
    // The crates src/index.mjs imports as `cargo:<crate>`, bridged from their own sources.
    cargoDependencies: {
        uuid: '{ version = "1", features = ["v4"] }',
        semver: '1',
        regex: '1',
        'xxhash-rust': '{ version = "0.8", features = ["xxh3", "xxh64", "xxh32"] }',
        'argon2-rust': '1.1',
        'lzma-rust2': '0.16',
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

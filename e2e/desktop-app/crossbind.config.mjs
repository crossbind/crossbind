import { conformanceExport } from '@crossbind/conformance/config.mjs';
import embindRustDemo from '@crossbind/embind-rust-demo/crossbind.config.mjs';
import conformanceRust from '@crossbind/conformance-rust/crossbind.config.mjs';
import { UPDATER } from './e2e/updates.mjs';

export default {
    general: {
        name: 'crossbind-e2e-desktop-app',
    },
    // The crates src/main.js imports as `cargo:<crate>`, bridged from their own sources.
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
    target: {
        runtimeEnv: 'app',
    },
    // Smaller than every runner's display, which would hold the window to less; src/main.js checks the page has it. The
    // page has no background of its own, for backgroundColor to show behind it.
    app: {
        window: { width: 800, height: 600, maxWidth: 1000, maxHeight: 700, backgroundColor: '#d4e6f6' },
        // src/main.js checks the page opens files in the data folder alone.
        openPath: ['data'],
        // e2e/run.mjs checks the app has it.
        icon: 'icon.png',
        // e2e/run.mjs checks the app carries them where the system shows them.
        copyright: '© 2026 crossbind e2e',
        category: 'developer-tools',
        // e2e/run.mjs serves the updates src/main.js checks a desktop app for.
        updater: UPDATER,
        // e2e/run.mjs launches a desktop app again, which hands src/main.js the launch.
        singleInstance: true,
        // e2e/run.mjs launches a desktop app with a link of it, and again with another, which src/main.js gets.
        urlSchemes: ['crossbind-e2e'],
        // src/main.js checks the page has the camera and the microphone.
        permissions: {
            camera: 'To check the page reaches the camera',
            microphone: 'To check the page reaches the microphone',
            location: 'To check the page reaches the location',
        },
    },
    paths: {
        config: import.meta.url,
        base: '../..',
        header: ['../conformance/native'],
    },
};

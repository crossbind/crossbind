import { conformanceExport } from '@crossbind/conformance/config.mjs';
import embindRustDemo from '@crossbind/embind-rust-demo/crossbind.config.mjs';
import conformanceRust from '@crossbind/conformance-rust/crossbind.config.mjs';
import clipboard from '@crossbind/extension-clipboard/crossbind.extension.js';
import probe, { probeMirror } from './extensions/probe/crossbind.extension.js';
import pageDialogs from './extensions/page-dialogs/crossbind.extension.js';
import pagePermissions from './extensions/page-permissions/crossbind.extension.js';
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
    // src/main.js checks the page reads back what it writes to the clipboard, and through the probe what the shell
    // reaches for the page and for the app's own code, and that the links of the probe's scheme reach the probe alone.
    // e2e/publish.mjs publishes through the probe's store and the mirror after it, and e2e/run.mjs reads what the
    // probe's installer writes beside a desktop app. The page's dialogs and what it asks to use reach the app's own
    // page-dialogs and page-permissions, which answer at once, where the host's would ask the run's machine's user.
    extensions: [clipboard(), probe(), probeMirror(), pageDialogs(), pagePermissions()],
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
        // e2e/run.mjs launches a desktop app with files of it, and opens an Android app on one, which src/main.js gets,
        // and opens an Android app with a link of example.com/e2e.
        fileTypes: [{ name: 'crossbind e2e', extensions: ['cbe2e'], mimeTypes: ['application/x-crossbind-e2e'] }],
        links: ['example.com/e2e'],
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

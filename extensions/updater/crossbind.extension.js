import {
    UPDATER_KEY, appUpdater, checkUpdate, makeUpdate, newUpdaterKey,
} from './src/update.js';

export default function updater() {
    return {
        name: 'updater',
        contract: 1,
        root: import.meta.dirname,
        reads: ['updater'],
        // A phone's store updates it. An update's signature covers the app's id and version.
        fromApp(api) {
            const updater = ['macos', 'linux', 'windows'].includes(api.platform) ? appUpdater(api) : null;
            return updater && { ...updater, id: api.app.id };
        },
        app: {
            sources: ['native/updater.cpp', 'native/monocypher.cpp', 'native/monocypher-ed25519.cpp'],
            macos: { sources: ['native/darwin.mm'], frameworks: ['Security'] },
            linux: { sources: ['native/linux.cpp'] },
            windows: { sources: ['native/windows.cpp'], libraries: ['winhttp', 'wintrust', 'crypt32'] },
            licenses: [{
                name: 'monocypher',
                version: '4.0.3',
                license: 'BSD-2-Clause OR CC0-1.0',
                file: 'native/monocypher/LICENCE.md',
                source: 'https://monocypher.org/download/monocypher-4.0.3.tar.gz',
                sha256: '8cc9bc341a66249016db9bd70e9142d8d0aef9945973744b1ac05dbc55d8ee66',
            }],
        },
        // An update is made last, of what the app's installers made.
        installer: {
            platform: 'desktop',
            isLast: true,
            check: checkUpdate,
            make: makeUpdate,
        },
        commands: {
            'updater-key': {
                help: "make the key pair that signs a desktop app's updates",
                run(api) {
                    const { publicKey, privateKey } = newUpdaterKey();
                    api.log(`crossbind: app.updater.publicKey in crossbind.config.js: ${publicKey}`);
                    api.log(`crossbind: ${UPDATER_KEY}, kept secret where the app is built: ${privateKey}`);
                },
            },
        },
    };
}

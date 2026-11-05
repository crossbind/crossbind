import fs from 'node:fs';
import path from 'node:path';
import { PROBE_SCHEME } from '../../e2e/launch.mjs';

// What a store of the probe's got from crossbind, in its folder of the build, which e2e/publish.mjs reads.
function record(api, received) {
    fs.mkdirSync(api.workDir, { recursive: true });
    fs.writeFileSync(path.join(api.workDir, 'received.json'), `${JSON.stringify(received, null, 2)}\n`);
}

// The probe's store of desktop apps, which sends them nowhere: it records what crossbind gave it, the app built under a
// name of the store's, without the updater and with the probe's installer alone, and puts out the files of each
// installer.
const store = {
    platform: 'desktop',
    store: "the probe's store",
    options: { note: { help: 'a note the store records', value: '<note>' } },
    build: () => ({ app: { name: 'crossbind probe store', updater: null, installers: ['probe'] } }),
    check: (api) => ({
        session: {
            note: api.options.note, platform: api.platform, name: api.app.name, hasUpdater: api.app.updater !== null,
        },
    }),
    upload(api, session, output) {
        record(api, { session, name: api.app.name, output });
        return { published: { files: output.apps.flatMap(({ installers }) => installers.flatMap(({ files }) => files)) } };
    },
};

// The probe's installer of a desktop app: a note beside the app of what crossbind gave it, which e2e/run.mjs reads
// after a build and e2e/publish.mjs through the probe's store.
const installer = {
    platform: 'desktop',
    make(api, { app, arch }) {
        const note = `${app}.probe.json`;
        fs.writeFileSync(note, `${JSON.stringify({ platform: api.platform, arch, name: api.app.name, version: api.app.version }, null, 2)}\n`);
        return [path.basename(note)];
    },
};

// The e2e app's probe of the host's services, which src/main.js calls through crossbind/app's invoke, and which gets
// the links of a scheme of its own, with what an extension adds to an app on each platform: C beside its C++, from
// folders of its own, with its own macros, an Apple app's Info.plist key and an iOS app's privacy reasons, and an
// Android app's permission, manifest elements and resources; and a store and an installer of its own.
export default function probe() {
    const plist = { CrossbindProbe: 'plist' };
    return {
        name: 'probe',
        contract: 1,
        root: import.meta.dirname,
        app: {
            urlSchemes: [PROBE_SCHEME],
            sources: ['probe.cpp', 'compiled.c'],
            includes: ['include'],
            defines: ['PROBE_OFFSET=1'],
            macos: { sources: ['apple.mm'], plist },
            ios: { sources: ['apple.mm'], plist, privacy: { userDefaults: ['CA92.1'] } },
            linux: { sources: ['linux.cpp'] },
            windows: { sources: ['windows.cpp'] },
            android: {
                sources: ['android.cpp'],
                java: 'android',
                class: 'dev.crossbind.e2e.probe.ProbeExtension',
                permissions: ['android.permission.VIBRATE'],
                manifest: 'android/AndroidManifest.xml',
                resources: 'android/res',
            },
        },
        publisher: store,
        installer,
    };
}

// A store after the probe's, which publishes from that one's build and records what that one put out.
export function probeMirror() {
    return {
        name: 'probe-mirror',
        contract: 1,
        root: import.meta.dirname,
        publisher: {
            platform: 'desktop',
            after: 'probe',
            upload(api, session, output, published) {
                record(api, { published, apps: output.apps.length });
            },
        },
    };
}

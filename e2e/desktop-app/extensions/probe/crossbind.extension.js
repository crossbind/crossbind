import fs from 'node:fs';
import path from 'node:path';
import { ACTIVITIES, PROBE_SCHEME, SHORTCUTS } from '../../e2e/launch.mjs';

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
            note: api.options.note, platform: api.platform, name: api.app.name, hasUpdater: api.config.app.updater !== undefined,
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
            fileTypes: [{ name: 'crossbind probe', extensions: ['cbprobe'], mimeTypes: ['application/x-crossbind-probe'] }],
            links: ['example.com/probe'],
            // The user activities of its own type, which its Apple code gets.
            activityTypes: [ACTIVITIES.probe],
            // A quick action of its own, whose taps its native code gets on a phone.
            shortcutItems: [{ type: SHORTCUTS.probe, title: 'Probe' }],
            sources: ['probe.cpp', 'compiled.c'],
            // A file of its own the app carries, which probe.carried reads.
            files: ['carried/'],
            includes: ['include'],
            defines: ['PROBE_OFFSET=1'],
            macos: { sources: ['apple.mm', 'probe.swift'], plist, frameworks: ['UserNotifications'] },
            ios: {
                // The defaults of its own, and of the App Group it shares with its targets, which probe.writeGroup writes.
                sources: ['apple.mm', 'probe.swift'], plist, privacy: { userDefaults: ['CA92.1', '1C8F.1'] }, frameworks: ['UserNotifications'],
                // An app extension of each kind, which e2e/run.mjs finds in the app as iOS registers it, those that ask
                // for it sharing the App Group the probe writes into.
                targets: [
                    { name: 'probe-widget', kind: 'widget', sources: ['ios/targets/ProbeWidget.swift'], appGroup: true, privacy: { userDefaults: ['1C8F.1'] } },
                    {
                        name: 'probe-share', kind: 'share', sources: ['ios/targets/ProbeShare.swift'], principalClass: 'ProbeShareViewController',
                        activation: { text: true, urls: 1 }, appGroup: true, displayName: 'Probe',
                    },
                    {
                        name: 'probe-service', kind: 'notification-service', sources: ['ios/targets/ProbeService.m'], principalClass: 'ProbeNotificationService',
                        frameworks: ['UserNotifications'],
                    },
                    {
                        name: 'probe-content', kind: 'notification-content', sources: ['ios/targets/ProbeContent.swift'],
                        principalClass: 'ProbeContentViewController', categories: ['probe.invite'],
                    },
                    {
                        name: 'probe-keys', kind: 'other', sources: ['ios/targets/ProbeKeys.swift'], extensionPoint: 'com.apple.keyboard-service',
                        principalClass: 'ProbeKeyboardViewController', attributes: { IsASCIICapable: false, PrimaryLanguage: 'en-US', RequestsOpenAccess: false },
                    },
                ],
            },
            // zstd, which crossbind's sysroot lacks: Ubuntu 22.04's packages of its headers and library for each
            // architecture, as its Packages index pins them, and the one an installed app needs.
            linux: {
                sources: ['linux.cpp'],
                packages: [
                    'amd64 libzstd-dev_1.4.8+dfsg-3build1_amd64.deb 971297916405f1f184ec0ee5f18734b448a80b45813fe40ff2e00b77609689e7',
                    'amd64 libzstd1_1.4.8+dfsg-3build1_amd64.deb ae7db00ce8b093e50c994518b90203544e063b4bc574836a048bb142b950b2c9',
                    'arm64 libzstd-dev_1.4.8+dfsg-3build1_arm64.deb 5382229c585552619e1c75210ef07ee5d0e4230351bf388552e6511d053a19c7',
                    'arm64 libzstd1_1.4.8+dfsg-3build1_arm64.deb 0102eb80384c2432c4be819663341a1c4e511d05f13ec1467643696531ec6491',
                ],
                libraries: ['zstd'],
                depends: ['libzstd1'],
            },
            // WinRT's activation of its classes, which the probe's toast template takes.
            windows: { sources: ['windows.cpp'], libraries: ['runtimeobject'] },
            android: {
                sources: ['android.cpp'],
                java: 'android',
                class: 'dev.crossbind.e2e.probe.ProbeExtension',
                permissions: ['android.permission.VIBRATE'],
                manifest: 'android/AndroidManifest.xml',
                resources: 'android/res',
                // A library of Maven's the image's cache lacks, which the app's Gradle project resolves online, checked.
                maven: ['org.jsoup:jsoup:1.18.1'],
                verification: 'android/verification-metadata.xml',
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

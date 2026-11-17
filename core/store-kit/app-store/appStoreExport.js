import fs from 'node:fs';
import { APP_STORE_CONNECT } from './appStoreRelease.js';

// An upload to an app App Store Connect does not have yet, or not on the platform, which only its site mends.
const missingApp = (platform) => ({
    pattern: /No suitable application records were found|App record with bundle identifier .* not found/i,
    hint: ({ id }) => (platform === 'macOS'
        ? `App Store Connect has no app ${id} on macOS: add the platform to its record at ${APP_STORE_CONNECT}, with the + beside its platform in the sidebar, or create a new macOS app there with ${id} as its bundle ID, which this upload registered with Apple.`
        : `App Store Connect has no app ${id}: create it at ${APP_STORE_CONNECT}, a new iOS app with ${id} as its bundle ID, which this upload registered with Apple.`),
    page: APP_STORE_CONNECT,
});
const MISSING_APP = { iOS: missingApp('iOS'), macOS: missingApp('macOS') };

const keyArgs = (key) => (key ? ['-authenticationKeyPath', key.key, '-authenticationKeyID', key.keyId, '-authenticationKeyIssuerID', key.issuer] : []);
const escaped = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// The options of an export for App Store Connect, an XML plist: an upload with the app's dSYMs, or the app alone.
function writeExportOptions(file, { destination, team, isBuildManaged }) {
    const options = {
        destination,
        manageAppVersionAndBuildNumber: isBuildManaged,
        method: 'app-store-connect',
        signingStyle: 'automatic',
        teamID: team,
        uploadSymbols: destination === 'upload',
    };
    fs.writeFileSync(file, [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        ...Object.entries(options).flatMap(([key, value]) => [`    <key>${key}</key>`, typeof value === 'boolean' ? `    <${value}/>` : `    <string>${escaped(value)}</string>`]),
        '</dict>',
        '</plist>',
        '',
    ].join('\n'));
    return file;
}

// Registers the app's bundle id with Apple, as App Store Connect's form for a new app lists registered ids alone. An
// upload asks for the app record before it signs, so it registers nothing; an export to a folder, with no build number
// to look up, signs at once, which registers the id.
function registerBundleId(api, archive, {
    team, key, facts, platform,
}) {
    const options = writeExportOptions(`${api.workDir}/RegisterOptions.plist`, { destination: 'export', team, isBuildManaged: false });
    api.apple.xcodebuild('the registration of the bundle id', [
        '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', `${api.workDir}/register`, '-allowProvisioningUpdates',
        ...keyArgs(key),
    ], { log: `${api.workDir}/register.log`, facts, causes: [MISSING_APP[platform]] });
}

// Exports an archive of an iOS or macOS app for App Store Connect and uploads it, with its dSYMs, signed for distribution
// in the cloud by Xcode's account or an Admin key, else with an Apple Distribution certificate in the keychain, with the
// entitlements of its ad hoc signature, which the App ID gets the capabilities of; a Mac app goes in its installer
// package, which the cloud signs too. Xcode numbers the build unless CROSSBIND_APP_BUILD_NUMBER did, and writes nothing
// to -exportPath, which xcodebuild asks for all the same.
export function uploadArchive(api, archive, {
    team, key, isBuildManaged, facts, platform = 'iOS',
}) {
    const options = writeExportOptions(`${api.workDir}/ExportOptions.plist`, { destination: 'upload', team, isBuildManaged });
    let output;
    try {
        output = api.apple.xcodebuild('the upload', [
            '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', `${api.workDir}/export`, '-allowProvisioningUpdates',
            ...keyArgs(key),
        ], { log: `${api.workDir}/upload.log`, facts, causes: [MISSING_APP[platform]] });
    } catch (error) {
        if (error.reason === MISSING_APP[platform]) {
            api.log(`crossbind: App Store Connect has no app ${facts.id} yet, so this upload registers its bundle id with Apple first.`);
            registerBundleId(api, archive, {
                team, key, facts, platform,
            });
        }
        throw error;
    }
    // What App Store Connect warns of, as a dSYM it could not take, goes up with the app all the same.
    output.split('\n').filter((line) => line.startsWith('warning: exportArchive')).forEach((line) => api.warn(`crossbind: ${line}`));
}

// A step that failed for what only the user can mend, in Xcode or on Apple's sites, runs again once they press Enter,
// after crossbind opened the page that mends it where it knows one. Any other failure, or one without a terminal, stops
// the upload.
export async function untilDone(api, step) {
    for (;;) {
        try {
            return step();
        } catch (error) {
            if (!api.isGuided || !error.isMendable) throw error;
            api.log(error.message);
            if (error.page) {
                api.log(`crossbind: opening ${error.page}.`);
                api.openUrl(error.page);
            }
            await api.ask('Press Enter once that is done to try again, or Ctrl-C to stop. ');
            api.log('crossbind: trying again, which can take a few minutes.');
        }
    }
}

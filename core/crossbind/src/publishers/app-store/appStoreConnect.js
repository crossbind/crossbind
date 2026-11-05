import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const APP_STORE_CONNECT = 'https://appstoreconnect.apple.com/apps';

// An upload to an app App Store Connect does not have yet, which only its site makes.
const MISSING_APP = {
    pattern: /No suitable application records were found|App record with bundle identifier .* not found/i,
    hint: ({ id }) => `App Store Connect has no app ${id}: create it at ${APP_STORE_CONNECT}, a new iOS app with ${id} as its bundle ID, which this publish registered with Apple.`,
    page: APP_STORE_CONNECT,
};

// What a failed upload means beside what crossbind knows of any xcodebuild's failure.
const CAUSES = [MISSING_APP];

const keyArgs = (key) => (key ? ['-authenticationKeyPath', key.key, '-authenticationKeyID', key.keyId, '-authenticationKeyIssuerID', key.issuer] : []);
const archivedApp = (api, archive) => `${archive}/Products/Applications/${api.project.name}.app`;
const xcodebuild = (api, what, args, log, facts) => api.apple.xcodebuild(what, args, { log: `${api.workDir}/${log}`, facts, causes: CAUSES });

// The entitlements file the Xcode project names, or null without one.
function projectEntitlements(api, project) {
    const settings = fs.readFileSync(`${project}/${api.project.name}.xcodeproj/project.pbxproj`, 'utf8');
    const file = settings.match(/"?CODE_SIGN_ENTITLEMENTS"?\s*=\s*"?([^";]+)"?;/)?.[1];
    return file ? path.resolve(project, file.replace('$(SRCROOT)/', '')) : null;
}

// Signs an archived app ad hoc, its frameworks first, which takes no certificate. The signature carries the app's
// entitlements to the upload, which an unsigned app would lose, and the upload replaces it with its distribution one.
function signAdHoc(app, entitlements) {
    const frameworks = fs.existsSync(`${app}/Frameworks`) ? fs.readdirSync(`${app}/Frameworks`).map((name) => `${app}/Frameworks/${name}`) : [];
    [...frameworks, app].forEach((code) => {
        const withEntitlements = code === app && entitlements ? ['--entitlements', entitlements, '--generate-entitlement-der'] : [];
        const result = spawnSync('codesign', ['--force', '--sign', '-', '--timestamp=none', ...withEntitlements, code], { encoding: 'utf8' });
        if (result.error || result.status !== 0) {
            throw new Error(`crossbind: codesign could not sign ${code} ad hoc: ${(result.stderr || result.error?.message || '').trim()}`);
        }
    });
}

// Archives the app of the iOS Xcode project crossbind wrote unsigned, then signs it ad hoc with the entitlements the
// project names. The upload signs it for distribution, so the archive needs no development certificate, profile, device
// or Apple account.
export function archiveIosApp(api, project, { facts }) {
    const { name } = api.project;
    const archive = `${api.workDir}/${name}.xcarchive`;
    fs.rmSync(archive, { recursive: true, force: true });
    fs.mkdirSync(api.workDir, { recursive: true });
    xcodebuild(api, 'the archive', [
        'archive', '-project', `${project}/${name}.xcodeproj`, '-scheme', name, '-configuration', 'Release', '-destination', 'generic/platform=iOS',
        '-archivePath', archive, 'CODE_SIGNING_ALLOWED=NO',
    ], 'archive.log', facts);
    signAdHoc(archivedApp(api, archive), projectEntitlements(api, project));
    return archive;
}

export const archivedBinary = (api, archive) => `${archivedApp(api, archive)}/${api.project.name}`;

// The reasons the archived app's privacy manifest gives, by category: what App Store Connect reads, whatever the config
// the build read said.
export function archivedPrivacy(api, archive) {
    const manifest = `${archivedApp(api, archive)}/PrivacyInfo.xcprivacy`;
    if (!fs.existsSync(manifest)) return {};
    const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', manifest], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`crossbind: cannot read ${manifest}: ${result.stderr || result.error?.message}`);
    const names = Object.fromEntries(Object.entries(api.apple.privacyCategories).map(([name, { type }]) => [type, name]));
    return Object.fromEntries((JSON.parse(result.stdout).NSPrivacyAccessedAPITypes ?? [])
        .filter(({ NSPrivacyAccessedAPIType: type }) => Object.hasOwn(names, type))
        .map(({ NSPrivacyAccessedAPIType: type, NSPrivacyAccessedAPITypeReasons: reasons }) => [names[type], reasons]));
}

// The prebuilt frameworks crossbind puts in an app, as Hermes, leave their dSYMs out of the archive, which App Store
// Connect asks for.
export function addDsyms(archive, dsyms) {
    dsyms.forEach((dsym) => fs.cpSync(dsym, `${archive}/dSYMs/${path.basename(dsym)}`, { recursive: true }));
}

const escaped = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// The options of an export for App Store Connect, an XML plist: an upload with the app's dSYMs, or an .ipa alone.
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
// upload asks for the app record before it signs, so it registers nothing; an export to an .ipa, with no build number
// to look up, signs at once, which registers the id.
function registerBundleId(api, archive, { team, key, facts }) {
    const options = writeExportOptions(`${api.workDir}/RegisterOptions.plist`, { destination: 'export', team, isBuildManaged: false });
    xcodebuild(api, 'the registration of the bundle id', [
        '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', `${api.workDir}/register`, '-allowProvisioningUpdates',
        ...keyArgs(key),
    ], 'register.log', facts);
}

// Exports the archive for App Store Connect and uploads it with its dSYMs, signed for distribution in the cloud by Xcode's
// account or an Admin key, else with an Apple Distribution certificate in the keychain, with the entitlements of its ad
// hoc signature, which the App ID gets the capabilities of. Xcode numbers the build unless CROSSBIND_APP_BUILD_NUMBER
// did, and writes nothing to -exportPath, which xcodebuild asks for all the same.
export function uploadIosArchive(api, archive, {
    team, key, isBuildManaged, facts,
}) {
    const options = writeExportOptions(`${api.workDir}/ExportOptions.plist`, { destination: 'upload', team, isBuildManaged });
    let output;
    try {
        output = xcodebuild(api, 'the upload', [
            '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', `${api.workDir}/export`, '-allowProvisioningUpdates',
            ...keyArgs(key),
        ], 'upload.log', facts);
    } catch (error) {
        if (error.reason === MISSING_APP) {
            api.log(`crossbind: App Store Connect has no app ${facts.id} yet, so this publish registers its bundle id with Apple first.`);
            registerBundleId(api, archive, { team, key, facts });
        }
        throw error;
    }
    // What App Store Connect warns of, as a dSYM it could not take, goes up with the app all the same.
    output.split('\n').filter((line) => line.startsWith('warning: exportArchive')).forEach((line) => api.warn(`crossbind: ${line}`));
}

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import state from '../state/index.js';
import { APPLE_SIGNING } from './appleSigning.js';
import { EXEC_MAX_BUFFER } from './run.js';
import { PRIVACY_CATEGORIES } from '../utils/appOptions.js';
import { xmlPlist } from '../utils/plist.js';

export const APP_STORE_CONNECT = 'https://appstoreconnect.apple.com/apps';
const DEVELOPER_ACCOUNT = 'https://developer.apple.com/account';
// The lines of a failed xcodebuild's output that say why; its log has the rest.
const REASON_LINES = 15;

// An upload to an app App Store Connect does not have yet, which only its site makes.
const MISSING_APP = {
    pattern: /No suitable application records were found|App record with bundle identifier .* not found/i,
    hint: ({ id }) => `App Store Connect has no app ${id}: create it at ${APP_STORE_CONNECT}, a new iOS app with ${id} as its bundle ID, which this publish registered with Apple.`,
    page: APP_STORE_CONNECT,
};

// What a failed archive or upload means where xcodebuild's own words leave it unclear: what the user mends in Xcode or
// on Apple's sites, and the page where.
const CAUSES = [
    {
        pattern: /login details for account .* were rejected|No Accounts?\b|No Account for Team/i,
        hint: ({ team }) => `Xcode is signed in to no account of team ${team}, or its sign-in has lapsed: sign in again in Xcode, under Settings › Accounts.`,
    },
    {
        pattern: /PLA Update available|Program License Agreement/i,
        hint: () => `Apple has a new Program License Agreement, which the team's Account Holder accepts at ${DEVELOPER_ACCOUNT}.`,
        page: DEVELOPER_ACCOUNT,
    },
    {
        pattern: /Cloud signing permission error/i,
        hint: () => `the API key may not sign in the cloud, which takes its Admin role: use an Admin key, make an Apple Distribution certificate once in Xcode, under Settings › Accounts › Manage Certificates, or unset ${APPLE_SIGNING.key} to upload with Xcode's account.`,
    },
    MISSING_APP,
];

// Where a publish keeps the archive, its export and their logs.
const storeDir = () => `${state.config.paths.build}/app-store`;

const keyArgs = (key) => (key ? ['-authenticationKeyPath', key.key, '-authenticationKeyID', key.keyId, '-authenticationKeyIssuerID', key.issuer] : []);

// Runs xcodebuild with its output in `log`, which it returns. Its failure names the lines that say why, and what to do
// where those leave it unclear.
function xcodebuild(what, args, log, facts) {
    const out = fs.openSync(log, 'w');
    let result;
    try {
        result = spawnSync('xcodebuild', args, { stdio: ['ignore', out, out] });
    } finally {
        fs.closeSync(out);
    }
    if (result.error) throw new Error(`crossbind: cannot run xcodebuild, which comes with Xcode: ${result.error.message}`, { cause: result.error });
    if (result.signal) throw new Error(`crossbind: ${what} stopped on ${result.signal}.`);
    const output = fs.readFileSync(log, 'utf8');
    if (result.status === 0) return output;
    const reasons = [...new Set(output.split('\n').map((line) => line.trim()).filter((line) => /\berror\b|ITMS-/i.test(line)))].slice(-REASON_LINES);
    const cause = CAUSES.find(({ pattern }) => pattern.test(output));
    const lines = [`crossbind: ${what} failed; xcodebuild's log is ${log}.`, ...reasons.map((line) => `  ${line}`), ...(cause ? [`crossbind: ${cause.hint(facts)}`] : [])];
    throw Object.assign(new Error(lines.join('\n')), { isMendable: Boolean(cause), page: cause?.page ?? null, reason: cause ?? null });
}

const archivedApp = (archive) => `${archive}/Products/Applications/${state.config.general.name}.app`;

// The entitlements file the Xcode project names, or null without one.
function projectEntitlements(project) {
    const settings = fs.readFileSync(`${project}/${state.config.general.name}.xcodeproj/project.pbxproj`, 'utf8');
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
export function archiveIosApp(project, { facts }) {
    const { name } = state.config.general;
    const archive = `${storeDir()}/${name}.xcarchive`;
    fs.rmSync(archive, { recursive: true, force: true });
    fs.mkdirSync(storeDir(), { recursive: true });
    xcodebuild('the archive', [
        'archive', '-project', `${project}/${name}.xcodeproj`, '-scheme', name, '-configuration', 'Release', '-destination', 'generic/platform=iOS',
        '-archivePath', archive, 'CODE_SIGNING_ALLOWED=NO',
    ], `${storeDir()}/archive.log`, facts);
    signAdHoc(archivedApp(archive), projectEntitlements(project));
    return archive;
}

export const archivedBinary = (archive) => `${archivedApp(archive)}/${state.config.general.name}`;

// The reasons the archived app's privacy manifest gives, by category: what App Store Connect reads, whatever the config
// the build read said.
export function archivedPrivacy(archive) {
    const manifest = `${archivedApp(archive)}/PrivacyInfo.xcprivacy`;
    if (!fs.existsSync(manifest)) return {};
    const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', manifest], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`crossbind: cannot read ${manifest}: ${result.stderr || result.error?.message}`);
    const names = Object.fromEntries(Object.entries(PRIVACY_CATEGORIES).map(([name, { type }]) => [type, name]));
    return Object.fromEntries((JSON.parse(result.stdout).NSPrivacyAccessedAPITypes ?? [])
        .filter(({ NSPrivacyAccessedAPIType: type }) => Object.hasOwn(names, type))
        .map(({ NSPrivacyAccessedAPIType: type, NSPrivacyAccessedAPITypeReasons: reasons }) => [names[type], reasons]));
}

// Hermes comes prebuilt, so the archive has no dSYM of it, which App Store Connect asks for.
export function addHermesDsym(archive, dsym) {
    fs.cpSync(dsym, `${archive}/dSYMs/hermesvm.framework.dSYM`, { recursive: true });
}

// The options of an export for App Store Connect: an upload with the app's dSYMs, or an .ipa alone.
function writeExportOptions(file, { destination, team, isBuildManaged }) {
    fs.writeFileSync(file, xmlPlist({
        destination,
        manageAppVersionAndBuildNumber: isBuildManaged,
        method: 'app-store-connect',
        signingStyle: 'automatic',
        teamID: team,
        uploadSymbols: destination === 'upload',
    }));
    return file;
}

// Registers the app's bundle id with Apple, as App Store Connect's form for a new app lists registered ids alone. An
// upload asks for the app record before it signs, so it registers nothing; an export to an .ipa, with no build number
// to look up, signs at once, which registers the id.
function registerBundleId(archive, { team, key, facts }) {
    const options = writeExportOptions(`${storeDir()}/RegisterOptions.plist`, { destination: 'export', team, isBuildManaged: false });
    xcodebuild('the registration of the bundle id', [
        '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', `${storeDir()}/register`, '-allowProvisioningUpdates',
        ...keyArgs(key),
    ], `${storeDir()}/register.log`, facts);
}

// Exports the archive for App Store Connect and uploads it with its dSYMs, signed for distribution in the cloud by Xcode's
// account or an Admin key, else with an Apple Distribution certificate in the keychain, with the entitlements of its ad
// hoc signature, which the App ID gets the capabilities of. Xcode numbers the build unless CROSSBIND_APP_BUILD_NUMBER
// did, and writes nothing to -exportPath, which xcodebuild asks for all the same.
export function uploadIosArchive(archive, { team, key, isBuildManaged, facts }) {
    const options = writeExportOptions(`${storeDir()}/ExportOptions.plist`, { destination: 'upload', team, isBuildManaged });
    let output;
    try {
        output = xcodebuild('the upload', [
            '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', `${storeDir()}/export`, '-allowProvisioningUpdates',
            ...keyArgs(key),
        ], `${storeDir()}/upload.log`, facts);
    } catch (error) {
        if (error.reason === MISSING_APP) {
            console.log(`crossbind: App Store Connect has no app ${facts.id} yet, so this publish registers its bundle id with Apple first.`);
            registerBundleId(archive, { team, key, facts });
        }
        throw error;
    }
    // What App Store Connect warns of, as a dSYM it could not take, goes up with the app all the same.
    output.split('\n').filter((line) => line.startsWith('warning: exportArchive')).forEach((line) => console.warn(`crossbind: ${line}`));
}

// The teams of the accounts signed in to Xcode that upload to App Store Connect, which a free personal team does not,
// from Xcode's settings.
export function xcodeTeams() {
    const settings = spawnSync('defaults', ['export', 'com.apple.dt.Xcode', '-'], { maxBuffer: EXEC_MAX_BUFFER });
    if (settings.status !== 0) return [];
    const teams = spawnSync('plutil', ['-extract', 'IDEProvisioningTeamByIdentifier', 'json', '-o', '-', '-'], {
        input: settings.stdout, encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER,
    });
    if (teams.status !== 0) return [];
    const paid = Object.values(JSON.parse(teams.stdout)).flat().filter((team) => !team.isFreeProvisioningTeam);
    return [...new Map(paid.map((team) => [team.teamID, { id: team.teamID, name: team.teamName }])).values()];
}

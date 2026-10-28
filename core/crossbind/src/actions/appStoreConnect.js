import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import state from '../state/index.js';
import { APPLE_SIGNING } from './appleSigning.js';
import { EXEC_MAX_BUFFER } from './run.js';
import { PRIVACY_CATEGORIES } from '../utils/appOptions.js';
import { xmlPlist } from '../utils/plist.js';

export const APP_STORE_CONNECT = 'https://appstoreconnect.apple.com/apps';
const DEVELOPER_ACCOUNT = 'https://developer.apple.com/account';
const DEVICES = 'https://developer.apple.com/account/resources/devices/list';
// The lines of a failed xcodebuild's output that say why; its log has the rest.
const REASON_LINES = 15;

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
        pattern: /has no devices/i,
        hint: () => `Apple makes the development profile the archive is signed with only for a team with a device: connect an iPhone or iPad and open the project in Xcode once, or add the device at ${DEVICES}.`,
        page: DEVICES,
    },
    {
        pattern: /Cloud signing permission error/i,
        hint: () => `the API key may not sign in the cloud, which takes its Admin role: use an Admin key, make an Apple Distribution certificate once in Xcode, under Settings › Accounts › Manage Certificates, or unset ${APPLE_SIGNING.key} to upload with Xcode's account.`,
    },
    {
        pattern: /No suitable application records were found/i,
        hint: ({ id }) => `App Store Connect has no app ${id}: create it at ${APP_STORE_CONNECT}, a new iOS app with ${id} as its bundle ID.`,
        page: APP_STORE_CONNECT,
    },
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
    throw Object.assign(new Error(lines.join('\n')), { isMendable: Boolean(cause), page: cause?.page ?? null });
}

// Archives the app of the iOS Xcode project crossbind wrote, signed for development by Xcode's account or the key, which
// registers its bundle id with Apple too.
export function archiveIosApp(project, { key, facts }) {
    const { name } = state.config.general;
    const archive = `${storeDir()}/${name}.xcarchive`;
    fs.rmSync(archive, { recursive: true, force: true });
    fs.mkdirSync(storeDir(), { recursive: true });
    xcodebuild('the archive', [
        'archive', '-project', `${project}/${name}.xcodeproj`, '-scheme', name, '-configuration', 'Release', '-destination', 'generic/platform=iOS',
        '-archivePath', archive, '-allowProvisioningUpdates', ...keyArgs(key),
    ], `${storeDir()}/archive.log`, facts);
    return archive;
}

const archivedApp = (archive) => `${archive}/Products/Applications/${state.config.general.name}.app`;

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

// Exports the archive for App Store Connect and uploads it with its dSYMs, signed for distribution in the cloud by Xcode's
// account or an Admin key, else with an Apple Distribution certificate in the keychain. Xcode numbers the build unless
// CROSSBIND_APP_BUILD_NUMBER did, and writes nothing to -exportPath, which xcodebuild asks for all the same.
export function uploadIosArchive(archive, { team, key, isBuildManaged, facts }) {
    const options = `${storeDir()}/ExportOptions.plist`;
    fs.writeFileSync(options, xmlPlist({
        destination: 'upload',
        manageAppVersionAndBuildNumber: isBuildManaged,
        method: 'app-store-connect',
        signingStyle: 'automatic',
        teamID: team,
        uploadSymbols: true,
    }));
    const output = xcodebuild('the upload', [
        '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', `${storeDir()}/export`, '-allowProvisioningUpdates',
        ...keyArgs(key),
    ], `${storeDir()}/upload.log`, facts);
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

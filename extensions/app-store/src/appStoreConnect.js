import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { uploadArchive } from '@crossbind/core-store-kit';

const archivedApp = (api, archive) => `${archive}/Products/Applications/${api.project.name}.app`;
const xcodebuild = (api, what, args, log, facts) => api.apple.xcodebuild(what, args, { log: `${api.workDir}/${log}`, facts, causes: [] });

// The entitlements files the Xcode project names: the app's, or null without one, and those of the targets of Apple's
// app extensions of its, which crossbind writes in targets/<name>/, by their names.
function projectEntitlements(api, project) {
    const settings = fs.readFileSync(`${project}/${api.project.name}.xcodeproj/project.pbxproj`, 'utf8');
    const files = [...settings.matchAll(/"?CODE_SIGN_ENTITLEMENTS"?\s*=\s*"?([^";]+)"?;/g)].map(([, file]) => file.replace('$(SRCROOT)/', ''));
    const targetOf = (file) => file.match(/^targets\/([^/]+)\//)?.[1];
    const app = files.find((file) => !targetOf(file));
    return {
        app: app ? path.resolve(project, app) : null,
        targets: Object.fromEntries(files.filter(targetOf).map((file) => [targetOf(file), path.resolve(project, file)])),
    };
}

// Signs an archived app ad hoc, which takes no certificate: its frameworks and the app extensions of its PlugIns first,
// then the app. Each signature carries its bundle's entitlements to the upload, which an unsigned bundle would lose, and
// the upload replaces them with its distribution ones.
function signAdHoc(app, entitlements) {
    const inside = (folder) => (fs.existsSync(`${app}/${folder}`) ? fs.readdirSync(`${app}/${folder}`).sort().map((name) => `${app}/${folder}/${name}`) : []);
    const sign = (code, file) => {
        const withEntitlements = file ? ['--entitlements', file, '--generate-entitlement-der'] : [];
        const result = spawnSync('codesign', ['--force', '--sign', '-', '--timestamp=none', ...withEntitlements, code], { encoding: 'utf8' });
        if (result.error || result.status !== 0) {
            throw new Error(`crossbind: codesign could not sign ${code} ad hoc: ${(result.stderr || result.error?.message || '').trim()}`);
        }
    };
    inside('Frameworks').forEach((code) => sign(code, null));
    inside('PlugIns').forEach((code) => sign(code, entitlements.targets[path.basename(code, '.appex')] ?? null));
    sign(app, entitlements.app);
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

// The reasons the privacy manifest of an archived bundle gives, by category: what App Store Connect reads, whatever the
// config the build read said.
function privacyOf(api, bundle) {
    const manifest = `${bundle}/PrivacyInfo.xcprivacy`;
    if (!fs.existsSync(manifest)) return {};
    const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', manifest], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`crossbind: cannot read ${manifest}: ${result.stderr || result.error?.message}`);
    const names = Object.fromEntries(Object.entries(api.apple.privacyCategories).map(([name, { type }]) => [type, name]));
    return Object.fromEntries((JSON.parse(result.stdout).NSPrivacyAccessedAPITypes ?? [])
        .filter(({ NSPrivacyAccessedAPIType: type }) => Object.hasOwn(names, type))
        .map(({ NSPrivacyAccessedAPIType: type, NSPrivacyAccessedAPITypeReasons: reasons }) => [names[type], reasons]));
}

export const archivedPrivacy = (api, archive) => privacyOf(api, archivedApp(api, archive));

// The app extensions of the archived app's PlugIns, the targets of its extensions', each with its binary and the reasons
// its own privacy manifest gives.
export function archivedTargets(api, archive) {
    const plugIns = `${archivedApp(api, archive)}/PlugIns`;
    if (!fs.existsSync(plugIns)) return [];
    return fs.readdirSync(plugIns).filter((file) => file.endsWith('.appex')).sort().map((file) => {
        const name = path.basename(file, '.appex');
        return { name, binary: `${plugIns}/${file}/${name}`, privacy: privacyOf(api, `${plugIns}/${file}`) };
    });
}

// The prebuilt frameworks crossbind puts in an app, as Hermes, leave their dSYMs out of the archive, which App Store
// Connect asks for.
export function addDsyms(archive, dsyms) {
    dsyms.forEach((dsym) => fs.cpSync(dsym, `${archive}/dSYMs/${path.basename(dsym)}`, { recursive: true }));
}

// Exports the archive for App Store Connect and uploads it, as the Mac App Store's publisher does a Mac app's.
export const uploadIosArchive = (api, archive, options) => uploadArchive(api, archive, { ...options, platform: 'iOS' });

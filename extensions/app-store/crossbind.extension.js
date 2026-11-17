import {
    APP_STORE_LISTING, appStoreApp, appStoreCaller, appStoreListingProblems, askAppId, assertReviewable, listingOf, newestBuild,
    readAppStoreListing, readAppStoreSettings, submitRelease, untilDone, uploadArchive,
} from '@crossbind/core-store-kit';
import {
    addDsyms, archiveIosApp, archivedBinary, archivedPrivacy, archivedTargets, uploadIosArchive,
} from './src/appStoreConnect.js';
import { askEncryption, askIcon, askPrivacy } from './src/appSetup.js';
import { appStoreGuide } from './src/appStoreGuide.js';
import { writeArchive } from './src/macArchive.js';

// The platforms App Store Connect takes of crossbind's apps, as its API names them.
const PLATFORMS = {
    ios: { api: 'IOS', name: 'iOS' },
    macos: { api: 'MAC_OS', name: 'macOS' },
};
// The Mac App Store takes an Apple silicon app of macOS 13 or later.
const MINIMUM_MACOS = '13.0';

const NO_APP_ID = 'crossbind: App Store Connect knows an app by its bundle id, app.id, which crossbind.config.js does not set: set it, as com.example.myapp, before the first publish, as Apple keeps it for good.';
const NO_TEAM = "crossbind: App Store Connect takes uploads from an Apple Developer Program team, which neither app.team in crossbind.config.js nor this machine's XCODE_DEVELOPMENT_TEAM names: set either to its id, which developer.apple.com/account shows under Membership details.";
const NO_CATEGORY = 'crossbind: the Mac App Store takes no app without its category: set app.category in crossbind.config.js.';
const NO_ENCRYPTION = 'crossbind: app.encryption is not set, so App Store Connect asks whether this build uses encryption before TestFlight hands it out; set it in crossbind.config.js to answer for every build.';
const NO_ENCRYPTION_TO_SUBMIT = 'crossbind: App Review takes no build without its answer to whether it uses encryption: set app.encryption in crossbind.config.js.';
const NO_KEY_TO_SUBMIT = "crossbind: --submit hands the version to App Review through App Store Connect's API, which takes an API key: set CROSSBIND_APPLE_API_KEY, CROSSBIND_APPLE_API_KEY_ID and CROSSBIND_APPLE_API_ISSUER, as app.md's Publishing says.";
const TEAM_ID = /^[A-Z0-9]{10}$/;
const noIcon = (platform) => `crossbind: App Store Connect takes no ${platform} app without an icon: set app.icon in crossbind.config.js to a square PNG, at best 1024 × 1024.`;
const notOnMac = (id) => `crossbind: App Store Connect's app ${id} is not on macOS yet: add the platform there, with the + beside its platform in the sidebar, which makes it a universal purchase, then publish again, or publish the iOS app alone with -p ios.`;

async function pickTeam(api, teams) {
    if (teams.length === 1) {
        const [{ id, name }] = teams;
        return await api.askYesNo(`Upload as team ${id}, ${name}, which Xcode is signed in to? [Y/n] `) ? teams[0] : null;
    }
    api.log('Xcode is signed in to these teams:');
    teams.forEach(({ id, name }, index) => api.log(`  ${index + 1}) ${id} ${name}`));
    for (;;) {
        const team = teams[Number((await api.ask(`Which one uploads, 1 to ${teams.length}? `)).trim()) - 1];
        if (team) return team;
    }
}

// A team id the user types, or null once they have signed in to Xcode, for its teams to be read again.
async function typedTeam(api) {
    api.log("crossbind: Xcode is signed in to no such team, as a free personal team is none. Sign in to Xcode, under Settings › Accounts, with your membership's Apple Account, or type the team's id, which developer.apple.com/account shows under Membership details.");
    for (;;) {
        const id = (await api.ask('Team id, or Enter once Xcode is signed in: ')).trim().toUpperCase();
        if (!id) return null;
        if (TEAM_ID.test(id)) return id;
        api.log('That is no team id, which is ten letters and digits.');
    }
}

// The team the user picks of those Xcode is signed in to, or types, which this machine keeps as XCODE_DEVELOPMENT_TEAM.
async function askTeam(api) {
    api.log('crossbind: App Store Connect takes uploads from an Apple Developer Program team, which neither app.team nor XCODE_DEVELOPMENT_TEAM names.');
    let id = null;
    while (!id) {
        const teams = api.apple.teams();
        if (teams.length > 0) {
            const team = await pickTeam(api, teams);
            if (!team) throw new Error(NO_TEAM);
            ({ id } = team);
        } else {
            id = await typedTeam(api);
        }
    }
    api.settings.set({ XCODE_DEVELOPMENT_TEAM: id });
    if (api.app.team !== id) throw new Error(`crossbind: ~/.crossbind.json did not take XCODE_DEVELOPMENT_TEAM: set app.team: '${id}' in crossbind.config.js.`);
    api.log(`crossbind: ~/.crossbind.json keeps ${id} as XCODE_DEVELOPMENT_TEAM.`);
}

// The minimum macOS release of the store's build: the app's own where it is later.
function minimumMacos(api) {
    const own = api.config.app.macos?.minimumVersion;
    return typeof own === 'string' && own.localeCompare(MINIMUM_MACOS, undefined, { numeric: true }) > 0 ? own : MINIMUM_MACOS;
}

// Whether the app's record is on macOS too: once its user adds the platform, App Store Connect prepares a macOS version.
async function isOnMac(call, appId) {
    const { data } = await call('GET', `/apps/${appId}/appStoreVersions?${new URLSearchParams({ 'filter[platform]': PLATFORMS.macos.api, limit: '1' })}`);
    return data.length > 0;
}

// What a publish with --submit hands to App Review through: the API, the app App Store Connect has, and the listing,
// once App Store Connect would take the version to review. A macOS app's record, which a key reads before the build, has
// to be on macOS already.
async function releaseOf(api, key, { shouldSubmit, listings, settings }) {
    const isMac = api.platform === 'macos';
    if (!key || (!shouldSubmit && !isMac)) return { release: null };
    const call = appStoreCaller(key);
    const appStoreId = await appStoreApp(call, api.app.id);
    if (isMac && !await isOnMac(call, appStoreId)) return { missing: [notOnMac(api.app.id)] };
    if (!shouldSubmit) return { release: null };
    await assertReviewable(call, appStoreId, api.app.appleVersion, PLATFORMS[api.platform].api);
    return {
        release: {
            call, appStoreId, listings, settings,
        },
    };
}

// Hands the uploaded build to App Review as the app's version of its platform, with the listing and the settings, and
// says how it went.
async function submitToReview(api, {
    call, appStoreId, listings, settings,
}, before) {
    const platform = PLATFORMS[api.platform];
    const isPhased = api.options.phased;
    const { build, listed, settled } = await submitRelease(call, {
        appId: appStoreId, versionString: api.app.appleVersion, before, buildNumber: api.app.buildNumber, listings, settings, isPhased, platform: platform.api,
    });
    if (listings.length > 0) {
        api.log(listed.length > 0
            ? `crossbind: App Store Connect's ${platform.name} listing changed in ${listed.join(', ')}, as ${APP_STORE_LISTING} has it.`
            : `crossbind: App Store Connect's ${platform.name} listing is the one ${APP_STORE_LISTING} has already.`);
    }
    if (settled.length > 0) api.log(`crossbind: App Store Connect's ${settled.join(', ')} changed, as ${APP_STORE_LISTING} has them.`);
    const phases = isPhased ? ', to go out in phases over 7 days once released' : '';
    api.log(`crossbind: ${api.app.id} ${api.app.appleVersion} (build ${build}) for ${platform.name} went to App Review${phases}; Apple mails as the review goes.`);
}

// An app extension's reasons are its target's, which its extension gives, so the publish names them and asks for none.
const unreasonedTargetError = ({ name, unreasoned }) => new Error(`crossbind: App Store Connect refuses an iOS app that calls required reason API without Apple's reasons for it (ITMS-91053), and the app's target ${name} calls ${unreasoned.map(({ category, symbols }) => `${category} (${symbols.join(', ')})`).join(' and ')} with no reason in its privacy manifest. Its extension gives the target Apple's reasons in its privacy, as { fileTimestamp: ['C617.1'] }. Nothing went to App Store Connect.`);
const unreasonedError = (unreasoned) => new Error(`crossbind: App Store Connect refuses an iOS app that calls required reason API without Apple's reasons for it (ITMS-91053), and this app calls ${unreasoned.map(({ category, symbols }) => `${category} (${symbols.join(', ')})`).join(' and ')} with no reason in its privacy manifest. Give app.privacy Apple's reasons, as { fileTimestamp: ['C617.1'] }; Apple's "Describing use of required reason API" says what each covers. Nothing went to App Store Connect.`);

// What the app lacks that App Store Connect asks for, asked for on a terminal and named at once without one.
async function missingOf(api, { key, shouldSubmit }) {
    const missing = [];
    if (shouldSubmit && !key) missing.push(NO_KEY_TO_SUBMIT);
    if (api.config.app.id === undefined) {
        if (api.isGuided) await askAppId(api, 'App Store Connect', 'bundle id');
        else missing.push(NO_APP_ID);
    }
    if (!api.app.team) {
        if (api.isGuided) await askTeam(api);
        else missing.push(NO_TEAM);
    }
    if (api.config.app.icon === undefined) {
        if (api.isGuided) await askIcon(api);
        else missing.push(noIcon(PLATFORMS[api.platform].name));
    }
    if (api.platform === 'macos' && !api.app.category?.macos) missing.push(NO_CATEGORY);
    if (shouldSubmit && !api.isGuided && api.app.encryption === null) missing.push(NO_ENCRYPTION_TO_SUBMIT);
    return missing;
}

// Archives the iOS app crossbind built, which shows what required reason API it calls before it goes, and uploads it.
async function uploadIos(api, {
    key, dsyms, facts, release,
}, { project }) {
    api.log('crossbind: archiving the app, which takes a few minutes.');
    const archive = await untilDone(api, () => archiveIosApp(api, project, { facts }));
    const target = archivedTargets(api, archive).map(({ name, binary, privacy }) => ({ name, unreasoned: api.apple.unreasonedApis(binary, privacy) }))
        .find(({ unreasoned }) => unreasoned.length > 0);
    if (target) throw unreasonedTargetError(target);
    const unreasoned = api.apple.unreasonedApis(archivedBinary(api, archive), archivedPrivacy(api, archive));
    if (unreasoned.length > 0) {
        if (!api.isGuided) throw unreasonedError(unreasoned);
        await askPrivacy(api, unreasoned);
        api.log('crossbind: building the app again, with those reasons in its privacy manifest.');
        return { isRebuildAsked: true };
    }
    addDsyms(archive, dsyms);
    api.log(`crossbind: uploading the app to App Store Connect for team ${facts.team} with ${key ? `the API key ${key.keyId}` : "Xcode's account"}, which signs it.`);
    const build = api.app.buildNumber;
    const before = release ? await newestBuild(release.call, release.appStoreId, api.app.appleVersion) : null;
    await untilDone(api, () => uploadIosArchive(api, archive, {
        team: facts.team, key, isBuildManaged: build === null, facts,
    }));
    const app = build === null ? `${facts.id} ${api.app.appleVersion}, numbered by Xcode after the builds App Store Connect has of it,` : `${facts.id} ${api.app.appleVersion} (build ${build})`;
    api.log(`crossbind: ${app} is on App Store Connect. TestFlight hands it out once Apple has processed it, usually within 5 to 30 minutes, and Apple mails when it has.`);
    if (release) await submitToReview(api, release, before);
    return { published: { appId: facts.id, version: api.app.appleVersion, build } };
}

// Puts the macOS app crossbind built in an archive Xcode exports to App Store Connect, which signs it and its installer
// package in the cloud.
async function uploadMac(api, { key, facts, release }, { apps }) {
    const [built] = apps;
    if (!built) throw new Error('crossbind: the build made no macOS app, so nothing went to App Store Connect.');
    const archive = writeArchive(api, built, { team: facts.team });
    const build = api.app.buildNumber;
    const before = release ? await newestBuild(release.call, release.appStoreId, api.app.appleVersion, PLATFORMS.macos.api) : null;
    api.log(`crossbind: uploading the app to App Store Connect for team ${facts.team} with ${key ? `the API key ${key.keyId}` : "Xcode's account"}, which signs it and its installer package.`);
    await untilDone(api, () => uploadArchive(api, archive, {
        team: facts.team, key, isBuildManaged: build === null, facts, platform: 'macOS',
    }));
    const app = build === null
        ? `${facts.id} ${api.app.appleVersion} for macOS, numbered by Xcode after the builds App Store Connect has of it,`
        : `${facts.id} ${api.app.appleVersion} (build ${build}) for macOS`;
    api.log(`crossbind: ${app} is on App Store Connect. TestFlight hands it to Mac testers once Apple has processed it, usually within 5 to 30 minutes, and Apple mails when it has.`);
    if (release) await submitToReview(api, release, before);
    return { published: { appId: facts.id, version: api.app.appleVersion, build } };
}

// The publisher of an app's iOS and macOS builds to App Store Connect, whose TestFlight hands them out, both one after
// the other or the one -p names: crossbind builds the app, a macOS one sandboxed, the upload archives it, an iOS one
// after showing what required reason API it calls, and Xcode exports the archive to App Store Connect, which signs it in
// the cloud.
export default function appStore() {
    return {
        name: 'app-store',
        contract: 1,
        root: import.meta.dirname,
        publisher: {
            platform: ['ios', 'macos'],
            isDefault: ['ios'],
            store: 'App Store Connect',
            options: {
                submit: { help: "hand the app's version to App Review too, with the build and the listing in store/app-store, through App Store Connect's API" },
                phased: { help: 'release the version App Review approves in phases over 7 days, with --submit' },
            },

            // The store updates the macOS app it installs from the installer package the upload makes, and takes it
            // sandboxed.
            build: (api) => (api.platform === 'macos' ? { app: { updater: null, installers: [], macos: { sandbox: true, minimumVersion: minimumMacos(api) } } } : null),

            async check(api) {
                const { submit: shouldSubmit, phased } = api.options;
                if (phased && !shouldSubmit) throw new Error('crossbind: --phased releases the version App Review approves, so it takes --submit.');
                const platform = PLATFORMS[api.platform];
                if (process.platform !== 'darwin') throw new Error(`crossbind: ${platform.name} apps build and go to App Store Connect on macOS, with Xcode.`);
                const root = api.project.root;
                const key = api.apple.key();
                const listings = shouldSubmit ? listingOf(readAppStoreListing(root), platform.api) : [];
                const settings = shouldSubmit ? readAppStoreSettings(root) : {};
                const missing = [...appStoreListingProblems(root, listings), ...await missingOf(api, { key, shouldSubmit })];
                if (missing.length > 0) return { missing };
                if (api.app.encryption === null) {
                    if (api.isGuided) await askEncryption(api);
                    else api.warn(NO_ENCRYPTION);
                }
                const record = await releaseOf(api, key, { shouldSubmit, listings, settings });
                if (record.missing) return { missing: record.missing };
                const { release } = record;
                const facts = { id: api.app.id, team: api.app.team };
                const dsyms = api.platform === 'ios' ? { dsyms: await api.apple.dsyms() } : {};
                api.log(`crossbind: publishing ${facts.id} ${api.app.appleVersion} for ${platform.name} to App Store Connect for team ${facts.team}${release ? ' and App Review' : ''}; building the app first.`);
                return {
                    session: {
                        key, ...dsyms, facts, release,
                    },
                };
            },

            // Xcode numbers a build without CROSSBIND_APP_BUILD_NUMBER after those App Store Connect has.
            buildNumber: (api) => api.app.buildNumber,

            // The build signs a macOS app ad hoc, whatever Developer ID this machine names, as the upload signs it for the
            // store.
            buildEnv: (api) => (api.platform === 'macos' ? { CROSSBIND_APPLE_SIGNING_IDENTITY: undefined } : {}),

            upload: (api, session, output) => (api.platform === 'macos' ? uploadMac(api, session, output) : uploadIos(api, session, output)),

            guide: (api) => appStoreGuide(api),
        },
    };
}

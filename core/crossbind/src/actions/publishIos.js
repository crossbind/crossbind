import state from '../state/index.js';
import { APPLE_SIGNING, appStoreKey } from './appleSigning.js';
import { appBuildNumber, appTeam, appVersion } from './buildApp.js';
import { appStoreCaller } from './appStoreApi.js';
import {
    addHermesDsym, archiveIosApp, archivedBinary, archivedPrivacy, uploadIosArchive, xcodeTeams,
} from './appStoreConnect.js';
import { APP_STORE_LISTING, readAppStoreListing } from './appStoreListing.js';
import {
    appStoreApp, assertReviewable, newestBuild, submitRelease,
} from './appStoreRelease.js';
import {
    askAppId, askEncryption, askIcon, askPrivacy,
} from './appSetup.js';
import { appEncryption, appId } from '../utils/appOptions.js';
import { resolveHermesDsym } from '../utils/hermes.js';
import { unreasonedImports } from '../utils/requiredReasonApis.js';
import publish from './publish.js';
import { askLine, askYesNo } from '../utils/ask.js';
import loadSystemConfig, { updateSystemConfig } from '../utils/systemConfig.js';
import openUrl from '../utils/openUrl.js';

const NO_APP_ID = 'crossbind: App Store Connect knows an app by its bundle id, app.id, which crossbind.config.js does not set: set it, as com.example.myapp, before the first publish, as Apple keeps it for good.';
const NO_TEAM = "crossbind: App Store Connect takes uploads from an Apple Developer Program team, which neither app.team in crossbind.config.js nor this machine's XCODE_DEVELOPMENT_TEAM names: set either to its id, which developer.apple.com/account shows under Membership details.";
const NO_ICON = 'crossbind: App Store Connect takes no iOS app without an icon: set app.icon in crossbind.config.js to a square PNG, at best 1024 × 1024.';
const NO_ENCRYPTION = 'crossbind: app.encryption is not set, so App Store Connect asks whether this build uses encryption before TestFlight hands it out; set it in crossbind.config.js to answer for every build.';
const NO_ENCRYPTION_TO_SUBMIT = 'crossbind: App Review takes no build without its answer to whether it uses encryption: set app.encryption in crossbind.config.js.';
const NO_KEY_TO_SUBMIT = `crossbind: --submit hands the version to App Review through App Store Connect's API, which takes an API key: set ${APPLE_SIGNING.key}, ${APPLE_SIGNING.keyId} and ${APPLE_SIGNING.issuer}, as app.md's Publishing says.`;
const TEAM_ID = /^[A-Z0-9]{10}$/;

async function pickTeam(teams) {
    if (teams.length === 1) {
        const [{ id, name }] = teams;
        return await askYesNo(`Upload as team ${id}, ${name}, which Xcode is signed in to? [Y/n] `) ? teams[0] : null;
    }
    console.log('Xcode is signed in to these teams:');
    teams.forEach(({ id, name }, index) => console.log(`  ${index + 1}) ${id} ${name}`));
    for (;;) {
        const team = teams[Number((await askLine(`Which one uploads, 1 to ${teams.length}? `)).trim()) - 1];
        if (team) return team;
    }
}

// A team id the user types, or null once they have signed in to Xcode, for its teams to be read again.
async function typedTeam() {
    console.log("crossbind: Xcode is signed in to no such team, as a free personal team is none. Sign in to Xcode, under Settings › Accounts, with your membership's Apple Account, or type the team's id, which developer.apple.com/account shows under Membership details.");
    for (;;) {
        const id = (await askLine('Team id, or Enter once Xcode is signed in: ')).trim().toUpperCase();
        if (!id) return null;
        if (TEAM_ID.test(id)) return id;
        console.log('That is no team id, which is ten letters and digits.');
    }
}

// The team the user picks of those Xcode is signed in to, or types, which this machine keeps as XCODE_DEVELOPMENT_TEAM.
async function askTeam() {
    console.log('crossbind: App Store Connect takes uploads from an Apple Developer Program team, which neither app.team nor XCODE_DEVELOPMENT_TEAM names.');
    let id = null;
    while (!id) {
        const teams = xcodeTeams();
        if (teams.length > 0) {
            const team = await pickTeam(teams);
            if (!team) throw new Error(NO_TEAM);
            ({ id } = team);
        } else {
            id = await typedTeam();
        }
    }
    updateSystemConfig({ XCODE_DEVELOPMENT_TEAM: id });
    state.config.system = loadSystemConfig();
    if (appTeam() !== id) throw new Error(`crossbind: ~/.crossbind.json did not take XCODE_DEVELOPMENT_TEAM: set app.team: '${id}' in crossbind.config.js.`);
    console.log(`crossbind: ~/.crossbind.json keeps ${id} as XCODE_DEVELOPMENT_TEAM.`);
}

// A step that failed for what only the user can mend, in Xcode or on Apple's sites, runs again once they press Enter,
// after crossbind opened the page that mends it where it knows one. Any other failure, or one without a terminal, stops
// the publish.
async function untilDone(isGuided, step) {
    for (;;) {
        try {
            return step();
        } catch (error) {
            if (!isGuided || !error.isMendable) throw error;
            console.log(error.message);
            if (error.page) {
                console.log(`crossbind: opening ${error.page}.`);
                openUrl(error.page);
            }
            await askLine('Press Enter once that is done to try again, or Ctrl-C to stop. ');
            console.log('crossbind: trying again, which can take a few minutes.');
        }
    }
}

// What a publish with --submit hands to App Review through: the API, the app App Store Connect has, and the listing,
// once App Store Connect would take the version to review.
async function reviewableRelease(key, bundleId, listings) {
    const call = appStoreCaller(key);
    const appStoreId = await appStoreApp(call, bundleId);
    await assertReviewable(call, appStoreId, appVersion());
    return { call, appStoreId, listings };
}

// Hands the uploaded build to App Review, with the listing, and says how it went.
async function submitToReview({ call, appStoreId, listings }, { before, isPhased, facts }) {
    const { build, listed } = await submitRelease(call, {
        appId: appStoreId, versionString: appVersion(), before, buildNumber: appBuildNumber(), listings, isPhased,
    });
    if (listings.length > 0) {
        console.log(listed.length > 0
            ? `crossbind: App Store Connect's listing changed in ${listed.join(', ')}, as ${APP_STORE_LISTING} has it.`
            : `crossbind: App Store Connect's listing is the one ${APP_STORE_LISTING} has already.`);
    }
    const phases = isPhased ? ', to go out in phases over 7 days once released' : '';
    console.log(`crossbind: ${facts.id} ${appVersion()} (build ${build}) went to App Review${phases}; Apple mails as the review goes.`);
}

const unreasonedError = (unreasoned) => new Error(`crossbind: App Store Connect refuses an iOS app that calls required reason API without Apple's reasons for it (ITMS-91053), and this app calls ${unreasoned.map(({ category, symbols }) => `${category} (${symbols.join(', ')})`).join(' and ')} with no reason in its privacy manifest. Give app.privacy Apple's reasons, as { fileTimestamp: ['C617.1'] }; Apple's "Describing use of required reason API" says what each covers. Nothing went to App Store Connect.`);

// The publisher of an iOS app to App Store Connect, whose TestFlight hands it out: crossbind builds the app, which the
// upload archives, and the archived app shows what required reason API it calls before it goes.
export const appStore = {
    name: 'app-store',
    platform: 'ios',
    store: 'App Store Connect',

    async check({ isGuided, options: { shouldSubmit = false } }) {
        if (process.platform !== 'darwin') throw new Error('crossbind: iOS apps build and go to App Store Connect on macOS, with Xcode.');
        const key = appStoreKey();
        const listings = shouldSubmit ? readAppStoreListing(state.config.paths.project) : [];
        const missing = [];
        if (shouldSubmit && !key) missing.push(NO_KEY_TO_SUBMIT);
        if (state.config.app.id === undefined) {
            if (isGuided) await askAppId('App Store Connect', 'bundle id');
            else missing.push(NO_APP_ID);
        }
        if (!appTeam()) {
            if (isGuided) await askTeam();
            else missing.push(NO_TEAM);
        }
        if (state.config.app.icon === undefined) {
            if (isGuided) await askIcon();
            else missing.push(NO_ICON);
        }
        if (shouldSubmit && !isGuided && appEncryption(state.config) === null) missing.push(NO_ENCRYPTION_TO_SUBMIT);
        if (missing.length > 0) return { missing };
        if (appEncryption(state.config) === null) {
            if (isGuided) await askEncryption();
            else console.warn(NO_ENCRYPTION);
        }
        const facts = { id: appId(state.config), team: appTeam() };
        const release = shouldSubmit ? await reviewableRelease(key, facts.id, listings) : null;
        const hermesDsym = await resolveHermesDsym();

        console.log(`crossbind: publishing ${facts.id} ${appVersion()} to App Store Connect for team ${facts.team}${release ? ' and App Review' : ''}; building the app first.`);
        return { session: { key, hermesDsym, facts, release } };
    },

    // Xcode numbers a build without CROSSBIND_APP_BUILD_NUMBER after those App Store Connect has.
    buildNumber: () => appBuildNumber(),

    async upload({ isGuided, options: { isPhased = false } }, { key, hermesDsym, facts, release }, project) {
        console.log('crossbind: archiving the app, which takes a few minutes.');
        const archive = await untilDone(isGuided, () => archiveIosApp(project, { facts }));
        const unreasoned = unreasonedImports(archivedBinary(archive), archivedPrivacy(archive));
        if (unreasoned.length > 0) {
            if (!isGuided) throw unreasonedError(unreasoned);
            await askPrivacy(unreasoned);
            console.log('crossbind: building the app again, with those reasons in its privacy manifest.');
            return { isRebuildAsked: true };
        }
        addHermesDsym(archive, hermesDsym);
        console.log(`crossbind: uploading the app to App Store Connect for team ${facts.team} with ${key ? `the API key ${key.keyId}` : "Xcode's account"}, which signs it.`);
        const build = appBuildNumber();
        const before = release ? await newestBuild(release.call, release.appStoreId, appVersion()) : null;
        await untilDone(isGuided, () => uploadIosArchive(archive, {
            team: facts.team, key, isBuildManaged: build === null, facts,
        }));
        const app = build === null ? `${facts.id} ${appVersion()}, numbered by Xcode after the builds App Store Connect has of it,` : `${facts.id} ${appVersion()} (build ${build})`;
        console.log(`crossbind: ${app} is on App Store Connect. TestFlight hands it out once Apple has processed it, usually within 5 to 30 minutes, and Apple mails when it has.`);
        if (release) await submitToReview(release, { before, isPhased, facts });
        return { isRebuildAsked: false };
    },
};

export const publishIos = (options, tools) => publish(appStore, options, tools);

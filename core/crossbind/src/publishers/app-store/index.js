import { appStoreCaller } from './appStoreApi.js';
import {
    addDsyms, archiveIosApp, archivedBinary, archivedPrivacy, archivedTargets, uploadIosArchive,
} from './appStoreConnect.js';
import { APP_STORE_LISTING, readAppStoreListing } from './appStoreListing.js';
import {
    appStoreApp, assertReviewable, newestBuild, submitRelease,
} from './appStoreRelease.js';
import {
    askAppId, askEncryption, askIcon, askPrivacy,
} from '../appSetup.js';

const NO_APP_ID = 'crossbind: App Store Connect knows an app by its bundle id, app.id, which crossbind.config.js does not set: set it, as com.example.myapp, before the first publish, as Apple keeps it for good.';
const NO_TEAM = "crossbind: App Store Connect takes uploads from an Apple Developer Program team, which neither app.team in crossbind.config.js nor this machine's XCODE_DEVELOPMENT_TEAM names: set either to its id, which developer.apple.com/account shows under Membership details.";
const NO_ICON = 'crossbind: App Store Connect takes no iOS app without an icon: set app.icon in crossbind.config.js to a square PNG, at best 1024 × 1024.';
const NO_ENCRYPTION = 'crossbind: app.encryption is not set, so App Store Connect asks whether this build uses encryption before TestFlight hands it out; set it in crossbind.config.js to answer for every build.';
const NO_ENCRYPTION_TO_SUBMIT = 'crossbind: App Review takes no build without its answer to whether it uses encryption: set app.encryption in crossbind.config.js.';
const NO_KEY_TO_SUBMIT = "crossbind: --submit hands the version to App Review through App Store Connect's API, which takes an API key: set CROSSBIND_APPLE_API_KEY, CROSSBIND_APPLE_API_KEY_ID and CROSSBIND_APPLE_API_ISSUER, as app.md's Publishing says.";
const TEAM_ID = /^[A-Z0-9]{10}$/;

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

// A step that failed for what only the user can mend, in Xcode or on Apple's sites, runs again once they press Enter,
// after crossbind opened the page that mends it where it knows one. Any other failure, or one without a terminal, stops
// the publish.
async function untilDone(api, step) {
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

// What a publish with --submit hands to App Review through: the API, the app App Store Connect has, and the listing,
// once App Store Connect would take the version to review.
async function reviewableRelease(api, key, bundleId, listings) {
    const call = appStoreCaller(key);
    const appStoreId = await appStoreApp(call, bundleId);
    await assertReviewable(call, appStoreId, api.app.appleVersion);
    return { call, appStoreId, listings };
}

// Hands the uploaded build to App Review, with the listing, and says how it went.
async function submitToReview(api, { call, appStoreId, listings }, { before, facts }) {
    const isPhased = api.options.phased;
    const { build, listed } = await submitRelease(call, {
        appId: appStoreId, versionString: api.app.appleVersion, before, buildNumber: api.app.buildNumber, listings, isPhased,
    });
    if (listings.length > 0) {
        api.log(listed.length > 0
            ? `crossbind: App Store Connect's listing changed in ${listed.join(', ')}, as ${APP_STORE_LISTING} has it.`
            : `crossbind: App Store Connect's listing is the one ${APP_STORE_LISTING} has already.`);
    }
    const phases = isPhased ? ', to go out in phases over 7 days once released' : '';
    api.log(`crossbind: ${facts.id} ${api.app.appleVersion} (build ${build}) went to App Review${phases}; Apple mails as the review goes.`);
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
        else missing.push(NO_ICON);
    }
    if (shouldSubmit && !api.isGuided && api.app.encryption === null) missing.push(NO_ENCRYPTION_TO_SUBMIT);
    return missing;
}

// The publisher of an iOS app to App Store Connect, whose TestFlight hands it out: crossbind builds the app, which the
// upload archives, and the archived app shows what required reason API it calls before it goes.
export default function appStore() {
    return {
        name: 'app-store',
        root: import.meta.dirname,
        publisher: {
            platform: 'ios',
            store: 'App Store Connect',
            options: {
                submit: { help: "hand the iOS app's version to App Review too, with the build and the listing in store/app-store, through App Store Connect's API" },
                phased: { help: 'release the version App Review approves in phases over 7 days, with --submit' },
            },

            async check(api) {
                const { submit: shouldSubmit, phased } = api.options;
                if (phased && !shouldSubmit) throw new Error('crossbind: --phased releases the version App Review approves, so it takes --submit.');
                if (process.platform !== 'darwin') throw new Error('crossbind: iOS apps build and go to App Store Connect on macOS, with Xcode.');
                const key = api.apple.key();
                const listings = shouldSubmit ? readAppStoreListing(api.project.root) : [];
                const missing = await missingOf(api, { key, shouldSubmit });
                if (missing.length > 0) return { missing };
                if (api.app.encryption === null) {
                    if (api.isGuided) await askEncryption(api);
                    else api.warn(NO_ENCRYPTION);
                }
                const facts = { id: api.app.id, team: api.app.team };
                const release = shouldSubmit ? await reviewableRelease(api, key, facts.id, listings) : null;
                const dsyms = await api.apple.dsyms();
                api.log(`crossbind: publishing ${facts.id} ${api.app.appleVersion} to App Store Connect for team ${facts.team}${release ? ' and App Review' : ''}; building the app first.`);
                return { session: { key, dsyms, facts, release } };
            },

            // Xcode numbers a build without CROSSBIND_APP_BUILD_NUMBER after those App Store Connect has.
            buildNumber: (api) => api.app.buildNumber,

            async upload(api, {
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
                if (release) await submitToReview(api, release, { before, facts });
                return { published: { appId: facts.id, version: api.app.appleVersion, build } };
            },
        },
    };
}

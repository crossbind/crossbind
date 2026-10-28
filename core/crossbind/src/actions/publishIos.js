import state from '../state/index.js';
import { appStoreKey } from './appleSigning.js';
import {
    appBuildNumber, appOutputOf, appTeam, appVersion, clearAppOutputs,
} from './buildApp.js';
import {
    addHermesDsym, archiveIosApp, archivedBinary, archivedPrivacy, uploadIosArchive, xcodeTeams,
} from './appStoreConnect.js';
import {
    askAppId, askEncryption, askIcon, askPrivacy,
} from './appSetup.js';
import { appEncryption, appId } from '../utils/appOptions.js';
import { resolveHermesDsym } from '../utils/hermes.js';
import { unreasonedImports } from '../utils/requiredReasonApis.js';
import { askLine, askYesNo, hasTerminal } from '../utils/ask.js';
import loadSystemConfig, { updateSystemConfig } from '../utils/systemConfig.js';
import openUrl from '../utils/openUrl.js';

const NO_APP_ID = 'crossbind: App Store Connect knows an app by its bundle id, app.id, which crossbind.config.js does not set: set it, as com.example.myapp, before the first publish, as Apple keeps it for good.';
const NO_TEAM = "crossbind: App Store Connect takes uploads from an Apple Developer Program team, which neither app.team in crossbind.config.js nor this machine's XCODE_DEVELOPMENT_TEAM names: set either to its id, which developer.apple.com/account shows under Membership details.";
const NO_ICON = 'crossbind: App Store Connect takes no iOS app without an icon: set app.icon in crossbind.config.js to a square PNG, at best 1024 × 1024.';
const NO_ENCRYPTION = 'crossbind: app.encryption is not set, so App Store Connect asks whether this build uses encryption before TestFlight hands it out; set it in crossbind.config.js to answer for every build.';
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
        }
    }
}

async function buildIosApp(viteArgs, runVite) {
    clearAppOutputs();
    const exitCode = await runVite(['build', ...viteArgs], { ...process.env, CROSSBIND_APP_PLATFORM: 'ios' });
    if (exitCode !== 0) throw Object.assign(new Error(`crossbind: the build ended with exit code ${exitCode}, so nothing went to App Store Connect.`), { exitCode });
    return appOutputOf('ios');
}

const unreasonedError = (unreasoned) => new Error(`crossbind: App Store Connect refuses an iOS app that calls required reason API without Apple's reasons for it (ITMS-91053), and this app calls ${unreasoned.map(({ category, symbols }) => `${category} (${symbols.join(', ')})`).join(' and ')} with no reason in its privacy manifest. Give app.privacy Apple's reasons, as { fileTimestamp: ['C617.1'] }; Apple's "Describing use of required reason API" says what each covers. Nothing went to App Store Connect.`);

// Builds an iOS app, archives it and uploads it to App Store Connect, whose TestFlight hands it out. All it needs is
// checked before the build, which takes minutes: on a terminal, what is missing is asked for and set up; without one,
// as in CI, every missing piece is named at once. The archived app then shows what required reason API it calls.
export async function publishIos({ viteArgs }, { runVite }) {
    if (process.platform !== 'darwin') throw new Error('crossbind: iOS apps build and go to App Store Connect on macOS, with Xcode.');
    const isGuided = hasTerminal();
    const key = appStoreKey();
    const missing = [];
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
    if (missing.length > 0) throw new Error(missing.join('\n'));
    if (appEncryption(state.config) === null) {
        if (isGuided) await askEncryption();
        else console.warn(NO_ENCRYPTION);
    }
    const hermesDsym = await resolveHermesDsym();

    const facts = { id: appId(state.config), team: appTeam() };
    let archive;
    for (;;) {
        const project = await buildIosApp(viteArgs, runVite);
        console.log(`crossbind: archiving the app for team ${facts.team} with ${key ? `the API key ${key.keyId}` : "Xcode's account"}, which takes a few minutes.`);
        archive = await untilDone(isGuided, () => archiveIosApp(project, { key, facts }));
        const unreasoned = unreasonedImports(archivedBinary(archive), archivedPrivacy(archive));
        if (unreasoned.length === 0) break;
        if (!isGuided) throw unreasonedError(unreasoned);
        await askPrivacy(unreasoned);
        console.log('crossbind: building the app again, with those reasons in its privacy manifest.');
    }
    addHermesDsym(archive, hermesDsym);
    console.log('crossbind: uploading the app to App Store Connect.');
    const build = appBuildNumber();
    await untilDone(isGuided, () => uploadIosArchive(archive, {
        team: facts.team, key, isBuildManaged: build === null, facts,
    }));
    const app = build === null ? `${facts.id} ${appVersion()}, numbered by Xcode after the builds App Store Connect has of it,` : `${facts.id} ${appVersion()} (build ${build})`;
    console.log(`crossbind: ${app} is on App Store Connect. TestFlight hands it out once Apple has processed it, usually within 5 to 30 minutes, and Apple mails when it has.`);
}

import fs from 'node:fs';
import state from '../state/index.js';
import { SIGNING } from './androidGradle.js';
import {
    androidAppId, androidVersion, appBuildNumber, appOutputOf, clearAppOutputs,
} from './buildApp.js';
import {
    PLAY, highestVersionCode, keptSignIn, playCredentials, uploadBundle,
} from './googlePlay.js';
import { signInToPlay } from './playSetup.js';
import { askAppId } from './appSetup.js';
import { makeUploadKey, releaseSigningEnv } from './uploadKey.js';
import { askLine, askYesNo, hasTerminal } from '../utils/ask.js';
import loadSystemConfig from '../utils/systemConfig.js';
import openUrl from '../utils/openUrl.js';

const PLAY_CONSOLE = 'https://play.google.com/console';
const NO_APP_ID = 'crossbind: Google Play knows an app by its package name, app.id, which crossbind.config.js does not set: set it, as com.example.myapp, before the first publish, as Play keeps it for good.';
const NO_UPLOAD_KEY = `crossbind: Google Play takes bundles signed with your upload key: crossbind app upload-key makes one, or ${SIGNING.keystore}, ${SIGNING.alias} and ${SIGNING.password} name yours.`;
const NO_CREDENTIALS = `crossbind: Google Play takes uploads from your Google account, which a publish on a terminal signs in to, or from a service account: set ${PLAY.serviceAccount} to its e-mail, with gcloud signed in, ${PLAY.key} to its JSON key, or ${PLAY.token} to an access token of it; app.md's Publishing says how to make one.`;
const SIGN_IN = 'Google Play takes uploads from your Google account once crossbind is signed in to it. Sign in now, in your browser? [Y/n] ';
const ANOTHER_ACCOUNT = 'Sign in with another Google account? [Y/n] ';

// The highest versionCode Play has seen, and the credentials that saw it, once the user has done what Play asks for,
// which only the user can do: in Play Console, which crossbind opens before it waits for Enter and checks again, or, for
// a Google account without release rights, by signing in with another.
async function highestWithPlayConsole(appId, credentials) {
    let current = credentials;
    for (;;) {
        try {
            return { highest: await highestVersionCode(appId, current), credentials: current };
        } catch (error) {
            console.log(error.message);
            if (error.status === 403 && current.refreshToken) {
                current = await signInToPlay(ANOTHER_ACCOUNT);
                if (!current) throw error;
            } else {
                if ([403, 404].includes(error.status)) {
                    console.log(`crossbind: opening ${PLAY_CONSOLE}.`);
                    openUrl(PLAY_CONSOLE);
                }
                await askLine('Press Enter once that is done to check again, or Ctrl-C to stop. ');
            }
        }
    }
}

// Builds an Android app with the next versionCode Google Play takes, signed with the upload key, and releases its bundle
// on a track. All it needs is checked before the build, which takes minutes: on a terminal, what is missing is asked for
// and set up; without one, as in CI, every missing piece is named at once.
export async function publishAndroid({ track, status, viteArgs }, { runVite }) {
    const isGuided = hasTerminal();
    const missing = [];
    let appId = state.config.app.id === undefined ? null : androidAppId();
    if (!appId && isGuided) appId = await askAppId('Google Play', 'package name');
    if (!appId) missing.push(NO_APP_ID);

    let signing = await releaseSigningEnv();
    if (!signing.isSigned && isGuided && await askYesNo('This machine has no upload key, which Google Play takes bundles signed with. Make one now? [Y/n] ')) {
        await makeUploadKey();
        state.config.system = loadSystemConfig();
        signing = await releaseSigningEnv();
    }
    if (!signing.isSigned) missing.push(NO_UPLOAD_KEY);

    let credentials = playCredentials(process.env, state.config.system) ?? await keptSignIn();
    if (!credentials && isGuided) credentials = await signInToPlay(SIGN_IN);
    if (!credentials) missing.push(NO_CREDENTIALS);
    if (missing.length > 0) throw new Error(missing.join('\n'));

    let highest;
    if (isGuided) ({ highest, credentials } = await highestWithPlayConsole(appId, credentials));
    else highest = await highestVersionCode(appId, credentials);
    const versionCode = appBuildNumber() ?? Math.max(androidVersion().code, highest + 1);
    console.log(highest
        ? `crossbind: Google Play has seen versionCode ${highest} at most, so this build is ${versionCode}.`
        : `crossbind: Google Play has no build of ${appId} yet, so this build is ${versionCode}.`);

    clearAppOutputs();
    const exitCode = await runVite(['build', ...viteArgs], {
        ...process.env, ...signing.env, CROSSBIND_APP_PLATFORM: 'android', CROSSBIND_APP_BUILD_NUMBER: String(versionCode),
    });
    if (exitCode !== 0) throw Object.assign(new Error(`crossbind: the build ended with exit code ${exitCode}, so nothing went to Google Play.`), { exitCode });
    const project = appOutputOf('android');
    const aab = `${project}.aab`;
    if (!fs.existsSync(aab)) throw new Error(`crossbind: the build made no bundle at ${aab}, so nothing went to Google Play.`);
    const symbols = fs.existsSync(`${project}-symbols.zip`) ? `${project}-symbols.zip` : null;

    const released = await uploadBundle(appId, credentials, { aab, symbols, track, status });
    const app = `${appId} ${state.config.package?.version ?? '1.0.0'} (versionCode ${released.versionCode})`;
    if (released.status !== 'draft') {
        console.log(`crossbind: ${app} is out on Google Play's ${track} track.`);
        return;
    }
    console.log(`crossbind: ${app} is a draft on Google Play's ${track} track.`);
    if (status !== 'draft') {
        console.log("crossbind: Play takes drafts alone until an app's first release is out: roll it out once in Play Console, under Test and release, and later publishes go out by themselves.");
    }
}

import fs from 'node:fs';
import state from '../state/index.js';
import { SIGNING } from './androidGradle.js';
import { androidAppId, androidVersion, appBuildNumber } from './buildApp.js';
import {
    PLAY, highestVersionCode, keptSignIn, playCredentials, uploadBundle,
} from './googlePlay.js';
import { PLAY_LISTING, isListed, readPlayListing } from './playListing.js';
import { signInToPlay } from './playSetup.js';
import { askAppId } from './appSetup.js';
import publish from './publish.js';
import { makeUploadKey, releaseSigningEnv } from './uploadKey.js';
import { askLine, askYesNo } from '../utils/ask.js';
import loadSystemConfig from '../utils/systemConfig.js';
import openUrl from '../utils/openUrl.js';

const PLAY_CONSOLE = 'https://play.google.com/console';
const NO_APP_ID = 'crossbind: Google Play knows an app by its package name, app.id, which crossbind.config.js does not set: set it, as com.example.myapp, before the first publish, as Play keeps it for good.';
const NO_UPLOAD_KEY = `crossbind: Google Play takes bundles signed with your upload key: crossbind app upload-key makes one, or ${SIGNING.keystore}, ${SIGNING.alias} and ${SIGNING.password} name yours.`;
const NO_CREDENTIALS = `crossbind: Google Play takes uploads from your Google account, which a publish on a terminal signs in to, or from a service account: set ${PLAY.serviceAccount} to its e-mail, with gcloud signed in, ${PLAY.key} to its JSON key, or ${PLAY.token} to an access token of it; app.md's Publishing says how to make one.`;
const SIGN_IN = 'Google Play takes uploads from your Google account once crossbind is signed in to it. Sign in now, in your browser? [Y/n] ';
const ANOTHER_ACCOUNT = 'Sign in with another Google account? [Y/n] ';
const PERCENT = /^\d+(\.\d{1,2})?%?$/;

// The percent of a track's users a release reaches at first, as --rollout gives it: 10, or 10%.
export function rolloutPercent(value) {
    const percent = PERCENT.test(value) ? Number.parseFloat(value) : Number.NaN;
    if (!(percent > 0 && percent <= 100)) {
        throw new Error(`crossbind: --rollout takes the percent of the track's users a release reaches at first, above 0 and at most 100 with two decimals at most, as 10 or 12.5%, not ${value}.`);
    }
    return percent;
}

// The status of the release --draft and --rollout ask for, and the percent of users it reaches while in progress.
export function playRelease(isDraft, rollout = null) {
    if (isDraft && rollout !== null) throw new Error('crossbind: --draft and --rollout do not go together: a draft reaches no user until Play Console rolls it out.');
    if (isDraft) return { status: 'draft', rollout: null };
    return rollout !== null && rollout < 100 ? { status: 'inProgress', rollout } : { status: 'completed', rollout: null };
}

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

// The publisher of an Android app's bundle, signed with the upload key, to a Google Play track, with the next versionCode
// Play takes.
export const googlePlay = {
    name: 'google-play',
    platform: 'android',
    store: 'Google Play',

    async check({ isGuided, options }) {
        const listings = readPlayListing(state.config.paths.project);
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
        if (missing.length > 0) return { missing };
        const version = state.config.package?.version ?? '1.0.0';
        console.log(`crossbind: publishing ${appId} ${version} to Google Play's ${options.track} track.`);

        let highest;
        if (isGuided) ({ highest, credentials } = await highestWithPlayConsole(appId, credentials));
        else highest = await highestVersionCode(appId, credentials);
        return { session: { appId, version, signing, credentials, highest, listings } };
    },

    buildNumber(context, { appId, highest }) {
        const versionCode = appBuildNumber() ?? Math.max(androidVersion().code, highest + 1);
        console.log(highest
            ? `crossbind: Google Play has seen versionCode ${highest} at most, so this build is ${versionCode}.`
            : `crossbind: Google Play has no build of ${appId} yet, so this build is ${versionCode}.`);
        return versionCode;
    },

    buildEnv: ({ signing }) => signing.env,

    async upload({ options: { track, status, rollout = null } }, { appId, version, credentials, listings }, project) {
        const aab = `${project}.aab`;
        if (!fs.existsSync(aab)) throw new Error(`crossbind: the build made no bundle at ${aab}, so nothing went to Google Play.`);
        const symbols = fs.existsSync(`${project}-symbols.zip`) ? `${project}-symbols.zip` : null;

        console.log(`crossbind: uploading the bundle${symbols ? ' and its native debug symbols' : ''} to Google Play.`);
        // A percent's two decimals are a fraction's four, which the division alone would leave as 0.33299999999999996.
        const userFraction = status === 'inProgress' ? Number((rollout / 100).toFixed(4)) : null;
        const released = await uploadBundle(appId, credentials, { aab, symbols, track, status, userFraction, listings });
        if (listings.some(isListed)) {
            console.log(released.listed.length > 0
                ? `crossbind: Google Play's listing changed in ${released.listed.join(', ')}, as ${PLAY_LISTING} has it.`
                : `crossbind: Google Play's listing is the one ${PLAY_LISTING} has already.`);
        }
        const app = `${appId} ${version} (versionCode ${released.versionCode})`;
        if (released.status === 'inProgress') {
            console.log(`crossbind: ${app} is out to ${rollout}% of the users of Google Play's ${track} track: Play Console raises the share, under Test and release.`);
            return;
        }
        if (released.status !== 'draft') {
            console.log(`crossbind: ${app} is out on Google Play's ${track} track.`);
            return;
        }
        console.log(`crossbind: ${app} is a draft on Google Play's ${track} track.`);
        if (status !== 'draft') {
            console.log("crossbind: Play takes drafts alone until an app's first release is out: roll it out once in Play Console, under Test and release, and later publishes go out by themselves.");
        }
        if (status === 'inProgress') {
            console.log(`crossbind: Play stages updates alone, so that first release reaches all of the track's users, not ${rollout}% of them.`);
        }
    },
};

export const publishAndroid = (options, tools) => publish(googlePlay, options, tools);

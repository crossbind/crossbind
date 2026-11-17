import {
    PLAY, highestVersionCode, keptSignIn, playCredentials, playTracks, promoteRelease, sendListing, uploadBundle,
} from './src/googlePlay.js';
import {
    PLAY_LISTING, isListed, playListingProblems, readPlayListing, readPlayNotes, readPlaySettings,
} from './src/playListing.js';
import { signInToPlay } from './src/playSetup.js';
import { askAppId } from '@crossbind/core-store-kit';
import { playGuide } from './src/playGuide.js';

const PLAY_CONSOLE = 'https://play.google.com/console';
const NO_APP_ID = 'crossbind: Google Play knows an app by its package name, app.id, which crossbind.config.js does not set: set it, as com.example.myapp, before the first upload, as Play keeps it for good.';
const NO_UPLOAD_KEY = 'crossbind: Google Play takes bundles signed with your upload key: crossbind app key upload makes one, or CROSSBIND_ANDROID_KEYSTORE, CROSSBIND_ANDROID_KEY_ALIAS and CROSSBIND_ANDROID_KEYSTORE_PASSWORD name yours.';
const NO_CREDENTIALS = `crossbind: Google Play takes uploads from your Google account, which an upload on a terminal signs in to, or from a service account: set ${PLAY.serviceAccount} to its e-mail, with gcloud signed in, ${PLAY.key} to its JSON key, or ${PLAY.token} to an access token of it; app.md's Publishing says how to make one.`;
const SIGN_IN = 'Google Play takes uploads from your Google account once crossbind is signed in to it. Sign in now, in your browser? [Y/n] ';
const ANOTHER_ACCOUNT = 'Sign in with another Google account? [Y/n] ';
// A production track, as a form factor's is too, wear:production, which crossbind app release alone puts out on.
const PRODUCTION = /(^|:)production$/;
// A release's status as crossbind app store says Google Play has it.
const STATUSES = {
    draft: 'a draft', inProgress: 'rolling out', halted: 'halted', completed: 'out',
};

// The package name, which a terminal asks for where crossbind.config.js sets none; null without one.
async function appIdOf(api) {
    if (api.config.app.id !== undefined) return api.app.id;
    return api.isGuided ? askAppId(api, 'Google Play', 'package name') : null;
}

// The credentials Play takes: those the environment or this machine names, else the Google sign-in its keychain keeps,
// else, on a terminal, a new one; null without any.
async function credentialsOf(api) {
    const credentials = playCredentials(process.env, api.settings) ?? await keptSignIn(api.secrets);
    return credentials || !api.isGuided ? credentials : signInToPlay(api, SIGN_IN);
}

// The package name and the credentials Play takes, which a terminal asks for, or what is missing of them.
async function accessOf(api) {
    const missing = [];
    const appId = await appIdOf(api);
    if (!appId) missing.push(NO_APP_ID);
    const credentials = await credentialsOf(api);
    if (!credentials) missing.push(NO_CREDENTIALS);
    return missing.length > 0 ? { missing } : { appId, credentials };
}

// What a call to Play gives, with the credentials that got it, once the user has done what Play asks for, which only
// the user can do: in Play Console, which crossbind opens before it waits for Enter and calls again, or, for a Google
// account without the rights, by signing in with another. Without a terminal, the first failure stops it.
async function withPlayConsole(api, credentials, call) {
    let current = credentials;
    for (;;) {
        try {
            return { result: await call(current), credentials: current };
        } catch (error) {
            if (!api.isGuided) throw error;
            api.log(error.message);
            if (error.status === 403 && current.refreshToken) {
                current = await signInToPlay(api, ANOTHER_ACCOUNT);
                if (!current) throw error;
            } else {
                if ([403, 404].includes(error.status)) {
                    api.log(`crossbind: opening ${PLAY_CONSOLE}.`);
                    api.openUrl(PLAY_CONSOLE);
                }
                await api.ask('Press Enter once that is done to check again, or Ctrl-C to stop. ');
            }
        }
    }
}

// The page store/google-play holds, with what Play would refuse of it; null without one.
function pageOf(root) {
    const listings = readPlayListing(root);
    const { details, dataSafety = null } = readPlaySettings(root);
    if (!listings.some(isListed) && Object.keys(details).length === 0 && dataSafety === null) return null;
    return {
        listings, details, dataSafety, problems: playListingProblems(root, listings),
    };
}

// Sends the page to Google Play, says what changed, and gives the credentials that sent it.
async function sendPage(api, { appId, credentials }, { listings, details, dataSafety }) {
    api.log(`crossbind: sending the page ${PLAY_LISTING} holds of ${appId} to Google Play.`);
    const { result: sent, credentials: used } = await withPlayConsole(api, credentials, (current) => sendListing(appId, current, { listings, details, dataSafety }));
    if (sent.isDeclared) api.log(`crossbind: Google Play has the Data safety declaration ${PLAY_LISTING}/data_safety.csv holds.`);
    if (listings.some(isListed)) {
        api.log(sent.listed.length > 0
            ? `crossbind: Google Play's listing changed in ${sent.listed.join(', ')}, as ${PLAY_LISTING} has it.`
            : `crossbind: Google Play's listing is the one ${PLAY_LISTING} has already.`);
    }
    if (sent.isDetailed) api.log(`crossbind: Google Play's contact details changed, as ${PLAY_LISTING} has them.`);
    return used;
}

// A release on a track, as crossbind app store says Google Play has it.
function releaseLine(track, {
    versionCodes = [], name, status, userFraction,
}) {
    const share = status === 'inProgress' && userFraction ? ` to ${Number((userFraction * 100).toFixed(2))}% of its users` : '';
    return `${track}: versionCode ${versionCodes.join(', ')}${name ? ` (${name})` : ''}, ${STATUSES[status] ?? status}${share}`;
}

// The publisher of an Android app's bundle, signed with the upload key, to a Google Play testing track, with the next
// versionCode Play takes; of what the testing tracks have to production, out to everyone; and of the app's page in
// store/google-play, which goes alone.
export default function googlePlay() {
    return {
        name: 'google-play',
        contract: 1,
        root: import.meta.dirname,
        publisher: {
            platform: 'android',
            isDefault: true,
            store: 'Google Play',
            canStage: true,
            options: {
                track: { help: 'the Google Play testing track the bundle goes on: internal, alpha, beta or one of your own', value: '<track>', default: 'internal' },
            },

            async check(api) {
                const { track } = api.options;
                if (PRODUCTION.test(track)) {
                    throw new Error(`crossbind: --track ${track} puts the bundle out to everyone, which crossbind app release does once testers have had it: upload to a testing track, internal, alpha, beta or one of your own.`);
                }
                const notes = readPlayNotes(api.project.root);
                const missing = [];
                const appId = await appIdOf(api);
                if (!appId) missing.push(NO_APP_ID);

                let signing = await api.android.signing();
                if (!signing.isSigned && api.isGuided && await api.askYesNo('This machine has no upload key, which Google Play takes bundles signed with. Make one now? [Y/n] ')) {
                    await api.android.makeUploadKey();
                    signing = await api.android.signing();
                }
                if (!signing.isSigned) missing.push(NO_UPLOAD_KEY);

                const credentials = await credentialsOf(api);
                if (!credentials) missing.push(NO_CREDENTIALS);
                if (missing.length > 0) return { missing };
                api.log(`crossbind: publishing ${appId} ${api.app.version} to Google Play's ${track} track.`);

                const seen = await withPlayConsole(api, credentials, (current) => highestVersionCode(appId, current));
                return {
                    session: {
                        appId, signing, credentials: seen.credentials, highest: seen.result, notes,
                    },
                };
            },

            buildNumber(api, { appId, highest }) {
                const versionCode = api.app.buildNumber ?? Math.max(api.app.versionCode, highest + 1);
                api.log(highest
                    ? `crossbind: Google Play has seen versionCode ${highest} at most, so this build is ${versionCode}.`
                    : `crossbind: Google Play has no build of ${appId} yet, so this build is ${versionCode}.`);
                return versionCode;
            },

            buildEnv: (api, { signing }) => signing.env,

            async upload(api, { appId, credentials, notes }, { project, bundle, symbols }) {
                const { track } = api.options;
                if (!bundle) throw new Error(`crossbind: the build of ${project} made no bundle, so nothing went to Google Play.`);
                api.log(`crossbind: uploading the bundle${symbols ? ' and its native debug symbols' : ''} to Google Play.`);
                const released = await uploadBundle(appId, credentials, {
                    aab: bundle, symbols, track, status: 'completed', notes,
                });
                const app = `${appId} ${api.app.version} (versionCode ${released.versionCode})`;
                const published = { published: { appId, track, versionCode: released.versionCode, status: released.status } };
                if (released.status !== 'draft') {
                    api.log(`crossbind: ${app} is out to the testers of Google Play's ${track} track; crossbind app release google-play puts it out to everyone.`);
                    return published;
                }
                api.log(`crossbind: ${app} is a draft on Google Play's ${track} track.`);
                api.log("crossbind: Play takes drafts alone until an app's first release is out: roll it out once in Play Console, under Test and release, and later uploads go out to testers by themselves.");
                return published;
            },

            // Puts out on production the newest release the testing tracks have out to testers, with no build, after
            // the page store/google-play holds, to the share of users --rollout gives at first.
            async release(api) {
                const share = api.options.rollout;
                const page = pageOf(api.project.root);
                if (page?.problems.length > 0) return { missing: page.problems };
                const access = await accessOf(api);
                if (access.missing) return access;
                const credentials = page ? await sendPage(api, access, page) : access.credentials;
                const status = share === null ? 'completed' : 'inProgress';
                const userFraction = share === null ? null : Number((share / 100).toFixed(4));
                const { result: promoted } = await withPlayConsole(api, credentials, (current) => promoteRelease(access.appId, current, { status, userFraction }));
                const app = `${access.appId} versionCode ${promoted.versionCode}${promoted.name ? ` (${promoted.name})` : ''}, from the ${promoted.from} track,`;
                if (promoted.status === 'inProgress') {
                    api.log(`crossbind: ${app} is out to ${share}% of the users of Google Play's production track: Play Console raises the share, under Test and release.`);
                } else if (promoted.status === 'draft') {
                    api.log(`crossbind: ${app} is a draft on Google Play's production track: Play takes drafts alone until an app's first release is out, so roll it out once in Play Console, under Test and release.`);
                } else {
                    api.log(`crossbind: ${app} is out on Google Play's production track.`);
                }
                return {};
            },

            // Sends the page store/google-play holds, with no build: the listing, the contact details and the Data
            // safety declaration, after what Play would refuse of it and what is missing, which a terminal asks for.
            async send(api) {
                const page = pageOf(api.project.root);
                if (!page) {
                    api.log(`crossbind: ${PLAY_LISTING} holds no page of the app, so nothing went to Google Play.`);
                    return {};
                }
                if (page.problems.length > 0) return { missing: page.problems };
                const access = await accessOf(api);
                if (access.missing) return access;
                await sendPage(api, access, page);
                return {};
            },

            // What each track of Google Play has of the app, asking for nothing.
            async state(api) {
                if (api.config.app.id === undefined) return ['Set app.id in crossbind.config.js, and Google Play tells what it has of the app.'];
                const credentials = playCredentials(process.env, api.settings) ?? await keptSignIn(api.secrets);
                if (!credentials) {
                    return [`Sign in to Google on a terminal, as crossbind app store google-play --send or an upload does, or set ${PLAY.serviceAccount}, ${PLAY.key} or ${PLAY.token}, to see what Google Play has.`];
                }
                const released = (await playTracks(api.app.id, credentials)).filter(({ releases = [] }) => releases.length > 0);
                if (released.length === 0) return [`no release of ${api.app.id} yet`];
                return released.flatMap(({ track, releases }) => releases.map((one) => releaseLine(track, one)));
            },

            guide: (api) => playGuide(api),
        },
    };
}

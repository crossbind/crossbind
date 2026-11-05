import {
    PLAY, highestVersionCode, keptSignIn, playCredentials, uploadBundle,
} from './src/googlePlay.js';
import { PLAY_LISTING, isListed, readPlayListing } from './src/playListing.js';
import { signInToPlay } from './src/playSetup.js';
import { askAppId } from '@crossbind/core-store-kit';

const PLAY_CONSOLE = 'https://play.google.com/console';
const NO_APP_ID = 'crossbind: Google Play knows an app by its package name, app.id, which crossbind.config.js does not set: set it, as com.example.myapp, before the first publish, as Play keeps it for good.';
const NO_UPLOAD_KEY = 'crossbind: Google Play takes bundles signed with your upload key: crossbind app upload-key makes one, or CROSSBIND_ANDROID_KEYSTORE, CROSSBIND_ANDROID_KEY_ALIAS and CROSSBIND_ANDROID_KEYSTORE_PASSWORD name yours.';
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
async function highestWithPlayConsole(api, appId, credentials) {
    let current = credentials;
    for (;;) {
        try {
            return { highest: await highestVersionCode(appId, current), credentials: current };
        } catch (error) {
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

// The publisher of an Android app's bundle, signed with the upload key, to a Google Play track, with the next versionCode
// Play takes.
export default function googlePlay() {
    return {
        name: 'google-play',
        contract: 1,
        root: import.meta.dirname,
        publisher: {
            platform: 'android',
            isDefault: true,
            store: 'Google Play',
            options: {
                track: { help: 'the Google Play track the release goes on: internal, alpha, beta, production or one of your own', value: '<track>', default: 'internal' },
                draft: { help: 'leave the release a draft, which Play Console rolls out' },
                rollout: { help: "release to this percent of the track's users at first, as 10 or 10%: a staged rollout, which Play Console raises", value: '<percent>' },
            },

            async check(api) {
                const { track, draft, rollout } = api.options;
                const release = playRelease(draft, rollout === null ? null : rolloutPercent(rollout));
                const listings = readPlayListing(api.project.root);
                const missing = [];
                let appId = api.config.app.id === undefined ? null : api.app.id;
                if (!appId && api.isGuided) appId = await askAppId(api, 'Google Play', 'package name');
                if (!appId) missing.push(NO_APP_ID);

                let signing = await api.android.signing();
                if (!signing.isSigned && api.isGuided && await api.askYesNo('This machine has no upload key, which Google Play takes bundles signed with. Make one now? [Y/n] ')) {
                    await api.android.makeUploadKey();
                    signing = await api.android.signing();
                }
                if (!signing.isSigned) missing.push(NO_UPLOAD_KEY);

                let credentials = playCredentials(process.env, api.settings) ?? await keptSignIn(api.secrets);
                if (!credentials && api.isGuided) credentials = await signInToPlay(api, SIGN_IN);
                if (!credentials) missing.push(NO_CREDENTIALS);
                if (missing.length > 0) return { missing };
                api.log(`crossbind: publishing ${appId} ${api.app.version} to Google Play's ${track} track.`);

                let highest;
                if (api.isGuided) ({ highest, credentials } = await highestWithPlayConsole(api, appId, credentials));
                else highest = await highestVersionCode(appId, credentials);
                return { session: { appId, release, signing, credentials, highest, listings } };
            },

            buildNumber(api, { appId, highest }) {
                const versionCode = api.app.buildNumber ?? Math.max(api.app.versionCode, highest + 1);
                api.log(highest
                    ? `crossbind: Google Play has seen versionCode ${highest} at most, so this build is ${versionCode}.`
                    : `crossbind: Google Play has no build of ${appId} yet, so this build is ${versionCode}.`);
                return versionCode;
            },

            buildEnv: (api, { signing }) => signing.env,

            async upload(api, { appId, release: { status, rollout }, credentials, listings }, { project, bundle, symbols }) {
                const { track } = api.options;
                if (!bundle) throw new Error(`crossbind: the build of ${project} made no bundle, so nothing went to Google Play.`);
                api.log(`crossbind: uploading the bundle${symbols ? ' and its native debug symbols' : ''} to Google Play.`);
                // A percent's two decimals are a fraction's four, which the division alone would leave as
                // 0.33299999999999996.
                const userFraction = status === 'inProgress' ? Number((rollout / 100).toFixed(4)) : null;
                const released = await uploadBundle(appId, credentials, {
                    aab: bundle, symbols, track, status, userFraction, listings,
                });
                if (listings.some(isListed)) {
                    api.log(released.listed.length > 0
                        ? `crossbind: Google Play's listing changed in ${released.listed.join(', ')}, as ${PLAY_LISTING} has it.`
                        : `crossbind: Google Play's listing is the one ${PLAY_LISTING} has already.`);
                }
                const app = `${appId} ${api.app.version} (versionCode ${released.versionCode})`;
                const published = { published: { appId, track, versionCode: released.versionCode, status: released.status } };
                if (released.status === 'inProgress') {
                    api.log(`crossbind: ${app} is out to ${rollout}% of the users of Google Play's ${track} track: Play Console raises the share, under Test and release.`);
                    return published;
                }
                if (released.status !== 'draft') {
                    api.log(`crossbind: ${app} is out on Google Play's ${track} track.`);
                    return published;
                }
                api.log(`crossbind: ${app} is a draft on Google Play's ${track} track.`);
                if (status !== 'draft') {
                    api.log("crossbind: Play takes drafts alone until an app's first release is out: roll it out once in Play Console, under Test and release, and later publishes go out by themselves.");
                }
                if (status === 'inProgress') {
                    api.log(`crossbind: Play stages updates alone, so that first release reaches all of the track's users, not ${rollout}% of them.`);
                }
                return published;
            },
        },
    };
}

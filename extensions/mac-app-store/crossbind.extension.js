import {
    APP_STORE_LISTING, appStoreApp, appStoreCaller, appStoreListingProblems, assertReviewable, listingOf, newestBuild, readAppStoreListing,
    readAppStoreSettings, submitRelease, untilDone, uploadArchive,
} from '@crossbind/core-store-kit';
import { writeArchive } from './src/macArchive.js';
import { macStoreGuide } from './src/macStoreGuide.js';

const PLATFORM = 'MAC_OS';
// The Mac App Store takes an Apple silicon app of macOS 13 or later.
const MINIMUM_VERSION = '13.0';

const NO_KEY_TO_SUBMIT = "crossbind: --submit hands the version to App Review through App Store Connect's API, which takes an API key: set CROSSBIND_APPLE_API_KEY, CROSSBIND_APPLE_API_KEY_ID and CROSSBIND_APPLE_API_ISSUER, as app.md's Publishing says.";
const NO_APP_ID = 'crossbind: App Store Connect knows an app by its bundle id, app.id, which crossbind.config.js does not set: set it, as com.example.myapp, before the first publish, as Apple keeps it for good.';
const NO_TEAM = "crossbind: App Store Connect takes uploads from an Apple Developer Program team, which neither app.team in crossbind.config.js nor this machine's XCODE_DEVELOPMENT_TEAM names: set either to its id, which developer.apple.com/account shows under Membership details.";
const NO_ICON = 'crossbind: the Mac App Store takes no app without an icon: set app.icon in crossbind.config.js to a square PNG, at best 1024 × 1024.';
const NO_CATEGORY = 'crossbind: the Mac App Store takes no app without its category: set app.category in crossbind.config.js.';
const NO_ENCRYPTION = 'crossbind: app.encryption is not set, so App Store Connect asks whether this build uses encryption before TestFlight hands it out; set it in crossbind.config.js to answer for every build.';
const NO_ENCRYPTION_TO_SUBMIT = 'crossbind: App Review takes no build without its answer to whether it uses encryption: set app.encryption in crossbind.config.js.';
const notOnMac = (id) => `crossbind: App Store Connect's app ${id} is not on macOS yet: add the platform there, with the + beside its platform in the sidebar, which makes it a universal purchase, then publish again.`;

// The minimum macOS release of the store's build: the app's own where it is later.
function minimumVersion(api) {
    const own = api.config.app.macos?.minimumVersion;
    return typeof own === 'string' && own.localeCompare(MINIMUM_VERSION, undefined, { numeric: true }) > 0 ? own : MINIMUM_VERSION;
}

// Whether the app's record is on macOS too: once its user adds the platform, App Store Connect prepares a macOS version.
async function isOnMac(call, appId) {
    const { data } = await call('GET', `/apps/${appId}/appStoreVersions?${new URLSearchParams({ 'filter[platform]': PLATFORM, limit: '1' })}`);
    return data.length > 0;
}

// What the app lacks that App Store Connect asks for, before anything reaches it.
const missingOf = (api, { key, shouldSubmit }) => [
    ...(shouldSubmit && !key ? [NO_KEY_TO_SUBMIT] : []),
    ...(api.config.app.id === undefined ? [NO_APP_ID] : []),
    ...(api.app.team ? [] : [NO_TEAM]),
    ...(api.config.app.icon === undefined ? [NO_ICON] : []),
    ...(api.app.category?.macos ? [] : [NO_CATEGORY]),
    ...(shouldSubmit && api.app.encryption === null ? [NO_ENCRYPTION_TO_SUBMIT] : []),
];

// Hands the uploaded build to App Review as the app's macOS version, with the listing and the settings, and says how it
// went.
async function submitToReview(api, {
    call, appStoreId, listings, settings,
}, before) {
    const isPhased = api.options.phased;
    const { build, listed, settled } = await submitRelease(call, {
        appId: appStoreId, versionString: api.app.appleVersion, before, buildNumber: api.app.buildNumber, listings, settings, isPhased, platform: PLATFORM,
    });
    if (listings.length > 0) {
        api.log(listed.length > 0
            ? `crossbind: App Store Connect's macOS listing changed in ${listed.join(', ')}, as ${APP_STORE_LISTING} has it.`
            : `crossbind: App Store Connect's macOS listing is the one ${APP_STORE_LISTING} has already.`);
    }
    if (settled.length > 0) api.log(`crossbind: App Store Connect's ${settled.join(', ')} changed, as ${APP_STORE_LISTING} has them.`);
    const phases = isPhased ? ', to go out in phases over 7 days once released' : '';
    api.log(`crossbind: ${api.app.id} ${api.app.appleVersion} (build ${build}) for macOS went to App Review${phases}; Apple mails as the review goes.`);
}

// The publisher of a macOS app to the Mac App Store, through App Store Connect, whose TestFlight hands it to Mac testers:
// crossbind builds the app sandboxed and signed ad hoc, and the upload puts it in an archive Xcode exports to App Store
// Connect, which signs it and its installer package in the cloud, as it does an iOS app's.
export default function macAppStore() {
    return {
        name: 'mac-app-store',
        contract: 1,
        root: import.meta.dirname,
        publisher: {
            platform: 'macos',
            store: 'Mac App Store',
            options: {
                submit: { help: "hand the macOS app's version to App Review too, with the build and the listing in store/app-store, through App Store Connect's API" },
                phased: { help: 'release the version App Review approves in phases over 7 days, with --submit' },
            },

            // The store updates the app it installs from the installer package the upload makes, and takes it sandboxed.
            build: (api) => ({ app: { updater: null, installers: [], macos: { sandbox: true, minimumVersion: minimumVersion(api) } } }),

            async check(api) {
                const { submit: shouldSubmit, phased } = api.options;
                if (phased && !shouldSubmit) throw new Error('crossbind: --phased releases the version App Review approves, so it takes --submit.');
                if (process.platform !== 'darwin') throw new Error('crossbind: a Mac App Store build is made and uploaded on macOS, with Xcode.');
                const root = api.project.root;
                const key = api.apple.key();
                const listings = shouldSubmit ? listingOf(readAppStoreListing(root), PLATFORM) : [];
                const settings = shouldSubmit ? readAppStoreSettings(root) : {};
                const missing = [...appStoreListingProblems(root, listings), ...missingOf(api, { key, shouldSubmit })];
                if (missing.length > 0) return { missing };
                if (api.app.encryption === null) api.warn(NO_ENCRYPTION);
                let release = null;
                if (key) {
                    const call = appStoreCaller(key);
                    const appStoreId = await appStoreApp(call, api.app.id);
                    if (!await isOnMac(call, appStoreId)) return { missing: [notOnMac(api.app.id)] };
                    if (shouldSubmit) {
                        await assertReviewable(call, appStoreId, api.app.appleVersion, PLATFORM);
                        release = {
                            call, appStoreId, listings, settings,
                        };
                    }
                }
                const facts = { id: api.app.id, team: api.app.team };
                api.log(`crossbind: publishing ${facts.id} ${api.app.appleVersion} to the Mac App Store for team ${facts.team}${release ? ' and App Review' : ''}; building the app first.`);
                return { session: { key, facts, release } };
            },

            // Xcode numbers a build without CROSSBIND_APP_BUILD_NUMBER after those App Store Connect has.
            buildNumber: (api) => api.app.buildNumber,

            // The build signs the app ad hoc, whatever Developer ID this machine names, as the upload signs it for the store.
            buildEnv: () => ({ CROSSBIND_APPLE_SIGNING_IDENTITY: undefined }),

            async upload(api, { key, facts, release }, { apps }) {
                const [built] = apps;
                if (!built) throw new Error('crossbind: the build made no macOS app, so nothing went to the Mac App Store.');
                const archive = writeArchive(api, built, { team: facts.team });
                const build = api.app.buildNumber;
                const before = release ? await newestBuild(release.call, release.appStoreId, api.app.appleVersion, PLATFORM) : null;
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
            },

            guide: (api) => macStoreGuide(api),
        },
    };
}

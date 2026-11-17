import fs from 'node:fs';
import path from 'node:path';
import {
    SECRET, STORE_ENV, STORE_SETTINGS, deleteSubmission, partnerCenterCaller, storeApp, storeCredentials, submitPackages,
} from './src/partnerCenter.js';
import {
    STORE_LISTING, readStoreListing, readStoreSettings, storeListingProblems,
} from './src/msStoreListing.js';
import { msStoreGuide } from './src/msStoreGuide.js';

const PARTNER_CENTER = 'https://partner.microsoft.com/dashboard/apps-and-games/overview';
const NO_IDENTITY = "crossbind: the Microsoft Store takes the package of the app Partner Center reserved, whose identity app.windows.msix gives: copy { name, publisher, publisherDisplayName } from the app's Product identity page in Partner Center into crossbind.config.js.";
const NO_CREDENTIALS = `crossbind: Partner Center's submission API takes an Entra ID application its account has with the Manager role: set ${STORE_ENV.tenant}, ${STORE_ENV.client} and ${STORE_ENV.secret} to its tenant id, client id and key, or upload once on a terminal, which asks for them; app.md's Microsoft Store says how to make one.`;
const FIRST_SUBMISSION = "Partner Center's API makes no app's first submission, which takes the age ratings questionnaire: make it in Partner Center, with the packages crossbind app build -p windows makes; crossbind app store microsoft-store names each step. Later versions go with an upload.";
const VERSION = /^\d+\.\d+\.\d+$/;
const PERCENT = /^\d+(\.\d{1,2})?%?$/;

// The percent of the app's users a submission's packages reach at first, as --rollout gives it: 10, or 10%.
export function rolloutPercent(value) {
    const percent = PERCENT.test(value) ? Number.parseFloat(value) : Number.NaN;
    if (!(percent > 0 && percent < 100)) {
        throw new Error(`crossbind: --rollout takes the percent of the app's users the packages reach at first, above 0 and below 100 with two decimals at most, as 10 or 12.5%, not ${value}.`);
    }
    return percent;
}

// How Partner Center's statuses of a submission read, as crossbind app store says what the Microsoft Store has.
const STATUSES = {
    PendingCommit: 'not submitted yet',
    CommitStarted: 'being taken',
    CommitFailed: 'refused',
    PreProcessing: 'in pre-processing',
    Certification: 'in certification',
    CertificationFailed: 'failed certification',
    PendingPublication: 'certified, waiting for its publication',
    Release: 'being released',
    ReleaseFailed: 'failed its release',
    Publishing: 'being published',
    Published: 'out',
    Canceled: 'canceled',
};

const isIdentity = (identity) => Boolean(identity?.name && identity.publisher && identity.publisherDisplayName);
const lacks = (credentials) => Object.values(credentials).some((value) => !value);

// The application's credentials, asked for on a terminal where this machine lacks them: its tenant and client ids,
// which this machine's settings keep, and its key, which its keychain keeps.
async function askCredentials(api, credentials) {
    api.log("crossbind: Partner Center's submission API takes an Entra ID application its account has with the Manager role. In Partner Center, Account settings › User management › Microsoft Entra applications adds one, shows its tenant and client ids, and makes a key.");
    if (!await api.askYesNo('Enter its ids and key now? [Y/n] ')) return credentials;
    const tenant = credentials.tenant ?? (await api.ask('Tenant id: ')).trim();
    const client = credentials.client ?? (await api.ask('Client id: ')).trim();
    const secret = credentials.secret ?? (await api.askHidden('Key: ')).trim();
    api.settings.set({ [STORE_SETTINGS.tenant]: tenant, [STORE_SETTINGS.client]: client });
    if (!api.secrets.set(SECRET, secret)) api.warn('crossbind: this machine has no keychain to keep the key in, so the next upload asks for it again.');
    return { tenant, client, secret };
}

// The application's credentials, which a terminal asks for where this machine lacks them; null without them all.
async function credentialsOf(api) {
    const credentials = storeCredentials(process.env, api.settings, api.secrets);
    if (!lacks(credentials)) return credentials;
    const asked = api.isGuided ? await askCredentials(api, credentials) : credentials;
    return lacks(asked) ? null : asked;
}

// The app Partner Center reserved, once the user has done what only Partner Center does: reserving the app, which
// crossbind opens Partner Center for before it waits for Enter and looks again on a terminal.
async function reservedApp(api, call, identity) {
    for (;;) {
        const app = await storeApp(call, identity.name);
        if (app) return app;
        const missing = `crossbind: Partner Center has no app whose package identity is ${identity.name}, as app.windows.msix names it: reserve the app's name there as an MSIX or PWA app, and copy its Product identity into app.windows.msix.`;
        if (!api.isGuided) throw new Error(missing);
        api.log(missing);
        api.log(`crossbind: opening ${PARTNER_CENTER}.`);
        api.openUrl(PARTNER_CENTER);
        await api.ask('Press Enter once that is done to check again, or Ctrl-C to stop. ');
    }
}

// Stops an upload, before its build, that Partner Center's API would take no submission of: an app with no first
// submission, or one another submission is in progress of, which a terminal may delete.
async function assertSubmittable(api, call, app, identity) {
    if (app.publisherName && app.publisherName !== identity.publisher) {
        throw new Error(`crossbind: app.windows.msix names the publisher ${identity.publisher}, and Partner Center's app ${app.primaryName} has ${app.publisherName}: copy its Product identity into app.windows.msix again.`);
    }
    if (!app.lastPublishedApplicationSubmission && !app.pendingApplicationSubmission) throw new Error(`crossbind: ${FIRST_SUBMISSION}`);
    const pending = app.pendingApplicationSubmission;
    if (!pending) return;
    if (!app.lastPublishedApplicationSubmission) throw new Error(`crossbind: Partner Center has the app's first submission in progress, ${pending.id}; upload once it is out. ${FIRST_SUBMISSION}`);
    const question = `Partner Center has submission ${pending.id} of ${app.primaryName} in progress, and takes one at a time. Delete it, for this upload to make its own? [y/N] `;
    if (api.isGuided && /^\s*y/i.test(await api.ask(question))) {
        await deleteSubmission(call, app.id, pending.id);
        return;
    }
    throw new Error(`crossbind: Partner Center has submission ${pending.id} of ${app.primaryName} in progress, and takes one at a time: submit or delete it there, then upload again.`);
}

// The publisher of a Windows app's MSIX packages, x64 and arm64, with its listing, to the Microsoft Store, through
// Partner Center's submission API, once the app's first submission was made there.
export default function microsoftStore() {
    return {
        name: 'microsoft-store',
        contract: 1,
        root: import.meta.dirname,
        publisher: {
            platform: 'windows',
            store: 'Microsoft Store',
            options: {
                draft: { help: 'leave the submission for Partner Center to submit, with its packages and listing in it' },
                rollout: { help: "release the packages to this percent of the app's users at first, as 10 or 10%: a gradual rollout, which Partner Center raises", value: '<percent>' },
            },

            // The Store updates the apps it installs, and takes their MSIX packages alone.
            build: () => ({ app: { updater: null, installers: ['msix'] } }),

            async check(api) {
                const { draft, rollout } = api.options;
                if (draft && rollout !== null) throw new Error('crossbind: --draft and --rollout do not go together: a draft reaches no user until Partner Center submits it.');
                const percent = rollout === null ? null : rolloutPercent(rollout);
                const root = api.project.root;
                const listings = readStoreListing(root);
                const settings = readStoreSettings(root);
                const missing = storeListingProblems(root, listings);
                const identity = api.config.app.windows?.msix;
                if (!isIdentity(identity)) missing.push(NO_IDENTITY);
                if (!VERSION.test(api.app.version)) {
                    missing.push(`crossbind: the Microsoft Store takes ${api.app.version} as no version of a package, which is three numbers, as 1.2.3, with no prerelease, which it cannot tell from its release.`);
                }
                const credentials = await credentialsOf(api);
                if (!credentials) missing.push(NO_CREDENTIALS);
                if (missing.length > 0) return { missing };
                const call = partnerCenterCaller(credentials);
                const app = await reservedApp(api, call, identity);
                await assertSubmittable(api, call, app, identity);
                api.log(`crossbind: publishing ${app.primaryName} ${api.app.version} to the Microsoft Store; building the app first.`);
                return {
                    session: {
                        call, app, listings, settings, rollout: percent,
                    },
                };
            },

            async upload(api, {
                call, app, listings, settings, rollout,
            }, { apps }) {
                const packages = apps.flatMap(({ installers }) => installers.filter(({ name }) => name === 'msix').flatMap(({ files }) => files));
                if (packages.length === 0) throw new Error('crossbind: the build made no MSIX package, so nothing went to the Microsoft Store.');
                fs.mkdirSync(api.workDir, { recursive: true });
                api.log(`crossbind: uploading ${packages.map((file) => path.basename(file)).join(' and ')}${listings.length > 0 ? `, with the listing ${STORE_LISTING} has,` : ''} to Partner Center.`);
                const { id, status } = await submitPackages(call, {
                    appId: app.id, packages, listings, settings, rollout, isDraft: api.options.draft, zip: path.join(api.workDir, 'submission.zip'),
                });
                const published = {
                    published: {
                        appId: app.id, version: api.app.version, submission: id, status,
                    },
                };
                if (api.options.draft) {
                    api.log(`crossbind: Partner Center has submission ${id} of ${app.primaryName} ${api.app.version}, which you submit there: ${PARTNER_CENTER}`);
                    return published;
                }
                const share = rollout === null ? '' : `, to reach ${rollout}% of the app's users at first, which Partner Center raises`;
                api.log(`crossbind: ${app.primaryName} ${api.app.version} went to the Microsoft Store as submission ${id}, ${status}${share}. Certification takes up to three business days, and Partner Center mails as it goes.`);
                return published;
            },

            // Sends the page store/microsoft-store holds, with no build, in a submission of the packages Partner Center
            // has, committed for certification, after what Partner Center would refuse of it and what is missing.
            async send(api) {
                const root = api.project.root;
                const listings = readStoreListing(root);
                const settings = readStoreSettings(root);
                if (listings.length === 0 && settings.category === undefined && settings.notesForCertification === undefined) {
                    api.log(`crossbind: ${STORE_LISTING} holds no page of the app, so nothing went to the Microsoft Store.`);
                    return {};
                }
                const missing = storeListingProblems(root, listings);
                const identity = api.config.app.windows?.msix;
                if (!isIdentity(identity)) missing.push(NO_IDENTITY);
                const credentials = await credentialsOf(api);
                if (!credentials) missing.push(NO_CREDENTIALS);
                if (missing.length > 0) return { missing };
                const call = partnerCenterCaller(credentials);
                const app = await reservedApp(api, call, identity);
                await assertSubmittable(api, call, app, identity);
                fs.mkdirSync(api.workDir, { recursive: true });
                api.log(`crossbind: sending the page ${STORE_LISTING} holds of ${app.primaryName} to the Microsoft Store, with the packages Partner Center has.`);
                const { id, status } = await submitPackages(call, {
                    appId: app.id, listings, settings, zip: path.join(api.workDir, 'submission.zip'),
                });
                api.log(`crossbind: the page in ${STORE_LISTING} went to the Microsoft Store as submission ${id}, ${status}. Certification takes up to three business days, and Partner Center mails as it goes.`);
                return {};
            },

            // What Partner Center has of the app, asking for nothing: the submission in progress, as its status reads,
            // and the last one out.
            async state(api) {
                const identity = api.config.app.windows?.msix;
                if (!isIdentity(identity)) return ["Copy the app's Product identity into app.windows.msix, and the Microsoft Store tells what it has of the app."];
                const credentials = storeCredentials(process.env, api.settings, api.secrets);
                if (lacks(credentials)) return [`Set ${STORE_ENV.tenant}, ${STORE_ENV.client} and ${STORE_ENV.secret}, or upload once on a terminal, to see what the Microsoft Store has.`];
                const call = partnerCenterCaller(credentials);
                const app = await storeApp(call, identity.name);
                if (!app) return [`no app whose package identity is ${identity.name} yet`];
                const lines = [];
                const pending = app.pendingApplicationSubmission;
                if (pending) {
                    const { status } = await call('GET', `applications/${app.id}/submissions/${pending.id}/status`);
                    lines.push(`submission ${pending.id}: ${STATUSES[status] ?? status}`);
                }
                if (app.lastPublishedApplicationSubmission) lines.push(`submission ${app.lastPublishedApplicationSubmission.id}: out`);
                return lines.length > 0 ? lines : ['no submission yet'];
            },

            guide: (api) => msStoreGuide(api),
        },
    };
}

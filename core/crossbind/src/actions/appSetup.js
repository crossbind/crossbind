import state from '../state/index.js';
import { askLine, askYesNo } from '../utils/ask.js';
import { entry, writeAppOption } from '../utils/configWriter.js';
import { PRIVACY_CATEGORIES } from '../utils/appOptions.js';
import { readAppIcon } from '../utils/appIcon.js';

// What only the project can answer, which `crossbind app publish` asks on a terminal and writes into crossbind.config.js
// once the user says yes.

// An id both stores take: dot-separated parts of letters and digits, each starting with a letter, as Apple's take no
// underscore and Google's no hyphen.
const STORE_APP_ID = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;

const REASONS_PAGE = 'https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api';
// Apple's reasons an app may give, in short; that page has their rules. 0A2A.1 and C56D.1 are for third-party SDKs alone.
const REASONS = {
    'DDA9.1': 'to show file timestamps to the user; they stay on the device',
    'C617.1': "for the timestamps, size or other metadata of files in the app's container, app group container or CloudKit container",
    '3B52.1': 'for those of files or folders the user granted access to, as with a document picker',
    '35F9.1': 'to measure the time between events in the app, or for timers; only that time may leave the device',
    '8FFB.1': "to turn the times of the app's events into absolute timestamps, which may leave the device; the boot time may not",
    '3D61.1': 'in an optional bug report the user chooses to send, which shows it prominently',
    '85F4.1': 'to show disk space to the user; it stays on the device',
    'E174.1': 'to check for space before writing files, or to delete files when space runs low, in a way the user notices; it stays on the device',
    '7D9E.1': 'in an optional bug report the user chooses to send, which shows it prominently',
    'B728.1': 'in a health research app, to tell participants that low disk space hampers the research',
    '3EC4.1': 'in a custom keyboard app, to find the keyboards active on the device',
    '54BD.1': 'to show the right interface for the active keyboard in text fields, in a way the user notices; it stays on the device',
    'CA92.1': 'for information only the app itself reads and writes',
    '1C8F.1': "for information only the apps and extensions of the app's App Group read and write",
    'AC6B.1': 'for the managed app configuration MDM sets, or the feedback MDM reads',
};

// Writes app.<key> into crossbind.config.js once the user says yes, and into this run's config. One the config sets
// already is the user's to change.
async function writeAppAnswer(key, value) {
    const text = entry(key, value);
    if (state.config.app[key] !== undefined) throw new Error(`crossbind: set app.${text} in crossbind.config.js in place of the app.${key} there, and publish again.`);
    if (!await askYesNo(`Write app.${text} into crossbind.config.js? [Y/n] `)) throw new Error(`crossbind: set app.${text} in crossbind.config.js to publish.`);
    if (!writeAppOption(state.config.paths.project, key, value)) {
        throw new Error(`crossbind: crossbind.config.js is no config crossbind can write app.${key} into safely: set app.${text} in it yourself.`);
    }
    state.config.app = { ...state.config.app, [key]: value };
}

// Asks for the app's id, which the store keeps for good, under the name the store gives it.
export async function askAppId(store, term) {
    console.log(`crossbind: ${store} knows an app by its ${term}, app.id, and keeps it for good.`);
    for (;;) {
        const id = (await askLine(`The ${term}, as com.example.myapp: `)).trim();
        if (STORE_APP_ID.test(id)) {
            await writeAppAnswer('id', id);
            return id;
        }
        console.log(`That is no ${term} both stores take, which is dot-separated parts of letters and digits, each starting with a letter.`);
    }
}

function iconProblem(icon) {
    try {
        readAppIcon({ ...state.config, app: { ...state.config.app, icon } });
        return null;
    } catch (error) {
        return error.message;
    }
}

// Asks for the app's icon, without which App Store Connect takes no iOS app.
export async function askIcon() {
    console.log('crossbind: App Store Connect takes no iOS app without an icon, app.icon: a square PNG, at best 1024 × 1024.');
    for (;;) {
        const icon = (await askLine("Its path, from the project's folder: ")).trim();
        const problem = iconProblem(icon);
        if (!problem) {
            await writeAppAnswer('icon', icon);
            return;
        }
        console.log(problem);
    }
}

// Asks whether the app's encryption is iOS's own alone, which App Store Connect otherwise asks for every build. The answer
// is a legal statement, so there is no default.
export async function askEncryption() {
    console.log('crossbind: App Store Connect asks for every build whether the app uses encryption that export rules do not exempt, until app.encryption answers it.');
    for (;;) {
        const answer = (await askLine('Does the app use only the encryption iOS provides, as HTTPS through iOS, or none at all? [y/n] ')).trim();
        if (/^[yn]/i.test(answer)) {
            await writeAppAnswer('encryption', /^n/i.test(answer));
            return;
        }
        console.log('Answer y or n.');
    }
}

async function askReasons(reasons) {
    for (;;) {
        const picks = (await askLine('Which apply, as 1 or 1,2? ')).split(',').map((pick) => pick.trim()).filter(Boolean);
        const chosen = picks.map((pick) => reasons[Number(pick) - 1]);
        if (chosen.length > 0 && chosen.every(Boolean)) return [...new Set(chosen)];
        console.log(`Name one or more of 1 to ${reasons.length}, separated by commas.`);
    }
}

// Asks for Apple's reasons for each category of required reason API the app calls with none in app.privacy.
export async function askPrivacy(unreasoned) {
    console.log(`crossbind: App Store Connect refuses an iOS app that calls required reason API without Apple's reasons for it (ITMS-91053), which app.privacy gives; ${REASONS_PAGE} has the rules of each.`);
    const privacy = { ...state.config.app.privacy };
    for (const { category, symbols } of unreasoned) {
        const reasons = PRIVACY_CATEGORIES[category].reasons.filter((reason) => Object.hasOwn(REASONS, reason));
        console.log(`The app calls ${category} API (${symbols.join(', ')}). Apple's reasons for it:`);
        reasons.forEach((reason, index) => console.log(`  ${index + 1}) ${reason} ${REASONS[reason]}`));
        privacy[category] = await askReasons(reasons);
    }
    await writeAppAnswer('privacy', privacy);
}

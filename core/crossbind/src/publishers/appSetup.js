// What only the project can answer, which a publish asks on a terminal and writes into crossbind.config.js once the
// user says yes, through the api.

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

// Asks for the app's id, which the store keeps for good, under the name the store gives it.
export async function askAppId(api, store, term) {
    api.log(`crossbind: ${store} knows an app by its ${term}, app.id, and keeps it for good.`);
    for (;;) {
        const id = (await api.ask(`The ${term}, as com.example.myapp: `)).trim();
        if (STORE_APP_ID.test(id)) {
            await api.config.write('app.id', id);
            return id;
        }
        api.log(`That is no ${term} both stores take, which is dot-separated parts of letters and digits, each starting with a letter.`);
    }
}

// Asks for the app's icon, without which App Store Connect takes no iOS app: a path the build would refuse is asked
// for again.
export async function askIcon(api) {
    api.log('crossbind: App Store Connect takes no iOS app without an icon, app.icon: a square PNG, at best 1024 × 1024.');
    for (;;) {
        const icon = (await api.ask("Its path, from the project's folder: ")).trim();
        try {
            await api.config.write('app.icon', icon);
            return;
        } catch (error) {
            if (!error.isInvalid) throw error;
            api.log(error.message);
        }
    }
}

// Asks whether the app's encryption is iOS's own alone, which App Store Connect otherwise asks for every build. The answer
// is a legal statement, so there is no default.
export async function askEncryption(api) {
    api.log('crossbind: App Store Connect asks for every build whether the app uses encryption that export rules do not exempt, until app.encryption answers it.');
    for (;;) {
        const answer = (await api.ask('Does the app use only the encryption iOS provides, as HTTPS through iOS, or none at all? [y/n] ')).trim();
        if (/^[yn]/i.test(answer)) {
            await api.config.write('app.encryption', /^n/i.test(answer));
            return;
        }
        api.log('Answer y or n.');
    }
}

async function askReasons(api, reasons) {
    for (;;) {
        const picks = (await api.ask('Which apply, as 1 or 1,2? ')).split(',').map((pick) => pick.trim()).filter(Boolean);
        const chosen = picks.map((pick) => reasons[Number(pick) - 1]);
        if (chosen.length > 0 && chosen.every(Boolean)) return [...new Set(chosen)];
        api.log(`Name one or more of 1 to ${reasons.length}, separated by commas.`);
    }
}

// Asks for Apple's reasons for each category of required reason API the app calls with none in app.privacy.
export async function askPrivacy(api, unreasoned) {
    api.log(`crossbind: App Store Connect refuses an iOS app that calls required reason API without Apple's reasons for it (ITMS-91053), which app.privacy gives; ${REASONS_PAGE} has the rules of each.`);
    const privacy = { ...api.config.app.privacy };
    for (const { category, symbols } of unreasoned) {
        const reasons = api.apple.privacyCategories[category].reasons.filter((reason) => Object.hasOwn(REASONS, reason));
        api.log(`The app calls ${category} API (${symbols.join(', ')}). Apple's reasons for it:`);
        reasons.forEach((reason, index) => api.log(`  ${index + 1}) ${reason} ${REASONS[reason]}`));
        privacy[category] = await askReasons(api, reasons);
    }
    await api.config.write('app.privacy', privacy);
}

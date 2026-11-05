import { invoke } from 'crossbind/app/core';

const NO_UPDATES = 'crossbind: this app does not update itself: a desktop app does with app.updater in crossbind.config.js, an iOS or Android app through its store';

// A function of the updater's, which an app without one hears of by what it needs.
async function ofUpdater(name) {
    try {
        return await invoke(name);
    } catch (error) {
        throw error?.message === `crossbind: an app has no function ${name}` ? new Error(NO_UPDATES) : error;
    }
}

// One check or install runs at a time, and another rejects meanwhile.
export const updater = {
    // The version app.updater.url in crossbind.config.js offers when it is newer than the app's, as { version }, or null.
    check: async () => ofUpdater('updater.check'),
    // Downloads that version, checks that the key of app.updater.publicKey signed it and installs it in place of the app,
    // which then quits and opens the new version. It rejects when that fails.
    install: async () => ofUpdater('updater.install'),
};

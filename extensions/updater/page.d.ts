/** A newer version of the app, which app.updater.url in crossbind.config.js offers. */
export interface Update {
    version: string;
}

/** One check or install runs at a time, and another rejects meanwhile. */
export declare const updater: {
    /** The version app.updater.url offers when it is newer than the app's, or null. */
    check(): Promise<Update | null>;
    /** Downloads that version, checks that the key of app.updater.publicKey signed it and installs it in place of the app, which then quits and opens the new version. It rejects when that fails. */
    install(): Promise<void>;
};

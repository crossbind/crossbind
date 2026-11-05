export declare const shell: {
    /** An http, https or mailto address in the default browser or mail app. */
    openExternal(url: string | URL): Promise<void>;
    /** A file in the app the system opens its kind with, where app.openPath in crossbind.config.js lets the page: nowhere without it. */
    openPath(path: string): Promise<void>;
    /** A file, selected, in the system's file manager: one in the app's folders, or one a dialog picked during this run. */
    revealInFolder(path: string): Promise<void>;
    /** A file or folder moved to the system's trash, where its user can take it back: one in the app's folders, not one of them itself, or one a dialog picked during this run. Where the system has no trash, nothing moves and it rejects. */
    trash(path: string): Promise<void>;
};

/** What the event open-files carries: the absolute paths of the files the system opened the app with at once. */
export interface OpenFiles {
    paths: string[];
}

export declare const app: {
    /** The files the system opened the app with that have not reached the page yet, those of app.fileTypes in crossbind.config.js and those no extension's type takes, the launch's own among them, each by its absolute path. Once the page has asked, each later opening comes as the event open-files while it listens, so listening first, then asking, misses none. */
    launchFiles(): Promise<string[]>;
};

declare module 'crossbind/app/core' {
    interface AppEvents {
        /** Calls listener with each set of files the system opens the app with once the page has called app.launchFiles(), or events.held('open-files'), until the function it returns is called. */
        'open-files': OpenFiles;
    }
    interface HeldEvents {
        /** The files the host held for the page, which came before it asked since it loaded, as app.launchFiles() gives their paths. */
        'open-files': OpenFiles;
    }
}

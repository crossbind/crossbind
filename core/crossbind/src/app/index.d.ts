// What an app's host does for its page (target.runtimeEnv: 'app'); in any other build every call rejects.

/** A kind of file a dialog offers: its name, and the extensions, with or without the dot, that make it; "*" is any file. */
export interface FileFilter {
    name: string;
    extensions: string[];
}

export interface OpenOptions {
    title?: string;
    /** The folder the dialog shows first. */
    defaultPath?: string;
    filters?: FileFilter[];
    /** Folders instead of files. */
    directory?: boolean;
    multiple?: boolean;
}

export interface SaveOptions {
    title?: string;
    /** The folder the dialog shows first. */
    defaultPath?: string;
    defaultName?: string;
    filters?: FileFilter[];
}

export interface MessageOptions {
    message: string;
    /** Smaller text under the message. */
    detail?: string;
    /** info by default. Windows shows its icon for each, and macOS a caution sign for error; Linux, iOS and Android show none. */
    kind?: 'info' | 'warning' | 'error';
    /** One to three labels, the first the default; without them OK. */
    buttons?: string[];
}

/** The app's own folders, made when first asked for: what it keeps, what it can lose, and its logs. */
export interface AppPaths {
    data: string;
    cache: string;
    logs: string;
}

export declare const dialog: {
    /** The paths of the files or folders the user picked, or null when they cancelled. */
    open(options?: OpenOptions): Promise<string[] | null>;
    /** The path the user chose to save to, or null when they cancelled. */
    save(options?: SaveOptions): Promise<string | null>;
    /** The index of the button the user clicked: Return gives the first, and Escape or closing the dialog the last. */
    message(options: MessageOptions): Promise<number>;
};

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

export declare const app: {
    paths(): Promise<AppPaths>;
    /** Ends the app as closing its window does. */
    quit(): Promise<void>;
    /** Ends the app as quit() does, then opens it again, with no link. */
    relaunch(): Promise<void>;
    /** The links of app.urlSchemes in crossbind.config.js that opened the app and have not reached the page yet, the one it was launched with among them. Once the page has asked, each later link comes as the event open-url while it listens, so listening first, then asking, misses none. */
    launchUrls(): Promise<string[]>;
};

/** A key with CmdOrCtrl, Ctrl or Alt and maybe Shift, joined by +, as CmdOrCtrl+Shift+O is, or F1–F12, alone or with any of them. The key is A–Z, 0–9, F1–F12, Enter, Escape, Tab, Space, Backspace, Delete, Up, Down, Left, Right, Home, End, PageUp, PageDown, Plus, Minus, Comma or Period. */
export type Accelerator = string;

/** An item of a menu: one the page handles, by its id, a submenu, a separator, or a standard one by its role. */
export type MenuItem =
    | { label: string; id?: string; accelerator?: Accelerator; enabled?: boolean; checked?: boolean }
    | { label: string; items: MenuItem[] }
    | { type: 'separator' }
    | { role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'; label?: string; accelerator?: never }
    | { role: 'minimize' | 'close' | 'quit'; label?: string; accelerator?: Accelerator }
    | { role: 'editMenu' | 'windowMenu'; label?: string };

/** A menu of the bar, by its items, or a standard one by its role. */
export type Menu = { label: string; items: MenuItem[] } | { role: 'editMenu' | 'windowMenu'; label?: string };

/** What the event menu carries: the id of the item clicked, and for one with checked whether it now is. */
export interface MenuClick {
    id: string;
    checked?: boolean;
}

export declare const menu: {
    /** Sets the app's menus: on macOS after its app menu, which the app keeps, and on Windows and Linux in a bar of its window. A click of an item with an id is an event, menu, with a MenuClick. */
    set(menus: Menu[]): Promise<void>;
};

/** What the event second-instance carries: a later launch's arguments, the program's own left out, and the folder it was launched in. */
export interface SecondInstance {
    args: string[];
    cwd: string;
}

/** What the event open-url carries: a link of one of app.urlSchemes that the system opened the app with. */
export interface OpenUrl {
    url: string;
}

export declare const events: {
    /** Calls listener with each click of an item with an id in the menus menu.set sets, until the function it returns is called. */
    on(name: 'menu', listener: (click: MenuClick) => void): () => void;
    /** Calls listener with each link of app.urlSchemes the system opens the app with once the page has called app.launchUrls(), until the function it returns is called. */
    on(name: 'open-url', listener: (open: OpenUrl) => void): () => void;
    /** Calls listener with each later launch of a desktop app that app.singleInstance keeps to one instance, which brings its window to the front as far as the system lets it, until the function it returns is called. */
    on(name: 'second-instance', listener: (launch: SecondInstance) => void): () => void;
    /** Calls listener as the system of a desktop app goes to sleep, which it may do before the page has run, until the function it returns is called. */
    on(name: 'suspend', listener: () => void): () => void;
    /** Calls listener as the system of a desktop app wakes from sleep, until the function it returns is called. */
    on(name: 'resume', listener: () => void): () => void;
    /** Calls listener with the value of each event of this name the app's native code emits from now on, until the function it returns is called. */
    on(name: string, listener: (value: unknown) => void): () => void;
};

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

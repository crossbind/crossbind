/** A kind of file a dialog offers: its name, and the extensions, with or without the dot, that make it; "*" is any file. */
export interface FileFilter {
    name: string;
    extensions: string[];
}

export interface OpenOptions {
    /** Not on a phone, whose picker has none. */
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

export declare const dialog: {
    /**
     * The paths of the files or folders the user picked, or null when they cancelled. A phone gives copies of the files,
     * in a folder of their own in the app's temporary or cache folder; an iOS app a folder where its user keeps it.
     */
    open(options?: OpenOptions): Promise<string[] | null>;
    /** The path the user chose to save to, or null when they cancelled. On the desktop: a phone saves the page's downloads. */
    save(options?: SaveOptions): Promise<string | null>;
    /** The index of the button the user clicked: Return gives the first, and Escape or closing the dialog the last. */
    message(options: MessageOptions): Promise<number>;
};

// What an app's host does for its page (target.runtimeEnv: 'app'): crossbind/app/core alone, which crossbind/app has with
// what crossbind's own extensions give the page. A TypeScript app has their types with
// /// <reference types="@crossbind/core-app-host/app" />.

/** The app's own folders, made when first asked for: what it keeps, what it can lose, and its logs; and the read-only one of the files app.files lists, each in the place it had in the project. */
export interface AppPaths {
    data: string;
    cache: string;
    logs: string;
    resources: string;
    /** An iOS app's App Group's folder, which the targets of its extensions' that ask for it with appGroup: true share; '' elsewhere. */
    group: string;
}

export declare const app: {
    paths(): Promise<AppPaths>;
    /** Ends the app as closing its window does. */
    quit(): Promise<void>;
    /** Asks the app's extensions, as its user's Quit does, then ends the app as quit() does, unless one keeps it running. It resolves once it has asked the host, before the answer. */
    requestQuit(): Promise<void>;
    /** Ends the app as quit() does, then opens it again, with no link. */
    relaunch(): Promise<void>;
    /** The launch that started a desktop app. A phone's has no arguments, and no folder. */
    launchArgs(): Promise<Launch>;
};

/** What windows.set() changes of an open window: sizes and places in logical pixels, a page's size without the frame, and x and y the frame's place from the top left of the main screen, given together. A limit of 0 takes it away. */
export interface WindowChanges {
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    /** Moves the window to the middle of its screen. */
    center?: boolean;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    resizable?: boolean;
    /** Keeps the window above the other apps' windows. */
    alwaysOnTop?: boolean;
    fullscreen?: boolean;
}

/** What a window opens with: app.window's options, beside the page it loads and its name. Without x and y it opens in the middle of the screen. */
export interface WindowOptions extends Omit<WindowChanges, 'center' | 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight'> {
    /** The app's own page, as /settings.html?tab=2: '/' by default. */
    path?: string;
    /** A name of the app's own: a window of a name already open comes to the front, and no other opens. */
    name?: string;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    /** What the window shows until the page paints, as #rrggbb: app.window's by default. */
    backgroundColor?: string;
    /** false opens a window without a title bar and its buttons, which the page moves with data-crossbind-drag or windows.startDrag(). */
    frame?: boolean;
    /** The id of the window it stays above, and closes with. */
    parent?: number;
    /** With a parent: a sheet of the parent's on macOS, and on Windows and Linux a window the parent takes no input under until it closes. */
    modal?: boolean;
}

/** An open window, as windows.list() tells of it. */
export interface WindowState {
    id: number;
    name: string | null;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    isMaximized: boolean;
    isMinimized: boolean;
    isFullscreen: boolean;
    isFocused: boolean;
}

/** What windows.open() and windows.set() answer: the window's id, and the options the platform could not honour, which it did without, as Wayland's x and y. */
export interface WindowOpened {
    id: number;
    ignored: string[];
}

/** What the events window-opened and window-closed carry. */
export interface WindowEvent {
    id: number;
    name: string | null;
}

export declare const windows: {
    /** Opens a window of the app's own page, in front, on the desktop and an iPad whose app.ios.multipleWindows is true; an iPhone and Android reject. */
    open(options?: WindowOptions): Promise<WindowOpened>;
    /** Changes the window of this id, or the page's own without one. */
    set(changes: WindowChanges): Promise<{ ignored: string[] }>;
    set(id: number, changes: WindowChanges): Promise<{ ignored: string[] }>;
    /** Closes the window of this id, or the page's own without one, as its user does: an extension may keep it open. The app quits as its last window closes. */
    close(id?: number): Promise<void>;
    /** Brings the window of this id, or the page's own without one, to the front, restored if it was minimized. */
    focus(id?: number): Promise<void>;
    minimize(id?: number): Promise<void>;
    toggleMaximize(id?: number): Promise<void>;
    /** Moves the page's window with the pointer, as its title bar does, from a mousedown of the primary button. */
    startDrag(): Promise<void>;
    /** The open windows, the oldest first. */
    list(): Promise<WindowState[]>;
    /** The page's own window. */
    current(): Promise<WindowState>;
};

/** A launch of a desktop app: its arguments, the program's own and its links left out, which reach the owners of their schemes, the page those of app.urlSchemes as the event open-url; and the folder it was launched in. */
export interface Launch {
    args: string[];
    cwd: string;
}

/** What each event a page's listeners get gives them, by the event's name: the host's own here, and those an extension's types add. */
export interface AppEvents {
    /** Calls listener as the app becomes the active one on the desktop, or comes to a phone's foreground, until the function it returns is called. A Linux app's is its window's focus. */
    'active': void;
    /** Calls listener as another app takes the app's place on the desktop, or a phone's is interrupted, as by a call, a system alert or another app's picker, or goes to the background, until the function it returns is called. */
    'inactive': void;
    /** Calls listener as each window of the app's opens, until the function it returns is called. */
    'window-opened': WindowEvent;
    /** Calls listener as each window of the app's closes, until the function it returns is called. */
    'window-closed': WindowEvent;
}

/** What each event the host holds for the page gives, by the event's name, which an extension's types add. */
export interface HeldEvents {}

export declare const events: {
    on<Name extends keyof AppEvents>(name: Name, listener: (value: AppEvents[Name]) => void): () => void;
    /** Calls listener with the value of each event of this name the app's native code emits from now on, until the function it returns is called. */
    on(name: string, listener: (value: unknown) => void): () => void;
    held<Name extends keyof HeldEvents>(name: Name): Promise<HeldEvents[Name][]>;
    /** The values of the events of this name the app's native code held for the page with holdEvent(), which came before the page asked for them since it loaded; later ones come as the events while it listens, so listening first, then asking, misses none. */
    held(name: string): Promise<unknown[]>;
};

/** What an option of a page's function is, beside what typeof tells: how it is checked, and what it is called. */
export interface OptionKind {
    isFitting(value: unknown): boolean;
    name: string;
}

/** The options as the host takes them, so a misspelt or mistyped one fails here, saying which. */
export declare function checkedOptions<T>(name: string, options: T, kinds: Record<string, string | OptionKind>): T;

/** What invoke takes beside a function's options. */
export interface InvokeOptions<M = unknown> {
    /** Gets each message the function sends before it answers, in the order it sent them, all of them before invoke resolves. */
    onMessage?: (message: M) => void;
    /** Cancels the call: invoke rejects with the signal's reason, and the function hears of it. A new page cancels each call of the one before. */
    signal?: AbortSignal;
}

/** A function of one of the app's extensions, by its name, as clipboard.readText, with options of JSON values and bytes, a typed array, a DataView or an ArrayBuffer, whose result's bytes come back as a Uint8Array; an extension's own package calls it so. */
export declare function invoke<T = unknown, M = unknown>(name: string, options?: Record<string, unknown>, call?: InvokeOptions<M>): Promise<T>;

/** The URL of a path an extension's route serves, as "/clips/intro.mp4" or "/thumb/42?size=256", for the page's <img>, <video> or fetch(): crossbind://app/ext/<extension><path>, and https://appassets.androidplatform.net/ext/<extension><path> on Android. The path is as a URL holds it, escaped where it must be, without a part "." or ".."; the route gets it decoded. */
export declare function routeUrl(extension: string, path: string): string;

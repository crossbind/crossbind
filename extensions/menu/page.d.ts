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

/** A point of the page's, in CSS pixels from its top left, as a contextmenu event's clientX and clientY are. */
export interface PagePoint {
    x: number;
    y: number;
}

export declare const menu: {
    /** Sets the app's menus: on macOS after its app menu, which the app keeps, and on Windows and Linux in a bar of its window. A click of an item with an id is an event, menu, with a MenuClick. */
    set(menus: Menu[]): Promise<void>;
    /** Opens a menu of these items at the page's point, on the desktop, as a right click's menu opens: it resolves with the id of the item clicked, or null when the menu closes without one, and a standard item does what its role says. A contextmenu listener that opens it keeps the webview's own menu away with preventDefault(). */
    popup(items: MenuItem[], at: PagePoint): Promise<string | null>;
    /** Sets the menu a macOS app's Dock icon shows above the system's own items, of a tray's items; a click of an item with an id is the event menu, with a MenuClick. An empty list takes it away. */
    setDock(items: TrayItem[]): Promise<void>;
};

/** An item of the tray's menu: one the page handles, by its id, a submenu or a separator. */
export type TrayItem =
    | { label: string; id?: string; enabled?: boolean; checked?: boolean }
    | { label: string; items: TrayItem[] }
    | { type: 'separator' };

export interface TrayOptions {
    /** What the icon shows when the pointer rests on it. */
    tooltip?: string;
    /** The menu a click of the icon opens: a click on macOS, a right click on Windows, and on Linux the one its desktop takes. */
    menu?: TrayItem[];
}

export declare const tray: {
    /** The app's icon in the macOS menu bar, the Windows notification area or a Linux desktop's status tray. A click of an item with an id is the event menu, with a MenuClick, and a click of the icon the event tray where it opens no menu. Set again, it changes the icon that shows. */
    set(options?: TrayOptions): Promise<void>;
    /** Takes the icon away. */
    remove(): Promise<void>;
};

export interface NotificationOptions {
    title: string;
    body?: string;
}

export declare const notification: {
    /** A notification of the system's; a click on it is the event notification. macOS asks its user first. */
    show(options: NotificationOptions): Promise<void>;
};

declare module 'crossbind/app/core' {
    interface AppEvents {
        /** Calls listener with each click of an item with an id in the menus menu.set sets or in the tray's menu, until the function it returns is called. */
        menu: MenuClick;
        /** Calls listener with each left or right click of the tray's icon that opens no menu, until the function it returns is called. */
        tray: void;
        /** Calls listener with each click on a notification the app's notification.show showed while it runs, until the function it returns is called. */
        notification: void;
    }
}

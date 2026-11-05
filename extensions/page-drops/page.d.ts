/** What the event drop carries: the absolute paths of the files the app's user dropped on the page at once, and the page's point they were dropped at, in CSS pixels from its top left. */
export interface PageDrop {
    paths: string[];
    x: number;
    y: number;
}

declare module 'crossbind/app/core' {
    interface AppEvents {
        /** Calls listener with the files of each drop of the app's user's on the page, on the desktop, as the page's own drop event goes on, until the function it returns is called. The page may reach each path through shell's functions, as one its user picked. */
        drop: PageDrop;
    }
}

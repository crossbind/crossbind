export {};

declare module 'crossbind/app/core' {
    interface AppEvents {
        /** Calls listener as the system of a desktop app goes to sleep, which it may do before the page has run, until the function it returns is called. */
        suspend: void;
        /** Calls listener as the system of a desktop app wakes from sleep, until the function it returns is called. */
        resume: void;
    }
}

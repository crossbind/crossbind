import type { Launch } from 'crossbind/app/core';

/** What the event second-instance carries: a later launch. */
export type SecondInstance = Launch;

declare module 'crossbind/app/core' {
    interface AppEvents {
        /** Calls listener with each later launch of a desktop app that app.singleInstance keeps to one instance, which brings its window to the front as far as the system lets it, until the function it returns is called. */
        'second-instance': SecondInstance;
    }
}

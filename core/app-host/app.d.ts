// crossbind/app's types as an app's page has them, with what crossbind's own extensions give it, which a TypeScript app
// reads with /// <reference types="@crossbind/core-app-host/app" />, as vite/client's are read.
declare module 'crossbind/app' {
    import type { app as activities } from '@crossbind/extension-activities/page';
    import type { app as files } from '@crossbind/extension-files/page';
    import type { app as links } from '@crossbind/extension-links/page';
    import type { app as ownApp } from 'crossbind/app/core';
    // Each adds the events it sends to those of crossbind/app/core.
    import type {} from '@crossbind/extension-instance/page';
    import type {} from '@crossbind/extension-page-drops/page';
    import type {} from '@crossbind/extension-power/page';
    import type {} from '@crossbind/extension-shortcuts/page';

    export * from 'crossbind/app/core';
    export * from '@crossbind/extension-dialog/page';
    export * from '@crossbind/extension-menu/page';
    export * from '@crossbind/extension-shell/page';
    export * from '@crossbind/extension-updater/page';
    export type { UserActivity } from '@crossbind/extension-activities/page';
    export type { OpenFiles } from '@crossbind/extension-files/page';
    export type { SecondInstance } from '@crossbind/extension-instance/page';
    export type { OpenUrl } from '@crossbind/extension-links/page';
    export type { PageDrop } from '@crossbind/extension-page-drops/page';
    export type { ShortcutItem } from '@crossbind/extension-shortcuts/page';

    export const app: typeof ownApp & typeof activities & typeof files & typeof links;
}

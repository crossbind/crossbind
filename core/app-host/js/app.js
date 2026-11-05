// crossbind/app as an app's page imports it, which an app's bundler plugin takes from here: crossbind's own, with what
// crossbind's own extensions give the page. This, app.d.ts and package.json's dependencies alone name them.
import { app as ownApp } from 'crossbind/app/core';
import { app as activities } from '@crossbind/extension-activities/page';
import { app as files } from '@crossbind/extension-files/page';
import { app as links } from '@crossbind/extension-links/page';

export * from 'crossbind/app/core';
export { dialog } from '@crossbind/extension-dialog/page';
export { menu, notification, tray } from '@crossbind/extension-menu/page';
export { shell } from '@crossbind/extension-shell/page';
export { updater } from '@crossbind/extension-updater/page';

export const app = {
    ...ownApp, ...activities, ...files, ...links,
};

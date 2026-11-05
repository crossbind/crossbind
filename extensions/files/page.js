import { events } from 'crossbind/app/core';

export const app = {
    // The files the system opened the app with that have not reached the page yet, those no extension's type takes, the
    // launch's own among them, which the host holds as the events open-files; later ones come as the event.
    launchFiles: async () => (await events.held('open-files')).flatMap((value) => (Array.isArray(value?.paths) ? value.paths : []))
        .filter((path) => typeof path === 'string'),
};

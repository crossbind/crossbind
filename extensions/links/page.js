import { events } from 'crossbind/app/core';

export const app = {
    // The links of app.urlSchemes that opened the app and have not reached the page yet, the one it was launched with
    // among them, which the host holds as the events open-url; later ones come as the event. Listening first, then
    // asking, misses none.
    launchUrls: async () => (await events.held('open-url')).map((value) => value?.url).filter((url) => typeof url === 'string'),
};

// crossbind/app for the page of an origin an extension serves, which the host answers at /__crossbind/app.js from the
// app's own files: what the app's own page imports, over the page's channel, which goes under a name of its own, as the
// page's own crossbind.js, a web build's, takes globalThis.Crossbind. Such a page loads no module of the app's.
import { callApp, on } from './channel.js';

globalThis.__crossbind_page_api = { app: callApp, on, takesMessages: true };

export * from './app.js';

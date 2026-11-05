// The system clipboard's text, from an app's page. The page has the web's navigator.clipboard as well, which reads on its
// user's gesture alone; these read and write at any time the system lets an app.
import { invoke } from 'crossbind/app';

// The text the clipboard holds, or '' when it holds none.
export const readText = async () => invoke('clipboard.readText');

// Puts text on the clipboard, in place of what it held.
export const writeText = async (text) => {
    if (typeof text !== 'string') throw new TypeError('crossbind: clipboard.writeText takes a string.');
    return invoke('clipboard.writeText', { text });
};

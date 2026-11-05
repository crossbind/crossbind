// The extension's functions, from an app's page.
import { invoke } from 'crossbind/app';

// What the app's native code says to the name given.
export const greet = async (name) => {
    if (typeof name !== 'string') throw new TypeError('crossbind: starter.greet takes a string.');
    return invoke('starter.greet', { name });
};

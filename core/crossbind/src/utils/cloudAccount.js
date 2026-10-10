import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import systemKeys from './systemKeys.js';

// Where crossbind cloud is, and this machine's sign-in to it (`crossbind login`), kept per cloud address.

export const DEFAULT_CLOUD_URL = systemKeys.CLOUD_URL.default;
export const CREDENTIALS_FILE = path.join(os.homedir(), '.crossbind', 'credentials.json');
const URL_VARIABLE = 'CROSSBIND_CLOUD_URL';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function cloudUrl(system, env = process.env) {
    const from = env[URL_VARIABLE] ? `$${URL_VARIABLE}` : 'CLOUD_URL in ~/.crossbind.json';
    const url = env[URL_VARIABLE] || system?.CLOUD_URL || DEFAULT_CLOUD_URL;
    const parsed = URL.parse(url);
    if (!['https:', 'http:'].includes(parsed?.protocol)) throw new Error(`crossbind: ${from} is ${JSON.stringify(url)}, not an https address.`);
    // The token travels with every call: plain http only to this machine.
    if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
        throw new Error(`crossbind: ${from} is plain http to another machine; crossbind cloud needs https.`);
    }
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error(`crossbind: ${from} is ${JSON.stringify(url)}; give the cloud's origin alone, such as ${DEFAULT_CLOUD_URL}.`);
    }
    return parsed.origin;
}

export function readCredentials(file = CREDENTIALS_FILE) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        throw new Error(`crossbind: ${file} cannot be read (${error.message}); delete it and run crossbind login again.`, { cause: error });
    }
}

// Readable by this user only, written as a new file under a name nobody can plant anything at, then renamed into
// place.
export function writeCredentials(entries, file = CREDENTIALS_FILE) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(entries, null, 4)}\n`, { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, file);
    } catch (error) {
        fs.rmSync(temporary, { force: true });
        throw error;
    }
}

export function cloudCredentials(url, file = CREDENTIALS_FILE) {
    const entries = readCredentials(file);
    return Object.hasOwn(entries, url) ? entries[url] : null;
}

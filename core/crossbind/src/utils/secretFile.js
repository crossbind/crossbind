import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let folder = null;

// Removes the folder of the secrets written, as crossbind does when it exits.
export function removeSecretFiles() {
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    folder = null;
}

// A secret the environment holds as its text, as CI's secrets come, written to a file of a folder only this user opens,
// as the tools that take it read files. The folder goes when crossbind exits.
export function secretFile(name, data) {
    if (!folder) {
        folder = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-secrets-'));
        process.once('exit', removeSecretFiles);
    }
    const file = path.join(folder, name);
    fs.writeFileSync(file, data, { mode: 0o600 });
    return file;
}

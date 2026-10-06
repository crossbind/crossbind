import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { sha256Of } from './files.js';

const SHA256 = /^[0-9a-f]{64}$/;

export const isHash = (value) => typeof value === 'string' && SHA256.test(value);

// Content-addressed: a blob is stored under its sha256, and an upload whose bytes hash to something else is dropped.
export function createBlobStore(dir) {
    fs.mkdirSync(dir, { recursive: true });

    const pathOf = (hash) => {
        if (!isHash(hash)) throw new Error(`crossbind runner: "${hash}" is not a sha256 digest`);
        return path.join(dir, hash);
    };

    const has = (hash) => isHash(hash) && fs.existsSync(path.join(dir, hash));

    async function putStream(hash, stream) {
        const temp = path.join(dir, `.${hash}.${process.pid}.${crypto.randomUUID()}`);
        const digest = crypto.createHash('sha256');
        await pipeline(stream, async function* hashing(source) {
            for await (const chunk of source) {
                digest.update(chunk);
                yield chunk;
            }
        }, fs.createWriteStream(temp));
        if (digest.digest('hex') !== hash) {
            fs.rmSync(temp, { force: true });
            return false;
        }
        fs.renameSync(temp, pathOf(hash));
        return true;
    }

    function putBuffer(data) {
        const hash = sha256Of(data);
        if (!has(hash)) fs.writeFileSync(pathOf(hash), data);
        return hash;
    }

    return { pathOf, has, putStream, putBuffer };
}

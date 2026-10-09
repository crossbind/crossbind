import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { sha256Of } from './files.js';

const SHA256 = /^[0-9a-f]{64}$/;
const UPLOAD_ID = /^[\w-]{8,64}$/;
// A part nobody added to for an hour belongs to an upload that stopped; the disk may be memory (Cloud Run).
const STALE_PART_MS = 60 * 60 * 1000;

export const isHash = (value) => typeof value === 'string' && SHA256.test(value);
export const isUploadId = (value) => typeof value === 'string' && UPLOAD_ID.test(value);

// Content-addressed: a blob is stored under its sha256, and an upload whose bytes hash to something else is dropped.
export function createBlobStore(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const root = `${path.resolve(dir)}${path.sep}`;

    const pathOf = (hash) => {
        if (!isHash(hash)) throw new Error(`crossbind runner: "${hash}" is not a sha256 digest`);
        return path.join(dir, hash);
    };

    const has = (hash) => isHash(hash) && fs.existsSync(path.join(dir, hash));

    async function putStream(hash, stream) {
        const temp = path.join(dir, `.${hash}.${process.pid}.${crypto.randomUUID()}`);
        const digest = crypto.createHash('sha256');
        const output = fs.createWriteStream(temp);
        try {
            await pipeline(stream, async function* hashing(source) {
                for await (const chunk of source) {
                    digest.update(chunk);
                    yield chunk;
                }
            }, output);
        } catch (error) {
            // pipeline settles before a file that is still opening closes; removed earlier, it would come back.
            if (!output.closed) await new Promise((resolve) => { output.once('close', resolve); });
            fs.rmSync(temp, { force: true });
            throw error;
        }
        if (digest.digest('hex') !== hash) {
            fs.rmSync(temp, { force: true });
            return false;
        }
        fs.renameSync(temp, pathOf(hash));
        return true;
    }

    function dropStaleParts() {
        const now = Date.now();
        for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.part'))) {
            const stat = fs.statSync(path.join(dir, name), { throwIfNoEntry: false });
            if (stat && now - stat.mtimeMs > STALE_PART_MS) fs.rmSync(path.join(dir, name), { force: true });
        }
    }

    // A request names the part file, so its path is checked to stay in the store.
    const partOf = (hash, upload) => {
        const file = path.resolve(root, `.${hash}.${upload}.part`);
        if (!file.startsWith(root)) throw new Error(`crossbind runner: "${hash}" and "${upload}" name no part in the store`);
        return file;
    };

    // A blob too large for one request arrives in parts, in order and under the id of its upload; the last part
    // checks the joined file against the hash. A part that breaks off leaves the ones before it, so the client sends
    // that part again, and a part of a blob already joined answers as stored, since the last answer may have been lost.
    async function writePart(hash, upload, { start, end, total }, stream) {
        if (!isUploadId(upload)) throw new Error(`crossbind runner: "${upload}" is not an upload id`);
        if (has(hash)) {
            for await (const chunk of stream) void chunk;
            return { status: 'stored' };
        }
        if (start === 0) dropStaleParts();
        const partial = partOf(hash, upload);
        const received = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
        if (start !== received) return { status: 'gap', received };
        const restore = () => {
            if (start === 0) fs.rmSync(partial, { force: true });
            else if (fs.existsSync(partial)) fs.truncateSync(partial, start);
        };
        let length = 0;
        const output = fs.createWriteStream(partial, { flags: 'a' });
        try {
            await pipeline(stream, async function* counting(source) {
                for await (const chunk of source) {
                    length += chunk.length;
                    yield chunk;
                }
            }, output);
        } catch (error) {
            if (!output.closed) await new Promise((resolve) => { output.once('close', resolve); });
            restore();
            throw error;
        }
        if (length !== end - start + 1) {
            restore();
            return { status: 'short' };
        }
        if (end + 1 < total) return { status: 'partial', received: end + 1 };
        const digest = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(partial)) digest.update(chunk);
        const joined = digest.digest('hex');
        if (joined !== hash) {
            fs.rmSync(partial, { force: true });
            return { status: 'mismatch' };
        }
        fs.renameSync(partial, pathOf(joined));
        return { status: 'stored' };
    }

    // The parts of one upload go one at a time: a part whose connection broke off can still be writing when the client
    // sends it again.
    const writing = new Map();
    function putPart(hash, upload, range, stream) {
        const key = `${hash}.${upload}`;
        const current = (writing.get(key) ?? Promise.resolve()).catch(() => {}).then(() => writePart(hash, upload, range, stream));
        writing.set(key, current);
        const forget = () => {
            if (writing.get(key) === current) writing.delete(key);
        };
        current.then(forget, forget);
        return current;
    }

    function putBuffer(data) {
        const hash = sha256Of(data);
        if (!has(hash)) fs.writeFileSync(pathOf(hash), data);
        return hash;
    }

    return { pathOf, has, putStream, putPart, putBuffer };
}

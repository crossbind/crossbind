import fs from 'node:fs';
import path from 'node:path';

// Raw bytes per upload request, a batch of small files or a part of a large one. With base64 a batch stays below the
// 32 MiB a Cloud Run request may carry, and a part below Cloudflare's 100 MB as well.
const UPLOAD_BATCH_BYTES = 16 * 1024 * 1024;
// The first runner protocol that joins a file sent in parts.
const PARTS_PROTOCOL = 2;
const MB = 1024 * 1024;
// A long upload to a hosted runner now and then loses its connection: a request goes again this many times, waiting a
// second longer each time.
const UPLOAD_RETRIES = 4;
const RETRY_DELAY_MS = 1000;
// Failures before a connection opened, such as a name lookup that failed for a moment: the request never reached the
// runner, so it goes again this many times. After a connection opened it never does, since a step may have started.
const UNSENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
const UNSENT_RETRIES = 2;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export async function request(url, route, init = {}) {
    const token = process.env.CROSSBIND_TOKEN;
    const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers };
    for (let attempt = 1; ; attempt += 1) {
        try {
            // A redirect would send the request, sources included, to an address nobody configured.
            return await fetch(`${url}${route}`, { ...init, headers, redirect: 'error' });
        } catch (error) {
            if (!UNSENT_CODES.has(error.cause?.code) || attempt > UNSENT_RETRIES) {
                throw new Error(`crossbind: the remote runner at ${url} is unreachable (${error.cause?.code ?? error.message}).`, { cause: error });
            }
            await wait(RETRY_DELAY_MS * attempt);
        }
    }
}

export async function expectOk(response, what) {
    if (response.ok) return response.json();
    const body = await response.json().catch(() => ({}));
    throw new Error(`crossbind: the remote runner failed ${what}: ${body.error ?? response.status}.`);
}

async function requestWithRetries(url, route, init) {
    for (let attempt = 1; ; attempt += 1) {
        const response = await request(url, route, init).catch((error) => error);
        const failed = response instanceof Error || response.status >= 500;
        if (!failed || attempt > UPLOAD_RETRIES) {
            if (response instanceof Error) throw response;
            return response;
        }
        await wait(RETRY_DELAY_MS * attempt);
    }
}

async function runnerProtocol(url) {
    const health = await expectOk(await request(url, '/v1/health'), 'to answer its health check');
    return health.protocol ?? 1;
}

// One request per part, in order; the runner checks the joined file against its hash. After a part whose connection
// dropped, the upload goes on from where the runner says it stands. The upload is named after the file, so a later
// attempt, or another client sending the same file, goes on with what the runner holds.
async function uploadInParts(url, hash, file, total, partBytes) {
    const upload = hash.slice(0, 32);
    const fd = fs.openSync(file, 'r');
    let resumes = 0;
    try {
        for (let start = 0; start < total;) {
            const part = Buffer.alloc(Math.min(partBytes, total - start));
            fs.readSync(fd, part, 0, part.length, start);
            const response = await requestWithRetries(url, `/v1/blobs/${hash}`, {
                method: 'PUT',
                body: part,
                headers: { 'content-range': `bytes ${start}-${start + part.length - 1}/${total}`, 'x-crossbind-upload': upload },
            });
            if (response.status === 413) {
                throw new Error(`crossbind: the remote runner at ${url} took no part of ${path.basename(file)}: it refused a part of ${part.length} bytes, so the proxy in front of it takes less in one request.`);
            }
            if (response.status === 409 && resumes < UPLOAD_RETRIES) {
                const { received } = await response.json();
                if (!Number.isSafeInteger(received) || received < 0 || received >= total) throw new Error(`crossbind: the remote runner holds ${received} bytes of ${path.basename(file)}, which has ${total}.`);
                resumes += 1;
                start = received;
                continue;
            }
            const answer = await expectOk(response, `to receive ${path.basename(file)}`);
            if (response.status === 201) return;
            start = answer.received;
        }
    } finally {
        fs.closeSync(fd);
    }
}

// A runner deployed before uploads in parts takes a large file in one request, which a body limit in front of it refuses.
async function uploadWhole(url, hash, file, total) {
    const response = await request(url, `/v1/blobs/${hash}`, { method: 'PUT', body: fs.readFileSync(file) });
    if (response.status === 413) {
        throw new Error(`crossbind: the remote runner at ${url} refused ${path.basename(file)} (${Math.ceil(total / MB)} MB) as too large for one request; deploy the runner again with this crossbind version, which sends large files in parts.`);
    }
    await expectOk(response, `to receive ${path.basename(file)}`);
}

// `sources` maps each hash to a file holding it; only what the runner lacks travels, small files in a few batches and a
// large one on its own.
export async function uploadMissing(url, sources, partBytes = UPLOAD_BATCH_BYTES) {
    const listing = await request(url, '/v1/missing', { method: 'POST', body: JSON.stringify({ hashes: [...sources.keys()] }) });
    const { missing } = await expectOk(listing, 'to list the files it lacks');
    let protocol;
    let batch = [];
    let size = 0;
    const flush = async () => {
        if (batch.length === 0) return;
        const body = batch.map(({ hash, data }) => JSON.stringify({ sha256: hash, data: data.toString('base64') })).join('\n');
        await expectOk(await requestWithRetries(url, '/v1/blobs', { method: 'POST', body }), `to receive ${batch.length} files`);
        batch = [];
        size = 0;
    };
    for (const hash of missing) {
        const file = sources.get(hash);
        const fileSize = fs.statSync(file).size;
        if (fileSize > partBytes) {
            protocol ??= await runnerProtocol(url);
            if (protocol >= PARTS_PROTOCOL) await uploadInParts(url, hash, file, fileSize, partBytes);
            else await uploadWhole(url, hash, file, fileSize);
            continue;
        }
        const data = fs.readFileSync(file);
        if (size > 0 && size + data.length > partBytes) await flush();
        batch.push({ hash, data });
        size += data.length;
    }
    await flush();
}

import path from 'node:path';
import fs, { mkdirSync } from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import logger from './logger.js';

// Upstream hosts drop a request now and then (ftp.gnu.org refused eight parallel libiconv fetches at once), so a
// request that failed for a passing reason is tried again after these pauses. Any other 4xx is the server's answer.
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const RETRYABLE_STATUS = new Set([408, 429]);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const retryable = (error) => Object.assign(error, { retryable: true });

export default async function downloadAndExtractFile(url, output, sha256, options = {}) {
    const archive = path.basename(url);
    if (fs.existsSync(`${output}/source`) && sourceCameFrom(output, archive)) {
        return false;
    }
    fs.rmSync(`${output}/source`, { recursive: true, force: true });
    const filePath = await downloadFile(url, output, options);
    verifyIntegrity(filePath, url, sha256);
    extractArchive(filePath, url, output);
    fs.writeFileSync(`${output}/source.archive`, archive);
    return true;
}

// A cached source tree only counts when it came from the archive the recipe names now, or a
// nativeVersion bump would keep compiling the old tree. Trees from before the marker are judged
// by the archive that was downloaded next to them.
function sourceCameFrom(output, archive) {
    const marker = `${output}/source.archive`;
    if (fs.existsSync(marker)) return fs.readFileSync(marker, 'utf8').trim() === archive;
    return fs.existsSync(`${output}/${archive}`);
}

// Extraction runs through the system tar (GNU tar and bsdtar both detect gzip/bzip2/xz, and
// every platform the engine builds on ships one). Extracting into a scratch directory keeps
// the archive from choosing where its files land, and gives the upstream root folder - which
// recipes address as build/source - one place to be renamed from.
function extractArchive(filePath, url, output) {
    const work = `${output}/.extract`;
    fs.rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    try {
        const tar = spawnSync('tar', ['-xf', filePath, '-C', work], { encoding: 'utf8' });
        if (tar.error) {
            throw new Error(`crossbind: cannot run tar to extract ${filePath}: ${tar.error.message}`);
        }
        if (tar.status !== 0) {
            throw new Error(`crossbind: extracting ${filePath} (from ${url}) failed: ${(tar.stderr || '').trim() || `tar exited ${tar.status}`}`);
        }
        const entries = fs.readdirSync(work, { withFileTypes: true });
        if (entries.length === 0) {
            throw new Error(`crossbind: downloaded archive ${filePath} is empty or not a supported archive (from ${url}).`);
        }
        // Release tarballs carry one root folder; anything else is treated as the root itself.
        const root = entries.length === 1 && entries[0].isDirectory() ? `${work}/${entries[0].name}` : work;
        fs.renameSync(root, `${output}/source`);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

// Verifies the downloaded archive against the sha256 pinned in the build recipe. A missing pin
// is skipped (packages are pinned incrementally; check:sources flags the gaps); a MISMATCH
// refuses the build, so a hijacked mirror or a re-tagged upstream cannot feed arbitrary C++ to
// the compiler.
export function verifyIntegrity(filePath, url, sha256) {
    if (!sha256) return;
    const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (actual !== String(sha256).toLowerCase()) {
        fs.rmSync(filePath, { force: true });
        throw new Error(
            `crossbind: source integrity check failed for ${url}\n`
            + `  expected sha256: ${sha256}\n`
            + `  actual   sha256: ${actual}\n`
            + 'Refusing to build. If you intentionally bumped nativeVersion, update the recipe sha256.',
        );
    }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// What lands here is compiled, so it may not arrive over a connection anyone can rewrite.
// Loopback is exempt so tests can serve fixtures without a certificate.
export function assertHttps(target, context = target) {
    const { protocol, hostname } = new URL(target);
    if (protocol !== 'https:' && !LOOPBACK.has(hostname)) {
        throw new Error(`crossbind: refusing to download ${context} over ${protocol}// - upstream sources must come over https.`);
    }
}

// fetch follows redirects itself, which release downloads rely on (github and the osgeo
// mirrors both bounce), so the download needs no redirect library of its own.
export async function downloadFile(url, folder, { retryDelaysMs = RETRY_DELAYS_MS } = {}) {
    mkdirSync(folder, { recursive: true });
    const dest = `${folder}/${path.basename(url)}`;
    if (fs.existsSync(dest)) return dest;

    assertHttps(url);
    for (let attempt = 1; ; attempt += 1) {
        try {
            await fetchTo(url, dest);
            return dest;
        } catch (err) {
            if (!err.retryable) throw err;
            if (attempt > retryDelaysMs.length) {
                throw new Error(`${err.message} (after ${attempt} attempts)`, { cause: err });
            }
            const delay = retryDelaysMs[attempt - 1];
            logger.info(`${err.message} Trying again in ${delay / 1000}s…`);
            await sleep(delay);
        }
    }
}

async function fetchTo(url, dest) {
    let response;
    try {
        response = await fetch(url, { headers: { 'User-Agent': 'curl/8.7.1' }, redirect: 'follow' });
    } catch (err) {
        throw retryable(new Error(`crossbind: cannot reach ${url}: ${err.message}`, { cause: err }));
    }
    // A redirect chain must not be able to downgrade the transport on its last hop.
    if (response.url) assertHttps(response.url, `${url} (redirected to ${response.url})`);
    if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(`crossbind: download failed for ${url} — HTTP ${response.status}.`);
        throw response.status >= 500 || RETRYABLE_STATUS.has(response.status) ? retryable(error) : error;
    }
    try {
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(dest));
    } catch (err) {
        // A half-written archive would fail its hash check later with a confusing message.
        fs.rmSync(dest, { force: true });
        throw retryable(new Error(`crossbind: download failed for ${url}: ${err.message}`, { cause: err }));
    }
}

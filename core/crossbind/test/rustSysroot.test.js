import {
    describe, test, expect, beforeEach, afterEach, vi,
} from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import ensureRustSysroot, { assertManifest, sysrootPath } from '../src/utils/rustSysroot.js';

// A host build links against whatever this returns, and it comes off the network, so these tests
// drive the real flow against a real (tiny) registry: the token challenge, the index, the platform
// manifest, the blob. The value of this path is entirely in what it refuses, and every refusal here
// is a way a tampered or mismatched sysroot could otherwise reach a compiler.
const HOST = { version: '1.97.1', commit: '0'.repeat(40) };
const TARGET = 'wasm32-unknown-emscripten';
const ARCH = 'arm64';

const manifestFor = (over = {}) => ({
    schema: 1,
    rustc: HOST.version,
    rustcCommit: HOST.commit,
    emsdk: '6.0.2',
    target: TARGET,
    panic: 'abort',
    variants: { st: { targetFeatures: [] }, mt: { targetFeatures: ['atomics', 'bulk-memory', 'mutable-globals'] } },
    ...over,
});

let work;
let server;
let requests;

const digestOf = (buf) => `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;

// The layer is an image filesystem export: the tree lives at opt/crossbind/rust/<version>.
function buildLayer(manifest = manifestFor()) {
    const stage = fs.mkdtempSync(path.join(work, 'stage-'));
    const tree = path.join(stage, 'opt', 'crossbind', 'rust', manifest.rustc ?? '1.97.1');
    for (const variant of ['st', 'mt']) {
        const lib = path.join(tree, variant, 'lib', 'rustlib', TARGET, 'lib');
        fs.mkdirSync(lib, { recursive: true });
        fs.writeFileSync(path.join(lib, 'libstd-0123456789abcdef.rlib'), variant);
    }
    fs.writeFileSync(path.join(tree, 'manifest.json'), JSON.stringify(manifest));
    const tar = path.join(work, `layer-${crypto.randomUUID()}.tar`);
    execFileSync('tar', ['-cf', tar, '-C', stage, 'opt']);
    return zlib.gzipSync(fs.readFileSync(tar));
}

// Just enough of an OCI registry to exercise the chain the loader verifies.
function serveRegistry({ layer, corruptLayer = false, arches = [ARCH] } = {}) {
    const blob = layer ?? buildLayer();
    const layerDigest = digestOf(blob);
    const bodies = new Map();

    const platformManifests = arches.map((arch) => {
        const body = Buffer.from(JSON.stringify({
            schemaVersion: 2,
            mediaType: 'application/vnd.oci.image.manifest.v1+json',
            config: { digest: digestOf(Buffer.from('{}')), size: 2 },
            layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: layerDigest, size: blob.length }],
        }));
        const digest = digestOf(body);
        bodies.set(digest, body);
        return { digest, size: body.length, platform: { os: 'linux', architecture: arch } };
    });

    const indexBody = Buffer.from(JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.index.v1+json',
        manifests: platformManifests,
    }));
    const indexDigest = digestOf(indexBody);
    bodies.set(indexDigest, indexBody);

    return new Promise((resolve) => {
        server = http.createServer((req, res) => {
            requests.push({ url: req.url, auth: req.headers.authorization ?? null });
            const port = server.address().port;
            if (req.url === '/v2/') {
                res.writeHead(401, { 'www-authenticate': `Bearer realm="http://127.0.0.1:${port}/token",service="test"` });
                return res.end();
            }
            if (req.url.startsWith('/token')) {
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ token: 'test-token' }));
            }
            const manifest = req.url.match(/^\/v2\/ns\/repo\/manifests\/(.+)$/);
            if (manifest && bodies.has(manifest[1])) {
                res.writeHead(200, { 'content-type': 'application/vnd.oci.image.index.v1+json' });
                return res.end(bodies.get(manifest[1]));
            }
            if (req.url === `/v2/ns/repo/blobs/${layerDigest}`) {
                res.writeHead(200, { 'content-type': 'application/octet-stream' });
                return res.end(corruptLayer ? Buffer.concat([blob, Buffer.from('x')]) : blob);
            }
            res.writeHead(404);
            return res.end();
        });
        server.listen(0, '127.0.0.1', () => resolve({
            image: `127.0.0.1:${server.address().port}/ns/repo`,
            index: indexDigest,
            layerDigest,
        }));
    });
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-sysroot-'));
    requests = [];
});

afterEach(async () => {
    if (server) await new Promise((resolve) => { server.close(resolve); });
    server = null;
    fs.rmSync(work, { recursive: true, force: true });
    vi.restoreAllMocks();
});

// The loader talks https in production; these tests need plain http against a local port. The real
// fetch is captured once, or the wrapper would call itself.
const NATIVE_FETCH = globalThis.fetch;
const overHttp = (input, init) => NATIVE_FETCH(String(input).replace('https://', 'http://'), init);

describe('ensureRustSysroot', () => {
    beforeEach(() => { globalThis.fetch = overHttp; });
    afterEach(() => { globalThis.fetch = NATIVE_FETCH; });

    test('fetches, verifies and lands a complete tree keyed by the pinned index digest', async () => {
        const { image, index } = await serveRegistry();
        const root = path.join(work, 'cache');

        const dir = await ensureRustSysroot({
            image, index, root, host: HOST, arch: ARCH,
        });

        expect(dir).toBe(path.join(root, index.replace(':', '-')));
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).target).toBe(TARGET);
        expect(fs.existsSync(sysrootPath(dir, 'st'))).toBe(true);
        expect(fs.existsSync(sysrootPath(dir, 'mt'))).toBe(true);
        // Nothing half-written is left behind for the next run to trip over.
        expect(fs.readdirSync(root).filter((e) => e.startsWith('.staging-'))).toEqual([]);
    });

    test('refuses an index whose bytes do not hash to the pin', async () => {
        // The pin is the only thing trusted a priori; if the registry contradicts it, everything
        // below it is unauthenticated too.
        const { image } = await serveRegistry();
        const wrong = `sha256:${'b'.repeat(64)}`;
        const root = path.join(work, 'cache');

        await expect(ensureRustSysroot({
            image, index: wrong, root, host: HOST, arch: ARCH,
        })).rejects.toThrow(/HTTP 404|contradicted its own digest/);
        expect(fs.existsSync(path.join(root, wrong.replace(':', '-')))).toBe(false);
    });

    test('refuses a layer whose bytes do not match the digest the manifest named', async () => {
        const { image, index } = await serveRegistry({ corruptLayer: true });
        const root = path.join(work, 'cache');

        await expect(ensureRustSysroot({
            image, index, root, host: HOST, arch: ARCH,
        })).rejects.toThrow(/hashed to sha256:.*expected/);
        expect(fs.existsSync(path.join(root, index.replace(':', '-')))).toBe(false);
    });

    test('refuses an artifact built by a different compiler', async () => {
        const { image, index } = await serveRegistry({ layer: buildLayer(manifestFor({ rustcCommit: 'f'.repeat(40) })) });
        const root = path.join(work, 'cache');

        await expect(ensureRustSysroot({
            image, index, root, host: HOST, arch: ARCH,
        })).rejects.toThrow(/different compiler/);
    });

    test('refuses an artifact missing a variant', async () => {
        const layer = buildLayer(manifestFor({ variants: { st: { targetFeatures: [] } } }));
        const { image, index } = await serveRegistry({ layer });
        const root = path.join(work, 'cache');

        await expect(ensureRustSysroot({
            image, index, root, host: HOST, arch: ARCH,
        })).rejects.toThrow(/missing the 'mt' variant/);
    });

    test('picks the leaf built for this machine', async () => {
        const { image, index } = await serveRegistry({ arches: ['amd64', ARCH] });
        const root = path.join(work, 'cache');

        await ensureRustSysroot({
            image, index, root, host: HOST, arch: ARCH,
        });

        // Exactly one platform manifest was fetched: the wrong architecture is never even read.
        const manifests = requests.filter((r) => r.url.includes('/manifests/') && !r.url.endsWith(index));
        expect(manifests).toHaveLength(1);
    });

    test('says so when the index carries no leaf for this machine', async () => {
        const { image, index } = await serveRegistry({ arches: ['amd64'] });
        await expect(ensureRustSysroot({
            image, index, root: path.join(work, 'cache'), host: HOST, arch: 'riscv64',
        })).rejects.toThrow(/no linux\/riscv64/);
    });

    test('serves the second build from cache without fetching again', async () => {
        const { image, index } = await serveRegistry();
        const root = path.join(work, 'cache');
        await ensureRustSysroot({
            image, index, root, host: HOST, arch: ARCH,
        });
        const first = requests.length;

        await ensureRustSysroot({
            image, index, root, host: HOST, arch: ARCH,
        });

        expect(requests.length).toBe(first);
    });

    test('two concurrent builds fetch once and both get the tree', async () => {
        const { image, index, layerDigest } = await serveRegistry();
        const root = path.join(work, 'cache');

        const [a, b] = await Promise.all([
            ensureRustSysroot({
                image, index, root, host: HOST, arch: ARCH,
            }),
            ensureRustSysroot({
                image, index, root, host: HOST, arch: ARCH,
            }),
        ]);

        expect(a).toBe(b);
        expect(requests.filter((r) => r.url.endsWith(layerDigest))).toHaveLength(1);
    });

    test('demands a pin at all', async () => {
        await expect(ensureRustSysroot({ image: 'x/y', root: work, host: HOST }))
            .rejects.toThrow(/pinned by image and index digest/);
    });

    test('does not hand the registry credential to another host', async () => {
        // Blob downloads redirect to a CDN. A bearer token that follows the redirect is a token
        // handed to whoever the registry points at, so the header must stop at the host it was
        // issued for - and this asserts the loader does that itself rather than trusting the
        // runtime to strip it.
        const { image, index, layerDigest } = await serveRegistry();
        const other = http.createServer((req, res) => {
            requests.push({ url: `OTHER${req.url}`, auth: req.headers.authorization ?? null });
            res.writeHead(200);
            res.end(Buffer.from('not-the-layer'));
        });
        await new Promise((resolve) => { other.listen(0, '127.0.0.1', resolve); });
        const otherPort = other.address().port;

        globalThis.fetch = (input, init) => {
            const url = String(input);
            if (url.includes(`/blobs/${layerDigest}`)) {
                return Promise.resolve(new Response(null, {
                    status: 307,
                    headers: { location: `http://127.0.0.1:${otherPort}/cdn/blob` },
                }));
            }
            return overHttp(input, init);
        };

        await expect(ensureRustSysroot({
            image, index, root: path.join(work, 'cache'), host: HOST, arch: ARCH,
        })).rejects.toThrow();

        const cdn = requests.filter((r) => r.url.startsWith('OTHER'));
        expect(cdn).not.toHaveLength(0);
        expect(cdn.every((r) => r.auth === null)).toBe(true);
        await new Promise((resolve) => { other.close(resolve); });
    });
});

describe('assertManifest', () => {
    test('rejects an unsupported schema', () => {
        expect(() => assertManifest({ schema: 99 }, HOST)).toThrow(/schema 99 is not supported/);
    });

    test('accepts the current contract', () => {
        expect(() => assertManifest(manifestFor(), HOST)).not.toThrow();
    });
});

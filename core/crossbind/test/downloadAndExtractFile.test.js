import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import downloadAndExtractFile, { assertHttps } from '../src/utils/downloadAndExtractFile.js';

const sha256Of = (content) => crypto.createHash('sha256').update(content).digest('hex');

// Real archives, packed by the same tar the implementation extracts with: the upstream
// releases this code consumes are tarballs (gzip, and bzip2 for geos).
function packArchive(dest, { compression = 'z', root = 'pkg-1.0' } = {}) {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-fixture-'));
    fs.mkdirSync(path.join(staging, root), { recursive: true });
    fs.writeFileSync(path.join(staging, root, 'lib.c'), 'int answer(void) { return 42; }\n');
    execFileSync('tar', [`-c${compression}f`, dest, '-C', staging, root]);
    fs.rmSync(staging, { recursive: true, force: true });
    return fs.readFileSync(dest);
}

// A real server: release downloads are redirected (github, the osgeo mirrors), and following
// them is exactly what the download path has to get right on its own.
function startServer(archive) {
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/redirect/')) {
            res.writeHead(302, { Location: '/downloads/pkg-1.0.tar.gz' });
            res.end();
        } else if (req.url === '/downloads/pkg-1.0.tar.gz') {
            res.writeHead(200, { 'Content-Type': 'application/gzip' });
            res.end(archive);
        } else {
            res.writeHead(404);
            res.end('nope');
        }
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

describe('downloadAndExtractFile', () => {
    let output;

    beforeEach(() => {
        output = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-download-'));
    });

    afterEach(() => {
        fs.rmSync(output, { recursive: true, force: true });
    });

    test('keeps a cached source that came from the requested archive', async () => {
        fs.mkdirSync(path.join(output, 'source'));
        fs.writeFileSync(path.join(output, 'source.archive'), 'pkg-1.0.tar.gz');

        await expect(downloadAndExtractFile('http://127.0.0.1:1/downloads/pkg-1.0.tar.gz', output)).resolves.toBe(false);
    });

    test('keeps a cached source from before the marker when its archive sits next to it', async () => {
        fs.mkdirSync(path.join(output, 'source'));
        packArchive(path.join(output, 'pkg-1.0.tar.gz'));

        await expect(downloadAndExtractFile('http://127.0.0.1:1/downloads/pkg-1.0.tar.gz', output)).resolves.toBe(false);
    });

    test('replaces a cached source when the recipe names another archive', async () => {
        fs.mkdirSync(path.join(output, 'source'));
        fs.writeFileSync(path.join(output, 'source/lib.c'), 'stale');
        fs.writeFileSync(path.join(output, 'source.archive'), 'pkg-0.9.tar.gz');
        const staged = path.join(output, 'staged.tar.gz');
        const archive = packArchive(staged);
        fs.rmSync(staged);
        const { server, port } = await startServer(archive);
        try {
            const url = `http://127.0.0.1:${port}/downloads/pkg-1.0.tar.gz`;
            await expect(downloadAndExtractFile(url, output, sha256Of(archive))).resolves.toBe(true);
            expect(fs.readFileSync(path.join(output, 'source/lib.c'), 'utf8')).toContain('answer');
            expect(fs.readFileSync(path.join(output, 'source.archive'), 'utf8')).toBe('pkg-1.0.tar.gz');
        } finally {
            server.close();
        }
    });

    test('reuses an already-downloaded archive instead of re-fetching it', async () => {
        const archive = packArchive(path.join(output, 'pkg-1.0.tar.gz'));

        await expect(downloadAndExtractFile('http://127.0.0.1:1/downloads/pkg-1.0.tar.gz', output, sha256Of(archive)))
            .resolves.toBe(true);
        expect(fs.readFileSync(path.join(output, 'source/lib.c'), 'utf8')).toContain('answer');
    });

    test('downloads, verifies the pin, and extracts to source', async () => {
        const staged = path.join(output, 'staged.tar.gz');
        const archive = packArchive(staged);
        fs.rmSync(staged);
        const { server, port } = await startServer(archive);
        try {
            const url = `http://127.0.0.1:${port}/downloads/pkg-1.0.tar.gz`;
            await expect(downloadAndExtractFile(url, output, sha256Of(archive))).resolves.toBe(true);
            expect(fs.readFileSync(path.join(output, 'pkg-1.0.tar.gz'))).toEqual(archive);
            expect(fs.existsSync(path.join(output, 'source/lib.c'))).toBe(true);
        } finally {
            server.close();
        }
    });

    test('follows redirects', async () => {
        const staged = path.join(output, 'staged.tar.gz');
        const archive = packArchive(staged);
        fs.rmSync(staged);
        const { server, port } = await startServer(archive);
        try {
            const url = `http://127.0.0.1:${port}/redirect/pkg-1.0.tar.gz`;
            await expect(downloadAndExtractFile(url, output, sha256Of(archive))).resolves.toBe(true);
            expect(fs.existsSync(path.join(output, 'source/lib.c'))).toBe(true);
        } finally {
            server.close();
        }
    });

    test('refuses an archive whose hash does not match the recipe pin', async () => {
        const staged = path.join(output, 'staged.tar.gz');
        const archive = packArchive(staged);
        fs.rmSync(staged);
        const { server, port } = await startServer(archive);
        try {
            const url = `http://127.0.0.1:${port}/downloads/pkg-1.0.tar.gz`;
            await expect(downloadAndExtractFile(url, output, sha256Of('something else')))
                .rejects.toThrow(/source integrity check failed/);
            expect(fs.existsSync(path.join(output, 'source'))).toBe(false);
        } finally {
            server.close();
        }
    });

    test('extracts bzip2 tarballs too', async () => {
        const dest = path.join(output, 'pkg-1.0.tar.bz2');
        const archive = packArchive(dest, { compression: 'j' });

        await expect(downloadAndExtractFile('http://127.0.0.1:1/downloads/pkg-1.0.tar.bz2', output, sha256Of(archive)))
            .resolves.toBe(true);
        expect(fs.existsSync(path.join(output, 'source/lib.c'))).toBe(true);
    });

    test('renames the archive root to source rather than trusting the archive paths', async () => {
        const archive = packArchive(path.join(output, 'pkg-1.0.tar.gz'), { root: 'some-other-name-2.3' });

        await expect(downloadAndExtractFile('http://127.0.0.1:1/downloads/pkg-1.0.tar.gz', output, sha256Of(archive)))
            .resolves.toBe(true);
        expect(fs.existsSync(path.join(output, 'source/lib.c'))).toBe(true);
        expect(fs.existsSync(path.join(output, 'some-other-name-2.3'))).toBe(false);
        expect(fs.existsSync(path.join(output, '.extract'))).toBe(false);
    });

    test('throws when the downloaded file is not an archive', async () => {
        fs.writeFileSync(path.join(output, 'pkg-1.0.tar.gz'), 'not an archive');

        await expect(downloadAndExtractFile('http://127.0.0.1:1/downloads/pkg-1.0.tar.gz', output, sha256Of('not an archive')))
            .rejects.toThrow(/extracting .* failed/);
        expect(fs.existsSync(path.join(output, 'source'))).toBe(false);
    });

    test('rejects with the HTTP status on a non-2xx response', async () => {
        const { server, port } = await startServer(Buffer.alloc(0));
        try {
            await expect(downloadAndExtractFile(`http://127.0.0.1:${port}/missing.tar.gz`, output))
                .rejects.toThrow(/HTTP 404/);
        } finally {
            server.close();
        }
    });

    test('rejects when the host cannot be reached', async () => {
        await expect(downloadAndExtractFile('http://127.0.0.1:1/pkg-1.0.tar.gz', output))
            .rejects.toThrow(/cannot reach/);
    });

    test('refuses a remote source served over plain http, before any request goes out', async () => {
        await expect(downloadAndExtractFile('http://mirror.example.invalid/pkg-1.0.tar.gz', output))
            .rejects.toThrow(/must come over https/);
        expect(fs.existsSync(path.join(output, 'pkg-1.0.tar.gz'))).toBe(false);
    });
});

describe('assertHttps', () => {
    test('accepts https', () => {
        expect(() => assertHttps('https://download.osgeo.org/proj/proj-9.8.1.tar.gz')).not.toThrow();
    });

    test('accepts loopback, which is how fixtures are served', () => {
        expect(() => assertHttps('http://127.0.0.1:8080/pkg.tar.gz')).not.toThrow();
        expect(() => assertHttps('http://localhost:8080/pkg.tar.gz')).not.toThrow();
    });

    test('refuses a redirect that downgrades the transport', () => {
        expect(() => assertHttps('http://mirror.example.invalid/pkg.tar.gz', 'https://upstream.example (redirected)'))
            .toThrow(/https:\/\/upstream.example \(redirected\) over http:\/\//);
    });
});

// Dependency-free helpers for standalone Node-API packages, safe to run in a bare Node.js container: what
// kind a package is, which addon package a machine installs, and an in-process registry for tarballs, so
// npm installs them the way it does from npmjs.org, picking each addon package by os, cpu and libc.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

const TAR_BLOCK = 512;
const INSTALL_TIMEOUT_MS = 600000;
const OUTPUT_LIMIT = 64 * 1024 * 1024;

const field = (header, start, end) => header.toString('utf8', start, end).replace(/\0[\s\S]*$/, '');

// Read in-process: a Windows runner's GNU tar takes the drive letter of a path for a remote host.
export function readTarballManifest(file) {
    const archive = zlib.gunzipSync(fs.readFileSync(file));
    let offset = 0;
    while (offset + TAR_BLOCK <= archive.length) {
        const header = archive.subarray(offset, offset + TAR_BLOCK);
        if (header.every((byte) => byte === 0)) break;
        const prefix = field(header, 345, 500);
        const name = prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100);
        const size = parseInt(field(header, 124, 136).trim() || '0', 8);
        const body = offset + TAR_BLOCK;
        if (name === 'package/package.json') return JSON.parse(archive.toString('utf8', body, body + size));
        offset = body + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    }
    throw new Error(`${file} has no package/package.json`);
}

export function tarballEntry(file) {
    return {
        file: path.basename(file),
        manifest: readTarballManifest(file),
        integrity: `sha512-${crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')}`,
    };
}

// The tarball is addressed through the host the client asked for, which differs inside a container.
export function packument(entry, host) {
    const { name, version } = entry.manifest;
    return {
        name,
        'dist-tags': { latest: version },
        versions: {
            [version]: { ...entry.manifest, dist: { tarball: `http://${host}/-/tarballs/${entry.file}`, integrity: entry.integrity } },
        },
    };
}

export function serveRegistry(entries, tarballDir) {
    const byName = new Map(entries.map((entry) => [entry.manifest.name, entry]));
    const server = http.createServer((request, response) => {
        const url = decodeURIComponent(request.url.split('?')[0]).slice(1);
        if (url.startsWith('-/tarballs/')) {
            const file = path.join(tarballDir, path.basename(url));
            if (!fs.existsSync(file)) return response.writeHead(404).end();
            response.writeHead(200, { 'content-type': 'application/octet-stream' });
            return fs.createReadStream(file).pipe(response);
        }
        const entry = byName.get(url);
        if (!entry) return response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify(packument(entry, request.headers.host)));
    });
    return new Promise((resolve) => {
        server.listen(0, '0.0.0.0', () => resolve(server));
    });
}

// The runner that builds a standalone Node-API package, or null for any other package. Its addons link the
// platform packages the Linux job built, so they build after it; the macOS addons build on a macOS
// runner, which has no Docker for SWIG, from the bridges the node runner generated.
export function nodePackageKind({ name, manifest }) {
    if (manifest.os && /\.node$/.test(manifest.main ?? '')) return manifest.os.includes('darwin') ? 'node-macos' : 'node';
    return Object.keys(manifest.optionalDependencies ?? {}).some((dependency) => dependency.startsWith(`${name}-`)) ? 'node' : null;
}

// The <platform>-<arch> of the addon package npm installs on a machine; a musl Linux reports no glibc.
export function hostAddonTarget(report, platform, arch) {
    const isMusl = platform === 'linux' && !report.header?.glibcVersionRuntime;
    return `${isMusl ? 'linuxmusl' : platform}-${arch}`;
}

// The registry answers from this process, so its clients run without blocking it.
export function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { encoding: 'utf8', maxBuffer: OUTPUT_LIMIT, timeout: INSTALL_TIMEOUT_MS, ...options }, (error, stdout, stderr) => {
            process.stdout.write(stdout);
            process.stderr.write(stderr);
            if (error) reject(error);
            else resolve(stdout);
        });
    });
}

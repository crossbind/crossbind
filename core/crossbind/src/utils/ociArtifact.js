import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Fetches one layer out of a published OCI image over plain HTTPS - no docker, no oras, no second
// copy of the bytes hosted anywhere. The sysroots already ship as an image; this is how a host
// build (RUNNER=LOCAL) reads that same object instead of a repackaged tarball.
//
// Everything is verified against the ONE pinned digest the caller supplies. The index body must
// hash to it; each descriptor inside a verified body then authenticates the next fetch, so the
// chain index -> platform manifest -> layer needs no additional hashes to trust. Content
// addressing does the work a separate sha256 would otherwise be doing by hand.

const MANIFEST_TYPES = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const digestOf = (buf) => `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;

function parseRef(image) {
    const slash = image.indexOf('/');
    if (slash === -1) throw new Error(`crossbind: '${image}' is not a <registry>/<repository> reference.`);
    return { registry: image.slice(0, slash), repository: image.slice(slash + 1) };
}

// The standard token dance: an anonymous pull gets a 401 naming the realm to ask. Following it from
// the challenge rather than hardcoding a registry's endpoint keeps this portable.
async function anonymousToken(registry, repository) {
    const probe = await fetch(`https://${registry}/v2/`, { redirect: 'follow' });
    if (probe.status !== 401) return null;
    const challenge = probe.headers.get('www-authenticate') ?? '';
    const field = (name) => challenge.match(new RegExp(`${name}="([^"]+)"`))?.[1];
    const realm = field('realm');
    if (!realm) return null;
    const url = new URL(realm);
    const service = field('service');
    if (service) url.searchParams.set('service', service);
    url.searchParams.set('scope', `repository:${repository}:pull`);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`crossbind: ${registry} refused an anonymous pull token (HTTP ${res.status}).`);
    const body = await res.json();
    return body.token ?? body.access_token ?? null;
}

// Redirects are followed by hand for one reason: a blob download is redirected to a CDN on another
// host, and the registry credential must not travel there. fetch's automatic redirect would be
// spec-compliant about this, but "the runtime probably strips it" is not something to leave to
// chance when the alternative is ten lines.
async function get(url, { token, accept }) {
    let current = url;
    for (let hop = 0; hop < 5; hop += 1) {
        const sameHost = new URL(current).host === new URL(url).host;
        const headers = {};
        if (accept) headers.Accept = accept;
        if (token && sameHost) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(current, { headers, redirect: 'manual' });
        if (res.status >= 300 && res.status < 400) {
            const next = res.headers.get('location');
            if (!next) throw new Error(`crossbind: ${current} redirected without a location header.`);
            current = new URL(next, current).toString();
            continue;
        }
        if (!res.ok) throw new Error(`crossbind: ${current} returned HTTP ${res.status}.`);
        return res;
    }
    throw new Error(`crossbind: too many redirects fetching ${url}.`);
}

async function fetchVerified(base, token, digest) {
    const res = await get(`${base}/manifests/${digest}`, { token, accept: MANIFEST_TYPES });
    const body = Buffer.from(await res.arrayBuffer());
    const got = digestOf(body);
    if (got !== digest) {
        throw new Error(`crossbind: ${base} served ${got} for ${digest} - the registry contradicted its own digest.`);
    }
    return JSON.parse(body.toString());
}

// Downloads the single layer of the platform manifest matching `arch`, streaming to `dest` while
// hashing, and refuses anything whose bytes do not match the digest the manifest named.
export default async function fetchOciLayer({
    image, index, arch, dest,
}) {
    const { registry, repository } = parseRef(image);
    const base = `https://${registry}/v2/${repository}`;
    const token = await anonymousToken(registry, repository);

    const root = await fetchVerified(base, token, index);
    const leaves = root.manifests ?? [];
    if (leaves.length === 0) throw new Error(`crossbind: ${image}@${index} is not a multi-platform index.`);
    const leaf = leaves.find((m) => m.platform?.os === 'linux' && m.platform?.architecture === arch);
    if (!leaf) {
        const have = leaves.map((m) => `${m.platform?.os}/${m.platform?.architecture}`).join(', ');
        throw new Error(`crossbind: ${image}@${index} has no linux/${arch} - it carries ${have}.`);
    }

    const manifest = await fetchVerified(base, token, leaf.digest);
    const layers = manifest.layers ?? [];
    if (layers.length !== 1) {
        throw new Error(`crossbind: expected the sysroot image to be one layer, found ${layers.length}.`);
    }
    const [layer] = layers;
    if (!/tar\+gzip$/.test(layer.mediaType ?? '')) {
        throw new Error(`crossbind: the sysroot layer is ${layer.mediaType}, expected a gzipped tar.`);
    }

    const res = await get(`${base}/blobs/${layer.digest}`, { token });
    const hash = crypto.createHash('sha256');
    await pipeline(
        Readable.fromWeb(res.body),
        async function* (source) { for await (const chunk of source) { hash.update(chunk); yield chunk; } },
        fs.createWriteStream(dest),
    );
    const got = `sha256:${hash.digest('hex')}`;
    if (got !== layer.digest) {
        fs.rmSync(dest, { force: true });
        throw new Error(`crossbind: the sysroot layer hashed to ${got}, expected ${layer.digest}.`);
    }
    return { layer: layer.digest, platform: `linux/${arch}`, size: layer.size };
}

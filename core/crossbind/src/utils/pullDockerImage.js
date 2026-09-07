import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { getContentHash } from './hash.js';

// This committed JSON is the one digest table for the CLI, release manifests and release assets.
// scripts/pin-docker-image.js replaces it from the image workflow's verified `digests` artifact.
const table = createRequire(import.meta.url)('../assets/toolchain-digests.json');
const REGISTRY = table.registry;
const IMAGE_VERSION = table.version;
const IMAGES = Object.fromEntries(
    ['web', 'android'].map((role) => [
        role,
        {
            ref: `${REGISTRY}/${role}@${table.images[role].index}`,
            amd64: `${REGISTRY}/${role}@${table.images[role].platforms['linux/amd64']}`,
        },
    ]),
);

const OVERRIDE_KEYS = { web: 'CROSSBIND_IMAGE_WEB', android: 'CROSSBIND_IMAGE_ANDROID' };

// Which image a target compiles in: wasm and wasi share the web image, ios never reaches docker.
export function imageRoleFor(target) {
    return target?.platform === 'android' ? 'android' : 'web';
}

const warned = new Set();
function warnOnce(message) {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(message);
}

// An override is one of three distinct situations, and only the first keeps the reproducibility
// guarantee: same digest from another registry, a digest the release does not ship, or a bare tag.
function resolveRef(role, expected) {
    const key = OVERRIDE_KEYS[role];
    const explicit = process.env[key];
    if (explicit) {
        if (explicit !== expected) {
            warnOnce(explicit.includes('@sha256:')
                ? `crossbind: unsupported toolchain override - ${key} pins a digest the release does not ship (${explicit}).`
                : `crossbind: mutable override - ${key} names the tag ${explicit}; the reproducibility guarantee is disabled.`);
        }
        return explicit;
    }

    const mirror = process.env.CROSSBIND_REGISTRY_MIRROR;
    const at = expected.indexOf('@');
    if (mirror && at !== -1) {
        warnOnce(`crossbind: pulling from the registry mirror ${mirror} (same digest as the release).`);
        return `${mirror.replace(/\/+$/, '')}/${expected.slice(0, at).split('/').pop()}${expected.slice(at)}`;
    }
    return expected;
}

export function getDockerImage(role = 'web', platform) {
    const image = IMAGES[role];
    if (!image) throw new Error(`crossbind: unknown docker image role "${role}".`);
    return resolveRef(role, platform === 'linux/amd64' ? image.amd64 : image.ref);
}

// One container per image: a web container carries no NDK, and android runs a forced platform.
// The version is part of the name so an image bump cannot silently reuse a container built from
// the previous toolchain.
export function getDockerContainerName(base, role = 'web') {
    return `crossbind-${IMAGE_VERSION}-${role}-${getContentHash(base)}`.replaceAll('/', '-').replaceAll(':', '-');
}

const pulledRefs = new Set();

// `docker images -q` can't resolve digest refs; `inspect` handles both.
function isImagePresent(ref) {
    try {
        execFileSync('docker', ['image', 'inspect', ref], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export default function pullDockerImage(role = 'web', platform) {
    const ref = getDockerImage(role, platform);
    if (pulledRefs.has(ref)) return;

    if (!isImagePresent(ref)) {
        console.log('');
        console.log('===========================================================');
        console.log('============= Downloading the docker image... =============');
        console.log('===========================================================');
        console.log('');
        execFileSync('docker', ['pull', ref], { stdio: 'inherit' });
        console.log('');
        console.log('===========================================================');
        console.log('');
    }

    pulledRefs.add(ref);
}

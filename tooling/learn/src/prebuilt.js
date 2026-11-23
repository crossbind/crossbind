import { servesProject } from './project.js';

// A sample's module built ahead of time, where the caller keeps it: { script, wasm, imports }, the addresses of its
// loader, its wasm and its import list. A sample with none compiles like any other code.

const BASE64_CHUNK = 0x8000;

// A module built before the samples imported their natives has no import list, so its sample compiles instead.
export const hasPrebuilt = (prebuilt) => Boolean(prebuilt?.imports);

// The sample's prebuilt module stands in for a compile while it serves the project (project.js).
export const canRunPrebuilt = (prebuilt, project, original) => servesProject(project, original) && hasPrebuilt(prebuilt);

function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
    return btoa(binary);
}

async function fetchOk(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The prebuilt sample did not load (${response.status}).`);
    return response;
}

// The loader, the wasm and the import list in the shape the playground compiler answers with: text, the bytes as
// base64, and the list as parsed JSON.
export async function loadPrebuilt({ script, wasm, imports }) {
    const [js, bytes, list] = await Promise.all([
        fetchOk(script).then((response) => response.text()),
        fetchOk(wasm).then((response) => response.arrayBuffer()),
        fetchOk(imports).then((response) => response.json()),
    ]);
    return { js, wasm: toBase64(new Uint8Array(bytes)), imports: list };
}

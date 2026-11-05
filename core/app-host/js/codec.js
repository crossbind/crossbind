// Tagged JSON for the webview channel: the values structured clone carries and JSON does not.
const TAG = '\u0001t';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Uint8Array(128);
for (let i = 0; i < 64; i += 1) B64_INDEX[B64.charCodeAt(i)] = i;

const VIEWS = {
    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
    Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView,
};

// The engine's own base64 where it has one (the page), the host's where it does not (Hermes, which interprets JS).
export function toBase64(bytes) {
    if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
    if (typeof globalThis.__host_b64encode === 'function') return globalThis.__host_b64encode(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parts = [];
    const CHUNK = 3 * 4096;
    for (let start = 0; start < bytes.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, bytes.length);
        let out = '';
        let i = start;
        for (; i + 2 < end; i += 3) {
            const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
        }
        if (i < end) {
            const n = (bytes[i] << 16) | ((i + 1 < end ? bytes[i + 1] : 0) << 8);
            out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < end ? B64[(n >> 6) & 63] : '=') + '=';
        }
        parts.push(out);
    }
    return parts.join('');
}

export function fromBase64(text) {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(text);
    if (typeof globalThis.__host_b64decode === 'function') return new Uint8Array(globalThis.__host_b64decode(text));
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    const length = (text.length / 4) * 3 - padding;
    const bytes = new Uint8Array(length);
    let o = 0;
    for (let i = 0; i < text.length; i += 4) {
        const n = (B64_INDEX[text.charCodeAt(i)] << 18) | (B64_INDEX[text.charCodeAt(i + 1)] << 12)
            | (B64_INDEX[text.charCodeAt(i + 2)] << 6) | B64_INDEX[text.charCodeAt(i + 3)];
        if (o < length) bytes[o++] = n >> 16;
        if (o < length) bytes[o++] = (n >> 8) & 255;
        if (o < length) bytes[o++] = n & 255;
    }
    return bytes;
}

export const CODEC_TAG = TAG;

// Byte arrays one after another, as a frame's body carries its attachments.
export function concatenate(views) {
    const total = views.reduce((sum, view) => sum + view.byteLength, 0);
    const body = new Uint8Array(total);
    let offset = 0;
    for (const view of views) {
        body.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), offset);
        offset += view.byteLength;
    }
    return body;
}

// `hook` sees every value first and may replace it with a tagged one of its own: a handle, an enum, an attachment.
export function pack(value, hook) {
    if (hook) {
        const replaced = hook(value);
        if (replaced !== undefined) return replaced;
    }
    const next = (item) => pack(item, hook);
    switch (typeof value) {
    case 'undefined': return { [TAG]: 'u' };
    case 'bigint': return { [TAG]: 'b', v: value.toString() };
    case 'number':
        if (Number.isNaN(value)) return { [TAG]: 'n', v: 'NaN' };
        if (!Number.isFinite(value)) return { [TAG]: 'n', v: value > 0 ? 'Infinity' : '-Infinity' };
        if (Object.is(value, -0)) return { [TAG]: 'n', v: '-0' };
        return value;
    case 'object': {
        if (value === null) return null;
        if (Array.isArray(value)) return value.map(next);
        if (value instanceof Set) return { [TAG]: 'set', v: [...value].map(next) };
        if (value instanceof Map) return { [TAG]: 'map', v: [...value].map(([key, item]) => [next(key), next(item)]) };
        if (value instanceof Date) return { [TAG]: 'date', v: value.getTime() };
        if (value instanceof ArrayBuffer) return { [TAG]: 'ab', v: toBase64(new Uint8Array(value)) };
        if (ArrayBuffer.isView(value)) {
            const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            return { [TAG]: 'view', k: value.constructor.name, v: toBase64(bytes) };
        }
        const out = {};
        for (const key of Object.keys(value)) out[key] = next(value[key]);
        return out;
    }
    // As structured clone does, which is what a worker-backed web build gives the same values.
    case 'function':
    case 'symbol': {
        const error = new Error(`${String(value)} could not be cloned`);
        error.name = 'DataCloneError';
        throw error;
    }
    default: return value;
    }
}

// `hook` turns the tags it owns back into values; it returns undefined for the codec's own tags.
export function unpack(value, hook) {
    if (value === null || typeof value !== 'object') return value;
    const next = (item) => unpack(item, hook);
    if (Array.isArray(value)) return value.map(next);
    const tag = value[TAG];
    if (tag !== undefined) {
        if (hook) {
            const replaced = hook(tag, value);
            if (replaced !== undefined) return replaced;
        }
        if (tag === 'u') return undefined;
        if (tag === 'b') return BigInt(value.v);
        if (tag === 'n') return value.v === '-0' ? -0 : Number(value.v);
        if (tag === 'set') return new Set(value.v.map(next));
        if (tag === 'map') return new Map(value.v.map(([key, item]) => [next(key), next(item)]));
        if (tag === 'date') return new Date(value.v);
        if (tag === 'ab') return fromBase64(value.v).buffer;
        if (tag === 'view') {
            const bytes = fromBase64(value.v);
            const View = VIEWS[value.k] ?? Uint8Array;
            if (View === DataView) return new DataView(bytes.buffer);
            return new View(bytes.buffer, 0, bytes.byteLength / (View.BYTES_PER_ELEMENT ?? 1));
        }
    }
    const out = {};
    for (const key of Object.keys(value)) out[key] = next(value[key]);
    return out;
}

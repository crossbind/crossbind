// What every route of the API shares: its headers, JSON answers, bounded request bodies and log lines.

// A response from this API is data, never a page: nothing in it may render, frame or be cached on the way.
export const SECURITY_HEADERS = Object.freeze({
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
});

export class BodyTooLarge extends Error {}

export const log = (entry) => console.log(JSON.stringify(entry));

export const jsonResponse = (status, body, headers = {}) => Response.json(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });

export const bearerToken = (request) => /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];

// One subscriber usually holds a whole IPv6 /64; counting single addresses would let them rotate through it.
export function networkOf(ip) {
    if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);
    if (!ip.includes(':')) return ip;
    const [head, tail] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

export async function readLimited(request, maxBytes) {
    if (Number(request.headers.get('content-length')) > maxBytes) throw new BodyTooLarge();
    const reader = request.body?.getReader();
    const chunks = [];
    let size = 0;
    for (let next = await reader?.read(); next && !next.done; next = await reader.read()) {
        size += next.value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            throw new BodyTooLarge();
        }
        chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    chunks.reduce((offset, chunk) => { bytes.set(chunk, offset); return offset + chunk.byteLength; }, 0);
    return new TextDecoder().decode(bytes);
}

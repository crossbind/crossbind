export const MAX_SOURCE_BYTES = 32 * 1024;

// One header and one source file, always under these names, so the build tree warmed in the image always
// matches the files a compile writes.
export const SOURCE_FILES = Object.freeze(['native.h', 'native.cpp']);

export class InvalidRequest extends Error {}

// Shared by the compiler (Node) and the Worker in front, which has no Buffer.
const utf8 = new TextEncoder();

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateRequest(body) {
    if (!isPlainObject(body) || Object.keys(body).length !== 1 || !isPlainObject(body.files)) {
        throw new InvalidRequest('Send {"files": {"native.h": "...", "native.cpp": "..."}}.');
    }
    const names = Object.keys(body.files);
    const unknown = names.find((name) => !SOURCE_FILES.includes(name));
    if (unknown !== undefined) {
        throw new InvalidRequest(`Only ${SOURCE_FILES.join(' and ')} compile, not ${JSON.stringify(unknown.slice(0, 40))}.`);
    }
    if (!names.includes('native.h')) {
        throw new InvalidRequest('native.h is missing: crossbind binds what the header declares.');
    }
    const texts = SOURCE_FILES.map((name) => body.files[name] ?? '');
    if (texts.some((text) => typeof text !== 'string' || text.includes('\0'))) {
        throw new InvalidRequest('Each file must be text.');
    }
    const bytes = texts.reduce((sum, text) => sum + utf8.encode(text).byteLength, 0);
    if (bytes > MAX_SOURCE_BYTES) {
        throw new InvalidRequest(`The files hold ${bytes} bytes; the limit is ${MAX_SOURCE_BYTES}.`);
    }
    return Object.freeze(Object.fromEntries(SOURCE_FILES.map((name, i) => [name, texts[i]])));
}

// A multithreaded wasm needs SharedArrayBuffer, which only a cross-origin isolated page has.
export const ISOLATION_HEADERS = Object.freeze({
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
});

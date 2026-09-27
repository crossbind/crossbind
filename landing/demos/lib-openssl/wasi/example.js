export const title = 'A checksum tool on OpenSSL';
export const summary = "WASI has no JavaScript bindings: the program is a main() that links OpenSSL, built into one .wasm and run with wasmtime. This one prints file digests in sha256sum's format with any digest OpenSSL has, checks a checksum list the way sha256sum -c does, and computes the HMAC a webhook sender signs its payload with.";
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/openssl-tool-wasi-wasm32-st-release.wasm digest sha256 notes.txt app.js',
    'wasmtime run --dir=. .crossbind/build/openssl-tool-wasi-wasm32-st-release.wasm digest sha3-256 notes.txt',
    'wasmtime run --dir=. .crossbind/build/openssl-tool-wasi-wasm32-st-release.wasm check SHA256SUMS',
    'wasmtime run --dir=. .crossbind/build/openssl-tool-wasi-wasm32-st-release.wasm hmac sha256 webhook.key payload.json',
];
export const expected = [
    '9e5005fcfe4de0d34b99f2b92e9006fa8364fff8ed5ad5721f86fd06806bcba3  notes.txt',
    '3faf44f0f523a12d45a05096b622c799f1bcedc6c4ad53e3cefa6b86e2f7a117  app.js',
    '52c0b587e1ceeac3e286ca4c3bd36f719e4c7a299274fa567d1beb10d9d7e79f  notes.txt',
    'notes.txt: OK',
    'app.js: OK',
    'c64c37be918e54b40b5a114f9d11e2578b58adfc9fd624a1d06a6f5140e539bf  payload.json',
];

// The files the commands read: release notes and a script with their SHA-256 list, as a download
// page publishes it, and a webhook payload with the secret it is signed with. shasum -a 256 and
// openssl dgst print the same digests for them.
export function input() {
    return {
        'notes.txt': 'Release 2.4.0\n- faster startup\n- the export dialog remembers its folder\n',
        'app.js': "console.log('hello from 2.4.0');\n",
        SHA256SUMS: '9e5005fcfe4de0d34b99f2b92e9006fa8364fff8ed5ad5721f86fd06806bcba3  notes.txt\n3faf44f0f523a12d45a05096b622c799f1bcedc6c4ad53e3cefa6b86e2f7a117  app.js\n',
        'payload.json': '{"event":"release.published","version":"2.4.0"}',
        'webhook.key': 'whsec_crossbind_test_key\n',
    };
}

export const title = 'A URL tool on libcurl, and the curl command itself';
export const summary =
    'WASI has no JavaScript bindings: the program is a main() that links libcurl, built into one .wasm and run with wasmtime. This one is a small trurl: it parses a URL with the flags curl uses before a transfer, follows a Location header and appends encoded query pairs, without opening a connection. For transfers, @crossbind/port-curl-standalone-wasi ships the curl command itself, which fetches over wasi:sockets with OpenSSL and verifies certificates: `npx -p @crossbind/port-curl-standalone-wasi@beta curl-wasi -sS https://example.com -o page.html`.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    "wasmtime run .crossbind/build/url-tool-wasi-wasm32-st-release.wasm 'http://example.com\\@attacker.example/'",
    "wasmtime run .crossbind/build/url-tool-wasi-wasm32-st-release.wasm https://example.com/a/b/c --follow '../d?y=2'",
    "wasmtime run .crossbind/build/url-tool-wasi-wasm32-st-release.wasm https://example.com/search --append 'q=crème brûlée & tea' --append 'sort=price+asc'",
];
export const expected = [
    'http://example.com\\@attacker.example/',
    'scheme=http user=example.com\\ host=attacker.example port=80 path=/',
    'https://example.com/a/d?y=2',
    'scheme=https host=example.com port=443 path=/a/d query=y=2',
    'https://example.com/search?q=cr%C3%A8me+br%C3%BBl%C3%A9e+%26+tea&sort=price%2Basc',
    'scheme=https host=example.com port=443 path=/search query=q=cr%C3%A8me+br%C3%BBl%C3%A9e+%26+tea&sort=price%2Basc',
];

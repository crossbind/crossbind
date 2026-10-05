import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import {
    initNative, curl_easy_init, curl_easy_perform, curl_easy_cleanup, curl_version, curl_slist_append,
    curl_slist_free_all, CURLoption, CURLINFO, CURLcode, AllSymbols, LIBCURL_VERSION, curl_easy_setopt_long,
    curl_easy_setopt_string, curl_easy_setopt_slist, curl_easy_setopt_write_function, curl_easy_getinfo_long,
    curl_easy_getinfo_offset,
} from '@crossbind/port-curl-standalone-napi';

await initNative();

// The expected values come from elsewhere: the version from package.json and the response from a server in another
// process, which answers while curl_easy_perform blocks this one and leaves when this process does.
const HTTP_OK = 200;
const TIMEOUT_SECONDS = 30;
const SERVER = `
process.stdin.on('close', () => process.exit(0)).resume();
const server = require('node:http').createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain');
    response.end(request.url + ' ' + request.headers['x-crossbind']);
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;
const { allocBuffer, readBuffer, readNumberAt, readCString, releaseCallback } = AllSymbols;
const server = spawn(process.execPath, ['-e', SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
const [portLine] = await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(([code]) => { throw new Error(`the test server exited with ${code}`); }),
]);
const port = Number(String(portLine).trim());

try {
    const curl = curl_easy_init();
    const headers = curl_slist_append(null, 'X-Crossbind: yes');
    const chunks = [];
    const onData = (data, size, count) => {
        const length = Number(size) * Number(count);
        chunks.push(Buffer.from(readBuffer(data, length)));
        return length;
    };
    assert.equal(curl_easy_setopt_string(curl, CURLoption.CURLOPT_URL, `http://127.0.0.1:${port}/check`), CURLcode.CURLE_OK);
    assert.equal(curl_easy_setopt_slist(curl, CURLoption.CURLOPT_HTTPHEADER, headers), CURLcode.CURLE_OK);
    assert.equal(curl_easy_setopt_write_function(curl, CURLoption.CURLOPT_WRITEFUNCTION, onData), CURLcode.CURLE_OK);
    // A proxy in the environment must not take the request, and a stalled transfer must not block the runner.
    assert.equal(curl_easy_setopt_string(curl, CURLoption.CURLOPT_NOPROXY, '*'), CURLcode.CURLE_OK);
    assert.equal(curl_easy_setopt_long(curl, CURLoption.CURLOPT_TIMEOUT, TIMEOUT_SECONDS), CURLcode.CURLE_OK);
    assert.equal(curl_easy_perform(curl), CURLcode.CURLE_OK);
    const body = Buffer.concat(chunks).toString();
    assert.equal(body, '/check yes');
    // A long: 8 bytes, or 4 on Windows, whose value starts the cell on these little-endian targets either way.
    const status = allocBuffer(8);
    assert.equal(curl_easy_getinfo_long(curl, CURLINFO.CURLINFO_RESPONSE_CODE, status), CURLcode.CURLE_OK);
    assert.equal(readNumberAt(status, 0, 'int32'), HTTP_OK);
    const size = allocBuffer(8);
    assert.equal(curl_easy_getinfo_offset(curl, CURLINFO.CURLINFO_SIZE_DOWNLOAD_T, size), CURLcode.CURLE_OK);
    assert.equal(Number(readNumberAt(size, 0, 'int64')), Buffer.byteLength(body));
    curl_easy_cleanup(curl);
    curl_slist_free_all(headers);
    releaseCallback(onData);
} finally {
    server.kill();
}

const versionText = readCString(curl_version());
assert.equal(LIBCURL_VERSION, process.env.NATIVE_VERSION);
assert.ok(versionText.startsWith(`libcurl/${process.env.NATIVE_VERSION} `));
assert.equal(createRequire(import.meta.url)('@crossbind/port-curl-standalone-napi').curl_easy_perform, curl_easy_perform);
console.log(`ok: ${versionText.split(' ')[0]} on ${process.platform}-${process.arch}`);

export const imports = {
    '@crossbind/port-curl/curl/urlapi.h': ['curl_url', 'curl_url_set', 'curl_url_get', 'curl_url_cleanup', 'curl_url_strerror', 'CURLUPart', 'CURLUcode'],
    '@crossbind/port-curl/curl/curl.h': ['curl_free', 'allocPointer', 'readPointerAt', 'readCString'],
};
export const note = 'The same `curl_url_set` and `curl_url_get` calls, imported from `curl/urlapi.h`: crossbind binds only what the imported header declares, so `curl/curl.h` does not bring the URL API. `curl_url_get` writes a `char *` into an `allocPointer(1)` slot, which JavaScript reads with `readPointerAt` and `readCString` and frees with `curl_free`; the `CURLU_*` flags are `#define`s the binding leaves out, so they are written as numbers. A failure is the returned `CURLUcode`, turned into text by `curl_url_strerror`, so the last line has no `std::runtime_error:` prefix.';
export const expected = [
    'https://Example.com/api/search?q=caf%C3%A9#results',
    'Example.com 443 /api/search',
    'q=café',
    'Port number was not a decimal number between 0 and 65535',
];

export default async function example({ curl_url, curl_url_set, curl_url_get, curl_url_cleanup, curl_url_strerror, CURLUPart, CURLUcode, curl_free, allocPointer, readPointerAt, readCString }, console) {
    const CURLU_DEFAULT_PORT = 1 << 0;
    const CURLU_URLDECODE = 1 << 6;
    const ok = await CURLUcode.CURLUE_OK;
    const check = async (code) => {
        if (code !== ok) throw new Error(await curl_url_strerror(code));
    };
    const url = await curl_url();
    const slot = await allocPointer(1);
    const get = async (part, flags = 0) => {
        await check(await curl_url_get(url, part, slot, flags));
        const value = await readPointerAt(slot, 0);
        const text = await readCString(value);
        await curl_free(value);
        return text;
    };

    await check(await curl_url_set(url, await CURLUPart.CURLUPART_URL, 'HTTPS://Example.com/docs/../api/search?q=caf%C3%A9#results', 0));
    console.log(await get(await CURLUPart.CURLUPART_URL));
    const host = await get(await CURLUPart.CURLUPART_HOST);
    const port = await get(await CURLUPart.CURLUPART_PORT, CURLU_DEFAULT_PORT);
    const path = await get(await CURLUPart.CURLUPART_PATH);
    console.log(host, port, path);
    console.log(await get(await CURLUPart.CURLUPART_QUERY, CURLU_URLDECODE));
    try {
        await check(await curl_url_set(url, await CURLUPart.CURLUPART_URL, 'https://example.com:99999/', 0));
    } catch (error) {
        console.log(error.message);
    }
    await curl_url_cleanup(url);
}

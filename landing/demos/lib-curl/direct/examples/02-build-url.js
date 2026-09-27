export const imports = {
    '@crossbind/port-curl/curl/urlapi.h': ['curl_url', 'curl_url_dup', 'curl_url_set', 'curl_url_get', 'curl_url_cleanup', 'curl_url_strerror', 'CURLUPart', 'CURLUcode'],
    '@crossbind/port-curl/curl/curl.h': ['curl_free', 'allocPointer', 'readPointerAt', 'readCString'],
};
export const note = 'The same `curl_url_set` calls with the same flags, written as numbers because `CURLU_APPENDQUERY` and `CURLU_URLENCODE` are `#define`s the binding leaves out. One handle holds the URL and `curl_url_dup` copies it before the redirect is resolved; reading the result back is the `allocPointer`, `readPointerAt`, `readCString` and `curl_free` sequence of the previous example.';
export const expected = [
    'https://api.example.com/v1/search?q=cr%C3%A8me+br%C3%BBl%C3%A9e+%26+tea&sort=price%2Basc',
    'https://api.example.com/v2/items?id=7',
    'https://api.example.com/files/Q3%20report.pdf?q=cr%C3%A8me+br%C3%BBl%C3%A9e+%26+tea&sort=price%2Basc',
];

export default async function example({ curl_url, curl_url_dup, curl_url_set, curl_url_get, curl_url_cleanup, curl_url_strerror, CURLUPart, CURLUcode, curl_free, allocPointer, readPointerAt, readCString }, console) {
    const CURLU_URLENCODE = 1 << 7;
    const CURLU_APPENDQUERY = 1 << 8;
    const CURLUPART_URL = await CURLUPart.CURLUPART_URL;
    const CURLUPART_PATH = await CURLUPart.CURLUPART_PATH;
    const CURLUPART_QUERY = await CURLUPart.CURLUPART_QUERY;
    const ok = await CURLUcode.CURLUE_OK;
    const check = async (code) => {
        if (code !== ok) throw new Error(await curl_url_strerror(code));
    };
    const slot = await allocPointer(1);
    const text = async (url) => {
        await check(await curl_url_get(url, CURLUPART_URL, slot, 0));
        const value = await readPointerAt(slot, 0);
        const result = await readCString(value);
        await curl_free(value);
        return result;
    };

    const url = await curl_url();
    await check(await curl_url_set(url, CURLUPART_URL, 'https://api.example.com/v1/', 0));
    await check(await curl_url_set(url, CURLUPART_URL, 'search', 0));
    await check(await curl_url_set(url, CURLUPART_QUERY, 'q=crème brûlée & tea', CURLU_APPENDQUERY | CURLU_URLENCODE));
    await check(await curl_url_set(url, CURLUPART_QUERY, 'sort=price+asc', CURLU_APPENDQUERY | CURLU_URLENCODE));
    console.log(await text(url));

    const redirect = await curl_url_dup(url);
    await check(await curl_url_set(redirect, CURLUPART_URL, '../v2/items?id=7', 0));
    console.log(await text(redirect));

    await check(await curl_url_set(url, CURLUPART_PATH, '/files/Q3 report.pdf', CURLU_URLENCODE));
    console.log(await text(url));
    await curl_url_cleanup(redirect);
    await curl_url_cleanup(url);
}

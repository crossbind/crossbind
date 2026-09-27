export const title = 'Parse a URL the way curl will fetch it';
export const summary = "libcurl's URL API: curl_url_set checks a URL and removes its dot segments, curl_url_get reads one part back, with CURLU_DEFAULT_PORT and CURLU_URLDECODE when asked, and curl_url_strerror explains a URL curl refuses. The host keeps the case it was written in.";
export const native = 'url_parts.h';
export const expected = [
    'https://Example.com/api/search?q=caf%C3%A9#results',
    'Example.com 443 /api/search',
    'q=café',
    'std::runtime_error: Port number was not a decimal number between 0 and 65535',
];

export default async function example({ UrlParts }, console) {
    const url = 'HTTPS://Example.com/docs/../api/search?q=caf%C3%A9#results';
    console.log(await UrlParts.normalize(url));
    console.log(await UrlParts.host(url), await UrlParts.port(url), await UrlParts.path(url));
    console.log(await UrlParts.query(url));
    try {
        await UrlParts.host('https://example.com:99999/');
    } catch (error) {
        console.log(error.message);
    }
}

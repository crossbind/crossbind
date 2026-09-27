export const imports = {
    '@crossbind/port-curl/curl/curl.h': ['curl_easy_escape', 'curl_easy_unescape', 'curl_free', 'readCString'],
};
export const note = 'Both functions return a `char *` that JavaScript reads with `readCString` and frees with `curl_free`, and they take `null` for the handle as the C++ does. The length arguments count bytes, so they are 0 here and curl measures the UTF-8 text itself: `text.length` counts UTF-16 units and cuts `crème brûlée & tea (50%)` three bytes short. `readCString` stops at the first zero byte, so a decoded `%00` ends the text; to read past it, pass an `allocBuffer(4)` handle as the `int *` length and read that many bytes with `readBytes`, one character per byte.';
export const expected = [
    'cr%C3%A8me%20br%C3%BBl%C3%A9e%20%26%20tea%20%2850%25%29',
    'crème brûlée & tea (50%)',
    'cr%C3%A8me%20br%C3%BBl%C3%A9e%20%26%20tea%20(50%25)',
    'a+b c%zz',
];

export default async function example({ curl_easy_escape, curl_easy_unescape, curl_free, readCString }, console) {
    const encode = async (text) => {
        const escaped = await curl_easy_escape(null, text, 0);
        const result = await readCString(escaped);
        await curl_free(escaped);
        return result;
    };
    const decode = async (text) => {
        const decoded = await curl_easy_unescape(null, text, 0, null);
        const result = await readCString(decoded);
        await curl_free(decoded);
        return result;
    };

    const text = 'crème brûlée & tea (50%)';
    const escaped = await encode(text);
    console.log(escaped);
    console.log(await decode(escaped));
    console.log(encodeURIComponent(text));
    console.log(await decode('a+b%20c%zz'));
}

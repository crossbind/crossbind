export const title = 'Percent-encode and decode text';
export const summary = "curl_easy_escape encodes every byte except letters, digits and - . _ ~, the encoding the curl tool's --data-urlencode and --url-query use. JavaScript's encodeURIComponent leaves ( ) ! * ' alone. curl_easy_unescape decodes %XX only: + stays +, and a % that starts no valid sequence is kept.";
export const native = 'percent_codec.h';
export const expected = [
    'cr%C3%A8me%20br%C3%BBl%C3%A9e%20%26%20tea%20%2850%25%29',
    'crème brûlée & tea (50%)',
    'cr%C3%A8me%20br%C3%BBl%C3%A9e%20%26%20tea%20(50%25)',
    'a+b c%zz',
];

export default async function example({ PercentCodec }, console) {
    const text = 'crème brûlée & tea (50%)';
    const escaped = await PercentCodec.escape(text);
    console.log(escaped);
    console.log(await PercentCodec.unescape(escaped));
    console.log(encodeURIComponent(text));
    console.log(await PercentCodec.unescape('a+b%20c%zz'));
}

export const title = 'Build a URL from parts without breaking it';
export const summary = 'curl_url_set with CURLU_APPENDQUERY and CURLU_URLENCODE adds a query pair with its value escaped, CURLU_URLENCODE on the path escapes a file name, and a relative reference set on a URL is resolved the way curl follows a redirect.';
export const native = 'url_builder.h';
export const expected = [
    'https://api.example.com/v1/search?q=cr%C3%A8me+br%C3%BBl%C3%A9e+%26+tea&sort=price%2Basc',
    'https://api.example.com/v2/items?id=7',
    'https://api.example.com/files/Q3%20report.pdf?q=cr%C3%A8me+br%C3%BBl%C3%A9e+%26+tea&sort=price%2Basc',
];

export default async function example({ UrlBuilder }, console) {
    let url = await UrlBuilder.resolve('https://api.example.com/v1/', 'search');
    url = await UrlBuilder.addQuery(url, 'q=crème brûlée & tea');
    url = await UrlBuilder.addQuery(url, 'sort=price+asc');
    console.log(url);
    console.log(await UrlBuilder.resolve(url, '../v2/items?id=7'));
    console.log(await UrlBuilder.withPath(url, '/files/Q3 report.pdf'));
}

export const imports = {
    '@crossbind/port-curl/curl/curl.h': ['curl_getdate'],
};
export const note = '`curl_getdate` returns a `time_t`, 64 bits in this build, so the seconds arrive as a BigInt, and as `-1n` when curl cannot read the text as a date. JavaScript\'s `Date` writes the ISO form the C++ made with `gmtime_r` and `strftime`.';
export const expected = [
    '784111777 1994-11-06T08:49:37Z',
    '784111777 1994-11-06T08:49:37Z',
    '784111777 1994-11-06T08:49:37Z',
    '1994-11-06T06:49:37Z',
    '-1',
];

export default async function example({ curl_getdate }, console) {
    const iso = (seconds) => new Date(Number(seconds) * 1000).toISOString().replace('.000Z', 'Z');
    const formats = ['Sun, 06 Nov 1994 08:49:37 GMT', 'Sunday, 06-Nov-94 08:49:37 GMT', 'Sun Nov  6 08:49:37 1994'];
    for (const date of formats) {
        const seconds = await curl_getdate(date, null);
        console.log(seconds, iso(seconds));
    }
    console.log(iso(await curl_getdate('Sun, 06 Nov 1994 08:49:37 CEST', null)));
    console.log(await curl_getdate('1994-11-06T08:49:37Z', null));
}

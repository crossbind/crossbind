export const title = 'Read the dates in HTTP headers';
export const summary = "curl_getdate reads the three date formats HTTP allows, and variations such as zone names, as seconds since 1970 in UTC. A date without a zone is GMT, where JavaScript's Date.parse takes local time, and ISO 8601 is not a format it reads.";
export const native = 'http_dates.h';
export const expected = [
    '784111777 1994-11-06T08:49:37Z',
    '784111777 1994-11-06T08:49:37Z',
    '784111777 1994-11-06T08:49:37Z',
    '1994-11-06T06:49:37Z',
    '-1',
];

export default async function example({ HttpDates }, console) {
    const formats = ['Sun, 06 Nov 1994 08:49:37 GMT', 'Sunday, 06-Nov-94 08:49:37 GMT', 'Sun Nov  6 08:49:37 1994'];
    for (const date of formats) {
        console.log(await HttpDates.seconds(date), await HttpDates.iso(date));
    }
    console.log(await HttpDates.iso('Sun, 06 Nov 1994 08:49:37 CEST'));
    console.log(await HttpDates.seconds('1994-11-06T08:49:37Z'));
}

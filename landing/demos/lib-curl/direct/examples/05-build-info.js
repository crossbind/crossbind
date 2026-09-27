export const imports = {
    '@crossbind/port-curl/curl/curl.h': ['curl_version', 'curl_version_info', 'CURLversion', 'readCString'],
    '@crossbind/port-curl/curl/urlapi.h': ['curl_url', 'curl_url_set', 'curl_url_cleanup', 'CURLUPart', 'CURLUcode'],
};
export const note = '`curl_version` returns a `char *`, read with `readCString` and not freed: it points at a static buffer. `curl_version_info_data` crosses with its number fields only, so the `protocols` and `feature_names` lists never reach JavaScript: the protocols here are the schemes libcurl 8.22.0 knows that the URL API accepts (the rest return `CURLUE_UNSUPPORTED_SCHEME`), and the features are the `features` bitmask decoded with the `CURL_VERSION_*` bits from `curl.h`. A feature without a bit, such as `HTTPSRR` or `SSLS-EXPORT`, cannot be seen this way.';
export const expected = [
    'libcurl/8.22.0 OpenSSL/4.0.2',
    'dict file ftp ftps gopher gophers http https imap imaps mqtt mqtts pop3 pop3s rtsp smtp smtps telnet tftp ws wss',
    'alt-svc AsynchDNS HSTS HTTPS-proxy Largefile SSL threadsafe UnixSockets',
    'false true',
];

export default async function example({ curl_version, curl_version_info, CURLversion, readCString, curl_url, curl_url_set, curl_url_cleanup, CURLUPart, CURLUcode }, console) {
    console.log(await readCString(await curl_version()));

    const schemes = 'dict file ftp ftps gopher gophers http https imap imaps ldap ldaps mqtt mqtts pop3 pop3s rtsp scp sftp smb smbs smtp smtps telnet tftp ws wss';
    const ok = await CURLUcode.CURLUE_OK;
    const url = await curl_url();
    const protocols = [];
    for (const scheme of schemes.split(' ')) {
        if ((await curl_url_set(url, await CURLUPart.CURLUPART_SCHEME, scheme, 0)) === ok) protocols.push(scheme);
    }
    await curl_url_cleanup(url);
    console.log(protocols.join(' '));

    const info = await curl_version_info(await CURLversion.CURLVERSION_TWELFTH);
    const features = await info.features;
    const bits = {
        'alt-svc': 24, AsynchDNS: 7, brotli: 23, Debug: 6, gsasl: 29, 'GSS-API': 17, HSTS: 28, HTTP2: 16, HTTP3: 25,
        'HTTPS-proxy': 21, IDN: 10, IPv6: 0, Kerberos: 18, Largefile: 9, libz: 3, MultiSSL: 22, NTLM: 4, PSL: 20,
        SPNEGO: 8, SSL: 2, SSPI: 11, threadsafe: 30, Unicode: 27, UnixSockets: 19, zstd: 26,
    };
    const supports = (name) => (features & (1 << bits[name])) !== 0;
    console.log(Object.keys(bits).filter(supports).join(' '));
    console.log(supports('HTTP2'), supports('HSTS'));
}

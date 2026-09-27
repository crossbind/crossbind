export const title = 'Check what this libcurl was built with';
export const summary = 'curl_version_info lists the protocols and features compiled in, so code can check before relying on one. This is the WebAssembly build: no HTTP/2, no compression, no IDN and no IPv6. Its protocols are compiled in, but in a browser a transfer goes through fetch, so only HTTP and HTTPS leave the page. The Android and iOS packages report the same protocols, plus libz.';
export const native = 'build_info.h';
export const expected = [
    'libcurl/8.22.0 OpenSSL/4.0.2',
    'dict file ftp ftps gopher gophers http https imap imaps mqtt mqtts pop3 pop3s rtsp smtp smtps telnet tftp ws wss',
    'alt-svc AsynchDNS HSTS HTTPS-proxy Largefile SSL threadsafe UnixSockets',
    'false true',
];

export default async function example({ BuildInfo }, console) {
    console.log(await BuildInfo.version());
    console.log(await BuildInfo.protocols());
    console.log(await BuildInfo.features());
    console.log(await BuildInfo.supports('HTTP2'), await BuildInfo.supports('HSTS'));
}

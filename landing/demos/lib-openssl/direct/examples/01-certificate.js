export const imports = {
    '@crossbind/port-openssl/openssl/x509.h': [
        'X509_get_subject_name',
        'X509_get_issuer_name',
        'X509_NAME_print_ex',
        'X509_get0_notBefore',
        'X509_get0_notAfter',
        'X509_get_ext_by_NID',
        'X509_get_ext',
        'X509_get0_pubkey',
        'X509_self_signed',
        'X509_digest',
        'X509_free',
    ],
    '@crossbind/port-openssl/openssl/x509v3.h': ['X509V3_EXT_print', 'X509_check_host'],
    '@crossbind/port-openssl/openssl/pem.h': ['PEM_read_bio_X509'],
    '@crossbind/port-openssl/openssl/bio.h': ['BIO_new', 'BIO_s_mem', 'BIO_puts', 'BIO_ctrl_pending', 'BIO_read', 'BIO_free'],
    '@crossbind/port-openssl/openssl/asn1.h': ['ASN1_TIME_print_ex'],
    '@crossbind/port-openssl/openssl/evp.h': [
        'EVP_PKEY_get0_type_name',
        'EVP_PKEY_get_group_name',
        'EVP_PKEY_get_bits',
        'EVP_sha256',
        'allocBuffer',
        'readBytes',
        'readCString',
    ],
};
export const note = 'The same OpenSSL calls the C++ makes, on `x509.h`, `x509v3.h`, `pem.h`, `bio.h`, `asn1.h` and `evp.h` as OpenSSL ships them. OpenSSL prints into a BIO, so JavaScript passes a memory BIO and reads the text back with `BIO_ctrl_pending` and `BIO_read`, because `BIO_get_mem_data` is a macro and has no binding. The flag and NID macros such as `XN_FLAG_RFC2253` have none either, so their values are written out.';
export const expected = [
    'CN=shop.example.com,O=Example Shop,C=US',
    'issued by CN=Example Shop Test CA,O=Example Shop,C=US',
    'valid 2026-03-01 00:00:00Z to 2026-05-30 00:00:00Z',
    'DNS:shop.example.com, DNS:www.shop.example.com, IP Address:192.0.2.10',
    'EC prime256v1 256 bits, self-signed false',
    'www.shop.example.com true',
    'shop.example.org false',
    '68:2D:81:9E:75:7E:2C:15:C1:92:FB:84:3D:BE:AA:99:B4:54:58:D4:5F:A3:F3:3A:C8:13:1E:9D:03:9C:89:3C',
];

export default async function example({ X509_get_subject_name, X509_get_issuer_name, X509_NAME_print_ex, X509_get0_notBefore, X509_get0_notAfter, X509_get_ext_by_NID, X509_get_ext, X509_get0_pubkey, X509_self_signed, X509_digest, X509_free, allocBuffer, readBytes, readCString, X509V3_EXT_print, X509_check_host, PEM_read_bio_X509, BIO_new, BIO_s_mem, BIO_puts, BIO_ctrl_pending, BIO_read, BIO_free, ASN1_TIME_print_ex, EVP_PKEY_get0_type_name, EVP_PKEY_get_group_name, EVP_PKEY_get_bits, EVP_sha256 }, console) {
    // A test certificate for shop.example.com, issued by a test CA.
    const pem = `-----BEGIN CERTIFICATE-----
    MIICIjCCAcigAwIBAgICEAEwCgYIKoZIzj0EAwIwQzELMAkGA1UEBhMCVVMxFTAT
    BgNVBAoMDEV4YW1wbGUgU2hvcDEdMBsGA1UEAwwURXhhbXBsZSBTaG9wIFRlc3Qg
    Q0EwHhcNMjYwMzAxMDAwMDAwWhcNMjYwNTMwMDAwMDAwWjA/MQswCQYDVQQGEwJV
    UzEVMBMGA1UECgwMRXhhbXBsZSBTaG9wMRkwFwYDVQQDDBBzaG9wLmV4YW1wbGUu
    Y29tMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZR6VvLcXeY1MN21YB02ab2Qc
    OzohfHo98QuwSjxUrEEni8Yj0oXx53RyQtlAUlDkddzJOt6ldz90XgKXuWIOGKOB
    rzCBrDAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggr
    BgEFBQcDATA3BgNVHREEMDAughBzaG9wLmV4YW1wbGUuY29tghR3d3cuc2hvcC5l
    eGFtcGxlLmNvbYcEwAACCjAdBgNVHQ4EFgQU1y3zWDMZI93FAyhp8QnFGfs10k4w
    HwYDVR0jBBgwFoAUPExNl7RaXtxsfW/VdAj+Rlc4gpIwCgYIKoZIzj0EAwIDSAAw
    RQIgZtZXDYEsjrz91CjoZyFE5coj51aR5sZi/wKllD1qYq8CIQCOKkQWCapO2G/A
    p1aRCXKO+JxjPWGnkYe0B8RLljl9Pw==
    -----END CERTIFICATE-----`;
    // Macros have no binding: their values from x509.h, asn1.h and obj_mac.h.
    const XN_FLAG_RFC2253 = 0x1110317;
    const ASN1_DTFLGS_ISO8601 = 0x01;
    const NID_subject_alt_name = 85;

    // A memory BIO takes a copy of the text. PEM lines must start in the first column.
    const input = await BIO_new(await BIO_s_mem());
    await BIO_puts(input, pem.replace(/^[ \t]+/gm, ''));
    const cert = await PEM_read_bio_X509(input, null, null, null);
    await BIO_free(input);
    if (!cert) throw new Error('not a PEM certificate');

    // OpenSSL prints into a BIO: `printed` passes a memory BIO first and returns what went in.
    const printed = async (print, ...args) => {
        const out = await BIO_new(await BIO_s_mem());
        await print(out, ...args);
        const size = await BIO_ctrl_pending(out);
        const text = await allocBuffer(size);
        await BIO_read(out, text, size);
        await BIO_free(out);
        return readBytes(text, size);
    };
    console.log(await printed(X509_NAME_print_ex, await X509_get_subject_name(cert), 0, XN_FLAG_RFC2253));
    console.log('issued by', await printed(X509_NAME_print_ex, await X509_get_issuer_name(cert), 0, XN_FLAG_RFC2253));
    const notBefore = await printed(ASN1_TIME_print_ex, await X509_get0_notBefore(cert), ASN1_DTFLGS_ISO8601);
    const notAfter = await printed(ASN1_TIME_print_ex, await X509_get0_notAfter(cert), ASN1_DTFLGS_ISO8601);
    console.log('valid', notBefore, 'to', notAfter);
    const altNames = await X509_get_ext(cert, await X509_get_ext_by_NID(cert, NID_subject_alt_name, -1));
    console.log(await printed(X509V3_EXT_print, altNames, 0, 0));

    const key = await X509_get0_pubkey(cert);
    const group = await allocBuffer(80);
    await EVP_PKEY_get_group_name(key, group, 80, null);
    const type = await EVP_PKEY_get0_type_name(key);
    const bits = await EVP_PKEY_get_bits(key);
    const selfSigned = (await X509_self_signed(cert, 1)) === 1;
    console.log(`${type} ${await readCString(group)} ${bits} bits, self-signed ${selfSigned}`);
    for (const host of ['www.shop.example.com', 'shop.example.org']) console.log(host, (await X509_check_host(cert, host, host.length, 0, null)) === 1);

    const digest = await allocBuffer(32);
    await X509_digest(cert, await EVP_sha256(), digest, null);
    const fingerprint = await readBytes(digest, 32);
    console.log([...fingerprint].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()).join(':'));
    await X509_free(cert);
}

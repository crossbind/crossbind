export const title = 'Read a certificate like openssl x509 -text';
export const summary = 'What people open a certificate for, from C++: PEM_read_bio_X509 parses it, X509_NAME_print_ex writes the subject and issuer, ASN1_TIME_print_ex the validity, X509V3_EXT_print the alternative names, X509_check_host matches a host name the way a TLS client does and X509_digest takes the SHA-256 fingerprint. WebCrypto has no X.509 parser.';
export const native = 'certificate.h';
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

export default async function example({ Certificate }, console) {
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
    const cert = await new Certificate(pem);
    console.log(await cert.subject());
    console.log('issued by', await cert.issuer());
    console.log('valid', await cert.notBefore(), 'to', await cert.notAfter());
    console.log(await cert.altNames());
    console.log(`${await cert.keyType()} ${await cert.keyBits()} bits, self-signed ${await cert.selfSigned()}`);
    for (const host of ['www.shop.example.com', 'shop.example.org']) console.log(host, await cert.covers(host));
    console.log(await cert.sha256());
}

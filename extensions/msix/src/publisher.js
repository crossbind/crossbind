import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CERTFILE = 'CROSSBIND_WINDOWS_SIGNING_CERTFILE';
const CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;
// Windows' names of a subject's attributes, as it writes a certificate's subject and a package's publisher, by
// OpenSSL's; another keeps OpenSSL's.
const WINDOWS_NAMES = { ST: 'S', emailAddress: 'E', street: 'STREET', title: 'T', GN: 'G', givenName: 'G', SN: 'SN', serialNumber: 'SERIALNUMBER' };
// What Windows quotes in a value of a name.
const QUOTED = /[,+=";<>#\n]|^\s|\s$/;

// A value as RFC 2253 escapes it, as Node gives a subject: a backslash before a character, or before two hex digits of a
// byte of its UTF-8.
function unescaped(value) {
    const bytes = [];
    for (let at = 0; at < value.length; at += 1) {
        if (value[at] === '\\' && /^[0-9A-Fa-f]{2}$/.test(value.slice(at + 1, at + 3))) {
            bytes.push(parseInt(value.slice(at + 1, at + 3), 16));
            at += 2;
        } else {
            if (value[at] === '\\') at += 1;
            bytes.push(...Buffer.from(value[at] ?? '', 'utf8'));
        }
    }
    return Buffer.from(bytes).toString('utf8');
}

// A certificate's subject, as Node gives it, one name a line in the certificate's order, as Windows writes it and an
// MSIX package's publisher must be: its most particular name first, as CN=Example, O=Example, C=TR.
export function windowsPublisher(subject) {
    return subject.split('\n').reverse().map((line) => line.split(/(?<!\\) \+ /).map((part) => {
        const at = part.indexOf('=');
        const type = part.slice(0, at);
        const value = unescaped(part.slice(at + 1));
        return `${WINDOWS_NAMES[type] ?? type}=${QUOTED.test(value) ? `"${value.replaceAll('"', '""')}"` : value}`;
    }).join(' + ')).join(', ');
}

// The common name of a certificate's subject, as Node gives it, or the whole subject without one.
export function commonName(subject) {
    const line = subject.split('\n').find((name) => name.startsWith('CN='));
    return line ? unescaped(line.slice('CN='.length)) : windowsPublisher(subject);
}

// The certificate that signs the app: CROSSBIND_WINDOWS_SIGNING_CERTFILE's, else the one the keystore holds, which keytool
// prints in the windows image, where the keystore is.
export function signingCertificate(api) {
    const certfile = process.env[CERTFILE];
    if (certfile) return certificateOf(fs.readFileSync(certfile), certfile);
    if (!['PKCS12', 'JKS', 'JCEKS'].includes(process.env.CROSSBIND_WINDOWS_SIGNING_STORETYPE?.toUpperCase())) {
        throw new Error(`crossbind: an MSIX package names its publisher as the certificate that signs it does, which crossbind reads from ${CERTFILE} or a keystore file. Set ${CERTFILE} to the certificate of the cloud's key, or give the Store's identity in app.windows.msix.`);
    }
    fs.mkdirSync(api.workDir, { recursive: true });
    const listing = path.join(api.workDir, 'signing-certificate.txt');
    api.run(['sh', '-c', 'keytool -list -rfc ${CROSSBIND_WINDOWS_SIGNING_ALIAS:+-alias "$CROSSBIND_WINDOWS_SIGNING_ALIAS"} -keystore "$CROSSBIND_WINDOWS_SIGNING_KEYSTORE" -storetype "$CROSSBIND_WINDOWS_SIGNING_STORETYPE" ${CROSSBIND_WINDOWS_SIGNING_STOREPASS:+-storepass:env CROSSBIND_WINDOWS_SIGNING_STOREPASS} > "$1"', 'sh', path.basename(listing)], { cwd: api.workDir, isSigning: true });
    try {
        return certificateOf(fs.readFileSync(listing, 'utf8').match(CERTIFICATE)?.[0] ?? '', 'the keystore');
    } finally {
        fs.rmSync(listing, { force: true });
    }
}

function certificateOf(bytes, where) {
    try {
        return new crypto.X509Certificate(bytes);
    } catch (error) {
        throw new Error(`crossbind: ${where} holds no certificate crossbind reads, in PEM or DER: ${error.message}`, { cause: error });
    }
}

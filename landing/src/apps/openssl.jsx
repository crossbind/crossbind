import { useRef, useState } from 'react';
import { REPO_URL } from '../data.js';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { download, FileButton, Hint, Meta, Placeholder, SecondaryButton, Select, Stat, Toggle } from './controls.jsx';

// The OpenSSL apps on /ports/openssl/. Each one drives landing/demos/lib-openssl, whose index.html
// checks the same calls against published test vectors, the host's OpenSSL 3.6.2, Python's
// cryptography and the browser's WebCrypto.

// The test certificate of the first usage example, and the test CA that issued it.
const SHOP_CHAIN = `-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBtzCCAV2gAwIBAgIBCjAKBggqhkjOPQQDAjBDMQswCQYDVQQGEwJVUzEVMBMG
A1UECgwMRXhhbXBsZSBTaG9wMR0wGwYDVQQDDBRFeGFtcGxlIFNob3AgVGVzdCBD
QTAeFw0yNjAxMDEwMDAwMDBaFw0zNjAxMDEwMDAwMDBaMEMxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKDAxFeGFtcGxlIFNob3AxHTAbBgNVBAMMFEV4YW1wbGUgU2hvcCBU
ZXN0IENBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDlOGwIFm9XEzrBJY6L6z
p/ZML7UY7Icxq2zwdMke6AjcDJd0GPdhdZsd+0iBHDjbo6w1dXQwO1Hqb6mul8lq
/KNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYE
FDxMTZe0Wl7cbH1v1XQI/kZXOIKSMAoGCCqGSM49BAMCA0gAMEUCIQDzZYXzwRwa
7kUg5H0zLK4xJRb0TFMLjJoJIG+BPWKnPAIgTQx/0iMBosRYrifWc9gq+imldCOh
SbqKkb0RUXoYBoI=
-----END CERTIFICATE-----`;

const KEY_TYPES = [
    { id: 'ED25519', label: 'Ed25519', cli: '-newkey ed25519' },
    { id: 'P-256', label: 'ECDSA P-256', cli: '-newkey ec -pkeyopt ec_paramgen_curve:P-256' },
    { id: 'P-384', label: 'ECDSA P-384', cli: '-newkey ec -pkeyopt ec_paramgen_curve:P-384' },
    { id: 'RSA-2048', label: 'RSA 2048', cli: '-newkey rsa:2048' },
    { id: 'RSA-3072', label: 'RSA 3072', cli: '-newkey rsa:3072' },
    { id: 'ML-DSA-65', label: 'ML-DSA-65, post-quantum (FIPS 204)', cli: '-newkey ML-DSA-65' },
];

const formatted = (value) => Number(value).toLocaleString('en-US');

// "shop.example.com" from "CN=shop.example.com,O=Example Shop,C=US".
const commonName = (name) => /(?:^|,)CN=((?:\\.|[^,])+)/.exec(name ?? '')?.[1] ?? name;

const toBase64 = (bytes) => {
    let text = '';
    for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return btoa(text);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

// "expires in 64 days" or "expired 12 days ago", from a time as OpenSSL prints it: "2026-05-30 00:00:00Z".
function expiry(notAfter) {
    const days = Math.round((Date.parse(notAfter.replace(' ', 'T')) - Date.now()) / 86400000);
    if (!Number.isFinite(days)) return '';
    return days >= 0 ? `expires in ${formatted(days)} day${days === 1 ? '' : 's'}` : `expired ${formatted(-days)} day${days === -1 ? '' : 's'} ago`;
}

function Field({ tokens, label, value, onChange, type = 'text', rows = 0 }) {
    return (
        <label style={{ display: 'block', minWidth: 0 }}>
            <Label tokens={tokens}>{label}</Label>
            {rows ? (
                <textarea value={value} rows={rows} spellCheck={false} onInput={(event) => onChange(event.target.value)} style={{ ...fieldStyle(tokens), resize: 'vertical', fontSize: 11.5 }} />
            ) : (
                <input type={type} value={value} spellCheck={false} onInput={(event) => onChange(event.target.value)} style={fieldStyle(tokens)} />
            )}
        </label>
    );
}

function Segmented({ tokens, value, options, onChange }) {
    return (
        <div role="tablist" style={{ display: 'inline-flex', border: `1px solid ${tokens.borderStrong}`, borderRadius: 9, overflow: 'hidden' }}>
            {options.map(([id, text]) => (
                <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={value === id}
                    className="tap-target"
                    onClick={() => onChange(id)}
                    style={{ border: 'none', padding: '8px 14px', fontSize: 13.5, cursor: 'pointer', background: value === id ? tokens.pillBg : 'transparent', color: value === id ? tokens.text : tokens.textMuted, fontWeight: value === id ? 600 : 500 }}
                >
                    {text}
                </button>
            ))}
        </div>
    );
}

function Stats({ children }) {
    return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 16 }}>{children}</div>;
}

function TextBox({ tokens, text, maxHeight = 180 }) {
    return (
        <pre style={{ margin: 0, maxHeight, overflow: 'auto', fontFamily: tokens.mono, fontSize: 11.5, lineHeight: 1.55, color: tokens.codeText, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '9px 11px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {text}
        </pre>
    );
}

function Block({ tokens, label, text, file, maxHeight }) {
    return (
        <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <Label tokens={tokens}>{label}</Label>
                {file ? <SecondaryButton tokens={tokens} onClick={() => download(text, file, 'application/x-pem-file')}>{`Download ${file}`}</SecondaryButton> : null}
            </div>
            <TextBox tokens={tokens} text={text} maxHeight={maxHeight} />
        </div>
    );
}

function LicenceNote({ tokens }) {
    const external = { target: '_blank', rel: 'noreferrer', style: { color: tokens.accentText, textDecoration: 'underline', textUnderlineOffset: 3 } };
    return (
        <span>
            {'Runs OpenSSL 4.0.2, which is Apache-2.0: '}
            <a href="https://github.com/openssl/openssl" {...external}>source</a>
            {' · '}
            <a href={`${REPO_URL}/tree/main/ports/openssl`} {...external}>build recipe</a>
        </span>
    );
}

// The command line that makes the same thing, for a terminal or a CI script.
function cliFor(type, output, subject, altNames, days) {
    const key = KEY_TYPES.find((item) => item.id === type).cli;
    const names = altNames ? ` -addext "subjectAltName=${altNames}"` : '';
    return output === 'request'
        ? `openssl req -new ${key} -nodes -keyout key.pem -out request.csr -subj "${subject}"${names}`
        : `openssl req -x509 ${key} -nodes -keyout key.pem -out cert.pem -days ${days} -subj "${subject}"${names}`;
}

function Facts({ tokens, item }) {
    if (item.kind !== 'certificate') {
        return (
            <div style={{ display: 'grid', gap: 12 }}>
                <Stats>
                    <Stat tokens={tokens} size={19} accent value={item.kind} label={item.subject ?? `${formatted(item.keyBits)}-bit key`} />
                    <Stat tokens={tokens} size={19} value={item.keyType} label={item.securityBits ? `${item.securityBits}-bit security` : `signed with ${item.signature}`} />
                    {'signatureValid' in item ? <Stat tokens={tokens} size={19} value={item.signatureValid ? 'valid' : 'invalid'} label="request signature" /> : null}
                </Stats>
                {item.altNames ? <Meta tokens={tokens}>{item.altNames}</Meta> : null}
            </div>
        );
    }
    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <Stats>
                <Stat tokens={tokens} size={19} accent value={commonName(item.subject)} label={item.selfSigned ? 'self-signed' : `issued by ${commonName(item.issuer)}`} />
                <Stat tokens={tokens} size={19} value={item.notAfter.slice(0, 10)} label={expiry(item.notAfter)} />
                <Stat tokens={tokens} size={19} value={item.keyType} label={`signed with ${item.signature}`} />
            </Stats>
            <Meta tokens={tokens}>
                <div>{item.subject}</div>
                {item.altNames ? <div>{item.altNames}</div> : null}
                <div>{`SHA-256 ${item.fingerprint}`}</div>
                {item.authority ? <div>a CA certificate: it can sign others</div> : null}
            </Meta>
        </div>
    );
}

const STUDIO_WRAPPER = `// src/support/pki.h, called by src/native/cert_studio.h (excerpt)
EVP_PKEY* key = EVP_PKEY_Q_keygen(nullptr, nullptr, "ML-DSA-65");
X509* cert = X509_new();
X509_set_version(cert, X509_VERSION_3);
X509_set_subject_name(cert, subject);
X509_set_issuer_name(cert, subject);          // self-signed
X509_gmtime_adj(X509_getm_notBefore(cert), 0);
X509_time_adj_ex(X509_getm_notAfter(cert), days, 0, nullptr);
X509_set_pubkey(cert, key);
addExtension(cert, nullptr, NID_subject_alt_name, "DNS:localhost,IP:127.0.0.1");
addExtension(cert, nullptr, NID_subject_key_identifier, "hash");
X509_sign(cert, key, nullptr);                // Ed25519 and ML-DSA take no digest
X509_print_ex(text, cert, CLI_NAME_FLAGS, X509_FLAG_COMPAT);`;

const STUDIO_USAGE = `const m = await initNative();
const studio = await new m.CertStudio();
const key = await studio.generateKey('ML-DSA-65');
const pem = await studio.selfSign(key, '/CN=localhost', 'DNS:localhost,IP:127.0.0.1', 30, '', '', 0);
const [cert] = JSON.parse(await studio.inspect(pem));
// cert.signature: 'ML-DSA-65', cert.selfSigned: true
// cert.text: what \`openssl x509 -text -noout\` prints for it`;

export function CertificateStudio({ tokens, index, load }) {
    const [mode, setMode] = useState('make');
    const [type, setType] = useState('ED25519');
    const [subject, setSubject] = useState('/CN=localhost');
    const [altNames, setAltNames] = useState('DNS:localhost,IP:127.0.0.1');
    const [days, setDays] = useState('30');
    const [output, setOutput] = useState('certificate');
    const [pasted, setPasted] = useState(SHOP_CHAIN);
    const [pastedKey, setPastedKey] = useState('');
    const studio = useRef(null);
    const [state, run] = useNativeTask(load);
    const done = state.status === 'ready' ? state.result : null;
    const first = done?.items[0];
    const open = async (m) => (studio.current ??= await new m.CertStudio());
    const make = () =>
        run(async (m) => {
            const count = Number(days);
            if (output === 'certificate' && !(Number.isInteger(count) && count > 0)) throw new Error('days must be a whole number above 0');
            const lab = await open(m);
            const key = await lab.generateKey(type);
            const names = altNames.trim();
            const pem = output === 'request' ? await lab.makeRequest(key, subject.trim(), names) : await lab.selfSign(key, subject.trim(), names, count, '', '', 0);
            return { mode: 'make', key, pem, items: JSON.parse(await lab.inspect(pem)), cli: cliFor(type, output, subject.trim(), names, count) };
        });
    const inspect = () =>
        run(async (m) => {
            const lab = await open(m);
            const items = JSON.parse(await lab.inspect(pasted));
            const matches = pastedKey.trim() ? await lab.keyMatches(pasted, pastedKey) : null;
            return { mode: 'inspect', items, matches };
        });
    return (
        <AppCard
            tokens={tokens}
            id="openssl-studio"
            index={index}
            status={state.status}
            title="Make a key and a certificate, or read any PEM"
            pitch="Generate an RSA, ECDSA, Ed25519 or post-quantum ML-DSA key, then a self-signed certificate or a certificate signing request for it, and read back what OpenSSL wrote, the way openssl x509 -text prints it. Paste a certificate, a chain, a request or a key to inspect it instead. WebCrypto makes keys but reads no certificates: here OpenSSL itself runs in the tab, and the private key is never sent anywhere."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div>
                        <Segmented tokens={tokens} value={mode} onChange={setMode} options={[['make', 'Make'], ['inspect', 'Inspect']]} />
                    </div>
                    {mode === 'make' ? (
                        <>
                            <Select tokens={tokens} label="KEY" value={type} onChange={setType}>
                                {KEY_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                            </Select>
                            <Field tokens={tokens} label="SUBJECT, AS OPENSSL REQ -SUBJ TAKES IT" value={subject} onChange={setSubject} />
                            <Field tokens={tokens} label="ALTERNATIVE NAMES, WHAT BROWSERS MATCH" value={altNames} onChange={setAltNames} />
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                                <Select tokens={tokens} label="MAKE" value={output} onChange={setOutput}>
                                    <option value="certificate">Self-signed certificate</option>
                                    <option value="request">Certificate request (CSR)</option>
                                </Select>
                                {output === 'certificate' ? <Field tokens={tokens} label="VALID FOR, DAYS" type="number" value={days} onChange={setDays} /> : null}
                            </div>
                            <div>
                                <RunButton tokens={tokens} busy={state.status === 'running'} onClick={make}>Generate with OpenSSL</RunButton>
                            </div>
                            <Hint tokens={tokens}>RSA keys take longest: finding their primes is random work. ML-DSA-65 is the post-quantum signature of FIPS 204; its certificates are for experiments.</Hint>
                        </>
                    ) : (
                        <>
                            <Field tokens={tokens} label="CERTIFICATES, A REQUEST OR A KEY, AS PEM" value={pasted} onChange={setPasted} rows={9} />
                            <Field tokens={tokens} label="PRIVATE KEY TO MATCH (OPTIONAL)" value={pastedKey} onChange={setPastedKey} rows={3} />
                            <div>
                                <RunButton tokens={tokens} busy={state.status === 'running'} onClick={inspect}>Inspect with OpenSSL</RunButton>
                            </div>
                            <Hint tokens={tokens}>The sample is the usage example's test certificate for shop.example.com, followed by the test CA that issued it.</Hint>
                        </>
                    )}
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <Facts tokens={tokens} item={first} />
                        {done.mode === 'inspect' && done.items.length > 1 ? <Meta tokens={tokens}>{`A chain of ${done.items.length}: ${done.items.map((item) => item.subject).join(' ← ')}`}</Meta> : null}
                        {done.matches === true || done.matches === false ? (
                            <div style={{ fontSize: 14, color: done.matches ? tokens.accentText : tokens.warn }}>{done.matches ? 'The private key belongs to this certificate.' : 'The private key does not belong to this certificate.'}</div>
                        ) : null}
                        {done.mode === 'make' ? (
                            <>
                                <Block tokens={tokens} label="THE SAME ON THE COMMAND LINE" text={done.cli} />
                                <Block tokens={tokens} label="PRIVATE KEY, PKCS#8" text={done.key} file="key.pem" maxHeight={120} />
                                <Block tokens={tokens} label={first.kind === 'certificate' ? 'CERTIFICATE' : 'CERTIFICATE REQUEST'} text={done.pem} file={first.kind === 'certificate' ? 'cert.pem' : 'request.csr'} maxHeight={120} />
                            </>
                        ) : null}
                        <Block tokens={tokens} label={first.kind === 'certificate' ? 'OPENSSL X509 -TEXT' : 'AS OPENSSL PRINTS IT'} text={first.text} maxHeight={260} />
                        <Meta tokens={tokens}>{`${formatted(state.ms)} ms in this tab`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Generate a key and a certificate, or inspect the sample chain.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/pki.h', code: STUDIO_WRAPPER },
                { file: 'main.js', code: STUDIO_USAGE },
            ]}
        />
    );
}
CertificateStudio.appId = 'openssl-studio';

const CERTIFICATES = [
    ['ED25519', 'Ed25519'],
    ['P-256', 'ECDSA P-256'],
    ['RSA-2048', 'RSA 2048'],
    ['ML-DSA-65', 'ML-DSA-65, post-quantum'],
];
const GROUPS = [
    ['', "OpenSSL's default: X25519MLKEM768, hybrid post-quantum"],
    ['X25519', 'X25519 only, classic'],
    ['MLKEM768', 'ML-KEM-768 only, post-quantum'],
    ['P-256', 'P-256 only'],
];

function Ladder({ tokens, messages, tls12 }) {
    const cell = { fontFamily: tokens.mono, fontSize: 12, lineHeight: 1.4, minWidth: 0, overflowWrap: 'anywhere' };
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 40px minmax(0, 1fr)', gap: '6px 8px', alignItems: 'center' }}>
            <Label tokens={tokens}>CLIENT</Label>
            <span />
            <div style={{ textAlign: 'right' }}>
                <Label tokens={tokens}>SERVER</Label>
            </div>
            {messages.map((message, position) => {
                const fromClient = message.from === 'client';
                const quiet = message.type === 'ChangeCipherSpec';
                const alert = message.type.startsWith('Alert');
                const detail = message.encrypted ? ' · encrypted' : quiet ? (tls12 ? ' · turns encryption on' : ' · for old middleboxes') : ' · readable on the wire';
                const text = (
                    <div style={{ ...cell, textAlign: fromClient ? 'left' : 'right', color: alert ? tokens.warn : quiet ? tokens.textMuted : tokens.text }}>
                        <div>{message.type}</div>
                        <div style={{ fontSize: 11, color: message.encrypted ? tokens.accentText : tokens.textMuted }}>{`${formatted(message.bytes)} B${detail}`}</div>
                    </div>
                );
                return [
                    <div key={`a${position}`}>{fromClient ? text : null}</div>,
                    <div key={`b${position}`} aria-hidden="true" style={{ textAlign: 'center', fontSize: 16, color: message.encrypted ? tokens.accent : tokens.textMuted }}>{fromClient ? '→' : '←'}</div>,
                    <div key={`c${position}`}>{fromClient ? null : text}</div>,
                ];
            })}
        </div>
    );
}

const TLS_WRAPPER = `// src/support/tls_run.h (excerpt)
SSL_set_bio(client.ssl, client.in, client.out);  // memory BIOs, no sockets
SSL_set_bio(server.ssl, server.in, server.out);
SSL_set_msg_callback(client.ssl, traceMessage);  // every message, as it is read
SSL_set_msg_callback(server.ssl, traceMessage);
SSL_set_tlsext_host_name(client.ssl, "secret.example");
SSL_set1_host(client.ssl, "secret.example");     // check the certificate's name
for (int round = 0; round < 8 && !(client.done && server.done); round += 1) {
    step(client);                                 // SSL_do_handshake until it waits
    carry(client.out, server.in, true, wire);     // this code moves the bytes
    step(server);
    carry(server.out, client.in, false, wire);
}
SSL_get0_group_name(client.ssl);                  // "X25519MLKEM768"`;

const TLS_USAGE = `const m = await initNative();
const lab = await new m.TlsLab();
// server key, groups ('' is OpenSSL's default), TLS 1.2 only, ECH, flip a bit
const run = JSON.parse(await lab.handshake('ED25519', '', false, true, false));
// run.version: 'TLSv1.3', run.group: 'X25519MLKEM768'
// run.ech.status: 'success', run.serverNames: ['public.example']
// run.secretNameOnWire: 0, the real name is in none of the bytes sent`;

export function TlsLabApp({ tokens, index, load }) {
    const [certificate, setCertificate] = useState('ED25519');
    const [groups, setGroups] = useState('');
    const [ech, setEch] = useState(false);
    const [tamper, setTamper] = useState(false);
    const [tls12, setTls12] = useState(false);
    const lab = useRef(null);
    const [state, run] = useNativeTask(load);
    const done = state.status === 'ready' ? state.result : null;
    const start = () =>
        run(async (m) => {
            lab.current ??= await new m.TlsLab();
            return { tls12, ...JSON.parse(await lab.current.handshake(certificate, groups, tls12, ech, tamper)) };
        });
    return (
        <AppCard
            tokens={tokens}
            id="openssl-tls"
            index={index}
            status={state.status}
            title="A TLS handshake between two OpenSSL endpoints, in this tab"
            pitch="An OpenSSL 4 client and server shake hands over memory buffers while this page carries every byte between them and lists every message. See the hybrid post-quantum key exchange OpenSSL picks by default, hide the server's name with Encrypted Client Hello, or flip one bit on the wire and watch the client refuse it. A web page cannot open its own TLS connections, so both ends run here; this page's own HTTPS is the browser's TLS, not OpenSSL's."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="SERVER CERTIFICATE" value={certificate} onChange={setCertificate}>
                        {CERTIFICATES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                    </Select>
                    <Select tokens={tokens} label="KEY EXCHANGE" value={groups} onChange={setGroups}>
                        {GROUPS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                    </Select>
                    <div style={{ display: 'grid', gap: 10 }}>
                        <Toggle tokens={tokens} checked={ech} onChange={setEch}>Encrypted Client Hello: the wire shows public.example, the server sees secret.example</Toggle>
                        <Toggle tokens={tokens} checked={tamper} onChange={setTamper}>Flip one bit of the server's first encrypted record</Toggle>
                        <Toggle tokens={tokens} checked={tls12} onChange={setTls12}>Cap the client at TLS 1.2, to compare</Toggle>
                    </div>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Shake hands</RunButton>
                    </div>
                    <Hint tokens={tokens}>The server's certificate is issued for secret.example and public.example by a CA the client trusts, all made in the module on the first run of each key type. RSA keys take a few seconds.</Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        {done.ok ? (
                            <Stats>
                                <Stat tokens={tokens} size={19} accent value={done.version} label={done.cipher} />
                                <Stat tokens={tokens} size={19} value={done.group} label="key exchange" />
                                <Stat tokens={tokens} size={19} value={done.signature} label={`certificate ${done.verify === 'ok' ? 'verified' : done.verify}`} />
                            </Stats>
                        ) : (
                            <Failure tokens={tokens} message={`No connection. Client: ${done.clientError || 'waiting'}. Server: ${done.serverError || 'waiting'}.${done.tampered ? ` Changed on the wire: ${done.tampered}.` : ''}`} />
                        )}
                        <Ladder tokens={tokens} messages={done.messages} tls12={done.tls12} />
                        <div>
                            <Label tokens={tokens}>WHAT THE WIRE SHOWED</Label>
                            <Meta tokens={tokens}>
                                <div>{`${formatted(done.bytesToServer)} B to the server, ${formatted(done.bytesToClient)} B back, in ${done.records.length} records`}</div>
                                <div>{`key shares offered: ${done.clientShares.map((share) => `${share.group} ${formatted(share.bytes)} B`).join(', ') || 'none'}${done.serverGroup ? `; chosen: ${done.serverGroup} ${formatted(done.serverShare)} B` : ''}`}</div>
                                <div>{`server name in clear text: ${done.serverNames.join(', ') || 'none'}`}</div>
                                <div style={{ color: done.secretNameOnWire ? tokens.textMuted : tokens.accentText }}>{`"secret.example" appears ${done.secretNameOnWire} time${done.secretNameOnWire === 1 ? '' : 's'} in the bytes sent`}</div>
                                {done.ok ? <div>{`the request "GET /inbox" appears ${done.requestOnWire} times; the server read it and answered "${done.response.split('\r\n').pop()}"`}</div> : null}
                            </Meta>
                        </div>
                        {done.ech ? (
                            <div>
                                <Label tokens={tokens}>ENCRYPTED CLIENT HELLO</Label>
                                <Meta tokens={tokens}>
                                    <div>{`status ${done.ech.status}: outer name ${done.ech.outer || '-'}, inner name ${done.ech.inner || '-'}`}</div>
                                    <div>{`ECHConfigList, as a DNS HTTPS record publishes it: ${done.ech.configList}`}</div>
                                </Meta>
                            </div>
                        ) : null}
                        <Meta tokens={tokens}>{`${formatted(state.ms)} ms in this tab, key making included on the first run`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Shake hands to see every message of the handshake, and what an observer of the wire would see.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/tls_run.h', code: TLS_WRAPPER },
                { file: 'main.js', code: TLS_USAGE },
            ]}
        />
    );
}
TlsLabApp.appId = 'openssl-tls';

const PFX_WRAPPER = `// src/native/pfx_tool.h and src/support/pkcs12_info.h (excerpt)
PKCS12* p12 = d2i_PKCS12_bio(in, nullptr);
if (PKCS12_verify_mac(p12, password.c_str(), -1) != 1) throw std::runtime_error("wrong password");
if (!PKCS12_parse(p12, password.c_str(), &key, &cert, &chain)) {
    // error:0308010C:digital envelope routines::unsupported: RC2-40 is in the legacy provider.
    // Loading a provider by name turns off the automatic default one, so load that first, once.
    OSSL_PROVIDER_load(nullptr, "default");
    OSSL_PROVIDER* legacy = OSSL_PROVIDER_load(nullptr, "legacy");
    PKCS12_parse(p12, password.c_str(), &key, &cert, &chain);
    OSSL_PROVIDER_unload(legacy);
}
// and back, as OpenSSL 3 and later write it by default
PKCS12_create_ex2(password.c_str(), name, key, cert, chain, NID_aes_256_cbc, NID_aes_256_cbc,
                  PKCS12_DEFAULT_ITER, -1, 0, nullptr, nullptr, nullptr, nullptr);
PKCS12_set_mac(p12, password.c_str(), -1, nullptr, 0, PKCS12_DEFAULT_ITER, EVP_sha256());`;

const PFX_USAGE = `const m = await initNative();
const pfx = await new m.PfxTool();
const bytes = new Uint8Array(await file.arrayBuffer());
const base64 = btoa(String.fromCharCode(...bytes)); // fine for a .p12; chunk big files
const opened = JSON.parse(await pfx.unpack(base64, password));
// opened.safes: the lines openssl pkcs12 -info prints for the file
// opened.legacyProvider: true for RC2-40 files; opened.keyPem, opened.certPem, opened.chain`;

export function PfxUnpacker({ tokens, index, load }) {
    const [file, setFile] = useState(null);
    const [password, setPassword] = useState('');
    const [repackError, setRepackError] = useState('');
    const tool = useRef(null);
    const [state, run] = useNativeTask(load);
    const done = state.status === 'ready' ? state.result : null;
    const open = async (m) => (tool.current ??= await new m.PfxTool());
    const unpack = () =>
        file
            ? run(async (m) => {
                  setRepackError('');
                  const pfx = await open(m);
                  const base64 = toBase64(new Uint8Array(await file.arrayBuffer()));
                  return { name: file.name, ...JSON.parse(await pfx.unpack(base64, password)) };
              })
            : sample(false);
    const sample = (legacy) =>
        run(async (m) => {
            setRepackError('');
            const pfx = await open(m);
            const base64 = await pfx.sample('sample', legacy);
            setPassword('sample');
            return { name: legacy ? 'sample-legacy.p12' : 'sample.p12', ...JSON.parse(await pfx.unpack(base64, 'sample')) };
        });
    const repack = async (legacy) => {
        try {
            const pfx = await open(await load());
            const chain = done.chain.map((cert) => cert.pem).join('');
            const base64 = await pfx.pack(done.keyPem, done.certPem, chain, password, done.friendlyName, legacy);
            download(fromBase64(base64), legacy ? 'legacy.p12' : 'modern.p12', 'application/x-pkcs12');
            setRepackError('');
        } catch (error) {
            setRepackError(error?.message ?? String(error));
        }
    };
    return (
        <AppCard
            tokens={tokens}
            id="openssl-pfx"
            index={index}
            status={state.status}
            title="Open a .p12 or .pfx file, and make one"
            pitch="Choose a .p12 or .pfx file and type its password: the key, the certificate and the chain come out as PEM, with the cipher and MAC that protect each part, named as openssl pkcs12 -info names them. Files written by OpenSSL 1.1.1 and other older tools use RC2-40 and 3DES, which OpenSSL 3 and later keep in a legacy provider; this build carries it and loads it only for such files. The file is read in this tab and not uploaded."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                        <FileButton tokens={tokens} accept=".p12,.pfx,application/x-pkcs12" onFile={setFile}>Choose a .p12 or .pfx</FileButton>
                        <span style={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.textMuted, overflowWrap: 'anywhere' }}>{file ? `${file.name}, ${formatted(file.size)} B` : 'no file chosen'}</span>
                    </div>
                    <Field tokens={tokens} label="PASSWORD" type="password" value={password} onChange={setPassword} />
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={unpack}>{file ? 'Open with OpenSSL' : 'Open the sample with OpenSSL'}</RunButton>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        <SecondaryButton tokens={tokens} onClick={() => sample(false)}>Try a sample file</SecondaryButton>
                        <SecondaryButton tokens={tokens} onClick={() => sample(true)}>Try a legacy sample</SecondaryButton>
                    </div>
                    <Hint tokens={tokens}>A sample is made in the module: a P-256 key and a self-signed certificate for sample.example, packed with the password "sample" as openssl pkcs12 -export writes it, with or without -legacy.</Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <Stats>
                            <Stat tokens={tokens} size={19} accent value={commonName(done.certificate.subject)} label={done.friendlyName ? `friendly name ${done.friendlyName}` : done.name} />
                            <Stat tokens={tokens} size={19} value={done.keyType} label={done.keyMatches ? 'the key belongs to the certificate' : 'the key does not match the certificate'} />
                            <Stat tokens={tokens} size={19} value={done.certificate.notAfter.slice(0, 10)} label={expiry(done.certificate.notAfter)} />
                        </Stats>
                        {done.legacyProvider ? <Meta tokens={tokens}>{`Read with the legacy provider. Without it, OpenSSL stops with ${done.withoutLegacy}, the error such files give OpenSSL 3 and later.`}</Meta> : null}
                        <Block tokens={tokens} label="WHAT PROTECTS EACH PART, AS OPENSSL PKCS12 -INFO PRINTS IT" text={[`MAC: ${done.mac}`, ...done.safes].join('\n')} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            <SecondaryButton tokens={tokens} onClick={() => download(done.keyPem, 'key.pem', 'application/x-pem-file')}>Download key.pem</SecondaryButton>
                            <SecondaryButton tokens={tokens} onClick={() => download(done.certPem, 'cert.pem', 'application/x-pem-file')}>Download cert.pem</SecondaryButton>
                            {done.chain.length ? (
                                <SecondaryButton tokens={tokens} onClick={() => download(done.chain.map((cert) => cert.pem).join(''), 'chain.pem', 'application/x-pem-file')}>{`Download chain.pem (${done.chain.length})`}</SecondaryButton>
                            ) : null}
                        </div>
                        <div>
                            <Label tokens={tokens}>PACK THE SAME KEY AND CERTIFICATES AGAIN, WITH THE PASSWORD ABOVE</Label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                <SecondaryButton tokens={tokens} onClick={() => repack(false)}>Modern .p12: AES-256, SHA-256 MAC</SecondaryButton>
                                <SecondaryButton tokens={tokens} onClick={() => repack(true)}>Legacy .p12: RC2-40 and 3DES, SHA-1 MAC</SecondaryButton>
                            </div>
                            {repackError ? <Failure tokens={tokens} message={repackError} /> : null}
                        </div>
                        <Block tokens={tokens} label="CERTIFICATE, OPENSSL X509 -TEXT" text={done.certificate.text} maxHeight={220} />
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open a .p12 or .pfx file, or try a sample, to see what is inside.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/pfx_tool.h', code: PFX_WRAPPER },
                { file: 'main.js', code: PFX_USAGE },
            ]}
        />
    );
}
PfxUnpacker.appId = 'openssl-pfx';

export const OPENSSL_APPS = [CertificateStudio, TlsLabApp, PfxUnpacker];

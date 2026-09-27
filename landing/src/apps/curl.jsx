import { useState } from 'react';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { Hint, Meta, Placeholder, Select, Stat } from './controls.jsx';

// The curl apps on /ports/curl/. Each one drives landing/demos/lib-curl, whose index.html checks
// libcurl's side of every app against the host's own libcurl, curl's lib1560 URL tests and Python.
// None of them opens a connection: in a browser this port hands transfers to fetch, so the apps use
// the parts of libcurl that need no network, beside the browser's own parsers.

const NOTE = 'No request is made: these are libcurl 8.22.0 parsers running in this tab.';
const DEFAULT_PORTS = { 'http:': '80', 'https:': '443', 'ftp:': '21', 'ws:': '80', 'wss:': '443' };

// This browser's reading of a URL, in the shape UrlLab returns. Runs only in event handlers.
function browserParts(url, location = '') {
    try {
        const parsed = location ? new URL(location, url) : new URL(url);
        const or = (value) => value || null;
        return {
            ok: true,
            url: parsed.href,
            scheme: parsed.protocol.slice(0, -1),
            user: or(parsed.username),
            password: or(parsed.password),
            host: or(parsed.hostname),
            port: or(parsed.port),
            connectPort: or(parsed.port || DEFAULT_PORTS[parsed.protocol]),
            path: or(parsed.pathname),
            query: or(parsed.search.slice(1)),
            fragment: or(parsed.hash.slice(1)),
            zoneid: null,
        };
    } catch (error) {
        return { ok: false, error: error?.message ?? String(error) };
    }
}

const sameHost = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

function TextInput({ tokens, label, value, onChange, placeholder }) {
    return (
        <label style={{ display: 'block', minWidth: 0 }}>
            <Label tokens={tokens}>{label}</Label>
            <input type="text" spellCheck={false} value={value} placeholder={placeholder} onInput={(event) => onChange(event.target.value)} style={fieldStyle(tokens)} />
        </label>
    );
}

// App 1: the same URL through a JavaScript check and through libcurl.

const TRICKS = [
    { label: 'A backslash before @', template: 'http://{allowed}\\@{other}/' },
    { label: 'A port, then a backslash', template: 'http://{allowed}:80\\@{other}/' },
    { label: 'The same trick on ftp://', template: 'ftp://{allowed}\\@{other}/' },
    { label: 'The allowed host as a user name', template: 'http://{allowed}@{other}/' },
    { label: 'The allowed host after #', template: 'http://{other}#@{allowed}/' },
    { label: 'An @ after ?', template: 'http://{allowed}?@{other}/' },
    { label: 'The backslash trick the other way round', template: 'http://{other}\\@{allowed}/' },
    { label: 'A backslash inside the host', template: 'http://{allowed}\\.{other}/' },
    { label: 'No slashes after the scheme', template: 'https:{other}/' },
];
const HOST_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i;

function verdictOf(row, allowed) {
    if (!row.browser.ok) return { kind: 'blocked', text: 'The check rejects it: this browser cannot parse it' };
    if (!sameHost(row.browser.host, allowed)) return { kind: 'blocked', text: 'The check stops it' };
    if (!row.curl.ok) return { kind: 'refused', text: `Passes the check; libcurl refuses it: ${row.curl.error}` };
    if (sameHost(row.curl.host, allowed)) return { kind: 'same', text: `Passes the check; libcurl goes to ${row.curl.host} too` };
    return { kind: 'bypass', text: `Passes the check, and libcurl connects to ${row.curl.host}` };
}

const FILTER_WRAPPER = `// src/support/url_json.h (excerpt)
// The flags libcurl 8.22.0 itself parses CURLOPT_URL with (lib/url.c).
constexpr unsigned int TRANSFER = CURLU_GUESS_SCHEME | CURLU_NON_SUPPORT_SCHEME;

CURLU* handle = curl_url();
CURLUcode code = curl_url_set(handle, CURLUPART_URL, url.c_str(), TRANSFER);
if (code != CURLUE_OK) return failure(code);   // with curl_url_strerror(code)

char* host = nullptr;
curl_url_get(handle, CURLUPART_HOST, &host, 0);`;

const FILTER_USAGE = `const m = await initNative();
const input = 'http://example.com\\\\@attacker.example/';

// The check a server runs before it hands the URL to libcurl:
new URL(input).hostname === 'example.com';   // true

// Where libcurl will connect:
const parts = JSON.parse(await m.UrlLab.parse(input));
// parts.host: 'attacker.example', parts.user: 'example.com\\\\'`;

export function FilterCheck({ tokens, index, load }) {
    const [allowed, setAllowed] = useState('example.com');
    const [other, setOther] = useState('attacker.example');
    const [state, run] = useNativeTask(load);
    const start = () =>
        run(async (m) => {
            const hosts = [allowed.trim(), other.trim()];
            if (!hosts.every((host) => HOST_NAME.test(host))) throw new Error('Enter two host names, such as example.com.');
            if (sameHost(hosts[0], hosts[1])) throw new Error('Enter two different host names.');
            const rows = [];
            for (const trick of TRICKS) {
                const url = trick.template.replace('{allowed}', hosts[0]).replace('{other}', hosts[1]);
                const row = { ...trick, url, browser: browserParts(url), curl: JSON.parse(await m.UrlLab.parse(url)) };
                rows.push({ ...row, verdict: verdictOf(row, hosts[0]) });
            }
            return { allowed: hosts[0], rows };
        });
    const done = state.status === 'ready' ? state.result : null;
    const count = (kind) => done.rows.filter((row) => row.verdict.kind === kind).length;
    return (
        <AppCard
            tokens={tokens}
            id="curl-filter"
            index={index}
            status={state.status}
            title="Test a URL allowlist against libcurl's own parser"
            pitch="A server that checks a URL with JavaScript's URL parser and then fetches it with libcurl runs two parsers. Where they disagree, a URL can pass the check and send libcurl to a host the check never saw. Enter the host your check allows and one it must keep out: each URL below is parsed by libcurl 8.22.0, with the flags curl_easy_perform uses, beside this browser's URL."
            note={NOTE}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <TextInput tokens={tokens} label="THE CHECK ALLOWS" value={allowed} onChange={setAllowed} />
                    <TextInput tokens={tokens} label="AND MUST KEEP OUT" value={other} onChange={setOther} />
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Run both parsers</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        The check is the usual one: new URL(input).hostname must equal the allowed host. libcurl parses CURLOPT_URL with CURLU_GUESS_SCHEME and
                        CURLU_NON_SUPPORT_SCHEME, so the host below is the one a transfer would connect to.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16 }}>
                            <Stat tokens={tokens} warn={count('bypass') > 0} accent={count('bypass') === 0} value={`${count('bypass')} of ${done.rows.length}`} label={`pass the check and send libcurl away from ${done.allowed}`} />
                            <Stat tokens={tokens} value={count('blocked')} label="stopped by the check" />
                            <Stat tokens={tokens} value={count('refused')} label="pass the check, refused by libcurl" />
                        </div>
                        <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, overflow: 'hidden' }}>
                            {done.rows.map((row, position) => (
                                <div
                                    key={row.template}
                                    data-verdict={row.verdict.kind}
                                    style={{
                                        padding: '10px 12px',
                                        borderTop: position ? `1px solid ${tokens.border}` : 'none',
                                        borderLeft: `3px solid ${row.verdict.kind === 'bypass' ? tokens.warn : 'transparent'}`,
                                    }}
                                >
                                    <div style={{ fontSize: 12.5, color: tokens.textDim }}>{row.label}</div>
                                    <div style={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.text, marginTop: 3, overflowWrap: 'anywhere' }}>{row.url}</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6, marginTop: 6, fontFamily: tokens.mono, fontSize: 11.5, color: tokens.textMuted }}>
                                        <span style={{ overflowWrap: 'anywhere' }}>
                                            {'new URL(): '}
                                            <span style={{ color: tokens.text }}>{row.browser.ok ? row.browser.host : 'no URL'}</span>
                                        </span>
                                        <span style={{ overflowWrap: 'anywhere' }}>
                                            {'libcurl: '}
                                            <span style={{ color: tokens.text }}>{row.curl.ok ? row.curl.host : 'refused'}</span>
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 5, color: row.verdict.kind === 'bypass' ? tokens.warn : tokens.textMuted, overflowWrap: 'anywhere' }}>{row.verdict.text}</div>
                                </div>
                            ))}
                        </div>
                        <Meta tokens={tokens}>
                            libcurl ends the host part at the first /, ? or # and reads what comes before its first @ as user information, so a backslash stays inside it.
                            WHATWG URL parsers read a backslash in an http, https or ftp URL as a slash, which ends the host.
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Run both parsers to see which URLs pass the check and where libcurl would go.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/url_json.h', code: FILTER_WRAPPER },
                { file: 'main.js', code: FILTER_USAGE },
            ]}
        />
    );
}
FilterCheck.appId = 'curl-filter';

// App 2: every part of one URL, libcurl beside this browser.

const PRESETS = [
    { id: 'backslash', label: 'A backslash before @', url: 'http://example.com\\@attacker.example/', note: 'libcurl reads example.com\\ as a user name and connects to attacker.example. A WHATWG parser reads the backslash as a slash.' },
    { id: 'case', label: 'Capitals and the default port', url: 'HTTPS://EXAMPLE.COM:443/', note: 'libcurl lowercases the scheme but keeps the host as written and keeps :443. A WHATWG parser lowercases the host and drops a default port.' },
    { id: 'path', label: 'A backslash in the path', url: 'http://example.com/\\foo', note: 'libcurl keeps the backslash in the path. A WHATWG parser turns it into a second slash.' },
    { id: 'idn', label: 'A host name in Japanese', url: 'http://例え.jp/', note: 'This libcurl is built without IDN support, so it keeps the name in UTF-8. Browsers convert it to punycode.' },
    { id: 'ipv4', label: 'An IPv4 address in hex shorthand', url: 'http://0x7f.1/', note: 'Both parsers read 0x7f.1 as 127.0.0.1, a loopback address that a filter on the text 127.0.0.1 would miss.' },
    { id: 'numbers', label: 'A host of five numbers', url: 'http://1.2.3.4.5/', note: 'libcurl takes 1.2.3.4.5 as a host name. The URL standard tries it as an IPv4 address and fails.' },
    { id: 'space', label: 'A space in the host', url: 'http://a b.com/', note: 'libcurl refuses it, and so does the URL standard; Chromium accepts it as a%20b.com.' },
    { id: 'zone', label: 'An IPv6 address with a zone id', url: 'http://[fe80::1%25eth0]:8080/', note: 'libcurl reads the zone id, eth0. WHATWG URLs have no zone ids. This build has IPv6 off, so it parses the address but cannot connect to it.' },
    { id: 'dots', label: 'Dot segments', url: 'https://example.com/a/b/../../c/./d?x=1#top', note: 'Both parsers remove them. CURLOPT_PATH_AS_IS keeps them in libcurl.' },
    { id: 'guess', label: 'No scheme at all', url: 'ftp.example.com/file', note: 'libcurl guesses a scheme from the host name, as it does for any URL set with CURLOPT_URL: a name starting with ftp. gets ftp://, one without a known prefix gets http://. A browser needs a scheme.' },
    { id: 'redirect', label: 'A redirect to ..\\evil', url: 'https://example.com/a/b/c', location: '..\\evil', note: 'Following a Location header, libcurl keeps the backslash in the path. A WHATWG parser reads it as a slash and climbs a directory.' },
    { id: 'rfc3986', label: 'A reference from RFC 3986', url: 'http://a/b/c/d;p?q', location: '../../../g', note: 'The example from RFC 3986, section 5.4.1: both parsers give http://a/g.' },
];

const PARTS = [
    ['scheme', 'scheme'],
    ['user', 'user'],
    ['password', 'password'],
    ['host', 'host'],
    ['port', 'port'],
    ['connects to port', 'connectPort'],
    ['path', 'path'],
    ['query', 'query'],
    ['fragment', 'fragment'],
    ['zone id', 'zoneid'],
];

const LAB_WRAPPER = `// src/support/url_json.h (excerpt)
// The flags libcurl 8.22.0 passes itself: lib/url.c for CURLOPT_URL,
// lib/http.c for a Location header it follows.
constexpr unsigned int TRANSFER = CURLU_GUESS_SCHEME | CURLU_NON_SUPPORT_SCHEME;
constexpr unsigned int REDIRECT = CURLU_URLENCODE | CURLU_ALLOW_SPACE;

CURLUcode code = curl_url_set(handle, CURLUPART_URL, url.c_str(), TRANSFER);
if (code == CURLUE_OK && !reference.empty())
    code = curl_url_set(handle, CURLUPART_URL, reference.c_str(), REDIRECT);

// Then one curl_url_get per part; CURLUE_NO_QUERY and the like become null.
char* value = nullptr;
curl_url_get(handle, CURLUPART_PORT, &value, CURLU_DEFAULT_PORT);`;

const LAB_USAGE = `const m = await initNative();
const parts = JSON.parse(await m.UrlLab.parse('HTTPS://EXAMPLE.COM:443/'));
// parts.url: 'https://EXAMPLE.COM:443/', parts.host: 'EXAMPLE.COM', parts.port: '443'
new URL('HTTPS://EXAMPLE.COM:443/').href;   // 'https://example.com/'

const next = JSON.parse(await m.UrlLab.follow('https://example.com/a/b/c', '..\\\\evil'));
// next.url: 'https://example.com/a/b/..\\\\evil'
new URL('..\\\\evil', 'https://example.com/a/b/c').href;   // 'https://example.com/a/evil'`;

function WholeUrl({ tokens, label, result }) {
    return (
        <div style={{ minWidth: 0 }}>
            <Label tokens={tokens}>{label}</Label>
            <div
                style={{
                    fontFamily: tokens.mono,
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: result.ok ? tokens.codeText : tokens.warn,
                    background: tokens.codeBg,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 9,
                    padding: '8px 11px',
                    overflowWrap: 'anywhere',
                }}
            >
                {result.ok ? result.url : `refused: ${result.error}`}
            </div>
        </div>
    );
}

function PartsTable({ tokens, curl, browser }) {
    const both = curl.ok && browser.ok;
    const cell = { padding: '6px 8px', borderTop: `1px solid ${tokens.border}`, fontFamily: tokens.mono, fontSize: 12, overflowWrap: 'anywhere', verticalAlign: 'top' };
    const shown = (result, key) => {
        if (!result.ok) return <span style={{ color: tokens.textMuted }}>no URL</span>;
        if (key === 'zoneid' && result === browser) return <span style={{ color: tokens.textMuted }}>no such part</span>;
        return result[key] === null ? <span style={{ color: tokens.textMuted }}>none</span> : result[key];
    };
    return (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
                <tr>
                    {['PART', 'LIBCURL', 'THIS BROWSER'].map((head) => (
                        <th key={head} style={{ textAlign: 'left', padding: '0 8px 6px', fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, fontWeight: 400, color: tokens.textMuted, width: head === 'PART' ? '28%' : '36%' }}>
                            {head}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {PARTS.map(([label, key]) => {
                    const differs = both && key !== 'zoneid' && curl[key] !== browser[key];
                    return (
                        <tr key={key} data-differs={differs ? '' : undefined}>
                            <td style={{ ...cell, fontFamily: tokens.sans, fontSize: 12.5, color: differs ? tokens.accentText : tokens.textDim }}>{differs ? `${label} ≠` : label}</td>
                            <td style={{ ...cell, color: differs ? tokens.accentText : tokens.text }}>{shown(curl, key)}</td>
                            <td style={{ ...cell, color: differs ? tokens.accentText : tokens.text }}>{shown(browser, key)}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

export function UrlLab({ tokens, index, load }) {
    const [preset, setPreset] = useState(PRESETS[0].id);
    const [url, setUrl] = useState(PRESETS[0].url);
    const [location, setLocation] = useState('');
    const [state, run] = useNativeTask(load);
    const pickPreset = (id) => {
        const next = PRESETS.find((item) => item.id === id);
        setPreset(id);
        setUrl(next.url);
        setLocation(next.location ?? '');
    };
    const start = () =>
        run(async (m) => {
            const input = url.trim();
            const reference = location.trim();
            if (!input) throw new Error('Enter a URL.');
            const curl = JSON.parse(reference ? await m.UrlLab.follow(input, reference) : await m.UrlLab.parse(input));
            const chosen = PRESETS.find((item) => item.id === preset);
            const note = chosen && chosen.url === input && (chosen.location ?? '') === reference ? chosen.note : null;
            return { curl, browser: browserParts(input, reference), reference, note };
        });
    const done = state.status === 'ready' ? state.result : null;
    const differing = done && done.curl.ok && done.browser.ok ? PARTS.filter(([, key]) => key !== 'zoneid' && done.curl[key] !== done.browser[key]).length : null;
    return (
        <AppCard
            tokens={tokens}
            id="curl-url-lab"
            index={index}
            status={state.status}
            title="Take a URL apart the way libcurl does, beside your browser"
            pitch="Paste a URL, and a Location header to follow if you like, to see every part libcurl reads next to what this browser's URL reads. Parts that differ are marked. The examples are known differences: backslashes, capitals and default ports, host names in other scripts, IPv4 shorthand, zone ids and redirects."
            note={NOTE}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="EXAMPLES" value={preset} onChange={pickPreset}>
                        {PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </Select>
                    <TextInput tokens={tokens} label="URL" value={url} onChange={setUrl} />
                    <TextInput tokens={tokens} label="LOCATION HEADER TO FOLLOW (OPTIONAL)" value={location} onChange={setLocation} placeholder="../next?page=2" />
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Parse with libcurl</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        libcurl parses the URL with the flags it uses for CURLOPT_URL, CURLU_GUESS_SCHEME and CURLU_NON_SUPPORT_SCHEME, and a Location header with the ones
                        it uses when it follows a redirect, CURLU_URLENCODE and CURLU_ALLOW_SPACE.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 14 }}>
                        {done.note ? <div style={{ fontSize: 13.5, lineHeight: 1.6, color: tokens.textDim }}>{done.note}</div> : null}
                        <WholeUrl tokens={tokens} label={done.reference ? 'LIBCURL FOLLOWS THE REDIRECT TO' : 'LIBCURL'} result={done.curl} />
                        <WholeUrl tokens={tokens} label={done.reference ? 'THIS BROWSER RESOLVES IT TO' : 'THIS BROWSER'} result={done.browser} />
                        <PartsTable tokens={tokens} curl={done.curl} browser={done.browser} />
                        <Meta tokens={tokens}>
                            {differing === null
                                ? 'Only one parser accepts this URL.'
                                : differing
                                  ? `${differing} of ${PARTS.length - 1} parts differ.`
                                  : 'Both parsers read every part the same way.'}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Parse a URL to see each part as libcurl and this browser read it.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/url_json.h', code: LAB_WRAPPER },
                { file: 'main.js', code: LAB_USAGE },
            ]}
        />
    );
}
UrlLab.appId = 'curl-url-lab';

// App 3: HTTP dates through curl_getdate and through Date.parse.

const DATES = [
    { text: 'Sun, 06 Nov 1994 08:49:37 GMT', note: 'The format HTTP servers send (RFC 9110)' },
    { text: 'Sunday, 06-Nov-94 08:49:37 GMT', note: 'The obsolete RFC 850 format, with a two-digit year' },
    { text: 'Sun Nov  6 08:49:37 1994', note: "C's asctime format, which has no zone: curl takes GMT" },
    { text: 'Thu, 01-Jan-70 00:00:01 GMT', note: 'A date servers send to delete a cookie. curl reads a two-digit 70 as 2070, RFC 6265 as 1970' },
    { text: 'Sun, 06 Nov 1994 08:49:37 CEST', note: 'A zone written as its name: curl knows CEST, UTC+2' },
    { text: 'Sun, 06 Nov 1994 08:49:37 GMT+0100', note: 'An offset after GMT: curl reads the time as plain GMT' },
    { text: '1994-11-06T08:49:37Z', note: 'ISO 8601, which curl_getdate does not read' },
    { text: 'Mon, 30 Feb 2026 12:00:00 GMT', note: 'A day February does not have: curl rolls it over to 2 March' },
];
const MAX_LINES = 50;
const DAY = 86400000;

const isoOf = (milliseconds) => new Date(milliseconds).toISOString().replace('.000Z', 'Z');

const counted = (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'}`;

function gapOf(milliseconds) {
    const size = Math.abs(milliseconds);
    if (size >= 365 * DAY) return counted(Math.round(size / (365.2425 * DAY)), 'year');
    if (size >= DAY) return counted(Math.round(size / DAY), 'day');
    if (size >= 3600000) return counted(Math.round((size / 3600000) * 10) / 10, 'hour');
    return counted(Math.round(size / 60000), 'minute');
}

function compare(curlSeconds, browserMilliseconds) {
    const curlReads = curlSeconds !== -1;
    const browserReads = !Number.isNaN(browserMilliseconds);
    if (!curlReads && !browserReads) return { same: true, text: 'Neither reads it' };
    if (!curlReads) return { same: false, text: 'Only this browser reads it' };
    if (!browserReads) return { same: false, text: 'Only curl reads it' };
    const gap = browserMilliseconds - curlSeconds * 1000;
    return gap === 0 ? { same: true, text: 'Same instant' } : { same: false, text: `${gapOf(gap)} apart` };
}

const DATES_WRAPPER = `// src/native/http_dates.h (excerpt)
// Seconds since 1970-01-01 UTC, or -1 when curl cannot read the text as a date.
static double seconds(const std::string& text) {
    return static_cast<double>(curl_getdate(text.c_str(), nullptr));
}`;

const DATES_USAGE = `const m = await initNative();
await m.HttpDates.seconds('Sun Nov  6 08:49:37 1994');     // 784111777: GMT
Date.parse('Sun Nov  6 08:49:37 1994') / 1000;             // local time

await m.HttpDates.iso('Thu, 01-Jan-70 00:00:01 GMT');      // '2070-01-01T00:00:01Z'`;

export function DateLab({ tokens, index, load }) {
    const [text, setText] = useState(DATES.map((date) => date.text).join('\n'));
    const [state, run] = useNativeTask(load);
    const start = () =>
        run(async (m) => {
            const lines = text
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
            if (!lines.length) throw new Error('Enter at least one date.');
            if (lines.length > MAX_LINES) throw new Error(`Enter at most ${MAX_LINES} dates.`);
            const rows = [];
            for (const line of lines) {
                const seconds = await m.HttpDates.seconds(line);
                const milliseconds = Date.parse(line);
                rows.push({
                    line,
                    note: DATES.find((date) => date.text.replace(/\s+/g, ' ') === line.replace(/\s+/g, ' '))?.note ?? null,
                    curl: seconds === -1 ? 'not a date' : await m.HttpDates.iso(line),
                    browser: Number.isNaN(milliseconds) ? 'not a date' : isoOf(milliseconds),
                    ...compare(seconds, milliseconds),
                });
            }
            return { rows, zone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'an unknown zone' };
        });
    const done = state.status === 'ready' ? state.result : null;
    const differing = done ? done.rows.filter((row) => !row.same).length : 0;
    return (
        <AppCard
            tokens={tokens}
            id="curl-dates"
            index={index}
            status={state.status}
            title="Read HTTP dates the way curl does"
            pitch="curl_getdate is how libcurl reads Last-Modified, Expires and cookie dates. Paste dates, one per line, to see what it makes of each next to this browser's Date.parse. They part ways on dates without a zone, on two-digit years such as 70, on zone names Date.parse does not know, and on ISO 8601."
            note={NOTE}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <label style={{ display: 'block', minWidth: 0 }}>
                        <Label tokens={tokens}>DATES, ONE PER LINE</Label>
                        <textarea value={text} rows={8} spellCheck={false} onInput={(event) => setText(event.target.value)} style={{ ...fieldStyle(tokens), resize: 'vertical', fontSize: 12 }} />
                    </label>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Read the dates</RunButton>
                    </div>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <Stat tokens={tokens} accent value={`${differing} of ${done.rows.length}`} label="read differently by curl_getdate and this browser's Date.parse" />
                        <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, overflow: 'hidden' }}>
                            {done.rows.map((row, position) => (
                                <div
                                    key={`${position}-${row.line}`}
                                    data-same={row.same ? 'true' : 'false'}
                                    style={{ padding: '10px 12px', borderTop: position ? `1px solid ${tokens.border}` : 'none', borderLeft: `3px solid ${row.same ? 'transparent' : tokens.accent}` }}
                                >
                                    <div style={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.line}</div>
                                    {row.note ? <div style={{ fontSize: 12.5, lineHeight: 1.5, color: tokens.textMuted, marginTop: 3 }}>{row.note}</div> : null}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6, marginTop: 6, fontFamily: tokens.mono, fontSize: 11.5, color: tokens.textMuted }}>
                                        <span>
                                            {'curl_getdate: '}
                                            <span style={{ color: tokens.text }}>{row.curl}</span>
                                        </span>
                                        <span>
                                            {'Date.parse: '}
                                            <span style={{ color: tokens.text }}>{row.browser}</span>
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 12.5, marginTop: 5, color: row.same ? tokens.textMuted : tokens.accentText }}>{row.text}</div>
                                </div>
                            ))}
                        </div>
                        <Meta tokens={tokens}>{`Both columns are UTC. Date.parse reads a date without a zone as local time, here ${done.zone}; curl_getdate reads it as GMT.`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Read the dates to see each one through curl_getdate and through Date.parse.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/http_dates.h', code: DATES_WRAPPER },
                { file: 'main.js', code: DATES_USAGE },
            ]}
        />
    );
}
DateLab.appId = 'curl-dates';

export const CURL_APPS = [FilterCheck, UrlLab, DateLab];

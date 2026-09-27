import { useState } from 'react';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Select, Stat } from './controls.jsx';

// The iconv apps on /ports/iconv/. Each one drives landing/demos/lib-iconv, whose index.html checks the
// same calls against CPython's codecs, the WHATWG Encoding Standard's indexes, RFC examples and
// Unicode's mapping tables.

const DIRECTORY = '/memfs/iconvapps';

const unitsOf = (hex) => String.fromCharCode(...hex.split(' ').map((byte) => parseInt(byte, 16)));
const toBytes = (units) => Uint8Array.from(units, (unit) => unit.charCodeAt(0));

// libiconv's names, as people know these code pages.
const NAMES = {
    CP1250: 'Windows-1250',
    CP1251: 'Windows-1251',
    CP1252: 'Windows-1252',
    CP1253: 'Windows-1253',
    CP1254: 'Windows-1254',
    CP866: 'DOS 866',
    CP850: 'DOS 850',
    MACINTOSH: 'Mac Roman',
    CP932: 'Shift_JIS (Windows)',
    CP936: 'GBK',
    CP950: 'Big5',
    CP949: 'EUC-KR (Windows)',
};
const named = (encoding) => NAMES[encoding] ?? encoding;

function Chip({ tokens, onClick, title, children }) {
    return (
        <button
            type="button"
            className="tap-target"
            onClick={onClick}
            title={title}
            style={{ background: tokens.codeBg, color: tokens.codeText, border: `1px solid ${tokens.border}`, padding: '5px 9px', borderRadius: 7, fontFamily: tokens.mono, fontSize: 12.5, cursor: 'pointer' }}
        >
            {children}
        </button>
    );
}

function Note({ tokens, warn, children }) {
    return (
        <div style={{ border: `1px solid ${warn ? tokens.warn : tokens.border}`, borderRadius: 9, padding: '9px 12px', fontSize: 13, lineHeight: 1.6, color: warn ? tokens.warn : tokens.textDim, marginTop: 12 }}>{children}</div>
    );
}

// Mojibake doctor ------------------------------------------------------------------------------------

const MOJIBAKE = [
    ['Ã©tÃ©', 'French saved as UTF-8, opened as Windows-1252'],
    ['ÐŸÑ€Ð¸Ð²ÐµÑ‚', 'Russian saved as UTF-8, opened as Windows-1252'],
    ['Ä°stanbul', 'Turkish saved as UTF-8, opened as Windows-1252'],
    ['ÃƒÂ©tÃƒÂ©', 'the same mistake made twice'],
    ['æ–‡å­—åŒ–ã\u0081‘', 'Japanese saved as UTF-8, opened as Windows-1252'],
    ['縺薙ｓ縺ｫ縺｡縺ｯ', 'Japanese saved as UTF-8, opened as Shift_JIS'],
    ['“ú–{Œê', 'Japanese saved as Shift_JIS, opened as Windows-1252'],
    ['Ïðèâåò', 'Russian saved as Windows-1251, opened as Windows-1252'],
    ['ÇÑ±¹¾î', 'Korean saved as EUC-KR, opened as Windows-1252'],
];

const describe = (steps) => {
    const first = `${named(steps[0].saved)} bytes opened as ${named(steps[0].opened)}`;
    return steps.length === 1 ? first : `${first}, ${steps.length === 2 ? 'twice' : `${steps.length} times`}`;
};

const DOCTOR_WRAPPER = `// src/native/mojibake_doctor.h (excerpt)
for (size_t o = 0; o < openedAs().size(); o += 1) {
    const std::string& opened = openedAs()[o];
    // Back to the bytes the text came from: the encoder browsers lack.
    const recode::Result bytes = recode::convert(garbled, "UTF-8", opened, readLikeBrowsers(opened));
    if (!bytes.ok) continue;
    for (size_t s = 0; s < savedAs().size(); s += 1) {
        if (savedAs()[s] == opened) continue;
        // Strict: a reading exists only when every byte decodes.
        recode::Result step = recode::convert(bytes.output, savedAs()[s], "UTF-8");
        // ... then the same mistake undone up to three times for UTF-8
    }
}`;

const DOCTOR_USAGE = `const m = await initNative();
const repairs = JSON.parse(await m.MojibakeDoctor.repair('Ã©tÃ©', 3));
repairs[0].text;   // 'été'
repairs[0].steps;  // [{ saved: 'UTF-8', opened: 'CP1252' }]`;

export function MojibakeDoctorApp({ tokens, index, load }) {
    const [text, setText] = useState(MOJIBAKE[0][0]);
    const [original, setOriginal] = useState('naïve café, Größe, İstanbul');
    const [saved, setSaved] = useState('UTF-8');
    const [opened, setOpened] = useState('CP1252');
    const [state, run] = useNativeTask(load);
    const [garbling, runGarble] = useNativeTask(load);
    const repair = (input) =>
        run(async (m) => {
            const repairs = JSON.parse(await m.MojibakeDoctor.repair(input, 3));
            const last = repairs[0]?.steps.at(-1);
            return { input, repairs, bytes: last ? await m.MojibakeDoctor.bytesHex(input, last.opened, 36) : '' };
        });
    const garble = () =>
        runGarble(async (m) => {
            const garbled = await m.MojibakeDoctor.garble(original, saved, opened);
            setText(garbled);
            return garbled;
        });
    const result = state.status === 'ready' ? state.result : null;
    const best = result?.repairs[0];
    return (
        <AppCard
            tokens={tokens}
            id="iconv-mojibake"
            index={index}
            status={state.status}
            title="Repair text that was opened with the wrong encoding"
            pitch="Ã©tÃ© is été whose UTF-8 bytes were read as Windows-1252. The doctor turns garbled text back into the bytes it came from, which takes a legacy encoder browsers do not have, then reads those bytes in every likely encoding and ranks what comes out. Repairs through UTF-8 are close to certain; for older code pages it shows the three likeliest readings."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div>
                        <Label tokens={tokens}>GARBLED TEXT</Label>
                        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} spellCheck={false} style={{ ...fieldStyle(tokens), resize: 'vertical' }} />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {MOJIBAKE.map(([sample, hint]) => (
                            <Chip key={sample} tokens={tokens} title={hint} onClick={() => setText(sample)}>{sample}</Chip>
                        ))}
                    </div>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={() => repair(text)}>Repair</RunButton>
                    </div>
                    <details>
                        <summary className="tap-target" style={{ cursor: 'pointer', fontSize: 13.5, color: tokens.textDim }}>Garble your own text first</summary>
                        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                            <input value={original} onChange={(event) => setOriginal(event.target.value)} spellCheck={false} style={fieldStyle(tokens)} />
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                                <Select tokens={tokens} label="SAVED AS" value={saved} onChange={setSaved} options={[['UTF-8', 'UTF-8'], ['CP932', 'Shift_JIS'], ['CP949', 'EUC-KR'], ['CP936', 'GBK'], ['CP1251', 'Windows-1251']]} />
                                <Select tokens={tokens} label="OPENED AS" value={opened} onChange={setOpened} options={[['CP1252', 'Windows-1252'], ['ISO-8859-1', 'ISO-8859-1'], ['CP1251', 'Windows-1251'], ['CP932', 'Shift_JIS'], ['MACINTOSH', 'Mac Roman']]} />
                            </div>
                            <div>
                                <SecondaryButton tokens={tokens} onClick={garble} disabled={garbling.status === 'running'}>Garble it</SecondaryButton>
                            </div>
                            {garbling.status === 'failed' ? <Failure tokens={tokens} message={garbling.message} /> : null}
                        </div>
                    </details>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result && best ? (
                    <div>
                        <Label tokens={tokens}>REPAIRED</Label>
                        <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.4, color: tokens.accentDisplay, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{best.text}</div>
                        <div style={{ fontSize: 13.5, color: tokens.textDim, marginTop: 6 }}>{describe(best.steps)}</div>
                        {result.bytes ? <Meta tokens={tokens}>{`the bytes behind it: ${result.bytes}${result.bytes.length >= 36 * 3 - 1 ? ' …' : ''}`}</Meta> : null}
                        {result.repairs.length > 1 ? (
                            <div style={{ marginTop: 16 }}>
                                <Label tokens={tokens}>OTHER READINGS</Label>
                                {result.repairs.slice(1).map((other) => (
                                    <div key={other.text} style={{ borderTop: `1px solid ${tokens.border}`, padding: '8px 0' }}>
                                        <div style={{ fontSize: 15, color: tokens.text, overflowWrap: 'anywhere' }}>{other.text}</div>
                                        <div style={{ fontSize: 12.5, color: tokens.textMuted }}>{describe(other.steps)}</div>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        <Meta tokens={tokens}>{`${grouped(state.ms)} ms in this tab`}</Meta>
                    </div>
                ) : result ? (
                    <Placeholder tokens={tokens}>No repair found: every likely reading of these characters looks at least as odd as the text itself.</Placeholder>
                ) : (
                    <Placeholder tokens={tokens}>Pick a sample or paste garbled text, then repair it.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/mojibake_doctor.h', code: DOCTOR_WRAPPER },
                { file: 'main.js', code: DOCTOR_USAGE },
            ]}
        />
    );
}
MojibakeDoctorApp.appId = 'iconv-mojibake';

// Legacy exporter ------------------------------------------------------------------------------------

const CUSTOMERS = '山田太郎,ﾔﾏﾀﾞ ﾀﾛｳ,03-1234-5678,表計算ソフト\n佐藤花子,ｻﾄｳ ﾊﾅｺ,06-9876-5432,①至急 €50\n';

const TARGETS = [
    ['CP932', 'Shift_JIS, Windows (CP932)'],
    ['SHIFT_JIS', 'Shift_JIS, JIS X 0208'],
    ['EUC-JP', 'EUC-JP'],
    ['GB18030', 'GB18030'],
    ['CP936', 'GBK (CP936)'],
    ['CP950', 'Big5 (CP950)'],
    ['BIG5-HKSCS', 'Big5-HKSCS'],
    ['CP949', 'Korean, Windows (CP949)'],
    ['EUC-KR', 'EUC-KR'],
    ['CP1251', 'Windows-1251'],
    ['KOI8-R', 'KOI8-R'],
    ['CP1250', 'Windows-1250'],
    ['CP1252', 'Windows-1252'],
    ['CP1254', 'Windows-1254'],
    ['ISO-8859-15', 'ISO-8859-15'],
    ['CP850', 'DOS 850'],
];

const EXPORT_WRAPPER = `// src/native/legacy_export.h (excerpt): one fixed-width field
for (size_t at = 0; at < value.size(); column += 1) {
    const std::string character = value.substr(at, text::sequenceLength(static_cast<unsigned char>(value[at])));
    at += character.size();
    std::string bytes;  // this one character in the target encoding
    if (!encodeOne(cd, character, line, column, out, bytes)) {
        shown.emplace_back(character, "");
        continue;
    }
    if (cut || written.size() + bytes.size() > width) {
        cut = true;  // whole characters only
        continue;
    }
    written += bytes;
    shown.emplace_back(character, text::hex(bytes, bytes.size()));
}`;

const EXPORT_USAGE = `const m = await initNative();
const rows = '山田太郎,ﾔﾏﾀﾞ ﾀﾛｳ,03-1234-5678\\n';
const report = JSON.parse(await m.LegacyExport.report(rows, 'CP932', '', '8,10,12'));
// report.bytes 32, report.problems [], report.backslashes []
const file = await m.LegacyExport.file(rows, 'CP932', 'TRANSLIT', '8,10,12');
const bytes = Uint8Array.from(file, (c) => c.charCodeAt(0));`;

function ByteCells({ tokens, cells }) {
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {cells.map(([character, hex], position) => {
                const lost = hex === '';
                const trail = !lost && hex.split(' ').slice(1).includes('5c');
                return (
                    <div
                        key={position}
                        title={lost ? 'no form in this encoding' : trail ? 'ends in 0x5C, the backslash byte' : undefined}
                        style={{ border: `1px solid ${lost ? tokens.warn : trail ? tokens.accent : tokens.border}`, borderRadius: 6, padding: '3px 5px', textAlign: 'center', minWidth: 22 }}
                    >
                        <div style={{ fontSize: 13, color: lost ? tokens.warn : tokens.text, whiteSpace: 'pre' }}>{character.replace(/ /g, '·')}</div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 10, color: trail ? tokens.accentText : tokens.textMuted, whiteSpace: 'nowrap' }}>{lost ? '—' : hex}</div>
                    </div>
                );
            })}
        </div>
    );
}

export function LegacyExporter({ tokens, index, load }) {
    const [rows, setRows] = useState(CUSTOMERS);
    const [encoding, setEncoding] = useState('CP932');
    const [policy, setPolicy] = useState('');
    const [layout, setLayout] = useState('');
    const [widths, setWidths] = useState('8,10,12,10');
    const [state, run] = useNativeTask(load);
    const start = () =>
        run(async (m) => {
            const columns = layout === 'fixed' ? widths : '';
            const report = JSON.parse(await m.LegacyExport.report(rows, encoding, policy, columns));
            const file = report.problems.length ? null : toBytes(await m.LegacyExport.file(rows, encoding, policy, columns));
            return { report, file, encoding, policy, layout };
        });
    const result = state.status === 'ready' ? state.result : null;
    const report = result?.report;
    return (
        <AppCard
            tokens={tokens}
            id="iconv-export"
            index={index}
            status={state.status}
            title="Write the exact bytes a legacy system imports"
            pitch="Banks, ERPs and government systems still import Shift_JIS, GB18030, Big5, EUC-KR or Windows-125x files, and TextEncoder only writes UTF-8. This exporter writes them byte for byte in this tab, names every character the target cannot hold, and pads fixed-width fields by bytes without splitting a character."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div>
                        <Label tokens={tokens}>ROWS, ONE PER LINE</Label>
                        <textarea value={rows} onChange={(event) => setRows(event.target.value)} rows={4} spellCheck={false} style={{ ...fieldStyle(tokens), resize: 'vertical' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                        <Select tokens={tokens} label="ENCODING" value={encoding} onChange={setEncoding} options={TARGETS} />
                        <Select tokens={tokens} label="CHARACTERS IT LACKS" value={policy} onChange={setPolicy} options={[['', 'Stop and list them'], ['TRANSLIT', 'Approximate (//TRANSLIT)'], ['IGNORE', 'Drop (//IGNORE)']]} />
                        <Select tokens={tokens} label="LAYOUT" value={layout} onChange={setLayout} options={[['', 'As typed, CRLF'], ['fixed', 'Fixed-width fields']]} />
                        {layout === 'fixed' ? (
                            <label style={{ display: 'block', minWidth: 0 }}>
                                <Label tokens={tokens}>FIELD WIDTHS, BYTES</Label>
                                <input value={widths} onChange={(event) => setWidths(event.target.value)} spellCheck={false} style={fieldStyle(tokens)} />
                            </label>
                        ) : null}
                    </div>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Export</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        For Windows software in Japan pick CP932: JIS Shift_JIS has no ① and reads byte 5C as ¥, not a backslash.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : report ? (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 14 }}>
                            <Stat tokens={tokens} accent value={`${grouped(report.bytes)} B`} label={`in ${result.encoding}, ${grouped(report.records)} records`} />
                            <Stat tokens={tokens} value={`${grouped(report.utf8Bytes)} B`} label="the same rows in UTF-8" />
                        </div>
                        {report.problems.length ? (
                            <Note tokens={tokens} warn>
                                {`${report.problems.length} character${report.problems.length === 1 ? '' : 's'} with no ${result.encoding} form: `}
                                {report.problems.slice(0, 6).map((problem) => `${problem.character} (${problem.code}) at line ${problem.line}, column ${problem.column}`).join('; ')}
                                {'. Approximate or drop them, or edit the rows, to download.'}
                            </Note>
                        ) : null}
                        {report.changed && !report.problems.length ? (
                            <Note tokens={tokens}>{`${report.changed} character${report.changed === 1 ? '' : 's'} ${result.policy === 'IGNORE' ? 'dropped' : 'approximated'}.`}</Note>
                        ) : null}
                        {report.backslashes.length ? (
                            <Note tokens={tokens}>
                                {`${report.backslashes.map((entry) => entry.character).join(' ')} end${report.backslashes.length === 1 ? 's' : ''} in byte 5C, the backslash: code that escapes or splits on "\\" breaks ${report.backslashes.length === 1 ? 'it' : 'them'}.`}
                            </Note>
                        ) : null}
                        {report.truncated.length ? (
                            <Note tokens={tokens}>{`${report.truncated.map((entry) => `field ${entry.field} of line ${entry.line}`).join(', ')} cut to fit, between characters.`}</Note>
                        ) : null}
                        <div style={{ marginTop: 16 }}>
                            <Label tokens={tokens}>LINE 1, BYTE BY BYTE</Label>
                            <ByteCells tokens={tokens} cells={report.preview[0] ?? []} />
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 16 }}>
                            <SecondaryButton tokens={tokens} disabled={!result.file} onClick={() => download(result.file, `export-${result.encoding.toLowerCase()}.${result.layout === 'fixed' ? 'txt' : 'csv'}`)}>
                                Download the file
                            </SecondaryButton>
                        </div>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Export the rows to see their bytes, what the encoding cannot hold, and the file.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/legacy_export.h', code: EXPORT_WRAPPER },
                { file: 'main.js', code: EXPORT_USAGE },
            ]}
        />
    );
}
LegacyExporter.appId = 'iconv-export';

// Legacy decoder -------------------------------------------------------------------------------------

// Bytes from sources other than libiconv: CPython's codecs, RFC 2152's own example, RFC 1922's
// escape sequences with GB 2312 codes, Unicode's CNS 11643 table and the FreeBSD iconv.
const SAMPLES = [
    { encoding: 'ISO-2022-KR', label: 'iso-2022-kr', mapped: true, text: '한국어 메일', hex: '1b 24 29 43 0e 47 51 31 39 3e 6e 0f 20 0e 38 5e 40 4f 0f' },
    { encoding: 'HZ', label: 'hz-gb-2312', mapped: true, text: '中文邮件', hex: '7e 7b 56 50 4e 44 53 4a 3c 7e 7e 7d' },
    { encoding: 'ISO-2022-CN', label: 'iso-2022-cn', mapped: true, text: '中文', hex: '1b 24 29 41 0e 56 50 4e 44 0f' },
    { encoding: 'UTF-7', label: 'utf-7', text: 'Hi Mom -☺-!', hex: '48 69 20 4d 6f 6d 20 2d 2b 4a 6a 6f 2d 2d 21' },
    { encoding: 'UTF-32LE', label: 'utf-32le', text: 'UTF-32 😀', hex: '55 00 00 00 54 00 00 00 46 00 00 00 2d 00 00 00 33 00 00 00 32 00 00 00 20 00 00 00 00 f6 01 00' },
    { encoding: 'EUC-TW', label: 'euc-tw', text: '臺灣', hex: 'ea d7 fd a4' },
    { encoding: 'CP850', label: 'ibm850', text: 'Größe, Übergröße', hex: '47 72 94 e1 65 2c 20 9a 62 65 72 67 72 94 e1 65' },
    { encoding: 'MACCENTRALEUROPE', label: 'x-mac-ce', text: 'Zażółć gęślą jaźń', hex: '5a 61 fd 97 b8 8d 20 67 ab e6 6c 88 20 6a 61 90 c4' },
    { encoding: 'VISCII', label: 'viscii', text: 'Tiếng Việt', hex: '54 69 aa 6e 67 20 56 69 ae 74' },
];

// An order list in Windows Shift_JIS, as CPython's cp932 encodes it.
const ORDERS_HEX = '92 8d 95 b6 94 d4 8d 86 2c 95 69 96 bc 0a 31 30 30 31 2c 95 5c 8c 76 8e 5a 83 5c 83 74 83 67 0a 31 30 30 32 2c 83 6d 81 5b 83 67 50 43 0a';

const SCANNED = 64 * 1024;
const SHOWN = 16 * 1024;

function browserDecode(label, bytes) {
    try {
        return { text: new TextDecoder(label).decode(bytes) };
    } catch (error) {
        return { error: error.name };
    }
}

const DECODER_WRAPPER = `// src/native/file_decoder.h (excerpt)
// Strict, except that a character cut off by the read limit is not held against the file.
static recode::Result read(const Loaded& file, const std::string& encoding) {
    recode::Result result = recode::convert(file.bytes, encoding, "UTF-8");
    if (!result.ok && result.error == EINVAL && file.bytes.size() < file.size) result.ok = true;
    return result;
}`;

const DECODER_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));   // the dropped file
const scan = JSON.parse(await m.FileDecoder.scan(path, 65536));
// scan: [{ encoding: 'CP932', ok: true, at: 46, preview: '注文番号,品名' }, ...]
const read = JSON.parse(await m.FileDecoder.decode(path, 'CP932', 16384));
// read.text, or read.error 'invalid' with read.at, read.line, read.column`;

export function LegacyDecoder({ tokens, index, load }) {
    const [gallery, runGallery] = useNativeTask(load);
    const [scan, runScan] = useNativeTask(load);
    const [view, runView] = useNativeTask(load);
    const readSamples = () =>
        runGallery(async (m) => {
            const rows = [];
            for (const sample of SAMPLES) {
                rows.push({ ...sample, iconv: await m.Charset.decode(unitsOf(sample.hex), sample.encoding), browser: browserDecode(sample.label, toBytes(unitsOf(sample.hex))) });
            }
            return rows;
        });
    const inspect = async (m, path, name, size) => ({ path, name, size, results: JSON.parse(await m.FileDecoder.scan(path, SCANNED)) });
    const openSample = () =>
        runScan(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const path = `${DIRECTORY}/orders.csv`;
            await m.FS.writeFile(path, toBytes(unitsOf(ORDERS_HEX)));
            return inspect(m, path, 'orders.csv (Windows Shift_JIS)', ORDERS_HEX.split(' ').length);
        });
    const openFile = (file) => {
        if (!file) return;
        runScan(async (m) => {
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return inspect(m, path, file.name, file.size);
        });
    };
    const opened = scan.status === 'ready' ? scan.result : null;
    const readable = opened ? opened.results.filter((entry) => entry.ok) : [];
    const utf8 = opened?.results.find((entry) => entry.encoding === 'UTF-8');
    const show = (encoding) => runView(async (m) => ({ path: opened.path, encoding, read: JSON.parse(await m.FileDecoder.decode(opened.path, encoding, SHOWN)) }));
    const shown = view.status === 'ready' && opened && view.result.path === opened.path ? view.result : null;
    const rows = gallery.status === 'ready' ? gallery.result : null;
    return (
        <AppCard
            tokens={tokens}
            id="iconv-decode"
            index={index}
            status={gallery.status === 'running' || scan.status === 'running' ? 'running' : rows || opened ? 'ready' : gallery.status}
            title="Read the encodings TextDecoder refuses"
            pitch="TextDecoder reads the Encoding Standard's list and throws a RangeError for anything else, including ISO-2022-KR, ISO-2022-CN and HZ, which the standard maps to its replacement encoding on purpose. libiconv reads those too, plus UTF-7, UTF-32, EUC-TW and old DOS and Mac code pages, strictly, with the byte where decoding stops."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={gallery.status === 'running'} onClick={readSamples}>Read nine samples</RunButton>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <SecondaryButton tokens={tokens} onClick={openSample} disabled={scan.status === 'running'}>Try every encoding on a sample file</SecondaryButton>
                        <FileButton tokens={tokens} onFile={openFile}>Open your own file</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        A file stays in this tab: it is mounted into the module's in-memory filesystem, never uploaded. Only its first 64 KB are tried; a single-byte encoding accepts almost any bytes, so read the previews.
                    </Hint>
                </div>
            }
            output={
                <div style={{ display: 'grid', gap: 18 }}>
                    {gallery.status === 'failed' ? <Failure tokens={tokens} message={gallery.message} /> : null}
                    {rows ? (
                        <div>
                            {rows.map((row) => (
                                <div key={row.encoding} style={{ borderTop: `1px solid ${tokens.border}`, padding: '9px 0' }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                                        <span style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text }}>{row.encoding}</span>
                                        <span style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.textMuted, overflowWrap: 'anywhere' }}>{row.hex.split(' ').slice(0, 10).join(' ')}{row.hex.split(' ').length > 10 ? ' …' : ''}</span>
                                    </div>
                                    <div style={{ fontSize: 16, color: tokens.accentDisplay, marginTop: 4, overflowWrap: 'anywhere' }}>{row.iconv}</div>
                                    <div style={{ fontSize: 12.5, color: tokens.textMuted, marginTop: 2 }}>
                                        {row.browser.error
                                            ? `TextDecoder('${row.label}'): ${row.browser.error}${row.mapped ? ', the label maps to "replacement"' : ', no such label'}`
                                            : `TextDecoder('${row.label}'): ${row.browser.text}`}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {scan.status === 'failed' ? <Failure tokens={tokens} message={scan.message} /> : null}
                    {opened ? (
                        <div>
                            <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, overflowWrap: 'anywhere' }}>{`${opened.name} · ${grouped(opened.size)} B`}</div>
                            <div style={{ fontSize: 13.5, color: tokens.textDim, marginTop: 4 }}>
                                {`${readable.length} of ${opened.results.length} encodings read it without an error${utf8 && !utf8.ok ? `; UTF-8 stops at byte ${grouped(utf8.at)}` : ''}.`}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, maxHeight: 150, overflow: 'auto' }}>
                                {readable.map((entry) => (
                                    <Chip key={entry.encoding} tokens={tokens} title={entry.preview} onClick={() => show(entry.encoding)}>{entry.encoding}</Chip>
                                ))}
                            </div>
                            {view.status === 'failed' ? <Failure tokens={tokens} message={view.message} /> : null}
                            {shown ? (
                                <div style={{ marginTop: 12 }}>
                                    <Label tokens={tokens}>{`AS ${shown.encoding}${shown.read.error ? `, STOPS AT BYTE ${shown.read.at} (LINE ${shown.read.line}, COLUMN ${shown.read.column})` : ''}`}</Label>
                                    <pre style={{ margin: 0, maxHeight: 220, overflow: 'auto', fontFamily: tokens.mono, fontSize: 12, lineHeight: 1.55, color: tokens.codeText, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '10px 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shown.read.text}</pre>
                                </div>
                            ) : (
                                <Meta tokens={tokens}>Pick an encoding to read the file with it.</Meta>
                            )}
                        </div>
                    ) : null}
                    {!rows && !opened && gallery.status !== 'failed' && scan.status !== 'failed' ? (
                        <Placeholder tokens={tokens}>Read the samples to compare this tab's TextDecoder with libiconv, or open a file to see which encodings can read it.</Placeholder>
                    ) : null}
                </div>
            }
            code={[
                { file: 'src/native/file_decoder.h', code: DECODER_WRAPPER },
                { file: 'main.js', code: DECODER_USAGE },
            ]}
        />
    );
}
LegacyDecoder.appId = 'iconv-decode';

export const ICONV_APPS = [MojibakeDoctorApp, LegacyExporter, LegacyDecoder];

import { useEffect, useState } from 'react';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { Bars, download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Select, Stat } from './controls.jsx';

// The zlib apps on /ports/zlib/. Each one drives landing/demos/lib-zlib, whose index.html checks the
// same calls against values computed without the port: stock zlib 1.3.2 built natively, CPython's
// zlib, gzip, unzip and zipfile, and the upstream zran.c.

const DIRECTORY = '/memfs/zlibapps';
const LINE_BYTES = 64;

const humanBytes = (value) => {
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)} kB`;
    return `${value} B`;
};
const milliseconds = (value) => (value < 10 ? `${value.toFixed(1)} ms` : `${grouped(Math.round(value))} ms`);
const toBytes = (text) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));

// A byte string from the module as readable text: UTF-8 where it decodes, control bytes as dots.
const readable = (text) => new TextDecoder().decode(toBytes(text)).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '·');

// C++ exceptions reach JavaScript as "std::runtime_error: <what()>"; the page shows only the what().
const plain = (task) => async (m) => {
    try {
        return await task(m);
    } catch (error) {
        throw new Error(String(error?.message ?? error).replace(/^std::[\w:]+: /, ''));
    }
};

function Stats({ children }) {
    return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 18 }}>{children}</div>;
}

function TextBox({ tokens, children, maxHeight = 220 }) {
    return (
        <pre style={{ margin: 0, maxHeight, overflow: 'auto', fontFamily: tokens.mono, fontSize: 11.5, lineHeight: 1.55, color: tokens.codeText, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '10px 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {children}
        </pre>
    );
}

// ---------------------------------------------------------------------------------------------------
// 1. Random access into gzip

const SEEK_WRAPPER = `// src/support/gzip_index.h (excerpt): start inflating at an access point
if (fseeko(in, point.in - (point.bits ? 1 : 0), SEEK_SET) == -1) throw std::runtime_error("cannot seek in the file");
int ch = 0;
if (point.bits && (ch = std::getc(in)) == EOF) throw std::runtime_error("the file is shorter than its index");
z_stream strm{};
if (inflateInit2(&strm, RAW) != Z_OK) throw std::runtime_error("inflateInit2 failed");
Stream end(&strm, inflateEnd);
if (point.bits) inflatePrime(&strm, point.bits, ch >> (8 - point.bits));
if (!point.window.empty()) inflateSetDictionary(&strm, point.window.data(), static_cast<uInt>(point.window.size()));`;

const SEEK_USAGE = `const m = await initNative();
const path = '/memfs/zlibapps/access.log.gz';
await m.SeekableGzip.writeLog(path, 250000, 6);  // 16,000,000 B of log, 3,001,352 B of gzip
const gz = await new m.SeekableGzip(path, 1024); // one pass: 14 access points

const line = await gz.read((123456 - 1) * 64, 63);
// '0123456 2026-01-01T08:34:23Z GET    /api/items/49264 200 0628ms'
await gz.lastDecoded();                          // 864,773 B decompressed to get it
await gz.readFromStart((123456 - 1) * 64, 63);
await gz.lastDecoded();                          // 7,901,183 B without the index`;

async function describe(gz) {
    return { format: await gz.format(), size: await gz.size(), points: JSON.parse(await gz.points()), trailing: await gz.trailingBytes() };
}

// The fastest of a few runs: a single short read is small enough for a timer tick or a garbage
// collection to swamp it. Reads over 30 ms are timed once.
async function fastest(read) {
    let best = Infinity;
    for (let run = 0; run < 3; run += 1) {
        const started = performance.now();
        await read();
        best = Math.min(best, performance.now() - started);
        if (best > 30) break;
    }
    return best;
}

// Reads one line of the generated log, or 2 KB of a dropped file, both ways, and times each.
async function readBoth(source, value) {
    const wanted = Math.floor(Number(value));
    if (!Number.isFinite(wanted)) throw new Error(source.mode === 'log' ? 'Enter a line number.' : 'Enter a byte offset.');
    const log = source.mode === 'log';
    const offset = log ? (Math.min(Math.max(wanted, 1), source.lines) - 1) * LINE_BYTES : Math.min(Math.max(wanted, 0), source.size - 1);
    const length = log ? LINE_BYTES - 1 : 2048;
    let bytes = '';
    const ms = await fastest(async () => {
        bytes = await source.gz.read(offset, length);
    });
    const point = await source.gz.lastPoint();
    const decoded = await source.gz.lastDecoded();
    const scanMs = await fastest(() => source.gz.readFromStart(offset, length));
    return { key: source.key, offset, line: log ? offset / LINE_BYTES + 1 : null, text: readable(bytes), ms, point, decoded, scanMs, scanned: await source.gz.lastDecoded() };
}

// The compressed file as a strip, with a tick per access point; the one the read started from is in the accent.
function AccessPoints({ tokens, source, read }) {
    const width = 1000;
    const x = (at) => (at / Math.max(1, source.compressed)) * width;
    const used = source.points[read.point];
    const next = source.points[read.point + 1];
    const end = next ? x(next[0]) : width;
    return (
        <figure style={{ margin: '18px 0 0' }}>
            <svg viewBox={`0 0 ${width} 36`} width="100%" height="36" preserveAspectRatio="none" role="img" aria-label="Access points along the compressed file">
                <rect x="0.5" y="8.5" width={width - 1} height="19" fill="none" stroke={tokens.borderStrong} />
                {used ? <rect x={x(used[0])} y="9" width={Math.max(2, end - x(used[0]))} height="18" fill={tokens.accent} opacity="0.25" /> : null}
                {source.points.map(([at], i) => (
                    <rect key={at} x={Math.min(width - 2, x(at))} y={i === read.point ? 2 : 8} width={i === read.point ? 3 : 1.5} height={i === read.point ? 32 : 20} fill={i === read.point ? tokens.accent : tokens.textMuted} />
                ))}
            </svg>
            <figcaption style={{ fontSize: 12, color: tokens.textMuted, marginTop: 6 }}>
                {`The ${humanBytes(source.compressed)} file with its ${source.points.length} access points. The read started at point ${read.point + 1} and decompressed only inside the shaded stretch.`}
            </figcaption>
        </figure>
    );
}

export function SeekableGzipApp({ tokens, index, load }) {
    const [lines, setLines] = useState(250000);
    const [line, setLine] = useState('123456');
    const [offset, setOffset] = useState('0');
    const [state, run] = useNativeTask(load);
    const [lookup, runLookup] = useNativeTask(load);
    const result = state.status === 'ready' ? state.result : null;
    const source = result?.source ?? null;
    const generate = () =>
        run(plain(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const path = `${DIRECTORY}/access-${lines}.log.gz`;
            let started = performance.now();
            const compressed = await m.SeekableGzip.writeLog(path, lines, 6);
            const writeMs = performance.now() - started;
            started = performance.now();
            const gz = await new m.SeekableGzip(path, 1024);
            const indexMs = performance.now() - started;
            const made = { key: path, mode: 'log', name: 'access.log.gz', lines, gz, compressed, writeMs, indexMs, ...(await describe(gz)) };
            return { source: made, first: await readBoth(made, line) };
        }));
    const openFile = (file) =>
        run(plain(async (m) => {
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            const started = performance.now();
            const gz = await new m.SeekableGzip(path, 1024);
            const indexMs = performance.now() - started;
            const made = { key: path, mode: 'file', name: file.name, gz, compressed: file.size, indexMs, ...(await describe(gz)) };
            return { source: made, first: await readBoth(made, offset) };
        }));
    const byOffset = source?.mode === 'file';
    const again = () => runLookup(plain(() => readBoth(source, byOffset ? offset : line)));
    const read = lookup.status === 'ready' && source && lookup.result.key === source.key ? lookup.result : result?.first;
    return (
        <AppCard
            tokens={tokens}
            id="zlib-seek"
            index={index}
            status={state.status}
            title="Jump into the middle of a big .gz without unzipping it"
            pitch="gzip has no index, so every reader, the browser's DecompressionStream included, decompresses from the first byte to reach the middle. zlib can start at any deflate block if it gets the block's position, down to the bit, and the 32 KB of text before it. One pass records that about every megabyte, and after it any line is a few milliseconds away. It is the technique of zran.c, an example that ships with zlib; pako, the JavaScript port of zlib, leaves out inflatePrime, the call it rests on."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="LOG TO GENERATE" value={lines} onChange={setLines} options={[[250000, '250,000 lines, 16 MB'], [1000000, '1,000,000 lines, 64 MB']]} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={generate}>Generate and index</RunButton>
                        <FileButton tokens={tokens} accept=".gz,.tgz,.gzip,.zz,application/gzip" onFile={openFile}>Index your own .gz</FileButton>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                        <label style={{ display: 'block', minWidth: 0, flex: '1 1 140px' }}>
                            <Label tokens={tokens}>{byOffset ? 'BYTE OFFSET' : 'LINE'}</Label>
                            <input
                                type="number"
                                inputMode="numeric"
                                min={byOffset ? 0 : 1}
                                value={byOffset ? offset : line}
                                onChange={(event) => (byOffset ? setOffset : setLine)(event.target.value)}
                                style={fieldStyle(tokens)}
                            />
                        </label>
                        <SecondaryButton tokens={tokens} onClick={again} disabled={!source || lookup.status === 'running'}>
                            {lookup.status === 'running' ? 'Reading…' : 'Read it'}
                        </SecondaryButton>
                    </div>
                    <Hint tokens={tokens}>
                        The log is generated in the module, 64 bytes a line, and gzipped at level 6. Your own file stays in this tab: it is copied into the module's memory, never uploaded.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : source && read ? (
                    <div>
                        <Stats>
                            <Stat tokens={tokens} accent value={milliseconds(read.ms)} label="to read it with the index" />
                            <Stat tokens={tokens} value={milliseconds(read.scanMs)} label="decompressing from the start" />
                        </Stats>
                        <Label tokens={tokens}>{read.line ? `LINE ${grouped(read.line)}` : `2 KB FROM BYTE ${grouped(read.offset)}`}</Label>
                        <TextBox tokens={tokens} maxHeight={180}>{read.text}</TextBox>
                        {lookup.status === 'failed' ? <Failure tokens={tokens} message={lookup.message} /> : null}
                        <div style={{ marginTop: 16 }}>
                            <Bars
                                tokens={tokens}
                                rows={[
                                    { label: 'decompressed from the start', bytes: read.scanned },
                                    { label: 'decompressed from the nearest access point', bytes: read.decoded, highlight: true },
                                ]}
                            />
                        </div>
                        <AccessPoints tokens={tokens} source={source} read={read} />
                        <Meta tokens={tokens}>
                            {`${source.name} · ${source.format} · ${humanBytes(source.size)} of data in ${humanBytes(source.compressed)} · ${source.points.length} access points, up to 32 KB each${source.writeMs ? ` · written in ${milliseconds(source.writeMs)}` : ''} · indexed in ${milliseconds(source.indexMs)}${source.trailing > 0 ? ` · ${grouped(source.trailing)} bytes after the gzip data ignored, as gunzip does` : ''}`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Generate a log, or index a .gz of your own, then read any line or offset in it.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/gzip_index.h', code: SEEK_WRAPPER },
                { file: 'main.js', code: SEEK_USAGE },
            ]}
        />
    );
}
SeekableGzipApp.appId = 'zlib-seek';

// ---------------------------------------------------------------------------------------------------
// 2. Lossless PNG optimizer

const PNG_WRAPPER = `// src/native/png_squeezer.h (excerpt): the file's own rows, five filter choices, then the winner with Z_FILTERED
attempt(6, found, Z_DEFAULT_STRATEGY);
const size_t foundSize = best.size();
for (int method : {0, 1, 2, 4, 5}) {
    const std::string rows = pngfile::filter(image, raw, method);
    if (rows == found) record(method, Z_DEFAULT_STRATEGY, foundSize, 0, true);
    else attempt(method, rows, Z_DEFAULT_STRATEGY);
}
attempt(bestFilter, std::string(bestRows), Z_FILTERED);`;

const PNG_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));   // a PNG from <input type="file">
const report = JSON.parse(await m.PngSqueezer.optimize(path, path + '.min.png'));
// the sample chart: report.original 17191, report.bytes 4989 (up filter, level 9)
await m.PngSqueezer.samePixels(path, path + '.min.png'); // true
const smaller = await m.getFileBytes(path + '.min.png');`;

const COLOURS = { 0: 'greyscale', 2: 'RGB', 3: 'palette', 4: 'greyscale and alpha', 6: 'RGBA' };
const LEVELS = ['fastest', 'fast', 'default', 'maximum'];
const FILTER_NAMES = ['None', 'Sub', 'Up', 'Average', 'Paeth'];

// Something that looks like a screenshot, encoded by this browser's own canvas.
async function drawnPng() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f5f6f8';
    context.fillRect(0, 0, 1280, 720);
    context.fillStyle = '#1f2937';
    context.fillRect(0, 0, 1280, 56);
    context.fillStyle = '#ffffff';
    context.fillRect(24, 80, 760, 616);
    context.fillRect(808, 80, 448, 616);
    context.font = '16px sans-serif';
    for (let row = 0; row < 26; row += 1) {
        context.fillStyle = row % 2 ? '#374151' : '#111827';
        context.fillText(`Order ${1000 + row * 7}  ·  ${['Istanbul', 'Berlin', 'Tokyo', 'Lagos'][row % 4]}  ·  ${(row * 37) % 900} items  ·  status ${row % 3 ? 'shipped' : 'open'}`, 48, 120 + row * 22);
    }
    for (let bar = 0; bar < 10; bar += 1) {
        const height = 60 + ((bar * 97) % 420);
        context.fillStyle = bar % 3 ? '#93c5fd' : '#2563eb';
        context.fillRect(836 + bar * 40, 660 - height, 26, height);
    }
    const blob = await new Promise((resolve, reject) => canvas.toBlob((made) => (made ? resolve(made) : reject(new Error('This browser did not encode the canvas as PNG.'))), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
}

async function pixelsOf(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

// The browser's own decoder compares the two files. null: it could not decode one of them.
async function sameInBrowser(before, after) {
    try {
        const [a, b] = await Promise.all([pixelsOf(before), pixelsOf(after)]);
        return a.length === b.length && a.every((value, i) => value === b[i]);
    } catch {
        return null;
    }
}

function filterSummary(filters) {
    const used = filters.map((count, type) => [type, count]).filter(([, count]) => count > 0);
    if (used.length === 1) return `every row ${FILTER_NAMES[used[0][0]]}`;
    return used.map(([type, count]) => `${FILTER_NAMES[type]} ${grouped(count)}`).join(', ');
}

export function PngSqueezerApp({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const result = state.status === 'ready' ? state.result : null;
    const url = result?.url;
    useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
    const squeeze = (source) =>
        run(plain(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            let path = `${DIRECTORY}/chart.png`;
            let name = 'chart.png';
            if (source === 'sample') {
                await m.PngSqueezer.writeSample(path);
            } else if (source === 'canvas') {
                path = `${DIRECTORY}/drawn.png`;
                name = 'drawn.png';
                await m.FS.writeFile(path, await drawnPng());
            } else {
                [path] = await m.autoMountFiles([source], await m.getRandomPath('/memfs'));
                name = source.name;
            }
            const info = JSON.parse(await m.PngSqueezer.inspect(path));
            const started = performance.now();
            const report = JSON.parse(await m.PngSqueezer.optimize(path, `${path}.min.png`));
            const ms = performance.now() - started;
            const before = await m.getFileBytes(path);
            const after = await m.getFileBytes(`${path}.min.png`);
            return { name, info, report, ms, after, url: URL.createObjectURL(new Blob([after], { type: 'image/png' })), browser: await sameInBrowser(before, after) };
        }));
    const busy = state.status === 'running';
    const report = result?.report;
    const saved = report ? 1 - report.bytes / report.original : 0;
    return (
        <AppCard
            tokens={tokens}
            id="zlib-png"
            index={index}
            status={state.status}
            title="Make a PNG smaller without changing a pixel"
            pitch="A PNG's pixels are zlib data: each row is filtered, predicted from the rows around it, and the rows are deflated. This tries the file's own filters and five others at zlib's maximum level, keeps the smallest, and copies every other chunk as it was. The browser gives you no such control: canvas.toBlob takes a quality only for formats with variable quality, such as JPEG, so a PNG comes out however its encoder writes it. The result is decoded again and compared, row by row in C++ and pixel by pixel by this browser."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={busy} onClick={() => squeeze('sample')}>Squeeze the sample</RunButton>
                        <SecondaryButton tokens={tokens} onClick={() => squeeze('canvas')} disabled={busy}>Use a PNG this browser draws</SecondaryButton>
                        <FileButton tokens={tokens} accept=".png,image/png" onFile={squeeze}>Open your own PNG</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        The sample is a chart the module draws and saves the way a fast encoder does, with no filtering at zlib level 1. The drawn PNG comes from this browser's canvas encoder, so its numbers depend on the browser. Large images take a few seconds: every attempt deflates the whole image.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div>
                        <Stats>
                            <Stat tokens={tokens} accent value={report.improved ? `${(saved * 100).toFixed(1)}%` : '0%'} label={report.improved ? 'smaller, same pixels' : 'already as small as zlib gets it'} />
                            <Stat tokens={tokens} value={humanBytes(report.bytes)} label={`from ${humanBytes(report.original)}`} />
                        </Stats>
                        <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, padding: 8, background: tokens.pillBg, marginBottom: 16 }}>
                            <img src={result.url} alt={`The optimized ${result.name}`} style={{ display: 'block', maxWidth: '100%', maxHeight: 260, margin: '0 auto' }} />
                        </div>
                        <Bars
                            tokens={tokens}
                            rows={report.trials.map((trial) => ({
                                label: `${trial.filter === 'as found' ? "the file's own filters" : `${trial.filter} filter`}${trial.strategy === 'filtered' ? ', Z_FILTERED' : ''}${trial.reused ? ' (same rows as the file)' : ''}`,
                                bytes: trial.idat,
                                highlight: trial.filter === report.best.filter && trial.strategy === report.best.strategy && trial.idat === report.best.idat,
                            }))}
                        />
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 16 }}>
                            <SecondaryButton tokens={tokens} onClick={() => download(result.after, result.name.replace(/\.png$/i, '') + '.min.png', 'image/png')}>Download the smaller PNG</SecondaryButton>
                        </div>
                        <Meta tokens={tokens}>
                            {`${result.name} · ${result.info.width} × ${result.info.height}, ${result.info.bitDepth}-bit ${COLOURS[result.info.colorType]}${result.info.interlaced ? ', interlaced' : ''} · ${result.info.chunks.length} chunks, ${result.info.idatChunks} of them image data · rows filtered: ${filterSummary(result.info.filters)} · deflated at the ${LEVELS[result.info.zlibLevel] ?? 'unknown'} level · ${milliseconds(result.ms)} · rows compared in C++: same · pixels compared by this browser: ${result.browser === null ? 'it could not decode the file' : result.browser ? 'same' : 'DIFFERENT'}`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Squeeze the sample, a PNG this browser draws, or one of your own, and compare every filter and strategy tried.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/png_squeezer.h', code: PNG_WRAPPER },
                { file: 'main.js', code: PNG_USAGE },
            ]}
        />
    );
}
PngSqueezerApp.appId = 'zlib-png';

// ---------------------------------------------------------------------------------------------------
// 3. ZIP inspector

const ZIP_WRAPPER = `// src/support/zip_format.h (excerpt): one entry, inflated as raw deflate
z_stream strm{};
if (inflateInit2(&strm, -15) != Z_OK) throw std::runtime_error("inflateInit2 failed");  // raw deflate: no zlib header
std::unique_ptr<z_stream, int (*)(z_stream*)> end(&strm, inflateEnd);
int ret = Z_OK;
do {
    if (strm.avail_in == 0) {
        const size_t count = std::fread(input.data(), 1, static_cast<size_t>(std::min<uint64_t>(CHUNK, left)), file);
        if (count == 0) throw std::runtime_error("its deflate data ends early");
        left -= count;
        strm.next_in = input.data();
        strm.avail_in = static_cast<uInt>(count);
    }
    strm.next_out = output.data();
    strm.avail_out = static_cast<uInt>(CHUNK);
    ret = inflate(&strm, Z_NO_FLUSH);
    if (ret != Z_OK && ret != Z_STREAM_END) throw std::runtime_error(strm.msg ? strm.msg : "its deflate data is corrupt");
    if (!deliver(output.data(), CHUNK - strm.avail_out)) return result;
} while (ret != Z_STREAM_END);`;

const ZIP_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));  // a .zip, .docx, .xlsx, .epub, .jar...
const { entries } = JSON.parse(await m.ZipReader.list(path));
const entry = JSON.parse(await m.ZipReader.read(path, entries[0].name, 4096));
entry.crcOk;                                     // true: inflated and checked
const report = JSON.parse(await m.ZipReader.test(path)); // every CRC-32, as unzip -t does`;

const KINDS = [
    [['word/document.xml'], 'a Word document'],
    [['xl/workbook.xml'], 'an Excel workbook'],
    [['ppt/presentation.xml'], 'a PowerPoint deck'],
    [['META-INF/container.xml', 'mimetype'], 'an EPUB book'],
    [['AndroidManifest.xml', 'classes.dex'], 'an Android app'],
    [['content.xml', 'mimetype'], 'an OpenDocument file'],
    [['META-INF/MANIFEST.MF'], 'a Java archive'],
];

function kindOf(entries) {
    const names = new Set(entries.map((entry) => entry.name));
    return KINDS.find(([needed]) => needed.every((name) => names.has(name)))?.[1] ?? 'a ZIP archive';
}

const METHODS = { 0: 'stored', 8: 'deflate' };

// Text if the first bytes are UTF-8 without control characters; anything else is shown in hex.
function looksBinary(hex) {
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
    if (bytes.some((byte) => byte < 9 || (byte > 13 && byte < 32) || byte === 127)) return true;
    for (let cut = 0; cut < 4 && cut <= bytes.length; cut += 1) {
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.length - cut));
            return false;
        } catch {
            // The 64 bytes may end inside a character; try again a byte shorter.
        }
    }
    return true;
}

// A hex dump of the entry's first bytes, sixteen to a line.
function hexDump(hex) {
    const rows = [];
    for (let at = 0; at < hex.length; at += 32) rows.push(hex.slice(at, at + 32).replace(/(..)(?!$)/g, '$1 '));
    return rows.join('\n');
}

export function ZipInspectorApp({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [entry, runEntry] = useNativeTask(load);
    const [test, runTest] = useNativeTask(load);
    const open = (source) =>
        run(plain(async (m) => {
            let path = `${DIRECTORY}/sample.zip`;
            let name = 'sample.zip';
            let size = 0;
            if (source === 'sample') {
                await m.FS.mkdirTree(DIRECTORY);
                size = await m.ZipReader.writeSample(path);
            } else {
                [path] = await m.autoMountFiles([source], await m.getRandomPath('/memfs'));
                name = source.name;
                size = source.size;
            }
            const listing = JSON.parse(await m.ZipReader.list(path));
            return { path, name, size, listing, kind: kindOf(listing.entries) };
        }));
    const result = state.status === 'ready' ? state.result : null;
    const show = (entryName) => runEntry(plain(async (m) => ({ path: result.path, name: entryName, ...JSON.parse(await m.ZipReader.read(result.path, entryName, 4096)) })));
    const check = () => runTest(plain(async (m) => ({ path: result.path, ...JSON.parse(await m.ZipReader.test(result.path)) })));
    const shown = entry.status === 'ready' && result && entry.result.path === result.path ? entry.result : null;
    const tested = test.status === 'ready' && result && test.result.path === result.path ? test.result : null;
    const listed = result?.listing.entries ?? [];
    const unpacked = listed.reduce((total, item) => total + item.size, 0);
    const binary = shown ? looksBinary(shown.head) : false;
    return (
        <AppCard
            tokens={tokens}
            id="zlib-zip"
            index={index}
            status={state.status}
            title="Look inside a .zip, .docx or .xlsx without unpacking it"
            pitch="A ZIP is a row of deflate streams with a table of contents at the end, and Word, Excel, EPUB and Java files are ZIPs too. zlib has no ZIP API, and its contrib/minizip is not in this build, but it has the two parts that matter: raw inflate and CRC-32. A few hundred lines of C++ on top read the table of contents, inflate one entry on demand and check every checksum, the way unzip -t does."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={() => open('sample')}>Open the sample</RunButton>
                        <FileButton tokens={tokens} accept=".zip,.docx,.xlsx,.pptx,.epub,.jar,.apk,.odt,.ods,application/zip" onFile={open}>Open your own file</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        The sample is a four-entry archive the module writes itself. Your own file stays in this tab: it is copied into the module's memory, never uploaded. Entries that are encrypted, or compressed with anything but deflate, are listed but not opened.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, marginBottom: 12, overflowWrap: 'anywhere' }}>{`${result.name} · ${result.kind} · ${grouped(result.size)} B`}</div>
                        <Stats>
                            <Stat tokens={tokens} accent value={grouped(result.listing.count)} label="entries" />
                            <Stat tokens={tokens} value={humanBytes(unpacked)} label={result.listing.count > listed.length ? `in the first ${grouped(listed.length)}, unpacked` : 'unpacked'} />
                        </Stats>
                        <div style={{ maxHeight: 240, overflow: 'auto', border: `1px solid ${tokens.border}`, borderRadius: 10 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                <tbody>
                                    {listed.slice(0, 300).map((item, i) => (
                                        <tr key={`${i}:${item.name}`}>
                                            <td style={{ padding: '6px 10px', borderBottom: `1px solid ${tokens.border}`, fontFamily: tokens.mono, overflowWrap: 'anywhere' }}>
                                                {item.folder ? (
                                                    <span style={{ color: tokens.textDim }}>{item.name}</span>
                                                ) : (
                                                    <button type="button" onClick={() => show(item.name)} style={{ background: 'none', border: 'none', padding: 0, color: tokens.accentText, fontFamily: tokens.mono, fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>
                                                        {item.name}
                                                    </button>
                                                )}
                                            </td>
                                            <td style={{ padding: '6px 10px', borderBottom: `1px solid ${tokens.border}`, color: tokens.textMuted, whiteSpace: 'nowrap' }}>
                                                {item.encrypted ? 'encrypted' : METHODS[item.method] ?? `method ${item.method}`}
                                            </td>
                                            <td style={{ padding: '6px 10px', borderBottom: `1px solid ${tokens.border}`, fontFamily: tokens.mono, color: tokens.textDim, textAlign: 'right', whiteSpace: 'nowrap' }}>{grouped(item.size)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {entry.status === 'failed' ? <Failure tokens={tokens} message={entry.message} /> : null}
                        {shown ? (
                            <div style={{ marginTop: 14 }}>
                                <Label tokens={tokens}>{`${binary ? 'FIRST 64 BYTES' : 'FIRST 4 KB'} OF ${shown.name.toUpperCase()} · CRC-32 ${shown.crcOk === null ? 'NOT CHECKED (OVER 1 GiB)' : shown.crcOk ? 'MATCHES' : 'DOES NOT MATCH'}`}</Label>
                                <TextBox tokens={tokens}>{binary ? hexDump(shown.head) : shown.text}</TextBox>
                            </div>
                        ) : null}
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 14 }}>
                            <SecondaryButton tokens={tokens} onClick={check} disabled={test.status === 'running'}>{test.status === 'running' ? 'Checking…' : 'Check every CRC-32'}</SecondaryButton>
                            {test.status === 'failed' ? <Failure tokens={tokens} message={test.message} /> : null}
                        </div>
                        {tested ? (
                            <Meta tokens={tokens}>
                                {tested.failed.length
                                    ? `${grouped(tested.checked)} entries read, ${humanBytes(tested.bytes)}; ${tested.failed.length} did not pass: ${tested.failed.map((item) => `${item.name} (${item.reason})`).join('; ')}`
                                    : `${grouped(tested.checked)} entries read, ${humanBytes(tested.bytes)} inflated, every CRC-32 matches${tested.stopped ? ' (stopped after 4 GiB)' : ''}`}
                            </Meta>
                        ) : null}
                        {result.listing.comment ? <Meta tokens={tokens}>{`archive comment: ${result.listing.comment}`}</Meta> : null}
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open the sample, or a .zip, .docx, .xlsx or .epub of your own, to list its entries and read any of them.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/zip_format.h', code: ZIP_WRAPPER },
                { file: 'main.js', code: ZIP_USAGE },
            ]}
        />
    );
}
ZipInspectorApp.appId = 'zlib-zip';

export const ZLIB_APPS = [SeekableGzipApp, PngSqueezerApp, ZipInspectorApp];

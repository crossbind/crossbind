import { useState } from 'react';
import AppCard, { Failure, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { Bars, download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Select, Stat, Toggle } from './controls.jsx';

// The zstd apps on /ports/zstd/. Each one drives landing/demos/lib-zstd, whose index.html checks the
// same calls against numbers computed with CPython and libzstd 1.5.7 on the same generated records.

const DIRECTORY = '/memfs/zstdapps';

const units = (text) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));
const byteString = (bytes) => {
    let text = '';
    for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return text;
};
const times = (numerator, denominator) => `${(numerator / denominator).toFixed(2)}×`;
const humanBytes = (value) => {
    if (value >= 1 << 30) return `${(value / (1 << 30)).toFixed(1)} GiB`;
    if (value >= 1 << 20) return `${(value / (1 << 20)).toFixed(1)} MiB`;
    if (value >= 1 << 10) return `${(value / (1 << 10)).toFixed(1)} KiB`;
    return `${value} B`;
};

// Record by record: the raw size as an outline, zstd alone in grey, zstd with the dictionary in the accent.
function RecordChart({ tokens, sample }) {
    const largest = Math.max(...sample.map(([raw]) => raw));
    const step = 10;
    const height = 96;
    return (
        <figure style={{ margin: '18px 0 0' }}>
            <svg viewBox={`0 0 ${sample.length * step} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="Per-record compressed sizes">
                {sample.map(([raw, plain, withDictionary], index) => {
                    const x = index * step;
                    const scale = (value) => (value / largest) * (height - 2);
                    return (
                        <g key={index}>
                            <rect x={x + 1} y={height - scale(raw)} width={step - 2} height={scale(raw)} fill="none" stroke={tokens.borderStrong} strokeWidth="1" />
                            <rect x={x + 1} y={height - scale(plain)} width={step - 2} height={scale(plain)} fill={tokens.textMuted} opacity="0.55" />
                            <rect x={x + 1} y={height - scale(withDictionary)} width={step - 2} height={scale(withDictionary)} fill={tokens.accent} />
                        </g>
                    );
                })}
            </svg>
            <figcaption style={{ fontSize: 12, color: tokens.textMuted, marginTop: 6 }}>
                {`The first ${sample.length} held-out records: raw size (outline), zstd alone (grey), zstd with the dictionary (green).`}
            </figcaption>
        </figure>
    );
}

const DICTIONARY_WRAPPER = `// src/native/dictionary_lab.h (excerpt)
int train(int capacity) {
    std::string joined;
    std::vector<size_t> sizes;
    for (const std::string& record : training) {
        joined += record;
        sizes.push_back(record.size());
    }
    std::string trained(static_cast<size_t>(capacity), '\\0');
    const size_t size = ZDICT_trainFromBuffer(&trained[0], trained.size(), joined.data(),
                                              sizes.data(), static_cast<unsigned>(sizes.size()));
    if (ZDICT_isError(size)) throw std::runtime_error(ZDICT_getErrorName(size));
    trained.resize(size);
    dictionary = trained;
    return static_cast<int>(size);
}`;

const DICTIONARY_USAGE = `const m = await initNative();
const lab = await new m.DictionaryLab(1000);  // learn from 1,000 records
await lab.train(4096);                        // a 4 KB dictionary

const result = JSON.parse(await lab.evaluate(3, false));
// 1,000 unseen records, one frame each:
// result.plain          294,389 B  (1.82x)
// result.withDictionary  70,823 B  (7.55x)`;

export function DictionaryTrainer({ tokens, index, load }) {
    const [records, setRecords] = useState(1000);
    const [capacity, setCapacity] = useState(4096);
    const [level, setLevel] = useState(3);
    const [trim, setTrim] = useState(false);
    const [state, run] = useNativeTask(load);
    const start = () =>
        run(async (m) => {
            const lab = await new m.DictionaryLab(records);
            const started = performance.now();
            const size = await lab.train(capacity);
            const trainedIn = Math.round(performance.now() - started);
            const evaluation = JSON.parse(await lab.evaluate(level, trim));
            return {
                size,
                trainedIn,
                id: await lab.dictionaryId(),
                preview: await lab.preview(260),
                dictionary: units(await lab.dictionaryBytes()),
                evaluation,
            };
        });
    const result = state.status === 'ready' ? state.result : null;
    const evaluation = result?.evaluation;
    return (
        <AppCard
            tokens={tokens}
            id="zstd-dictionary"
            index={index}
            status={state.status}
            title="Teach zstd your data, then watch small messages shrink"
            pitch="A single JSON record barely compresses: there is too little of it to learn from. Train a dictionary on a thousand records and every new record compresses about four times further. The training runs here, in this tab; none of the JavaScript zstd packages we checked can train one."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                        <Select tokens={tokens} label="TRAIN ON" value={records} onChange={setRecords} options={[[500, '500 records'], [1000, '1,000 records'], [2000, '2,000 records']]} />
                        <Select tokens={tokens} label="DICTIONARY" value={capacity} onChange={setCapacity} options={[[2048, '2 KB'], [4096, '4 KB'], [8192, '8 KB'], [16384, '16 KB']]} />
                        <Select tokens={tokens} label="LEVEL" value={level} onChange={setLevel} options={[[1, '1'], [3, '3 (default)'], [9, '9'], [19, '19']]} />
                    </div>
                    <Toggle tokens={tokens} checked={trim} onChange={setTrim}>Drop the content size and dictionary ID from each frame</Toggle>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Train and compress</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        The records look like a public API's user objects and are generated in the module, so the numbers are the same on every machine.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : evaluation ? (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 18 }}>
                            <Stat tokens={tokens} accent value={times(evaluation.raw, evaluation.withDictionary)} label="smaller, with the dictionary" />
                            <Stat tokens={tokens} value={times(evaluation.raw, evaluation.plain)} label="smaller, zstd alone" />
                        </div>
                        <Bars
                            tokens={tokens}
                            rows={[
                                { label: `${grouped(evaluation.records)} records, raw`, bytes: evaluation.raw },
                                { label: 'zstd, one frame per record', bytes: evaluation.plain },
                                { label: `zstd + the ${grouped(result.size)}-byte dictionary`, bytes: evaluation.withDictionary, highlight: true },
                            ]}
                        />
                        <RecordChart tokens={tokens} sample={evaluation.sample} />
                        <div style={{ marginTop: 16 }}>
                            <Label tokens={tokens}>WHAT THE TRAINER KEPT</Label>
                        </div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 11.5, lineHeight: 1.55, color: tokens.textDim, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '10px 12px', overflowWrap: 'anywhere' }}>
                            {result.preview}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 14 }}>
                            <SecondaryButton tokens={tokens} onClick={() => download(result.dictionary, `records-${result.id}.zdict`)}>Download the .zdict</SecondaryButton>
                            <span style={{ fontSize: 12.5, color: tokens.textMuted }}>
                                Works with <code style={{ fontFamily: tokens.mono }}>zstd -D</code> and every zstd binding.
                            </span>
                        </div>
                        <Meta tokens={tokens}>{`dictionary ID ${result.id} · trained in ${result.trainedIn} ms · ${evaluation.roundtrip ? 'every record decoded back byte for byte' : 'ROUND TRIP FAILED'}`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Train a dictionary to compare zstd with and without it, record by record.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/dictionary_lab.h', code: DICTIONARY_WRAPPER },
                { file: 'main.js', code: DICTIONARY_USAGE },
            ]}
        />
    );
}
DictionaryTrainer.appId = 'zstd-dictionary';

const DELTA_WRAPPER = `// src/native/delta_lab.h (excerpt)
check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_compressionLevel, level));
if (windowLog) check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_windowLog, windowLog));
// the previous version is the dictionary
if (withPrefix) check(ZSTD_CCtx_refPrefix(cctx.get(), previousText.data(), previousText.size()));
out.resize(check(ZSTD_compress2(cctx.get(), &out[0], out.size(), nextText.data(), nextText.size())));

// RFC 9842 dcz: a 40-byte skippable frame naming v1 by its SHA-256, then the frame
header.resize(check(ZSTD_writeSkippableFrame(&header[0], header.size(),
                                             digest.data(), digest.size(), 0xE)));`;

const DELTA_USAGE = `const m = await initNative();
const lab = await new m.DeltaLab();
const v1 = Uint8Array.from(await lab.v1(), (c) => c.charCodeAt(0));
const sha = new Uint8Array(await crypto.subtle.digest('SHA-256', v1));

const dcz = await lab.dcz(String.fromCharCode(...sha), 19, false);
dcz.length;                  // 1022: 40 bytes of header, 982 of zstd
await lab.verify(dcz);       // true: decodes back to v2 byte for byte`;

// The comparison bar is what this browser's own gzip makes of v2; a browser without
// CompressionStream simply shows no such bar.
async function browserGzip(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    return compressed.byteLength;
}

export function DeltaShipper({ tokens, index, load }) {
    const [level, setLevel] = useState(19);
    const [longMode, setLongMode] = useState(false);
    const [state, run] = useNativeTask(load);
    const start = () =>
        run(async (m) => {
            const lab = await new m.DeltaLab();
            const v1 = units(await lab.v1());
            const v2 = units(await lab.v2());
            const sha = new Uint8Array(await crypto.subtle.digest('SHA-256', v1));
            const dcz = await lab.dcz(byteString(sha), level, longMode);
            return {
                v1: v1.length,
                v2: v2.length,
                gzip: await browserGzip(v2),
                alone: await lab.aloneBytes(level),
                delta: await lab.deltaBytes(level, 22, longMode),
                dcz: units(dcz),
                sha: [...sha.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
                verified: await lab.verify(dcz),
                level,
            };
        });
    const result = state.status === 'ready' ? state.result : null;
    return (
        <AppCard
            tokens={tokens}
            id="zstd-delta"
            index={index}
            status={state.status}
            title="Send a 1 MB update in about 1 KB"
            pitch="Version two of a 1 MB dataset changes a few numbers and adds twenty records. zstd compresses it with version one as its dictionary, and the page wraps the result in RFC 9842 dcz framing: the Compression Dictionary Transport format Chrome decodes natively over HTTP."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="LEVEL" value={level} onChange={setLevel} options={[[3, '3 (fast)'], [19, '19 (smallest)']]} />
                    <Toggle tokens={tokens} checked={longMode} onChange={setLongMode}>Long-distance matching</Toggle>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Build the update</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        Both versions are generated in the module: v1 is 2,000 records, and v2 raises every fiftieth follower count and appends 20 records.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 18 }}>
                            <Stat tokens={tokens} accent value={`${grouped(result.dcz.length)} B`} label={`to ship ${grouped(result.v2)} B of v2`} />
                            <Stat tokens={tokens} value={times(result.alone, result.delta)} label="smaller than zstd alone" />
                        </div>
                        <Bars
                            tokens={tokens}
                            rows={[
                                ...(result.gzip === null ? [] : [{ label: "v2 with this browser's gzip", bytes: result.gzip }]),
                                { label: `v2 with zstd -${result.level}`, bytes: result.alone },
                                { label: `v2 with zstd -${result.level}, v1 as the dictionary`, bytes: result.delta, highlight: true },
                            ]}
                        />
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 18 }}>
                            <SecondaryButton tokens={tokens} onClick={() => download(result.dcz, 'update.dcz')}>Download update.dcz</SecondaryButton>
                        </div>
                        <Meta tokens={tokens}>
                            {`dcz = 40-byte header (v1 sha-256 ${result.sha}…) + ${grouped(result.delta)}-byte zstd frame · ${result.verified ? 'decoded back to v2 byte for byte' : 'VERIFY FAILED'}`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Build the update to compare gzip, zstd, and zstd with the previous version as its dictionary.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/delta_lab.h', code: DELTA_WRAPPER },
                { file: 'main.js', code: DELTA_USAGE },
            ]}
        />
    );
}
DeltaShipper.appId = 'zstd-delta';

const OPENER_WRAPPER = `// src/support/tar.h (excerpt): stream the file through zstd
// \`zstd --long=30\` frames need a 1 GiB window, the most wasm32 can address.
check(ZSTD_DCtx_setParameter(dctx.get(), ZSTD_d_windowLogMax, 30));
std::vector<char> in(ZSTD_DStreamInSize());
std::vector<char> out(ZSTD_DStreamOutSize());
while ((count = std::fread(in.data(), 1, in.size(), file.get())) > 0) {
    ZSTD_inBuffer input = {in.data(), count, 0};
    while (input.pos < input.size) {
        ZSTD_outBuffer output = {out.data(), out.size(), 0};
        pending = check(ZSTD_decompressStream(dctx.get(), &output, &input));
        if (output.pos && !sink(out.data(), output.pos)) return;
    }
}`;

const OPENER_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));   // the dropped file

const header = JSON.parse(await m.ZstOpener.frameInfo(path));
const listing = JSON.parse(await m.ZstOpener.listTar(path));
// listing.entries: [{ name, size, mtime, type }, ...]
const text = await m.ZstOpener.extractText(path, listing.entries[0].name, 2048);`;

export function ZstOpenerApp({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [preview, runPreview] = useNativeTask(load);
    const inspect = async (m, path, name, size) => ({
        path,
        name,
        size,
        header: JSON.parse(await m.ZstOpener.frameInfo(path)),
        listing: JSON.parse(await m.ZstOpener.listTar(path)),
    });
    const openSample = () =>
        run(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const path = `${DIRECTORY}/sample.tar.zst`;
            const size = await m.ZstOpener.writeSample(path);
            return inspect(m, path, 'sample.tar.zst', size);
        });
    const openFile = (file) => {
        if (!file) return;
        run(async (m) => {
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return inspect(m, path, file.name, file.size);
        });
    };
    const result = state.status === 'ready' ? state.result : null;
    const show = (name) => runPreview(async (m) => ({ path: result.path, name, text: await m.ZstOpener.extractText(result.path, name, 2048) }));
    const shown = preview.status === 'ready' && result && preview.result.path === result.path ? preview.result : null;
    return (
        <AppCard
            tokens={tokens}
            id="zstd-opener"
            index={index}
            status={state.status}
            title="Look inside a .tar.zst without unpacking it"
            pitch="Open a Linux package, a backup or a dataset archive and list what is inside. zstd streams the file in 128 KB steps while the tar headers are read as they pass, so nothing is unpacked, and windows up to 1 GiB decode, far past the 32 MB that fzstd, the popular pure-JavaScript decoder, supports."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={openSample}>Open the sample</RunButton>
                        <FileButton tokens={tokens} accept=".zst,.tzst,application/zstd" onFile={openFile}>Open your own .zst</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        The sample is a three-file .tar.zst the module writes itself. Your own file stays in this tab: it is mounted into the module's in-memory filesystem, never uploaded.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, marginBottom: 12, overflowWrap: 'anywhere' }}>{`${result.name} · ${grouped(result.size)} B`}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14, marginBottom: 16 }}>
                            <Stat tokens={tokens} value={humanBytes(result.header.windowSize)} label="window" />
                            <Stat tokens={tokens} value={result.header.contentSize === null ? 'not stored' : humanBytes(result.header.contentSize)} label="content size" />
                            <Stat tokens={tokens} value={result.header.checksum ? 'XXH64' : 'none'} label="checksum" />
                            <Stat tokens={tokens} accent value={result.listing.format === 'tar' ? grouped(result.listing.count) : 'plain'} label={result.listing.format === 'tar' ? 'files inside' : 'not a tar archive'} />
                        </div>
                        {result.listing.format === 'tar' ? (
                            <div style={{ maxHeight: 260, overflow: 'auto', border: `1px solid ${tokens.border}`, borderRadius: 10 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                    <tbody>
                                        {result.listing.entries.slice(0, 300).map((entry) => (
                                            <tr key={entry.name}>
                                                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${tokens.border}`, fontFamily: tokens.mono, overflowWrap: 'anywhere' }}>
                                                    {entry.type === 'file' ? (
                                                        <button type="button" onClick={() => show(entry.name)} style={{ background: 'none', border: 'none', padding: 0, color: tokens.accentText, fontFamily: tokens.mono, fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>{entry.name}</button>
                                                    ) : (
                                                        <span style={{ color: tokens.textDim }}>{entry.name}</span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${tokens.border}`, color: tokens.textMuted, whiteSpace: 'nowrap' }}>{entry.type}</td>
                                                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${tokens.border}`, fontFamily: tokens.mono, color: tokens.textDim, textAlign: 'right', whiteSpace: 'nowrap' }}>{grouped(entry.size)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <SecondaryButton tokens={tokens} onClick={() => show('')}>Show the first 2 KB</SecondaryButton>
                        )}
                        {preview.status === 'failed' ? <Failure tokens={tokens} message={preview.message} /> : null}
                        {shown ? (
                            <div style={{ marginTop: 14 }}>
                                <Label tokens={tokens}>{shown.name ? `FIRST 2 KB OF ${shown.name.toUpperCase()}` : 'FIRST 2 KB'}</Label>
                                <pre style={{ margin: 0, maxHeight: 220, overflow: 'auto', fontFamily: tokens.mono, fontSize: 11.5, lineHeight: 1.55, color: tokens.codeText, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '10px 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shown.text}</pre>
                            </div>
                        ) : null}
                        <Meta tokens={tokens}>{`${grouped(result.listing.bytes)} B decoded in a stream`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open the sample, or a .zst or .tar.zst of your own, to see its frame header and what is inside.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/tar.h', code: OPENER_WRAPPER },
                { file: 'main.js', code: OPENER_USAGE },
            ]}
        />
    );
}
ZstOpenerApp.appId = 'zstd-opener';

export const ZSTD_APPS = [DictionaryTrainer, DeltaShipper, ZstOpenerApp];

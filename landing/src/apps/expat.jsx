import { useRef, useState } from 'react';
import AppCard, { Failure, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Select, Stat } from './controls.jsx';

// The Expat apps on /ports/expat/. Each one drives landing/demos/lib-expat, whose index.html checks the
// same calls against pyexpat and a host build of Expat 2.8.5 run on the same generated input.

const size = (bytes) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} kB`;
    return `${bytes} B`;
};
const counted = (count, noun) => `${grouped(count)} ${noun}${count === 1 ? '' : 's'}`;
const duration = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
};

// Binary data crosses the binding as a string with one UTF-16 code unit (0-255) per byte.
const byteString = (bytes) => {
    let text = '';
    for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return text;
};

// Four figures sit two by two; fewer share one row.
function Stats({ pairs, children }) {
    return <div style={{ display: 'grid', gridTemplateColumns: pairs ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 18 }}>{children}</div>;
}

function Progress({ tokens, value }) {
    return (
        <div style={{ height: 8, borderRadius: 4, background: tokens.pillBg, border: `1px solid ${tokens.border}`, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, height: '100%', background: tokens.accent }} />
        </div>
    );
}

function ElementBars({ tokens, rows }) {
    const largest = Math.max(...rows.map(([, count]) => count), 1);
    return (
        <div style={{ display: 'grid', gap: 9 }}>
            {rows.map(([name, count], index) => (
                <div key={name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: tokens.textDim, marginBottom: 4 }}>
                        <span style={{ fontFamily: tokens.mono, overflowWrap: 'anywhere' }}>{`<${name}>`}</span>
                        <span style={{ fontFamily: tokens.mono, whiteSpace: 'nowrap' }}>{grouped(count)}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: tokens.pillBg, border: `1px solid ${tokens.border}`, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(0.5, (count / largest) * 100)}%`, height: '100%', background: index === 0 ? tokens.accent : tokens.textMuted }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ---- App 1: a gigabyte of XML through one parser.

const FIREHOSE_SIZES = [
    ['1000000', '86 MB · 2.4 million elements'],
    ['5000000', '441 MB · 12 million elements'],
    ['12000000', '1.07 GB · 28.8 million elements'],
];
const STEP_BYTES = 32 * 1000 * 1000;
const FEED_BYTES = 1 << 20;

const FIREHOSE_WRAPPER = `// src/native/xml_firehose.h (excerpt)
std::string step(double bytes) {
    const double until = parsed + std::max(bytes, 1.0);
    while (!finished && parsed < until) {
        chunk.clear();
        const bool more = generator->fill(chunk, PIECE);   // the next 1 MiB of XML
        parse(chunk.data(), chunk.size(), !more);
    }
    return stats();   // counts so far, as JSON
}

void parse(const char* data, size_t length, bool last) {
    parsed += static_cast<double>(length);
    settle(XML_Parse(parser.get(), data, static_cast<int>(length), last));
}`;

const FIREHOSE_USAGE = `const m = await initNative();
const hose = await new m.XmlFirehose();
await hose.generate(12000000);   // 1.07 GB, made as it is parsed
let stats;
do {
    stats = JSON.parse(await hose.step(32e6));   // the next 32 MB
    show(stats.bytes, stats.elements, stats.memory);
} while (!stats.done);

// A file the visitor picks, as raw bytes, about 1 MB at a time:
await hose.begin(file.size);
// for each piece of file.stream(): await hose.feed(bytes, last)`;

export function FirehoseApp({ tokens, index, load }) {
    const [nodes, setNodes] = useState('1000000');
    const [live, setLive] = useState(null);
    const stop = useRef(false);
    const [state, run] = useNativeTask(load);
    const running = state.status === 'running';

    // Shows the counts after every piece and returns them.
    const tracker = (source, total) => {
        const started = performance.now();
        let firstMemory = null;
        return (stats) => {
            if (firstMemory === null) firstMemory = stats.memory;
            const view = { ...stats, source, total, seconds: (performance.now() - started) / 1000, firstMemory, stopped: false };
            setLive(view);
            return view;
        };
    };
    const stopped = (view) => {
        const final = { ...view, stopped: true };
        setLive(final);
        return final;
    };

    const generate = () =>
        run(async (m) => {
            stop.current = false;
            const hose = await new m.XmlFirehose();
            await hose.generate(Number(nodes));
            const [, label] = FIREHOSE_SIZES.find(([value]) => value === nodes);
            const update = tracker('generated OpenStreetMap-style XML', label.split(' · ')[0]);
            let view = update(JSON.parse(await hose.step(1)));
            while (!view.done && !stop.current) view = update(JSON.parse(await hose.step(STEP_BYTES)));
            return view.done ? view : stopped(view);
        });

    const parseFile = (file) =>
        run(async (m) => {
            stop.current = false;
            const hose = await new m.XmlFirehose();
            await hose.begin(file.size);
            const update = tracker(file.name, size(file.size));
            const reader = file.stream().getReader();
            let pending = [];
            let pendingBytes = 0;
            let view = null;
            for (;;) {
                const { done, value } = await reader.read();
                if (value) {
                    pending.push(value);
                    pendingBytes += value.length;
                }
                if (done || pendingBytes >= FEED_BYTES) {
                    const bytes = new Uint8Array(pendingBytes);
                    let at = 0;
                    for (const piece of pending) {
                        bytes.set(piece, at);
                        at += piece.length;
                    }
                    pending = [];
                    pendingBytes = 0;
                    view = update(JSON.parse(await hose.feed(byteString(bytes), done)));
                }
                if (done) return view;
                if (view?.done || stop.current) {
                    await reader.cancel();
                    return view?.done ? view : stopped(view ?? update(JSON.parse(await hose.feed('', false))));
                }
            }
        });

    const shown = live;
    const timed = shown && shown.seconds >= 0.2;
    const flat = shown && shown.memory === shown.firstMemory;
    return (
        <AppCard
            tokens={tokens}
            id="expat-firehose"
            index={index}
            status={state.status}
            title="Parse a gigabyte of XML without holding it"
            pitch="Expat reads XML as a stream: a piece goes in, callbacks come out, and nothing piles up. Here it parses an OpenStreetMap-style document that is generated as it goes, up to 1.07 GB, inside the Web Worker the module runs in, and its memory stays the same size from start to finish. DOMParser needs the whole document as one string, which Chrome caps at 536,870,888 characters, and Workers do not have it at all."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="GENERATE" value={nodes} onChange={setNodes} options={FIREHOSE_SIZES} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={running} onClick={generate}>Generate and parse</RunButton>
                        <FileButton tokens={tokens} accept=".xml,.osm,.gpx,.kml,.svg,.rss,.atom,text/xml,application/xml" onFile={parseFile}>Parse your own XML</FileButton>
                        {running ? <SecondaryButton tokens={tokens} onClick={() => (stop.current = true)}>Stop</SecondaryButton> : null}
                    </div>
                    <Hint tokens={tokens}>
                        The document never exists as a whole: each megabyte is generated, parsed and dropped. A file you pick is read in pieces of about a megabyte in the same way; it stays in this tab and is never uploaded.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : shown ? (
                    <div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.textDim, marginBottom: 8, overflowWrap: 'anywhere' }}>{`${shown.source} · ${shown.total}`}</div>
                        <Progress tokens={tokens} value={shown.progress} />
                        <Stats pairs>
                            <Stat tokens={tokens} accent value={size(shown.bytes)} label="parsed" />
                            <Stat tokens={tokens} value={grouped(shown.elements)} label="elements" />
                            <Stat
                                tokens={tokens}
                                value={timed ? `${(shown.bytes / 1e6 / shown.seconds).toFixed(0)} MB/s` : `${Math.round(shown.seconds * 1000)} ms`}
                                label={timed ? `for ${shown.seconds.toFixed(1)} s` : 'elapsed'}
                            />
                            <Stat tokens={tokens} value={size(shown.memory)} label={flat ? 'module memory, unchanged' : `module memory, from ${size(shown.firstMemory)}`} />
                        </Stats>
                        {shown.top.length ? <ElementBars tokens={tokens} rows={shown.top.slice(0, 5)} /> : null}
                        {shown.error ? (
                            <div style={{ marginTop: 14 }}>
                                <Failure tokens={tokens} message={`Expat stopped: ${shown.error}`} />
                            </div>
                        ) : null}
                        <Meta tokens={tokens}>
                            {`${counted(shown.attributes, 'attribute')} · ${size(shown.textBytes)} of text · nested ${shown.maxDepth} deep · line ${grouped(shown.line)}${shown.stopped ? ' · stopped by you' : shown.done && !shown.error ? ' · well-formed' : ''}`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Generate a document, or pick an XML file of any size, and watch it stream through Expat.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/xml_firehose.h', code: FIREHOSE_WRAPPER },
                { file: 'main.js', code: FIREHOSE_USAGE },
            ]}
        />
    );
}
FirehoseApp.appId = 'expat-firehose';

// ---- App 2: classic attacks against Expat's limits.

const ATTACKS = {
    laughs: {
        label: 'Billion laughs',
        sizes: [['5', '5 levels · 300 kB if expanded'], ['7', '7 levels · 30 MB if expanded'], ['9', '9 levels · 3 GB if expanded'], ['10', '10 levels · 30 GB if expanded']],
        preset: '9',
        full: (n) => 3 * 10 ** n,
    },
    quadratic: {
        label: 'Quadratic blowup',
        sizes: [['10000', '10,000 characters × 10,000 · 100 MB'], ['50000', '50,000 characters × 50,000 · 2.5 GB'], ['100000', '100,000 characters × 100,000 · 10 GB']],
        preset: '50000',
        full: (n) => n * n,
    },
    external: { label: 'External entity (XXE)', sizes: [['0', 'file:///etc/passwd and a remote DTD']], preset: '0', full: () => null },
    deep: { label: 'Deep nesting', sizes: [['10000', '10,000 levels'], ['100000', '100,000 levels']], preset: '100000', full: () => null },
};
const AMPLIFICATIONS = [['10', '10×'], ['100', '100× (Expat default)'], ['1000', '1,000×'], ['10000', '10,000×']];
const THRESHOLDS = [['65536', '64 KiB'], ['1048576', '1 MiB'], ['8388608', '8 MiB (Expat default)'], ['67108864', '64 MiB']];
const DEPTHS = [['0', 'none (Expat has none)'], ['1000', '1,000 levels'], ['10000', '10,000 levels']];

const LAB_WRAPPER = `// src/native/attack_lab.h (excerpt)
XML_SetBillionLaughsAttackProtectionMaximumAmplification(parser, maxAmplification);
XML_SetBillionLaughsAttackProtectionActivationThreshold(parser, activationBytes);
XML_SetExternalEntityRefHandler(parser, onExternal);   // logs, loads nothing

static void XMLCALL onStart(void* data, const XML_Char*, const XML_Char**) {
    Run& run = *static_cast<Run*>(data);
    run.maxDepth = std::max(run.maxDepth, ++run.depth);
    if (run.depthLimit > 0 && run.depth > run.depthLimit) {
        XML_StopParser(run.parser.get(), XML_FALSE);   // Expat has no depth limit
    }
}`;

const LAB_USAGE = `const m = await initNative();
const xml = await m.AttackLab.build('laughs', 9);   // 784 bytes
const result = JSON.parse(await m.AttackLab.parse(xml, 100, 8 * 1024 * 1024, 0));
// result.error      'limit on input amplification factor (from DTD and entities) breached'
// result.line       14, result.column 6
// result.textBytes  2603109: what got through before the stop`;

function Verdict({ tokens, result }) {
    const heading = result.ok ? 'Parsed' : result.code === 43 ? 'Blocked by Expat' : result.stoppedByDepth ? 'Stopped by the depth limit' : 'Rejected';
    return (
        <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, color: result.ok ? tokens.text : tokens.accentDisplay }}>{heading}</div>
            {result.ok ? null : (
                <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.textDim, marginTop: 6, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                    {`${result.stoppedByDepth ? 'XML_StopParser from the start handler' : result.error} · line ${result.line}, column ${result.column}`}
                </div>
            )}
        </div>
    );
}

export function AttackLabApp({ tokens, index, load }) {
    const [attack, setAttack] = useState('laughs');
    const [sizeValue, setSizeValue] = useState(ATTACKS.laughs.preset);
    const [amplification, setAmplification] = useState('100');
    const [threshold, setThreshold] = useState('8388608');
    const [depth, setDepth] = useState('1000');
    const [state, run] = useNativeTask(load);
    const chooseAttack = (value) => {
        setAttack(value);
        setSizeValue(ATTACKS[value].preset);
    };
    const start = () =>
        run(async (m) => {
            const xml = await m.AttackLab.build(attack, Number(sizeValue));
            const started = performance.now();
            const result = JSON.parse(await m.AttackLab.parse(xml, Number(amplification), Number(threshold), attack === 'deep' ? Number(depth) : 0));
            return { result, ms: performance.now() - started, preview: xml.slice(0, 420), inputBytes: xml.length, full: ATTACKS[attack].full(Number(sizeValue)), attack };
        });
    const done = state.status === 'ready' ? state.result : null;
    const result = done?.result;
    const entityBombs = attack === 'laughs' || attack === 'quadratic';
    return (
        <AppCard
            tokens={tokens}
            id="expat-attacks"
            index={index}
            status={state.status}
            title="Billion laughs, blocked at a line and column"
            pitch="Four classic attacks on XML parsers, run against Expat in this tab. Entity bombs hit Expat's amplification limit, which you can loosen or tighten here. External entities reach your code as a callback and are never fetched. Expat has no nesting limit of its own, so the lab adds one from a start handler."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 }}>
                        <Select tokens={tokens} label="ATTACK" value={attack} onChange={chooseAttack} options={Object.entries(ATTACKS).map(([value, entry]) => [value, entry.label])} />
                        <Select tokens={tokens} label="SIZE" value={sizeValue} onChange={setSizeValue} options={ATTACKS[attack].sizes} />
                    </div>
                    {entityBombs ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 }}>
                            <Select tokens={tokens} label="MAXIMUM AMPLIFICATION" value={amplification} onChange={setAmplification} options={AMPLIFICATIONS} />
                            <Select tokens={tokens} label="CHECKED AFTER" value={threshold} onChange={setThreshold} options={THRESHOLDS} />
                        </div>
                    ) : null}
                    {attack === 'deep' ? <Select tokens={tokens} label="DEPTH LIMIT IN YOUR HANDLER" value={depth} onChange={setDepth} options={DEPTHS} /> : null}
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Run the attack</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        {entityBombs && Number(threshold) < 4 * 1024 * 1024
                            ? "Expat's documentation advises checking from 4 MiB or later: an earlier check rejects some legitimate documents, such as DITA 1.3."
                            : 'The attack documents are built in the module when you run them; nothing hostile ships with the page.'}
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div>
                        <Verdict tokens={tokens} result={result} />
                        <Stats>
                            <Stat tokens={tokens} value={size(done.inputBytes)} label="attack document" />
                            {done.full ? <Stat tokens={tokens} value={size(done.full)} label="if expanded in full" /> : null}
                            <Stat tokens={tokens} accent={!result.ok} value={size(result.textBytes)} label={result.ok ? 'text delivered' : 'text delivered before the stop'} />
                            {done.attack === 'deep' ? <Stat tokens={tokens} value={grouped(result.maxDepth)} label="levels opened" /> : null}
                        </Stats>
                        {done.attack === 'external' ? (
                            <div style={{ display: 'grid', gap: 6, fontSize: 13, color: tokens.textDim, lineHeight: 1.6, marginBottom: 12 }}>
                                {result.external.map((reference) => (
                                    <div key={reference.systemId}>
                                        <span style={{ fontFamily: tokens.mono, color: tokens.text }}>{`&${reference.entity};`}</span>
                                        {` points at ${reference.systemId}: Expat called the handler, and the handler loaded nothing.`}
                                    </div>
                                ))}
                                {result.doctype?.systemId ? (
                                    <div>
                                        <span style={{ fontFamily: tokens.mono, color: tokens.text }}>{result.doctype.systemId}</span>
                                        {': never requested, because parameter entity parsing is off by default.'}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                        <Label tokens={tokens}>{`THE DOCUMENT · FIRST ${Math.min(done.preview.length, done.inputBytes)} OF ${grouped(done.inputBytes)} CHARACTERS`}</Label>
                        <pre style={{ margin: 0, maxHeight: 150, overflow: 'auto', fontFamily: tokens.mono, fontSize: 11.5, lineHeight: 1.5, color: tokens.codeText, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '10px 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                            {done.preview}
                        </pre>
                        <Meta tokens={tokens}>{`${result.entityCount} ${result.entityCount === 1 ? 'entity' : 'entities'} declared · ${counted(result.elements, 'element')} · ${Math.round(done.ms)} ms`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Pick an attack and run it to see where Expat stops it, and how much got through first.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/attack_lab.h', code: LAB_WRAPPER },
                { file: 'main.js', code: LAB_USAGE },
            ]}
        />
    );
}
AttackLabApp.appId = 'expat-attacks';

// ---- App 3: GPS tracks from GPX.

const DIRECTORY = '/memfs/expatapps';

const GPX_WRAPPER = `// src/support/gpx.h (excerpt): names arrive as "<namespace URI>|<local name>"
Reader() : parser(XML_ParserCreateNS(nullptr, '|'), XML_ParserFree) { ... }

static bool isHeartRate(const char* name) {
    const size_t length = std::strlen(TRACKPOINT_V1);   // Garmin's v1 and v2 URIs
    return (std::strncmp(name, TRACKPOINT_V1, length) == 0 ||
            std::strncmp(name, TRACKPOINT_V2, length) == 0) &&
           std::strcmp(name + length, "|hr") == 0;      // gpxtpx:hr, ns3:hr, any prefix
}`;

const GPX_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));      // the .gpx you picked
const track = JSON.parse(await m.GpxTrack.summary(path));
// track.lengthKm, track.gain, track.avgHr, track.namespaces,
// track.line: [[lon, lat], ...] to draw
const geojson = await m.GpxTrack.geojson(path);     // one LineString per segment`;

function TrackMap({ tokens, line }) {
    if (line.length < 2) return null;
    const lons = line.map(([lon]) => lon);
    const lats = line.map(([, lat]) => lat);
    const [minLon, maxLon, minLat, maxLat] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
    const squeeze = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const width = Math.max((maxLon - minLon) * squeeze, 1e-9);
    const height = Math.max(maxLat - minLat, 1e-9);
    const scale = 560 / Math.max(width, height);
    const points = line.map(([lon, lat]) => `${((lon - minLon) * squeeze * scale + 10).toFixed(1)},${((maxLat - lat) * scale + 10).toFixed(1)}`);
    const [startX, startY] = points[0].split(',');
    return (
        <svg
            viewBox={`0 0 ${(width * scale + 20).toFixed(1)} ${(height * scale + 20).toFixed(1)}`}
            width="100%"
            style={{ maxHeight: 280, display: 'block', margin: '0 auto 16px' }}
            role="img"
            aria-label="The track, drawn from its GPX points"
        >
            <polyline points={points.join(' ')} fill="none" stroke={tokens.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx={startX} cy={startY} r="5" fill={tokens.panel} stroke={tokens.text} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

function Profile({ tokens, profile }) {
    if (profile.length < 2) return null;
    const km = profile.at(-1)[0] || 1;
    const eles = profile.map(([, ele]) => ele);
    const [low, high] = [Math.min(...eles), Math.max(...eles)];
    const range = Math.max(high - low, 1);
    const points = profile.map(([at, ele]) => `${((at / km) * 600).toFixed(1)},${(78 - ((ele - low) / range) * 70).toFixed(1)}`);
    return (
        <figure style={{ margin: '0 0 6px' }}>
            <svg viewBox="0 0 600 80" width="100%" height="80" preserveAspectRatio="none" role="img" aria-label="Elevation along the track">
                <polygon points={`0,80 ${points.join(' ')} 600,80`} fill={tokens.pillBg} stroke="none" />
                <polyline points={points.join(' ')} fill="none" stroke={tokens.textMuted} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
            <figcaption style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: tokens.textMuted }}>
                <span>{`elevation ${low.toFixed(0)}-${high.toFixed(0)} m`}</span>
                <span>{`${km.toFixed(1)} km`}</span>
            </figcaption>
        </figure>
    );
}

export function GpxApp({ tokens, index, load }) {
    const [prefix, setPrefix] = useState('gpxtpx');
    const [state, run] = useNativeTask(load);
    const [exported, runExport] = useNativeTask(load);
    const summarize = async (m, path, name, stem) => ({ path, name, stem, track: JSON.parse(await m.GpxTrack.summary(path)) });
    const openSample = () =>
        run(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const path = `${DIRECTORY}/sample-${prefix}.gpx`;
            await m.GpxTrack.writeSample(path, prefix);
            return summarize(m, path, `sample ride, heart rate as ${prefix}:hr`, 'sample-ride');
        });
    const openFile = (file) =>
        run(async (m) => {
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return summarize(m, path, file.name, file.name.replace(/\.gpx$/i, '').replace(/[^\w.-]+/g, '-') || 'track');
        });
    const result = state.status === 'ready' ? state.result : null;
    const track = result?.track;
    const exportGeojson = () =>
        runExport(async (m) => {
            const geojson = await m.GpxTrack.geojson(result.path);
            download(geojson, `${result.stem}.geojson`, 'application/geo+json');
            return geojson.length;
        });
    const heartRateUri = track ? Object.values(track.namespaces).find((uri) => uri.startsWith('http://www.garmin.com/xmlschemas/TrackPointExtension/')) : null;
    return (
        <AppCard
            tokens={tokens}
            id="expat-gpx"
            index={index}
            status={state.status}
            title="Read a GPS track, heart rate and all"
            pitch="GPX files keep heart rate and cadence in extension namespaces, under whatever prefix the exporting app chose. Expat's namespace mode resolves every prefix to its URI before the handlers see a name, so this reader finds the heart rates under any spelling. It streams the file in 64 KiB reads, draws the track, totals the climb and writes GeoJSON."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="THE SAMPLE WRITES HEART RATE AS" value={prefix} onChange={setPrefix} options={[['gpxtpx', 'gpxtpx:hr'], ['ns3', 'ns3:hr']]} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={openSample}>Open the sample ride</RunButton>
                        <FileButton tokens={tokens} accept=".gpx,application/gpx+xml" onFile={openFile}>Open your own .gpx</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        The sample is a 64 km loop recorded every second, generated in the module. Your own file is copied into the module's in-memory filesystem in this tab and never uploaded. The tracks of GPX 1.0 and 1.1 files are read; routes and waypoints are not.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : track ? (
                    <div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.textDim, marginBottom: 10, overflowWrap: 'anywhere' }}>{`${track.name || result.name} · ${size(track.bytes)}`}</div>
                        {track.points ? <TrackMap tokens={tokens} line={track.line} /> : <Placeholder tokens={tokens}>This file holds no track points.</Placeholder>}
                        <Stats pairs>
                            <Stat tokens={tokens} accent value={`${track.lengthKm.toFixed(1)} km`} label={`${grouped(track.points)} points`} />
                            <Stat tokens={tokens} value={`${Math.round(track.gain)} m`} label="climbed" />
                            <Stat tokens={tokens} value={track.avgHr === null ? 'none' : `${track.avgHr.toFixed(0)} bpm`} label={track.avgHr === null ? 'heart rate' : `average, max ${track.maxHr}`} />
                            <Stat tokens={tokens} value={track.seconds === null ? 'untimed' : duration(track.seconds)} label="duration" />
                        </Stats>
                        <Profile tokens={tokens} profile={track.profile} />
                        <div style={{ marginTop: 12 }}>
                            <Label tokens={tokens}>NAMESPACES THE FILE DECLARES</Label>
                            <div style={{ display: 'grid', gap: 4 }}>
                                {Object.entries(track.namespaces).map(([name, uri]) => (
                                    <div key={name} style={{ fontFamily: tokens.mono, fontSize: 11.5, color: uri === heartRateUri ? tokens.accentText : tokens.textDim, overflowWrap: 'anywhere' }}>
                                        {`${name ? `xmlns:${name}` : 'xmlns'} = ${uri}`}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 14 }}>
                            <SecondaryButton tokens={tokens} onClick={exportGeojson}>{exported.status === 'running' ? 'Writing…' : 'Download GeoJSON'}</SecondaryButton>
                            {exported.status === 'failed' ? <Failure tokens={tokens} message={exported.message} /> : null}
                        </div>
                        <Meta tokens={tokens}>
                            {`${counted(track.tracks, 'track')} · ${counted(track.segments, 'segment')} · ${counted(track.heartRates, 'heart rate')} · descent ${Math.round(track.loss)} m · read in ${state.ms} ms`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open the sample ride, or a .gpx from your watch or app, to see the track it holds.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/gpx.h', code: GPX_WRAPPER },
                { file: 'main.js', code: GPX_USAGE },
            ]}
        />
    );
}
GpxApp.appId = 'expat-gpx';

export const EXPAT_APPS = [FirehoseApp, AttackLabApp, GpxApp];

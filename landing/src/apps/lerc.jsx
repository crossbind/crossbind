import { useEffect, useMemo, useRef, useState } from 'react';
import AppCard, { Failure, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Select, Stat } from './controls.jsx';

// The LERC apps on /ports/lerc/. Each one drives landing/demos/lib-lerc, whose index.html checks the
// same calls against numbers from Esri's Python wrapper over a native build of LERC 4.2.0, and numpy,
// on the same generated rasters.

const DIRECTORY = '/memfs/lercapps';
const SIDE = 512;
const RAW_BYTES = SIDE * SIDE * 4;
const BUDGETS = [
    { value: 0, label: 'Lossless' },
    { value: 0.01, label: '1 cm' },
    { value: 0.1, label: '10 cm' },
    { value: 0.5, label: '50 cm' },
    { value: 1, label: '1 m' },
    { value: 5, label: '5 m' },
];
const TERRAINS = [
    [0, 'Mountains, 30 m cells (15 km)'],
    [1, 'Lowland, 2 m cells (1 km)'],
];
const INTEGER_TYPES = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32'];

const times = (numerator, denominator) => `${(numerator / denominator).toFixed(2)}×`;
const floats = (bytes) => new Float32Array(bytes.slice().buffer);
const percent = (part, whole) => `${Math.round((part / whole) * 1000) / 10}%`;
const short = (value) => String(Number(value.toPrecision(6)));
// Five significant digits, so an error just under its budget never rounds up to the budget itself.
const measured = (value) => (value === 0 ? '0' : value.toPrecision(5));

const rgbOf = (hex) => {
    const value = Number.parseInt(hex.replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

// What this browser's own gzip makes of the same bytes; a browser without CompressionStream shows none.
async function gzipSize(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    return compressed.byteLength;
}

// Relief shading as cartographers draw it: sun in the northwest, 45 degrees up, Horn's slope.
function hillshade(heights, size, cell) {
    const out = new Uint8ClampedArray(size * size * 4);
    const zenith = Math.PI / 4;
    const azimuth = (135 * Math.PI) / 180;
    const at = (x, y) => heights[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const a = at(x - 1, y - 1);
            const b = at(x, y - 1);
            const c = at(x + 1, y - 1);
            const d = at(x - 1, y);
            const f = at(x + 1, y);
            const g = at(x - 1, y + 1);
            const h = at(x, y + 1);
            const i = at(x + 1, y + 1);
            const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cell);
            const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cell);
            const slope = Math.atan(Math.hypot(dzdx, dzdy));
            const aspect = Math.atan2(dzdy, -dzdx);
            const shade = Math.cos(zenith) * Math.cos(slope) + Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect);
            const k = (y * size + x) * 4;
            out[k] = out[k + 1] = out[k + 2] = Math.max(0, shade) * 255;
            out[k + 3] = 255;
        }
    }
    return out;
}

// How far each value moved, as a share of the budget: clear where nothing moved, the accent at the budget.
function errorMap(original, decoded, budget, rgb) {
    const out = new Uint8ClampedArray(original.length * 4);
    for (let i = 0; i < original.length; i += 1) {
        const k = i * 4;
        out[k] = rgb[0];
        out[k + 1] = rgb[1];
        out[k + 2] = rgb[2];
        out[k + 3] = budget > 0 ? Math.min(1, Math.abs(decoded[i] - original[i]) / budget) * 255 : 0;
    }
    return out;
}

// Values stretched from dark grey at the minimum to light grey at the maximum; pixels without a value
// get a faint hatch, so they read as missing on a light page and a dark one alike.
function grayscale(values, mask, width, low, high) {
    const out = new Uint8ClampedArray(values.length * 4);
    for (let i = 0; i < values.length; i += 1) {
        const k = i * 4;
        if (mask[i]) {
            out[k] = out[k + 1] = out[k + 2] = high > low ? 40 + ((values[i] - low) / (high - low)) * 195 : 128;
            out[k + 3] = 255;
        } else {
            out[k] = out[k + 1] = out[k + 2] = 128;
            out[k + 3] = ((i % width) + Math.floor(i / width)) % 8 === 0 ? 110 : 0;
        }
    }
    return out;
}

function Picture({ tokens, pixels, width, height, label, children }) {
    const canvas = useRef(null);
    useEffect(() => {
        if (canvas.current && pixels) canvas.current.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
    }, [pixels, width, height]);
    return (
        <figure style={{ margin: 0, minWidth: 0 }}>
            <canvas
                ref={canvas}
                width={width}
                height={height}
                role="img"
                aria-label={label}
                style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 8, border: `1px solid ${tokens.border}`, background: tokens.codeBg }}
            />
            <figcaption style={{ fontSize: 12, lineHeight: 1.5, color: tokens.textMuted, marginTop: 6 }}>{children ?? label}</figcaption>
        </figure>
    );
}

function Bar({ tokens, label, bytes, largest, highlight, note, onClick, selected }) {
    const body = (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: tokens.textDim, marginBottom: 5 }}>
                <span style={{ color: selected ? tokens.accentText : tokens.textDim, fontWeight: selected ? 600 : 400 }}>{label}</span>
                <span style={{ fontFamily: tokens.mono, color: highlight ? tokens.accentText : tokens.textDim, whiteSpace: 'nowrap' }}>{note ?? `${grouped(bytes)} B`}</span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: tokens.pillBg, border: `1px solid ${tokens.border}`, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(0.5, (bytes / largest) * 100)}%`, height: '100%', background: highlight ? tokens.accent : tokens.textMuted }} />
            </div>
        </>
    );
    if (!onClick) return <div>{body}</div>;
    return (
        <button
            type="button"
            className="tap-target"
            onClick={onClick}
            aria-pressed={selected}
            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
        >
            {body}
        </button>
    );
}

const SQUEEZE_WRAPPER = `// src/support/grid.h (excerpt)
// LERC quantizes in double precision and rounds back to float32, which can
// overshoot maxError by half a float32 step: ask for one step less.
const double step = double(std::nextafter(largest, INFINITY)) - largest;
const double bound = maxError > step ? maxError - step : 0;
unsigned int size = 0;
check(lerc_computeCompressedSize(values.data(), kFloat, 1, width, height, 1,
                                 masks, valid, bound, &size), "sizing");
std::string blob(size, '\\0');
unsigned int written = 0;
check(lerc_encode(values.data(), kFloat, 1, width, height, 1, masks, valid, bound,
                  reinterpret_cast<unsigned char*>(&blob[0]), size, &written), "encoding");`;

const SQUEEZE_USAGE = `const m = await initNative();
const lab = await new m.TerrainLab(0);   // 512 x 512 float32 heights, 30 m cells
await m.FS.mkdirTree('/memfs/lercapps');

const packed = JSON.parse(await lab.compress(0.01, '/memfs/lercapps/t.lerc'));
// packed.bytes 464,085: 2.26x smaller than the 1,048,576 B of float32
const back = JSON.parse(await lab.decompress('/memfs/lercapps/t.lerc', '/memfs/lercapps/t.f32'));
// back.maxError 0.009521484375: every height within 1 cm`;

export function TerrainSqueeze({ tokens, index, load }) {
    const [terrain, setTerrain] = useState(0);
    const [chosen, setChosen] = useState(1);
    const [showOriginal, setShowOriginal] = useState(false);
    const [state, run] = useNativeTask(load);
    const start = () =>
        run(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const lab = await new m.TerrainLab(terrain);
            const base = `${DIRECTORY}/terrain-${terrain}`;
            await lab.writeHeights(`${base}.f32`);
            const raw = await m.getFileBytes(`${base}.f32`);
            const rows = [];
            for (const [position, budget] of BUDGETS.entries()) {
                const packed = JSON.parse(await lab.compress(budget.value, `${base}-${position}.lerc`));
                const unpacked = JSON.parse(await lab.decompress(`${base}-${position}.lerc`, `${base}-${position}.f32`));
                rows.push({
                    ...budget,
                    ...packed,
                    measured: unpacked.maxError,
                    decodeMs: unpacked.ms,
                    decoded: floats(await m.getFileBytes(`${base}-${position}.f32`)),
                    blob: await m.getFileBytes(`${base}-${position}.lerc`),
                });
            }
            return { terrain, cell: await lab.cellSize(), heights: floats(raw), gzip: await gzipSize(raw), rows };
        });
    const result = state.status === 'ready' ? state.result : null;
    const row = result?.rows[chosen];
    const accent = tokens.accent;
    const relief = useMemo(() => (result ? hillshade(showOriginal ? result.heights : row.decoded, SIDE, result.cell) : null), [result, row, showOriginal]);
    const moved = useMemo(() => (result ? errorMap(result.heights, row.decoded, row.value, rgbOf(accent)) : null), [result, row, accent]);
    return (
        <AppCard
            tokens={tokens}
            id="lerc-squeeze"
            index={index}
            status={state.status}
            title="Shrink an elevation model to the error you can accept"
            pitch="LERC stores a raster so that no value moves by more than the error you choose. Here a 512 × 512 elevation model is encoded at six budgets, from lossless to 5 m, then every height is decoded and compared with the original. Esri's own lerc package on npm and loaders.gl only decode it; this is Esri's C++ library, compiled by crossbind, encoding in your tab."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="TERRAIN" value={terrain} onChange={setTerrain} options={TERRAINS} />
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Compress at every budget</RunButton>
                    </div>
                    {result ? (
                        <div style={{ display: 'grid', gap: 11 }}>
                            <Label tokens={tokens}>PICK A BUDGET</Label>
                            <Bar tokens={tokens} label="float32, as stored in memory" bytes={RAW_BYTES} largest={RAW_BYTES} />
                            {result.gzip === null ? null : <Bar tokens={tokens} label="gzip in this browser (lossless)" bytes={result.gzip} largest={RAW_BYTES} />}
                            {result.rows.map((entry, position) => (
                                <Bar
                                    key={entry.label}
                                    tokens={tokens}
                                    label={entry.value ? `LERC within ${entry.label}` : 'LERC, lossless'}
                                    bytes={entry.bytes}
                                    largest={RAW_BYTES}
                                    note={`${grouped(entry.bytes)} B · ${times(RAW_BYTES, entry.bytes)}`}
                                    highlight={position === chosen}
                                    selected={position === chosen}
                                    onClick={() => setChosen(position)}
                                />
                            ))}
                        </div>
                    ) : (
                        <Hint tokens={tokens}>
                            The terrain is generated in the module from integer noise, so the sizes are the same on every machine.
                        </Hint>
                    )}
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 16 }}>
                            <Stat tokens={tokens} size={26} accent value={times(RAW_BYTES, row.bytes)} label={`smaller, ${row.value ? `within ${row.label}` : 'lossless'}`} />
                            <Stat tokens={tokens} size={26} value={row.measured === 0 ? 'none' : `${measured(row.measured)} m`} label="largest error, measured" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                            <Picture tokens={tokens} pixels={relief} width={SIDE} height={SIDE} label={showOriginal ? 'Original relief' : `Relief after LERC, ${row.label.toLowerCase()}`} />
                            <Picture tokens={tokens} pixels={moved} width={SIDE} height={SIDE} label="Where heights moved">
                                {row.value ? `Where heights moved: clear is 0, full colour is ${row.label}` : 'Nothing moved: every bit is back'}
                            </Picture>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 14 }}>
                            <SecondaryButton tokens={tokens} pressed={showOriginal} onClick={() => setShowOriginal(!showOriginal)}>
                                {showOriginal ? 'Showing the original' : 'Compare with the original'}
                            </SecondaryButton>
                            <SecondaryButton tokens={tokens} onClick={() => download(row.blob, `terrain-${row.label.replace(' ', '').toLowerCase()}.lerc`)}>Download the .lerc</SecondaryButton>
                        </div>
                        <Meta tokens={tokens}>
                            {`all ${grouped(SIDE * SIDE)} heights decoded and compared · ${row.measured <= row.value ? 'within the budget' : 'OVER THE BUDGET'} · maxZError ${short(row.maxErrorUsed)} in the blob · encoded in ${Math.round(row.ms)} ms, decoded in ${Math.round(row.decodeMs)} ms`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Compress the terrain to see how size and error trade off, budget by budget.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/grid.h', code: SQUEEZE_WRAPPER },
                { file: 'main.js', code: SQUEEZE_USAGE },
            ]}
        />
    );
}
TerrainSqueeze.appId = 'lerc-squeeze';

const INSPECTOR_WRAPPER = `// src/native/lerc_inspector.h (excerpt)
unsigned int info[11] = {};  // version, type, depth, width, height, bands, valid pixels, ...
double range[3] = {};        // zMin, zMax, the largest error the encoder allowed
check(lerc_getBlobInfo(blob, size, info, range, 11, 3), "reading the header");
// [min, max] for every band and value per pixel, still without decoding
lerc_getDataRanges(blob, size, depth, bands, mins.data(), maxs.data());
// then any data type decodes to double, with the validity mask
lerc_decodeToDouble_4D(blob, size, masks, valid.data(), depth, width, height, bands,
                       values.data(), usesNoData.data(), noData.data());`;

const INSPECTOR_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));   // a .lerc from <input type=file>

const info = JSON.parse(await m.LercInspector.inspect(path));
// { codec: 'Lerc2 v6', type: 'float32', width: 512, height: 512,
//   bands: 1, validPixels: 171406, maxZErrorUsed: 0.00999..., ... }
const band = JSON.parse(await m.LercInspector.decodeBand(path, 0, '/memfs/b.f32', '/memfs/b.mask'));
const values = new Float32Array((await m.getFileBytes('/memfs/b.f32')).buffer);`;

const storedWith = (info) => {
    if (info.maxZErrorUsed === 0) return 'none: lossless';
    if (INTEGER_TYPES.includes(info.type) && info.maxZErrorUsed === 0.5) return '0.5: exact for integers';
    return String(Number(info.maxZErrorUsed.toPrecision(3)));
};

export function LercInspectorApp({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [view, runView] = useNativeTask(load);
    const decode = async (m, path, band) => {
        const stats = JSON.parse(await m.LercInspector.decodeBand(path, band, `${DIRECTORY}/band.f32`, `${DIRECTORY}/band.mask`));
        return { band, stats, values: floats(await m.getFileBytes(`${DIRECTORY}/band.f32`)), mask: await m.getFileBytes(`${DIRECTORY}/band.mask`) };
    };
    const open = async (m, path, name, size) => ({ path, name, size, info: JSON.parse(await m.LercInspector.inspect(path)), first: await decode(m, path, 0) });
    const openSample = () =>
        run(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const path = `${DIRECTORY}/island.lerc`;
            const size = await m.LercInspector.writeSample(path);
            return open(m, path, 'island.lerc', size);
        });
    const openFile = (file) => {
        if (!file) return;
        run(async (m) => {
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return open(m, path, file.name, file.size);
        });
    };
    const result = state.status === 'ready' ? state.result : null;
    const shown = view.status === 'ready' && view.result.source === result ? view.result : result?.first;
    const info = result?.info;
    const pixels = useMemo(() => (shown ? grayscale(shown.values, shown.mask, info.width, shown.stats.min, shown.stats.max) : null), [shown, info]);
    const pick = (band) => runView(async (m) => ({ ...(await decode(m, result.path, band)), source: result }));
    return (
        <AppCard
            tokens={tokens}
            id="lerc-inspector"
            index={index}
            status={state.status}
            title="Look inside a LERC tile before you decode it"
            pitch="ArcGIS elevation services send each tile as a LERC blob. Open one to read its header without decoding: size, data type, bands, how many pixels hold a value, the value range and the error it was stored with. Then decode a band and draw it. Legacy Lerc1 tiles, the kind ArcGIS Terrain 3D serves, open too."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={openSample}>Open the sample</RunButton>
                        <FileButton tokens={tokens} accept=".lerc,.lerc1,.lerc2,.lrc,application/octet-stream" onFile={openFile}>Open your own .lerc</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        The sample is written by the module: the lowland from the first app as an island, the sea below 56 m left out through LERC's validity mask. Your own file stays in this tab: it is mounted into the module's in-memory filesystem, never uploaded.
                    </Hint>
                    {info && info.bands > 1 ? (
                        <div>
                            <Label tokens={tokens}>BAND</Label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {Array.from({ length: Math.min(info.bands, 16) }, (_, band) => (
                                    <SecondaryButton key={band} tokens={tokens} pressed={shown?.band === band} onClick={() => pick(band)}>
                                        {band + 1}
                                    </SecondaryButton>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, marginBottom: 12, overflowWrap: 'anywhere' }}>{`${result.name} · ${grouped(result.size)} B`}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14, marginBottom: 16 }}>
                            <Stat tokens={tokens} size={26} accent value={info.codec} label="codec" />
                            <Stat tokens={tokens} size={26} value={`${info.width} × ${info.height}`} label={info.depth > 1 ? `${info.depth} values per pixel` : 'pixels'} />
                            <Stat tokens={tokens} size={26} value={info.type} label={info.bands === 1 ? '1 band' : `${info.bands} bands`} />
                            <Stat tokens={tokens} size={26} value={percent(info.validPixels, info.width * info.height)} label="of pixels hold a value" />
                            <Stat tokens={tokens} size={26} value={storedWith(info)} label="error it was stored with" />
                        </div>
                        {pixels ? (
                            <Picture
                                tokens={tokens}
                                pixels={pixels}
                                width={info.width}
                                height={info.height}
                                label={`Band ${shown.band + 1}: dark at ${short(shown.stats.min)}, light at ${short(shown.stats.max)}${shown.stats.valid < info.width * info.height ? ', hatched where there is no value' : ''}`}
                            />
                        ) : null}
                        {view.status === 'failed' ? <Failure tokens={tokens} message={view.message} /> : null}
                        <Meta tokens={tokens}>
                            {`header: values ${short(info.zMin)} to ${short(info.zMax)} · ${info.masks === 0 ? 'no mask' : info.masks === 1 ? 'one validity mask' : `${info.masks} validity masks`} · blob ${grouped(info.blobSize)} B${shown ? ` · band ${shown.band + 1} decoded in ${Math.round(shown.stats.ms)} ms, ${grouped(shown.stats.valid)} values` : ''}`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open the sample, or a .lerc tile of your own, to read its header and draw a band.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/lerc_inspector.h', code: INSPECTOR_WRAPPER },
                { file: 'main.js', code: INSPECTOR_USAGE },
            ]}
        />
    );
}
LercInspectorApp.appId = 'lerc-inspector';

// `steps` names the grid the values sit on, when there is one for LERC to find.
const DATASETS = [
    { name: 'Terrain heights, in metres', tolerance: 0.01, within: '±1 cm' },
    { name: 'Air temperature, read to 0.01 °C', tolerance: 0.005, within: '±0.005 °C', steps: '0.01' },
    { name: 'Land-cover classes, whole numbers 0 to 8', tolerance: null },
    { name: 'Random values between 0 and 1', tolerance: 0.01, within: '±0.01' },
];

const VERSUS_WRAPPER = `// src/native/dataset_lab.h (excerpt): LERC within maxError, decoded back and compared
const std::string blob = grid::encode(values, 512, 512, nullptr, maxError);
const std::vector<float> back = grid::decode(blob);
const bool identical = std::memcmp(back.data(), values.data(), values.size() * 4) == 0;`;

const VERSUS_USAGE = `const m = await initNative();
const lab = await new m.DatasetLab();
await lab.write(1, '/memfs/temps.f32');   // air temperature, read to 0.01
const raw = await m.getFileBytes('/memfs/temps.f32');
const gzip = new CompressionStream('gzip');
const gzipped = await new Response(new Blob([raw]).stream().pipeThrough(gzip)).arrayBuffer();

JSON.parse(await lab.compress(1, 0));       // lossless: 252,904 B
JSON.parse(await lab.compress(1, 0.005));   // 235,281 B, largest error 0.0000019`;

function verdict(gzip, lossless) {
    if (gzip === null) return 'This browser has no CompressionStream, so there is no gzip to compare with.';
    if (lossless < gzip) return `Lossless, LERC is ${Math.round((1 - lossless / gzip) * 100)}% smaller than gzip.`;
    return `Lossless, gzip is ${Math.round((1 - gzip / lossless) * 100)}% smaller than LERC: long runs of the same whole number are what gzip does best.`;
}

function nearNote(row) {
    if (!row.near) return '';
    const found = row.steps && row.near.maxError < row.tolerance / 100 ? `: LERC found the ${row.steps} steps in the data and stored those` : '';
    return ` Within ${row.within}, the largest error measured was ${measured(row.near.maxError)}${found}.`;
}

export function LercVersusGzip({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const start = () =>
        run(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const lab = await new m.DatasetLab();
            const rows = [];
            for (const [position, dataset] of DATASETS.entries()) {
                const path = `${DIRECTORY}/dataset-${position}.f32`;
                await lab.write(position, path);
                const raw = await m.getFileBytes(path);
                rows.push({
                    ...dataset,
                    gzip: await gzipSize(raw),
                    lossless: JSON.parse(await lab.compress(position, 0)),
                    near: dataset.tolerance === null ? null : JSON.parse(await lab.compress(position, dataset.tolerance)),
                });
            }
            return rows;
        });
    const rows = state.status === 'ready' ? state.result : null;
    return (
        <AppCard
            tokens={tokens}
            id="lerc-vs-gzip"
            index={index}
            status={state.status}
            title="Where LERC beats gzip, and where it does not"
            pitch="gzip sees a float32 raster as bytes; LERC sees the values. Four 512 × 512 rasters go through this browser's own gzip and through LERC, losslessly and within a stated tolerance. Terrain and measurements come out smaller with LERC; a map of whole-number classes is where gzip wins."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Compress all four</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        Each raster is 1,048,576 bytes of float32, generated in the module. The gzip bars come from this browser's CompressionStream and can differ a little between browsers; the LERC numbers are the same everywhere.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : rows ? (
                    <div style={{ display: 'grid', gap: 20 }}>
                        {rows.map((row) => {
                            const largest = Math.max(row.gzip ?? 0, row.lossless.bytes, row.near?.bytes ?? 0);
                            return (
                                <div key={row.name}>
                                    <div style={{ fontSize: 13.5, fontWeight: 600, color: tokens.text, marginBottom: 9 }}>{row.name}</div>
                                    <div style={{ display: 'grid', gap: 9 }}>
                                        {row.gzip === null ? null : <Bar tokens={tokens} label="gzip, lossless" bytes={row.gzip} largest={largest} highlight={row.gzip < row.lossless.bytes} />}
                                        <Bar tokens={tokens} label="LERC, lossless" bytes={row.lossless.bytes} largest={largest} highlight={row.gzip !== null && row.lossless.bytes < row.gzip} />
                                        {row.near ? <Bar tokens={tokens} label={`LERC within ${row.within}`} bytes={row.near.bytes} largest={largest} /> : null}
                                    </div>
                                    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: tokens.textDim, marginTop: 8 }}>{`${verdict(row.gzip, row.lossless.bytes)}${nearNote(row)}`}</div>
                                </div>
                            );
                        })}
                        <Meta tokens={tokens}>{`every blob was decoded again; the lossless ones came back ${rows.every((row) => row.lossless.identical) ? 'bit for bit' : 'WITH DIFFERENCES'}`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Compress the four rasters to compare gzip and LERC on each.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/dataset_lab.h', code: VERSUS_WRAPPER },
                { file: 'main.js', code: VERSUS_USAGE },
            ]}
        />
    );
}
LercVersusGzip.appId = 'lerc-vs-gzip';

export const LERC_APPS = [TerrainSqueeze, LercInspectorApp, LercVersusGzip];

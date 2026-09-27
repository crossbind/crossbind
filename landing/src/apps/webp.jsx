import { useEffect, useMemo, useRef, useState } from 'react';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Select, Stat, Toggle } from './controls.jsx';

// The WebP apps on /ports/webp/. Each one drives landing/demos/lib-webp, whose index.html checks the
// same calls against cwebp and dwebp 1.6.0, numpy and a native libwebp build on the same generated images.

const DIRECTORY = '/memfs/webpapps';
const STUDIO = { source: `${DIRECTORY}/studio/source.rgba`, webp: `${DIRECTORY}/studio/out.webp` };
const STICKER = { source: `${DIRECTORY}/sticker/source.rgba`, webp: `${DIRECTORY}/sticker/sticker.webp`, canvas: `${DIRECTORY}/sticker/canvas.rgba` };
const STREAM = { card: `${DIRECTORY}/stream/card.rgba`, webp: `${DIRECTORY}/stream/card.webp`, frame: `${DIRECTORY}/stream/frame.rgba` };
const CANIUSE_WEBP_ENCODE = 'https://caniuse.com/mdn-api_htmlcanvaselement_toblob_type_parameter_webp';
const WHATSAPP_STICKERS = 'https://github.com/WhatsApp/stickers/blob/main/Android/README.md';
const STUDIO_MAX_SIDE = 1600;
const STICKER_MAX_SIDE = 1024;
const STREAM_MAX_PIXELS = 4000000;
const STREAM_STEPS = 48;

const times = (numerator, denominator) => `${(numerator / denominator).toFixed(1)}×`;
const kilobytes = (value) => (value >= 1e6 ? `${(value / 1e6).toFixed(2)} MB` : value >= 1e4 ? `${Math.round(value / 1e3)} KB` : `${(value / 1e3).toFixed(1)} KB`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function canvasOf(rgba, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
    return canvas;
}

const blobOf = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// m.FS.writeFile appends to a file that already exists (Emscripten's WASMFS writes at the current end),
// so a second image would land behind the first; the old file goes first.
async function writeFile(m, path, bytes) {
    if ((await m.FS.analyzePath(path)).exists) await m.FS.unlink(path);
    await m.FS.writeFile(path, bytes);
}

// What this browser's own encoder makes of the same pixels; toBlob falls back to PNG where WebP is not supported.
async function browserWebp(canvas, quality) {
    const blob = await blobOf(canvas, 'image/webp', quality / 100);
    return blob && blob.type === 'image/webp' ? blob.size : null;
}

// The browser decodes the file; libwebp only ever sees its RGBA pixels.
async function readImageFile(file, maxSide) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`${file.name} is not an image this browser can open.`);
    }
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return { canvas, rgba: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer), width, height };
}

// Made in render so an <img> never holds a URL that was already revoked; released after the next commit.
function useBlobUrl(bytes, type) {
    const url = useMemo(() => (bytes ? URL.createObjectURL(new Blob([bytes], { type })) : null), [bytes, type]);
    useEffect(
        () => () => {
            if (url) URL.revokeObjectURL(url);
        },
        [url],
    );
    return url;
}

function Slider({ tokens, label, value, min = 0, max = 100, onChange, hint }) {
    return (
        <label style={{ display: 'block', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <Label tokens={tokens}>{label}</Label>
                <span style={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.text }}>{grouped(value)}</span>
            </div>
            <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ width: '100%', accentColor: tokens.accent }} />
            {hint ? <div style={{ fontSize: 12, color: tokens.textMuted, marginTop: 2 }}>{hint}</div> : null}
        </label>
    );
}

function Link({ tokens, href, children }) {
    return (
        <a href={href} target="_blank" rel="noreferrer" style={{ color: tokens.accentText }}>
            {children}
        </a>
    );
}

// A flat checkerboard, so transparent pixels read as transparent.
const checkerboard = (tokens) => ({
    backgroundColor: tokens.panel,
    backgroundImage: `linear-gradient(45deg, ${tokens.border} 25%, transparent 25%, transparent 75%, ${tokens.border} 75%), linear-gradient(45deg, ${tokens.border} 25%, transparent 25%, transparent 75%, ${tokens.border} 75%)`,
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 8px 8px',
});

// The original on the left of the divider, the decoded WebP on the right, at the chosen zoom.
function Compare({ tokens, originalUrl, webpUrl, width, height }) {
    const [split, setSplit] = useState(50);
    const [zoom, setZoom] = useState('fit');
    const size = zoom === 'fit' ? { width: '100%' } : { width: width * Number(zoom), maxWidth: 'none' };
    const rendering = zoom === 'fit' ? 'auto' : 'pixelated';
    return (
        <div>
            <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, overflow: 'auto', maxHeight: 460, ...checkerboard(tokens) }}>
                <div style={{ position: 'relative', ...size, aspectRatio: `${width} / ${height}` }}>
                    <img src={webpUrl} alt="The decoded WebP" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: rendering }} />
                    <img src={originalUrl} alt="The original" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', clipPath: `inset(0 ${100 - split}% 0 0)`, imageRendering: rendering }} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${split}%`, width: 2, marginLeft: -1, background: tokens.accent }} />
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                <span style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted }}>ORIGINAL</span>
                <input type="range" min={0} max={100} value={split} aria-label="Move the divider between the original and the WebP" onChange={(event) => setSplit(Number(event.target.value))} style={{ flex: 1, minWidth: 0, accentColor: tokens.accent }} />
                <span style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted }}>WEBP</span>
                <select value={zoom} aria-label="Zoom" onChange={(event) => setZoom(event.target.value)} style={{ ...fieldStyle(tokens), width: 'auto', padding: '4px 8px', fontSize: 12 }}>
                    <option value="fit">Fit</option>
                    <option value="1">100%</option>
                    <option value="2">200%</option>
                    <option value="4">400%</option>
                </select>
            </div>
        </div>
    );
}

// Bytes against PSNR for every lossy quality in the sweep; the current quality in the accent.
function RateCurve({ tokens, points, quality }) {
    const width = 320;
    const height = 150;
    const pad = 26;
    const bytes = points.map((point) => point.bytes);
    const psnr = points.map((point) => point.psnr);
    const x = (value) => pad + ((value - Math.min(...bytes)) / (Math.max(...bytes) - Math.min(...bytes) || 1)) * (width - pad * 2);
    const y = (value) => height - pad - ((value - Math.min(...psnr)) / (Math.max(...psnr) - Math.min(...psnr) || 1)) * (height - pad * 2);
    const current = points.reduce((best, point) => (Math.abs(point.quality - quality) < Math.abs(best.quality - quality) ? point : best), points[0]);
    return (
        <figure style={{ margin: '16px 0 0' }}>
            <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={points.map((point) => `quality ${point.quality}: ${point.bytes} bytes, ${point.psnr} dB`).join('; ')}>
                <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke={tokens.border} />
                <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke={tokens.border} />
                <polyline points={points.map((point) => `${x(point.bytes)},${y(point.psnr)}`).join(' ')} fill="none" stroke={tokens.textMuted} strokeWidth="1.5" />
                {points.map((point) => (
                    <g key={point.quality}>
                        <circle cx={x(point.bytes)} cy={y(point.psnr)} r={point === current ? 5 : 3} fill={point === current ? tokens.accent : tokens.textMuted} />
                        {point === current || [0, 20, 80, 100].includes(point.quality) ? (
                            <text x={x(point.bytes)} y={y(point.psnr) - 8} textAnchor="middle" fontSize="9" fill={tokens.textMuted} fontFamily={tokens.mono}>{`q${point.quality}`}</text>
                        ) : null}
                    </g>
                ))}
                <text x={width - pad} y={height - 8} textAnchor="end" fontSize="9" fill={tokens.textMuted} fontFamily={tokens.mono}>{`bytes, ${grouped(Math.min(...bytes))} to ${grouped(Math.max(...bytes))}`}</text>
                <text x={pad} y={14} fontSize="9" fill={tokens.textMuted} fontFamily={tokens.mono}>{`PSNR, ${Math.min(...psnr)} to ${Math.max(...psnr)} dB`}</text>
            </svg>
            <figcaption style={{ fontSize: 12, color: tokens.textMuted, marginTop: 4 }}>
                Every point is a lossy encode of this image with the same preset and method. Where the curve flattens, more bytes buy little PSNR.
            </figcaption>
        </figure>
    );
}

const STUDIO_WRAPPER = `// src/native/webp_studio.h (excerpt): one encode, then measure what it decodes to
WebPConfig config;
WebPConfigPreset(&config, lossy ? presetNamed(preset) : WEBP_PRESET_DEFAULT, quality);
config.method = method;
if (lossy) {
    config.use_sharp_yuv = sharpYuv ? 1 : 0;
} else {
    config.lossless = 1;
    config.near_lossless = mode == "near-lossless" ? nearLossless : 100;
}
const std::vector<uint8_t> webp = imaging::encode(config, rgba, width, height);
const imaging::Fidelity fidelity = imaging::measure(rgba, imaging::decode(webp).rgba, width, height);`;

const STUDIO_USAGE = `const m = await initNative();
const pixels = canvas.getContext('2d').getImageData(0, 0, 512, 384).data;
// m.FS.writeFile appends to an existing file here: unlink it first when you replace one
await m.FS.writeFile('/memfs/webpapps/studio/source.rgba', new Uint8Array(pixels.buffer));

const report = JSON.parse(await m.WebpStudio.encode('/memfs/webpapps/studio/source.rgba', 512, 384,
    '/memfs/webpapps/studio/out.webp', 'lossy', 75, 100, 'default', 4, false));
// the test card: report.bytes 14852, report.psnr 29.37, report.ssim 0.9561
const webp = await m.getFileBytes('/memfs/webpapps/studio/out.webp');`;

const STUDIO_DEFAULTS = { mode: 'lossy', quality: 75, near: 60, preset: 'default', method: 4, sharp: false };
const PRESETS = [['default', 'Default'], ['photo', 'Photo'], ['picture', 'Picture'], ['drawing', 'Drawing'], ['icon', 'Icon'], ['text', 'Text']];

export function WebpStudio({ tokens, index, load }) {
    const [settings, setSettings] = useState(STUDIO_DEFAULTS);
    const [state, run] = useNativeTask(load);
    const [sweep, runSweep] = useNativeTask(load);
    const source = useRef(null);
    const update = (change) => setSettings((current) => ({ ...current, ...change }));

    const encode = async (m, current) => {
        const image = source.current;
        const report = JSON.parse(
            await m.WebpStudio.encode(STUDIO.source, image.width, image.height, STUDIO.webp, current.mode, current.quality, current.near, current.preset, current.method, current.sharp),
        );
        const bytes = await m.getFileBytes(STUDIO.webp);
        const browser = current.mode === 'lossy' ? await browserWebp(image.canvas, current.quality) : undefined;
        return { report, bytes, browser, settings: current, image };
    };
    const openCard = () =>
        run(async (m) => {
            await m.FS.mkdirTree(`${DIRECTORY}/studio`);
            const [width, height] = (await m.WebpStudio.writeTestCard(STUDIO.source)).split('x').map(Number);
            const canvas = canvasOf(await m.getFileBytes(STUDIO.source), width, height);
            source.current = { name: 'the test card', width, height, canvas, png: await blobOf(canvas, 'image/png'), fileBytes: null };
            return encode(m, settings);
        });
    const openFile = (file) =>
        run(async (m) => {
            const image = await readImageFile(file, STUDIO_MAX_SIDE);
            await m.FS.mkdirTree(`${DIRECTORY}/studio`);
            await writeFile(m, STUDIO.source, image.rgba);
            source.current = { name: file.name, width: image.width, height: image.height, canvas: image.canvas, png: await blobOf(image.canvas, 'image/png'), fileBytes: file.size };
            return encode(m, settings);
        });

    useEffect(() => {
        if (!source.current) return undefined;
        const timer = setTimeout(() => run((m) => encode(m, settings)), 220);
        return () => clearTimeout(timer);
    }, [settings]);

    const result = state.result;
    const originalUrl = useBlobUrl(result?.image.png, 'image/png');
    const webpUrl = useBlobUrl(result?.bytes, 'image/webp');
    const report = result?.report;
    const lossy = settings.mode === 'lossy';
    return (
        <AppCard
            tokens={tokens}
            id="webp-studio"
            index={index}
            status={state.status}
            title="See what each WebP quality costs, and what it gives away"
            pitch={
                <>
                    Encode the test card or your own image with libwebp 1.6.0, then compare the result with the original next to its size, PSNR and SSIM. A canvas can only be given a type and a quality, and Safari cannot encode WebP from a canvas at all (
                    <Link tokens={tokens} href={CANIUSE_WEBP_ENCODE}>caniuse</Link>
                    ). Here you also get lossless, near-lossless, content presets, effort and sharp YUV.
                </>
            }
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={openCard}>Encode the test card</RunButton>
                        <FileButton tokens={tokens} accept="image/*" onFile={openFile}>Open your own image</FileButton>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 12 }}>
                        <Select tokens={tokens} label="MODE" value={settings.mode} onChange={(mode) => update({ mode })} options={[['lossy', 'Lossy'], ['lossless', 'Lossless'], ['near-lossless', 'Near-lossless']]} />
                        <Select tokens={tokens} label="PRESET" value={settings.preset} disabled={!lossy} onChange={(preset) => update({ preset })} options={PRESETS} />
                        <Select
                            tokens={tokens}
                            label="METHOD"
                            value={String(settings.method)}
                            onChange={(method) => update({ method: Number(method) })}
                            options={[0, 1, 2, 3, 4, 5, 6].map((value) => [String(value), value === 4 ? '4 (default)' : value === 6 ? '6 (slowest)' : String(value)])}
                        />
                    </div>
                    <Slider
                        tokens={tokens}
                        label={lossy ? 'QUALITY' : 'EFFORT'}
                        value={settings.quality}
                        onChange={(quality) => update({ quality })}
                        hint={lossy ? 'Higher keeps more detail and costs more bytes.' : 'Higher searches longer for a smaller file; the pixels stay the same.'}
                    />
                    {settings.mode === 'near-lossless' ? (
                        <Slider tokens={tokens} label="NEAR-LOSSLESS" value={settings.near} onChange={(near) => update({ near })} hint="0 lets libwebp adjust pixel values the most before the lossless pass; 100 is plain lossless." />
                    ) : null}
                    {lossy ? (
                        <Toggle tokens={tokens} checked={settings.sharp} onChange={(sharp) => update({ sharp })}>
                            Sharp YUV: slower colour conversion, crisper colour edges
                        </Toggle>
                    ) : null}
                    <Hint tokens={tokens}>
                        {`The test card is generated in the module, so its numbers are the same in every browser. Your own image stays in this tab; one longer than ${grouped(STUDIO_MAX_SIDE)} px on a side is scaled down first. After the first run, every change encodes again.`}
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : report && originalUrl && webpUrl ? (
                    <div>
                        <Compare tokens={tokens} originalUrl={originalUrl} webpUrl={webpUrl} width={result.image.width} height={result.image.height} />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 14, margin: '16px 0 4px' }}>
                            <Stat tokens={tokens} accent value={kilobytes(report.bytes)} label={`WebP, ${report.format}`} />
                            <Stat tokens={tokens} value={times(result.image.png.size, report.bytes)} label={`smaller than this browser's PNG (${kilobytes(result.image.png.size)})`} />
                            <Stat tokens={tokens} value={report.identical ? 'identical' : `${report.psnr} dB`} label="PSNR" />
                            <Stat tokens={tokens} value={report.ssim.toFixed(4)} label="SSIM" />
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
                            <SecondaryButton tokens={tokens} onClick={() => download(result.bytes, 'image.webp', 'image/webp')}>Download the .webp</SecondaryButton>
                            <SecondaryButton
                                tokens={tokens}
                                disabled={sweep.status === 'running'}
                                onClick={() =>
                                    runSweep(async (m) => ({
                                        name: result.image.name,
                                        points: JSON.parse(await m.WebpStudio.sweep(STUDIO.source, result.image.width, result.image.height, settings.preset, settings.method, settings.sharp)),
                                    }))
                                }
                            >
                                {sweep.status === 'running' ? 'Sweeping…' : 'Sweep lossy quality 0 to 100'}
                            </SecondaryButton>
                        </div>
                        {sweep.status === 'failed' ? <Failure tokens={tokens} message={sweep.message} /> : null}
                        {sweep.status !== 'failed' && sweep.result?.name === result.image.name ? <RateCurve tokens={tokens} points={sweep.result.points} quality={settings.quality} /> : null}
                        <Meta tokens={tokens}>
                            {[
                                `${result.image.name}, ${result.image.width}×${result.image.height}${result.image.fileBytes ? ` (the file: ${kilobytes(result.image.fileBytes)})` : ''}`,
                                `encoded, decoded and measured in ${state.ms} ms`,
                                result.settings.mode !== 'lossy'
                                    ? null
                                    : result.browser === null
                                      ? 'this browser cannot encode WebP from a canvas'
                                      : `this browser's canvas.toBlob at quality ${result.settings.quality}: ${grouped(result.browser)} B`,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Encode the test card or open an image to compare it with its WebP, side by side.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/webp_studio.h', code: STUDIO_WRAPPER },
                { file: 'main.js', code: STUDIO_USAGE },
            ]}
        />
    );
}
WebpStudio.appId = 'webp-studio';

const STICKER_WRAPPER = `// src/native/sticker_maker.h (excerpt): trim, fit, then the best quality under the budget
WebPPictureCrop(&picture, box.left, box.top, box.width, box.height);   // drop empty borders
WebPPictureRescale(&picture, fitWidth, fitHeight);                     // aspect kept
// ... centre it on a transparent 512x512 canvas, draw the 8 px white outline ...
if (!attempt(100)) {
    int low = 0;
    int high = 99;
    while (low <= high) {
        const int quality = (low + high) / 2;
        if (attempt(quality)) low = quality + 1;
        else high = quality - 1;
    }
}`;

const STICKER_USAGE = `const m = await initNative();
// any size, with alpha; m.FS.writeFile appends to an existing file here, so unlink it first when you replace one
await m.FS.writeFile('/memfs/webpapps/sticker/source.rgba', rgba);

const report = JSON.parse(await m.StickerMaker.make('/memfs/webpapps/sticker/source.rgba', 600, 400,
    true, 100000, '/memfs/webpapps/sticker/sticker.webp', '/memfs/webpapps/sticker/canvas.rgba'));
// the sample: 33,610 B at quality 100; under a 12,000 B budget, 11,952 B at quality 12
const sticker = await m.getFileBytes('/memfs/webpapps/sticker/sticker.webp');`;

const BUDGETS = [['100000', '100 KB (WhatsApp)'], ['50000', '50 KB'], ['20000', '20 KB'], ['12000', '12 KB']];

function StickerTile({ tokens, url, background, label }) {
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ background, border: `1px solid ${tokens.border}`, borderRadius: 10, padding: 12, display: 'grid', placeItems: 'center' }}>
                <img src={url} alt={`The sticker ${label.toLowerCase()}`} style={{ width: '100%', maxWidth: 220, height: 'auto', display: 'block' }} />
            </div>
            <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted, marginTop: 6 }}>{label}</div>
        </div>
    );
}

export function StickerMakerApp({ tokens, index, load }) {
    const [budget, setBudget] = useState(100000);
    const [outline, setOutline] = useState(true);
    const [state, run] = useNativeTask(load);
    const source = useRef(null);

    const make = async (m, current) => {
        const image = source.current;
        const report = JSON.parse(await m.StickerMaker.make(STICKER.source, image.width, image.height, current.outline, current.budget, STICKER.webp, STICKER.canvas));
        const bytes = await m.getFileBytes(STICKER.webp);
        const png = await blobOf(canvasOf(await m.getFileBytes(STICKER.canvas), 512, 512), 'image/png');
        return { report, bytes, png: png.size, budget: current.budget, name: image.name };
    };
    const openSample = () =>
        run(async (m) => {
            await m.FS.mkdirTree(`${DIRECTORY}/sticker`);
            const [width, height] = (await m.StickerMaker.writeSample(STICKER.source)).split('x').map(Number);
            source.current = { name: 'the sample', width, height };
            return make(m, { budget, outline });
        });
    const openFile = (file) =>
        run(async (m) => {
            const image = await readImageFile(file, STICKER_MAX_SIDE);
            await m.FS.mkdirTree(`${DIRECTORY}/sticker`);
            await writeFile(m, STICKER.source, image.rgba);
            source.current = { name: file.name, width: image.width, height: image.height };
            return make(m, { budget, outline });
        });
    useEffect(() => {
        if (!source.current) return undefined;
        const timer = setTimeout(() => run((m) => make(m, { budget, outline })), 150);
        return () => clearTimeout(timer);
    }, [budget, outline]);

    const result = state.result;
    const url = useBlobUrl(result?.bytes, 'image/webp');
    const report = result?.report;
    return (
        <AppCard
            tokens={tokens}
            id="webp-sticker"
            index={index}
            status={state.status}
            title="Turn any picture into a sticker that fits the limit"
            pitch={
                <>
                    WhatsApp asks for stickers that are WebP, exactly 512 × 512 and at most 100 KB, and recommends an 8 px white outline (
                    <Link tokens={tokens} href={WHATSAPP_STICKERS}>its sticker guide</Link>
                    ). libwebp crops the empty border, fits the rest into the square, keeps the transparency exact and finds the highest quality that stays under the budget.
                </>
            }
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={openSample}>Make the sample sticker</RunButton>
                        <FileButton tokens={tokens} accept="image/*" onFile={openFile}>Use your own picture</FileButton>
                    </div>
                    <Select tokens={tokens} label="BUDGET" value={String(budget)} onChange={(value) => setBudget(Number(value))} options={BUDGETS} />
                    <Toggle tokens={tokens} checked={outline} onChange={setOutline}>White outline, 8 px</Toggle>
                    <Hint tokens={tokens}>The sample is a smiley drawn in the module on a transparent background. A PNG with transparency makes the best sticker; a photo becomes a framed square. Nothing is uploaded.</Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : report && url ? (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                            <StickerTile tokens={tokens} url={url} background="#f3f3f0" label="ON LIGHT" />
                            <StickerTile tokens={tokens} url={url} background="#17191e" label="ON DARK" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14, margin: '16px 0 4px' }}>
                            <Stat tokens={tokens} accent value={`${grouped(report.bytes)} B`} label={report.fits ? `fits ${kilobytes(result.budget)}` : `over ${kilobytes(result.budget)}, even at quality 0`} />
                            <Stat tokens={tokens} value={report.fits ? `q${report.quality}` : 'none'} label="highest quality that fits" />
                            <Stat tokens={tokens} value={kilobytes(result.png)} label="the same 512 × 512 as PNG" />
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <SecondaryButton tokens={tokens} onClick={() => download(result.bytes, 'sticker.webp', 'image/webp')}>Download sticker.webp</SecondaryButton>
                        </div>
                        <Meta tokens={tokens}>
                            {`${result.name}: art fitted to ${report.contentWidth}×${report.contentHeight} on 512×512 · tried ${report.attempts.map(([quality, bytes]) => `q${quality} ${grouped(bytes)} B`).join(', ')}`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Make the sample sticker, or bring a PNG with transparency, to see it on light and dark chats.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/sticker_maker.h', code: STICKER_WRAPPER },
                { file: 'main.js', code: STICKER_USAGE },
            ]}
        />
    );
}
StickerMakerApp.appId = 'webp-sticker';

const STREAM_WRAPPER = `// src/native/webp_stream.h (excerpt): decode whatever has arrived
std::unique_ptr<WebPIDecoder, void (*)(WebPIDecoder*)> decoder(WebPINewRGB(MODE_RGBA, nullptr, 0, 0), WebPIDelete);
const VP8StatusCode status = WebPIUpdate(decoder.get(), data.data(), available);  // SUSPENDED: wants more
int rows = 0, width = 0, height = 0, stride = 0;
const uint8_t* rgba = WebPIDecGetRGB(decoder.get(), &rows, &width, &height, &stride);
// rows 0 to rows - 1 are final: copy them into the frame, leave the rest transparent`;

const STREAM_USAGE = `const m = await initNative();
const report = JSON.parse(await m.WebpStream.decodePrefix('/memfs/webpapps/stream/card.webp', 7426,
    '/memfs/webpapps/stream/frame.rgba'));
// the test card at quality 75 is 14,852 B: half of it gives 135 of its 384 rows
const frame = await m.getFileBytes('/memfs/webpapps/stream/frame.rgba');
context.putImageData(new ImageData(new Uint8ClampedArray(frame.buffer), report.width, report.height), 0, 0);`;

export function WebpStreamApp({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [frame, setFrame] = useState(null);
    const [position, setPosition] = useState(0);
    const [scrubError, setScrubError] = useState(null);
    const [replay, setReplay] = useState(0);
    const canvas = useRef(null);
    const playback = useRef(0);
    const wanted = useRef(null);
    const drawing = useRef(false);

    const show = async (m, info, available) => {
        const report = JSON.parse(await m.WebpStream.decodePrefix(info.path, available, STREAM.frame));
        const context = canvas.current?.getContext('2d');
        if (context && report.rows > 0) {
            const pixels = await m.getFileBytes(STREAM.frame);
            context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), report.width, report.height), 0, 0);
        } else if (context) {
            context.clearRect(0, 0, info.width, info.height);
        }
        setFrame(report);
    };
    // The smallest prefix that yields a row: before it the decoder is still reading what every row depends on.
    const firstRows = async (m, path, total) => {
        let low = 1;
        let high = total;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (JSON.parse(await m.WebpStream.decodePrefix(path, middle, STREAM.frame)).rows > 0) high = middle;
            else low = middle + 1;
        }
        return low;
    };
    const inspect = async (m, path, name, total) => {
        const header = JSON.parse(await m.WebpStream.decodePrefix(path, 64, STREAM.frame));
        if (!header.width) throw new Error(`${name} does not start like a WebP file.`);
        if (header.width * header.height > STREAM_MAX_PIXELS) {
            throw new Error(`${name} is ${header.width}×${header.height}; pick one under 4 megapixels, since every step copies the whole frame.`);
        }
        return { path, name, total, width: header.width, height: header.height, firstRowsAt: await firstRows(m, path, total) };
    };
    const openSample = () =>
        run(async (m) => {
            await m.FS.mkdirTree(`${DIRECTORY}/stream`);
            await m.WebpStudio.writeTestCard(STREAM.card);
            const report = JSON.parse(await m.WebpStudio.encode(STREAM.card, 512, 384, STREAM.webp, 'lossy', 75, 100, 'default', 4, false));
            return inspect(m, STREAM.webp, 'the test card at quality 75', report.bytes);
        });
    const openFile = (file) =>
        run(async (m) => {
            // In memory, never the default: in a Worker that can be /opfs, which would keep the visitor's file across reloads.
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return inspect(m, path, file.name, file.size);
        });

    const info = state.status === 'ready' ? state.result : null;
    useEffect(() => {
        if (!info) return undefined;
        const token = (playback.current += 1);
        setScrubError(null);
        (async () => {
            const m = await load();
            for (let step = 0; step <= STREAM_STEPS && token === playback.current; step += 1) {
                const available = Math.round((info.total * step) / STREAM_STEPS);
                setPosition(available);
                await show(m, info, available);
                await pause(45);
            }
        })().catch((error) => setScrubError(error?.message ?? String(error)));
        return () => {
            playback.current += 1;
        };
    }, [info, replay]);

    // Scrubbing stops the playback and decodes only the latest position asked for.
    const scrub = async (available) => {
        playback.current += 1;
        setPosition(available);
        wanted.current = available;
        if (drawing.current || !info) return;
        drawing.current = true;
        try {
            const m = await load();
            while (wanted.current !== null) {
                const next = wanted.current;
                wanted.current = null;
                await show(m, info, next);
            }
        } catch (error) {
            setScrubError(error?.message ?? String(error));
        } finally {
            drawing.current = false;
        }
    };

    const share = frame && info ? Math.round((frame.available / info.total) * 100) : 0;
    return (
        <AppCard
            tokens={tokens}
            id="webp-stream"
            index={index}
            status={state.status}
            title="Watch a WebP arrive, row by row"
            pitch="On a slow connection an image fills in from the top. libwebp's incremental decoder does this for WebP: give it the bytes that have arrived and it returns every row it can already finish. Play the download, or drag through the file byte by byte."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={openSample}>Stream the test card</RunButton>
                        <FileButton tokens={tokens} accept=".webp,image/webp" onFile={openFile}>Stream your own .webp</FileButton>
                    </div>
                    {info ? (
                        <>
                            <Slider tokens={tokens} label="BYTES RECEIVED" min={0} max={info.total} value={position} onChange={scrub} />
                            <div>
                                <SecondaryButton tokens={tokens} onClick={() => setReplay((count) => count + 1)}>Play again</SecondaryButton>
                            </div>
                        </>
                    ) : null}
                    <Hint tokens={tokens}>The sample is the WebP Studio test card at quality 75. Your own file is mounted in memory and stays in this tab. Animated files are not decoded incrementally.</Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : info ? (
                    <div>
                        <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, overflow: 'hidden', ...checkerboard(tokens) }}>
                            <canvas ref={canvas} width={info.width} height={info.height} aria-label="The rows decoded so far" style={{ display: 'block', width: '100%', height: 'auto' }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14, margin: '16px 0 4px' }}>
                            <Stat tokens={tokens} accent value={`${frame?.rows ?? 0} of ${info.height}`} label="rows on screen" />
                            <Stat tokens={tokens} value={`${share}%`} label={`of ${grouped(info.total)} B received`} />
                            <Stat tokens={tokens} value={`${grouped(info.firstRowsAt)} B`} label="before the first row" />
                        </div>
                        {scrubError ? <Failure tokens={tokens} message={scrubError} /> : null}
                        <Meta tokens={tokens}>
                            {`${info.name}, ${info.width}×${info.height} · ${frame?.complete ? 'complete' : `${grouped(frame?.available ?? 0)} B in, waiting for more`} · the header gives the size within 30 bytes; a row appears once everything it depends on has arrived`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Stream the test card, or open a .webp of your own, to watch it decode as the bytes arrive.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/webp_stream.h', code: STREAM_WRAPPER },
                { file: 'main.js', code: STREAM_USAGE },
            ]}
        />
    );
}
WebpStreamApp.appId = 'webp-stream';

export const WEBP_APPS = [WebpStudio, StickerMakerApp, WebpStreamApp];

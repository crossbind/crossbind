import { useEffect, useRef, useState } from 'react';
import AppCard, { Failure, Label, megabytes, RunButton, useNativeTask } from './AppCard.jsx';
import { download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Select, Stat, Toggle } from './controls.jsx';

// The libjpeg-turbo apps on /ports/jpegturbo/. Each one drives landing/demos/lib-jpegturbo, whose
// index.html checks the same calls against files and numbers native libjpeg-turbo 3.2.0 (cjpeg,
// djpeg, jpegtran) produced from the same generated pixels.

const DIRECTORY = '/memfs/jpegapps';
const SAMPLE_WIDTH = 960;
const SAMPLE_HEIGHT = 640;
const LAB_MAX_SIDE = 1600;
const ZOOM = 3;
const RUNS = 3;
const JPEG_ACCEPT = 'image/jpeg,.jpg,.jpeg';

const kilobytes = (bytes) => `${grouped(Math.round(bytes / 102.4) / 10)} KB`;
const decibels = (psnr) => (psnr === null ? 'lossless' : `${psnr.toFixed(2)} dB`);

// m.FS.writeFile appends when the file already exists, so every browser encode gets a new name.
let browserFiles = 0;

const imageData = (rgba, width, height) => new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height);

// What this browser's own encoder makes of the same pixels, measured by libjpeg-turbo.
async function browserEncode(m, lab, pixels, info, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    canvas.getContext('2d').putImageData(imageData(pixels, info.width, info.height), 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality / 100));
    if (!blob) return null;
    browserFiles += 1;
    const path = `${DIRECTORY}/browser-${browserFiles}.jpg`;
    await m.FS.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    try {
        return JSON.parse(await lab.measure(path));
    } finally {
        await m.FS.unlink(path);
    }
}

// Whether this browser shows the file in an <img> and decodes it with createImageBitmap.
async function browserDisplays(bytes) {
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    try {
        const shown = await new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image.naturalWidth > 0);
            image.onerror = () => resolve(false);
            image.src = url;
        });
        const bitmap = await createImageBitmap(blob).then(
            (decoded) => {
                decoded.close();
                return true;
            },
            () => false,
        );
        return { shown, bitmap };
    } finally {
        URL.revokeObjectURL(url);
    }
}

function Rows({ tokens, rows }) {
    return (
        <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {rows.map(([name, value, highlight], position) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '7px 11px', borderTop: position ? `1px solid ${tokens.border}` : 'none', fontSize: 13 }}>
                    <span style={{ color: tokens.textMuted, whiteSpace: 'nowrap' }}>{name}</span>
                    <span style={{ fontFamily: tokens.mono, fontSize: 12.5, color: highlight ? tokens.accentText : tokens.text, textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</span>
                </div>
            ))}
        </div>
    );
}

function Figure({ tokens, caption, children }) {
    return (
        <figure style={{ margin: 0, minWidth: 0 }}>
            {children}
            <figcaption style={{ fontSize: 12, color: tokens.textMuted, marginTop: 6, lineHeight: 1.5 }}>{caption}</figcaption>
        </figure>
    );
}

const pictureStyle = (tokens) => ({ display: 'block', width: '100%', height: 'auto', border: `1px solid ${tokens.border}`, borderRadius: 8, background: tokens.codeBg });

function JpegPicture({ tokens, bytes, alt }) {
    const [url, setUrl] = useState(null);
    useEffect(() => {
        const next = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [bytes]);
    return url ? <img src={url} alt={alt} style={pictureStyle(tokens)} /> : null;
}

function RgbaPicture({ tokens, rgba, width, height, label }) {
    const canvas = useRef(null);
    useEffect(() => {
        canvas.current.width = width;
        canvas.current.height = height;
        canvas.current.getContext('2d').putImageData(imageData(rgba, width, height), 0, 0);
    }, [rgba, width, height]);
    return <canvas ref={canvas} role="img" aria-label={label} style={pictureStyle(tokens)} />;
}

// A region of an RGBA picture, enlarged with every pixel kept square so artefacts stay visible.
function Zoomed({ tokens, rgba, width, focus, label }) {
    const canvas = useRef(null);
    useEffect(() => {
        const out = new Uint8ClampedArray(focus.w * ZOOM * focus.h * ZOOM * 4);
        for (let y = 0; y < focus.h * ZOOM; y += 1) {
            for (let x = 0; x < focus.w * ZOOM; x += 1) {
                const from = ((focus.y + Math.floor(y / ZOOM)) * width + focus.x + Math.floor(x / ZOOM)) * 4;
                out.set(rgba.subarray(from, from + 4), (y * focus.w * ZOOM + x) * 4);
            }
        }
        canvas.current.width = focus.w * ZOOM;
        canvas.current.height = focus.h * ZOOM;
        canvas.current.getContext('2d').putImageData(new ImageData(out, focus.w * ZOOM, focus.h * ZOOM), 0, 0);
    }, [rgba, width, focus]);
    return <canvas ref={canvas} role="img" aria-label={label} style={{ ...pictureStyle(tokens), imageRendering: 'pixelated' }} />;
}

const PRIVACY_WRAPPER = `// src/native/jpeg_scrub.h (excerpt): the image is copied, never re-encoded
jvirt_barray_ptr* coefficients = jpeg_read_coefficients(&source.cinfo);
jpeg_copy_critical_parameters(&source.cinfo, &target.cinfo);
target.cinfo.optimize_coding = optimize ? TRUE : FALSE;
if (progressive) jpeg_simple_progression(&target.cinfo);
jpeg_write_coefficients(&target.cinfo, coefficients);
if (keepOrientation && orientation > 1) {
    const std::string block = exif::orientationOnly(orientation);
    jpeg_write_marker(&target.cinfo, JPEG_APP0 + 1,
                      reinterpret_cast<const JOCTET*>(block.data()), block.size());
}
// the ICC profile's APP2 segments follow when keepProfile; every
// other APPn and COM segment of the original stays behind
jpeg_finish_compress(&target.cinfo);`;

const PRIVACY_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));   // the dropped photo
const report = JSON.parse(await m.JpegScrub.inspect(path));
// report.exif.gps: { lat, lon, alt }; report.segments: [{ marker, label, bytes }]

await m.FS.mkdirTree('/memfs/out');
const done = JSON.parse(await m.JpegScrub.clean(path, '/memfs/out/clean.jpg', true, true, true, false));
const proof = JSON.parse(await m.JpegScrub.compare(path, '/memfs/out/clean.jpg'));
// the sample: 123,613 B before, 106,361 B after, proof.differing 0`;

function revealed(exif, preview) {
    if (!exif?.valid) return [];
    const rows = [];
    if (exif.gps) rows.push(['Location', `${Math.abs(exif.gps.lat).toFixed(5)}° ${exif.gps.lat < 0 ? 'S' : 'N'}, ${Math.abs(exif.gps.lon).toFixed(5)}° ${exif.gps.lon < 0 ? 'W' : 'E'}${exif.gps.alt === null ? '' : `, ${exif.gps.alt} m`}`, true]);
    if (exif.taken || exif.dateTime) rows.push(['Taken', exif.taken ?? exif.dateTime]);
    if (exif.make || exif.model) rows.push(['Camera', [exif.make, exif.model].filter(Boolean).join(' ')]);
    if (exif.lens) rows.push(['Lens', exif.lens]);
    if (exif.serial) rows.push(['Serial number', exif.serial, true]);
    if (exif.owner) rows.push(['Owner', exif.owner, true]);
    if (exif.software) rows.push(['Software', exif.software]);
    if (preview) rows.push(['Preview image', `${preview.width}×${preview.height}`, true]);
    if (exif.orientation > 1) rows.push(['Orientation', `${exif.orientation} (stored rotated)`]);
    return rows;
}

export function JpegPrivacy({ tokens, index, load }) {
    const [keepProfile, setKeepProfile] = useState(true);
    const [keepOrientation, setKeepOrientation] = useState(true);
    const [optimize, setOptimize] = useState(true);
    const [progressive, setProgressive] = useState(false);
    const [opened, open] = useNativeTask(load);
    const [cleaned, clean] = useNativeTask(load);
    const inspect = async (m, path, name, original, sample) => {
        const report = JSON.parse(await m.JpegScrub.inspect(path));
        const previewBytes = await m.JpegScrub.extractPreview(path, `${DIRECTORY}/preview.jpg`);
        return { path, name, original, sample, report, preview: previewBytes ? await m.getFileBytes(`${DIRECTORY}/preview.jpg`) : null };
    };
    const openSample = async (m) => {
        await m.FS.mkdirTree(DIRECTORY);
        const path = `${DIRECTORY}/sample.jpg`;
        await m.JpegScrub.writeSample(path);
        return inspect(m, path, 'sample.jpg', await m.getFileBytes(path), true);
    };
    const openFile = (file) =>
        open(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return inspect(m, path, file.name, file, false);
        });
    const photo = (opened.status !== 'failed' ? opened.result : null) ?? (cleaned.status !== 'failed' ? cleaned.result?.source : null) ?? null;
    const writeClean = () =>
        clean(async (m) => {
            const source = photo ?? (await openSample(m));
            const output = `${DIRECTORY}/clean.jpg`;
            const result = JSON.parse(await m.JpegScrub.clean(source.path, output, keepProfile, keepOrientation, optimize, progressive));
            const proof = JSON.parse(await m.JpegScrub.compare(source.path, output));
            return { source, result, proof, bytes: await m.getFileBytes(output) };
        });
    const done = cleaned.status !== 'failed' && cleaned.result && photo && cleaned.result.source.path === photo.path ? cleaned.result : null;
    const report = photo?.report;
    const rows = report ? revealed(report.exif, report.preview) : [];
    const removedBytes = done ? done.result.removed.reduce((total, segment) => total + segment.bytes + 4, 0) + done.result.trailing : 0;
    return (
        <AppCard
            tokens={tokens}
            id="jpegturbo-privacy"
            index={index}
            status={cleaned.status === 'idle' ? opened.status : cleaned.status}
            title="See what a photo gives away, then remove it without re-encoding"
            pitch="A phone photo can carry where it was taken, the camera's serial number and a preview image of its own. This reads every segment and shows what they reveal, then writes a copy without them. The image data is copied coefficient by coefficient, not re-encoded, so every pixel of the copy is the same, and the page proves it by decoding both."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={opened.status === 'running'} onClick={() => open(openSample)}>Open the sample</RunButton>
                        <FileButton tokens={tokens} accept={JPEG_ACCEPT} onFile={openFile}>Open your photo</FileButton>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                        <Toggle tokens={tokens} checked={keepProfile} onChange={setKeepProfile}>Keep the colour profile (ICC)</Toggle>
                        <Toggle tokens={tokens} checked={keepOrientation} onChange={setKeepOrientation}>Keep the orientation, so the photo stays upright</Toggle>
                        <Toggle tokens={tokens} checked={optimize} onChange={setOptimize}>Optimise the Huffman tables</Toggle>
                        <Toggle tokens={tokens} checked={progressive} onChange={setProgressive}>Progressive</Toggle>
                    </div>
                    <div>
                        <RunButton tokens={tokens} busy={cleaned.status === 'running'} onClick={writeClean}>Write the clean copy</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        The sample is generated in the module with a made-up camera and the coordinates of a public landmark. Your own photo stays in this tab: it is mounted into the module's in-memory filesystem, never uploaded.
                    </Hint>
                </div>
            }
            output={
                opened.status === 'failed' || cleaned.status === 'failed' ? (
                    <Failure tokens={tokens} message={opened.status === 'failed' ? opened.message : cleaned.message} />
                ) : report ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, overflowWrap: 'anywhere' }}>
                            {`${photo.name} · ${grouped(report.bytes)} B · ${report.width}×${report.height} · ${report.subsampling} · ${report.progressive ? 'progressive' : 'baseline'}${report.quality ? ` · quality ${report.quality.exact ? '' : '≈'}${report.quality.quality}` : ''}`}
                        </div>
                        <div>
                            <Label tokens={tokens}>WHAT THE FILE SAYS</Label>
                            {rows.length ? <Rows tokens={tokens} rows={rows} /> : <div style={{ fontSize: 13.5, color: tokens.textDim }}>No EXIF block: nothing about place, time or camera.</div>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: photo.preview ? 'minmax(0, 3fr) minmax(0, 2fr)' : '1fr', gap: 12, alignItems: 'start' }}>
                            <Figure tokens={tokens} caption="The photo">
                                <JpegPicture tokens={tokens} bytes={photo.original} alt="The photo" />
                            </Figure>
                            {photo.preview ? (
                                <Figure tokens={tokens} caption={photo.sample ? 'The preview inside its EXIF: made before the photo was cropped, it still shows the banner.' : 'The preview inside its EXIF, written by the camera or the last editor.'}>
                                    <JpegPicture tokens={tokens} bytes={photo.preview} alt="The preview stored in the EXIF block" />
                                </Figure>
                            ) : null}
                        </div>
                        <Meta tokens={tokens}>
                            {`segments: ${report.segments.map((segment) => `${segment.marker} ${segment.label} ${grouped(segment.bytes)} B`).join(' · ') || 'none'}${report.trailing ? ` · ${grouped(report.trailing)} B after the end of the image` : ''}${report.warnings ? ` · libjpeg-turbo: ${report.warning}` : ''}`}
                        </Meta>
                        {done ? (
                            <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 16 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 14 }}>
                                    <Stat tokens={tokens} accent value={`${grouped(done.result.before - done.result.after)} B`} label={`smaller: ${grouped(done.result.before)} B to ${grouped(done.result.after)} B`} />
                                    <Stat tokens={tokens} value={`${grouped(done.proof.differing)} of ${grouped(done.proof.samples)}`} label="decoded samples that differ" />
                                </div>
                                <Rows
                                    tokens={tokens}
                                    rows={[
                                        ['Removed', done.result.removed.map((segment) => segment.label).join(', ') + (done.result.trailing ? `${done.result.removed.length ? ', ' : ''}data after the image` : '') || 'nothing', true],
                                        ['Kept', done.result.kept.map((segment) => segment.label).join(', ') || 'nothing'],
                                        ['Metadata removed', `${grouped(removedBytes)} B`],
                                    ]}
                                />
                                {done.proof.differing && report.warnings ? (
                                    <Meta tokens={tokens}>{`The original is damaged (${report.warning}); the copy keeps what libjpeg-turbo could read, so the two decode differently.`}</Meta>
                                ) : null}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                                    <SecondaryButton tokens={tokens} onClick={() => download(done.bytes, `${photo.name.replace(/\.jpe?g$/i, '')}-clean.jpg`, 'image/jpeg')}>Download the clean copy</SecondaryButton>
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open the sample, or a JPEG from your phone, to see what its metadata says.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/jpeg_scrub.h', code: PRIVACY_WRAPPER },
                { file: 'main.js', code: PRIVACY_USAGE },
            ]}
        />
    );
}
JpegPrivacy.appId = 'jpegturbo-privacy';

const LAB_WRAPPER = `// src/native/jpeg_lab.h (excerpt): every setting is a field on the compressor
jpeg_set_defaults(&encoder.cinfo);
jpeg_set_quality(&encoder.cinfo, quality, TRUE);
encoder.cinfo.comp_info[0].h_samp_factor = subsampling == 444 ? 1 : 2;
encoder.cinfo.comp_info[0].v_samp_factor = subsampling == 420 ? 2 : 1;
encoder.cinfo.optimize_coding = optimize ? TRUE : FALSE;
encoder.cinfo.arith_code = arithmetic ? TRUE : FALSE;
if (progressive) jpeg_simple_progression(&encoder.cinfo);
jpeg_start_compress(&encoder.cinfo, TRUE);`;

const LAB_USAGE = `const m = await initNative();
const lab = await new m.JpegLab();
await lab.useSample(960, 640);   // or lab.load(path, 1600) for a dropped photo
await m.FS.mkdirTree('/memfs/out');

const q75 = JSON.parse(await lab.encode(75, 420, false, false, false, '/memfs/out/a.jpg', ''));
const full = JSON.parse(await lab.encode(75, 444, false, false, false, '/memfs/out/b.jpg', ''));
// q75: 59,481 B at 31.40 dB; full colour detail: 74,930 B at 36.06 dB`;

export function JpegEncoderLab({ tokens, index, load }) {
    const [quality, setQuality] = useState(75);
    const [subsampling, setSubsampling] = useState(420);
    const [progressive, setProgressive] = useState(false);
    const [optimize, setOptimize] = useState(true);
    const [arithmetic, setArithmetic] = useState(false);
    const [source, setSource] = useState({ file: null, version: 0 });
    const lab = useRef(null);
    const [state, run] = useNativeTask(load);
    const key = JSON.stringify([quality, subsampling, progressive, optimize, arithmetic, source.version]);
    const encode = (wanted = source) =>
        run(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const held = lab.current ?? { instance: await new m.JpegLab(), version: -1 };
            let current = held;
            if (held.version !== wanted.version) {
                const info = JSON.parse(wanted.file ? await held.instance.load((await m.autoMountFiles([wanted.file], await m.getRandomPath('/memfs')))[0], LAB_MAX_SIDE) : await held.instance.useSample(SAMPLE_WIDTH, SAMPLE_HEIGHT));
                await held.instance.writeSource(`${DIRECTORY}/lab-source.rgba`);
                current = { instance: held.instance, version: wanted.version, info, name: wanted.file ? wanted.file.name : 'The sample', pixels: await m.getFileBytes(`${DIRECTORY}/lab-source.rgba`) };
            }
            lab.current = current;
            const result = JSON.parse(await current.instance.encode(quality, subsampling, progressive, optimize, arithmetic, `${DIRECTORY}/lab.jpg`, `${DIRECTORY}/lab-view.rgba`));
            const jpeg = await m.getFileBytes(`${DIRECTORY}/lab.jpg`);
            return {
                key: JSON.stringify([quality, subsampling, progressive, optimize, arithmetic, wanted.version]),
                quality,
                subsampling,
                result,
                jpeg,
                view: await m.getFileBytes(`${DIRECTORY}/lab-view.rgba`),
                info: current.info,
                name: current.name,
                pixels: current.pixels,
                browser: await browserEncode(m, current.instance, current.pixels, current.info, quality),
                display: arithmetic ? await browserDisplays(jpeg) : null,
            };
        });
    // After the first run every change re-encodes; a change made during a run is picked up when it ends.
    useEffect(() => {
        if (state.status !== 'ready' || state.result.key === key) return undefined;
        const timer = setTimeout(() => encode(), 150);
        return () => clearTimeout(timer);
    }, [key, state.status]);
    const choose = (file) => {
        const next = { file, version: source.version + 1 };
        setSource(next);
        encode(next);
    };
    const shown = state.status === 'failed' ? null : state.result;
    const info = shown?.info;
    const bitsPerPixel = shown ? (shown.result.bytes * 8) / (info.width * info.height) : 0;
    return (
        <AppCard
            tokens={tokens}
            id="jpegturbo-lab"
            index={index}
            status={state.status}
            title="The JPEG settings canvas.toBlob does not give you"
            pitch="canvas.toBlob('image/jpeg', quality) takes one number, and each browser maps it to its own encoder. Here the same pixels go through libjpeg-turbo with every setting yours: quality, chroma subsampling, progressive scans, optimised Huffman tables and arithmetic coding. Each result is measured in bytes and PSNR, next to what this browser's toBlob makes at the same quality."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <label style={{ display: 'block' }}>
                        <Label tokens={tokens}>{`QUALITY ${quality}`}</Label>
                        <input type="range" min="1" max="100" value={quality} onInput={(event) => setQuality(Number(event.target.value))} onChange={(event) => setQuality(Number(event.target.value))} style={{ width: '100%', accentColor: tokens.accent }} />
                    </label>
                    <Select tokens={tokens} label="CHROMA SUBSAMPLING" value={subsampling} onChange={setSubsampling} options={[[444, '4:4:4, full colour detail'], [422, '4:2:2, half horizontally'], [420, '4:2:0, a quarter (the default)']]} />
                    <div style={{ display: 'grid', gap: 8 }}>
                        <Toggle tokens={tokens} checked={optimize} onChange={setOptimize}>Optimised Huffman tables</Toggle>
                        <Toggle tokens={tokens} checked={progressive} onChange={setProgressive}>Progressive</Toggle>
                        <Toggle tokens={tokens} checked={arithmetic} onChange={setArithmetic}>Arithmetic coding (not every viewer opens it)</Toggle>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={() => encode()}>Encode</RunButton>
                        <SecondaryButton tokens={tokens} onClick={() => choose(null)}>Use the sample</SecondaryButton>
                        <FileButton tokens={tokens} accept={JPEG_ACCEPT} onFile={choose}>Use your photo</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        {`The sample is a ${SAMPLE_WIDTH}×${SAMPLE_HEIGHT} scene drawn in the module. A photo of yours is decoded straight to at most ${LAB_MAX_SIDE} pixels a side and stays in this tab. After the first run, every change re-encodes.`}
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : shown ? (
                    <div style={{ display: 'grid', gap: 16, opacity: state.status === 'running' ? 0.7 : 1 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14 }}>
                            <Stat tokens={tokens} accent value={kilobytes(shown.result.bytes)} label={`${grouped(shown.result.bytes)} B, ${bitsPerPixel.toFixed(2)} bits a pixel`} />
                            <Stat tokens={tokens} value={decibels(shown.result.psnr)} label="PSNR against the original" />
                        </div>
                        <RgbaPicture tokens={tokens} rgba={shown.view} width={info.width} height={info.height} label="The encoded picture, decoded by libjpeg-turbo" />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                            <Figure tokens={tokens} caption={`Original, ${ZOOM}× zoom`}>
                                <Zoomed tokens={tokens} rgba={shown.pixels} width={info.width} focus={info.focus} label="Original, enlarged" />
                            </Figure>
                            <Figure tokens={tokens} caption={`libjpeg-turbo, ${ZOOM}× zoom`}>
                                <Zoomed tokens={tokens} rgba={shown.view} width={info.width} focus={info.focus} label="Encoded, enlarged" />
                            </Figure>
                        </div>
                        {shown.browser ? (
                            <div>
                                <Label tokens={tokens}>{`THIS BROWSER'S canvas.toBlob AT ${(shown.quality / 100).toFixed(2)}`}</Label>
                                <Rows
                                    tokens={tokens}
                                    rows={[
                                        ['Size', `${grouped(shown.browser.bytes)} B`],
                                        ['PSNR', decibels(shown.browser.psnr)],
                                        ['Chosen for you', `${shown.browser.subsampling}, ${shown.browser.progressive ? 'progressive' : 'baseline'}, quality ${shown.browser.quality.exact ? '' : '≈'}${shown.browser.quality.quality}`],
                                    ]}
                                />
                            </div>
                        ) : null}
                        {shown.display ? (
                            <Meta tokens={tokens}>{`This browser with the arithmetic-coded file: <img> ${shown.display.shown ? 'shows it' : 'cannot show it'}, createImageBitmap ${shown.display.bitmap ? 'decodes it' : 'rejects it'}. libjpeg-turbo decoded the picture above.`}</Meta>
                        ) : null}
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                            <SecondaryButton tokens={tokens} onClick={() => download(shown.jpeg, `lab-q${shown.quality}-${shown.subsampling}.jpg`, 'image/jpeg')}>Download this JPEG</SecondaryButton>
                        </div>
                        <Meta tokens={tokens}>
                            {`${shown.name}, ${info.width}×${info.height}${info.scale ? `, decoded at ${info.scale} of ${info.originalWidth}×${info.originalHeight}` : ''} · encoded in ${shown.result.encodeMs} ms${info.warnings ? ` · libjpeg-turbo: ${info.warning}` : ''}`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Encode the sample, or a photo of yours, to see bytes, PSNR and a zoomed crop for every setting.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/jpeg_lab.h', code: LAB_WRAPPER },
                { file: 'main.js', code: LAB_USAGE },
            ]}
        />
    );
}
JpegEncoderLab.appId = 'jpegturbo-lab';

const THUMBNAIL_WRAPPER = `// src/native/jpeg_thumbs.h (excerpt): scale before decoding, not after
jpeg_read_header(&decoder.cinfo, TRUE);
decoder.cinfo.scale_num = 1;
decoder.cinfo.scale_denom = denominator;   // 1, 2, 4 or 8
decoder.cinfo.out_color_space = JCS_EXT_RGBA;
jpeg_start_decompress(&decoder.cinfo);    // output_width: image_width / denominator, rounded up
while (decoder.cinfo.output_scanline < decoder.cinfo.output_height) {
    JSAMPROW row = reinterpret_cast<JSAMPROW>(&rgba[decoder.cinfo.output_scanline * stride]);
    jpeg_read_scanlines(&decoder.cinfo, &row, 1);
}`;

const THUMBNAIL_USAGE = `const m = await initNative();
await m.FS.mkdirTree('/memfs/out');
await m.ThumbnailBench.writeSample('/memfs/out/photo.jpg');   // 4032x3024, 1,289,719 B

const thumb = JSON.parse(await m.ThumbnailBench.decode('/memfs/out/photo.jpg', 8, 3, '/memfs/out/thumb.rgba'));
// thumb.width 504, thumb.height 378: 762,048 B of RGBA instead of 48,771,072 B
const rgba = await m.getFileBytes('/memfs/out/thumb.rgba');`;

export function JpegThumbnails({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const measure = async (m, path, name, bytes) => {
        const rows = [];
        for (const denominator of [1, 2, 4, 8]) {
            rows.push({ denominator, ...JSON.parse(await m.ThumbnailBench.decode(path, denominator, RUNS, denominator === 8 ? `${DIRECTORY}/thumb.rgba` : '')) });
        }
        return { name, bytes, rows, thumbnail: await m.getFileBytes(`${DIRECTORY}/thumb.rgba`) };
    };
    const decodeSample = () =>
        run(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const path = `${DIRECTORY}/twelve.jpg`;
            return measure(m, path, 'the 12 MP sample', await m.ThumbnailBench.writeSample(path));
        });
    const decodeFile = (file) =>
        run(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return measure(m, path, file.name, file.size);
        });
    const result = state.status === 'failed' ? null : state.result;
    const [full, , , eighth] = result ? result.rows : [];
    const slowest = result ? Math.max(...result.rows.map((row) => row.ms)) : 1;
    return (
        <AppCard
            tokens={tokens}
            id="jpegturbo-thumbnails"
            index={index}
            status={state.status}
            title="Decode a 12 MP photo straight to a thumbnail"
            pitch="Set scale_denom before decoding and libjpeg-turbo runs a smaller inverse DCT on every 8×8 block, so a 1/8 thumbnail is decoded at its own size instead of shrunk from a full decode. Every number here is measured in this tab: the same file at 1/1, 1/2, 1/4 and 1/8. Entropy decoding costs the same at every scale, so how much a thumbnail saves depends on the file."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={decodeSample}>Decode the 12 MP sample</RunButton>
                        <FileButton tokens={tokens} accept={JPEG_ACCEPT} onFile={decodeFile}>Decode your photo</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        The sample is a 4032×3024 scene, the size a 12 MP phone camera writes, encoded in the module at quality 85. Each scale is decoded three times and the fastest run counts.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div style={{ display: 'grid', gap: 16, opacity: state.status === 'running' ? 0.7 : 1 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
                            <Stat tokens={tokens} accent value={`${(full.ms / eighth.ms).toFixed(1)}×`} label={`faster at 1/8: ${eighth.ms} ms instead of ${full.ms} ms`} />
                            <Stat tokens={tokens} value={`${Math.round(full.pixelBytes / eighth.pixelBytes)}×`} label={`less pixel memory: ${megabytes(eighth.pixelBytes)} instead of ${megabytes(full.pixelBytes)}`} />
                        </div>
                        <div style={{ display: 'grid', gap: 10 }}>
                            {result.rows.map((row) => (
                                <div key={row.denominator}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: tokens.textDim, marginBottom: 5 }}>
                                        <span>{`1/${row.denominator} · ${row.width}×${row.height}`}</span>
                                        <span style={{ fontFamily: tokens.mono, color: row.denominator === 8 ? tokens.accentText : tokens.textDim, whiteSpace: 'nowrap' }}>{`${row.ms} ms · ${megabytes(row.pixelBytes)}`}</span>
                                    </div>
                                    <div style={{ height: 10, borderRadius: 5, background: tokens.pillBg, border: `1px solid ${tokens.border}`, overflow: 'hidden' }}>
                                        <div style={{ width: `${Math.max(0.5, (row.ms / slowest) * 100)}%`, height: '100%', background: row.denominator === 8 ? tokens.accent : tokens.textMuted }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Figure tokens={tokens} caption={`The 1/8 decode of ${result.name}: ${eighth.width}×${eighth.height}.`}>
                            <RgbaPicture tokens={tokens} rgba={result.thumbnail} width={eighth.width} height={eighth.height} label="The thumbnail decoded at 1/8" />
                        </Figure>
                        <Meta tokens={tokens}>
                            {`${grouped(result.bytes)} B file · libjpeg-turbo's own buffers: ${kilobytes(full.workBytes)} at 1/1, ${kilobytes(eighth.workBytes)} at 1/8${full.progressive ? ' · progressive: every coefficient stays in memory at any scale' : ''}${full.warnings ? ` · libjpeg-turbo: ${full.warning}` : ''}`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Decode the sample, or a photo of yours, to time each scale.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/jpeg_thumbs.h', code: THUMBNAIL_WRAPPER },
                { file: 'main.js', code: THUMBNAIL_USAGE },
            ]}
        />
    );
}
JpegThumbnails.appId = 'jpegturbo-thumbnails';

export const JPEGTURBO_APPS = [JpegPrivacy, JpegEncoderLab, JpegThumbnails];

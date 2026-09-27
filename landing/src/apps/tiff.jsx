import { useEffect, useRef, useState } from 'react';
import AppCard, { Failure, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { Bars, download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Select, Stat, Toggle } from './controls.jsx';

// The tiff apps on /ports/tiff/. Each one drives landing/demos/lib-tiff, whose index.html checks the
// same calls against numbers verified outside the port, on the same generated files: libtiff 4.7.1
// built natively, tifffile with imagecodecs, Pillow and numpy.

const DIRECTORY = '/memfs/tiffapps';
const MDN_IMAGE_TYPES = 'https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types';
const THUMBNAILS = 24;
const VIEW_SIDE = 1400;
const SCAN_SIDE = 2480; // an A4 page at 300 dpi

const size = (bytes) => {
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
    if (bytes >= 1e5) return `${grouped(Math.round(bytes / 1000))} KB`;
    if (bytes >= 1e4) return `${(bytes / 1000).toFixed(1)} KB`;
    return `${grouped(bytes)} B`;
};
const times = (numerator, denominator) => `${(numerator / denominator).toFixed(1)}×`;
const failed = (error) => (error?.message ?? String(error)).replace(/^std::[\w:]+: /, '');
// Native exceptions arrive as "std::runtime_error: <what>"; the card shows only the what.
const plainly = (work) => async (m) => {
    try {
        return await work(m);
    } catch (error) {
        throw new Error(failed(error));
    }
};

// The module draws a page into an RGBA file; it is read back and removed, so repeated views do not
// fill the in-memory filesystem.
let renders = 0;
async function renderPage(m, path, page, maxSide, stretch) {
    renders += 1;
    const target = `${DIRECTORY}/render-${renders}.rgba`;
    const shown = JSON.parse(await m.TiffViewer.render(path, page, maxSide, stretch, target));
    const rgba = await m.getFileBytes(target);
    await m.FS.unlink(target);
    return { ...shown, rgba };
}

// The canvas transform that shows rows stored with TIFF Orientation `orientation` upright.
function orientationTransform(orientation, width, height) {
    switch (orientation) {
        case 2: return [-1, 0, 0, 1, width, 0];
        case 3: return [-1, 0, 0, -1, width, height];
        case 4: return [1, 0, 0, -1, 0, height];
        case 5: return [0, 1, 1, 0, 0, 0];
        case 6: return [0, 1, -1, 0, height, 0];
        case 7: return [0, -1, -1, 0, height, width];
        case 8: return [0, -1, 1, 0, 0, width];
        default: return [1, 0, 0, 1, 0, 0];
    }
}

function paint(canvas, view) {
    const { rgba, width, height, orientation } = view;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
    const turned = orientation >= 5 && orientation <= 8;
    canvas.width = turned ? height : width;
    canvas.height = turned ? width : height;
    const context = canvas.getContext('2d');
    context.setTransform(...orientationTransform(orientation, width, height));
    context.drawImage(source, 0, 0);
}

function Picture({ tokens, view, label, canvasRef, style }) {
    const own = useRef(null);
    const canvas = canvasRef ?? own;
    useEffect(() => {
        if (canvas.current && view) paint(canvas.current, view);
    }, [view, canvas]);
    return (
        <canvas
            ref={canvas}
            role="img"
            aria-label={label}
            style={{ display: 'block', maxWidth: '100%', height: 'auto', border: `1px solid ${tokens.border}`, borderRadius: 8, background: tokens.codeBg, ...style }}
        />
    );
}

function Chip({ tokens, children }) {
    return (
        <span style={{ fontFamily: tokens.mono, fontSize: 11.5, color: tokens.textDim, border: `1px solid ${tokens.border}`, background: tokens.pillBg, borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap' }}>
            {children}
        </span>
    );
}

function pageChips(page) {
    const samples = page.samplesPerPixel > 1 ? `${page.samplesPerPixel} × ${page.bitsPerSample}-bit` : `${page.bitsPerSample}-bit`;
    return [
        `${page.width} × ${page.height}`,
        `${samples} ${page.sampleFormat}`,
        page.photometric,
        page.predictor > 1 ? `${page.compression}, predictor ${page.predictor}` : page.compression,
        page.tiled ? `${page.tileWidth} × ${page.tileHeight} tiles` : `${grouped(page.rowsPerStrip)}-row strips`,
        ...(page.xResolution && page.resolutionUnit !== 'none' ? [`${Math.round(page.xResolution)} ${page.resolutionUnit === 'cm' ? 'px/cm' : 'dpi'}`] : []),
        ...(page.nodata ? [`no-data ${page.nodata}`] : []),
        ...(page.codecInBuild ? [] : ['codec not in this build']),
    ];
}

const VIEWER_WRAPPER = `// src/native/tiff_viewer.h (excerpt): any page to RGBA, a band of rows at a time
TIFFRGBAImage image;
if (!TIFFRGBAImageBegin(&image, tif, 0, reason)) throw std::runtime_error(reason);
image.req_orientation = image.orientation;  // rows as stored; the page applies Orientation
for (uint32_t top = 0; top < layout.height; top += band) {
    const uint32_t rows = std::min(band, layout.height - top);
    image.row_offset = static_cast<int>(top);
    image.col_offset = 0;
    if (!TIFFRGBAImageGet(&image, raster.data(), layout.width, rows)) { /* throw libtiff's error */ }
    // each row is averaged into the smaller output as it arrives
}
TIFFRGBAImageEnd(&image);`;

const VIEWER_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
const { pages } = JSON.parse(await m.TiffViewer.pages(path));

await m.FS.mkdirTree('/memfs/viewer');
const view = JSON.parse(await m.TiffViewer.render(path, 0, 1400, true, '/memfs/viewer/page.rgba'));
const rgba = await m.getFileBytes('/memfs/viewer/page.rgba');
const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
canvas.getContext('2d').putImageData(new ImageData(pixels, view.width, view.height), 0, 0);`;

export function TiffViewerApp({ tokens, index, load }) {
    const [opened, open] = useNativeTask(load);
    const [view, draw] = useNativeTask(load);
    const [selected, setSelected] = useState(0);
    const [stretch, setStretch] = useState(true);
    const canvas = useRef(null);
    const file = opened.status === 'ready' ? opened.result : null;

    const inspect = async (m, path, name, bytes) => {
        const listing = JSON.parse(await m.TiffViewer.pages(path));
        const thumbnails = [];
        for (const page of listing.pages.slice(0, THUMBNAILS)) {
            try {
                thumbnails.push(await renderPage(m, path, page.index, 160, true));
            } catch (error) {
                thumbnails.push({ error: failed(error) });
            }
        }
        return { path, name, bytes, ...listing, thumbnails };
    };
    const show = (target, page, stretched) => {
        setSelected(page);
        setStretch(stretched);
        draw(plainly(async (m) => ({ path: target.path, page, ...(await renderPage(m, target.path, page, VIEW_SIDE, stretched)), tags: await m.TiffViewer.tags(target.path, page) })));
    };
    useEffect(() => {
        if (file) show(file, 0, true);
    }, [file]);

    const openSample = () =>
        open(plainly(async (m) => {
            await m.FS.mkdirTree(DIRECTORY);
            const path = `${DIRECTORY}/sample.tif`;
            return inspect(m, path, 'sample.tif', await m.TiffViewer.writeSample(path));
        }));
    const openFile = ([chosen]) =>
        open(plainly(async (m) => {
            // /memfs keeps the file in this tab's memory; the default mount point may persist it.
            const [path] = await m.autoMountFiles([chosen], await m.getRandomPath('/memfs'));
            return inspect(m, path, chosen.name, chosen.size);
        }));
    const shown = view.status === 'ready' && file && view.result.path === file.path ? view.result : null;
    const page = file?.pages[selected];
    const savePng = () => canvas.current?.toBlob((blob) => blob && download(blob, `${file.name.replace(/\.tiff?$/i, '')}-page-${selected + 1}.png`), 'image/png');

    return (
        <AppCard
            tokens={tokens}
            id="tiff-viewer"
            index={index}
            status={opened.status}
            title="Open any TIFF, in any browser"
            pitch={
                <>
                    Scans, faxes, 16-bit microscope images, float elevation models and camera TIFFs, every page with its tags. MDN lists Safari as the only browser that shows TIFF images by itself (
                    <a href={MDN_IMAGE_TYPES} style={{ color: tokens.accentText }}>image file type guide</a>
                    ); here libtiff decodes the file in the page, and greyscale data too deep for a screen is stretched to its own range.
                </>
            }
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={opened.status === 'running'} onClick={openSample}>Open the sample</RunButton>
                        <FileButton tokens={tokens} accept=".tif,.tiff,image/tiff" busy={opened.status === 'running'} onFiles={openFile}>Open your own TIFF</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        The sample is a four-page TIFF the module writes itself: a CCITT Group 4 letter, a JPEG photo, 12-bit cells in 16-bit ZSTD tiles and a float elevation model with no-data. Your own file stays in this tab: it is mounted into the module's in-memory filesystem, never uploaded.
                    </Hint>
                    {file ? (
                        <div>
                            <Label tokens={tokens}>{`${file.pages.length} ${file.pages.length === 1 ? 'PAGE' : 'PAGES'}${file.pages.length > THUMBNAILS ? `, FIRST ${THUMBNAILS} SHOWN` : ''}`}</Label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 10 }}>
                                {file.thumbnails.map((thumbnail, at) => (
                                    <button
                                        key={at}
                                        type="button"
                                        onClick={() => show(file, at, true)}
                                        aria-pressed={at === selected}
                                        style={{ padding: 4, borderRadius: 10, border: `1px solid ${at === selected ? tokens.accent : tokens.border}`, background: 'none', cursor: 'pointer', minWidth: 0 }}
                                    >
                                        {thumbnail.error ? (
                                            <div style={{ fontSize: 11, color: tokens.warn, padding: 6, textAlign: 'left' }}>{`Page ${at + 1} cannot be drawn`}</div>
                                        ) : (
                                            <Picture tokens={tokens} view={thumbnail} label={`Page ${at + 1}`} style={{ margin: '0 auto', maxHeight: 110 }} />
                                        )}
                                        <div style={{ fontFamily: tokens.mono, fontSize: 10.5, color: tokens.textMuted, marginTop: 4 }}>{at + 1}</div>
                                    </button>
                                ))}
                            </div>
                            {file.pages.length > THUMBNAILS ? (
                                <div style={{ marginTop: 12 }}>
                                    <Select tokens={tokens} label="PAGE" value={selected} onChange={(at) => show(file, at, true)} options={file.pages.map((entry) => [entry.index, `Page ${entry.index + 1}`])} />
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            }
            output={
                opened.status === 'failed' ? (
                    <Failure tokens={tokens} message={opened.message} />
                ) : file ? (
                    <div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, marginBottom: 12, overflowWrap: 'anywhere' }}>
                            {`${file.name} · ${size(file.bytes)}${file.bigTiff ? ' · BigTIFF' : ''} · page ${selected + 1} of ${file.pages.length}${page?.pageName ? ` · ${page.pageName}` : ''}`}
                        </div>
                        {view.status === 'failed' ? <Failure tokens={tokens} message={view.message} /> : null}
                        {shown ? <Picture tokens={tokens} view={shown} label={`Page ${selected + 1} of ${file.name}`} canvasRef={canvas} style={{ maxHeight: 560 }} /> : null}
                        {view.status === 'running' ? <Meta tokens={tokens}>drawing the page…</Meta> : null}
                        {page ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                                {pageChips(page).map((chip) => <Chip key={chip} tokens={tokens}>{chip}</Chip>)}
                            </div>
                        ) : null}
                        {page?.stretchable ? (
                            <div style={{ marginTop: 12 }}>
                                <Toggle tokens={tokens} checked={stretch} onChange={(checked) => show(file, selected, checked)}>
                                    Stretch between the lowest and highest sample
                                </Toggle>
                            </div>
                        ) : null}
                        {shown ? (
                            <Meta tokens={tokens}>
                                {shown.mode === 'stretch'
                                    ? `samples from ${grouped(shown.low)} to ${grouped(shown.high)} spread over black to white${page?.nodata ? `; no-data (${page.nodata}) is transparent` : ''}`
                                    : `drawn by TIFFRGBAImage, ${shown.width} × ${shown.height} on screen`}
                            </Meta>
                        ) : null}
                        {shown ? (
                            <div style={{ marginTop: 14 }}>
                                <SecondaryButton tokens={tokens} onClick={savePng}>Download this page as PNG</SecondaryButton>
                            </div>
                        ) : null}
                        {shown?.tags ? (
                            <details style={{ marginTop: 14 }}>
                                <summary className="tap-target" style={{ cursor: 'pointer', fontFamily: tokens.mono, fontSize: 11.5, letterSpacing: 0.8, color: tokens.accentText }}>ALL TAGS</summary>
                                <pre style={{ margin: '10px 0 0', maxHeight: 260, overflow: 'auto', fontFamily: tokens.mono, fontSize: 11.5, lineHeight: 1.55, color: tokens.codeText, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '10px 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                    {shown.tags}
                                </pre>
                            </details>
                        ) : null}
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open the sample, or a TIFF of your own, to see its pages and tags.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/tiff_viewer.h', code: VIEWER_WRAPPER },
                { file: 'main.js', code: VIEWER_USAGE },
            ]}
        />
    );
}
TiffViewerApp.appId = 'tiff-viewer';

// Page photos as the browser decodes them, the longer side at most SCAN_SIDE pixels.
async function photoPixels(photo) {
    const bitmap = await createImageBitmap(photo);
    const scale = Math.min(1, SCAN_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const { data } = context.getImageData(0, 0, width, height);
    return { width, height, rgba: new Uint8Array(data.buffer) };
}

const THRESHOLDS = [[-1, "Otsu's, per page"], [100, '100'], [130, '130'], [160, '160'], [190, '190']];
const RESOLUTIONS = [[150, '150 dpi'], [200, '200 dpi'], [300, '300 dpi']];

const SCAN_WRAPPER = `// src/native/scan_archive.h (excerpt)
const int cut = threshold < 0 ? otsu(histogram, pixels) : std::min(threshold, 255);
// ... pixels at or below the cut become 1-bit black ...
tiffapps::Closer file(tiffapps::openFile(tifPath, index == 0 ? "w" : "a"));  // "a" appends a page
TIFF* tif = file.get();
pageTags(tif, width, height, COMPRESSION_CCITTFAX4);  // 1-bit, min-is-white, one strip
TIFFSetField(tif, TIFFTAG_SUBFILETYPE, FILETYPE_PAGE);
TIFFSetField(tif, TIFFTAG_PAGENUMBER, index, count);
TIFFSetField(tif, TIFFTAG_XRESOLUTION, static_cast<float>(dpi));
TIFFSetField(tif, TIFFTAG_YRESOLUTION, static_cast<float>(dpi));
TIFFSetField(tif, TIFFTAG_RESOLUTIONUNIT, RESUNIT_INCH);
writeRows(tif, bits, rowBytes, height);`;

const SCAN_USAGE = `const m = await initNative();
const dir = await m.getRandomPath('/memfs');   // a fresh directory for each run
// one page: the RGBA of a canvas the photo was drawn on
await m.FS.writeFile(\`\${dir}/page.rgba\`, new Uint8Array(imageData.data.buffer));
const cut = JSON.parse(await m.ScanArchive.binarize(\`\${dir}/page.rgba\`, width, height, -1, \`\${dir}/page.bits\`));
await m.ScanArchive.addPage(\`\${dir}/archive.tif\`, \`\${dir}/page.bits\`, width, height, 200, 0, 1);
const tiff = await m.getFileBytes(\`\${dir}/archive.tif\`);`;

export function ScanArchiveApp({ tokens, index, load }) {
    const [threshold, setThreshold] = useState(-1);
    const [dpi, setDpi] = useState(150);
    const [state, run] = useNativeTask(load);
    const build = (photos) =>
        run(plainly(async (m) => {
            // m.FS.writeFile appends to a file that already exists, so every run gets its own directory.
            const directory = await m.getRandomPath('/memfs');
            const count = photos ? photos.length : 2;
            const pages = [];
            for (let page = 0; page < count; page += 1) {
                let width = 1240;
                let height = 1754;
                const rgbaPath = `${directory}/page-${page}.rgba`;
                if (photos) {
                    const pixels = await photoPixels(photos[page]);
                    width = pixels.width;
                    height = pixels.height;
                    await m.FS.writeFile(rgbaPath, pixels.rgba);
                } else {
                    await m.ScanArchive.makePage(page, width, height, rgbaPath);
                }
                const cut = JSON.parse(await m.ScanArchive.binarize(rgbaPath, width, height, threshold, `${directory}/page-${page}.bits`));
                await m.FS.unlink(rgbaPath);
                const added = JSON.parse(await m.ScanArchive.addPage(`${directory}/archive.tif`, `${directory}/page-${page}.bits`, width, height, dpi, page, count));
                pages.push({ ...cut, ...added, width, height, preview: await renderPage(m, `${directory}/archive.tif`, page, 220, false) });
            }
            const codecs = JSON.parse(await m.ScanArchive.codecSizes(`${directory}/page-0.bits`, pages[0].width, pages[0].height));
            return {
                pages,
                codecs,
                tiff: await m.getFileBytes(`${directory}/archive.tif`),
                photoBytes: photos ? photos.reduce((total, photo) => total + photo.size, 0) : null,
                automatic: threshold < 0,
            };
        }));
    const result = state.status === 'ready' ? state.result : null;
    const bitBytes = result ? result.pages.reduce((total, page) => total + Math.ceil(page.width / 8) * page.height, 0) : 0;
    const smallest = result ? result.codecs.reduce((best, codec) => (codec.bytes < best.bytes ? codec : best)) : null;
    const codecLabel = (codec) => (codec.name === 'AdobeDeflate' ? 'Deflate' : codec.name === 'None' ? 'Uncompressed' : codec.name);
    return (
        <AppCard
            tokens={tokens}
            id="tiff-scans"
            index={index}
            status={state.status}
            title="Turn page photos into one archival TIFF"
            pitch="Photograph a few pages, or use the two sample photos, and get one multi-page TIFF: each page is turned black and white with Otsu's threshold, then stored with CCITT Group 4, the coding of Group 4 fax. The two sample A4 pages take 19.6 KB in all, and nothing leaves this tab."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                        <Select tokens={tokens} label="THRESHOLD" value={threshold} onChange={setThreshold} options={THRESHOLDS} />
                        <Select tokens={tokens} label="RESOLUTION TAG" value={dpi} onChange={setDpi} options={RESOLUTIONS} />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={() => build(null)}>Archive the sample pages</RunButton>
                        <FileButton tokens={tokens} accept="image/*" multiple busy={state.status === 'running'} onFiles={build}>Use your photos</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        Your photos are decoded by this browser, scaled to at most {grouped(SCAN_SIDE)} pixels on the longer side and never uploaded. Flat, evenly lit pages work best: there is no perspective correction.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 18 }}>
                            <Stat tokens={tokens} accent value={size(result.tiff.length)} label={`${result.pages.length} ${result.pages.length === 1 ? 'page' : 'pages'}, CCITT Group 4`} />
                            <Stat tokens={tokens} value={times(bitBytes, result.tiff.length)} label="smaller than the same pages uncompressed" />
                            {result.photoBytes ? <Stat tokens={tokens} value={times(result.photoBytes, result.tiff.length)} label="smaller than your photo files" /> : null}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10, marginBottom: 14 }}>
                            {result.pages.map((page) => (
                                <div key={page.page} style={{ minWidth: 0 }}>
                                    <Picture tokens={tokens} view={page.preview} label={`Archived page ${page.page}`} />
                                    <div style={{ fontFamily: tokens.mono, fontSize: 10.5, color: tokens.textMuted, marginTop: 4, lineHeight: 1.5 }}>
                                        {`p${page.page} · cut ${page.threshold} · ${((page.black / page.pixels) * 100).toFixed(1)}% black · ${size(page.bytes)}`}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Label tokens={tokens}>PAGE 1 AS A ONE-PAGE TIFF, BY CODEC</Label>
                        <Bars tokens={tokens} rows={result.codecs.map((codec) => ({ label: codecLabel(codec), bytes: codec.bytes, highlight: codec.name === 'CCITT Group 4' }))} />
                        <Meta tokens={tokens}>
                            {`Smallest for this page: ${codecLabel(smallest)}. CCITT Group 3 and 4 are in the TIFF 6.0 specification; Deflate and ZSTD came later as extensions, so older TIFF readers may not open them.`}
                        </Meta>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 16 }}>
                            <SecondaryButton tokens={tokens} onClick={() => download(result.tiff, 'archive.tif', 'image/tiff')}>Download archive.tif</SecondaryButton>
                            <span style={{ fontSize: 12.5, color: tokens.textMuted }}>{result.automatic ? "Threshold: Otsu's method, chosen per page." : 'Threshold: the same fixed value on every page.'}</span>
                        </div>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Archive the sample pages, or your own photos, to see each page in black and white and what each codec makes of it.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/scan_archive.h', code: SCAN_WRAPPER },
                { file: 'main.js', code: SCAN_USAGE },
            ]}
        />
    );
}
ScanArchiveApp.appId = 'tiff-scans';

// [label, COMPRESSION_* code, predictor, LERC max error]; the demo's index.html checks the same list.
const LAB = {
    0: {
        name: 'cells',
        label: 'Fluorescent cells, 12-bit in 16-bit samples',
        unit: '',
        variants: [
            ['Uncompressed', 1, 1, 0],
            ['PackBits', 32773, 1, 0],
            ['LZW', 5, 1, 0],
            ['LZW + horizontal predictor', 5, 2, 0],
            ['Deflate', 8, 1, 0],
            ['Deflate + horizontal predictor', 8, 2, 0],
            ['ZSTD', 50000, 1, 0],
            ['ZSTD + horizontal predictor', 50000, 2, 0],
            ['LERC, exact', 34887, 1, 0],
            ['LERC, error up to 8', 34887, 1, 8],
        ],
    },
    1: {
        name: 'elevation',
        label: 'Elevation in metres, 32-bit float',
        unit: ' m',
        variants: [
            ['Uncompressed', 1, 1, 0],
            ['LZW', 5, 1, 0],
            ['LZW + floating-point predictor', 5, 3, 0],
            ['Deflate', 8, 1, 0],
            ['Deflate + floating-point predictor', 8, 3, 0],
            ['ZSTD', 50000, 1, 0],
            ['ZSTD + floating-point predictor', 50000, 3, 0],
            ['LERC, exact', 34887, 1, 0],
            ['LERC, error up to 0.1 m', 34887, 1, 0.1],
            ['LERC, error up to 1 m', 34887, 1, 1],
        ],
    },
};

const LAB_WRAPPER = `// src/native/compression_lab.h (excerpt)
TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, kind == 0 ? 16 : 32);
TIFFSetField(tif, TIFFTAG_SAMPLEFORMAT, kind == 0 ? SAMPLEFORMAT_UINT : SAMPLEFORMAT_IEEEFP);
TIFFSetField(tif, TIFFTAG_COMPRESSION, compression);
if (predictor != PREDICTOR_NONE) TIFFSetField(tif, TIFFTAG_PREDICTOR, predictor);
if (compression == COMPRESSION_LERC) TIFFSetField(tif, TIFFTAG_LERC_MAXZERROR, maxZError);
// ... 256 x 256 tiles written, then read back with TIFFReadTile and compared sample by sample`;

const LAB_USAGE = `const m = await initNative();
await m.FS.mkdirTree('/memfs/lab');
const lab = await new m.CompressionLab(1, 512);   // 512 x 512 float32 elevation
// Deflate (8) with the floating-point predictor (3)
const run = JSON.parse(await lab.run(8, 3, 0, '/memfs/lab/deflate.tif'));
// run.bytes: 287494, run.maxError: 0 (every sample came back exactly)`;

export function CompressionLabApp({ tokens, index, load }) {
    const [kind, setKind] = useState(1);
    const [state, run] = useNativeTask(load);
    const [saving, setSaving] = useState(null);
    const result = state.status === 'ready' ? state.result : null;
    const start = () =>
        run(plainly(async (m) => {
            const directory = `${DIRECTORY}/lab`;
            await m.FS.mkdirTree(directory);
            const lab = await new m.CompressionLab(kind, 512);
            const rows = [];
            for (const [label, compression, predictor, maxZError] of LAB[kind].variants) {
                const path = `${directory}/${LAB[kind].name}-${rows.length + 1}.tif`;
                rows.push({ label, path, ...JSON.parse(await lab.run(compression, predictor, maxZError, path)) });
            }
            return { kind, raw: await lab.rawBytes(), dataset: JSON.parse(await lab.dataset()), rows };
        }));
    const save = async (row) => {
        setSaving(null);
        try {
            const m = await load();
            download(await m.getFileBytes(row.path), `${LAB[result.kind].name}-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.tif`, 'image/tiff');
        } catch (error) {
            setSaving(failed(error));
        }
    };
    const exact = result ? result.rows.filter((row) => row.maxError === 0) : [];
    const best = exact.length ? exact.reduce((low, row) => (row.bytes < low.bytes ? row : low)) : null;
    const fidelity = (row) => (row.maxError === 0 ? 'exact' : `max error ${Number(row.maxError.toPrecision(3))}${LAB[result.kind].unit}`);
    return (
        <AppCard
            tokens={tokens}
            id="tiff-lab"
            index={index}
            status={state.status}
            title="Compare every codec on 16-bit and float rasters"
            pitch="There is no best TIFF codec for scientific rasters, only a best one for each dataset. The module writes one raster with every codec in this build, reads each file back and compares every sample: here the floating-point predictor makes the elevation model 40% smaller with Deflate, while the horizontal predictor makes the noisy cells bigger."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="RASTER, 512 × 512" value={kind} onChange={setKind} options={[[0, LAB[0].label], [1, LAB[1].label]]} />
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Compress it every way</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        Both rasters are generated in the module, so the sizes are the same on every machine. These are this data's sizes; other data will rank the codecs differently, and the same calls measure it. LERC can keep every sample, or trade a bounded error for size.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : result ? (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 18 }}>
                            <Stat tokens={tokens} accent value={times(result.raw, best.bytes)} label={`smaller and exact: ${best.label}`} />
                            <Stat tokens={tokens} value={size(result.raw)} label={`raw, ${result.dataset.bitsPerSample}-bit ${result.dataset.sampleFormat}, ${grouped(result.dataset.min)} to ${grouped(result.dataset.max)}${LAB[result.kind].unit}`} />
                        </div>
                        <Bars tokens={tokens} rows={result.rows.map((row) => ({ label: row.label, bytes: row.bytes, highlight: row === best, detail: `${size(row.bytes)} · ${times(result.raw, row.bytes)} · ${fidelity(row)}` }))} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                            {result.rows.map((row) => (
                                <button
                                    key={row.path}
                                    type="button"
                                    onClick={() => save(row)}
                                    style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: 7, padding: '4px 8px', color: tokens.accentText, fontFamily: tokens.mono, fontSize: 11, cursor: 'pointer' }}
                                >
                                    {`${row.label}.tif`}
                                </button>
                            ))}
                        </div>
                        {saving ? <Failure tokens={tokens} message={saving} /> : null}
                        <Meta tokens={tokens}>Every file was read back with libtiff and compared with the original, sample by sample. Sizes include the TIFF directory.</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Pick a raster and compress it with every codec, to see sizes and which ones keep every sample.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/compression_lab.h', code: LAB_WRAPPER },
                { file: 'main.js', code: LAB_USAGE },
            ]}
        />
    );
}
CompressionLabApp.appId = 'tiff-lab';

export const TIFF_APPS = [TiffViewerApp, ScanArchiveApp, CompressionLabApp];

import { useEffect, useRef, useState } from 'react';
import AppCard, { Failure, Label, RunButton, useNativeTask } from '../AppCard.jsx';
import { download, grouped, Hint, Meta, Placeholder, SecondaryButton, Select, Stat } from '../controls.jsx';
import { freshFolder, LicenceNote, plainly, Segmented } from './shared.jsx';

const TERRAIN_SIZE = 512;

const PRODUCTS = [
    ['relief', 'Colour relief'],
    ['hillshade', 'Hillshade'],
    ['slope', 'Slope'],
    ['aspect', 'Aspect'],
    ['roughness', 'Roughness'],
    ['TPI', 'TPI'],
];
const PRODUCT_UNITS = { relief: 'm', hillshade: '', slope: '°', aspect: '°', roughness: 'm', TPI: 'm' };
const PRODUCT_NOTES = {
    relief: 'Height coloured from green lowlands to white peaks, then shaded by a hillshade.',
    hillshade: 'gdaldem hillshade: grey levels for the light falling on each cell from the chosen direction.',
    slope: 'gdaldem slope in degrees, from white (flat) to dark red (steep).',
    aspect: 'gdaldem aspect: the compass direction each slope faces, as a colour wheel.',
    roughness: 'gdaldem roughness: the largest height difference between a cell and its eight neighbours.',
    TPI: 'gdaldem TPI: a cell against the mean of its neighbours; ridges are red, valleys blue.',
};
const INTERVALS = [
    ['0', 'None'],
    ['50', '50 m'],
    ['100', '100 m'],
    ['200', '200 m'],
];
const HEIGHTS = [
    ['2', 'a person, 2 m'],
    ['10', 'a tower, 10 m'],
    ['50', 'a mast, 50 m'],
];

function paintRgba(canvas, rgba, width, height) {
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
}

// Hidden ground darkened, seen ground left as it is.
function paintViewshed(canvas, mask, width, height) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < mask.length; i += 1) rgba[i * 4 + 3] = mask[i] === 255 ? 0 : 115;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
}

function contourPaths(geojson, geoTransform) {
    const [x0, dx, , y0, , dy] = geoTransform;
    return geojson.features.map((feature) => ({
        elevation: feature.properties.elevation,
        d: feature.geometry.coordinates.map(([x, y], i) => `${i ? 'L' : 'M'}${((x - x0) / dx).toFixed(1)} ${((y - y0) / dy).toFixed(1)}`).join(''),
    }));
}

const TERRAIN_WRAPPER = `// src/native/terrain_studio.h (excerpt): gdaldem into memory, then coloured
GDALDEMProcessingOptions* options = GDALDEMProcessingOptionsNew(args.List(), nullptr); // -of MEM -compute_edges
GDALDatasetH values = GDALDEMProcessing("", source, "slope", nullptr, options, nullptr);
GDALDatasetH coloured = GDALDEMProcessing("", values, "color-relief", "/vsimem/colours.txt", alpha, nullptr);

// gdal_viewshed from a clicked pixel, with the Earth's curvature and refraction
GDALDatasetH seen = GDALViewshedGenerate(band, "MEM", "", nullptr, x, y, height, 0, 255, 0, 0, -1,
                                         0.85714, GVM_Edge, 0, nullptr, nullptr, GVOT_NORMAL, nullptr);`;

const TERRAIN_USAGE = `const m = await initNative();
await new m.TerrainStudio();
await m.FS.mkdirTree('/memfs/terrain');
const dem = '/memfs/terrain/dem.tif';
const model = JSON.parse(await m.TerrainStudio.create(dem, 512, 1)); // 493.6 to 1752.7 m

const view = JSON.parse(await m.TerrainStudio.render(dem, 'slope', 315, '/memfs/terrain/slope.rgba'));
const rgba = await m.getFileBytes('/memfs/terrain/slope.rgba'); // 512 x 512 RGBA for a canvas
const lines = JSON.parse(await m.TerrainStudio.contours(dem, 100)); // GeoJSON, 346 lines
const seen = JSON.parse(await m.TerrainStudio.viewshed(dem, 256, 256, 10, '/memfs/terrain/seen.bin'));
// seen.visible: 3123 of 262144 cells`;

export function TerrainStudioApp({ tokens, index, load }) {
    const [terrain, generate] = useNativeTask(load);
    const [view, draw] = useNativeTask(load);
    const [lines, trace] = useNativeTask(load);
    const [sight, look] = useNativeTask(load);
    const [saved, save] = useNativeTask(load);
    const [seed, setSeed] = useState(1);
    const [product, setProduct] = useState('relief');
    const [azimuth, setAzimuth] = useState(315);
    const [spacing, setSpacing] = useState('100');
    const [height, setHeight] = useState('10');
    const picture = useRef(null);
    const shadow = useRef(null);
    const model = terrain.status === 'ready' ? terrain.result : null;

    const render = (target, nextProduct, nextAzimuth) =>
        draw(plainly(async (m) => {
            const folder = await freshFolder(m, 'view');
            const shown = JSON.parse(await m.TerrainStudio.render(target.dem, nextProduct, nextAzimuth, `${folder}/view.rgba`));
            return { ...shown, dem: target.dem, rgba: await m.getFileBytes(`${folder}/view.rgba`) };
        }));
    const drawContours = (target, every) =>
        trace(plainly(async (m) => ({
            dem: target.dem,
            every: Number(every),
            paths: every === '0' ? [] : contourPaths(JSON.parse(await m.TerrainStudio.contours(target.dem, Number(every))), target.geoTransform),
        })));
    const start = (nextSeed) =>
        generate(plainly(async (m) => {
            await new m.TerrainStudio();
            const folder = await freshFolder(m, 'terrain');
            const dem = `${folder}/dem.tif`;
            return { ...JSON.parse(await m.TerrainStudio.create(dem, TERRAIN_SIZE, nextSeed)), dem, seed: nextSeed };
        }));
    useEffect(() => {
        if (!model) return;
        render(model, product, azimuth);
        drawContours(model, spacing);
    }, [model]);
    const shown = view.status === 'ready' && model && view.result.dem === model.dem ? view.result : null;
    const contours = lines.status === 'ready' && model && lines.result.dem === model.dem ? lines.result : null;
    const seen = sight.status === 'ready' && model && sight.result.dem === model.dem ? sight.result : null;
    useEffect(() => {
        if (shown && picture.current) paintRgba(picture.current, shown.rgba, shown.width, shown.height);
    }, [shown]);
    useEffect(() => {
        if (seen && shadow.current) paintViewshed(shadow.current, seen.mask, TERRAIN_SIZE, TERRAIN_SIZE);
    }, [seen]);

    const pick = (next) => {
        setProduct(next);
        if (model) render(model, next, azimuth);
    };
    const turn = (next) => {
        setAzimuth(next);
        if (model) render(model, product, next);
    };
    const every = (next) => {
        setSpacing(next);
        if (model) drawContours(model, next);
    };
    const observe = (event) => {
        if (!model || sight.status === 'running') return;
        const box = event.currentTarget.getBoundingClientRect();
        const column = Math.min(TERRAIN_SIZE - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * TERRAIN_SIZE)));
        const row = Math.min(TERRAIN_SIZE - 1, Math.max(0, Math.floor(((event.clientY - box.top) / box.height) * TERRAIN_SIZE)));
        look(plainly(async (m) => {
            const folder = await freshFolder(m, 'seen');
            const result = JSON.parse(await m.TerrainStudio.viewshed(model.dem, column, row, Number(height), `${folder}/seen.bin`));
            return { ...result, column, row, observer: height, dem: model.dem, mask: await m.getFileBytes(`${folder}/seen.bin`) };
        }));
    };
    const keep = (what) =>
        save(plainly(async (m) => {
            const folder = await freshFolder(m, 'saved');
            const result = JSON.parse(await m.TerrainStudio.save(model.dem, what, `${folder}/${what}.tif`));
            download(await m.getFileBytes(result.download), `terrain-${model.seed}-${what}.tif`, 'image/tiff');
            return result;
        }));
    const unit = PRODUCT_UNITS[product];
    const decimals = ['relief', 'hillshade', 'aspect'].includes(product) ? 0 : 1;

    return (
        <AppCard
            tokens={tokens}
            id="gdal-terrain"
            index={index}
            status={terrain.status}
            title="A terrain studio: hillshade, slope, contour lines and what is seen from where you click"
            pitch="The module generates a 15 km landscape and GDAL analyses it in the page: the gdaldem products, contour lines at the interval you pick, and a viewshed from any point you click, with the Earth's curvature. Every product downloads as a georeferenced GeoTIFF."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={terrain.status === 'running'} onClick={() => start(seed)}>{model ? 'Generate again' : 'Generate the terrain'}</RunButton>
                        <SecondaryButton
                            tokens={tokens}
                            disabled={terrain.status === 'running'}
                            onClick={() => {
                                setSeed(seed + 1);
                                start(seed + 1);
                            }}
                        >
                            A different landscape
                        </SecondaryButton>
                    </div>
                    <Segmented tokens={tokens} label="Product" value={product} options={PRODUCTS} onChange={pick} disabled={!model} />
                    <label style={{ display: 'block' }}>
                        <Label tokens={tokens}>{`LIGHT FROM ${azimuth}°`}</Label>
                        <input type="range" min="0" max="345" step="15" value={azimuth} disabled={!model} onChange={(event) => turn(Number(event.target.value))} style={{ width: '100%', accentColor: tokens.accent }} />
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                        <Select tokens={tokens} label="CONTOUR LINES EVERY" value={spacing} onChange={every} disabled={!model}>
                            {INTERVALS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                        </Select>
                        <Select tokens={tokens} label="OBSERVER" value={height} onChange={setHeight} disabled={!model}>
                            {HEIGHTS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                        </Select>
                    </div>
                    <Hint tokens={tokens}>
                        {`${PRODUCT_NOTES[product]} Click the map to place the observer. The terrain is gradient noise from seed ${seed}, 512 × 512 cells of 30 m placed in UTM zone 35N; it is not a real place.`}
                    </Hint>
                    {model ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            <SecondaryButton tokens={tokens} disabled={saved.status === 'running'} onClick={() => keep('dem')}>Download the elevation model</SecondaryButton>
                            <SecondaryButton tokens={tokens} disabled={saved.status === 'running'} onClick={() => keep(product)}>{`Download the ${PRODUCTS.find(([id]) => id === product)[1].toLowerCase()}`}</SecondaryButton>
                        </div>
                    ) : null}
                    {saved.status === 'failed' ? <Failure tokens={tokens} message={saved.message} /> : null}
                </div>
            }
            output={
                terrain.status === 'failed' ? (
                    <Failure tokens={tokens} message={terrain.message} />
                ) : model ? (
                    <div style={{ display: 'grid', gap: 14 }}>
                        <div
                            role="button"
                            tabIndex={0}
                            aria-label="The terrain; click to place an observer"
                            data-terrain=""
                            onClick={observe}
                            style={{ position: 'relative', width: '100%', maxWidth: 512, aspectRatio: '1 / 1', cursor: 'crosshair', border: `1px solid ${tokens.border}`, borderRadius: 8, overflow: 'hidden', background: tokens.codeBg }}
                        >
                            <canvas ref={picture} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
                            {seen ? <canvas ref={shadow} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} /> : null}
                            <svg viewBox={`0 0 ${TERRAIN_SIZE} ${TERRAIN_SIZE}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                                {(contours?.paths ?? []).map((line, i) => (
                                    <path key={i} d={line.d} fill="none" stroke="#1d1d1b" strokeOpacity={line.elevation % 500 === 0 ? 0.75 : 0.4} strokeWidth={line.elevation % 500 === 0 ? 1.4 : 0.8} vectorEffect="non-scaling-stroke" />
                                ))}
                                {seen ? (
                                    <g>
                                        <circle cx={seen.column + 0.5} cy={seen.row + 0.5} r="9" fill="none" stroke={tokens.accent} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                                        <circle cx={seen.column + 0.5} cy={seen.row + 0.5} r="2.5" fill={tokens.accent} />
                                    </g>
                                ) : null}
                            </svg>
                        </div>
                        {view.status === 'failed' ? <Failure tokens={tokens} message={view.message} /> : null}
                        {sight.status === 'failed' ? <Failure tokens={tokens} message={sight.message} /> : null}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
                            <Stat tokens={tokens} size={20} value={`${Math.round(model.min)}–${Math.round(model.max)} m`} label="elevation" />
                            <Stat tokens={tokens} size={20} value={shown ? `${shown.min.toFixed(decimals)}–${shown.max.toFixed(decimals)}${unit ? ` ${unit}` : ''}` : '…'} label={PRODUCTS.find(([id]) => id === product)[1].toLowerCase()} />
                            <Stat tokens={tokens} size={20} value={contours ? grouped(contours.paths.length) : '…'} label={contours?.every ? `contour lines, every ${contours.every} m` : 'contour lines'} />
                            <Stat tokens={tokens} size={20} accent value={seen ? `${((seen.visible / seen.cells) * 100).toFixed(1)}%` : 'click'} label={seen ? `of the ground is seen from ${seen.observer} m` : 'the map for a viewshed'} />
                        </div>
                        <Meta tokens={tokens}>
                            {[shown ? `render ${view.ms} ms` : null, contours ? `contours ${lines.ms} ms` : null, seen ? `viewshed ${sight.ms} ms` : null, `model ${terrain.ms} ms`].filter(Boolean).join(' · ')}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Generate the terrain to see it shaded, measured and contoured.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/terrain_studio.h', code: TERRAIN_WRAPPER },
                { file: 'main.js', code: TERRAIN_USAGE },
            ]}
        />
    );
}
TerrainStudioApp.appId = 'gdal-terrain';

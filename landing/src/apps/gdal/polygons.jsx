import { useEffect, useRef, useState } from 'react';
import AppCard, { Failure, Label, RunButton, useNativeTask } from '../AppCard.jsx';
import { download, grouped, Meta, Placeholder, SecondaryButton, Select, Stat } from '../controls.jsx';
import { freshFolder, LicenceNote, plainly, Segmented, size } from './shared.jsx';

const CANVAS_SIZE = 128;

// The sample: a square with a hole, a disc, an L and four specks, as the module's self-check uses it.
function sampleMask() {
    const mask = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
    const set = (x, y) => {
        mask[y * CANVAS_SIZE + x] = 1;
    };
    for (let y = 10; y < 50; y += 1) for (let x = 10; x < 50; x += 1) if (!(x >= 25 && x < 35 && y >= 25 && y < 35)) set(x, y);
    for (let y = 0; y < CANVAS_SIZE; y += 1) for (let x = 0; x < CANVAS_SIZE; x += 1) if ((x - 90) ** 2 + (y - 40) ** 2 <= 400) set(x, y);
    for (let y = 70; y < 110; y += 1) for (let x = 15; x < 35; x += 1) set(x, y);
    for (let y = 90; y < 110; y += 1) for (let x = 35; x < 65; x += 1) set(x, y);
    for (const [x, y] of [[110, 110], [120, 12], [70, 120], [71, 120], [100, 100], [101, 100], [100, 101], [101, 101]]) set(x, y);
    return mask;
}

function paintMask(canvas, mask, ink) {
    const rgba = new Uint8ClampedArray(mask.length * 4);
    for (let i = 0; i < mask.length; i += 1) if (mask[i]) rgba.set(ink, i * 4);
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    canvas.getContext('2d').putImageData(new ImageData(rgba, CANVAS_SIZE, CANVAS_SIZE), 0, 0);
}

const SIEVES = [
    ['0', 'Keep every pixel'],
    ['5', 'Under 5 pixels'],
    ['20', 'Under 20 pixels'],
    ['80', 'Under 80 pixels'],
];
const TOLERANCES = [
    ['0', 'None: pixel edges'],
    ['0.75', '0.75 pixel'],
    ['1.5', '1.5 pixels'],
    ['3', '3 pixels'],
];
const SAVES = [
    ['GeoJSON', 'GeoJSON', 'geojson'],
    ['GPKG', 'GeoPackage', 'gpkg'],
    ['ESRI Shapefile', 'Shapefile', 'shp'],
    ['DXF', 'DXF for CAD', 'dxf'],
];

const POLYGONS_WRAPPER = `// src/native/vectorizer.h (excerpt): specks out, then every region of ink as a polygon
if (sieve > 1) GDALSieveFilter(band, nullptr, band, sieve, 4, nullptr, nullptr, nullptr);
OGRLayerH layer = GDALDatasetCreateLayer(store, "shapes", nullptr, wkbPolygon, nullptr);
// the band is its own mask, so background pixels (0) make no polygon
GDALPolygonize(band, band, layer, 0, nullptr, nullptr, nullptr);
// then ogr2ogr -simplify <tolerance>, which keeps each polygon valid`;

const POLYGONS_USAGE = `const m = await initNative();
await new m.Vectorizer();
await m.FS.mkdirTree('/memfs/trace/out');
await m.FS.writeFile('/memfs/trace/mask.bin', mask); // 128 x 128 bytes, 0 = background
const traced = JSON.parse(await m.Vectorizer.trace('/memfs/trace/mask.bin', 128, 128, 5, 1.5));
// traced.polygons: 3, traced.holes: 1, traced.areas: [1500, 1400, 1257]
const saved = JSON.parse(await m.Vectorizer.save('/memfs/trace/mask.bin', 128, 128, 5, 1.5, 'GPKG', '/memfs/trace/out/shapes.gpkg'));`;

export function PixelsToPolygonsApp({ tokens, index, load }) {
    const [traced, trace] = useNativeTask(load);
    const [saved, save] = useNativeTask(load);
    const [sieve, setSieve] = useState('5');
    const [tolerance, setTolerance] = useState('1.5');
    const [brush, setBrush] = useState(3);
    const [erasing, setErasing] = useState(false);
    const [version, setVersion] = useState(0);
    const mask = useRef(null);
    const canvas = useRef(null);
    const painting = useRef(false);
    const ink = tokens.isLight ? [40, 40, 40, 255] : [225, 225, 225, 255];

    if (!mask.current) mask.current = sampleMask();
    useEffect(() => {
        if (canvas.current) paintMask(canvas.current, mask.current, ink);
    }, [version, tokens.isLight]);

    const stroke = (event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const cx = Math.floor(((event.clientX - box.left) / box.width) * CANVAS_SIZE);
        const cy = Math.floor(((event.clientY - box.top) / box.height) * CANVAS_SIZE);
        const reach = brush - 1;
        for (let y = cy - reach; y <= cy + reach; y += 1) {
            for (let x = cx - reach; x <= cx + reach; x += 1) {
                if (x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE || (x - cx) ** 2 + (y - cy) ** 2 > reach * reach + reach) continue;
                mask.current[y * CANVAS_SIZE + x] = erasing ? 0 : 1;
            }
        }
        setVersion((value) => value + 1);
    };
    const reset = (next) => {
        mask.current = next;
        setVersion((value) => value + 1);
    };
    const writeMask = async (m) => {
        const folder = await freshFolder(m, 'mask');
        await m.FS.writeFile(`${folder}/mask.bin`, mask.current);
        return folder;
    };
    const start = () =>
        trace(plainly(async (m) => {
            await new m.Vectorizer();
            const folder = await writeMask(m);
            return JSON.parse(await m.Vectorizer.trace(`${folder}/mask.bin`, CANVAS_SIZE, CANVAS_SIZE, Number(sieve), Number(tolerance)));
        }));
    const keep = ([format, label, extension]) =>
        save(plainly(async (m) => {
            await new m.Vectorizer();
            const folder = await writeMask(m);
            await m.FS.mkdirTree(`${folder}/out`);
            const result = JSON.parse(await m.Vectorizer.save(`${folder}/mask.bin`, CANVAS_SIZE, CANVAS_SIZE, Number(sieve), Number(tolerance), format, `${folder}/out/shapes.${extension}`));
            const name = result.files.length > 1 ? `shapes-${label.toLowerCase().split(' ')[0]}.zip` : `shapes.${extension}`;
            download(await m.getFileBytes(result.download), name);
            return { name, bytes: result.bytes };
        }));
    const done = traced.status === 'ready' ? traced.result : null;
    const shapes = done ? done.geojson : null;

    return (
        <AppCard
            tokens={tokens}
            id="gdal-polygons"
            index={index}
            status={traced.status}
            title="Pixels to polygons: paint, and GDAL traces the shapes"
            pitch="Paint on the grid, or keep the sample. GDAL removes the specks below a size you pick, traces every region of ink into a polygon with its holes, simplifies the staircase edges and saves the result as GeoJSON, GeoPackage, Shapefile or DXF. The same calls turn classified satellite images and scanned maps into vector layers."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
                        <Segmented tokens={tokens} label="Brush" value={erasing ? 'erase' : 'paint'} options={[['paint', 'Paint'], ['erase', 'Erase']]} onChange={(mode) => setErasing(mode === 'erase')} />
                        <label style={{ display: 'block', minWidth: 140 }}>
                            <Label tokens={tokens}>{`SIZE ${brush}`}</Label>
                            <input type="range" min="1" max="8" value={brush} onChange={(event) => setBrush(Number(event.target.value))} style={{ width: '100%', accentColor: tokens.accent }} />
                        </label>
                    </div>
                    <div
                        data-paint=""
                        style={{ position: 'relative', width: '100%', maxWidth: 384, aspectRatio: '1 / 1', border: `1px solid ${tokens.border}`, borderRadius: 8, overflow: 'hidden', background: tokens.codeBg, touchAction: 'none', cursor: 'crosshair' }}
                        onPointerDown={(event) => {
                            painting.current = true;
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                            stroke(event);
                        }}
                        onPointerMove={(event) => {
                            if (painting.current) stroke(event);
                        }}
                        onPointerUp={() => {
                            painting.current = false;
                        }}
                        onPointerCancel={() => {
                            painting.current = false;
                        }}
                        role="img"
                        aria-label="A 128 by 128 grid to paint on"
                    >
                        <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated' }} />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        <SecondaryButton tokens={tokens} onClick={() => reset(sampleMask())}>The sample</SecondaryButton>
                        <SecondaryButton tokens={tokens} onClick={() => reset(new Uint8Array(CANVAS_SIZE * CANVAS_SIZE))}>Clear</SecondaryButton>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                        <Select tokens={tokens} label="REMOVE SPECKS" value={sieve} onChange={setSieve}>
                            {SIEVES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                        </Select>
                        <Select tokens={tokens} label="SIMPLIFY BY" value={tolerance} onChange={setTolerance}>
                            {TOLERANCES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                        </Select>
                    </div>
                    <div>
                        <RunButton tokens={tokens} busy={traced.status === 'running'} onClick={start}>Trace the polygons</RunButton>
                    </div>
                </div>
            }
            output={
                traced.status === 'failed' ? (
                    <Failure tokens={tokens} message={traced.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 14 }}>
                        <svg viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`} role="img" aria-label="The traced polygons" style={{ display: 'block', width: '100%', maxWidth: 384, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 8 }}>
                            {shapes.features.map((feature, i) => (
                                <path
                                    key={i}
                                    d={feature.geometry.coordinates.map((ring) => `${ring.map(([x, y], j) => `${j ? 'L' : 'M'}${x} ${CANVAS_SIZE - y}`).join('')}Z`).join('')}
                                    fill={tokens.accent}
                                    fillOpacity={0.2}
                                    fillRule="evenodd"
                                    stroke={tokens.accent}
                                    strokeWidth={1.5}
                                    strokeLinejoin="round"
                                    vectorEffect="non-scaling-stroke"
                                />
                            ))}
                        </svg>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 14 }}>
                            <Stat tokens={tokens} size={20} accent value={grouped(done.polygons)} label={done.polygons === 1 ? 'polygon' : 'polygons'} />
                            <Stat tokens={tokens} size={20} value={grouped(done.holes)} label={done.holes === 1 ? 'hole' : 'holes'} />
                            <Stat tokens={tokens} size={20} value={grouped(done.vertices)} label="vertices" />
                        </div>
                        <Meta tokens={tokens}>{`areas in pixels: ${done.areas.slice(0, 12).map((area) => grouped(area)).join(', ')}${done.areas.length > 12 ? ', …' : ''} · ${traced.ms} ms`}</Meta>
                        <div>
                            <Label tokens={tokens}>SAVE AS</Label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {SAVES.map((entry) => (
                                    <SecondaryButton key={entry[0]} tokens={tokens} disabled={saved.status === 'running'} onClick={() => keep(entry)}>{entry[1]}</SecondaryButton>
                                ))}
                            </div>
                            {saved.status === 'failed' ? <Failure tokens={tokens} message={saved.message} /> : null}
                            {saved.status === 'ready' ? <Meta tokens={tokens}>{`${saved.result.name} · ${size(saved.result.bytes)}`}</Meta> : null}
                        </div>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Trace the polygons to see them drawn over the grid, with their areas.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/vectorizer.h', code: POLYGONS_WRAPPER },
                { file: 'main.js', code: POLYGONS_USAGE },
            ]}
        />
    );
}
PixelsToPolygonsApp.appId = 'gdal-polygons';

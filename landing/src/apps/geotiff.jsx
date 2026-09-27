import { useEffect, useMemo, useRef, useState } from 'react';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Stat } from './controls.jsx';

// The libgeotiff apps on /ports/geotiff/. Each one drives landing/demos/lib-geotiff, whose index.html
// checks the same calls against the host's own listgeo, GDAL and PROJ, the Krueger series for
// transverse Mercator and a Python model of the generated terrain.

const degrees = (value) => (value === null || value === undefined ? '–' : value.toFixed(6));
const short = (value) => String(Number(Number(value).toPrecision(10)));

// Fetches a file the module wrote and hands it to the browser as a download.
async function saveFile(load, file) {
    download(await (await load()).getFileBytes(file.path), file.name, 'image/tiff');
}

function NumberField({ tokens, label, value, onChange }) {
    return (
        <label style={{ display: 'block', minWidth: 0 }}>
            <Label tokens={tokens}>{label}</Label>
            <input type="number" step="any" value={value} onInput={(event) => onChange(event.target.value)} style={fieldStyle(tokens)} />
        </label>
    );
}

function Bar({ tokens, label, note, value, largest, highlight }) {
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, marginBottom: 5 }}>
                <span style={{ color: highlight ? tokens.accentText : tokens.textDim, fontWeight: highlight ? 600 : 400 }}>{label}</span>
                <span style={{ fontFamily: tokens.mono, color: highlight ? tokens.accentText : tokens.textDim, whiteSpace: 'nowrap' }}>{note}</span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: tokens.pillBg, border: `1px solid ${tokens.border}`, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(0.5, (value / largest) * 100)}%`, height: '100%', background: highlight ? tokens.accent : tokens.textMuted }} />
            </div>
        </div>
    );
}

// One bar per written file, each with its own download button.
function FileRows({ tokens, rows, largest, onSave }) {
    return (
        <div style={{ display: 'grid', gap: 9 }}>
            {rows.map((row) => (
                <div key={row.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'end' }}>
                    <Bar tokens={tokens} label={row.label} note={row.note} value={row.bytes} largest={largest} />
                    <SecondaryButton tokens={tokens} onClick={() => onSave(row)}>.tif</SecondaryButton>
                </div>
            ))}
        </div>
    );
}

function Picture({ tokens, pixels, width, height, label, onPointerMove, onPointerLeave, marker }) {
    const canvas = useRef(null);
    useEffect(() => {
        if (canvas.current && pixels) canvas.current.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
    }, [pixels, width, height]);
    return (
        <div style={{ position: 'relative', minWidth: 0 }}>
            <canvas ref={canvas} width={width} height={height} role="img" aria-label={label} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}
                style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 8, border: `1px solid ${tokens.border}`, background: tokens.codeBg, cursor: 'crosshair', touchAction: 'none' }} />
            {marker ? (
                <div aria-hidden="true" style={{ position: 'absolute', left: `${marker[0] * 100}%`, top: `${marker[1] * 100}%`, width: 14, height: 14, marginLeft: -7, marginTop: -7, border: `2px solid ${tokens.accent}`, borderRadius: '50%', pointerEvents: 'none' }} />
            ) : null}
        </div>
    );
}

// Cities for orientation on the world map.
const CITIES = [
    ['London', -0.13, 51.51], ['Moscow', 37.62, 55.76], ['Istanbul', 28.98, 41.01], ['Cairo', 31.24, 30.04], ['Lagos', 3.38, 6.52], ['Cape Town', 18.42, -33.92],
    ['New York', -74.01, 40.71], ['Los Angeles', -118.24, 34.05], ['Mexico City', -99.13, 19.43], ['São Paulo', -46.63, -23.55],
    ['Mumbai', 72.88, 19.08], ['Singapore', 103.82, 1.35], ['Beijing', 116.4, 39.9], ['Tokyo', 139.69, 35.69], ['Sydney', 151.21, -33.87],
];

const outlinePath = (points, x, y) => `${points.map(([lon, lat], index) => `${index ? 'L' : 'M'}${x(lon).toFixed(3)} ${y(lat).toFixed(3)}`).join('')}Z`;

function extentOf(points) {
    const lons = points.map((point) => point[0]);
    const lats = points.map((point) => point[1]);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

// Longitude and latitude drawn as x and y, the whole world, with the file's outline on top.
function WorldMap({ tokens, outline }) {
    const x = (lon) => lon + 180;
    const y = (lat) => 90 - lat;
    const [west, south, east, north] = extentOf(outline);
    const small = Math.max(east - west, north - south) < 4;
    return (
        <svg viewBox="0 0 360 180" role="img" aria-label="The file's outline on a map of the world in longitude and latitude" style={{ display: 'block', width: '100%', height: 'auto', background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 10 }}>
            {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => (
                <line key={`m${lon}`} x1={x(lon)} y1={0} x2={x(lon)} y2={180} stroke={tokens.border} strokeWidth={lon === 0 ? 1.4 : 0.7} vectorEffect="non-scaling-stroke" />
            ))}
            {[-60, -30, 0, 30, 60].map((lat) => (
                <line key={`p${lat}`} x1={0} y1={y(lat)} x2={360} y2={y(lat)} stroke={tokens.border} strokeWidth={lat === 0 ? 1.4 : 0.7} vectorEffect="non-scaling-stroke" />
            ))}
            {CITIES.map(([name, lon, lat]) => (
                <g key={name}>
                    <circle cx={x(lon)} cy={y(lat)} r={1.3} fill={tokens.textMuted} />
                    <text x={x(lon) + 2.4} y={y(lat) + 2.4} fontSize={7} fill={tokens.textMuted} fontFamily={tokens.sans}>{name}</text>
                </g>
            ))}
            <path d={outlinePath(outline, x, y)} fill={tokens.accent} fillOpacity={0.22} stroke={tokens.accent} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {small ? <circle cx={x((west + east) / 2)} cy={y((south + north) / 2)} r={5} fill="none" stroke={tokens.accent} strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
    );
}

const STEPS = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 45, 90];

// The outline up close, longitude stretched by the cosine of the middle latitude so the shape reads
// as it would on the ground, with a graticule and the four corners.
function CloseUp({ tokens, outline, corners }) {
    const [minLon, minLat, maxLon, maxLat] = extentOf(outline);
    const padLon = (maxLon - minLon) * 0.14 || 0.01;
    const padLat = (maxLat - minLat) * 0.14 || 0.01;
    const west = minLon - padLon;
    const east = maxLon + padLon;
    const south = minLat - padLat;
    const north = maxLat + padLat;
    const stretch = Math.max(0.05, Math.cos((((south + north) / 2) * Math.PI) / 180));
    const width = (east - west) * stretch;
    const height = north - south;
    const x = (lon) => (lon - west) * stretch;
    const y = (lat) => north - lat;
    const step = STEPS.find((candidate) => Math.max(east - west, north - south) / candidate <= 5) ?? 90;
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    const lines = (from, to) => {
        const values = [];
        for (let count = Math.ceil(from / step); count * step <= to; count += 1) values.push(Number((count * step).toFixed(decimals + 2)));
        return values;
    };
    const size = Math.max(width, height);
    const font = size * 0.024;
    return (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="The file's outline close up, with its corners" style={{ display: 'block', width: '100%', maxHeight: 300, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 10 }}>
            {lines(west, east).filter((lon) => x(lon) < width - font * 3.5).map((lon) => (
                <g key={`m${lon}`}>
                    <line x1={x(lon)} y1={0} x2={x(lon)} y2={height} stroke={tokens.border} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                    <text x={x(lon) + font * 0.3} y={height - font * 0.4} fontSize={font} fill={tokens.textMuted} fontFamily={tokens.mono}>{`${lon.toFixed(decimals)}°`}</text>
                </g>
            ))}
            {lines(south, north).filter((lat) => y(lat) > font * 1.5).map((lat) => (
                <g key={`p${lat}`}>
                    <line x1={0} y1={y(lat)} x2={width} y2={y(lat)} stroke={tokens.border} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                    <text x={font * 0.3} y={y(lat) - font * 0.3} fontSize={font} fill={tokens.textMuted} fontFamily={tokens.mono}>{`${lat.toFixed(decimals)}°`}</text>
                </g>
            ))}
            <path d={outlinePath(outline, x, y)} fill={tokens.accent} fillOpacity={0.18} stroke={tokens.accent} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {corners.slice(0, 4).map((corner) => (
                <g key={corner.name}>
                    <circle cx={x(corner.lonLat[0])} cy={y(corner.lonLat[1])} r={size * 0.012} fill={tokens.accent} />
                    <text
                        x={x(corner.lonLat[0]) + (corner.name.endsWith('left') ? font * 0.5 : -font * 0.5)}
                        y={y(corner.lonLat[1]) + (corner.name.startsWith('upper') ? font * 1.2 : -font * 0.6)}
                        textAnchor={corner.name.endsWith('left') ? 'start' : 'end'}
                        fontSize={font}
                        fill={tokens.text}
                        fontFamily={tokens.sans}
                    >
                        {corner.name}
                    </text>
                </g>
            ))}
        </svg>
    );
}

const unitOf = (info) => (info.model === 'geographic' ? '°' : info.unit?.[1] === 'metre' ? ' m' : ` ${info.unit?.[1] ?? ''}`);

const SAMPLES = [
    ['istanbul', 'Istanbul, UTM zone 35N'], ['london', 'London, British National Grid'], ['conus', 'Contiguous US, Albers'], ['world', 'The world, WGS 84'],
];

const INSPECTOR_WRAPPER = `// src/support/geotiff_app.h (excerpt)
Tiff tif = openTiff(path, "r");          // XTIFFOpen: libtiff with the GeoTIFF tags
Keys keys = openKeys(tif.get());         // GTIFNewEx reads the GeoKeys
GTIFDefn defn;
const bool defined = GTIFGetDefn(keys.get(), &defn) != 0;   // EPSG code -> full definition
GTIFGetPCSInfo(defn.PCS, &name, nullptr, nullptr, nullptr); // its name, from proj.db

double x = columns[i];                   // a corner, in pixels
double y = rows[i];
if (!GTIFImageToPCS(keys, &x, &y)) return "null";           // to map coordinates
return GTIFProj4ToLatLong(&defn, count, x, y) != 0;          // to degrees, on the file's datum

GTIFPrint(keys, appendText, &text);      // the report listgeo prints
GTIFPrintDefnEx(keys, defn, stream);`;

const INSPECTOR_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));   // from <input type=file>
const info = JSON.parse(await m.GeoTiffInspector.inspect(path));

// For the Istanbul sample:
// info.epsg: 32635, info.name: 'WGS 84 / UTM zone 35N'
// info.corners[0].lonLat: [28.198970, 41.545594], the upper-left corner in degrees
// info.outline: 64 points around the footprint; info.listgeo: listgeo's report`;

export function GeoTiffInspectorApp({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [chosen, setChosen] = useState(null);
    const inspect = async (m, path, name, bytes) => ({ name, bytes, info: JSON.parse(await m.GeoTiffInspector.inspect(path)) });
    const openSample = (id) => {
        setChosen(id);
        run(async (m) => {
            const path = `${await m.getRandomPath('/memfs')}/${id}.tif`;
            const bytes = await m.GeoTiffInspector.writeSample(id, path);
            return inspect(m, path, `${id}.tif`, bytes);
        });
    };
    const openFile = (file) => {
        setChosen(null);
        run(async (m) => {
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return inspect(m, path, file.name, file.size);
        });
    };
    const done = state.status === 'ready' ? state.result : null;
    const info = done?.info;
    const placed = info?.georeferenced && info.corners?.every((corner) => corner.lonLat) && info.outline;
    return (
        <AppCard
            tokens={tokens}
            id="geotiff-inspector"
            index={index}
            status={state.status}
            title="Where is this GeoTIFF?"
            pitch="Drop a satellite scene, an elevation tile or a drone map and see its coordinate system by name, its corners in degrees and its footprint on the map, with listgeo's full report. geotiff.js, the most used JavaScript GeoTIFF reader, returns the raw GeoKeys; libgeotiff names the system they describe through PROJ's EPSG database."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div>
                        <Label tokens={tokens}>SAMPLES</Label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {SAMPLES.map(([id, label]) => <SecondaryButton key={id} tokens={tokens} pressed={chosen === id} run onClick={() => openSample(id)}>{label}</SecondaryButton>)}
                        </div>
                    </div>
                    <div>
                        <FileButton tokens={tokens} accept=".tif,.tiff,image/tiff" onFile={openFile}>Open your own GeoTIFF</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        The samples are written by the module: blank pixels, real placements. Your own file stays in this tab: it is mounted into the module's in-memory filesystem, and libtiff reads its directories and tags, not its pixels. Degrees are on the file's own datum, OSGB36 for the London sample. For drawing GeoTIFF pixels on a web map, geotiff.js is the lighter choice.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : info ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, overflowWrap: 'anywhere' }}>
                            {`${done.name} · ${grouped(done.bytes)} B · ${info.file.width} × ${info.file.height} px · ${info.file.bands} × ${info.file.bits}-bit ${info.file.format} · ${info.file.compression}${info.file.directories > 1 ? ` · ${info.file.directories} directories` : ''}`}
                        </div>
                        {info.keys === 0 ? (
                            <Placeholder tokens={tokens}>This TIFF has no GeoKeys, so nothing in it says where it is.</Placeholder>
                        ) : (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
                                    <Stat tokens={tokens} size={22} accent value={info.epsg ? `EPSG:${info.epsg}` : 'no EPSG code'} label={info.name ?? 'no coordinate system'} />
                                    <Stat tokens={tokens} size={22} value={info.model ?? '–'} label={info.model === 'projected' ? `${info.projection?.[1]} · ${info.method?.replace(/^CT_/, '')}` : `datum ${info.datum?.[1] ?? '–'}`} />
                                    <Stat tokens={tokens} size={22} value={info.pixelSize ? `${short(info.pixelSize[0])}${unitOf(info)}` : '–'} label={info.transform ? `pixel size, from the ${info.transform}` : 'nothing places the pixels'} />
                                </div>
                                {placed ? (
                                    <>
                                        <WorldMap tokens={tokens} outline={info.outline} />
                                        <CloseUp tokens={tokens} outline={info.outline} corners={info.corners} />
                                    </>
                                ) : (
                                    <Placeholder tokens={tokens}>{info.transform ? `This file is placed by ${info.transform}, which GTIFImageToPCS does not turn into corners.` : 'This file has GeoKeys but no tiepoint, pixel scale or matrix to place its pixels.'}</Placeholder>
                                )}
                                {info.corners ? (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
                                            <thead>
                                                <tr style={{ color: tokens.textMuted, textAlign: 'left' }}>
                                                    {['CORNER', 'MAP X, Y', 'LONGITUDE, LATITUDE'].map((head) => <th key={head} style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1, fontWeight: 500, padding: '0 10px 6px 0' }}>{head}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {info.corners.map((corner) => (
                                                    <tr key={corner.name} style={{ borderTop: `1px solid ${tokens.border}` }}>
                                                        <td style={{ padding: '6px 10px 6px 0', color: tokens.textDim, whiteSpace: 'nowrap' }}>{corner.name}</td>
                                                        <td style={{ padding: '6px 10px 6px 0', fontFamily: tokens.mono, color: tokens.text, whiteSpace: 'nowrap' }}>{corner.map.map((value) => short(value)).join(', ')}</td>
                                                        <td style={{ padding: '6px 0', fontFamily: tokens.mono, color: tokens.accentText, whiteSpace: 'nowrap' }}>{corner.lonLat ? `${degrees(corner.lonLat[0])}, ${degrees(corner.lonLat[1])}` : '–'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : null}
                                {info.datum ? (
                                    <Meta tokens={tokens}>
                                        {`datum ${info.datum[0]} ${info.datum[1]} · ellipsoid ${info.ellipsoid[1]}, ${grouped(Math.round(info.axes[0] * 1000) / 1000)} × ${grouped(Math.round(info.axes[1] * 1000) / 1000)} m · unit ${info.unit[1]}`}
                                        {info.parameters?.length ? <div>{info.parameters.map(([name, value]) => `${name.replace(/GeoKey$/, '')} ${short(value)}`).join(' · ')}</div> : null}
                                        <div>{info.proj}</div>
                                    </Meta>
                                ) : null}
                                <details>
                                    <summary className="tap-target" style={{ cursor: 'pointer', fontFamily: tokens.mono, fontSize: 11.5, letterSpacing: 0.8, color: tokens.accentText }}>LISTGEO REPORT</summary>
                                    <pre style={{ margin: '10px 0 0', maxHeight: 280, overflow: 'auto', fontFamily: tokens.mono, fontSize: 11.5, lineHeight: 1.5, color: tokens.codeText, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '10px 12px' }}>
                                        {info.listgeo}
                                    </pre>
                                </details>
                            </>
                        )}
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open a sample or a GeoTIFF of your own to see where it is.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/geotiff_app.h', code: INSPECTOR_WRAPPER },
                { file: 'main.js', code: INSPECTOR_USAGE },
            ]}
        />
    );
}
GeoTiffInspectorApp.appId = 'geotiff-inspector';

// The georeferencer's sample: fields, a river and noise, from integer arithmetic only, so every
// JavaScript engine makes the same bytes. landing/demos/lib-geotiff/index.html checks this picture.
const SAMPLE_SIZE = [384, 256];
function samplePicture(width, height) {
    let seed = 20260924;
    const random = () => (seed = (seed * 48271) % 2147483647) % 19;
    const fields = [[112, 140, 74], [150, 160, 90], [186, 170, 120], [96, 120, 70], [134, 150, 84]];
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const bend = Math.abs((x % 160) - 80) / 2;
            const river = Math.abs(y - height / 3 - bend) < 5;
            const [r, g, b] = river ? [74, 112, 150] : fields[(Math.floor(x / 48) * 7 + Math.floor(y / 40) * 3) % fields.length];
            const shade = random() - 9;
            rgba.set([r + shade, g + shade, b + shade, 255], (y * width + x) * 4);
        }
    }
    return rgba;
}

const MAX_SIDE = 4096;

async function decodePicture(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return { name: file.name, width, height, rgba: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer), scaled: scale < 1 };
}

const BOXES = [
    { id: 'istanbul', label: 'Istanbul', box: ['28.6', '40.8', '29.4', '41.3'] },
    { id: 'london', label: 'London', box: ['-0.51', '51.28', '0.33', '51.69'] },
    { id: 'world', label: 'The world', box: ['-180', '-90', '180', '90'] },
];

const COMPRESSIONS = [['deflate', 'Deflate'], ['zstd', 'ZSTD'], ['lzw', 'LZW'], ['jpeg', 'JPEG, quality 85'], ['none', 'none']];

function placement(mode, box, projected, width, height) {
    const numbers = (values) => values.map((value) => (String(value).trim() === '' ? NaN : Number(value)));
    if (mode === 'box') {
        const [west, south, east, north] = numbers(box);
        if (![west, south, east, north].every(Number.isFinite)) throw new Error('west, south, east and north must be numbers');
        if (!(west < east && south < north)) throw new Error('west must be less than east, and south less than north');
        if (west < -180 || east > 180 || south < -90 || north > 90) throw new Error('the box must lie within -180 to 180 and -90 to 90 degrees');
        return { epsg: 4326, x: west, y: north, pixelWidth: (east - west) / width, pixelHeight: (north - south) / height };
    }
    const [epsg, x, y, pixel] = numbers(projected);
    if (!Number.isInteger(epsg)) throw new Error('the EPSG code must be a whole number');
    if (![x, y, pixel].every(Number.isFinite) || pixel <= 0) throw new Error('the corner must be numbers and the pixel size above zero');
    return { epsg, x, y, pixelWidth: pixel, pixelHeight: pixel };
}

const GEOREF_WRAPPER = `// src/support/geotiff_app.h (excerpt)
bool projected = GTIFGetPCSInfo(epsg, &name, nullptr, nullptr, nullptr) != 0;   // or GTIFGetGCSInfo
TIFFSetField(tif.get(), TIFFTAG_COMPRESSION, codec);
const double tiepoint[6] = {0, 0, 0, originX, originY, 0};
const double scale[3] = {pixelWidth, pixelHeight, 0};
TIFFSetField(tif.get(), TIFFTAG_GEOTIEPOINTS, 6, tiepoint);
TIFFSetField(tif.get(), TIFFTAG_GEOPIXELSCALE, 3, scale);

GTIFKeySet(keys.get(), GTModelTypeGeoKey, TYPE_SHORT, 1, projected ? ModelTypeProjected : ModelTypeGeographic);
GTIFKeySet(keys.get(), GTRasterTypeGeoKey, TYPE_SHORT, 1, RasterPixelIsArea);
GTIFKeySet(keys.get(), ProjectedCSTypeGeoKey, TYPE_SHORT, 1, epsg);   // GeographicTypeGeoKey for 4326
if (!GTIFWriteKeys(keys.get())) fail("libgeotiff could not write the GeoKeys");`;

const GEOREF_USAGE = `const m = await initNative();
const dir = await m.getRandomPath('/memfs');
await m.FS.writeFile(\`\${dir}/picture.rgba\`, rgba);   // RGBA pixels, as a canvas gives them
const [west, south, east, north] = [28.6, 40.8, 29.4, 41.3];
const written = JSON.parse(await m.Georeferencer.write(
    \`\${dir}/picture.rgba\`, width, height, 4326, west, north,
    (east - west) / width, (north - south) / height, 'deflate', 85, \`\${dir}/picture.tif\`));
// written.bytes: 101434 for the 384 x 256 sample, 295368 uncompressed
const tif = await m.getFileBytes(\`\${dir}/picture.tif\`);`;

export function GeoreferencerApp({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [picture, setPicture] = useState(null);
    const [problem, setProblem] = useState(null);
    const [mode, setMode] = useState('box');
    const [boxId, setBoxId] = useState(BOXES[0].id);
    const [box, setBox] = useState(BOXES[0].box);
    const [projected, setProjected] = useState(['32635', '650000', '4560000', '100']);
    const pickBox = (id) => {
        setBoxId(id);
        setBox(BOXES.find((item) => item.id === id).box);
    };
    const choose = (file) => {
        setProblem(null);
        decodePicture(file).then(setPicture, (error) => setProblem(`The browser could not decode ${file.name}: ${error?.message ?? error}`));
    };
    const start = () =>
        run(async (m) => {
            const source = picture ?? { name: 'sample.png', width: SAMPLE_SIZE[0], height: SAMPLE_SIZE[1], rgba: samplePicture(...SAMPLE_SIZE) };
            const place = placement(mode, box, projected, source.width, source.height);
            const dir = await m.getRandomPath('/memfs');
            await m.FS.writeFile(`${dir}/picture.rgba`, source.rgba);
            const base = source.name.replace(/\.[^.]+$/, '') || 'picture';
            const files = [];
            for (const [id, label] of COMPRESSIONS) {
                const path = `${dir}/${base}-${id}.tif`;
                const written = JSON.parse(await m.Georeferencer.write(`${dir}/picture.rgba`, source.width, source.height, place.epsg, place.x, place.y, place.pixelWidth, place.pixelHeight, id, 85, path));
                files.push({ ...written, label, path, name: `${base}-${id}.tif`, note: `${grouped(written.bytes)} B` });
            }
            return { files, back: JSON.parse(await m.GeoTiffInspector.inspect(files[0].path)) };
        });
    const done = state.status === 'ready' ? state.result : null;
    return (
        <AppCard
            tokens={tokens}
            id="geotiff-georeferencer"
            index={index}
            status={state.status}
            title="Georeference any picture"
            pitch="Give a scanned map, a screenshot or a render its place on Earth: a longitude and latitude box, or a corner and a pixel size in any projected EPSG system. The module writes it as a GeoTIFF in five compressions that GDAL places where you said, and reads it back with libgeotiff to show it. geotiff.js's writer stores pixels uncompressed."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div>
                        <Label tokens={tokens}>PICTURE</Label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            <SecondaryButton tokens={tokens} pressed={!picture} onClick={() => setPicture(null)}>The sample, 384 × 256</SecondaryButton>
                            <FileButton tokens={tokens} accept="image/*" onFile={choose}>
                                {picture ? `${picture.name}, ${picture.width} × ${picture.height}` : 'Choose a picture'}
                            </FileButton>
                        </div>
                        {picture?.scaled ? <Meta tokens={tokens}>{`Scaled to ${picture.width} × ${picture.height}, at most ${MAX_SIDE} pixels a side.`}</Meta> : null}
                        {problem ? <Failure tokens={tokens} message={problem} /> : null}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <SecondaryButton tokens={tokens} pressed={mode === 'box'} onClick={() => setMode('box')}>Longitude, latitude box</SecondaryButton>
                        <SecondaryButton tokens={tokens} pressed={mode === 'projected'} onClick={() => setMode('projected')}>Projected, by EPSG code</SecondaryButton>
                    </div>
                    {mode === 'box' ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {BOXES.map((item) => (
                                <SecondaryButton key={item.id} tokens={tokens} pressed={boxId === item.id} onClick={() => pickBox(item.id)}>
                                    {item.label}
                                </SecondaryButton>
                            ))}
                        </div>
                    ) : null}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                        {(mode === 'box' ? ['WEST, DEGREES', 'SOUTH, DEGREES', 'EAST, DEGREES', 'NORTH, DEGREES'] : ['EPSG CODE', 'UPPER-LEFT X', 'UPPER-LEFT Y', 'PIXEL SIZE']).map((label, position) => {
                            const [values, update] = mode === 'box' ? [box, setBox] : [projected, setProjected];
                            return <NumberField key={label} tokens={tokens} label={label} value={values[position]} onChange={(value) => update(values.map((current, at) => (at === position ? value : current)))} />;
                        })}
                    </div>
                    <Hint tokens={tokens}>
                        {mode === 'box'
                            ? "Written as EPSG:4326, WGS 84 longitude and latitude. The box is the picture's outer edge: GTRasterTypeGeoKey says each pixel covers an area."
                            : "The corner and the pixel size are in the system's own unit, metres for most projected systems. EPSG:32635 is UTM zone 35N, which covers Istanbul."}
                    </Hint>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Write the GeoTIFFs</RunButton>
                    </div>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <Stat tokens={tokens} size={22} accent value={`EPSG:${done.back.epsg} ${done.back.name}`} label={`${done.back.file.width} × ${done.back.file.height} pixels, ${done.files[0].bands === 4 ? 'RGB and alpha' : 'RGB'}, read back from the Deflate file`} />
                        <FileRows tokens={tokens} rows={done.files} largest={Math.max(...done.files.map((file) => file.bytes))} onSave={(file) => saveFile(load, file)} />
                        {done.back.outline ? <WorldMap tokens={tokens} outline={done.back.outline} /> : null}
                        <Meta tokens={tokens}>
                            {`${done.back.corners.slice(0, 4).map((corner) => `${corner.name} ${degrees(corner.lonLat?.[0])}, ${degrees(corner.lonLat?.[1])}`).join(' · ')}. JPEG is lossy; the others keep every pixel.`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>{picture ? `${picture.name}, ${picture.width} × ${picture.height}: choose where it goes, then write the GeoTIFFs.` : 'Choose a picture, or keep the sample, then write the GeoTIFFs.'}</Placeholder>
                )
            }
            code={[
                { file: 'src/support/geotiff_app.h', code: GEOREF_WRAPPER },
                { file: 'main.js', code: GEOREF_USAGE },
            ]}
        />
    );
}
GeoreferencerApp.appId = 'geotiff-georeferencer';

const GRID_SIDE = 512;

// Relief shading, sun in the northwest 45 degrees up, blended with height so valleys read darker.
// A neighbour without a value counts as the centre; cells without a value stay clear.
function relief(heights, width, height, cellX, cellY, low, high) {
    const out = new Uint8ClampedArray(width * height * 4);
    const zenith = Math.PI / 4;
    const azimuth = (135 * Math.PI) / 180;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const centre = heights[y * width + x];
            if (Number.isNaN(centre)) continue;
            const at = (dx, dy) => {
                const value = heights[Math.min(height - 1, Math.max(0, y + dy)) * width + Math.min(width - 1, Math.max(0, x + dx))];
                return Number.isNaN(value) ? centre : value;
            };
            const dzdx = (at(1, -1) + 2 * at(1, 0) + at(1, 1) - (at(-1, -1) + 2 * at(-1, 0) + at(-1, 1))) / (8 * cellX);
            const dzdy = (at(-1, 1) + 2 * at(0, 1) + at(1, 1) - (at(-1, -1) + 2 * at(0, -1) + at(1, -1))) / (8 * cellY);
            const slope = Math.atan(Math.hypot(dzdx, dzdy));
            const aspect = Math.atan2(dzdy, -dzdx);
            const shade = Math.max(0, Math.cos(zenith) * Math.cos(slope) + Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect));
            const level = high > low ? (centre - low) / (high - low) : 0.5;
            const k = (y * width + x) * 4;
            out[k] = out[k + 1] = out[k + 2] = 30 + 150 * shade + 60 * level;
            out[k + 3] = 255;
        }
    }
    return out;
}

// Metres per grid cell, for the shading: a projected unit converted to metres, or degrees measured
// at the middle latitude.
function cellMetres(info) {
    const [x, y] = info.pixelSize ?? [1, 1];
    const [factorX, factorY] = info.factor;
    if (info.model === 'projected') return [x * factorX * (info.metres ?? 1), y * factorY * (info.metres ?? 1)];
    return [x * factorX * 111320 * Math.cos((info.middleLatitude * Math.PI) / 180), y * factorY * 110574];
}

const DEM_CODECS = [
    ['deflate', 0, 'Deflate, float predictor'], ['zstd', 0, 'ZSTD, float predictor'],
    ['lerc', 0.01, 'LERC, within 1 cm'], ['lerc', 0.1, 'LERC, within 10 cm'], ['lerc', 1, 'LERC, within 1 m'],
];

const DEM_WRAPPER = `// src/support/dem_file.h (excerpt)
// The smallest overview that still fills the grid, then band 1 block by block
TIFFGetField(tif.get(), TIFFTAG_SUBFILETYPE, &type);
if (!(type & FILETYPE_REDUCEDIMAGE) || (type & FILETYPE_MASK)) continue;
TIFFReadEncodedTile(tif, TIFFComputeTile(tif, left, top, 0, 0), buffer.data(), size);

// The position under the cursor, in full-resolution pixels, to degrees
if (!GTIFImageToPCS(keys.get(), &x, &y)) throw std::runtime_error("no tiepoint and pixel scale to place the pixels");
const bool degrees = toLonLat(defn, 1, &lon, &lat);

// Saved again as a float GeoTIFF in 256 x 256 tiles
TIFFSetField(tif.get(), TIFFTAG_COMPRESSION, codec.compression);
if (codec.compression == COMPRESSION_LERC) TIFFSetField(tif.get(), TIFFTAG_LERC_MAXZERROR, codec.maxZError);`;

const DEM_USAGE = `const m = await initNative();
const dir = await m.getRandomPath('/memfs');
await m.DemProbe.writeSample(\`\${dir}/dem.tif\`);          // or a DEM mounted with autoMountFiles
const probe = await new m.DemProbe(\`\${dir}/dem.tif\`, 512);
const info = JSON.parse(await probe.info());      // size, type, range, no-data value, EPSG
await probe.writeGrid(\`\${dir}/grid.f32\`);         // at most 512 x 512 heights, row by row
const heights = new Float32Array((await m.getFileBytes(\`\${dir}/grid.f32\`)).slice().buffer);
const spot = JSON.parse(await probe.at(100.5, 200.5));   // the centre of pixel 100, 200
// spot.lonLat: [13.854264880, 47.073645579]; heights[200 * 512 + 100]: 734.90625
const saved = JSON.parse(await probe.encode('lerc', 0.1, \`\${dir}/dem-lerc.tif\`));
// saved.bytes: 283298 of 1048576 raw; saved.maxError: 0.100006103515625`;

export function ElevationProbe({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [saved, runSave] = useNativeTask(load);
    const [hover, setHover] = useState(null);
    const probe = useRef(null);
    const asking = useRef(false);
    const open = async (m, path, name, bytes) => {
        const instance = await new m.DemProbe(path, GRID_SIDE);
        const info = JSON.parse(await instance.info());
        if (!info.valid) throw new Error('band 1 holds no values');
        const middle = info.georeferenced ? JSON.parse(await instance.at(info.width / 2, info.height / 2)).lonLat : null;
        const gridPath = `${await m.getRandomPath('/memfs')}/grid.f32`;
        await instance.writeGrid(gridPath);
        const heights = new Float32Array((await m.getFileBytes(gridPath)).slice().buffer);
        probe.current = instance;
        setHover(null);
        return { name, bytes, info: { ...info, middleLatitude: middle?.[1] ?? 0 }, heights };
    };
    const openSample = () =>
        run(async (m) => {
            const path = `${await m.getRandomPath('/memfs')}/dem.tif`;
            const bytes = await m.DemProbe.writeSample(path);
            return open(m, path, 'synthetic-dem.tif', bytes);
        });
    const openFile = (file) =>
        run(async (m) => {
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return open(m, path, file.name, file.size);
        });
    const done = state.status === 'ready' ? state.result : null;
    const info = done?.info;
    const pixels = useMemo(() => {
        if (!done) return null;
        const [cellX, cellY] = cellMetres(done.info);
        return relief(done.heights, done.info.gridWidth, done.info.gridHeight, cellX, cellY, done.info.min, done.info.max);
    }, [done]);
    const onPointerMove = (event) => {
        if (!info) return;
        const box = event.currentTarget.getBoundingClientRect();
        const column = Math.min(info.gridWidth - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * info.gridWidth)));
        const row = Math.min(info.gridHeight - 1, Math.max(0, Math.floor(((event.clientY - box.top) / box.height) * info.gridHeight)));
        const height = done.heights[row * info.gridWidth + column];
        const pixel = [(column + 0.5) * info.factor[0], (row + 0.5) * info.factor[1]];
        setHover((current) => ({ column, row, height, pixel, place: current?.column === column && current?.row === row ? current.place : null }));
        if (asking.current || !probe.current || !info.georeferenced) return;
        asking.current = true;
        const answer = (place) => setHover((current) => (current && current.column === column && current.row === row ? { ...current, place } : current));
        probe.current
            .at(pixel[0], pixel[1])
            .then((text) => answer(JSON.parse(text)), (error) => answer({ error: error?.message ?? String(error) }))
            .finally(() => {
                asking.current = false;
            });
    };
    const saveAgain = () =>
        runSave(async (m) => {
            const dir = await m.getRandomPath('/memfs');
            const results = [];
            for (const [codec, budget, label] of DEM_CODECS) {
                const path = `${dir}/dem-${codec}-${budget}.tif`;
                const result = JSON.parse(await probe.current.encode(codec, budget, path));
                const name = `${done.name.replace(/\.[^.]+$/, '')}-${codec}${budget ? `-${budget}` : ''}.tif`;
                results.push({ ...result, label, path, name, note: `${grouped(result.bytes)} B · ${result.maxError === 0 ? 'exact' : `max ${Number(result.maxError.toPrecision(5))}`}` });
            }
            return { results, source: done };
        });
    const savedFor = saved.status === 'ready' && saved.result.source === done ? saved.result : null;
    return (
        <AppCard
            tokens={tokens}
            id="geotiff-elevation"
            index={index}
            status={state.status}
            title="Read heights and degrees off an elevation model"
            pitch="Open an elevation GeoTIFF and move over its relief: libgeotiff turns the position under the cursor into longitude and latitude, next to the height stored there. Then save the model again, losslessly or with LERC within an error you choose, and compare the sizes. A cloud-optimized file is read from the smallest overview that still fills the view."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={openSample}>Open the sample</RunButton>
                        <FileButton tokens={tokens} accept=".tif,.tiff,image/tiff" onFile={openFile}>Open your own DEM</FileButton>
                    </div>
                    <Hint tokens={tokens}>
                        The sample is written by the module: generated heights on 512 × 512 cells of 30 m, placed in UTM zone 33N. Your own file stays in this tab. Band 1 is read, integers or floats, and GDAL's no-data value is left out. A file larger than 512 pixels a side is sampled to fit, nearest pixel, and the heights shown are those samples.
                    </Hint>
                    {done ? (
                        <div>
                            <RunButton tokens={tokens} busy={saved.status === 'running'} onClick={saveAgain}>Save it again five ways</RunButton>
                        </div>
                    ) : null}
                    {saved.status === 'failed' ? <Failure tokens={tokens} message={saved.message} /> : null}
                    {savedFor ? (
                        <div style={{ display: 'grid', gap: 9 }}>
                            <FileRows tokens={tokens} rows={savedFor.results} largest={savedFor.results[0].raw} onSave={(file) => saveFile(load, file)} />
                            <Meta tokens={tokens}>
                                {`Each bar runs to ${grouped(savedFor.results[0].raw)} B, the grid as raw float32. Every file was read back and compared height by height; LERC's largest change can pass its budget by float32 rounding. LERC files open only in readers whose libtiff has the LERC codec.`}
                            </Meta>
                        </div>
                    ) : null}
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 14 }}>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, overflowWrap: 'anywhere' }}>
                            {`${done.name} · ${grouped(done.bytes)} B · ${info.width} × ${info.height} · ${info.bits}-bit ${info.format} · ${info.compression}`}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
                            <Stat tokens={tokens} size={22} accent value={`${short(info.min.toFixed(1))} to ${short(info.max.toFixed(1))}`} label="heights, in the file's units" />
                            <Stat tokens={tokens} size={22} value={info.epsg ? `EPSG:${info.epsg}` : '–'} label={info.name ?? 'no coordinate system'} />
                        </div>
                        <Picture tokens={tokens} pixels={pixels} width={info.gridWidth} height={info.gridHeight} label={`Shaded relief of ${done.name}`} onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)}
                            marker={hover ? [(hover.column + 0.5) / info.gridWidth, (hover.row + 0.5) / info.gridHeight] : null} />
                        <div style={{ minHeight: 44, fontFamily: tokens.mono, fontSize: 12.5, lineHeight: 1.7, color: tokens.text }}>
                            {hover ? (
                                <>
                                    <div>
                                        <span style={{ color: tokens.accentText }}>{Number.isNaN(hover.height) ? 'no value' : `height ${short(hover.height.toFixed(2))}`}</span>
                                        {` at pixel ${Math.floor(hover.pixel[0])}, ${Math.floor(hover.pixel[1])}`}
                                    </div>
                                    <div style={{ color: tokens.textDim }}>
                                        {hover.place?.lonLat ? `lon ${hover.place.lonLat[0].toFixed(6)}, lat ${hover.place.lonLat[1].toFixed(6)} · map ${hover.place.map.map((value) => short(value.toFixed(3))).join(', ')}` : hover.place?.error ?? (info.georeferenced ? 'asking libgeotiff…' : 'no coordinate system to place it')}
                                    </div>
                                </>
                            ) : (
                                <div style={{ color: tokens.textMuted }}>Move over the relief to read a height and where it is.</div>
                            )}
                        </div>
                        <Meta tokens={tokens}>
                            {`${info.gridWidth} × ${info.gridHeight} grid${info.directory ? `, from overview ${info.directory} of ${info.directories - 1}` : ''}${info.factor[0] > 1 ? `, one sample per ${short(info.factor[0].toFixed(2))} pixels` : ''} · ${grouped(info.valid)} values${info.noData !== null ? ` · no-data ${short(info.noData)}` : ''}`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open the sample, or an elevation GeoTIFF of your own, then move over it.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/dem_file.h', code: DEM_WRAPPER },
                { file: 'main.js', code: DEM_USAGE },
            ]}
        />
    );
}
ElevationProbe.appId = 'geotiff-elevation';

export const GEOTIFF_APPS = [GeoTiffInspectorApp, GeoreferencerApp, ElevationProbe];

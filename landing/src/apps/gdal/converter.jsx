import { useState } from 'react';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from '../AppCard.jsx';
import { download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Select } from '../controls.jsx';
import { freshFolder, LicenceNote, plainly, size } from './shared.jsx';

const PREVIEW_LIMIT = 2000;

const OUTPUT_EXTENSIONS = { GeoJSON: 'geojson', GeoJSONSeq: 'geojsonl', 'ESRI Shapefile': 'shp', 'MapInfo File': 'tab', JSONFG: 'json' };
const WGS84_ONLY = ['GPX', 'KML'];
// MVT writes a folder of tiles, which PMTiles holds in one file, so it is only read here.
const writable = (format) => format.write && format.name !== 'MVT';
// DXF reports several layers but holds one layer of entities.
const multiLayer = (format) => format.layers && format.name !== 'DXF';
const extensionOf = (format) => OUTPUT_EXTENSIONS[format.name] ?? format.extensions.split(' ')[0];

// The ogr2ogr options per format, as VectorStudio.convert takes them (layer names follow them).
function conversionOptions(format, { crs, where }) {
    const options = ['-f', format];
    if (WGS84_ONLY.includes(format)) options.push('-t_srs', 'EPSG:4326');
    else if (crs) options.push('-t_srs', crs);
    if (where) options.push('-where', where);
    if (format === 'GPX') options.push('-dsco', 'GPX_USE_EXTENSIONS=YES');
    if (format === 'CSV') options.push('-lco', 'GEOMETRY=AS_WKT');
    if (format === 'DXF') options.push('-select', '');
    return options;
}
const shellQuote = (arg) => (arg === '' || /[\s'"<>|&;*?()]/.test(arg) ? `'${arg.replaceAll("'", "'\\''")}'` : arg);
const commandLine = (options, layers, input, output) => ['ogr2ogr', ...options, output, input, ...layers].map(shellQuote).join(' ');

const CRS_CHOICES = [
    ['keep', 'Keep the source CRS'],
    ['EPSG:4326', 'WGS 84, longitude and latitude'],
    ['EPSG:3857', 'Web Mercator, as web maps use'],
    ['utm', 'UTM zone of the data'],
    ['custom', 'Another CRS'],
];

const crsLabel = (layer) => {
    const system = layer.geometryFields?.[0]?.coordinateSystem;
    if (!system) return 'no CRS';
    const id = system.projjson?.id;
    return id ? `${id.authority}:${id.code}` : (system.projjson?.name ?? 'custom CRS');
};

function boundsOf(features) {
    let box = null;
    const visit = (coordinates) => {
        if (typeof coordinates[0] === 'number') {
            const [x, y] = coordinates;
            box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
        } else coordinates.forEach(visit);
    };
    for (const feature of features) {
        if (feature.geometry?.coordinates) visit(feature.geometry.coordinates);
        else for (const part of feature.geometry?.geometries ?? []) visit(part.coordinates);
    }
    return box;
}

function utmFor(box) {
    if (!box) throw new Error('the data has no geometry to place in a UTM zone');
    const lon = (box[0] + box[2]) / 2;
    const lat = (box[1] + box[3]) / 2;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 84) throw new Error('the data is not in longitude and latitude, so its UTM zone is unknown');
    const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
    return `EPSG:${lat >= 0 ? 32600 + zone : 32700 + zone}`;
}

function geometryParts(geometry, out = []) {
    if (!geometry) return out;
    const { type, coordinates } = geometry;
    if (type === 'GeometryCollection') geometry.geometries.forEach((part) => geometryParts(part, out));
    else if (type === 'Point') out.push({ kind: 'point', points: [coordinates] });
    else if (type === 'MultiPoint') coordinates.forEach((point) => out.push({ kind: 'point', points: [point] }));
    else if (type === 'LineString') out.push({ kind: 'line', rings: [coordinates] });
    else if (type === 'MultiLineString') out.push({ kind: 'line', rings: coordinates });
    else if (type === 'Polygon') out.push({ kind: 'polygon', rings: coordinates });
    else if (type === 'MultiPolygon') coordinates.forEach((rings) => out.push({ kind: 'polygon', rings }));
    return out;
}

// Every layer's preview drawn together. Longitude is shrunk by the cosine of the middle latitude, so
// shapes keep their proportions; data without a CRS is drawn as it is.
function VectorPreview({ tokens, layers, geographic }) {
    const features = layers.flatMap((layer) => layer.features ?? []);
    const box = boundsOf(features);
    if (!box) return <Placeholder tokens={tokens}>No geometry to draw.</Placeholder>;
    const squeeze = geographic ? Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180) : 1;
    const width = Math.max((box[2] - box[0]) * squeeze, 1e-9);
    const height = Math.max(box[3] - box[1], 1e-9);
    const span = Math.max(width, height);
    const pad = span * 0.05;
    const viewWidth = Math.max(width, span * 0.25) + 2 * pad;
    const viewHeight = Math.max(height, span * 0.25) + 2 * pad;
    const left = ((box[0] + box[2]) / 2) * squeeze - viewWidth / 2;
    const top = (box[1] + box[3]) / 2 + viewHeight / 2;
    const x = (lon) => (lon * squeeze - left).toFixed(5);
    const y = (lat) => (top - lat).toFixed(5);
    const path = (ring, close) => ring.map(([px, py], index) => `${index ? 'L' : 'M'}${x(px)} ${y(py)}`).join('') + (close ? 'Z' : '');
    const radius = (span * 0.009).toFixed(5);
    return (
        <svg
            viewBox={`0 0 ${viewWidth.toFixed(5)} ${viewHeight.toFixed(5)}`}
            role="img"
            aria-label="The layers drawn"
            style={{ display: 'block', width: '100%', maxHeight: 340, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 10 }}
        >
            {features.flatMap((feature, featureIndex) =>
                geometryParts(feature.geometry).map((part, partIndex) =>
                    part.kind === 'point' ? (
                        <circle key={`${featureIndex}-${partIndex}`} cx={x(part.points[0][0])} cy={y(part.points[0][1])} r={radius} fill={tokens.accent} />
                    ) : (
                        <path
                            key={`${featureIndex}-${partIndex}`}
                            d={part.rings.map((ring) => path(ring, part.kind === 'polygon')).join('')}
                            fill={part.kind === 'polygon' ? tokens.accent : 'none'}
                            fillOpacity={0.14}
                            fillRule="evenodd"
                            stroke={tokens.accent}
                            strokeWidth={1.4}
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                        />
                    ),
                ),
            )}
        </svg>
    );
}

function LayerTable({ tokens, layers }) {
    const cell = { padding: '6px 8px', borderBottom: `1px solid ${tokens.border}`, textAlign: 'left', fontSize: 12.5, whiteSpace: 'nowrap' };
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: tokens.mono, color: tokens.textDim }}>
                <thead>
                    <tr>
                        {['layer', 'geometry', 'features', 'CRS', 'fields'].map((head) => (
                            <th key={head} style={{ ...cell, color: tokens.textMuted, fontWeight: 500, fontSize: 11 }}>{head.toUpperCase()}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {layers.map((layer) => (
                        <tr key={layer.name}>
                            <td style={{ ...cell, color: tokens.text }}>{layer.name}</td>
                            <td style={cell}>{layer.geometryFields?.[0]?.type ?? 'none'}</td>
                            <td style={cell}>{grouped(layer.featureCount ?? 0)}</td>
                            <td style={cell}>{crsLabel(layer)}</td>
                            <td style={cell}>{layer.fields?.length ?? 0}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const CONVERTER_WRAPPER = `// src/native/vector_studio.h (excerpt): ogr2ogr with the arguments the page chose
CPLStringList args(CSLTokenizeString2(arguments.c_str(), "\\n", CSLT_ALLOWEMPTYTOKENS));
GDALVectorTranslateOptions* options = GDALVectorTranslateOptionsNew(args.List(), nullptr);
GDALDatasetH written = GDALVectorTranslate(output.c_str(), nullptr, 1, &source, options, nullptr);
GDALVectorTranslateOptionsFree(options);

// src/support/drivers.h: registered one by one, so only these drivers are linked
RegisterOGRGeoJSON(); RegisterOGRShape(); RegisterOGRGeoPackage(); RegisterOGRFlatGeobuf();
RegisterOGRKML(); RegisterOGRGPX(); RegisterOGRCSV(); RegisterOGRDXF(); RegisterOGROpenFileGDB();
RegisterOGRXLSX(); RegisterOGRODS(); RegisterOGRGML(); RegisterOGRTAB(); RegisterOGRPMTiles(); // ...`;

const CONVERTER_USAGE = `const m = await initNative();
await new m.VectorStudio();
const [mounted] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
const input = await m.VectorStudio.resolve(mounted); // looks into zips and .gdb folders
const { layers } = JSON.parse(await m.VectorStudio.inspect(input)); // ogrinfo -json

await m.FS.mkdirTree('/memfs/out');
const args = ['-f', 'GPKG', '-t_srs', 'EPSG:3857'].join('\\n');
const result = JSON.parse(await m.VectorStudio.convert(input, '/memfs/out/data.gpkg', args));
const bytes = await m.getFileBytes(result.download); // zipped when GDAL wrote several files`;

export function VectorConverterApp({ tokens, index, load }) {
    const [opened, open] = useNativeTask(load);
    const [converted, convert] = useNativeTask(load);
    const [formatName, setFormatName] = useState('GPKG');
    const [crsChoice, setCrsChoice] = useState('EPSG:3857');
    const [customCrs, setCustomCrs] = useState('EPSG:32635');
    const [where, setWhere] = useState('');
    const [layerChoice, setLayerChoice] = useState('all');
    const [dragging, setDragging] = useState(false);
    const source = opened.status === 'ready' ? opened.result : null;
    const format = source?.formats.find((entry) => entry.name === formatName);
    const layerNames = source?.info.layers.map((layer) => layer.name) ?? [];
    const allLayers = Boolean(format && multiLayer(format));
    const shownLayer = layerChoice === 'all' && !allLayers ? layerNames[0] : layerChoice;

    const inspect = async (m, name, path) => {
        const formats = JSON.parse(await m.VectorStudio.formats());
        const info = JSON.parse(await m.VectorStudio.inspect(path));
        const previews = [];
        for (const layer of info.layers.slice(0, 12)) {
            try {
                previews.push({ name: layer.name, features: JSON.parse(await m.VectorStudio.preview(path, layer.name, PREVIEW_LIMIT)).features });
            } catch {
                previews.push({ name: layer.name, features: [] });
            }
        }
        const geographic = info.layers.some((layer) => layer.geometryFields?.[0]?.coordinateSystem);
        const base = name.replace(/\.(zip|kmz)$/i, '').replace(/\.[^.]+$/, '') || 'data';
        return { name, base, path, info, previews, formats, geographic };
    };
    const afterOpen = (result) => {
        setLayerChoice(result.info.layers.length > 1 ? 'all' : (result.info.layers[0]?.name ?? 'all'));
        return result;
    };
    const openSample = () =>
        open(plainly(async (m) => {
            await new m.VectorStudio();
            const folder = await freshFolder(m, 'sample');
            const path = await m.VectorStudio.writeSample(`${folder}/sample.gpkg`);
            return afterOpen(await inspect(m, 'sample.gpkg', path));
        }));
    const openFiles = (files) =>
        open(plainly(async (m) => {
            await new m.VectorStudio();
            // /memfs keeps the files in this tab's memory; the default mount point may persist them.
            const paths = await m.autoMountFiles(files, await m.getRandomPath('/memfs'));
            const path = await m.VectorStudio.resolve(files.length === 1 ? paths[0] : paths[0].replace(/\/[^/]+$/, ''));
            const main = files.find((file) => /\.(shp|gpkg|zip)$/i.test(file.name)) ?? files[0];
            return afterOpen(await inspect(m, main.name, path));
        }));
    const start = () =>
        convert(plainly(async (m) => {
            let layers = [shownLayer];
            if (shownLayer === 'all') {
                const kept = format.name === 'GPX' ? source.info.layers.filter((layer) => !/Polygon/.test(layer.geometryFields?.[0]?.type ?? '')) : [];
                layers = kept.map((layer) => layer.name);
            }
            let crs = '';
            if (crsChoice === 'utm') crs = utmFor(boundsOf(source.previews.flatMap((layer) => layer.features)));
            else if (crsChoice === 'custom') crs = customCrs.trim();
            else if (crsChoice !== 'keep') crs = crsChoice;
            const options = conversionOptions(format.name, { crs, where: where.trim() });
            const folder = await freshFolder(m, 'converted');
            const extension = extensionOf(format);
            const output = `${folder}/${source.base}.${extension}`;
            const result = JSON.parse(await m.VectorStudio.convert(source.path, output, [...options, ...layers].join('\n')));
            const info = JSON.parse(await m.VectorStudio.inspect(output));
            const bytes = await m.getFileBytes(result.download);
            const zipped = result.files.length > 1;
            const name = zipped ? `${source.base}${format.name === 'OpenFileGDB' ? '.gdb' : `-${format.name.toLowerCase().replace(/\W+/g, '-')}`}.zip` : `${source.base}.${extension}`;
            return { source: source.path, info, bytes, name, files: result.files, command: commandLine(options, layers, source.name, name.replace(/\.zip$/, '')) };
        }));
    const done = converted.status === 'ready' && converted.result.source === source?.path ? converted.result : null;
    const registered = source ? source.formats.map((entry) => entry.name).join(', ') : '';

    return (
        <AppCard
            tokens={tokens}
            id="gdal-converter"
            index={index}
            status={opened.status}
            title="Open twenty vector formats and write seventeen, reprojected, in the page"
            pitch="Drop a Shapefile (its parts or a zip), a GeoPackage, KML, GPX, GeoJSON, FlatGeobuf, DXF, CSV, an Excel or OpenDocument sheet, MapInfo TAB, GML, PMTiles or an Esri File Geodatabase, and take it away as another of them, in another coordinate system, filtered by a SQL condition. GDAL does what its ogr2ogr tool does, on this device; the file is never uploaded."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDragging(false);
                            const files = [...(event.dataTransfer?.files ?? [])];
                            if (files.length && opened.status !== 'running') openFiles(files);
                        }}
                        style={{ border: `1px dashed ${dragging ? tokens.accent : tokens.borderStrong}`, borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}
                    >
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                            <RunButton tokens={tokens} busy={opened.status === 'running'} onClick={openSample}>Open the sample</RunButton>
                            <FileButton tokens={tokens} multiple busy={opened.status === 'running'} onFiles={openFiles}>Open your own files</FileButton>
                        </div>
                        <Hint tokens={tokens}>
                            Or drop them here. Give a Shapefile all its parts (.shp, .shx, .dbf, .prj) or a zip of them. The sample is a GeoPackage the module writes: eight Turkish cities, the lines between some of them and two regions.
                        </Hint>
                    </div>
                    {source ? (
                        <div style={{ display: 'grid', gap: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                                <Select tokens={tokens} label="WRITE AS" value={formatName} onChange={setFormatName}>
                                    {source.formats.filter(writable).map((entry) => (
                                        <option key={entry.name} value={entry.name}>{`${entry.description} (.${extensionOf(entry)})`}</option>
                                    ))}
                                </Select>
                                <Select tokens={tokens} label="COORDINATE SYSTEM" value={WGS84_ONLY.includes(formatName) ? 'EPSG:4326' : crsChoice} onChange={setCrsChoice} disabled={WGS84_ONLY.includes(formatName)}>
                                    {CRS_CHOICES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                                </Select>
                            </div>
                            {crsChoice === 'custom' && !WGS84_ONLY.includes(formatName) ? (
                                <label style={{ display: 'block' }}>
                                    <Label tokens={tokens}>CRS AS EPSG:CODE, WKT OR PROJ</Label>
                                    <input value={customCrs} onInput={(event) => setCustomCrs(event.target.value)} style={fieldStyle(tokens)} />
                                </label>
                            ) : null}
                            {layerNames.length > 1 ? (
                                <Select tokens={tokens} label="LAYERS" value={shownLayer} onChange={setLayerChoice}>
                                    {allLayers ? <option value="all">{`All ${layerNames.length} layers`}</option> : null}
                                    {layerNames.map((name) => <option key={name} value={name}>{name}</option>)}
                                </Select>
                            ) : null}
                            <label style={{ display: 'block' }}>
                                <Label tokens={tokens}>ONLY FEATURES WHERE (OPTIONAL SQL)</Label>
                                <input value={where} placeholder="plate < 20" onInput={(event) => setWhere(event.target.value)} style={fieldStyle(tokens)} />
                            </label>
                            {where.trim() && shownLayer === 'all' ? <Hint tokens={tokens}>The condition applies to every layer written, so each needs the fields it names; pick one layer otherwise.</Hint> : null}
                            <div>
                                <RunButton tokens={tokens} busy={converted.status === 'running'} onClick={start}>Convert</RunButton>
                            </div>
                            {converted.status === 'failed' ? <Failure tokens={tokens} message={converted.message} /> : null}
                            {done ? (
                                <div data-converted="" style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text }}>{`${done.name} · ${size(done.bytes.length)}${done.files.length > 1 ? ` · ${done.files.length} files zipped` : ''}`}</span>
                                        <SecondaryButton tokens={tokens} onClick={() => download(done.bytes, done.name)}>Download</SecondaryButton>
                                    </div>
                                    <LayerTable tokens={tokens} layers={done.info.layers} />
                                    <Meta tokens={tokens}>{`${done.command} · ${converted.ms} ms`}</Meta>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            }
            output={
                opened.status === 'failed' ? (
                    <Failure tokens={tokens} message={opened.message} />
                ) : source ? (
                    <div style={{ display: 'grid', gap: 14 }}>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, overflowWrap: 'anywhere' }}>{`${source.name} · ${source.info.driverLongName}`}</div>
                        <VectorPreview tokens={tokens} layers={source.previews} geographic={source.geographic} />
                        <LayerTable tokens={tokens} layers={source.info.layers} />
                        <Meta tokens={tokens}>{`Drawn in WGS 84 from GDAL's own GeoJSON output, at most ${grouped(PREVIEW_LIMIT)} features a layer. Formats this page registered: ${registered}.`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open the sample or a file of your own to see its layers, then convert it.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/vector_studio.h', code: CONVERTER_WRAPPER },
                { file: 'main.js', code: CONVERTER_USAGE },
            ]}
        />
    );
}
VectorConverterApp.appId = 'gdal-converter';

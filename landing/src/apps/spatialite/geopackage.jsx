import { useRef, useState } from 'react';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from '../AppCard.jsx';
import { download, grouped, Meta, Placeholder, SecondaryButton, Stat, Toggle } from '../controls.jsx';
import { BACKDROP, boundsOf, counted, GeoMap, LicenceNote, makeView, MAX_ROWS, once, PRESETS, Stats, withPlainErrors } from './shared.jsx';

const idText = (value) => String.fromCharCode((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
const coordinate = (value) => Math.round(value * 1e5) / 1e5;

const GEOPACKAGE_WRAPPER = `// src/native/geopackage_builder.h (excerpt)
spatial::Connection connection(path);   // a new file in /memfs
spatial::exec(db, "SELECT gpkgCreateBaseTables()");
// ...two fixes GDAL's validate_gpkg.py asks for, then one layer:
spatial::exec(db, "CREATE TABLE pins (fid INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");
// ...registered in gpkg_contents first, then
spatial::exec(db, "SELECT gpkgAddGeometryColumn('pins', 'geom', 'POINT', 0, 0, 4326)");
spatial::exec(db, "SELECT gpkgAddGeometryTriggers('pins', 'geom')");
spatial::exec(db, "SELECT gpkgAddSpatialIndex('pins', 'geom')");
// the pins arrive as JSON: [{ name, lon, lat }, ...]
"INSERT INTO pins (name, geom) SELECT json_extract(value, '$.name'), "
"gpkgMakePoint(json_extract(value, '$.lon'), json_extract(value, '$.lat'), 4326) FROM json_each(?1)"`;

const GEOPACKAGE_USAGE = `const m = await initNative();
const path = \`\${await m.getRandomPath('/memfs')}/field.gpkg\`;
const pins = [{ name: 'Meeting point', lon: 29, lat: 41 }, { name: 'Camp', lon: 32.5, lat: 39.5 }];
const report = JSON.parse(await m.GeoPackageBuilder.build(path, true, true, JSON.stringify(pins)));
// report.check: 1, CheckGeoPackageMetaData()
// report.layers: hexbins 53 polygons, pins 2 points, pois 2,000 points, all epsg:4326
const bytes = await m.getFileBytes(path);   // the .gpkg QGIS and GDAL open`;

export function GeoPackageExport({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const preview = useRef(null);
    const [withPois, setWithPois] = useState(true);
    const [withHexbins, setWithHexbins] = useState(true);
    const [pins, setPins] = useState([]);
    const [name, setName] = useState('');
    const build = () =>
        run(
            withPlainErrors(async (m) => {
                if (!preview.current) {
                    const playground = await new m.SpatialPlayground();
                    const points = JSON.parse(await playground.run(BACKDROP, MAX_ROWS)).rows;
                    const cells = JSON.parse(await playground.run(PRESETS[0].sql, MAX_ROWS)).rows.map(([, count, cell]) => ({ geometry: cell.geometry, weight: count }));
                    preview.current = { points, cells, view: makeView(boundsOf(cells.map((cell) => cell.geometry)), true) };
                }
                const path = `${await m.getRandomPath('/memfs')}/field.gpkg`;
                const started = performance.now();
                const report = JSON.parse(await m.GeoPackageBuilder.build(path, withPois, withHexbins, JSON.stringify(pins)));
                const ms = performance.now() - started;
                return { report, ms, bytes: await m.getFileBytes(path), pins };
            }),
        );
    const addPin = (lon, lat) => {
        const label = name.trim() || `Pin ${pins.length + 1}`;
        setPins([...pins, { name: label, lon: coordinate(lon), lat: coordinate(lat) }]);
        setName('');
    };
    const done = state.status === 'ready' ? state.result : null;
    const map = preview.current;
    const heaviest = map ? Math.max(...map.cells.map((cell) => cell.weight)) : 1;
    return (
        <AppCard
            tokens={tokens}
            id="spatialite-geopackage"
            index={index}
            status={state.status}
            title="A GeoPackage that QGIS and GDAL open, written in this tab"
            pitch="GeoPackage is the OGC's one-file format for vector data, which GDAL and QGIS open as it is. This writes one with SpatiaLite's gpkg functions, from the generated points, their count per hexagon and the pins you drop on the map, then opens the file again to check it. GDAL's validate_gpkg.py passes the files it writes. Nothing leaves the tab until you download."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'grid', gap: 8 }}>
                        <Label tokens={tokens}>LAYERS</Label>
                        <Toggle tokens={tokens} checked={withPois} onChange={setWithPois}>
                            pois: the 2,000 generated points
                        </Toggle>
                        <Toggle tokens={tokens} checked={withHexbins} onChange={setWithHexbins}>
                            hexbins: 53 hexagons with the number of points in each
                        </Toggle>
                        <div style={{ fontSize: 13.5, lineHeight: 1.45, color: tokens.textDim }}>{pins.length ? `pins: ${counted(pins.length, 'pin')} from the map` : 'pins: click the map to drop some'}</div>
                    </div>
                    <label style={{ display: 'block', minWidth: 0 }}>
                        <Label tokens={tokens}>NEXT PIN&apos;S NAME</Label>
                        <input value={name} placeholder={`Pin ${pins.length + 1}`} onInput={(event) => setName(event.target.value)} style={{ ...fieldStyle(tokens), fontFamily: tokens.sans, fontSize: 13.5 }} />
                    </label>
                    {pins.length ? (
                        <div style={{ display: 'grid', gap: 4 }}>
                            {pins.map((pin, at) => (
                                <div key={`${pin.name}${at}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: tokens.mono, fontSize: 11.5, color: tokens.textDim }}>
                                    <span style={{ overflowWrap: 'anywhere' }}>{`${pin.name} · ${pin.lon}, ${pin.lat}`}</span>
                                    <button type="button" onClick={() => setPins(pins.filter((_, other) => other !== at))} style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: 12 }}>
                                        remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={build}>
                            {done ? 'Build field.gpkg again' : 'Build field.gpkg'}
                        </RunButton>
                    </div>
                </div>
            }
            output={
                <div style={{ display: 'grid', gap: 14 }}>
                    {map ? (
                        <div style={{ display: 'grid', gap: 8 }}>
                            <GeoMap
                                tokens={tokens}
                                view={map.view}
                                label="The hexagons and points, with your pins; click to drop a pin"
                                onPick={addPin}
                                layers={[
                                    { features: map.cells, stroke: tokens.accent, fill: tokens.accent, width: 0.8, strokeOpacity: 0.5, fillOpacity: (cell) => 0.06 + (0.5 * cell.weight) / heaviest },
                                    { features: map.points.map(([lon, lat]) => ({ geometry: { type: 'Point', coordinates: [lon, lat] } })), stroke: tokens.textMuted, radius: 1.1, pointOpacity: 0.5 },
                                    { features: pins.map((pin) => ({ geometry: { type: 'Point', coordinates: [pin.lon, pin.lat] } })), stroke: tokens.accent, radius: 5.5 },
                                ]}
                            />
                            <Meta tokens={tokens} flush>Click the map to drop a pin, then build again.</Meta>
                        </div>
                    ) : null}
                    {state.status === 'failed' ? (
                        <Failure tokens={tokens} message={state.message} />
                    ) : done ? (
                        <div style={{ display: 'grid', gap: 14 }}>
                            <Stats>
                                <Stat tokens={tokens} size={24} accent value={`${grouped(Math.round(done.bytes.length / 1024))} KB`} label="field.gpkg" />
                                <Stat tokens={tokens} size={24} value={counted(done.report.layers.length, 'layer')} label={`${grouped(done.report.layers.reduce((sum, layer) => sum + layer.features, 0))} features`} />
                                <Stat tokens={tokens} size={24} value={once(done.ms)} label="written and reopened" />
                            </Stats>
                            <div style={{ display: 'grid', gap: 4 }}>
                                {done.report.layers.map((layer) => (
                                    <div key={layer.name} style={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.text, overflowWrap: 'anywhere' }}>
                                        {`${layer.name} · ${counted(layer.features, layer.type.toLowerCase())} · ${layer.crs.toUpperCase()} · ${layer.validGeometries === layer.features ? 'every geometry a valid GeoPackage binary' : `${layer.validGeometries} valid`}`}
                                    </div>
                                ))}
                            </div>
                            <Meta tokens={tokens} flush>
                                {`CheckGeoPackageMetaData() returned ${done.report.check}. The header says ${idText(done.report.applicationId)}: SpatiaLite 5.1.0 writes GeoPackage 1.0, which GDAL reads, and QGIS through GDAL.`}
                            </Meta>
                            <div>
                                <SecondaryButton tokens={tokens} onClick={() => download(done.bytes, 'field.gpkg', 'application/geopackage+sqlite3')}>
                                    Download field.gpkg
                                </SecondaryButton>
                            </div>
                        </div>
                    ) : map ? null : (
                        <Placeholder tokens={tokens}>Build the file to see the map, then drop pins on it and build again.</Placeholder>
                    )}
                </div>
            }
            code={[
                { file: 'src/native/geopackage_builder.h', code: GEOPACKAGE_WRAPPER },
                { file: 'main.js', code: GEOPACKAGE_USAGE },
            ]}
        />
    );
}
GeoPackageExport.appId = 'spatialite-geopackage';

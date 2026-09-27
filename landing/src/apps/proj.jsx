import { useRef, useState } from 'react';
import { REPO_URL } from '../data.js';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { FileButton, Hint, Meta, Placeholder, SecondaryButton, Select, Stat } from './controls.jsx';

// The PROJ apps on /ports/proj/. Each one drives landing/demos/lib-proj, whose index.html checks the
// same calls against cs2cs, projinfo and proj of a host PROJ reading the same proj.db, against
// pyproj and GeographicLib, and against closed-form maths.

const formatted = (value, digits = 0) => Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const heading = (azimuth) => `${(((azimuth % 360) + 360) % 360).toFixed(1)}°`;
const latitude = (value) => `${Math.abs(value).toFixed(1)}°${value < 0 ? 'S' : 'N'}`;
const longitude = (value) => `${Math.abs(value).toFixed(1)}°${value < 0 ? 'W' : 'E'}`;
const scale = (value) => `×${value.toFixed(value >= 10 ? 1 : 3)}`;
const degrees = (value) => `${formatted(value, value < 1 ? 2 : Number.isInteger(value) ? 0 : 1)}°`;
const spacingOf = ({ everyLat, everyLon }) => (everyLat === everyLon ? `one every ${degrees(everyLat)}` : `every ${degrees(everyLat)} of latitude and ${degrees(everyLon)} of longitude`);
const areaRange = ([low, high]) => (low === null ? '-' : scale(low) === scale(high) ? `${scale(low)} everywhere` : `${scale(low)} to ${scale(high)}`);

function TextArea({ tokens, label, value, onChange, rows = 3 }) {
    return (
        <label style={{ display: 'block', minWidth: 0 }}>
            <Label tokens={tokens}>{label}</Label>
            <textarea value={value} rows={rows} spellCheck={false} onInput={(event) => onChange(event.target.value)} style={{ ...fieldStyle(tokens), resize: 'vertical', fontSize: 12 }} />
        </label>
    );
}

function TextBox({ tokens, text, maxHeight = 150 }) {
    return (
        <pre style={{ margin: 0, maxHeight, overflow: 'auto', fontFamily: tokens.mono, fontSize: 11.5, lineHeight: 1.55, color: tokens.codeText, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '9px 11px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {text}
        </pre>
    );
}

function LicenceNote({ tokens }) {
    const external = { target: '_blank', rel: 'noreferrer', style: { color: tokens.accentText, textDecoration: 'underline', textUnderlineOffset: 3 } };
    return (
        <span>
            {'Runs PROJ 9.9.0, which is MIT-licensed: '}
            <a href="https://github.com/OSGeo/PROJ" {...external}>source</a>
            {' · '}
            <a href={`${REPO_URL}/tree/main/ports/proj`} {...external}>build recipe</a>
        </span>
    );
}

// Runs of projected x, y (y up) drawn to fit their bounds. `onPick` gets the map coordinates of a
// click, so the page can ask PROJ about that point.
function MapDrawing({ tokens, bounds, layers, markers = [], label, maxHeight = 380, onPick }) {
    const [left, bottom, right, top] = bounds;
    const pad = Math.max(right - left, top - bottom) * 0.03 || 1;
    const width = right - left + 2 * pad;
    const height = top - bottom + 2 * pad;
    const unit = 1000 / width;
    const viewHeight = height * unit;
    const x = (value) => ((value - left + pad) * unit).toFixed(1);
    const y = (value) => ((top + pad - value) * unit).toFixed(1);
    const path = (run) => {
        let d = '';
        for (let index = 0; index + 1 < run.length; index += 2) d += `${index ? 'L' : 'M'}${x(run[index])} ${y(run[index + 1])}`;
        return d;
    };
    const pick = onPick
        ? (event) => {
              const box = event.currentTarget.getBoundingClientRect();
              onPick(left - pad + ((event.clientX - box.left) / box.width) * width, top + pad - ((event.clientY - box.top) / box.height) * height);
          }
        : undefined;
    return (
        <svg
            viewBox={`0 0 1000 ${viewHeight.toFixed(1)}`}
            role="img"
            aria-label={label}
            onClick={pick}
            style={{ display: 'block', width: '100%', maxWidth: Math.round((maxHeight * 1000) / viewHeight), height: 'auto', margin: '0 auto', overflow: 'hidden', background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 10, cursor: onPick ? 'crosshair' : 'default' }}
        >
            {layers.map((layer, index) => (
                <path
                    key={index}
                    d={layer.runs.map(path).join('')}
                    fill={layer.fill ?? 'none'}
                    fillOpacity={layer.fillOpacity}
                    stroke={layer.stroke}
                    strokeWidth={layer.width ?? 1}
                    strokeDasharray={layer.dashed ? '6 5' : undefined}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
            ))}
            {markers.map((marker, index) => (
                <circle key={index} cx={x(marker.at[0])} cy={y(marker.at[1])} r={marker.radius ?? 7} fill={marker.fill ?? 'none'} stroke={marker.stroke ?? 'none'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            ))}
        </svg>
    );
}

// ---- Projection atlas ----

const ATLAS = [
    { group: 'The world', id: 'EPSG:8857', label: 'Equal Earth' },
    { group: 'The world', id: 'ESRI:54030', label: 'Robinson' },
    { group: 'The world', id: 'ESRI:54009', label: 'Mollweide' },
    { group: 'The world', id: 'ESRI:54042', label: 'Winkel tripel' },
    { group: 'The world', id: 'ESRI:54077', label: 'Natural Earth' },
    { group: 'The world', id: 'ESRI:54052', label: 'Goode homolosine, interrupted' },
    { group: 'The world', id: 'EPSG:3857', label: 'Web Mercator, the web map default' },
    { group: 'The world', id: 'EPSG:4087', label: 'Plate carrée' },
    { group: 'The world', id: '+proj=bertin1953 +type=crs', label: 'Bertin 1953' },
    { group: 'The world', id: '+proj=ortho +lat_0=30 +lon_0=20 +datum=WGS84 +type=crs', label: 'Orthographic, a globe' },
    { group: 'A region, over its area of use', id: 'EPSG:3035', label: 'Europe, Lambert azimuthal equal area' },
    { group: 'A region, over its area of use', id: 'EPSG:3034', label: 'Europe, Lambert conformal conic' },
    { group: 'A region, over its area of use', id: 'EPSG:27700', label: 'British National Grid' },
    { group: 'A region, over its area of use', id: 'EPSG:2056', label: 'Switzerland, LV95' },
    { group: 'A region, over its area of use', id: 'EPSG:32635', label: 'UTM zone 35N' },
    { group: 'A region, over its area of use', id: 'EPSG:3995', label: 'Arctic polar stereographic' },
];

// What the circle centres show: sizes kept, shapes kept, or neither.
function kindOf(drawing) {
    const [low, high] = drawing.areal;
    if (low === null) return { value: 'Not measured', label: 'PROJ could not measure this projection' };
    if (Math.abs(low - 1) < 1e-6 && Math.abs(high - 1) < 1e-6) return { value: 'Equal-area', label: 'every region keeps its true size; shapes stretch' };
    if (drawing.angular < 0.01) return { value: 'Conformal', label: 'small shapes keep their shape; sizes change' };
    if (drawing.angular < 1) return { value: 'Nearly conformal', label: `angles are off by ${drawing.angular.toFixed(2)}° at most` };
    return { value: 'Neither', label: 'sizes and shapes both change, traded against each other' };
}

const ATLAS_WRAPPER = `// src/support/map_projection.h (excerpt)
// From the CRS's own geographic CRS to its map coordinates, so drawing never
// shifts datums, then longitude and easting first whatever the axis order.
const Object geographic = proj.own(proj_crs_get_geodetic_crs(proj.get(), crs.get()), "...");
const Object operation = proj.own(proj_create_crs_to_crs_from_pj(proj.get(), geographic.get(),
                                                                 crs.get(), nullptr, nullptr), "...");
pipeline = proj.own(proj_normalize_for_visualization(proj.get(), operation.get()), "...");

// Scale factors at a point, from PROJ's derivatives of the projection.
out = proj_factors(crs.get(), proj_coord(lon * kRadiansPerDegree, lat * kRadiansPerDegree, 0, 0));`;

const ATLAS_USAGE = `const m = await initNative();
const atlas = await new m.ProjectionAtlas();
const map = JSON.parse(await atlas.draw('EPSG:8857'));  // Equal Earth
// map.graticule, map.outline, map.circles: runs of x, y in metres
const [x, y] = JSON.parse(await atlas.project(30, 40)); // 2549249.49, 4921020.06

await atlas.draw('EPSG:3395');                          // World Mercator
const at60 = JSON.parse(await atlas.distortion(0, 60));
// at60.areal: 3.97992, so areas at 60°N are drawn four times too big`;

export function ProjectionAtlas({ tokens, index, load }) {
    const [preset, setPreset] = useState(ATLAS[0].id);
    const [definition, setDefinition] = useState(ATLAS[0].id);
    const [state, run] = useNativeTask(load);
    const [reading, setReading] = useState(null);
    const atlas = useRef(null);
    const pickPreset = (id) => {
        setPreset(id);
        setDefinition(id);
    };
    const start = () =>
        run(async (m) => {
            setReading(null);
            atlas.current ??= await new m.ProjectionAtlas();
            const typed = definition.trim();
            const drawing = JSON.parse(await atlas.current.draw(typed));
            const preset = ATLAS.find((item) => item.id === typed)?.label;
            return { ...drawing, label: drawing.name && drawing.name !== 'unknown' ? drawing.name : (preset ?? 'Your projection') };
        });
    const measure = async (x, y) => {
        try {
            setReading({ at: [x, y], ...JSON.parse(await atlas.current.inspect(x, y)) });
        } catch (error) {
            setReading({ at: [x, y], error: error?.message ?? String(error) });
        }
    };
    const done = state.status === 'ready' ? state.result : null;
    const kind = done ? kindOf(done) : null;
    return (
        <AppCard
            tokens={tokens}
            id="proj-atlas"
            index={index}
            status={state.status}
            title="See what a map projection stretches"
            pitch="Pick a world map, or any projected CRS by its EPSG or ESRI code, WKT or PROJ string. PROJ draws its graticule and a grid of circles that are all the same size on the ground, over the area the CRS is defined for, so the shapes the circles take show what the projection stretches. Click the map to measure the distortion at that point."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="PROJECTION" value={preset} onChange={pickPreset}>
                        {preset === '' ? <option value="">Your own</option> : null}
                        {[...new Set(ATLAS.map((item) => item.group))].map((group) => (
                            <optgroup key={group} label={group}>
                                {ATLAS.filter((item) => item.group === group).map((item) => (
                                    <option key={item.id} value={item.id}>{`${item.label}${item.id.startsWith('+') ? '' : ` (${item.id})`}`}</option>
                                ))}
                            </optgroup>
                        ))}
                    </Select>
                    <TextArea
                        tokens={tokens}
                        label="OR ANY PROJECTED CRS: A CODE, WKT OR PROJ STRING"
                        value={definition}
                        onChange={(text) => {
                            setDefinition(text);
                            setPreset(ATLAS.some((item) => item.id === text.trim()) ? text.trim() : '');
                        }}
                        rows={2}
                    />
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Draw with PROJ</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        The circles are geodesic circles, every point the same distance from the centre on the ellipsoid, from PROJ's geodesic.h. A code brings its area of use from
                        the EPSG or ESRI registry; a PROJ string carries none, so the whole world is drawn.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 14 }}>
                        <div style={{ fontSize: 14, color: tokens.textDim, lineHeight: 1.5 }}>
                            <span style={{ color: tokens.text, fontWeight: 600 }}>{done.label}</span>
                            {` · ${done.method}${done.code ? ` · ${done.code}` : ''}`}
                        </div>
                        <MapDrawing
                            tokens={tokens}
                            label={`${done.label} with Tissot's circles`}
                            bounds={done.bounds}
                            onPick={measure}
                            layers={[
                                { runs: done.graticule, stroke: tokens.textMuted, width: 0.7 },
                                { runs: done.outline, stroke: tokens.textDim, width: 1.4 },
                                { runs: done.circles.flat(), fill: tokens.accent, fillOpacity: 0.28, stroke: tokens.accent, width: 1 },
                            ]}
                            markers={reading ? [{ at: reading.at, stroke: tokens.text }] : []}
                        />
                        {reading ? (
                            reading.error ? (
                                <Meta tokens={tokens}>{`No reading there: ${reading.error}`}</Meta>
                            ) : (
                                <Meta tokens={tokens}>
                                    {`At ${longitude(reading.lon)} ${latitude(reading.lat)}: areas ${scale(reading.areal)}, angles off by up to ${reading.angular.toFixed(1)}°, north-south ${scale(reading.meridian)}, east-west ${scale(reading.parallel)}`}
                                </Meta>
                            )
                        ) : (
                            <Meta tokens={tokens}>Click the map to measure the distortion at that point.</Meta>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
                            <Stat tokens={tokens} size={24} accent value={kind.value} label={kind.label} />
                            <Stat tokens={tokens} size={24} value={areaRange(done.areal)} label="area scale at the circle centres" />
                            <Stat tokens={tokens} size={24} value={`${formatted(done.radius / 500)} km`} label={`circle diameter on the ground, ${spacingOf(done)}`} />
                        </div>
                        <Meta tokens={tokens}>{done.area.known ? `Drawn over its area of use: ${done.area.name}` : 'A PROJ string carries no area of use, so the whole world is drawn.'}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Draw a projection to see its graticule and circles.</Placeholder>
                )
            }
            code={[
                { file: 'src/support/map_projection.h', code: ATLAS_WRAPPER },
                { file: 'main.js', code: ATLAS_USAGE },
            ]}
        />
    );
}
ProjectionAtlas.appId = 'proj-atlas';

// ---- CRS detective ----

const PRJ =
    'PROJCS["WGS_1984_UTM_Zone_35N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",27.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

const SAMPLES = [
    { id: 'prj', label: "A shapefile's .prj, UTM zone 35N", definition: PRJ, target: 'EPSG:4326' },
    { id: 'bng', label: 'EPSG:27700, the British National Grid', definition: 'EPSG:27700', target: 'EPSG:4326' },
    { id: 'nad27', label: 'NAD27, the old North American datum', definition: 'EPSG:4267', target: 'EPSG:4269' },
    { id: 'poland', label: "EPSG:2180, Poland's grid, northing first", definition: 'EPSG:2180', target: 'EPSG:4326' },
    { id: 'string', label: 'A PROJ string, which carries no names', definition: '+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs +type=crs', target: 'EPSG:4326' },
];

const FORMATS = [
    ['wkt2', 'WKT2 (ISO 19162:2019)'],
    ['esri', 'ESRI WKT, as in a .prj'],
    ['projjson', 'PROJJSON'],
    ['proj', 'PROJ string'],
];

// The area of use on a plain longitude, latitude frame; a box across the antimeridian is drawn in two.
function WorldBox({ tokens, area }) {
    const boxes = area.west <= area.east ? [[area.west, area.east]] : [[area.west, 180], [-180, area.east]];
    const lines = [];
    for (let lon = -150; lon < 180; lon += 30) lines.push(`M${lon} -90V90`);
    for (let lat = -60; lat < 90; lat += 30) lines.push(`M-180 ${-lat}H180`);
    return (
        <svg viewBox="-180 -90 360 180" role="img" aria-label="Area of use on a world frame" style={{ display: 'block', width: '100%', maxWidth: 360, height: 'auto', background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 10 }}>
            <path d={lines.join('')} stroke={tokens.border} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path d="M-180 0H180M0 -90V90" stroke={tokens.textMuted} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {boxes.map(([west, east]) => (
                <rect
                    key={west}
                    x={west}
                    y={-area.north}
                    width={Math.max(east - west, 0.8)}
                    height={Math.max(area.north - area.south, 0.8)}
                    fill={tokens.accent}
                    fillOpacity="0.3"
                    stroke={tokens.accent}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                />
            ))}
        </svg>
    );
}

function Operations({ tokens, result, target }) {
    const { known, runnable, chosen } = result;
    const cell = { padding: '6px 8px', borderTop: `1px solid ${tokens.border}`, verticalAlign: 'top', fontSize: 12.5, lineHeight: 1.45 };
    const blocked = known.filter((operation) => !operation.usable).length;
    return (
        <div>
            <Label tokens={tokens}>{`EVERY PATH PROJ KNOWS TO ${target.toUpperCase()}`}</Label>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', color: tokens.text }}>
                    <thead>
                        <tr style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 0.8, color: tokens.textMuted, textAlign: 'left' }}>
                            <th style={{ padding: '4px 8px' }}>OPERATION</th>
                            <th style={{ padding: '4px 8px' }}>ACCURACY</th>
                            <th style={{ padding: '4px 8px' }}>IN THIS BUILD</th>
                        </tr>
                    </thead>
                    <tbody>
                        {known.slice(0, 12).map((operation, row) => (
                            <tr key={row}>
                                <td style={cell}>{operation.name}</td>
                                <td style={{ ...cell, fontFamily: tokens.mono, whiteSpace: 'nowrap' }}>{operation.conversion || operation.accuracy === 0 ? 'exact' : operation.accuracy >= 0 ? `${operation.accuracy.toLocaleString('en-US', { maximumFractionDigits: 2 })} m` : 'unknown'}</td>
                                <td style={{ ...cell, color: operation.usable ? tokens.accentText : tokens.textMuted }}>
                                    {operation.usable ? (operation.ballpark ? 'runs, a ballpark shift' : 'runs') : `needs ${operation.grids.filter((grid) => !grid.available).map((grid) => grid.name).join(', ')}`}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {known.length > 12 ? <Meta tokens={tokens}>{`and ${known.length - 12} more`}</Meta> : null}
            {chosen ? <Meta tokens={tokens}>{`At ${longitude(chosen.at[0])} ${latitude(chosen.at[1])}, proj_trans runs: ${chosen.name}. ${runnable.length} paths can run in this build.`}</Meta> : null}
            {blocked ? (
                <Meta tokens={tokens}>
                    {`${blocked} of ${known.length} need a grid file. This build ships none and cannot download them, so PROJ runs the best path it can instead, often through WGS 84, with lower accuracy.`}
                </Meta>
            ) : null}
        </div>
    );
}

const DETECTIVE_WRAPPER = `// src/native/crs_detective.h (excerpt)
PJ_OPERATION_FACTORY_CONTEXT* factory = proj_create_operation_factory_context(proj.get(), nullptr);
proj_operation_factory_context_set_spatial_criterion(proj.get(), factory,
    PROJ_SPATIAL_CRITERION_PARTIAL_INTERSECTION);
// IGNORED lists every path as if all grids were installed;
// DISCARD_OPERATION_IF_MISSING_GRID lists what this build can run.
proj_operation_factory_context_set_grid_availability_use(proj.get(), factory, grids);
PJ_OBJ_LIST* found = proj_create_operations(proj.get(), from, to, factory);

// A .prj names no code: proj_identify matches it against the registry.
PJ_OBJ_LIST* matches = proj_identify(proj.get(), crs, nullptr, nullptr, &confidence);`;

const DETECTIVE_USAGE = `const m = await initNative();
const detective = await new m.CrsDetective();
const crs = JSON.parse(await detective.inspect(prjText));
// crs.identified[0]: EPSG:32635, confidence 100
// crs.area, from EPSG:32635: 24°E to 30°E, 0° to 84°N

const paths = JSON.parse(await detective.operations('EPSG:4267', 'EPSG:4269'));
// paths.known: 10 operations, 9 of them need a grid this build does not ship
// paths.chosen.name: 'NAD27 to WGS 84 (6) + Inverse of NAD83 to WGS 84 (1)'`;

function RegistrySearch({ tokens, open, onPick }) {
    const [words, setWords] = useState('');
    const [found, setFound] = useState(null);
    const search = async (event) => {
        event.preventDefault();
        try {
            setFound({ results: JSON.parse(await (await open()).search(words, 8)) });
        } catch (error) {
            setFound({ error: error?.message ?? String(error) });
        }
    };
    return (
        <form onSubmit={search} style={{ display: 'grid', gap: 8 }}>
            <Label tokens={tokens}>OR SEARCH THE REGISTRY BY NAME OR CODE</Label>
            <div style={{ display: 'flex', gap: 8 }}>
                <input value={words} placeholder="utm zone 35n" spellCheck={false} onInput={(event) => setWords(event.target.value)} style={fieldStyle(tokens)} />
                <SecondaryButton tokens={tokens} onClick={search}>Search</SecondaryButton>
            </div>
            {found?.error ? <Failure tokens={tokens} message={found.error} /> : null}
            {found?.results && !found.results.length ? <Hint tokens={tokens}>Nothing in the registry matches.</Hint> : null}
            {found?.results?.length ? (
                <div style={{ display: 'grid', gap: 2 }}>
                    {found.results.map((crs) => (
                        <button
                            key={crs.code}
                            type="button"
                            className="tap-target"
                            onClick={() => onPick(crs.code)}
                            style={{ textAlign: 'left', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', color: tokens.text, fontSize: 13, lineHeight: 1.45 }}
                        >
                            <span style={{ fontFamily: tokens.mono, color: tokens.accentText, marginRight: 8 }}>{crs.code}</span>
                            {crs.name}
                        </button>
                    ))}
                </div>
            ) : null}
        </form>
    );
}

function Identity({ tokens, inspected }) {
    const best = inspected.identified[0];
    const firstAxis = inspected.axes[0];
    return (
        <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
                <Stat
                    tokens={tokens}
                    accent={Boolean(best)}
                    value={best ? best.code : inspected.code || 'No match'}
                    label={best ? `${best.name}, ${best.confidence}% match` : `${inspected.name}: nothing in the registry matches`}
                />
                <Stat tokens={tokens} size={24} value={inspected.type} label={`${inspected.datum ?? 'no datum'}${inspected.ellipsoid ? `, ellipsoid ${inspected.ellipsoid.name}` : ''}`} />
            </div>
            {inspected.area ? (
                <div>
                    <Label tokens={tokens}>{`WHERE IT APPLIES${inspected.areaFrom !== 'definition' ? `, FROM ${inspected.areaFrom}` : ''}`}</Label>
                    <WorldBox tokens={tokens} area={inspected.area} />
                    <Meta tokens={tokens}>{`${longitude(inspected.area.west)} to ${longitude(inspected.area.east)}, ${latitude(inspected.area.south)} to ${latitude(inspected.area.north)}. ${inspected.area.name}`}</Meta>
                </div>
            ) : (
                <Meta tokens={tokens}>No area of use: the definition carries none and no registry entry matches it well enough.</Meta>
            )}
            <div>
                <Label tokens={tokens}>AXES, IN ORDER</Label>
                <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, lineHeight: 1.7 }}>
                    {inspected.axes.map((axis, position) => <div key={position}>{`${position + 1}. ${axis.name} (${axis.abbreviation}), ${axis.direction}, ${axis.unit}`}</div>)}
                </div>
                {firstAxis?.direction === 'north' ? (
                    <Meta tokens={tokens}>North comes first, as EPSG defines this CRS. Software that assumes x, y swaps the two; proj_normalize_for_visualization puts east first for maps.</Meta>
                ) : null}
            </div>
        </>
    );
}

export function CrsDetective({ tokens, index, load }) {
    const [sample, setSample] = useState(SAMPLES[0].id);
    const [definition, setDefinition] = useState(SAMPLES[0].definition);
    const [target, setTarget] = useState(SAMPLES[0].target);
    const [format, setFormat] = useState('wkt2');
    const [state, run] = useNativeTask(load);
    const detective = useRef(null);
    const open = async () => {
        const m = await load();
        detective.current ??= await new m.CrsDetective();
        return detective.current;
    };
    const pickSample = (id) => {
        const next = SAMPLES.find((item) => item.id === id);
        setSample(id);
        setDefinition(next.definition);
        setTarget(next.target);
    };
    const takeDefinition = (text) => {
        setDefinition(text);
        setSample('');
    };
    const start = () =>
        run(async () => {
            const crs = await open();
            const typed = definition.trim();
            const inspected = JSON.parse(await crs.inspect(typed));
            let paths;
            try {
                paths = JSON.parse(await crs.operations(typed, target.trim()));
            } catch (error) {
                paths = { error: error?.message ?? String(error) };
            }
            return { inspected, paths, target: target.trim(), versions: JSON.parse(await crs.versions()) };
        });
    const done = state.status === 'ready' ? state.result : null;
    return (
        <AppCard
            tokens={tokens}
            id="proj-detective"
            index={index}
            status={state.status}
            title="Find out what a .prj is, and every way PROJ can transform it"
            pitch="A shapefile's .prj names no EPSG code. Paste one, or any WKT, PROJJSON, PROJ string or code, and PROJ matches it against its copy of the EPSG registry: the code, where the CRS applies, its axis order, the same CRS in four formats, and every transformation path to a second CRS with its accuracy. proj4js, the JavaScript port, knows only the CRSs you define with proj4.defs() and the few it predefines, so it has no registry to match a .prj against."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="SAMPLES" value={sample} onChange={pickSample}>
                        {sample === '' ? <option value="">Your own</option> : null}
                        {SAMPLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </Select>
                    <TextArea tokens={tokens} label="A .PRJ, WKT, PROJJSON, PROJ STRING OR CODE" value={definition} onChange={takeDefinition} rows={4} />
                    <div>
                        <FileButton tokens={tokens} accept=".prj,.wkt,.json,.txt" onFile={async (file) => takeDefinition((await file.text()).trim())}>Open a .prj file</FileButton>
                    </div>
                    <label style={{ display: 'block', minWidth: 0 }}>
                        <Label tokens={tokens}>TRANSFORM TO</Label>
                        <input value={target} spellCheck={false} onInput={(event) => setTarget(event.target.value)} style={fieldStyle(tokens)} />
                    </label>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Identify with PROJ</RunButton>
                    </div>
                    <RegistrySearch tokens={tokens} open={open} onPick={takeDefinition} />
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <Identity tokens={tokens} inspected={done.inspected} />
                        <div>
                            <div style={{ maxWidth: 260, marginBottom: 8 }}>
                                <Select tokens={tokens} label="THE SAME CRS AS" value={format} onChange={setFormat}>
                                    {FORMATS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                                </Select>
                            </div>
                            <TextBox tokens={tokens} text={done.inspected.formats[format] ?? 'PROJ cannot write this CRS in that format.'} />
                        </div>
                        {done.paths.error ? <Failure tokens={tokens} message={`No path to ${done.target}: ${done.paths.error}`} /> : <Operations tokens={tokens} result={done.paths} target={done.target} />}
                        <Meta tokens={tokens}>
                            {`PROJ ${done.versions.proj}, EPSG registry ${done.versions.epsg} of ${done.versions.epsgDate}: ${formatted(done.versions.crs.EPSG)} EPSG CRSs and ${formatted(Object.values(done.versions.crs).reduce((sum, count) => sum + count, 0) - done.versions.crs.EPSG)} from ESRI, IAU, IGNF and others in proj.db.`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Identify a CRS to see its code, where it applies, its axes and every path to another CRS.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/crs_detective.h', code: DETECTIVE_WRAPPER },
                { file: 'main.js', code: DETECTIVE_USAGE },
            ]}
        />
    );
}
CrsDetective.appId = 'proj-detective';

// ---- Why flights curve ----

const CITIES = [
    { id: 'ist', label: 'Istanbul', at: [41.0082, 28.9784] },
    { id: 'jfk', label: 'New York (JFK)', at: [40.6413, -73.7781] },
    { id: 'lhr', label: 'London (Heathrow)', at: [51.47, -0.4543] },
    { id: 'hnd', label: 'Tokyo (Haneda)', at: [35.5494, 139.7798] },
    { id: 'lax', label: 'Los Angeles (LAX)', at: [33.9416, -118.4085] },
    { id: 'sin', label: 'Singapore (Changi)', at: [1.3644, 103.9915] },
    { id: 'syd', label: 'Sydney (SYD)', at: [-33.9399, 151.1753] },
    { id: 'scl', label: 'Santiago (SCL)', at: [-33.393, -70.7858] },
    { id: 'jnb', label: 'Johannesburg (JNB)', at: [-26.1392, 28.246] },
    { id: 'dxb', label: 'Dubai (DXB)', at: [25.2532, 55.3657] },
    { id: 'gru', label: 'São Paulo (GRU)', at: [-23.4356, -46.4731] },
    { id: 'kef', label: 'Reykjavík (KEF)', at: [63.985, -22.6056] },
];
const cityOf = (id) => CITIES.find((city) => city.id === id);

const FLIGHTS_WRAPPER = `// src/native/flight_paths.h and src/support/map_projection.h (excerpts)
// The shortest route: points along the geodesic, from geodesic.h.
geod_inverseline(&route, &ellipsoid, lat1, lon1, lat2, lon2, 0);
geod_position(&route, route.s13 * index / points, &lat, &lon, nullptr);

// The constant heading: a straight line on ellipsoidal Mercator (EPSG:3395),
// which is conformal, unprojected back to longitude and latitude.
x2 = x1 + std::remainder(x2 - x1, world);  // the short way round
heading = std::fmod(std::atan2(x2 - x1, y2 - y1) / projapp::kRadiansPerDegree + 360, 360.0);
mercator.unproject(x1 + t * (x2 - x1), y1 + t * (y2 - y1), lon, lat);`;

const FLIGHTS_USAGE = `const m = await initNative();
const flights = await new m.FlightPaths();
const route = JSON.parse(await flights.route(41.0082, 28.9784, 40.6413, -73.7781));
// Istanbul to New York JFK: route.geodesic.meters 8080310.14,
// route.rhumb.meters 8668353.46 at a heading of 269.73°

const map = JSON.parse(await flights.draw('EPSG:3395', 41.0082, 28.9784, 40.6413, -73.7781));
// map.geodesic and map.rhumb: runs of x, y on World Mercator`;

// The part of a map around both routes, with a margin, inside the map's own bounds.
function aroundRoutes(drawing) {
    const [left, bottom, right, top] = drawing.bounds;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const run of [...drawing.geodesic, ...drawing.rhumb]) {
        for (let index = 0; index + 1 < run.length; index += 2) {
            box[0] = Math.min(box[0], run[index]);
            box[1] = Math.min(box[1], run[index + 1]);
            box[2] = Math.max(box[2], run[index]);
            box[3] = Math.max(box[3], run[index + 1]);
        }
    }
    if (!Number.isFinite(box[0])) return drawing.bounds;
    const margin = Math.max(box[2] - box[0], box[3] - box[1]) * 0.35;
    return [Math.max(left, box[0] - margin), Math.max(bottom, box[1] - margin), Math.min(right, box[2] + margin), Math.min(top, box[3] + margin)];
}

function RouteMap({ tokens, title, drawing, zoom }) {
    return (
        <div style={{ minWidth: 0 }}>
            <Label tokens={tokens}>{title}</Label>
            <MapDrawing
                tokens={tokens}
                label={title.toLowerCase()}
                bounds={zoom ? aroundRoutes(drawing) : drawing.bounds}
                maxHeight={260}
                layers={[
                    { runs: drawing.graticule, stroke: tokens.textMuted, width: 0.6 },
                    { runs: drawing.outline, stroke: tokens.textDim, width: 1.2 },
                    { runs: drawing.rhumb, stroke: tokens.textDim, width: 1.8, dashed: true },
                    { runs: drawing.geodesic, stroke: tokens.accent, width: 2.5 },
                ]}
                markers={drawing.ends.filter(Boolean).map((at) => ({ at, fill: tokens.accent, radius: 9 }))}
            />
        </div>
    );
}

export function FlightPaths({ tokens, index, load }) {
    const [from, setFrom] = useState('ist');
    const [to, setTo] = useState('jfk');
    const [state, run] = useNativeTask(load);
    const start = () =>
        run(async (m) => {
            if (from === to) throw new Error('pick two different places');
            const flights = await new m.FlightPaths();
            const [lat1, lon1] = cityOf(from).at;
            const [lat2, lon2] = cityOf(to).at;
            const route = JSON.parse(await flights.route(lat1, lon1, lat2, lon2));
            const [midLon, midLat] = route.geodesic.midpoint;
            const draw = async (definition) => JSON.parse(await flights.draw(definition, lat1, lon1, lat2, lon2));
            return {
                route,
                from: cityOf(from).label,
                mercator: await draw('EPSG:3395'),
                centred: await draw(`+proj=aeqd +lat_0=${lat1} +lon_0=${lon1} +datum=WGS84 +type=crs`),
                globe: await draw(`+proj=ortho +lat_0=${midLat.toFixed(4)} +lon_0=${midLon.toFixed(4)} +datum=WGS84 +type=crs`),
            };
        });
    const done = state.status === 'ready' ? state.result : null;
    const extra = done ? done.route.rhumb.meters - done.route.geodesic.meters : 0;
    return (
        <AppCard
            tokens={tokens}
            id="proj-flights"
            index={index}
            status={state.status}
            title="Why flights curve on a map"
            pitch="The shortest route between two cities is a geodesic on the ellipsoid. On Mercator it bends toward the pole, while the straight line there is the route that keeps one compass heading, and that one is longer. Pick two cities: PROJ measures both routes on the WGS 84 ellipsoid and draws them on three maps."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="FROM" value={from} onChange={setFrom}>
                        {CITIES.map((city) => <option key={city.id} value={city.id}>{city.label}</option>)}
                    </Select>
                    <Select tokens={tokens} label="TO" value={to} onChange={setTo}>
                        {CITIES.map((city) => <option key={city.id} value={city.id}>{city.label}</option>)}
                    </Select>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Draw both routes</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        The shortest route comes from geod_inverse, Charles Karney's algorithm, which PROJ carries as geodesic.h. The constant heading, a rhumb line, is the straight
                        line between the two cities on ellipsoidal Mercator, which PROJ unprojects point by point.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
                            <Stat
                                tokens={tokens}
                                accent
                                value={`${formatted(done.route.geodesic.meters / 1000)} km`}
                                label={`shortest, leaving on ${heading(done.route.geodesic.azimuth1)} and arriving on ${heading(done.route.geodesic.azimuth2)}`}
                            />
                            <Stat tokens={tokens} size={24} value={`${formatted(done.route.rhumb.meters / 1000)} km`} label={`at one heading, ${heading(done.route.rhumb.azimuth)} all the way`} />
                            <Stat tokens={tokens} size={24} value={`+${formatted(extra / 1000)} km`} label={`${formatted((extra / done.route.geodesic.meters) * 100, 1)}% longer at one heading`} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 14 }}>
                            <RouteMap tokens={tokens} title="MERCATOR, EPSG:3395" drawing={done.mercator} zoom />
                            <RouteMap tokens={tokens} title={`CENTRED ON ${done.from.toUpperCase()}`} drawing={done.centred} />
                            <RouteMap tokens={tokens} title="A GLOBE OVER THE MIDPOINT" drawing={done.globe} />
                        </div>
                        <Meta tokens={tokens}>
                            {`The solid line is the shortest route and the dashed one keeps a single heading. On Mercator the dashed line is straight; centred on ${done.from}, an azimuthal equidistant map, the solid one is. The shortest route reaches ${latitude(done.route.geodesic.highest[1])} at its farthest from the equator.`}
                        </Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Pick two cities to draw the shortest route and the constant heading.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/flight_paths.h', code: FLIGHTS_WRAPPER },
                { file: 'main.js', code: FLIGHTS_USAGE },
            ]}
        />
    );
}
FlightPaths.appId = 'proj-flights';

export const PROJ_APPS = [ProjectionAtlas, CrsDetective, FlightPaths];

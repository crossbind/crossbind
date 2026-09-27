import { useState } from 'react';
import { REPO_URL } from '../data.js';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { Hint, Meta, Placeholder, Select, Stat, Toggle } from './controls.jsx';

// The GEOS apps on /ports/geos/. Each one drives landing/demos/lib-geos, whose index.html checks the
// same calls against values worked out with plain Python geometry and with the host's own GEOS.

const SQUARE = 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))';
const SHIFTED = 'POLYGON ((5 5, 15 5, 15 15, 5 15, 5 5))';
const PARK = 'POLYGON ((0 0, 60 0, 60 40, 0 40, 0 0), (35 15, 45 15, 45 25, 35 25, 35 15))';
const RIVER = 'LINESTRING (-10 30, 20 30, 40 20, 70 20)';
const POINTS = 'MULTIPOINT ((12 18), (27 8), (45 14), (62 6), (78 20), (88 40), (70 52), (52 38), (33 42), (15 55), (40 70), (68 78), (22 88))';
const COAST = 'POLYGON ((10 30, 18 22, 16 12, 28 8, 36 14, 44 6, 58 10, 62 22, 72 24, 70 36, 60 42, 64 54, 52 60, 42 52, 34 60, 22 56, 20 44, 8 40, 10 30))';
const BOWTIE = 'POLYGON ((0 0, 10 10, 10 0, 0 10, 0 0))';

const formatted = (value) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 });

// GeoJSON as the simple parts SVG draws: polygons with their holes, lines and points. GEOS writes an
// empty polygon with one empty ring, so empty rings and lines are dropped here.
function simpleParts(geometry, out = []) {
    if (!geometry) return out;
    const { type, coordinates } = geometry;
    const polygon = (rings) => {
        const drawn = rings.filter((ring) => ring.length);
        if (drawn.length) out.push({ type: 'polygon', rings: drawn });
    };
    const line = (points) => {
        if (points.length) out.push({ type: 'line', points });
    };
    if (type === 'GeometryCollection') geometry.geometries.forEach((part) => simpleParts(part, out));
    else if (type === 'Polygon') polygon(coordinates);
    else if (type === 'MultiPolygon') coordinates.forEach(polygon);
    else if (type === 'LineString') line(coordinates);
    else if (type === 'MultiLineString') coordinates.forEach(line);
    else if (type === 'Point' && coordinates.length) out.push({ type: 'point', points: [coordinates] });
    else if (type === 'MultiPoint') coordinates.forEach((point) => out.push({ type: 'point', points: [point] }));
    return out;
}

function boundsOf(geometries) {
    let box = null;
    for (const geometry of geometries) {
        for (const part of simpleParts(geometry)) {
            for (const [x, y] of part.rings ? part.rings.flat() : part.points) {
                box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
            }
        }
    }
    return box;
}

// Draws layers of GeoJSON in the coordinates' own units, y pointing up. `frame` picks the geometries
// that set the view (a Voronoi diagram reaches far past its points) and the rest is clipped. The
// width is capped rather than the height, so the SVG never letterboxes what lies outside the frame.
function Drawing({ tokens, layers, frame, circles = [], markers = [], label, maxHeight = 320 }) {
    const box = boundsOf(frame ?? layers.map((layer) => layer.geometry));
    if (!box) return null;
    const size = Math.max(box[2] - box[0], box[3] - box[1]) || 1;
    const pad = size * 0.07;
    const width = Math.max(box[2] - box[0], size * 0.3) + 2 * pad;
    const height = Math.max(box[3] - box[1], size * 0.3) + 2 * pad;
    const left = (box[0] + box[2]) / 2 - width / 2;
    const top = (box[1] + box[3]) / 2 + height / 2;
    const x = (value) => (value - left).toFixed(3);
    const y = (value) => (top - value).toFixed(3);
    const path = (points, close) => points.map(([px, py], index) => `${index ? 'L' : 'M'}${x(px)} ${y(py)}`).join('') + (close ? 'Z' : '');
    return (
        <svg
            viewBox={`0 0 ${width.toFixed(3)} ${height.toFixed(3)}`}
            role="img"
            aria-label={label}
            style={{ display: 'block', width: '100%', maxWidth: Math.round((maxHeight * width) / height), height: 'auto', margin: '0 auto', overflow: 'hidden', background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 10 }}
        >
            {layers.map((layer, index) => (
                <g key={index}>
                    {simpleParts(layer.geometry).map((part, partIndex) =>
                        part.type === 'point' ? (
                            <circle key={partIndex} cx={x(part.points[0][0])} cy={y(part.points[0][1])} r={(size * 0.013).toFixed(3)} fill={layer.stroke} />
                        ) : (
                            <path
                                key={partIndex}
                                d={part.type === 'polygon' ? part.rings.map((ring) => path(ring, true)).join('') : path(part.points, false)}
                                fill={part.type === 'polygon' && layer.fill ? layer.fill : 'none'}
                                fillOpacity={layer.fillOpacity ?? 1}
                                fillRule="evenodd"
                                stroke={layer.stroke ?? 'none'}
                                strokeWidth={layer.width ?? 1.5}
                                strokeDasharray={layer.dashed ? '5 4' : undefined}
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                            />
                        ),
                    )}
                </g>
            ))}
            {circles.map((circle, index) => (
                <circle key={`c${index}`} cx={x(circle.center[0])} cy={y(circle.center[1])} r={circle.radius.toFixed(3)} fill="none" stroke={circle.stroke} strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            ))}
            {markers.map((marker, index) => (
                <g key={`m${index}`}>
                    <circle cx={x(marker.at[0])} cy={y(marker.at[1])} r={(size * 0.05).toFixed(3)} fill="none" stroke={marker.stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    <circle cx={x(marker.at[0])} cy={y(marker.at[1])} r={(size * 0.012).toFixed(3)} fill={marker.stroke} />
                </g>
            ))}
        </svg>
    );
}

function WktField({ tokens, label, value, onChange, rows = 3 }) {
    return (
        <label style={{ display: 'block', minWidth: 0 }}>
            <Label tokens={tokens}>{label}</Label>
            <textarea value={value} rows={rows} onInput={(event) => onChange(event.target.value)} style={{ ...fieldStyle(tokens), resize: 'vertical', fontSize: 12 }} />
        </label>
    );
}

function WktBox({ tokens, wkt }) {
    return (
        <pre style={{ margin: 0, maxHeight: 110, overflow: 'auto', fontFamily: tokens.mono, fontSize: 11.5, lineHeight: 1.55, color: tokens.codeText, background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 9, padding: '9px 11px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {wkt}
        </pre>
    );
}

// Serving GEOS in this page conveys it, so every app links its LGPL source and licence.
function LicenceNote({ tokens }) {
    const external = { target: '_blank', rel: 'noreferrer', style: { color: tokens.accentText, textDecoration: 'underline', textUnderlineOffset: 3 } };
    return (
        <span>
            {'Runs GEOS, which is LGPL-2.1: '}
            <a href="https://github.com/libgeos/geos" {...external}>source</a>
            {' · '}
            <a href="https://github.com/libgeos/geos/blob/main/COPYING" {...external}>licence</a>
            {' · '}
            <a href={`${REPO_URL}/tree/main/ports/geos`} {...external}>build recipe</a>
        </span>
    );
}

const OPERATIONS = [
    { group: 'Overlay of A and B', id: 'intersection', label: 'Intersection' },
    { group: 'Overlay of A and B', id: 'union', label: 'Union' },
    { group: 'Overlay of A and B', id: 'difference', label: 'Difference, A minus B' },
    { group: 'Overlay of A and B', id: 'symDifference', label: 'Symmetric difference' },
    { group: 'On A', id: 'buffer', label: 'Buffer', parameter: { label: 'DISTANCE', value: '2' } },
    { group: 'On A', id: 'offsetCurve', label: 'Offset curve', parameter: { label: 'DISTANCE', value: '2' } },
    { group: 'On A', id: 'makeValid', label: 'Make valid' },
    { group: 'On A', id: 'simplify', label: 'Simplify, keeping topology', parameter: { label: 'TOLERANCE', value: '4' } },
    { group: 'On A', id: 'maximumInscribedCircle', label: 'Largest inscribed circle', parameter: { label: 'TOLERANCE', value: '0.01' } },
    { group: 'On A', id: 'constrainedDelaunay', label: 'Constrained Delaunay triangulation' },
    { group: 'On A and B together', id: 'convexHull', label: 'Convex hull' },
    { group: 'On A and B together', id: 'concaveHull', label: 'Concave hull', parameter: { label: 'EDGE LENGTH RATIO, 0 TO 1', value: '0.3' } },
    { group: 'On A and B together', id: 'voronoi', label: 'Voronoi diagram of the vertices' },
    { group: 'On A and B together', id: 'delaunay', label: 'Delaunay triangulation of the vertices' },
    { group: 'On A and B together', id: 'minimumRotatedRectangle', label: 'Smallest enclosing rectangle' },
];
const operationOf = (id) => OPERATIONS.find((operation) => operation.id === id);

const PRESETS = [
    { id: 'squares', label: 'Two squares', a: SQUARE, b: SHIFTED, operation: 'intersection' },
    { id: 'park', label: 'A park with a pond, and a river', a: PARK, b: RIVER, operation: 'intersection' },
    { id: 'points', label: 'Scattered points', a: POINTS, b: '', operation: 'voronoi' },
    { id: 'coast', label: 'A coastline', a: COAST, b: '', operation: 'maximumInscribedCircle' },
    { id: 'bowtie', label: 'A self-crossing bowtie', a: BOWTIE, b: '', operation: 'makeValid' },
];

const PREDICATES = ['intersects', 'overlaps', 'crosses', 'touches', 'contains', 'within', 'covers', 'coveredBy', 'equals', 'disjoint'];

function Matrix({ tokens, relation }) {
    const cell = { fontFamily: tokens.mono, fontSize: 12.5, padding: '4px 0', textAlign: 'center', border: `1px solid ${tokens.border}` };
    const head = { ...cell, color: tokens.textMuted, fontSize: 11, border: 'none' };
    const parts = ['I', 'B', 'E'];
    return (
        <div>
            <Label tokens={tokens}>HOW A AND B RELATE (DE-9IM)</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 220px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                        <tr>
                            <th style={head} />
                            {parts.map((part) => <th key={part} style={head}>{`B ${part}`}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {parts.map((part, row) => (
                            <tr key={part}>
                                <th style={head}>{`A ${part}`}</th>
                                {[0, 1, 2].map((column) => {
                                    const value = relation.matrix[row * 3 + column];
                                    return <td key={column} style={{ ...cell, color: value === 'F' ? tokens.textMuted : tokens.text }}>{value}</td>;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ fontFamily: tokens.mono, fontSize: 12, lineHeight: 1.7, color: tokens.accentText }}>
                    {PREDICATES.filter((name) => relation[name]).map((name) => <div key={name}>{`${name} ✓`}</div>)}
                </div>
            </div>
            <Meta tokens={tokens}>{`Rows are A's interior, boundary and exterior, columns B's. Each cell is the dimension where they meet: 2 an area, 1 a line, 0 points, F nowhere.`}</Meta>
        </div>
    );
}

const LAB_WRAPPER = `// src/native/geometry_lab.h (excerpt)
GEOSGeometry* apply(const std::string& operation, const GEOSGeometry* a,
                    const GEOSGeometry* b, double parameter) {
    GEOSContextHandle_t context = geos.context;
    if (operation == "intersection") return GEOSIntersection_r(context, a, b);
    if (operation == "union") return GEOSUnion_r(context, a, b);
    if (operation == "buffer") return GEOSBuffer_r(context, a, parameter, 8);
    if (operation == "makeValid") return GEOSMakeValid_r(context, a);
    if (operation == "maximumInscribedCircle") return GEOSMaximumInscribedCircle_r(context, a, parameter);
    // ...ten more, then the ones that work on A and B together
    const auto both = together(a, b);
    if (operation == "voronoi") return GEOSVoronoiDiagram_r(context, both.get(), nullptr, 0, 0);
    if (operation == "delaunay") return GEOSDelaunayTriangulation_r(context, both.get(), 0, 0);
    throw std::invalid_argument("unknown operation " + operation);
}`;

const LAB_USAGE = `const m = await initNative();
const lab = await new m.GeometryLab();
const park = 'POLYGON ((0 0, 60 0, 60 40, 0 40, 0 0), (35 15, 45 15, 45 25, 35 25, 35 15))';
const river = 'LINESTRING (-10 30, 20 30, 40 20, 70 20)';

const inside = JSON.parse(await lab.run('intersection', park, river, 0));
// inside.wkt: MULTILINESTRING ((0 30, 20 30, 35 22.5), (45 20, 60 20))
// inside.length: 51.77, the river's length in the park, pond excluded
const relation = JSON.parse(await lab.relate(park, river));
// relation.matrix: '1F20F1102', relation.crosses: true`;

export function GeometryLab({ tokens, index, load }) {
    const [preset, setPreset] = useState(PRESETS[0].id);
    const [a, setA] = useState(PRESETS[0].a);
    const [b, setB] = useState(PRESETS[0].b);
    const [operation, setOperation] = useState(PRESETS[0].operation);
    const [parameter, setParameter] = useState('');
    const [state, run] = useNativeTask(load);
    const chosen = operationOf(operation);
    const pickOperation = (id) => {
        setOperation(id);
        setParameter(operationOf(id).parameter?.value ?? '');
    };
    const pickPreset = (id) => {
        const next = PRESETS.find((item) => item.id === id);
        setPreset(id);
        setA(next.a);
        setB(next.b);
        pickOperation(next.operation);
    };
    const start = () =>
        run(async (m) => {
            const value = chosen.parameter ? Number(parameter) : 0;
            if (chosen.parameter && (parameter.trim() === '' || !Number.isFinite(value))) throw new Error(`${chosen.parameter.label.toLowerCase()} must be a number`);
            const lab = await new m.GeometryLab();
            const first = a.trim();
            const second = b.trim();
            const result = JSON.parse(await lab.run(operation, first, second, value));
            const shapeA = JSON.parse(await lab.describe(first));
            const shapeB = second ? JSON.parse(await lab.describe(second)) : null;
            let relation = null;
            if (shapeB) {
                try {
                    relation = JSON.parse(await lab.relate(first, second));
                } catch (error) {
                    relation = { error: error?.message ?? String(error) };
                }
            }
            return { operation, result, a: shapeA, b: shapeB, relation };
        });
    const done = state.status === 'ready' ? state.result : null;
    const inscribed = done?.operation === 'maximumInscribedCircle' && done.result.geojson.coordinates.length === 2;
    return (
        <AppCard
            tokens={tokens}
            id="geos-lab"
            index={index}
            status={state.status}
            title="Fifteen geometry operations on shapes you can edit"
            pitch="Pick two shapes or type your own as WKT, then run an overlay, a buffer, a hull, a triangulation or a repair. The result is drawn over the inputs with its measurements, next to the DE-9IM matrix of how the two shapes relate. This is the engine PostGIS, QGIS, GDAL and Shapely call, built from the same C++."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="SHAPES" value={preset} onChange={pickPreset}>
                        {PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </Select>
                    <WktField tokens={tokens} label="A, AS WKT" value={a} onChange={setA} />
                    <WktField tokens={tokens} label="B, AS WKT (OPTIONAL)" value={b} onChange={setB} rows={2} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                        <Select tokens={tokens} label="OPERATION" value={operation} onChange={pickOperation}>
                            {[...new Set(OPERATIONS.map((item) => item.group))].map((group) => (
                                <optgroup key={group} label={group}>
                                    {OPERATIONS.filter((item) => item.group === group).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                                </optgroup>
                            ))}
                        </Select>
                        {chosen.parameter ? (
                            <label style={{ display: 'block', minWidth: 0 }}>
                                <Label tokens={tokens}>{chosen.parameter.label}</Label>
                                <input type="number" step="any" value={parameter} onInput={(event) => setParameter(event.target.value)} style={fieldStyle(tokens)} />
                            </label>
                        ) : null}
                    </div>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Run GEOS</RunButton>
                    </div>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <div>
                            <Drawing
                                tokens={tokens}
                                label={`${done.result.type} drawn over the input shapes`}
                                frame={done.operation === 'voronoi' ? [done.a.geojson, done.b?.geojson] : [done.a.geojson, done.b?.geojson, done.result.geojson]}
                                layers={[
                                    { geometry: done.a.geojson, fill: tokens.textMuted, fillOpacity: 0.12, stroke: tokens.textDim },
                                    { geometry: done.b?.geojson, fill: tokens.textMuted, fillOpacity: 0.08, stroke: tokens.textMuted, dashed: true },
                                    { geometry: done.result.geojson, fill: tokens.accent, fillOpacity: 0.3, stroke: tokens.accent, width: 2 },
                                ]}
                                circles={inscribed ? [{ center: done.result.geojson.coordinates[0], radius: done.result.length, stroke: tokens.accent }] : []}
                            />
                            <Meta tokens={tokens}>A is the solid outline, B the dashed one, the result is green.</Meta>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 14 }}>
                            <Stat tokens={tokens} size={26} accent value={done.result.type} label={done.result.empty ? 'empty' : `${formatted(done.result.parts)} part${done.result.parts === 1 ? '' : 's'}`} />
                            <Stat tokens={tokens} size={26} value={formatted(done.result.area)} label="area" />
                            <Stat tokens={tokens} size={26} value={formatted(done.result.length)} label={inscribed ? 'radius' : 'length'} />
                            <Stat tokens={tokens} size={26} value={formatted(done.result.points)} label="vertices" />
                        </div>
                        {done.relation?.matrix ? <Matrix tokens={tokens} relation={done.relation} /> : null}
                        {done.relation?.error ? <Meta tokens={tokens}>{`No DE-9IM matrix for these shapes: ${done.relation.error}`}</Meta> : null}
                        <div>
                            <Label tokens={tokens}>{`RESULT AS WKT${done.result.valid ? '' : ' · NOT VALID'}`}</Label>
                            <WktBox tokens={tokens} wkt={done.result.wkt} />
                        </div>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Run an operation to draw its result over the two shapes.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/geometry_lab.h', code: LAB_WRAPPER },
                { file: 'main.js', code: LAB_USAGE },
            ]}
        />
    );
}
GeometryLab.appId = 'geos-lab';

const BROKEN = [
    { id: 'bowtie', label: 'A bowtie: the ring crosses itself', wkt: BOWTIE },
    { id: 'leaky', label: 'A hole that leaks out of its shell', wkt: 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (5 5, 15 5, 15 15, 5 15, 5 5))' },
    { id: 'outside', label: 'A hole outside its shell', wkt: 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (12 2, 18 2, 18 8, 12 8, 12 2))' },
    { id: 'touching', label: 'A ring that touches itself', wkt: 'POLYGON ((0 0, 10 0, 10 10, 5 10, 7 6, 3 6, 5 10, 0 10, 0 0))' },
    { id: 'spike', label: 'A zero-width spike', wkt: 'POLYGON ((0 0, 10 0, 10 10, 5 10, 5 16, 5 10, 0 10, 0 0))' },
    { id: 'overlap', label: 'Two parts that overlap', wkt: 'MULTIPOLYGON (((0 0, 10 0, 10 10, 0 10, 0 0)), ((5 5, 15 5, 15 15, 5 15, 5 5)))' },
    { id: 'flat', label: 'A part flattened into a line', wkt: 'MULTIPOLYGON (((0 0, 10 0, 10 10, 0 10, 0 0)), ((12 0, 18 0, 15 0, 12 0)))' },
];

const DOCTOR_WRAPPER = `// src/native/validity_doctor.h (excerpt)
const char valid = GEOSisValidDetail_r(geos.context, geometry.get(), flags, &reason, &location);

GEOSMakeValidParams* params = GEOSMakeValidParams_create_r(geos.context);
GEOSMakeValidParams_setMethod_r(geos.context, params,
    method == "structure" ? GEOS_MAKE_VALID_STRUCTURE : GEOS_MAKE_VALID_LINEWORK);
GEOSMakeValidParams_setKeepCollapsed_r(geos.context, params, keepCollapsed ? 1 : 0);
GEOSGeometry* repaired = GEOSMakeValidWithParams_r(geos.context, geometry.get(), params);
GEOSMakeValidParams_destroy_r(geos.context, params);`;

const DOCTOR_USAGE = `const m = await initNative();
const doctor = await new m.ValidityDoctor();
const leaky = 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (5 5, 15 5, 15 15, 5 15, 5 5))';

const found = JSON.parse(await doctor.check(leaky, false));
// found.reason: 'Self-intersection', found.location: [5, 10]
const linework = JSON.parse(await doctor.repair(leaky, 'linework', false));
const structure = JSON.parse(await doctor.repair(leaky, 'structure', false));
// linework.area: 150 in 2 parts; structure.area: 75, the shell minus its hole`;

function RepairPanel({ tokens, title, input, repaired }) {
    return (
        <div style={{ minWidth: 0 }}>
            <Label tokens={tokens}>{title}</Label>
            <Drawing
                tokens={tokens}
                label={`${title.toLowerCase()}: ${repaired.type}`}
                frame={[input.geojson, repaired.geojson]}
                maxHeight={200}
                layers={[
                    { geometry: input.geojson, stroke: tokens.textMuted, dashed: true, width: 1 },
                    { geometry: repaired.geojson, fill: tokens.accent, fillOpacity: 0.3, stroke: tokens.accent, width: 2 },
                ]}
            />
            <Meta tokens={tokens}>{`${repaired.type} · ${repaired.parts} part${repaired.parts === 1 ? '' : 's'} · area ${formatted(repaired.area)} · ${repaired.valid ? 'valid' : 'still invalid'}`}</Meta>
        </div>
    );
}

export function ValidityDoctor({ tokens, index, load }) {
    const [sample, setSample] = useState(BROKEN[1].id);
    const [wkt, setWkt] = useState(BROKEN[1].wkt);
    const [allowSelfTouching, setAllowSelfTouching] = useState(false);
    const [keepCollapsed, setKeepCollapsed] = useState(false);
    const [state, run] = useNativeTask(load);
    const pickSample = (id) => {
        setSample(id);
        setWkt(BROKEN.find((item) => item.id === id).wkt);
    };
    const start = () =>
        run(async (m) => {
            const doctor = await new m.ValidityDoctor();
            const shape = wkt.trim();
            return {
                diagnosis: JSON.parse(await doctor.check(shape, allowSelfTouching)),
                linework: JSON.parse(await doctor.repair(shape, 'linework', keepCollapsed)),
                structure: JSON.parse(await doctor.repair(shape, 'structure', keepCollapsed)),
            };
        });
    const done = state.status === 'ready' ? state.result : null;
    const diagnosis = done?.diagnosis;
    return (
        <AppCard
            tokens={tokens}
            id="geos-doctor"
            index={index}
            status={state.status}
            title="Find out why a polygon is invalid, then repair it two ways"
            pitch="Invalid polygons break overlays and spatial joins. GEOS names the problem and marks where it is, then repairs the shape with either of its two methods: one rebuilds the shape from all of its edges, the other keeps shells as shells and holes as holes. They agree on some shapes and not on others. jsts 2.12.1, the JavaScript port of the same Java library, has no GeometryFixer, the class behind the second method."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="BROKEN SHAPE" value={sample} onChange={pickSample}>
                        {BROKEN.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </Select>
                    <WktField tokens={tokens} label="OR YOUR OWN, AS WKT" value={wkt} onChange={setWkt} rows={4} />
                    <Toggle tokens={tokens} checked={allowSelfTouching} onChange={setAllowSelfTouching}>
                        Accept a ring that touches itself to enclose a hole, as ESRI's model does
                    </Toggle>
                    <Toggle tokens={tokens} checked={keepCollapsed} onChange={setKeepCollapsed}>
                        Keep parts that collapsed into lines (structure method)
                    </Toggle>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Diagnose and repair</RunButton>
                    </div>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <Stat
                            tokens={tokens}
                            warn={!diagnosis.valid}
                            accent={diagnosis.valid}
                            value={diagnosis.valid ? 'Valid' : diagnosis.reason}
                            label={diagnosis.valid ? 'GEOS finds nothing wrong' : `what GEOS found${diagnosis.location ? `, at ${diagnosis.location.map((value) => formatted(value)).join(', ')} (marked below)` : ''}`}
                        />
                        <Drawing
                            tokens={tokens}
                            label="The shape as given, with the problem marked"
                            layers={[{ geometry: diagnosis.shape.geojson, fill: tokens.textMuted, fillOpacity: 0.14, stroke: tokens.textDim }]}
                            markers={diagnosis.location ? [{ at: diagnosis.location, stroke: tokens.warn }] : []}
                            maxHeight={240}
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
                            <RepairPanel tokens={tokens} title="LINEWORK METHOD" input={diagnosis.shape} repaired={done.linework} />
                            <RepairPanel tokens={tokens} title="STRUCTURE METHOD" input={diagnosis.shape} repaired={done.structure} />
                        </div>
                        <Meta tokens={tokens}>{done.linework.wkt === done.structure.wkt ? 'Both methods return the same shape here.' : 'The two methods disagree on this shape.'}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Pick a broken shape, or paste one, to see what is wrong and both repairs.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/validity_doctor.h', code: DOCTOR_WRAPPER },
                { file: 'main.js', code: DOCTOR_USAGE },
            ]}
        />
    );
}
ValidityDoctor.appId = 'geos-doctor';

const COVERAGE_WRAPPER = `// src/native/coverage_lab.h (excerpt)
// One region at a time: each shared border is simplified twice, once per neighbour.
for (int index = 0; index < geos.parts(map.get()); index += 1) {
    each.push_back(geos.own(GEOSTopologyPreserveSimplify_r(
        geos.context, GEOSGetGeometryN_r(geos.context, map.get(), index), tolerance)));
}
// As one coverage: each shared border is simplified once, for both neighbours.
const auto together = geos.own(GEOSCoverageSimplifyVW_r(geos.context, map.get(), tolerance, 0));

// The audit: what the regions no longer cover, and whether GEOS still sees a coverage.
const auto merged = geos.own(GEOSUnaryUnion_r(geos.context, regions));
const auto gaps = geos.own(GEOSDifference_r(geos.context, square.get(), merged.get()));
const int result = GEOSCoverageIsValid_r(geos.context, regions, 0, nullptr);`;

const COVERAGE_USAGE = `const m = await initNative();
const lab = await new m.CoverageLab(6);   // 36 regions sharing wiggly borders
const result = JSON.parse(await lab.simplify(2));

// result.separately: 430 vertices, gaps 356.917, overlaps 186.433, 155 slivers
// result.coverage:   506 vertices, gaps 0, overlaps 0, coverageValid true`;

function CoveragePanel({ tokens, title, side }) {
    return (
        <div style={{ minWidth: 0 }}>
            <Label tokens={tokens}>{title}</Label>
            <Drawing
                tokens={tokens}
                label={`${title.toLowerCase()}: ${side.slivers} slivers`}
                frame={side.regionsGeojson}
                maxHeight={300}
                layers={[
                    ...side.regionsGeojson.map((geometry) => ({ geometry, stroke: tokens.textDim, width: 1 })),
                    { geometry: side.gaps, fill: tokens.warn, fillOpacity: 0.9 },
                    { geometry: side.overlaps, fill: tokens.warn, fillOpacity: 0.35, stroke: tokens.warn, width: 1 },
                ]}
            />
            <Meta tokens={tokens}>
                {`${formatted(side.vertices)} vertices · gaps ${formatted(side.gapArea)} · overlaps ${formatted(side.overlapArea)} · ${side.coverageValid ? 'borders still shared' : `${formatted(side.slivers)} slivers`}`}
            </Meta>
        </div>
    );
}

export function CoverageSimplifier({ tokens, index, load }) {
    const [tolerance, setTolerance] = useState('2');
    const [state, run] = useNativeTask(load);
    const start = () =>
        run(async (m) => {
            const lab = await new m.CoverageLab(6);
            const original = JSON.parse(await lab.original());
            return { original, ...JSON.parse(await lab.simplify(Number(tolerance))) };
        });
    const done = state.status === 'ready' ? state.result : null;
    return (
        <AppCard
            tokens={tokens}
            id="geos-coverage"
            index={index}
            status={state.status}
            title="Simplify a map without opening gaps between regions"
            pitch="Simplify each region of a map on its own and neighbours stop agreeing on their borders: slivers of gap and overlap open along every edge they share. GEOS can simplify the map as one coverage instead, so each border is simplified once and stays shared. jsts 2.12.1, the JavaScript port of the same Java library, has no coverage package."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <Select tokens={tokens} label="TOLERANCE" value={tolerance} onChange={setTolerance}>
                        {['1', '2', '3', '4'].map((value) => <option key={value} value={value}>{`${value} ${value === '1' ? 'unit' : 'units'}${value === '2' ? ' (default)' : ''}`}</option>)}
                    </Select>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Simplify the map</RunButton>
                    </div>
                    <Hint tokens={tokens}>
                        The map is 36 regions in a 100 × 100 square, generated in the module. Every inner border is computed once and shared by its two regions, as in a
                        real administrative map. Both methods get the same tolerance: GEOSTopologyPreserveSimplify for each region alone, GEOSCoverageSimplifyVW for the
                        coverage.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 16 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16 }}>
                            <Stat tokens={tokens} size={26} warn value={formatted(done.separately.gapArea + done.separately.overlapArea)} label="square units of gap and overlap, one region at a time" />
                            <Stat tokens={tokens} size={26} accent value={formatted(done.coverage.gapArea + done.coverage.overlapArea)} label="as one coverage" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
                            <CoveragePanel tokens={tokens} title="ONE REGION AT A TIME" side={done.separately} />
                            <CoveragePanel tokens={tokens} title="AS ONE COVERAGE" side={done.coverage} />
                        </div>
                        <Meta tokens={tokens}>{`From ${formatted(done.original.vertices)} vertices in ${done.original.regions} regions. Gaps are solid, overlaps are outlined; GEOSCoverageIsValid checks that the borders still match.`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Simplify the map to compare the two methods, border by border.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/coverage_lab.h', code: COVERAGE_WRAPPER },
                { file: 'main.js', code: COVERAGE_USAGE },
            ]}
        />
    );
}
CoverageSimplifier.appId = 'geos-coverage';

export const GEOS_APPS = [GeometryLab, ValidityDoctor, CoverageSimplifier];

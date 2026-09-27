import { useRef, useState } from 'react';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from '../AppCard.jsx';
import { grouped, Meta, Placeholder, Stat } from '../controls.jsx';
import { BACKDROP, boundsOf, counted, GeoMap, LicenceNote, makeView, MAX_ROWS, once, PRESETS, Stats, withPlainErrors } from './shared.jsx';

const TABLE_ROWS = 50;

function Chips({ tokens, items, active, onPick }) {
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {items.map((item) => (
                <button
                    key={item.id}
                    type="button"
                    className="tap-target"
                    onClick={() => onPick(item)}
                    style={{
                        background: 'none',
                        color: item.id === active ? tokens.accentText : tokens.textDim,
                        border: `1px solid ${item.id === active ? tokens.accent : tokens.border}`,
                        borderRadius: 999,
                        padding: '4px 10px',
                        fontFamily: tokens.mono,
                        fontSize: 11.5,
                        cursor: 'pointer',
                    }}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}

const isGeometry = (value) => Boolean(value && typeof value === 'object' && value.geometry);

function cellText(value) {
    if (value === null) return 'NULL';
    if (isGeometry(value)) return `${value.type} · SRID ${value.srid}`;
    if (typeof value === 'object') return `BLOB · ${grouped(value.blob)} B`;
    const text = String(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function ResultTable({ tokens, result }) {
    if (!result.columns.length) return <Meta tokens={tokens} flush>{`${counted(result.statements, 'statement')} ran; none returned rows.`}</Meta>;
    const cell = { padding: '6px 10px', borderBottom: `1px solid ${tokens.border}`, whiteSpace: 'nowrap', textAlign: 'left' };
    return (
        <div style={{ maxHeight: 280, overflow: 'auto', border: `1px solid ${tokens.border}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                    <tr>
                        {result.columns.map((column, position) => (
                            <th key={position} style={{ ...cell, position: 'sticky', top: 0, background: tokens.panel, fontFamily: tokens.mono, fontWeight: 600, color: tokens.textDim }}>
                                {column}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {result.rows.slice(0, TABLE_ROWS).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {row.map((value, position) => (
                                <td key={position} style={{ ...cell, fontFamily: tokens.mono, textAlign: typeof value === 'number' ? 'right' : 'left', color: value === null || typeof value === 'object' ? tokens.textMuted : tokens.text }}>
                                    {cellText(value)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// What a result draws: every geometry cell, shaded by the first number in its row when the
// geometries are areas, over the 2,000 points when the result is in longitude and latitude.
function resultDrawing(tokens, result, points) {
    const numbers = result.columns.map((name, position) => !['id', 'pos'].includes(name) && result.rows.length > 0 && result.rows.every((row) => typeof row[position] === 'number'));
    const weightAt = numbers.indexOf(true);
    const features = result.rows.flatMap((row) => row.filter(isGeometry).map((cell) => ({ geometry: cell.geometry, srid: cell.srid, weight: weightAt === -1 ? null : row[weightAt] })));
    if (!features.length) return null;
    const geographic = features.every((feature) => feature.srid === 4326);
    const box = boundsOf(features.map((feature) => feature.geometry));
    const heaviest = Math.max(...features.map((feature) => feature.weight ?? 0));
    const shaded = weightAt !== -1 && heaviest > 0 && features.some((feature) => /Polygon/.test(feature.geometry.type));
    const backdrop = geographic ? [{ features: points.map(([lon, lat]) => ({ geometry: { type: 'Point', coordinates: [lon, lat] } })), stroke: tokens.textMuted, radius: 1.2, pointOpacity: 0.45 }] : [];
    return {
        count: features.length,
        geographic,
        weight: shaded ? result.columns[weightAt] : null,
        view: makeView(box, geographic),
        layers: [
            ...backdrop,
            {
                features,
                stroke: tokens.accent,
                fill: tokens.accent,
                width: 1.2,
                radius: 3,
                fillOpacity: shaded ? (feature) => 0.1 + (0.75 * (feature.weight ?? 0)) / heaviest : 0.22,
            },
        ],
    };
}

const PLAYGROUND_WRAPPER = `// src/native/spatial_playground.h (excerpt)
SpatialPlayground() : connection(":memory:") {
    // spatial::Connection opened SQLite, then called spatialite_alloc_connection
    // and spatialite_init_ex; the sample SQL runs InitSpatialMetaData(1),
    // creates cities, pois and hexagons and calls CreateSpatialIndex
    spatial::exec(connection.get(), sample::PLAYGROUND);
}

std::string run(const std::string& sql, int limit) {
    // ...
    while (rest < end) {   // every statement in turn
        sqlite3_prepare_v2(db, rest, static_cast<int>(end - rest), &raw, &rest);
        // ...
        if (sqlite3_column_count(raw) > 0) rows = writer.rows(raw, limit);
    }
    // ...
}

// src/support/spatial_sql.h: a geometry cell goes back as GeoJSON
geometry(prepare(db, "SELECT AsGeoJSON(?1, 6), GeometryType(?1), SRID(?1)"))`;

const PLAYGROUND_USAGE = `const m = await initNative();
const playground = await new m.SpatialPlayground();
const result = JSON.parse(await playground.run(\`
    SELECT h.id, count(*) AS pois, h.geom
    FROM hexagons AS h JOIN pois AS p ON p.ROWID IN (
        SELECT ROWID FROM SpatialIndex
        WHERE f_table_name = 'pois' AND search_frame = h.geom)
    AND ST_Contains(h.geom, p.geom)
    GROUP BY h.id ORDER BY pois DESC, h.id\`, 2000));
// result.total: 53 hexagons with points
// result.rows[0]: [164, 497, { geometry: { type: 'Polygon', ... }, type: 'POLYGON', srid: 4326 }]`;

export function SqlPlayground({ tokens, index, load }) {
    const [sql, setSql] = useState(PRESETS[0].sql);
    const [active, setActive] = useState(PRESETS[0].id);
    const [state, run] = useNativeTask(load);
    const session = useRef(null);
    const execute = (text) =>
        run(
            withPlainErrors(async (m) => {
                if (!session.current) {
                    const playground = await new m.SpatialPlayground();
                    session.current = { playground, points: JSON.parse(await playground.run(BACKDROP, MAX_ROWS)).rows };
                }
                const started = performance.now();
                const result = JSON.parse(await session.current.playground.run(text, MAX_ROWS));
                return { result, ms: performance.now() - started, drawing: resultDrawing(tokens, result, session.current.points) };
            }),
        );
    const pick = (preset) => {
        setSql(preset.sql);
        setActive(preset.id);
        if (session.current) execute(preset.sql);
    };
    const done = state.status === 'ready' ? state.result : null;
    return (
        <AppCard
            tokens={tokens}
            id="spatialite-playground"
            index={index}
            status={state.status}
            title="Spatial SQL, with the answer drawn as a map"
            pitch="PostGIS-style SQL in a SpatiaLite database inside this tab, over 2,000 points of interest generated around twelve Turkish cities. Pick a query or write your own: a spatial join through the R*Tree index, nearest neighbours with KNN2, buffers merged with ST_Union, Voronoi cells, a transform to UTM. Every geometry the query returns is drawn above its rows."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div>
                        <Label tokens={tokens}>QUERIES</Label>
                        <Chips tokens={tokens} items={PRESETS} active={active} onPick={pick} />
                    </div>
                    <label style={{ display: 'block', minWidth: 0 }}>
                        <Label tokens={tokens}>SQL</Label>
                        <textarea
                            value={sql}
                            rows={8}
                            spellCheck={false}
                            onInput={(event) => {
                                setSql(event.target.value);
                                setActive(null);
                            }}
                            style={{ ...fieldStyle(tokens), resize: 'vertical', fontSize: 12 }}
                        />
                    </label>
                    <div>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={() => execute(sql)}>
                            Run the query
                        </RunButton>
                    </div>
                    <Meta tokens={tokens} flush>
                        Tables: pois (id, kind, city, geom), hexagons (id, geom) and cities (id, name, geom), all in EPSG:4326, with spatial indexes on pois and hexagons.
                    </Meta>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 14 }}>
                        {done.drawing ? (
                            <div style={{ display: 'grid', gap: 8 }}>
                                <GeoMap tokens={tokens} view={done.drawing.view} layers={done.drawing.layers} label={`${counted(done.drawing.count, 'geometry')} from the query`} />
                                <Meta tokens={tokens} flush>
                                    {`${done.drawing.geographic ? 'Longitude and latitude; the grey dots are the 2,000 points.' : 'Projected coordinates, in metres.'}${done.drawing.weight ? ` Shaded by ${done.drawing.weight}.` : ''}`}
                                </Meta>
                            </div>
                        ) : (
                            <Meta tokens={tokens} flush>The result has no geometry to draw.</Meta>
                        )}
                        <Stats>
                            <Stat tokens={tokens} size={24} accent value={grouped(done.result.total)} label={done.result.total === 1 ? 'row' : 'rows'} />
                            <Stat tokens={tokens} size={24} value={grouped(done.drawing?.count ?? 0)} label="geometries drawn" />
                            <Stat tokens={tokens} size={24} value={once(done.ms)} label="query in this tab" />
                        </Stats>
                        <ResultTable tokens={tokens} result={done.result} />
                        {done.result.total > TABLE_ROWS ? <Meta tokens={tokens} flush>{`The table shows the first ${TABLE_ROWS} of ${grouped(done.result.total)} rows.`}</Meta> : null}
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Run a query to see its rows and draw its geometries.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/spatial_playground.h', code: PLAYGROUND_WRAPPER },
                { file: 'main.js', code: PLAYGROUND_USAGE },
            ]}
        />
    );
}
SqlPlayground.appId = 'spatialite-playground';

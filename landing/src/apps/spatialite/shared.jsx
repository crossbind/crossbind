import { REPO_URL } from '../../data.js';
import { grouped } from '../controls.jsx';

export const MAX_ROWS = 2000;

export const counted = (value, noun) => `${grouped(value)} ${noun}${value === 1 ? '' : 's'}`;
// One run, timed with a clock browsers coarsen to about a tenth of a millisecond.
export const once = (value) => (value < 0.1 ? '< 0.1 ms' : `${value.toFixed(1)} ms`);
// A wasm build puts the C++ type in front of an exception's message and keeps the text in cppMessage.
const messageOf = (error) => error?.cppMessage ?? error?.message ?? String(error);
export const withPlainErrors = (task) => async (m) => {
    try {
        return await task(m);
    } catch (error) {
        throw new Error(messageOf(error));
    }
};

export function Stats({ children }) {
    return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14 }}>{children}</div>;
}

// Serving SpatiaLite in this page conveys it and the LGPL libraries linked with it, so every app
// links their sources and licences.
export function LicenceNote({ tokens }) {
    const external = { target: '_blank', rel: 'noreferrer', style: { color: tokens.accentText, textDecoration: 'underline', textUnderlineOffset: 3 } };
    return (
        <span>
            {'Runs SpatiaLite, licensed MPL-1.1, GPL-2.0+ or LGPL-2.1+ at your choice, with GEOS and GNU libiconv under the LGPL: '}
            <a href="https://www.gaia-gis.it/fossil/libspatialite/index" {...external}>source</a>
            {' · '}
            <a href={`${REPO_URL}/blob/main/ports/spatialite/base/LICENSE`} {...external}>licence</a>
            {' · '}
            <a href={`${REPO_URL}/tree/main/ports/spatialite`} {...external}>build recipe</a>
        </span>
    );
}

// --- Drawing GeoJSON ---------------------------------------------------------------------------

// GeoJSON as the parts SVG draws: polygons with their holes, lines and points.
function simpleParts(geometry, out = []) {
    if (!geometry) return out;
    const { type, coordinates } = geometry;
    if (type === 'GeometryCollection') geometry.geometries.forEach((part) => simpleParts(part, out));
    else if (type === 'Polygon') out.push({ type: 'polygon', rings: coordinates.filter((ring) => ring.length) });
    else if (type === 'MultiPolygon') coordinates.forEach((rings) => out.push({ type: 'polygon', rings: rings.filter((ring) => ring.length) }));
    else if (type === 'LineString' && coordinates.length) out.push({ type: 'line', points: coordinates });
    else if (type === 'MultiLineString') coordinates.filter((points) => points.length).forEach((points) => out.push({ type: 'line', points }));
    else if (type === 'Point' && coordinates.length) out.push({ type: 'point', points: [coordinates] });
    else if (type === 'MultiPoint') coordinates.forEach((point) => out.push({ type: 'point', points: [point] }));
    return out;
}

export function boundsOf(geometries) {
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

// Longitude and latitude are drawn with longitudes shortened by the cosine of the middle latitude,
// the way a local map keeps shapes in proportion; any other CRS is drawn as plane coordinates.
export function makeView(box, geographic) {
    const [minX, minY, maxX, maxY] = box;
    const k = geographic ? Math.cos((((minY + maxY) / 2) * Math.PI) / 180) : 1;
    const spanX = Math.max((maxX - minX) * k, (maxY - minY) * 0.3, 1e-9);
    const spanY = Math.max(maxY - minY, spanX * 0.3, 1e-9);
    const scale = Math.min(640 / spanX, 420 / spanY) / 1.12;
    const width = spanX * scale * 1.12;
    const height = spanY * scale * 1.12;
    const cx = ((minX + maxX) / 2) * k;
    const cy = (minY + maxY) / 2;
    return {
        width,
        height,
        x: (lon) => (lon * k - cx) * scale + width / 2,
        y: (lat) => height / 2 - (lat - cy) * scale,
        lon: (px) => ((px - width / 2) / scale + cx) / k,
        lat: (py) => cy - (py - height / 2) / scale,
    };
}

// Layers of features ({ geometry, weight }) drawn in one view. A layer's fillOpacity may depend on
// the feature, which shades polygons by a value; clicks report longitude and latitude to onPick.
export function GeoMap({ tokens, view, layers, onPick, label }) {
    const x = (value) => view.x(value).toFixed(2);
    const y = (value) => view.y(value).toFixed(2);
    const path = (points, close) => points.map(([px, py], at) => `${at ? 'L' : 'M'}${x(px)} ${y(py)}`).join('') + (close ? 'Z' : '');
    const pick = onPick
        ? (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onPick(view.lon(((event.clientX - rect.left) / rect.width) * view.width), view.lat(((event.clientY - rect.top) / rect.height) * view.height));
          }
        : undefined;
    return (
        <svg
            viewBox={`0 0 ${view.width.toFixed(2)} ${view.height.toFixed(2)}`}
            role="img"
            aria-label={label}
            onClick={pick}
            style={{ display: 'block', width: '100%', height: 'auto', overflow: 'hidden', background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 10, cursor: onPick ? 'crosshair' : 'default' }}
        >
            {layers.map((layer, layerIndex) => (
                <g key={layerIndex}>
                    {layer.features.flatMap((feature, featureIndex) =>
                        simpleParts(feature.geometry).map((part, partIndex) =>
                            part.type === 'point' ? (
                                <circle key={`${featureIndex}.${partIndex}`} cx={x(part.points[0][0])} cy={y(part.points[0][1])} r={layer.radius ?? 2.5} fill={layer.stroke} fillOpacity={layer.pointOpacity ?? 1} />
                            ) : (
                                <path
                                    key={`${featureIndex}.${partIndex}`}
                                    d={part.type === 'polygon' ? part.rings.map((ring) => path(ring, true)).join('') : path(part.points, false)}
                                    fill={part.type === 'polygon' && layer.fill ? layer.fill : 'none'}
                                    fillOpacity={typeof layer.fillOpacity === 'function' ? layer.fillOpacity(feature) : (layer.fillOpacity ?? 0.25)}
                                    fillRule="evenodd"
                                    stroke={layer.stroke ?? 'none'}
                                    strokeWidth={layer.width ?? 1}
                                    strokeOpacity={layer.strokeOpacity ?? 1}
                                    strokeLinejoin="round"
                                    vectorEffect="non-scaling-stroke"
                                />
                            ),
                        ),
                    )}
                </g>
            ))}
        </svg>
    );
}

// The same queries index.html checks against the independent answers.
export const PRESETS = [
    {
        id: 'hexbin',
        label: 'Points per hexagon',
        sql: `SELECT h.id, count(*) AS pois, h.geom
FROM hexagons AS h JOIN pois AS p ON p.ROWID IN (
    SELECT ROWID FROM SpatialIndex WHERE f_table_name = 'pois' AND search_frame = h.geom)
AND ST_Contains(h.geom, p.geom)
GROUP BY h.id ORDER BY pois DESC, h.id`,
    },
    {
        id: 'knn',
        label: 'Five nearest to Ankara',
        sql: `SELECT k.pos, p.id, p.kind, CAST(Round(k.distance_m) AS INTEGER) AS metres, p.geom
FROM KNN2 AS k JOIN pois AS p ON p.id = k.fid
WHERE k.f_table_name = 'pois' AND k.ref_geometry = MakePoint(32.8597, 39.9334, 4326)
AND k.radius = 0.5 AND k.max_items = 5
ORDER BY k.pos`,
    },
    {
        id: 'within',
        label: 'Within 25 km of Istanbul',
        sql: `SELECT id, kind, CAST(Round(ST_Distance(geom, MakePoint(28.9784, 41.0082, 4326), 1)) AS INTEGER) AS metres, geom
FROM pois
WHERE ROWID IN (SELECT ROWID FROM SpatialIndex WHERE f_table_name = 'pois'
                AND search_frame = BuildCircleMbr(28.9784, 41.0082, 0.4))
AND ST_Distance(geom, MakePoint(28.9784, 41.0082, 4326), 1) <= 25000
ORDER BY metres`,
    },
    {
        id: 'dissolve',
        label: "Izmir's parks, 5 km around",
        sql: `SELECT parks, NumGeometries(zones) AS zones, Round(ST_Area(zones) / 1e6, 1) AS km2, ST_Transform(zones, 4326) AS geom
FROM (SELECT count(*) AS parks, ST_Union(ST_Buffer(ST_Transform(geom, 32635), 5000)) AS zones
      FROM pois WHERE kind = 'park' AND city = 'Izmir')`,
    },
    {
        id: 'voronoi',
        label: "Ankara's schools, Voronoi",
        sql: `SELECT schools, NumGeometries(cells) AS cells, cells AS geom
FROM (SELECT count(*) AS schools, VoronojDiagram(ST_Collect(geom)) AS cells FROM pois WHERE kind = 'school' AND city = 'Ankara')`,
    },
    {
        id: 'utm',
        label: 'Bursa in UTM zone 35N',
        sql: `SELECT id, kind, X(utm) AS easting, Y(utm) AS northing, utm AS geom
FROM (SELECT id, kind, ST_Transform(geom, 32635) AS utm FROM pois WHERE city = 'Bursa' ORDER BY id LIMIT 5)`,
    },
];

export const BACKDROP = 'SELECT X(geom), Y(geom) FROM pois';

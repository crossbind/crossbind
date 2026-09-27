import { useRef, useState } from 'react';
import AppCard, { Failure, RunButton, useNativeTask } from '../AppCard.jsx';
import { Meta, Placeholder, SecondaryButton, Stat } from '../controls.jsx';
import { counted, LicenceNote, once, Stats, withPlainErrors } from './shared.jsx';

const GRID = 20;

const STEP = 30;
const MARGIN = 16;
const SIZE = MARGIN * 2 + (GRID - 1) * STEP;
const nodeAt = (node) => [(node - 1) % GRID, Math.floor((node - 1) / GRID)];
const gx = (node) => MARGIN + nodeAt(node)[0] * STEP;
const gy = (node) => MARGIN + (GRID - 1 - nodeAt(node)[1]) * STEP;

// Rows of the VirtualRouting table: row 0 is the whole route, then one row per street.
function parseRoute(text) {
    const rows = JSON.parse(text).rows;
    const [first] = rows;
    if (!first || first[1] !== 'Route' || first[5] === null) return { found: false, reason: first?.[1] ?? 'no route' };
    return { found: true, cost: first[5], ids: rows.slice(1).map((row) => row[2]) };
}

// The intersections a route passes, from its start, and the minutes its streets take.
function walk(streets, start, ids) {
    const nodes = [start];
    let minutes = 0;
    for (const id of ids) {
        const [, from, to, cost] = streets.get(id);
        nodes.push(nodes.at(-1) === from ? to : from);
        minutes += cost;
    }
    return { nodes, minutes };
}

function StreetGrid({ tokens, streets, closed, ends, fastest, fewest, onNode, onStreet }) {
    const line = ([, from, to]) => ({ x1: gx(from), y1: gy(from), x2: gx(to), y2: gy(to) });
    const polyline = (nodes) => nodes.map((node, at) => `${at ? 'L' : 'M'}${gx(node)} ${gy(node)}`).join('');
    return (
        <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="img"
            aria-label="The street grid with the fastest route and the route through the fewest streets"
            style={{ display: 'block', width: '100%', maxWidth: 520, height: 'auto', margin: '0 auto', background: tokens.codeBg, border: `1px solid ${tokens.border}`, borderRadius: 10 }}
        >
            {[...streets.values()].map((street) =>
                closed.has(street[0]) ? (
                    <line key={street[0]} {...line(street)} stroke={tokens.textMuted} strokeWidth={1.2} strokeDasharray="3 4" />
                ) : (
                    <line key={street[0]} {...line(street)} stroke={tokens.textMuted} strokeOpacity={0.3 + 0.5 * (street[3] - 1)} strokeWidth={2} />
                ),
            )}
            {fewest ? <path d={polyline(fewest)} fill="none" stroke={tokens.textDim} strokeWidth={2.5} strokeDasharray="6 5" strokeLinejoin="round" /> : null}
            {fastest ? <path d={polyline(fastest)} fill="none" stroke={tokens.accent} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" /> : null}
            {[...streets.values()].map((street) => (
                <line key={`hit${street[0]}`} {...line(street)} stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} onClick={() => onStreet(street[0])}>
                    <title>{`Street ${street[0]}, ${street[3]} min${closed.has(street[0]) ? ', closed' : ''}`}</title>
                </line>
            ))}
            {Array.from({ length: GRID * GRID }, (_, at) => at + 1).map((node) => (
                <g key={`n${node}`} style={{ cursor: 'pointer' }} onClick={() => onNode(node)}>
                    <circle cx={gx(node)} cy={gy(node)} r={9} fill="transparent" />
                    <circle cx={gx(node)} cy={gy(node)} r={ends.includes(node) ? 10 : 2.4} fill={ends.includes(node) ? tokens.accent : tokens.textMuted} fillOpacity={ends.includes(node) ? 1 : 0.7} />
                </g>
            ))}
            {ends.map((node, at) => (
                <text key={`label${at}`} x={gx(node)} y={gy(node) + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={tokens.codeBg} style={{ pointerEvents: 'none' }}>
                    {at ? 'B' : 'A'}
                </text>
            ))}
        </svg>
    );
}

const ROUTING_WRAPPER = `// src/native/route_planner.h (excerpt)
// the open streets go into roads, a table with a LINESTRING column; then
build("SELECT CreateRouting('roads_data', 'roads_net', 'roads', 'node_from', 'node_to', "
      "'geom', 'cost', NULL, 1, 1, NULL, NULL, 1)");

std::string route(int from, int to, bool fewest) {
    // the VirtualRouting table takes only NodeFrom and NodeTo in WHERE
    const auto query = spatial::prepare(db, fewest ? "SELECT ... FROM hops_net WHERE NodeFrom = ?1 AND NodeTo = ?2"
        : "SELECT RouteRow, Role, LinkRowid, NodeFrom, NodeTo, Cost FROM roads_net WHERE NodeFrom = ?1 AND NodeTo = ?2");
    sqlite3_bind_int(query.get(), 1, from);
    sqlite3_bind_int(query.get(), 2, to);
    return spatial::ResultWriter(db).rows(query.get(), 1000);
}`;

const ROUTING_USAGE = `const m = await initNative();
const planner = await new m.RoutePlanner();
const route = JSON.parse(await planner.route(1, 400, false));
// route.rows[0]: [0, 'Route', null, 1, 400, 47.5], 47.5 minutes in all
// route.rows.length - 1: 38 streets, one row each: [n, 'Link', street, from, to, minutes]

await planner.closeStreets('[381, 401, 39]');   // CreateRouting runs again without them
JSON.parse(await planner.route(1, 400, false)).rows[0][5];   // 47.75`;

export function SqlRouting({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const session = useRef(null);
    const [ends, setEnds] = useState([1, GRID * GRID]);
    const [closed, setClosed] = useState(() => new Set());
    const [moving, setMoving] = useState(0);
    const solve = (nextEnds, nextClosed) =>
        run(
            withPlainErrors(async (m) => {
                if (!session.current) {
                    const planner = await new m.RoutePlanner();
                    const rows = JSON.parse(await planner.streets()).rows;
                    session.current = { planner, streets: new Map(rows.map((row) => [row[0], row])), closed: '[]' };
                }
                const { planner, streets } = session.current;
                const ids = JSON.stringify([...nextClosed].sort((a, b) => a - b));
                let rebuild = null;
                if (ids !== session.current.closed) {
                    const started = performance.now();
                    await planner.closeStreets(ids);
                    rebuild = performance.now() - started;
                    session.current.closed = ids;
                }
                const started = performance.now();
                const fastest = parseRoute(await planner.route(nextEnds[0], nextEnds[1], false));
                const fewest = parseRoute(await planner.route(nextEnds[0], nextEnds[1], true));
                const ms = performance.now() - started;
                return {
                    streets,
                    ends: nextEnds,
                    closed: nextClosed,
                    rebuild,
                    ms,
                    fastest: fastest.found ? { ...fastest, ...walk(streets, nextEnds[0], fastest.ids) } : fastest,
                    fewest: fewest.found ? { ...fewest, ...walk(streets, nextEnds[0], fewest.ids) } : fewest,
                };
            }),
        );
    const done = state.status === 'ready' ? state.result : null;
    const busy = state.status === 'running';
    const moveEnd = (node) => {
        if (busy || !session.current || ends.includes(node)) return;
        const next = moving ? [ends[0], node] : [node, ends[1]];
        setEnds(next);
        setMoving(moving ? 0 : 1);
        solve(next, closed);
    };
    const toggleStreet = (id) => {
        if (busy || !session.current) return;
        const next = new Set(closed);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setClosed(next);
        solve(ends, next);
    };
    const reopen = () => {
        const next = new Set();
        setClosed(next);
        solve(ends, next);
    };
    return (
        <AppCard
            tokens={tokens}
            id="spatialite-routing"
            index={index}
            status={state.status}
            title="Shortest paths in SQL, around the streets you close"
            pitch="CreateRouting turns a table of streets into a routing network, and a SELECT on it returns the shortest path. This grid has 400 intersections and 718 two-way streets that take 1 to 2 minutes each; the darker a street, the slower. Click two intersections to route between them, click a street to close it: SpatiaLite rebuilds the network and the query runs again, all inside SQLite in this tab."
            note={<LicenceNote tokens={tokens} />}
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ fontSize: 13.5, lineHeight: 1.6, color: tokens.textDim }}>
                        {session.current
                            ? `A is intersection ${ends[0]}, B is ${ends[1]}. The next intersection you click moves ${moving ? 'B' : 'A'}.`
                            : 'The first route runs from the bottom-left corner to the top-right one.'}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={busy} onClick={() => solve(ends, closed)}>
                            Route
                        </RunButton>
                        {closed.size ? (
                            <SecondaryButton tokens={tokens} disabled={busy} onClick={reopen}>
                                {`Reopen ${counted(closed.size, 'street')}`}
                            </SecondaryButton>
                        ) : null}
                    </div>
                    <Meta tokens={tokens} flush>The solid line is the fastest route, by travel time; the dashed one passes the fewest streets. Closed streets are dashed and thin.</Meta>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : done ? (
                    <div style={{ display: 'grid', gap: 14 }}>
                        <StreetGrid
                            tokens={tokens}
                            streets={done.streets}
                            closed={done.closed}
                            ends={done.ends}
                            fastest={done.fastest.found ? done.fastest.nodes : null}
                            fewest={done.fewest.found ? done.fewest.nodes : null}
                            onNode={moveEnd}
                            onStreet={toggleStreet}
                        />
                        {done.fastest.found ? (
                            <Stats>
                                <Stat tokens={tokens} size={24} accent value={`${done.fastest.cost} min`} label={`fastest, ${counted(done.fastest.ids.length, 'street')}`} />
                                <Stat tokens={tokens} size={24} value={counted(done.fewest.ids.length, 'street')} label={`fewest, ${done.fewest.minutes} min`} />
                                <Stat tokens={tokens} size={24} value={once(done.ms)} label="both routes" />
                                {done.rebuild !== null ? <Stat tokens={tokens} size={24} value={once(done.rebuild)} label="CreateRouting, twice" /> : null}
                            </Stats>
                        ) : (
                            <Meta tokens={tokens} flush>{`No route from A to B: SpatiaLite answers "${done.fastest.reason}". Reopen a street next to B.`}</Meta>
                        )}
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Route to draw the street grid; then click intersections and streets.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/route_planner.h', code: ROUTING_WRAPPER },
                { file: 'main.js', code: ROUTING_USAGE },
            ]}
        />
    );
}
SqlRouting.appId = 'spatialite-routing';

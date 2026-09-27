import { useEffect, useRef, useState } from 'react';
import { SITE_PAGES } from '../site-pages.js';
import AppCard, { Failure, fieldStyle, Label, RunButton, useNativeTask } from './AppCard.jsx';
import { download, FileButton, grouped, Hint, Meta, Placeholder, SecondaryButton, Stat } from './controls.jsx';

// The SQLite apps on /ports/sqlite3/. Each one drives landing/demos/lib-sqlite3, whose index.html
// checks the same calls against answers the host's own SQLite and plain Python computed from the
// same inputs.

const SEED = 2463534242;
const POINTS = 50000;
const SAMPLE_REQUESTS = 100000;
const MAX_ROWS = 200;

const counted = (value, noun) => `${grouped(value)} ${noun}${value === 1 ? '' : 's'}`;
// Means of many repeated runs, so sub-millisecond digits carry information.
const milliseconds = (value) => `${value < 1 ? value.toFixed(3) : value.toFixed(1)} ms`;
// One run, timed with a clock browsers coarsen to about a tenth of a millisecond.
const once = (value) => (value < 0.1 ? '< 0.1 ms' : `${value.toFixed(1)} ms`);
// A wasm build puts the C++ type in front of an exception's message and keeps the text in cppMessage.
const messageOf = (error) => error?.cppMessage ?? error?.message ?? String(error);
const withPlainErrors = (task) => async (m) => {
    try {
        return await task(m);
    } catch (error) {
        throw new Error(messageOf(error));
    }
};

function Chips({ tokens, items, onPick }) {
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {items.map(([label, value]) => (
                <button
                    key={label}
                    type="button"
                    onClick={() => onPick(value)}
                    style={{ background: 'none', color: tokens.textDim, border: `1px solid ${tokens.border}`, borderRadius: 999, padding: '4px 10px', fontFamily: tokens.mono, fontSize: 11.5, cursor: 'pointer' }}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

// --- Search this site -----------------------------------------------------------------------

const SEARCH_EXAMPLES = ['opfs', 'coop coep', '"react native"', 'worker*', 'wasi NOT rust', 'header NEAR/5 binding'].map((query) => [query, query]);

// Page copy carries a little inline markup: keep the words, drop link targets and markers.
const plain = (text) =>
    String(text ?? '')
        .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
        .replace(/[`*]/g, '')
        .replace(/[\u0000-\u001f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

function blockText(block) {
    switch (block.type) {
        case 'p':
        case 'h3':
            return block.text;
        case 'ul':
        case 'ol':
            return block.items.join(' ');
        case 'callout':
            return `${block.title ?? ''} ${block.text}`;
        case 'table':
            return [...block.head, ...block.rows.flat()].join(' ');
        default:
            return '';
    }
}

// One document per page and one per h2 section, the split the site's own search uses.
function siteDocuments(pages) {
    return pages.flatMap((page) => {
        const sections = [{ title: page.title, section: '', href: page.href, parts: [page.lede, page.description] }];
        for (const block of page.blocks) {
            if (block.type === 'h2' && block.id) sections.push({ title: page.title, section: block.text, href: `${page.href}#${block.id}`, parts: [] });
            else sections.at(-1).parts.push(blockText(block));
        }
        return sections.map(({ parts, ...section }) => ({ ...section, title: plain(section.title), section: plain(section.section), body: plain(parts.filter(Boolean).join(' ')) }));
    });
}

// The wrapper marks each hit with \u0002 before it and \u0003 after it.
function Marked({ tokens, text }) {
    return text.split(/(\u0002[^\u0003]*\u0003)/).map((part, index) =>
        part.startsWith('\u0002') ? <mark key={index} style={{ background: 'none', color: tokens.accentText, fontWeight: 600 }}>{part.slice(1, -1)}</mark> : <span key={index}>{part}</span>,
    );
}

const SEARCH_WRAPPER = `// src/native/doc_search.h (excerpt): FTS4 has no ranking function, so C++ supplies one
static void bm25(sqlite3_context* context, int argc, sqlite3_value** argv) {
    // matchinfo(docs, 'pcnalx'): phrases, columns, rows, average and own lengths, hits
    ...
    const double idf = std::log(1 + (rows - documents + 0.5) / (documents + 0.5));
    const double norm = 1 - b + b * length[column] / average[column];
    score += weight * idf * frequency * (k1 + 1) / (frequency + k1 * norm);
    ...
    sqlite3_result_double(context, score);
}

sqlite3_create_function(db, "bm25", -1, SQLITE_UTF8 | SQLITE_DETERMINISTIC, nullptr, bm25, nullptr, nullptr);

// then it is plain SQL
select pages.title, snippet(docs, char(2), char(3), '…', 1, 14),
       bm25(matchinfo(docs, 'pcnalx'), 3.0, 1.0) as score
from docs join pages on pages.id = docs.docid
where docs match ?1 order by score desc limit ?2`;

const SEARCH_USAGE = `const m = await initNative();
const search = await new m.DocSearch();
await search.addJson(JSON.stringify(sections));   // [{ title, section, href, body }]

const { total, hits } = JSON.parse(await search.search('"react native"', 8));
// hits[0]: { title, section, href, snippet, score }`;

export function SiteSearch({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [query, setQuery] = useState(SEARCH_EXAMPLES[0][1]);
    const [found, setFound] = useState(null);
    const built = state.status === 'ready' ? state.result : null;
    const engine = built?.engine;

    useEffect(() => {
        const text = query.trim();
        if (!engine || !text) {
            setFound(null);
            return undefined;
        }
        let current = true;
        const timer = setTimeout(async () => {
            try {
                const result = JSON.parse(await engine.search(text, 8));
                if (current) setFound({ query: text, ...result });
            } catch (error) {
                if (current) setFound({ query: text, error: messageOf(error) });
            }
        }, 120);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [engine, query]);

    const build = () =>
        run(async (m) => {
            const documents = siteDocuments(SITE_PAGES);
            const search = await new m.DocSearch();
            const started = performance.now();
            const size = await search.addJson(JSON.stringify(documents));
            const characters = documents.reduce((total, entry) => total + entry.body.length, 0);
            return { engine: search, size, pages: SITE_PAGES.length, characters, indexedIn: performance.now() - started };
        });

    return (
        <AppCard
            tokens={tokens}
            id="sqlite3-search"
            index={index}
            status={state.status}
            title="Search this site as you type"
            pitch="Every guide, reference, library and changelog page of crossbind.dev, split into its sections, goes into a SQLite FTS4 index in this tab. It matches word stems, phrases, prefixes, NEAR and NOT, and a BM25 function written in C++ ranks the results, because FTS4 has no ranking of its own."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    {built ? (
                        <>
                            <label style={{ display: 'block' }}>
                                <Label tokens={tokens}>FTS QUERY</Label>
                                <input type="search" value={query} spellCheck={false} onChange={(event) => setQuery(event.target.value)} style={{ ...fieldStyle(tokens), fontSize: 14 }} />
                            </label>
                            <Chips tokens={tokens} items={SEARCH_EXAMPLES} onPick={setQuery} />
                        </>
                    ) : (
                        <div>
                            <RunButton tokens={tokens} busy={state.status === 'running'} onClick={build}>Index this site</RunButton>
                        </div>
                    )}
                    <Hint tokens={tokens}>
                        The text is the site's own page data, the same copy you are reading. Try what substring matching cannot do: <code style={{ fontFamily: tokens.mono }}>parse</code> also finds "parsing", quotes make a phrase, <code style={{ fontFamily: tokens.mono }}>*</code> a prefix.
                    </Hint>
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : built ? (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 16 }}>
                            <Stat tokens={tokens} accent value={found && !found.error ? grouped(found.total) : '–'} label="matching sections" />
                            <Stat tokens={tokens} value={found && !found.error ? once(found.ms) : '–'} label="to match and rank, in SQLite" />
                        </div>
                        {found?.error ? <Failure tokens={tokens} message={`Not a complete FTS query yet: ${found.error}`} /> : null}
                        {found && !found.error ? (
                            <ol data-query={found.query} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
                                {found.hits.map((hit, position) => (
                                    <li key={`${position}-${hit.href}`} style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 10 }}>
                                        <a href={hit.href} style={{ color: tokens.text, fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>
                                            {hit.section ? `${hit.title} › ${hit.section}` : hit.title}
                                        </a>
                                        <div style={{ fontSize: 13, lineHeight: 1.6, color: tokens.textDim, marginTop: 3 }}>
                                            <Marked tokens={tokens} text={hit.snippet} />
                                        </div>
                                        <div style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.textMuted, marginTop: 3 }}>{`bm25 ${hit.score.toFixed(2)} · ${hit.href}`}</div>
                                    </li>
                                ))}
                            </ol>
                        ) : null}
                        <Meta tokens={tokens}>{`${grouped(built.size)} sections from ${grouped(built.pages)} pages, ${grouped(Math.round(built.characters / 1000))} K characters, indexed in ${Math.round(built.indexedIn)} ms`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Index the site, then search it as you type.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/doc_search.h', code: SEARCH_WRAPPER },
                { file: 'main.js', code: SEARCH_USAGE },
            ]}
        />
    );
}
SiteSearch.appId = 'sqlite3-search';

// --- R*Tree ---------------------------------------------------------------------------------

const CANVAS = 1000;
const METHODS = [
    { key: 'rtree', label: 'R*Tree (rtree_i32)' },
    { key: 'btree', label: 'B-tree index on x' },
    { key: 'scan', label: 'No index: every row' },
];
const BOXES = [
    ['corner', [0, 0, 99, 99]],
    ['center', [400, 400, 599, 599]],
    ['wide strip', [250, 100, 749, 180]],
];

function xorshift32(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state;
    };
}

// The points the module generates, from the same sequence: x then y for each point.
function pointsFrom(seed, count) {
    const next = xorshift32(seed);
    const coordinates = new Uint16Array(count * 2);
    for (let index = 0; index < coordinates.length; index += 1) coordinates[index] = next() % 1000;
    return coordinates;
}

const ordered = ([x0, y0, x1, y1]) => [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];

function PointField({ tokens, points, hits, box, onBox }) {
    const canvasRef = useRef(null);
    const baseRef = useRef(null);
    const dragRef = useRef(null);

    useEffect(() => {
        const base = document.createElement('canvas');
        base.width = CANVAS;
        base.height = CANVAS;
        const context = base.getContext('2d');
        context.fillStyle = tokens.textMuted;
        for (let index = 0; index < points.length; index += 2) context.fillRect(points[index], points[index + 1], 2, 2);
        baseRef.current = base;
    }, [points, tokens.textMuted]);

    useEffect(() => {
        const context = canvasRef.current?.getContext('2d');
        if (!context || !baseRef.current) return;
        context.clearRect(0, 0, CANVAS, CANVAS);
        context.globalAlpha = 0.55;
        context.drawImage(baseRef.current, 0, 0);
        context.globalAlpha = 1;
        context.fillStyle = tokens.accent;
        for (const id of hits) context.fillRect(points[(id - 1) * 2] - 0.5, points[(id - 1) * 2 + 1] - 0.5, 3, 3);
        const [x0, y0, x1, y1] = box;
        context.strokeStyle = tokens.text;
        context.lineWidth = 3;
        context.strokeRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }, [points, hits, box, tokens]);

    const at = (event) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const clamp = (value) => Math.max(0, Math.min(CANVAS - 1, Math.round(value)));
        return [clamp(((event.clientX - rect.left) / rect.width) * CANVAS), clamp(((event.clientY - rect.top) / rect.height) * CANVAS)];
    };
    const finish = (event) => {
        if (!dragRef.current) return;
        const corner = dragRef.current;
        dragRef.current = null;
        onBox(ordered([...corner, ...at(event)]), true);
    };

    return (
        <canvas
            ref={canvasRef}
            width={CANVAS}
            height={CANVAS}
            role="img"
            aria-label={`${grouped(points.length / 2)} generated points; drag to query a box`}
            onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = at(event);
                onBox([...dragRef.current, ...dragRef.current], false);
            }}
            onPointerMove={(event) => {
                if (dragRef.current) onBox(ordered([...dragRef.current, ...at(event)]), false);
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: '1 / 1', border: `1px solid ${tokens.border}`, borderRadius: 10, background: tokens.codeBg, touchAction: 'none', cursor: 'crosshair' }}
        />
    );
}

function MethodRows({ tokens, timings, plans }) {
    const slowest = Math.max(...METHODS.map((method) => timings[method.key]));
    return (
        <div style={{ display: 'grid', gap: 12 }}>
            {METHODS.map((method) => {
                const ms = timings[method.key];
                const fastest = method.key === 'rtree';
                return (
                    <div key={method.key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: tokens.textDim, marginBottom: 5 }}>
                            <span>{method.label}</span>
                            <span style={{ fontFamily: tokens.mono, color: fastest ? tokens.accentText : tokens.textDim, whiteSpace: 'nowrap' }}>{milliseconds(ms)}</span>
                        </div>
                        <div style={{ height: 10, borderRadius: 5, background: tokens.pillBg, border: `1px solid ${tokens.border}`, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.max(0.5, (ms / slowest) * 100)}%`, height: '100%', background: fastest ? tokens.accent : tokens.textMuted }} />
                        </div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.textMuted, marginTop: 4, overflowWrap: 'anywhere' }}>{plans[method.key]}</div>
                    </div>
                );
            })}
        </div>
    );
}

const RTREE_WRAPPER = `// src/native/spatial_index.h (excerpt)
create virtual table pts using rtree_i32(id, minx, maxx, miny, maxy);
create table indexed(id integer primary key, x integer not null, y integer not null);
create index indexed_x on indexed(x);
create table plain(id integer primary key, x integer not null, y integer not null);

-- a point is a box of size zero
insert into pts values (?1, ?2, ?2, ?3, ?3);

select count(*) from pts where minx >= ?1 and maxx <= ?3 and miny >= ?2 and maxy <= ?4;
select count(*) from indexed where x between ?1 and ?3 and y between ?2 and ?4;
select count(*) from plain where x between ?1 and ?3 and y between ?2 and ?4;`;

const RTREE_USAGE = `const m = await initNative();
const space = await new m.SpatialIndex();
await space.generate(50000, 2463534242);         // xorshift32 points in [0, 1000)²

await space.count(400, 400, 599, 599, 'rtree');   // 2018
await space.plan('rtree');     // SCAN pts VIRTUAL TABLE INDEX 2:D0B1D2B3
await space.measure(400, 400, 599, 599, 'scan');  // ms per query, timed in C++`;

export function BoxQuery({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [box, setBox] = useState(BOXES[1][1]);
    const [answer, setAnswer] = useState(null);
    const flight = useRef({ busy: false, next: null });
    const loaded = state.status === 'ready' ? state.result : null;

    // One query at a time: a drag that moves on while SQLite answers keeps only its latest box.
    const ask = async (space, target, final) => {
        const queue = flight.current;
        if (queue.busy) {
            queue.next = { target, final: final || Boolean(queue.next?.final) };
            return;
        }
        queue.busy = true;
        try {
            const [x0, y0, x1, y1] = target;
            const count = await space.count(x0, y0, x1, y1, 'rtree');
            const ids = JSON.parse(await space.ids(x0, y0, x1, y1, POINTS));
            let timings = null;
            if (final) {
                timings = {};
                for (const method of METHODS) timings[method.key] = await space.measure(x0, y0, x1, y1, method.key);
            }
            setAnswer({ box: target, count, ids, timings });
        } catch (error) {
            setAnswer({ box: target, error: messageOf(error) });
        } finally {
            queue.busy = false;
            const next = queue.next;
            queue.next = null;
            if (next) ask(space, next.target, next.final);
        }
    };

    const start = () =>
        run(async (m) => {
            const space = await new m.SpatialIndex();
            const started = performance.now();
            await space.generate(POINTS, SEED);
            const generatedIn = performance.now() - started;
            const plans = {};
            for (const method of METHODS) plans[method.key] = await space.plan(method.key);
            return { space, plans, generatedIn, points: pointsFrom(SEED, POINTS) };
        });

    useEffect(() => {
        if (loaded) ask(loaded.space, box, true);
    }, [loaded]);

    const pick = (target, final) => {
        setBox(target);
        if (loaded) ask(loaded.space, target, final);
    };
    const [x0, y0, x1, y1] = answer?.box ?? box;
    const timings = answer?.timings;

    return (
        <AppCard
            tokens={tokens}
            id="sqlite3-rtree"
            index={index}
            status={state.status}
            title="Ask 50,000 points what is inside a box"
            pitch="Drag a box across the points. SQLite's R*Tree finds them through its spatial index; the same query then runs against a B-tree index on x and against a table with no index at all, each timed here in your tab, next to the plan SQLite chose for it."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    {loaded ? (
                        <>
                            <PointField tokens={tokens} points={loaded.points} hits={answer?.ids ?? []} box={box} onBox={pick} />
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 12.5, color: tokens.textMuted }}>or try</span>
                                {BOXES.map(([label, target]) => <SecondaryButton key={label} tokens={tokens} onClick={() => pick(target, true)}>{label}</SecondaryButton>)}
                            </div>
                            <Hint tokens={tokens}>A B-tree index narrows the search by x alone, so a box that is wide in x can make it slower than reading every row. The R*Tree narrows by both.</Hint>
                        </>
                    ) : (
                        <>
                            <div>
                                <RunButton tokens={tokens} busy={state.status === 'running'} onClick={start}>Load 50,000 points</RunButton>
                            </div>
                            <Hint tokens={tokens}>The module fills three tables with the same generated points; the page draws them from the same xorshift32 sequence, so only the answers cross over.</Hint>
                        </>
                    )}
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : answer?.error ? (
                    <Failure tokens={tokens} message={answer.error} />
                ) : loaded && answer ? (
                    <div data-box={answer.box.join(',')} data-timed={timings ? 'yes' : 'no'}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 18 }}>
                            <Stat tokens={tokens} accent value={grouped(answer.count)} label={`points in x ${x0}–${x1}, y ${y0}–${y1}`} />
                            <Stat tokens={tokens} value={timings ? `${Math.max(1, Math.round(timings.scan / timings.rtree))}×` : '…'} label="faster than reading every row" />
                        </div>
                        {timings ? <MethodRows tokens={tokens} timings={timings} plans={loaded.plans} /> : <Meta tokens={tokens}>Release to time the three queries.</Meta>}
                        <Meta tokens={tokens}>{`${grouped(POINTS)} points in three tables, generated in ${Math.round(loaded.generatedIn)} ms · each time is the mean of repeated runs inside the module`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Load the points, then drag a box over them.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/spatial_index.h', code: RTREE_WRAPPER },
                { file: 'main.js', code: RTREE_USAGE },
            ]}
        />
    );
}
BoxQuery.appId = 'sqlite3-rtree';

// --- Explorer -------------------------------------------------------------------------------

const SAMPLE = '/memfs/sqliteapps/sample/api-log.sqlite';
const COPIES = '/memfs/sqliteapps/copies';
const LATENCY = `select path, count(*) as requests, median(ms) as p50, round(percentile(ms, 95), 1) as p95,
       round(100.0 * avg(status >= 500), 2) as error_pct
from requests join routes on routes.id = requests.route_id
group by path order by p95 desc, path`;
const SPIKE = `select minute, errors, round(avg(errors) over (order by minute rows 4 preceding), 1) as avg5
from (select minute, sum(status >= 500) as errors from requests group by minute)
order by errors desc, minute limit 5`;
const REGIONS = `select client ->> 'region' as region, count(*) as requests,
       round(100.0 * avg(client ->> 'cache' = 'hit'), 1) as cache_hit_pct, round(avg(ms), 1) as avg_ms
from requests group by region order by region`;
const SCHEMA = 'select type, name, tbl_name, sql from sqlite_schema order by type, name';
const SAMPLE_PRESETS = [
    ['p50 and p95 per route', LATENCY],
    ['error spike, 5-minute average', SPIKE],
    ['JSON: cache hits by region', REGIONS],
    ['schema', SCHEMA],
];

const tableQuery = (name) => `select * from "${name.replace(/"/g, '""')}" limit 100`;
const baseName = (name) => name.replace(/\.[^.]+$/, '') || 'database';

function cellText(value) {
    if (value === null) return 'NULL';
    if (typeof value === 'object') return `BLOB · ${grouped(value.blob)} B`;
    const text = String(value);
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function ResultTable({ tokens, result }) {
    if (!result.columns.length) return <Meta tokens={tokens}>The statement ran and returned no columns.</Meta>;
    const cell = { padding: '6px 10px', borderBottom: `1px solid ${tokens.border}`, whiteSpace: 'nowrap', textAlign: 'left' };
    return (
        <div style={{ maxHeight: 320, overflow: 'auto', border: `1px solid ${tokens.border}`, borderRadius: 10 }}>
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
                    {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {row.map((value, position) => (
                                <td
                                    key={position}
                                    title={typeof value === 'string' && value.length > 160 ? value : undefined}
                                    style={{ ...cell, fontFamily: tokens.mono, textAlign: typeof value === 'number' ? 'right' : 'left', color: value === null || typeof value === 'object' ? tokens.textMuted : tokens.text }}
                                >
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

function SchemaList({ tokens, tables, onPick }) {
    const readable = tables.filter((entry) => entry.type === 'table' || entry.type === 'view');
    const others = tables.length - readable.length;
    return (
        <div>
            <Label tokens={tokens}>TABLES AND VIEWS</Label>
            <div style={{ maxHeight: 220, overflow: 'auto', border: `1px solid ${tokens.border}`, borderRadius: 10 }}>
                {readable.map((entry) => (
                    <div key={entry.name} style={{ padding: '7px 10px', borderBottom: `1px solid ${tokens.border}`, fontSize: 12.5 }}>
                        <button type="button" onClick={() => onPick(tableQuery(entry.name))} style={{ background: 'none', border: 'none', padding: 0, color: tokens.accentText, fontFamily: tokens.mono, fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>
                            {entry.name}
                        </button>
                        <span style={{ color: tokens.textMuted }}>{entry.rows === null || entry.rows === undefined ? ` · ${entry.type}` : ` · ${counted(entry.rows, 'row')}`}</span>
                        <div style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.textMuted, marginTop: 2, overflowWrap: 'anywhere' }}>
                            {entry.error ?? entry.columns.map((column) => `${column.name}${column.type ? ` ${column.type}` : ''}${column.pk ? ' PK' : ''}`).join(', ')}
                        </div>
                    </div>
                ))}
            </div>
            <Meta tokens={tokens}>{`${grouped(others)} indexes and triggers`}</Meta>
        </div>
    );
}

const EXPLORER_WRAPPER = `// src/native/db_explorer.h (excerpt)
// "file:/memfs/…/name.sqlite?immutable=1": no writes, no locks, no -wal or -shm needed
explicit DbExplorer(const std::string& path)
    : file(path), db(uri(path), SQLITE_OPEN_READONLY | SQLITE_OPEN_URI) {
    // a runaway query stops after 10 s instead of holding the worker
    sqlite3_progress_handler(db.get(), 1000, stopAtDeadline, this);
    sql::exec(db.get(), "select count(*) from sqlite_schema");  // "file is not a database"
}

// a compacted copy for the download
sql::Statement vacuum = sql::prepare(db.get(), "vacuum into ?1");
sql::bind(vacuum.get(), 1, path);
sql::step(db.get(), vacuum.get());`;

const EXPLORER_USAGE = `const m = await initNative();
const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
const db = await new m.DbExplorer(path);

JSON.parse(await db.tables());   // [{ name, type, rows, columns: [...] }]
JSON.parse(await db.query('select * from requests limit 5', 200));
await db.csv('select * from requests');          // RFC 4180 text
await db.saveAs('/memfs/sqliteapps/copy.sqlite');  // then m.getFileBytes(...)`;

export function DatabaseExplorer({ tokens, index, load }) {
    const [state, run] = useNativeTask(load);
    const [sql, setSql] = useState(LATENCY);
    const [answer, setAnswer] = useState(null);
    const [busy, setBusy] = useState(null);
    const [note, setNote] = useState(null);
    const opened = state.status === 'ready' ? state.result : null;

    useEffect(() => {
        if (!opened) return;
        setSql(opened.first.sql);
        setAnswer(opened.first);
        setNote(null);
    }, [opened]);

    const open = (locate) =>
        run(
            withPlainErrors(async (m) => {
                const { path, name, sample } = await locate(m);
                const db = await new m.DbExplorer(path);
                const info = JSON.parse(await db.info());
                const tables = JSON.parse(await db.tables());
                const table = tables.find((entry) => entry.type === 'table' && !entry.name.startsWith('sqlite_'));
                const first = sample ? LATENCY : table ? tableQuery(table.name) : SCHEMA;
                return { db, path, name, sample, info, tables, first: { sql: first, result: JSON.parse(await db.query(first, MAX_ROWS)) } };
            }),
        );
    const openSample = () =>
        open(async (m) => {
            await m.FS.mkdirTree(SAMPLE.slice(0, SAMPLE.lastIndexOf('/')));
            await m.DbExplorer.writeSample(SAMPLE, SAMPLE_REQUESTS, SEED);
            return { path: SAMPLE, name: 'api-log.sqlite', sample: true };
        });
    const openFile = (file) =>
        open(async (m) => {
            const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs'));
            return { path, name: file.name, sample: false };
        });

    // Every action on the open file runs one at a time and reports its own failure.
    const act = async (kind, work) => {
        setBusy(kind);
        try {
            await work();
        } catch (error) {
            if (kind === 'query') setAnswer({ sql, error: messageOf(error) });
            else setNote({ error: messageOf(error) });
        } finally {
            setBusy(null);
        }
    };
    const query = (text) => {
        setSql(text);
        return act('query', async () => setAnswer({ sql: text, result: JSON.parse(await opened.db.query(text, MAX_ROWS)) }));
    };
    const exportCsv = () =>
        act('csv', async () => {
            const text = await opened.db.csv(sql);
            download(new Blob([text], { type: 'text/csv' }), `${baseName(opened.name)}.csv`);
            setNote({ text: `CSV of the last statement: ${grouped(text.split('\r\n').length - 2)} rows` });
        });
    const saveCopy = () =>
        act('copy', async () => {
            const m = await load();
            const target = `${COPIES}/${baseName(opened.name)}.sqlite`;
            await m.FS.mkdirTree(COPIES);
            const bytes = await opened.db.saveAs(target);
            const data = await m.getFileBytes(target);
            await m.FS.unlink(target);
            download(new Blob([data], { type: 'application/vnd.sqlite3' }), `${baseName(opened.name)}-compacted.sqlite`);
            setNote({ text: `VACUUM INTO wrote a compacted copy: ${grouped(bytes)} B, from ${grouped(opened.info.bytes)} B` });
        });
    const check = () => act('check', async () => setNote({ text: `PRAGMA quick_check: ${await opened.db.check()}` }));

    const info = opened?.info;
    const tableCount = opened ? opened.tables.filter((entry) => entry.type === 'table').length : 0;
    return (
        <AppCard
            tokens={tokens}
            id="sqlite3-explorer"
            index={index}
            status={state.status}
            title="Open any SQLite file, privately"
            pitch="Open a .sqlite or .db file, a GeoPackage or an MBTiles tile set to see its tables, run SQL on it and export the result as CSV. SQLite opens it read-only as an immutable database, so it never writes to your file, and a WAL-mode file opens without its -wal and -shm companions. Or generate a log of 100,000 API requests and ask it for p95 latency with SQLite's percentile()."
            controls={
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={openSample}>Open the sample log</RunButton>
                        <FileButton tokens={tokens} accept=".sqlite,.sqlite3,.db,.db3,.gpkg,.mbtiles,application/vnd.sqlite3,application/x-sqlite3" onFile={openFile}>Open your own file</FileButton>
                    </div>
                    {opened ? (
                        <>
                            <SchemaList tokens={tokens} tables={opened.tables} onPick={query} />
                            <label style={{ display: 'block' }}>
                                <Label tokens={tokens}>SQL</Label>
                                <textarea value={sql} rows={6} spellCheck={false} onChange={(event) => setSql(event.target.value)} style={{ ...fieldStyle(tokens), resize: 'vertical' }} />
                            </label>
                            <Chips tokens={tokens} items={opened.sample ? SAMPLE_PRESETS : [['schema', SCHEMA]]} onPick={query} />
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                <RunButton tokens={tokens} busy={busy === 'query'} onClick={() => query(sql)}>Run</RunButton>
                                <SecondaryButton tokens={tokens} disabled={Boolean(busy)} onClick={exportCsv}>Download CSV</SecondaryButton>
                                <SecondaryButton tokens={tokens} disabled={Boolean(busy)} onClick={saveCopy}>Save a compacted copy</SecondaryButton>
                                <SecondaryButton tokens={tokens} disabled={Boolean(busy)} onClick={check}>Check integrity</SecondaryButton>
                            </div>
                        </>
                    ) : (
                        <Hint tokens={tokens}>Your file stays in this tab: it is copied into the module's in-memory filesystem and never uploaded. Changes still waiting in a separate -wal file are not part of what you see.</Hint>
                    )}
                </div>
            }
            output={
                state.status === 'failed' ? (
                    <Failure tokens={tokens} message={state.message} />
                ) : opened ? (
                    <div>
                        <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.text, marginBottom: 12, overflowWrap: 'anywhere' }}>{`${opened.name} · ${grouped(info.bytes)} B · ${info.kind}`}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14, marginBottom: 16 }}>
                            <Stat tokens={tokens} accent value={grouped(tableCount)} label={tableCount === 1 ? 'table' : 'tables'} />
                            <Stat tokens={tokens} value={info.journal} label="journal mode" />
                            <Stat tokens={tokens} value={grouped(info.pages)} label={`pages of ${grouped(info.pageSize)} B`} />
                        </div>
                        {answer?.error ? <Failure tokens={tokens} message={answer.error} /> : null}
                        {answer?.result ? <ResultTable tokens={tokens} result={answer.result} /> : null}
                        {answer?.result ? (
                            <Meta tokens={tokens}>{`${counted(answer.result.rows.length, 'row')}${answer.result.truncated ? ` (the first ${MAX_ROWS})` : ''} · ${once(answer.result.ms)} in SQLite`}</Meta>
                        ) : null}
                        {note?.error ? <Failure tokens={tokens} message={note.error} /> : note ? <Meta tokens={tokens}>{note.text}</Meta> : null}
                        <Meta tokens={tokens}>{`${info.encoding} · user_version ${info.userVersion} · last written by SQLite ${info.writtenBy}`}</Meta>
                    </div>
                ) : (
                    <Placeholder tokens={tokens}>Open the sample or a SQLite file of your own to see its tables and query it.</Placeholder>
                )
            }
            code={[
                { file: 'src/native/db_explorer.h', code: EXPLORER_WRAPPER },
                { file: 'main.js', code: EXPLORER_USAGE },
            ]}
        />
    );
}
DatabaseExplorer.appId = 'sqlite3-explorer';

export const SQLITE3_APPS = [SiteSearch, BoxQuery, DatabaseExplorer];

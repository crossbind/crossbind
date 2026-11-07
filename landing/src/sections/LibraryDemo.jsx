import { useState } from 'react';
import { TURBO, TURBO_SYNTAX, TurboWindow } from '../components/turbo.jsx';
import { highlight, primaryButtonStyle } from '../components/ui.jsx';
import { PLAYGROUND_URL } from '../data.js';
import { isLive, liveDemo, loadDemo } from '../live/runtime.js';
import {
    createStatement, DEFAULT_QUERY, insertStatement, MAIN_AFTER, MAIN_BEFORE, toTable, withoutCommentLines,
} from '../live/sqlite.js';
import databaseHeader from '../../demos/panel-sqlite/src/native/database.h?raw';

// The page's one real-library demo: SQLite compiled from the published port, booted in the
// visitor's browser and queried against this site's own catalog. Everything is click-gated - the
// artifact is over a megabyte, so it must never touch a first paint.

const DEMO_ID = 'panel-sqlite';
const HEADER_CODE = withoutCommentLines(databaseHeader).trimEnd();
// The playground's SQLite sample: the same database.h and main.js, where the C++ can change too.
const PLAYGROUND_SAMPLE = `${PLAYGROUND_URL}?sample=sqlite`;

const megabytes = (bytes) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

function statusText(state, bytes) {
    if (!state.db) return `The first run downloads ${megabytes(bytes)} of WebAssembly.`;
    if (!state.table) return `SQLite ${state.version}`;
    const count = state.table.rows.length;
    return `SQLite ${state.version} · ${count} ${count === 1 ? 'row' : 'rows'} in ${state.ms} ms`;
}

// A line too long for its window wraps under its own indent plus four, as an editor's soft wrap does, so the code
// never scrolls sideways. The line's div inherits the negative indent, which puts its first row back at the edge.
function WrappedCode({ code, syntax }) {
    return code.split('\n').map((line, index) => {
        const hang = `${line.length - line.trimStart().length + 4}ch`;
        return (
            <div key={`${index}-${line}`} style={{ paddingLeft: hang, textIndent: `-${hang}`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {highlight(line, syntax)}
            </div>
        );
    });
}

function Results({ tokens, state }) {
    if (state.status === 'failed') {
        return <div style={{ marginTop: 20, fontFamily: tokens.mono, fontSize: 12.5, color: tokens.warn, lineHeight: 1.6 }}>{state.message}</div>;
    }
    if (!state.table?.columns.length) return null;
    return (
        <div style={{ marginTop: 20, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                    <tr>
                        {state.table.columns.map((column) => (
                            <th
                                key={column}
                                style={{
                                    textAlign: 'left',
                                    fontFamily: tokens.mono,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    letterSpacing: 0.6,
                                    color: tokens.textMuted,
                                    borderBottom: `1px solid ${tokens.borderStrong}`,
                                    padding: '7px 14px 7px 0',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {column}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {state.table.rows.map((row) => (
                        <tr key={row.join('|')}>
                            {row.map((cell, index) => (
                                <td
                                    key={`${index}-${cell}`}
                                    style={{
                                        padding: '7px 14px 7px 0',
                                        borderBottom: `1px solid ${tokens.border}`,
                                        color: tokens.textDim,
                                        verticalAlign: 'top',
                                        lineHeight: 1.5,
                                    }}
                                >
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function LibraryDemo({ tokens }) {
    const demo = liveDemo(DEMO_ID);
    const [sql, setSql] = useState(DEFAULT_QUERY);
    const [state, setState] = useState({ status: 'idle' });

    if (!isLive(DEMO_ID)) return null;

    const run = async () => {
        setState((current) => ({ ...current, status: 'running' }));
        let { db, version } = state;
        try {
            if (!db) {
                const module = await loadDemo(DEMO_ID);
                const fresh = await new module.Database();
                await fresh.exec(createStatement());
                await fresh.exec(insertStatement());
                version = await fresh.version();
                db = fresh;
            }
            const started = performance.now();
            const table = toTable(await db.query(sql));
            setState({ status: 'ready', db, version, table, ms: Math.round((performance.now() - started) * 100) / 100 });
        } catch (error) {
            setState({ status: 'failed', db, version, table: null, message: error?.message ?? String(error) });
        }
    };

    const busy = state.status === 'running';
    const syntax = { ...tokens, ...TURBO_SYNTAX };
    const onKeyDown = (event) => {
        if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
        event.preventDefault();
        if (!busy) run();
    };

    return (
        <section style={{ padding: '80px var(--content-x) 80px' }}>
            <div style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 36, margin: '0 0 12px', fontWeight: 600, letterSpacing: -1, color: tokens.text }}>
                    Use SQLite from JavaScript.
                </h2>
                <p style={{ fontSize: 16, lineHeight: 1.6, color: tokens.textDim, margin: 0, maxWidth: 640 }}>
                    Run SQL queries against crossbind&apos;s library catalog. SQLite runs as WebAssembly in your browser.
                </p>
            </div>

            {/* Turbo C++'s desktop, as the hero's: the C++ that binds SQLite beside the JavaScript that calls it, and the
                query the visitor edits inside main.js. database.h scrolls down within main.js's height. */}
            <div
                onKeyDown={onKeyDown}
                className="demo-code"
                style={{
                    gap: 10, padding: '14px 6px 6px', borderRadius: 4, background: TURBO.blue, color: TURBO.yellow, fontFamily: tokens.mono, fontSize: 13, lineHeight: '20px',
                }}
            >
                <TurboWindow title="database.h" number="1" style={{ minWidth: 0 }}>
                    <div className="demo-header" style={{ padding: '10px 14px', overflowY: 'auto', scrollbarColor: `${TURBO.cyan} ${TURBO.blue}` }}>
                        <WrappedCode code={HEADER_CODE} syntax={syntax} />
                    </div>
                </TurboWindow>
                <TurboWindow title="main.js" number="2" style={{ minWidth: 0, padding: '10px 14px' }}>
                    <WrappedCode code={MAIN_BEFORE} syntax={syntax} />
                    {/* Turbo's input colours mark the one part to edit. */}
                    <textarea
                        className="demo-query"
                        value={sql}
                        onChange={(event) => setSql(event.target.value)}
                        spellCheck="false"
                        aria-label="SQL to run against the library catalog"
                        rows={sql.split('\n').length}
                        style={{
                            display: 'block', width: '100%', boxSizing: 'border-box', resize: 'vertical', margin: 0, padding: '0 6px', border: 'none', borderRadius: 0, background: TURBO.cyan, color: TURBO.black, font: 'inherit', lineHeight: 'inherit',
                        }}
                    />
                    <WrappedCode code={MAIN_AFTER} syntax={syntax} />
                </TurboWindow>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 16 }}>
                <button
                    type="button"
                    className="tap-target"
                    onClick={run}
                    disabled={busy}
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                    style={{ ...primaryButtonStyle(tokens), padding: '10px 20px', fontSize: 14, cursor: busy ? 'progress' : 'pointer' }}
                >
                    {busy ? 'Running…' : 'Run'}
                </button>
                <span aria-live="polite" style={{ fontSize: 13, color: tokens.textDim }}>
                    {statusText(state, demo.bytes ?? 0)}
                </span>
                <a href={PLAYGROUND_SAMPLE} className="tap-target demo-try" style={{ marginLeft: 'auto', color: tokens.accentText, fontSize: 14 }}>
                    Try in Playground →
                </a>
            </div>

            <Results tokens={tokens} state={state} />
        </section>
    );
}

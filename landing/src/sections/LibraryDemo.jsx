import { useState } from 'react';
import { REPO_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';
import { highlight } from '../components/ui.jsx';
import { isLive, liveDemo, loadDemo } from '../live/runtime.js';
import { createStatement, DEFAULT_QUERY, insertStatement, toTable } from '../live/sqlite.js';
import { PORTS } from '../ports/catalog.js';

// The page's one real-library demo: SQLite compiled from the published port, booted in the
// visitor's browser and queried against this site's own catalog. Everything is click-gated - the
// artifact is over a megabyte, so it must never touch a first paint.

const DEMO_ID = 'panel-sqlite';
const SOURCE_URL = `${REPO_URL}/blob/main/landing/demos/panel-sqlite/src/native/database.h`;

const WRAPPER = `#include <sqlite3.h>

class Database {
public:
    Database() { sqlite3_open(":memory:", &handle); }
    ~Database() { sqlite3_close(handle); }

    void exec(const std::string& sql);
    std::string query(const std::string& sql);

private:
    sqlite3* handle = nullptr;
};`;

const USAGE = `import { initNative, Database } from './native/database.h';

await initNative();
const db = await new Database();

await db.exec(catalogAsSql);
const rows = await db.query(yourQuery);`;

const megabytes = (bytes) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

function Label({ tokens, children }) {
    return (
        <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted, marginBottom: 8 }}>
            {children}
        </div>
    );
}

function Source({ tokens, file, code }) {
    return (
        <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, overflow: 'hidden', background: tokens.codeBg }}>
            <div
                style={{
                    padding: '8px 12px',
                    borderBottom: `1px solid ${tokens.border}`,
                    background: tokens.codeSurface,
                    fontFamily: tokens.mono,
                    fontSize: 11.5,
                    color: tokens.codeMuted,
                }}
            >
                {file}
            </div>
            {/* The highlighter emits one div per line, so the indentation only survives with `pre`. */}
            <div
                style={{
                    padding: 14,
                    fontFamily: tokens.mono,
                    fontSize: 12,
                    lineHeight: 1.65,
                    color: tokens.codeText,
                    overflowX: 'auto',
                    whiteSpace: 'pre',
                }}
            >
                {highlight(code, tokens)}
            </div>
        </div>
    );
}

function Results({ tokens, state }) {
    if (state.status === 'failed') {
        return <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.warn, lineHeight: 1.6 }}>{state.message}</div>;
    }
    if (!state.table) return null;
    if (!state.table.columns.length) return <div style={{ fontSize: 13, color: tokens.textMuted }}>No rows.</div>;
    return (
        <div style={{ overflowX: 'auto' }}>
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
        try {
            const module = await loadDemo(DEMO_ID);
            const db = state.db ?? (await new module.Database());
            if (!state.db) {
                await db.exec(createStatement());
                await db.exec(insertStatement());
            }
            const started = performance.now();
            const table = toTable(await db.query(sql));
            setState({
                status: 'ready',
                db,
                table,
                version: state.version ?? (await db.version()),
                ms: Math.round((performance.now() - started) * 100) / 100,
            });
        } catch (error) {
            setState((current) => ({ ...current, status: 'failed', table: null, message: error?.message ?? String(error) }));
        }
    };

    const busy = state.status === 'running';
    const booted = Boolean(state.db);

    return (
        <section style={{ padding: '20px var(--content-x) 80px' }}>
            <div style={{ marginBottom: 26 }}>
                <div style={{ fontFamily: tokens.mono, fontSize: 11, letterSpacing: 1.4, color: tokens.textMuted, marginBottom: 12 }}>
                    LIVE · SQLITE, COMPILED BY CROSSBIND
                </div>
                <h2 style={{ fontSize: 36, margin: '0 0 12px', fontWeight: 600, letterSpacing: -1, color: tokens.text }}>
                    Query a real C library, here.
                </h2>
                <p style={{ fontSize: 16, lineHeight: 1.6, color: tokens.textDim, margin: 0, maxWidth: 640 }}>
                    This page boots the published SQLite port, seeds an in-memory database with its own library catalog and runs
                    whatever you type. No server answers these queries.
                </p>
            </div>

            <div
                style={{
                    border: `1px solid ${tokens.borderStrong}`,
                    borderRadius: 16,
                    padding: 'clamp(16px, 2.5vw, 24px)',
                    background: tokens.panel,
                }}
            >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', gap: 24 }}>
                    <div style={{ minWidth: 0 }}>
                        <Label tokens={tokens}>SQL</Label>
                        <textarea
                            value={sql}
                            onChange={(event) => setSql(event.target.value)}
                            spellCheck="false"
                            aria-label="SQL to run against the library catalog"
                            rows={6}
                            style={{
                                width: '100%',
                                resize: 'vertical',
                                background: tokens.codeBg,
                                color: tokens.codeText,
                                border: `1px solid ${tokens.border}`,
                                borderRadius: 10,
                                padding: 12,
                                fontFamily: tokens.mono,
                                fontSize: 12.5,
                                lineHeight: 1.6,
                            }}
                        />
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, margin: '12px 0 18px' }}>
                            <button
                                type="button"
                                className="tap-target"
                                onClick={run}
                                disabled={busy}
                                style={{
                                    background: tokens.buttonBg,
                                    color: tokens.buttonText,
                                    border: 'none',
                                    padding: '10px 18px',
                                    borderRadius: 9,
                                    fontWeight: 600,
                                    fontSize: 14,
                                    cursor: busy ? 'progress' : 'pointer',
                                }}
                            >
                                {busy ? 'Running…' : 'Run the query'}
                            </button>
                            <span style={{ fontFamily: tokens.mono, fontSize: 11.5, color: tokens.textMuted }}>
                                {booted
                                    ? `sqlite ${state.version} · ${PORTS.length} rows · ${state.ms ?? 0} ms`
                                    : `first run downloads ${megabytes(demo.bytes ?? 0)} of WebAssembly`}
                            </span>
                        </div>
                        <Results tokens={tokens} state={state} />
                    </div>

                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <Source tokens={tokens} file="src/native/database.h" code={WRAPPER} />
                        <Source tokens={tokens} file="src/main.js" code={USAGE} />
                    </div>
                </div>
            </div>

            <p style={{ fontSize: 13, lineHeight: 1.6, color: tokens.textMuted, margin: '18px 0 0', maxWidth: 780 }}>
                {'The database lives in this tab and nothing is uploaded. '}
                <a href={SOURCE_URL} target="_blank" rel="noreferrer" style={{ color: tokens.accentText }}>
                    The wrapper is forty lines
                </a>
                {'; the rest is upstream SQLite, precompiled. '}
                <a href={guideHref('libraries')} style={{ color: tokens.accentText }}>
                    Libraries
                </a>
                {' has the install flow.'}
            </p>
        </section>
    );
}

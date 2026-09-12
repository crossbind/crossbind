import { useEffect, useState } from 'react';
import { Pill } from '../components/ui.jsx';
import { inline } from '../guide/inline.jsx';
import { RELEASE } from '../release.js';
import {
    BIN_TARGET,
    CATEGORY_LABELS,
    PORTS,
    PORTS_CATALOG,
    publishedLibraryTargets,
    publishedTarget,
    TARGET_LABELS,
    WASI_TOOL_PORTS,
} from './catalog.js';
import { portHref } from './pages.js';

// /ports/ as its own page: a catalog, not a doc. The header carries the numbers that describe
// the catalog, the body is the grid with a category filter and the command-tools list. Every
// figure comes from the generated catalog; the prose only frames it.

const TABS = [
    { id: 'libraries', label: 'Prebuilt libraries', hash: '' },
    { id: 'tools', label: 'WASI command tools', hash: '#tools' },
];
const CATEGORY_ORDER = ['geo', 'image', 'database', 'crypto', 'network', 'text', 'compression'];
const commandCount = PORTS.reduce((sum, port) => sum + (publishedTarget(port, BIN_TARGET) ? port.binCommands.length : 0), 0);

function Stat({ tokens, value, label }) {
    return (
        <div style={{ padding: '14px 18px', borderLeft: `1px solid ${tokens.border}` }}>
            <div style={{ fontFamily: tokens.mono, fontSize: 26, fontWeight: 600, letterSpacing: -1, color: tokens.text, lineHeight: 1.1 }}>
                {value}
            </div>
            <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted, marginTop: 6 }}>
                {label.toUpperCase()}
            </div>
        </div>
    );
}

function LibraryCard({ tokens, port }) {
    const targets = publishedLibraryTargets(port);
    const bin = publishedTarget(port, BIN_TARGET);
    return (
        <a
            href={portHref(port.family)}
            className="feat-card"
            style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '20px 20px 16px',
                background: tokens.panel,
                border: `1px solid ${tokens.border}`,
                borderRadius: 14,
                color: tokens.text,
                minHeight: 200,
            }}
        >
            <div style={{ fontFamily: tokens.mono, fontSize: 10, letterSpacing: 1.3, color: tokens.textMuted }}>
                {(CATEGORY_LABELS[port.category] ?? port.category).toUpperCase()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, margin: '8px 0 6px' }}>
                <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: -0.3 }}>{port.name}</div>
                <div style={{ fontFamily: tokens.mono, fontSize: 11.5, color: tokens.textDim, whiteSpace: 'nowrap' }}>{`v${port.nativeVersion}`}</div>
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: tokens.textDim, flex: 1 }}>{port.summary}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '14px 0 12px' }}>
                {targets.map((target) => (
                    <Pill key={target.target} tokens={tokens} style={{ fontSize: 11, padding: '2px 9px' }}>
                        {TARGET_LABELS[target.target]}
                    </Pill>
                ))}
                {bin ? (
                    <Pill
                        tokens={tokens}
                        color={tokens.violet}
                        style={{ fontSize: 11, padding: '2px 9px' }}
                    >{`${port.binCommands.length} ${port.binCommands.length === 1 ? 'command' : 'commands'}`}</Pill>
                ) : null}
                {targets.length === 0 ? (
                    <Pill tokens={tokens} color={tokens.warn} style={{ fontSize: 11, padding: '2px 9px' }}>
                        not published
                    </Pill>
                ) : null}
            </div>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    fontFamily: tokens.mono,
                    fontSize: 11.5,
                    borderTop: `1px solid ${tokens.border}`,
                    paddingTop: 10,
                }}
            >
                <span style={{ color: tokens.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{port.npm}</span>
                <span style={{ color: tokens.accentText, whiteSpace: 'nowrap' }}>details →</span>
            </div>
        </a>
    );
}

function ToolRow({ tokens, port }) {
    const bin = publishedTarget(port, BIN_TARGET);
    return (
        <div className="tool-row" style={{ padding: '18px 0', borderTop: `1px solid ${tokens.border}` }}>
            <div>
                <a href={`${portHref(port.family)}#commands`} style={{ fontSize: 16, fontWeight: 600, color: tokens.text }}>
                    {port.name}
                </a>
                <div style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.textMuted, marginTop: 4 }}>
                    {`v${port.nativeVersion} · ${port.binCommands.length} ${port.binCommands.length === 1 ? 'command' : 'commands'}`}
                </div>
            </div>
            <div style={{ minWidth: 0 }}>
                <code
                    style={{
                        display: 'block',
                        fontFamily: tokens.mono,
                        fontSize: 12.5,
                        color: tokens.codeText,
                        background: tokens.codeSurface,
                        border: `1px solid ${tokens.border}`,
                        borderRadius: 6,
                        padding: '6px 10px',
                        overflowWrap: 'anywhere',
                    }}
                >
                    {`npm install --global ${bin.package}${RELEASE.distTagSuffix}`}
                </code>
                <div
                    style={{
                        fontFamily: tokens.mono,
                        fontSize: 11.5,
                        color: tokens.textDim,
                        lineHeight: 1.8,
                        marginTop: 8,
                        overflowWrap: 'anywhere',
                    }}
                >
                    {port.binCommands.join('  ')}
                </div>
            </div>
        </div>
    );
}

function chipStyle(tokens, selected) {
    return {
        background: selected ? tokens.buttonBg : tokens.pillBg,
        color: selected ? tokens.buttonText : tokens.textDim,
        border: `1px solid ${selected ? tokens.buttonBg : tokens.pillBorder}`,
        borderRadius: 999,
        padding: '5px 12px',
        fontSize: 12.5,
        cursor: 'pointer',
        fontFamily: tokens.sans,
    };
}

export default function LibrariesPage({ tokens, page }) {
    const [tab, setTab] = useState('libraries');
    const [category, setCategory] = useState('all');
    // Both panels are prerendered; the hash picks the tab after hydration, so /ports/#tools deep-links.
    useEffect(() => {
        if (typeof location !== 'undefined' && location.hash === '#tools') setTab('tools');
    }, []);
    const select = (entry) => {
        setTab(entry.id);
        if (typeof history !== 'undefined') history.replaceState(null, '', `${location.pathname}${entry.hash}`);
    };
    const categories = CATEGORY_ORDER.filter((id) => PORTS.some((port) => port.category === id));
    const shown = category === 'all' ? PORTS : PORTS.filter((port) => port.category === category);

    return (
        <main id="content">
            <section className="lib-head" style={{ padding: '52px var(--content-x) 30px' }}>
                <div>
                    <h1
                        style={{
                            fontSize: 'clamp(36px, 5vw, 54px)',
                            fontWeight: 600,
                            letterSpacing: -2,
                            lineHeight: 1.02,
                            margin: '0 0 16px',
                            color: tokens.text,
                        }}
                    >
                        {page.title}
                    </h1>
                    <p style={{ fontSize: 17, lineHeight: 1.65, color: tokens.textDim, margin: 0, maxWidth: 640 }}>{inline(page.lede, tokens)}</p>
                </div>
                <div
                    className="lib-stats"
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        border: `1px solid ${tokens.border}`,
                        borderLeft: 0,
                        borderRadius: 14,
                        overflow: 'hidden',
                        background: tokens.panel,
                    }}
                >
                    <Stat tokens={tokens} value={PORTS.length} label="libraries" />
                    <Stat tokens={tokens} value={WASI_TOOL_PORTS.length} label="ship command tools" />
                    <Stat tokens={tokens} value={commandCount} label="commands" />
                    <Stat tokens={tokens} value={Object.keys(TARGET_LABELS).length - 1} label="library targets" />
                </div>
            </section>

            <section style={{ padding: '0 var(--content-x) 80px' }}>
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 12,
                        borderBottom: `1px solid ${tokens.border}`,
                        marginBottom: 22,
                    }}
                >
                    <div role="tablist" aria-label="Library kinds" style={{ display: 'flex', gap: 6 }}>
                        {TABS.map((entry) => {
                            const selected = entry.id === tab;
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    role="tab"
                                    id={`tab-${entry.id}`}
                                    aria-selected={selected}
                                    aria-controls={`panel-${entry.id}`}
                                    onClick={() => select(entry)}
                                    className="tap-target tab-btn"
                                    style={{
                                        background: 'transparent',
                                        border: 0,
                                        borderBottom: `2px solid ${selected ? tokens.accentText : 'transparent'}`,
                                        marginBottom: -1,
                                        padding: '12px 14px',
                                        fontSize: 14.5,
                                        fontWeight: selected ? 600 : 400,
                                        color: selected ? tokens.text : tokens.textDim,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {entry.label}
                                </button>
                            );
                        })}
                    </div>
                    {tab === 'libraries' ? (
                        <div
                            role="group"
                            aria-label="Filter by category"
                            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 'auto', padding: '8px 0' }}
                        >
                            <button
                                type="button"
                                className="filter-chip"
                                aria-pressed={category === 'all'}
                                onClick={() => setCategory('all')}
                                style={chipStyle(tokens, category === 'all')}
                            >
                                All
                            </button>
                            {categories.map((id) => (
                                <button
                                    key={id}
                                    type="button"
                                    className="filter-chip"
                                    aria-pressed={category === id}
                                    onClick={() => setCategory(id)}
                                    style={chipStyle(tokens, category === id)}
                                >
                                    {CATEGORY_LABELS[id] ?? id}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div id="panel-libraries" role="tabpanel" aria-labelledby="tab-libraries" hidden={tab !== 'libraries'}>
                    <div className="lib-grid">
                        {shown.map((port) => (
                            <LibraryCard key={port.family} tokens={tokens} port={port} />
                        ))}
                    </div>
                </div>

                <div id="panel-tools" role="tabpanel" aria-labelledby="tab-tools" hidden={tab !== 'tools'}>
                    {WASI_TOOL_PORTS.length ? (
                        <div>
                            <p style={{ fontSize: 14.5, lineHeight: 1.7, color: tokens.textDim, margin: '0 0 6px', maxWidth: 720 }}>
                                {inline(
                                    'Upstream command-line tools published as npm executables built for `wasm32-wasip3`. Each needs `wasmtime` on `PATH`, no compiler and no toolchain image - see [WASI commands](/guide/wasi/).',
                                    tokens,
                                )}
                            </p>
                            {WASI_TOOL_PORTS.map((port) => (
                                <ToolRow key={port.family} tokens={tokens} port={port} />
                            ))}
                        </div>
                    ) : (
                        <p style={{ fontSize: 14.5, lineHeight: 1.7, color: tokens.textDim }}>
                            {inline(
                                `No WASI command tool is published on the npm \`${PORTS_CATALOG.distTag}\` tag yet. The repository defines \`-bin-wasi\` packages for ${PORTS.filter((port) => port.binCommands.length > 0).length} libraries; they appear here once a release train publishes them.`,
                                tokens,
                            )}
                        </p>
                    )}
                </div>

                {page.blocks.map((block) =>
                    block.type === 'p' ? (
                        <p key={block.text} style={{ fontSize: 12.5, lineHeight: 1.65, color: tokens.textMuted, margin: '34px 0 0', maxWidth: 720 }}>
                            {inline(block.text, tokens)}
                        </p>
                    ) : null,
                )}
            </section>
        </main>
    );
}

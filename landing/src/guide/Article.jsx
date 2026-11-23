import { useState } from 'react';
import RunnableExample from '../apps/RunnableExample.jsx';
import Disclosure from '../components/Disclosure.jsx';
import DocCode from './DocCode.jsx';
import ReleaseMeta from '../changelog/ReleaseMeta.jsx';
import { inline } from '../../../tooling/learn/src/inline.jsx';

// One renderer for every guide page: pages are data (src/guide/pages/*.js), this turns their
// blocks into the article. Adding a page never means writing markup.

// Anchors land under a sticky header, so every heading reserves its own room.
const ANCHOR_OFFSET = 90;

function Heading({ tokens, id, level, text }) {
    if (level === 3) {
        return (
            <h3 style={{ fontSize: 16.5, fontWeight: 600, margin: '28px 0 8px', color: tokens.text, letterSpacing: -0.2 }}>
                {text}
            </h3>
        );
    }
    return (
        <h2
            id={id}
            style={{
                fontSize: 23,
                fontWeight: 600,
                letterSpacing: -0.4,
                margin: '46px 0 12px',
                paddingTop: 18,
                borderTop: `1px solid ${tokens.border}`,
                color: tokens.text,
                scrollMarginTop: ANCHOR_OFFSET,
            }}
        >
            {text}
        </h2>
    );
}

function List({ tokens, ordered, items }) {
    const Tag = ordered ? 'ol' : 'ul';
    return (
        <Tag style={{ paddingLeft: 22, margin: '0 0 18px', color: tokens.textDim, fontSize: 14.5, lineHeight: 1.7 }}>
            {items.map((item, i) => (
                <li key={`${i}-${item}`} style={{ marginBottom: 6 }}>{inline(item, tokens)}</li>
            ))}
        </Tag>
    );
}

function Callout({ tokens, tone, title, text }) {
    const accent = tone === 'warn' ? tokens.warn : tokens.accentText;
    return (
        <div style={{
            margin: '18px 0 26px',
            padding: '14px 18px',
            background: tokens.panel,
            border: `1px solid ${tokens.border}`,
            borderLeft: `3px solid ${accent}`,
            borderRadius: 8,
            fontSize: 14,
            lineHeight: 1.65,
            color: tokens.textDim,
        }}
        >
            {/* Titles here are sentence-length, so unlike gdal3.js's short "NOTE" label this one
                is not uppercased - a shouted sentence is harder to read than the text under it. */}
            <div style={{ fontFamily: tokens.mono, fontSize: 11, letterSpacing: 0.6, color: accent, marginBottom: 6 }}>
                {title || (tone === 'warn' ? 'Watch out' : 'Note')}
            </div>
            {inline(text, tokens)}
        </div>
    );
}

function Table({ tokens, head, rows }) {
    return (
        // Wide tables scroll inside their own frame rather than widening the page.
        <div style={{ overflowX: 'auto', margin: '16px 0 28px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                    <tr>
                        {head.map((cell) => (
                            <th
                                key={cell}
                                style={{
                                    textAlign: 'left',
                                    fontFamily: tokens.mono,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    letterSpacing: 0.8,
                                    // Not uppercased: headers carry identifiers (`useWorker`,
                                    // `/opfs/`) whose casing is the meaning.
                                    color: tokens.textMuted,
                                    borderBottom: `1px solid ${tokens.borderStrong}`,
                                    padding: '8px 14px 8px 0',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {cell}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={`${i}-${row[0]}`}>
                            {row.map((cell, j) => (
                                <td
                                    key={`${j}-${cell}`}
                                    style={{
                                        padding: '9px 14px 9px 0',
                                        borderBottom: `1px solid ${tokens.border}`,
                                        color: tokens.textDim,
                                        verticalAlign: 'top',
                                        lineHeight: 1.55,
                                    }}
                                >
                                    {inline(cell, tokens)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// A name and what it does, one under the other, at the full width of the page: a table's cells left
// a long description a narrow column. A name's code drops its chip, as the line is the name.
const NAME_CODE = { background: 'none', border: 0, padding: 0 };

function Entries({ tokens, items }) {
    return (
        <dl style={{ margin: '16px 0 28px', borderTop: `1px solid ${tokens.borderStrong}` }}>
            {items.map((item, i) => (
                <div key={`${i}-${item.name}`} style={{ padding: '13px 0 14px', borderBottom: `1px solid ${tokens.border}` }}>
                    <dt style={{ marginBottom: 5, fontSize: 14.5, fontWeight: 600, lineHeight: 1.55, color: tokens.text }}>
                        {inline(item.name, tokens, NAME_CODE)}
                        {item.type && (
                            <span style={{ marginLeft: 10, fontFamily: tokens.mono, fontSize: 12.5, fontWeight: 400, color: tokens.textMuted }}>
                                {item.type}
                            </span>
                        )}
                    </dt>
                    <dd style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: tokens.textDim }}>{inline(item.text, tokens)}</dd>
                    {item.default && (
                        <dd style={{ margin: '3px 0 0', fontSize: 13.5, lineHeight: 1.6, color: tokens.textDim }}>
                            <span style={{ marginRight: 8, fontFamily: tokens.mono, fontSize: 11.5, letterSpacing: 0.3, color: tokens.textMuted }}>
                                Default
                            </span>
                            {inline(item.default, tokens)}
                        </dd>
                    )}
                </div>
            ))}
        </dl>
    );
}

// Platform by platform: every panel is in the markup, so a reader without JavaScript and a crawler
// see all of them; the buttons only choose which one is visible.
function Tabs({ tokens, tabs }) {
    const [active, setActive] = useState(0);
    return (
        <div style={{ margin: '14px 0 28px' }}>
            <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tabs.map((tab, index) => (
                    <button
                        key={tab.label}
                        type="button"
                        role="tab"
                        aria-selected={index === active}
                        className="tap-target"
                        onClick={() => setActive(index)}
                        style={{
                            padding: '6px 13px',
                            borderRadius: 999,
                            fontSize: 13,
                            cursor: 'pointer',
                            border: `1px solid ${index === active ? tokens.accentText : tokens.pillBorder}`,
                            background: index === active ? tokens.pillBg : 'transparent',
                            color: index === active ? tokens.text : tokens.textDim,
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            {tabs.map((tab, index) => (
                <div key={tab.label} role="tabpanel" aria-label={tab.label} hidden={index !== active} style={{ marginTop: 14 }}>
                    <Article tokens={tokens} blocks={tab.blocks} />
                </div>
            ))}
        </div>
    );
}

export default function Article({ tokens, blocks }) {
    return blocks.map((block, i) => {
        const key = `${i}-${block.type}`;
        switch (block.type) {
            case 'h2':
            case 'h3':
                return <Heading key={key} tokens={tokens} id={block.id} level={block.type === 'h3' ? 3 : 2} text={block.text} />;
            case 'p':
                return (
                    <p key={key} style={{ fontSize: 14.5, lineHeight: 1.75, color: tokens.textDim, margin: '0 0 18px' }}>
                        {inline(block.text, tokens)}
                    </p>
                );
            case 'ul':
            case 'ol':
                return <List key={key} tokens={tokens} ordered={block.type === 'ol'} items={block.items} />;
            case 'code':
                return <DocCode key={key} tokens={tokens} file={block.file} code={block.code} />;
            case 'callout':
                return <Callout key={key} tokens={tokens} tone={block.tone} title={block.title} text={block.text} />;
            case 'table':
                return <Table key={key} tokens={tokens} head={block.head} rows={block.rows} />;
            case 'entries':
                return <Entries key={key} tokens={tokens} items={block.items} />;
            case 'release':
                return <ReleaseMeta key={key} tokens={tokens} release={block.release} />;
            case 'example':
                return <RunnableExample key={key} tokens={tokens} demo={block.demo} example={block.example} runnable={block.runnable} direct={block.direct} open={block.open} />;
            case 'tabs':
                return <Tabs key={key} tokens={tokens} tabs={block.tabs} />;
            case 'details':
                return (
                    <Disclosure key={key} tokens={tokens} id={block.id} title={block.summary}>
                        <Article tokens={tokens} blocks={block.blocks} />
                    </Disclosure>
                );
            default:
                return null;
        }
    });
}

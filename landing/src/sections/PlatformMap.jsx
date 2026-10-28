import { useState } from 'react';
import Logo from '../components/Logo.jsx';
import PlatformScene from '../components/PlatformScene.jsx';
import { BRAND, PLATFORM_MAP } from '../data.js';
import { guideHref } from '../guide/nav.js';

// The flow is drawn in a fixed space, x in thousandths of the width and y in pixels, so the curves
// meet the nodes without measuring them and the prerendered page already shows them.
const FLOW_HEIGHT = 460;
const NODE_HEIGHT = 56;
const EDGES = { sourceEnd: 260, hubStart: 370, hubEnd: 630, outputStart: 740 };

const nodeCentres = (count, gap) => {
    const top = (FLOW_HEIGHT - (count * NODE_HEIGHT + (count - 1) * gap)) / 2;
    return Array.from({ length: count }, (_, i) => top + i * (NODE_HEIGHT + gap) + NODE_HEIGHT / 2);
};

// The curves reach the hub in a narrow fan around its middle rather than at a single point.
const fan = (index, count, spread) => FLOW_HEIGHT / 2 + (index - (count - 1) / 2) * spread;

const inPath = (y, index, count) => {
    const mid = (EDGES.sourceEnd + EDGES.hubStart) / 2;
    const end = fan(index, count, 12);
    return `M${EDGES.sourceEnd} ${y}C${mid} ${y} ${mid} ${end} ${EDGES.hubStart} ${end}`;
};

const outPath = (y, index, count) => {
    const mid = (EDGES.hubEnd + EDGES.outputStart) / 2;
    const start = fan(index, count, 10);
    return `M${EDGES.hubEnd} ${start}C${mid} ${start} ${mid} ${y} ${EDGES.outputStart} ${y}`;
};

const accentLine = (tokens) => `color-mix(in srgb, ${tokens.accent} 45%, transparent)`;
const percent = (thousandths) => `${thousandths / 10}%`;

const rowHref = ({ href, guide, anchor }) => {
    if (!guide) return href;
    return anchor ? `${guideHref(guide)}#${anchor}` : guideHref(guide);
};

function RowLink({ row, style, children, ...events }) {
    const href = rowHref(row);
    if (!href) return <div style={style} {...events}>{children}</div>;
    return <a href={href} className="map-link" style={style} {...events}>{children}</a>;
}

function FlowNode({ tokens, row, lead, active, onHover, left, width, centre }) {
    return (
        <RowLink
            row={row}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
            style={{
                position: 'absolute',
                left,
                width,
                top: centre - NODE_HEIGHT / 2,
                height: NODE_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 14px',
                border: `1px solid ${active ? accentLine(tokens) : tokens.borderStrong}`,
                borderRadius: 12,
                background: tokens.panel,
                transition: 'border-color 0.15s',
            }}
        >
            {lead}
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.title}
                </div>
                <div style={{ fontSize: 12.5, color: tokens.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.note}
                </div>
            </div>
        </RowLink>
    );
}

function PlatformFlow({ tokens }) {
    const { sources, core, outputs } = PLATFORM_MAP;
    const [active, setActive] = useState(null);
    const hover = (key) => (on) => setActive(on ? key : null);
    const sourceCentres = nodeCentres(sources.rows.length, 14);
    const outputCentres = nodeCentres(outputs.rows.length, 10);
    const pathStyle = (key) => ({
        stroke: active === key ? tokens.accent : tokens.textMuted,
        strokeOpacity: active === key ? 1 : 0.35,
        strokeWidth: active === key ? 2 : 1.5,
        transition: 'stroke 0.15s, stroke-opacity 0.15s',
    });

    return (
        <div className="platform-flow" style={{ height: FLOW_HEIGHT }}>
            <svg viewBox={`0 0 1000 ${FLOW_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                {sourceCentres.map((y, index) => (
                    <path key={`in-${index}`} d={inPath(y, index, sources.rows.length)} fill="none" vectorEffect="non-scaling-stroke" style={pathStyle(`in-${index}`)} />
                ))}
                {outputCentres.map((y, index) => (
                    <path key={`out-${index}`} d={outPath(y, index, outputs.rows.length)} fill="none" vectorEffect="non-scaling-stroke" style={pathStyle(`out-${index}`)} />
                ))}
            </svg>

            {sources.rows.map((row, index) => (
                <FlowNode
                    key={row.title}
                    tokens={tokens}
                    row={row}
                    left={0}
                    width={percent(EDGES.sourceEnd)}
                    centre={sourceCentres[index]}
                    active={active === `in-${index}`}
                    onHover={hover(`in-${index}`)}
                    lead={(
                        // As wide as the widest chip, @crossbind, so every title starts at the same x.
                        <span style={{ flex: '0 0 88px' }}>
                            <code style={{
                                padding: '2px 6px',
                                borderRadius: 6,
                                border: `1px solid ${tokens.border}`,
                                background: tokens.codeBg,
                                fontFamily: tokens.mono,
                                fontSize: 12,
                                color: tokens.codeText,
                            }}
                            >
                                {row.chip}
                            </code>
                        </span>
                    )}
                />
            ))}

            <div style={{
                position: 'absolute',
                left: percent(EDGES.hubStart),
                width: percent(EDGES.hubEnd - EDGES.hubStart),
                top: '50%',
                transform: 'translateY(-50%)',
                padding: '20px 20px 8px',
                border: `1px solid ${accentLine(tokens)}`,
                borderRadius: 18,
                background: tokens.panel,
            }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <Logo tokens={tokens} size={32} />
                    <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.4, color: tokens.text }}>{BRAND}</span>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {core.rows.map((row) => (
                        <li key={row.title} style={{ borderTop: `1px solid ${tokens.border}` }}>
                            <RowLink row={row} style={{ display: 'block', padding: '9px 10px', margin: '0 -10px', borderRadius: 8 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600, color: tokens.text }}>{row.title}</div>
                                <div style={{ fontSize: 12.5, color: tokens.textMuted }}>{row.note}</div>
                            </RowLink>
                        </li>
                    ))}
                </ul>
            </div>

            {outputs.rows.map((row, index) => (
                <FlowNode
                    key={row.title}
                    tokens={tokens}
                    row={row}
                    left={percent(EDGES.outputStart)}
                    width={percent(1000 - EDGES.outputStart)}
                    centre={outputCentres[index]}
                    active={active === `out-${index}`}
                    onHover={hover(`out-${index}`)}
                    lead={(
                        <span style={{ flex: '0 0 44px', display: 'flex', justifyContent: 'center', color: tokens.textMuted }}>
                            <PlatformScene id={row.scene} height={26} />
                        </span>
                    )}
                />
            ))}
        </div>
    );
}

function Arrow({ tokens }) {
    return (
        <svg className="platform-map-arrow" width="40" height="16" viewBox="0 0 40 16" fill="none" aria-hidden="true" style={{ color: tokens.textMuted }}>
            <path d="M2 8h34M30 2l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function Panel({ tokens, heading, rows, highlight }) {
    return (
        <div style={{
            border: `1px solid ${highlight ? accentLine(tokens) : tokens.borderStrong}`,
            borderRadius: 14,
            background: tokens.panel,
            overflow: 'hidden',
        }}
        >
            <h3 style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: 0,
                padding: '12px 16px',
                borderBottom: `1px solid ${tokens.border}`,
                fontFamily: tokens.mono,
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: 1.4,
                color: tokens.textMuted,
            }}
            >
                {heading}
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {rows.map((row, index) => (
                    <li key={row.title} style={{ borderTop: index ? `1px solid ${tokens.border}` : 'none' }}>
                        <RowLink row={row} style={{ display: 'block', padding: '11px 16px' }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{row.title}</div>
                            <div style={{ marginTop: 2, fontSize: 13, color: tokens.textMuted }}>{row.note}</div>
                        </RowLink>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default function PlatformMap({ tokens }) {
    const { title, lede, sources, core, outputs } = PLATFORM_MAP;

    return (
        <section style={{ padding: '80px var(--content-x) 80px' }}>
            <div style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 36, margin: '0 0 12px', fontWeight: 600, letterSpacing: -1, color: tokens.text }}>{title}</h2>
                <p style={{ fontSize: 16, lineHeight: 1.6, color: tokens.textDim, margin: 0, maxWidth: 640 }}>{lede}</p>
            </div>

            <PlatformFlow tokens={tokens} />

            <div className="platform-map">
                <Panel tokens={tokens} heading={sources.label} rows={sources.rows} />
                <Arrow tokens={tokens} />
                <Panel
                    tokens={tokens}
                    heading={(
                        <>
                            <Logo tokens={tokens} size={16} />
                            <span style={{ fontFamily: tokens.sans, fontSize: 14, fontWeight: 600, letterSpacing: 0, color: tokens.text }}>{BRAND}</span>
                        </>
                    )}
                    rows={core.rows}
                    highlight
                />
                <Arrow tokens={tokens} />
                <Panel tokens={tokens} heading={outputs.label} rows={outputs.rows} />
            </div>
        </section>
    );
}

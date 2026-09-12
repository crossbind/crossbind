import { useState } from 'react';
import { formatPublishedAt } from '../changelog/format.js';
import CommandChip from '../components/CommandChip.jsx';
import PlatformGlyph from '../components/PlatformGlyph.jsx';
import { CodeWindow, highlight } from '../components/ui.jsx';
import { DEMOS } from '../demos.js';
import { inline } from '../guide/inline.jsx';
import { RELEASE } from '../release.js';
import { EXAMPLES, EXAMPLES_CREATOR, EXAMPLES_VERIFIED_AGAINST, EXAMPLES_VERIFIED_ON } from './examples.js';

// /examples/: one card per platform. The web card switches between the bundler and framework
// variants; the run sits on the right as the terminal the reader will type into, the result
// underneath it, and, where a demo was built for the site, the app itself running in a frame.

function CheckIcon({ color }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M20 6L9 17l-5-5" />
        </svg>
    );
}

// The run block is a product-shot window, which has no copy affordance of its own.
function CopyButton({ tokens, text, label = 'COPY' }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard is blocked outside a secure context; the text stays selectable.
        }
    };
    return (
        <button
            type="button"
            onClick={copy}
            className="tap-target"
            aria-label="Copy the run steps"
            style={{
                background: 'transparent',
                border: `1px solid ${tokens.borderStrong}`,
                borderRadius: 6,
                color: tokens.textDim,
                fontFamily: tokens.mono,
                fontSize: 10.5,
                letterSpacing: 0.8,
                padding: '4px 10px',
                cursor: 'pointer',
            }}
        >
            <span aria-live="polite">{copied ? 'COPIED' : label}</span>
        </button>
    );
}

function Label({ tokens, children, style }) {
    return (
        <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted, marginBottom: 8, ...style }}>
            {children}
        </div>
    );
}

// The built example itself, served from /examples/<id>/ next to the site. Only rendered when the
// demo build ran for this deploy; a missing demo leaves the card without a frame, not with a 404.
function LiveDemo({ tokens, demo, tone }) {
    return (
        <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 12, overflow: 'hidden', background: tokens.panelAlt }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${tokens.border}` }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: tone, boxShadow: `0 0 0 3px ${tone}33` }} />
                <span style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted }}>
                    LIVE · THIS BUILD, RUNNING HERE
                </span>
                <a
                    href={demo.href}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginLeft: 'auto', fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 0.8, color: tokens.accentText }}
                >
                    OPEN ↗
                </a>
            </div>
            <iframe
                src={demo.href}
                title={`${demo.id} running`}
                loading="lazy"
                style={{ display: 'block', width: '100%', height: 150, border: 0, background: 'transparent' }}
            />
        </div>
    );
}

function Run({ tokens, entry, tone }) {
    const demo = DEMOS.get(entry.id);
    return (
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: -6 }}>
                <Label tokens={tokens} style={{ marginBottom: 0 }}>
                    RUN
                </Label>
                <CopyButton tokens={tokens} text={entry.steps} />
            </div>
            <CodeWindow tokens={tokens} title="shell" accent={tone}>
                {highlight(entry.steps, tokens)}
            </CodeWindow>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '18px minmax(0, 1fr)',
                    gap: 10,
                    padding: '14px 16px',
                    background: tokens.codeSurface,
                    border: `1px solid ${tokens.border}`,
                    borderLeft: `3px solid ${tokens.accentText}`,
                    borderRadius: 10,
                    fontSize: 13.5,
                    lineHeight: 1.65,
                    color: tokens.textDim,
                }}
            >
                <span style={{ paddingTop: 3 }}>
                    <CheckIcon color={tokens.accentText} />
                </span>
                <div>
                    <Label tokens={tokens} style={{ color: tokens.accentText, marginBottom: 4 }}>
                        EXPECTED RESULT
                    </Label>
                    {inline(entry.expected, tokens)}
                </div>
            </div>
            {demo ? <LiveDemo tokens={tokens} demo={demo} tone={tone} /> : null}
        </div>
    );
}

function VariantTabs({ tokens, variants, active, onSelect }) {
    return (
        <div role="tablist" aria-label="Framework and bundler" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 18px' }}>
            {variants.map((variant) => {
                const selected = variant.id === active.id;
                return (
                    <button
                        key={variant.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => onSelect(variant)}
                        className="tap-target filter-chip"
                        style={{
                            background: selected ? tokens.buttonBg : tokens.pillBg,
                            color: selected ? tokens.buttonText : tokens.textDim,
                            border: `1px solid ${selected ? tokens.buttonBg : tokens.pillBorder}`,
                            borderRadius: 999,
                            padding: '5px 12px',
                            fontSize: 12.5,
                            cursor: 'pointer',
                            fontFamily: tokens.sans,
                        }}
                    >
                        {variant.label}
                    </button>
                );
            })}
        </div>
    );
}

function ExampleCard({ tokens, entry }) {
    const [variant, setVariant] = useState(entry.variants ? entry.variants[0] : null);
    const shown = variant ?? entry;
    return (
        <article
            id={entry.id}
            className="example-card"
            style={{
                background: tokens.panel,
                border: `1px solid ${tokens.border}`,
                borderRadius: 18,
                padding: 'clamp(18px, 3vw, 28px)',
                marginBottom: 22,
                scrollMarginTop: 90,
            }}
        >
            <div style={{ minWidth: 0 }}>
                <h2
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        fontSize: 26,
                        fontWeight: 600,
                        letterSpacing: -0.8,
                        lineHeight: 1.15,
                        margin: '0 0 22px',
                        color: tokens.text,
                    }}
                >
                    <span
                        style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            display: 'grid',
                            placeItems: 'center',
                            background: `${entry.tone}1f`,
                            border: `1px solid ${entry.tone}55`,
                            flexShrink: 0,
                        }}
                    >
                        <PlatformGlyph id={entry.glyph} size={18} color={entry.tone} />
                    </span>
                    {entry.title}
                </h2>
                <p style={{ fontSize: 15, lineHeight: 1.65, color: tokens.textDim, margin: '0 0 18px' }}>{entry.summary}</p>
                {entry.variants ? <VariantTabs tokens={tokens} variants={entry.variants} active={variant} onSelect={setVariant} /> : null}
                <Label tokens={tokens}>{entry.id === 'wasi-tools' ? 'INSTALL' : 'CREATE'}</Label>
                <CommandChip tokens={tokens} command={shown.create} />
                <p style={{ fontSize: 13, lineHeight: 1.6, color: tokens.textMuted, margin: '16px 0 0' }}>{`Needs ${shown.needs ?? entry.needs}`}</p>
                <p style={{ fontSize: 13, margin: '10px 0 0' }}>
                    <a
                        href={shown.source}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: tokens.accentText }}
                    >{`Source: ${shown.source.split('/').slice(-2).join('/')} ↗`}</a>
                </p>
            </div>
            <Run tokens={tokens} entry={shown} tone={entry.tone} />
        </article>
    );
}

// The record is dated; when the channel has moved on, say so instead of quietly re-labelling it.
function CurrentReleaseNote({ tokens }) {
    if (RELEASE.version === EXAMPLES_VERIFIED_AGAINST) return null;
    return (
        <p style={{ fontSize: 13, lineHeight: 1.6, color: tokens.warn, margin: '8px 0 0', maxWidth: 880 }}>
            {`The current release is crossbind ${RELEASE.version}; these runs have not been repeated on it yet.`}
        </p>
    );
}

export default function ExamplesPage({ tokens, page }) {
    return (
        <main id="content">
            {/* Width is capped on the inner block: capping the padded section itself would squeeze
                the copy to nothing on wide screens, where --content-x grows with the viewport. */}
            <section style={{ padding: '52px var(--content-x) 30px' }}>
                <div style={{ maxWidth: 880 }}>
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
                    <p style={{ fontSize: 17, lineHeight: 1.65, color: tokens.textDim, margin: 0 }}>{inline(page.lede, tokens)}</p>
                </div>
            </section>

            <section style={{ padding: '0 var(--content-x) 24px' }}>
                {EXAMPLES.map((entry) => (
                    <ExampleCard key={entry.id} tokens={tokens} entry={entry} />
                ))}
            </section>

            <section style={{ padding: '0 var(--content-x) 80px' }}>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: tokens.textMuted, margin: '18px 0 0', maxWidth: 880 }}>
                    {`Verified ${formatPublishedAt(EXAMPLES_VERIFIED_ON)} against crossbind ${EXAMPLES_VERIFIED_AGAINST}, projects created with ${EXAMPLES_CREATOR}.`}
                </p>
                <CurrentReleaseNote tokens={tokens} />
            </section>
        </main>
    );
}

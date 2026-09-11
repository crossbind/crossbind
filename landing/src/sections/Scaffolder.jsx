import { useEffect, useState } from 'react';
import PlatformGlyph from '../components/PlatformGlyph.jsx';
import { Pill } from '../components/ui.jsx';
import {
    CREATE_COMMAND, SCAFFOLD_BUNDLERS, SCAFFOLD_FRAMEWORKS, SCAFFOLD_LINES, SCAFFOLD_TARGETS,
} from '../data.js';

const RESTART_DELAY = 5000;

// The transcript types itself on a loop, which is what "reduce motion" asks us not to do.
// CSS cannot stop a JS timer, so the preference is read here and the whole transcript is shown at once.
const prefersReducedMotion = () => typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;

function ScaffoldTerminal({ tokens }) {
    const [still] = useState(prefersReducedMotion);
    const [shown, setShown] = useState(() => (prefersReducedMotion() ? SCAFFOLD_LINES.length : 1));
    const done = shown >= SCAFFOLD_LINES.length;

    useEffect(() => {
        if (still) return undefined;
        const delay = done ? RESTART_DELAY : SCAFFOLD_LINES[shown].delay;
        const timer = setTimeout(() => setShown(done ? 1 : shown + 1), delay);
        return () => clearTimeout(timer);
    }, [shown, done, still]);

    const toneOf = (kind) => ({
        user: tokens.codeMuted,
        question: tokens.codeText,
        ok: tokens.accent,
        next: tokens.violet,
        gap: tokens.codeText,
    })[kind] || tokens.codeText;

    return (
        <div style={{
            background: tokens.codeBg,
            border: `1px solid ${tokens.borderStrong}`,
            borderRadius: 14,
            overflow: 'hidden',
            fontFamily: tokens.mono,
            fontSize: 13,
            lineHeight: 1.7,
            boxShadow: tokens.isLight ? '0 24px 60px rgba(0,0,0,0.10)' : '0 30px 80px rgba(0,0,0,0.45)',
        }}
        >
            <div style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 14px',
                background: tokens.codeSurface,
                borderBottom: `1px solid ${tokens.border}`,
            }}
            >
                <div style={{ display: 'flex', gap: 6 }}>
                    {['#ff5f56', '#ffbd2e', '#27c93f'].map((c) => (
                        <div key={c} style={{ width: 11, height: 11, borderRadius: 999, background: c, opacity: 0.85 }} />
                    ))}
                </div>
                <div style={{ flex: 1, textAlign: 'center', fontSize: 12, color: tokens.codeMuted }}>
                    terminal · ~/projects
                </div>
                <div style={{ width: 6, height: 6, borderRadius: 999, background: done ? tokens.violet : tokens.accent }} />
            </div>

            <div style={{ padding: '18px 20px', minHeight: 400, color: tokens.codeText, overflowX: 'auto' }}>
                {SCAFFOLD_LINES.slice(0, shown).map((line) => {
                    const prompt = line.kind === 'question' ? line.text.match(/^(\? [^›]+› )(.+)$/) : null;
                    return (
                        <div key={line.text || `gap-${line.delay}`} style={{ color: toneOf(line.kind), whiteSpace: 'pre' }}>
                            {prompt ? (
                                <>
                                    <span style={{ color: tokens.codeMuted }}>{prompt[1]}</span>
                                    <span style={{ color: tokens.codeText, fontWeight: 600 }}>{prompt[2]}</span>
                                </>
                            ) : line.text || ' '}
                        </div>
                    );
                })}
                {!done && (
                    <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 14,
                        marginTop: 4,
                        background: tokens.accent,
                        animation: 'blink 1s steps(1) infinite',
                        verticalAlign: 'text-bottom',
                    }}
                    />
                )}
            </div>
        </div>
    );
}

function ChoiceGroup({ tokens, label, children }) {
    return (
        <div>
            <div style={{ fontFamily: tokens.mono, fontSize: 12, letterSpacing: 1.2, color: tokens.textMuted, marginBottom: 8 }}>
                {label}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
        </div>
    );
}

function Chip({ tokens, children }) {
    return (
        <span style={{
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 12,
            background: tokens.pillBg,
            border: `1px solid ${tokens.border}`,
            color: tokens.textDim,
            fontFamily: tokens.sans,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
        }}
        >
            {children}
        </span>
    );
}

export default function Scaffolder({ tokens }) {
    const code = {
        background: tokens.codeBg,
        padding: '1px 7px',
        borderRadius: 5,
        fontFamily: tokens.mono,
        fontSize: 13.5,
        color: tokens.codeAccent,
    };

    return (
        <section style={{ padding: '20px var(--content-x) 80px' }}>
            <div style={{
                padding: 'var(--card-p)',
                borderRadius: 24,
                position: 'relative',
                overflow: 'hidden',
                background: `linear-gradient(135deg, ${tokens.accentBright}14, ${tokens.blue}0b 50%, ${tokens.isLight ? 'rgba(255,255,255,0.5)' : 'rgba(7,11,20,0.5)'})`,
                border: `1px solid ${tokens.borderStrong}`,
            }}
            >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 48, alignItems: 'start' }}>
                    <div>
                        <Pill tokens={tokens} style={{ marginBottom: 18 }}>
                            <span style={{ color: tokens.accent }}>$</span>
                            <span style={{ fontFamily: tokens.mono, fontSize: 12 }}>{CREATE_COMMAND}</span>
                        </Pill>

                        <h2 style={{
                            fontFamily: tokens.sans,
                            fontSize: 42,
                            fontWeight: 600,
                            lineHeight: 1.05,
                            letterSpacing: -1.2,
                            margin: '0 0 14px',
                            color: tokens.text,
                        }}
                        >
                            Start fresh in under a minute.
                        </h2>

                        <p style={{ color: tokens.textDim, fontSize: 16, lineHeight: 1.6, marginBottom: 24, maxWidth: 500 }}>
                            The scaffolder asks five questions and prints a working repo — framework, bundler,
                            target, and a sample C++ binding already wired.
                            {' '}
                            <code style={code}>npm run dev</code>
                            {' '}
                            works on the spot.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
                            <ChoiceGroup tokens={tokens} label="FRAMEWORKS">
                                {SCAFFOLD_FRAMEWORKS.map((f) => <Chip key={f} tokens={tokens}>{f}</Chip>)}
                            </ChoiceGroup>
                            <ChoiceGroup tokens={tokens} label="BUNDLERS">
                                {SCAFFOLD_BUNDLERS.map((b) => <Chip key={b} tokens={tokens}>{b}</Chip>)}
                            </ChoiceGroup>
                            <ChoiceGroup tokens={tokens} label="TARGETS">
                                {SCAFFOLD_TARGETS.map((t) => (
                                    <Chip key={t.label} tokens={tokens}>
                                        <PlatformGlyph id={t.glyph} size={12} color={t.tone} />
                                        {t.label}
                                    </Chip>
                                ))}
                            </ChoiceGroup>
                        </div>
                    </div>

                    <ScaffoldTerminal tokens={tokens} />
                </div>
            </div>
        </section>
    );
}

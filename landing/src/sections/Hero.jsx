import { useState } from 'react';
import PlatformGlyph from '../components/PlatformGlyph.jsx';
import PromptModal from '../components/PromptModal.jsx';
import {
    CodeWindow, GradientText, highlight, SecondaryButton,
} from '../components/ui.jsx';
import { LANGUAGE_TABS, RUNTIME_CHIPS, spell } from '../data.js';
import { guideHref } from '../guide/nav.js';

// The "runs in" footer under the universal code block.
function RuntimeStrip({ tokens }) {
    return (
        <div style={{
            marginTop: 14,
            padding: 14,
            background: tokens.panel,
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
        }}
        >
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 12,
                color: tokens.textDim,
                fontFamily: tokens.mono,
                marginBottom: 12,
            }}
            >
                <span style={{ color: tokens.accent }}>✓</span>
                {/* Derived, so adding a runtime can never leave the label lying. */}
                <span style={{ letterSpacing: 0.5 }}>{`SAME CALL · ${spell(RUNTIME_CHIPS.length).toUpperCase()} RUNTIMES`}</span>
                <span style={{ flex: 1, height: 1, background: tokens.border, marginLeft: 8 }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 8 }}>
                {RUNTIME_CHIPS.map((chip) => (
                    <div
                        key={chip.id}
                        style={{
                            padding: '12px 14px',
                            background: tokens.isLight ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${tokens.border}`,
                            borderRadius: 9,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text }}>{chip.label}</span>
                            <div style={{ display: 'flex', gap: 3 }}>
                                {chip.glyphs.map((glyph) => (
                                    <PlatformGlyph key={glyph} id={glyph} size={13} color={chip.tone} />
                                ))}
                            </div>
                        </div>
                        <div style={{ fontSize: 12, color: tokens.textMuted, fontFamily: tokens.mono, lineHeight: 1.4 }}>
                            {chip.sub}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// The headline claims C++ and Rust, so the proof sits right under it.
function LanguageTabs({ tokens, active, onSelect }) {
    // Arrow keys are what a screen-reader user expects once this announces as a tablist.
    const onKeyDown = (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const i = LANGUAGE_TABS.findIndex((t) => t.id === active);
        onSelect(LANGUAGE_TABS[(i + step + LANGUAGE_TABS.length) % LANGUAGE_TABS.length].id);
    };

    return (
        <div
            role="tablist"
            aria-label="Language"
            onKeyDown={onKeyDown}
            style={{ display: 'flex', gap: 4, marginBottom: 10 }}
        >
            {LANGUAGE_TABS.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`tab-${tab.id}`}
                    className="tap-target"
                    aria-selected={tab.id === active}
                    aria-controls="language-panel"
                    tabIndex={tab.id === active ? 0 : -1}
                    onClick={() => onSelect(tab.id)}
                    style={{
                        background: tab.id === active ? tokens.pillBg : 'transparent',
                        border: `1px solid ${tab.id === active ? tokens.borderStrong : 'transparent'}`,
                        color: tab.id === active ? tokens.text : tokens.textDim,
                        borderRadius: 8,
                        padding: '5px 14px',
                        fontSize: 12.5,
                        fontFamily: tokens.mono,
                        cursor: 'pointer',
                    }}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

function UniversalCode({ tokens }) {
    const [active, setActive] = useState(LANGUAGE_TABS[0].id);

    return (
        <>
            <LanguageTabs tokens={tokens} active={active} onSelect={setActive} />
            {/* Both samples share one grid cell so the window is always as tall as the taller one, which a line count cannot predict once lines wrap. */}
            <div role="tabpanel" id="language-panel" aria-labelledby={`tab-${active}`} style={{ display: 'grid' }}>
                {LANGUAGE_TABS.map((tab) => (
                    <div key={tab.id} style={{ gridArea: '1 / 1', display: 'grid', visibility: tab.id === active ? 'visible' : 'hidden' }}>
                        <CodeWindow tokens={tokens} title={tab.title} accent={tokens.accent}>
                            {highlight(tab.code, tokens)}
                        </CodeWindow>
                    </div>
                ))}
            </div>
            <RuntimeStrip tokens={tokens} />
        </>
    );
}

// Setting this up is agent work now, so the primary CTA opens the prompt rather than a command.
function AgentSetup({ tokens, onOpen }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            aria-haspopup="dialog"
            style={{
                background: tokens.buttonBg,
                color: tokens.buttonText,
                border: 'none',
                padding: '14px 24px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 15,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
            }}
        >
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M12 3.5 13.8 10.2 20.5 12 13.8 13.8 12 20.5 10.2 13.8 3.5 12 10.2 10.2Z" />
            </svg>
            Set up with an AI agent
        </button>
    );
}

export default function Hero({ tokens }) {
    const [promptOpen, setPromptOpen] = useState(false);

    return (
        <section style={{ padding: '64px var(--content-x) 60px', textAlign: 'center', position: 'relative' }}>
            <h1 style={{
                fontFamily: tokens.sans,
                fontSize: 'clamp(44px, 7vw, 84px)',
                fontWeight: 600,
                lineHeight: 1,
                letterSpacing: -3,
                margin: '0 0 24px',
            }}
            >
                Import C++ and Rust
                <br />
                <GradientText gradient={`linear-gradient(110deg, ${tokens.accent} 0%, ${tokens.blue} 60%, ${tokens.violet} 100%)`}>
                    like JavaScript modules.
                </GradientText>
            </h1>

            <p style={{ fontSize: 19, color: tokens.textDim, maxWidth: 660, margin: '0 auto 36px', lineHeight: 1.55 }}>
                No bindings, no glue, no second build system. One import runs in the browser, on iOS and Android,
                in Node, on Workers, and as a WASI command.
            </p>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 26 }}>
                <AgentSetup tokens={tokens} onOpen={() => setPromptOpen(true)} />
                <SecondaryButton tokens={tokens} href={guideHref('quick-start')}>Read the quick start</SecondaryButton>
            </div>

            <p style={{ margin: '0 0 32px', fontSize: 13.5, color: tokens.textMuted }}>
                Free and open source under the MIT license.
            </p>

            <div style={{ textAlign: 'left' }}>
                <UniversalCode tokens={tokens} />
            </div>

            <PromptModal tokens={tokens} open={promptOpen} onClose={() => setPromptOpen(false)} />
        </section>
    );
}

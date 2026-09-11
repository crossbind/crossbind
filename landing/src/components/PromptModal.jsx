import { useEffect, useRef, useState } from 'react';
import { SETUP_PROMPT, SKILL_COMMAND } from '../data.js';
import { Pill } from './ui.jsx';

function CopyButton({
    tokens, text, label, style,
}) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard is blocked outside a secure context; the text stays selectable.
        }
    };

    return (
        <button
            type="button"
            onClick={copy}
            style={{
                background: tokens.buttonBg,
                color: tokens.buttonText,
                border: 'none',
                padding: '10px 18px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 13.5,
                cursor: 'pointer',
                flexShrink: 0,
                ...style,
            }}
        >
            <span aria-live="polite">{copied ? 'Copied ✓' : label}</span>
        </button>
    );
}

function Step({
    tokens, n, title, badge, children,
}) {
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    display: 'grid',
                    placeItems: 'center',
                    background: `${tokens.violet}1a`,
                    color: tokens.violet,
                    fontSize: 12,
                    fontWeight: 600,
                    flexShrink: 0,
                }}
                >
                    {n}
                </span>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
                {badge ? <Pill tokens={tokens} color={tokens.violet}>{badge}</Pill> : null}
            </div>
            {children}
        </div>
    );
}

// Native <dialog> so the focus trap, Escape handling and inertness come from the platform
// rather than from hand-rolled key listeners.
export default function PromptModal({ tokens, open, onClose }) {
    const ref = useRef(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (open && !el.open) el.showModal();
        if (!open && el.open) el.close();
    }, [open]);

    const codeBox = {
        margin: 0,
        padding: '12px 14px',
        borderRadius: 10,
        background: tokens.codeBg,
        border: `1px solid ${tokens.border}`,
        color: tokens.codeText,
        fontFamily: tokens.mono,
        fontSize: 12.5,
        lineHeight: 1.65,
        whiteSpace: 'pre-wrap',
        // The install URL is one unbreakable token; without this it overflows the box.
        overflowWrap: 'anywhere',
    };
    const note = {
        margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.55, color: tokens.textDim,
    };

    return (
        <dialog
            ref={ref}
            onClose={onClose}
            // A backdrop click lands on the dialog element itself, not on its children.
            onClick={(e) => { if (e.target === ref.current) onClose(); }}
            aria-label="Set up with an AI agent"
            className="prompt-dialog"
            style={{
                width: 'min(760px, calc(100vw - 32px))',
                maxHeight: 'min(80vh, 720px)',
                padding: 0,
                border: `1px solid ${tokens.borderRaised}`,
                borderRadius: 16,
                background: tokens.panelRaised,
                boxShadow: tokens.raisedShadow,
                color: tokens.text,
                overflow: 'hidden',
                // The hero centres its text; a prompt has to read left-aligned.
                textAlign: 'left',
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'inherit' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '16px 20px',
                    borderBottom: `1px solid ${tokens.border}`,
                }}
                >
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Set up with an AI agent</h2>
                    <div style={{ flex: 1 }} />
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: tokens.textDim,
                            fontSize: 18,
                            lineHeight: 1,
                            cursor: 'pointer',
                            padding: 4,
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* minHeight:0 lets this flex child scroll instead of stretching the dialog past its cap. */}
                <div style={{ overflow: 'auto', minHeight: 0, padding: 20 }}>
                    <Step tokens={tokens} n="1" title="Install the skill" badge="RECOMMENDED">
                        <p style={note}>
                            Your agent gets the project inspector, the current port catalog and the
                            per-framework playbooks, then wires the project up without being prompted.
                        </p>
                        <div style={{
                            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
                        }}
                        >
                            <code style={{ ...codeBox, flex: '1 1 260px' }}>{SKILL_COMMAND}</code>
                            <CopyButton tokens={tokens} text={SKILL_COMMAND} label="Copy" />
                        </div>
                        <p style={{
                            ...note, margin: '10px 0 0', fontSize: 12.5, color: tokens.textMuted,
                        }}
                        >
                            Drop
                            {' '}
                            <code style={{ fontFamily: tokens.mono }}>--global</code>
                            {' '}
                            to install it into this project only.
                        </p>
                    </Step>

                    <hr style={{ border: 0, borderTop: `1px solid ${tokens.border}`, margin: '22px 0' }} />

                    <Step tokens={tokens} n="2" title="Or paste this prompt">
                        <p style={note}>
                            For clients that cannot install skills. Paste into Claude Code, Cursor, Copilot…
                        </p>
                        <pre style={{ ...codeBox, maxHeight: 240, overflow: 'auto' }}>{SETUP_PROMPT}</pre>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                            <CopyButton
                                tokens={tokens}
                                text={SETUP_PROMPT}
                                label="Copy prompt"
                                style={{
                                    background: tokens.pillBg,
                                    color: tokens.text,
                                    border: `1px solid ${tokens.borderStrong}`,
                                }}
                            />
                        </div>
                    </Step>
                </div>
            </div>
        </dialog>
    );
}

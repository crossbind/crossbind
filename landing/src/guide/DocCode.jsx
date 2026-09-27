import { useState } from 'react';
import { highlight } from '../components/ui.jsx';

// Docs code block. Deliberately not ui.jsx's CodeWindow: that one is the hero's product shot -
// traffic lights, centred filename - and forty of them down a reference page is noise. This is
// the slim bar gdal3.js uses on its doc pages: what file you are looking at, and a copy button.
export default function DocCode({ tokens, file, code, maxHeight }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard is blocked outside a secure context; the text stays selectable.
        }
    };

    return (
        <div style={{
            margin: '18px 0 26px',
            border: `1px solid ${tokens.border}`,
            borderRadius: 10,
            overflow: 'hidden',
            background: tokens.codeBg,
        }}
        >
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '8px 14px',
                background: tokens.codeSurface,
                borderBottom: `1px solid ${tokens.border}`,
            }}
            >
                <span style={{ fontFamily: tokens.mono, fontSize: 11.5, letterSpacing: 0.6, color: tokens.codeMuted }}>
                    {file}
                </span>
                <button
                    type="button"
                    onClick={copy}
                    style={{
                        fontFamily: tokens.mono,
                        fontSize: 10.5,
                        letterSpacing: 0.8,
                        background: 'transparent',
                        color: tokens.codeMuted,
                        border: `1px solid ${tokens.border}`,
                        borderRadius: 5,
                        padding: '3px 9px',
                        cursor: 'pointer',
                    }}
                >
                    <span aria-live="polite">{copied ? 'COPIED' : 'COPY'}</span>
                </button>
            </div>
            {/* The highlighter emits one div per line, so the indentation only survives with `pre`. */}
            <div style={{
                padding: '16px 18px',
                fontFamily: tokens.mono,
                fontSize: 12.5,
                lineHeight: 1.65,
                color: tokens.codeText,
                overflowX: 'auto',
                whiteSpace: 'pre',
                ...(maxHeight ? { maxHeight, overflowY: 'auto' } : {}),
            }}
            >
                {highlight(code, tokens)}
            </div>
        </div>
    );
}

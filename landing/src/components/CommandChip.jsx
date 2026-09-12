import { useState } from 'react';

// One shell command with a copy button: the install line on a library page, the create line on
// an example. Sized to sit in a row with links, not a full code block.
export default function CommandChip({ tokens, command, label = 'Copy' }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard is blocked outside a secure context; the text stays selectable.
        }
    };

    return (
        <div style={{
            display: 'inline-flex',
            alignItems: 'stretch',
            maxWidth: '100%',
            border: `1px solid ${tokens.borderStrong}`,
            borderRadius: 10,
            background: tokens.codeBg,
            overflow: 'hidden',
        }}
        >
            <code style={{
                padding: '10px 14px',
                fontFamily: tokens.mono,
                fontSize: 13,
                color: tokens.codeText,
                overflowWrap: 'anywhere',
                alignSelf: 'center',
            }}
            >
                {command}
            </code>
            <button
                type="button"
                onClick={copy}
                className="tap-target"
                aria-label={`Copy: ${command}`}
                style={{
                    border: 0,
                    borderLeft: `1px solid ${tokens.borderStrong}`,
                    background: tokens.codeSurface,
                    color: tokens.textDim,
                    fontFamily: tokens.mono,
                    fontSize: 11,
                    letterSpacing: 0.8,
                    padding: '0 14px',
                    cursor: 'pointer',
                    flexShrink: 0,
                }}
            >
                <span aria-live="polite">{copied ? 'COPIED' : label.toUpperCase()}</span>
            </button>
        </div>
    );
}

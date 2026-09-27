import { useState } from 'react';
import { highlight } from '../components/ui.jsx';

// The chrome every library app shares: what it does, the controls, one run button, the result,
// and the code that produced it. Nothing native loads until the visitor presses run; the first
// press downloads the library's WebAssembly, later presses reuse it.

export const megabytes = (bytes) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

// A run is one async task against the booted module; the card only tracks where it stands.
export function useNativeTask(load) {
    const [state, setState] = useState({ status: 'idle' });
    const run = async (task) => {
        setState((current) => ({ ...current, status: 'running' }));
        try {
            const module = await load();
            const started = performance.now();
            const result = await task(module);
            setState({ status: 'ready', result, ms: Math.round(performance.now() - started) });
        } catch (error) {
            setState({ status: 'failed', message: error?.message ?? String(error) });
        }
    };
    return [state, run];
}

export function Label({ tokens, children }) {
    return <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted, marginBottom: 8 }}>{children}</div>;
}

export function Source({ tokens, file, code }) {
    return (
        <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, overflow: 'hidden', background: tokens.codeBg, minWidth: 0 }}>
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${tokens.border}`, background: tokens.codeSurface, fontFamily: tokens.mono, fontSize: 11.5, color: tokens.codeMuted }}>{file}</div>
            {/* The highlighter emits one div per line, so the indentation only survives with `pre`. */}
            <div style={{ padding: 14, fontFamily: tokens.mono, fontSize: 12, lineHeight: 1.65, color: tokens.codeText, overflowX: 'auto', whiteSpace: 'pre' }}>{highlight(code, tokens)}</div>
        </div>
    );
}

export const fieldStyle = (tokens) => ({
    width: '100%',
    background: tokens.codeBg,
    color: tokens.codeText,
    border: `1px solid ${tokens.border}`,
    borderRadius: 9,
    padding: '9px 11px',
    fontFamily: tokens.mono,
    fontSize: 12.5,
    lineHeight: 1.55,
});

export function RunButton({ tokens, busy, onClick, children }) {
    return (
        <button
            type="button"
            data-run=""
            className="tap-target"
            onClick={onClick}
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
            {busy ? 'Running…' : children}
        </button>
    );
}

export function Failure({ tokens, message }) {
    return <div style={{ fontFamily: tokens.mono, fontSize: 12.5, color: tokens.warn, lineHeight: 1.6, overflowWrap: 'anywhere' }}>{message}</div>;
}

export default function AppCard({ tokens, id, index, title, pitch, status, note, controls, output, code }) {
    return (
        <article
            data-app={id}
            data-status={status}
            style={{ border: `1px solid ${tokens.borderStrong}`, borderRadius: 16, background: tokens.panel, padding: 'clamp(16px, 2.5vw, 24px)', minWidth: 0 }}
        >
            <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.4, color: tokens.textMuted, marginBottom: 10 }}>{`APP ${String(index + 1).padStart(2, '0')}`}</div>
            <h3 style={{ fontSize: 21, fontWeight: 600, letterSpacing: -0.4, margin: '0 0 8px', color: tokens.text }}>{title}</h3>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: tokens.textDim, margin: '0 0 20px', maxWidth: 680 }}>{pitch}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 22, alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                    {controls}
                    {note ? <div style={{ fontFamily: tokens.mono, fontSize: 11.5, color: tokens.textMuted, marginTop: 10 }}>{note}</div> : null}
                </div>
                <div data-output="" style={{ minWidth: 0 }}>{output}</div>
            </div>
            {code?.length ? (
                <details style={{ marginTop: 18 }}>
                    <summary className="tap-target" style={{ cursor: 'pointer', fontFamily: tokens.mono, fontSize: 11.5, letterSpacing: 0.8, color: tokens.accentText }}>SHOW THE CODE</summary>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14, marginTop: 14 }}>
                        {code.map((entry) => <Source key={entry.file} tokens={tokens} file={entry.file} code={entry.code} />)}
                    </div>
                </details>
            ) : null}
        </article>
    );
}

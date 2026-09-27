import { fieldStyle, Label } from './AppCard.jsx';

// The small controls and readouts every library app shares. Nothing here reaches for the DOM
// outside an event handler, so the pages still prerender.

export const grouped = (value) => Number(value).toLocaleString('en-US');

// A Blob keeps its own type; bytes and strings are wrapped in one of `type`.
export function download(data, name, type = 'application/octet-stream') {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// With `options`, [value, text] pairs, onChange gets the chosen value back as it was given, number
// or string. With <option> children it gets the string the browser reports.
export function Select({ tokens, label, value, options, onChange, disabled, children }) {
    const pick = (event) => onChange(options ? options[event.target.selectedIndex][0] : event.target.value);
    return (
        <label style={{ display: 'block', minWidth: 0, opacity: disabled ? 0.5 : 1 }}>
            <Label tokens={tokens}>{label}</Label>
            <select value={value} disabled={disabled} onChange={pick} style={{ ...fieldStyle(tokens), fontFamily: tokens.sans, fontSize: 13.5 }}>
                {options ? options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>) : children}
            </select>
        </label>
    );
}

export function Toggle({ tokens, checked, onChange, children }) {
    return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: tokens.textDim, cursor: 'pointer' }}>
            <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
            {children}
        </label>
    );
}

// `run` marks the button the site's checks press first, as RunButton is marked.
export function SecondaryButton({ tokens, onClick, disabled, pressed, run, children }) {
    return (
        <button
            type="button"
            className="tap-target"
            data-run={run ? '' : undefined}
            aria-pressed={pressed}
            onClick={onClick}
            disabled={disabled}
            style={{
                background: pressed ? tokens.panel : tokens.pillBg,
                color: disabled ? tokens.textMuted : pressed ? tokens.accentText : tokens.text,
                border: `1px solid ${pressed ? tokens.accent : tokens.borderStrong}`,
                padding: '9px 14px',
                borderRadius: 9,
                fontWeight: 500,
                fontSize: 13.5,
                cursor: disabled ? 'default' : 'pointer',
            }}
        >
            {children}
        </button>
    );
}

export function FileButton({ tokens, accept, multiple, busy, onFile, onFiles, children }) {
    return (
        <label
            className="tap-target"
            aria-disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 14px', borderRadius: 9, border: `1px solid ${tokens.borderStrong}`, background: tokens.pillBg, color: busy ? tokens.textMuted : tokens.text, fontSize: 13.5, cursor: busy ? 'progress' : 'pointer' }}
        >
            {children}
            <input
                type="file"
                accept={accept}
                multiple={multiple}
                disabled={busy}
                style={{ display: 'none' }}
                onChange={(event) => {
                    const files = [...(event.target.files ?? [])];
                    event.target.value = '';
                    if (!files.length) return;
                    if (onFiles) onFiles(files);
                    else onFile(files[0]);
                }}
            />
        </label>
    );
}

export function Stat({ tokens, value, label, accent, warn, size = 28 }) {
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: size, fontWeight: 600, letterSpacing: -0.8, color: warn ? tokens.warn : accent ? tokens.accentDisplay : tokens.text, lineHeight: 1.1, overflowWrap: 'anywhere' }}>{value}</div>
            <div style={{ fontSize: 12.5, color: tokens.textMuted, marginTop: 4, overflowWrap: 'anywhere' }}>{label}</div>
        </div>
    );
}

export function Bars({ tokens, rows }) {
    const largest = Math.max(...rows.map((row) => row.bytes));
    return (
        <div style={{ display: 'grid', gap: 11 }}>
            {rows.map((row) => (
                <div key={row.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: tokens.textDim, marginBottom: 5 }}>
                        <span>{row.label}</span>
                        <span style={{ fontFamily: tokens.mono, color: row.highlight ? tokens.accentText : tokens.textDim, whiteSpace: 'nowrap' }}>{row.detail ?? `${grouped(row.bytes)} B`}</span>
                    </div>
                    <div style={{ height: 10, borderRadius: 5, background: tokens.pillBg, border: `1px solid ${tokens.border}`, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(0.5, (row.bytes / largest) * 100)}%`, height: '100%', background: row.highlight ? tokens.accent : tokens.textMuted }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

// `flush` drops the top margin where a grid gap already spaces the line.
export function Meta({ tokens, flush, children }) {
    return <div style={{ fontFamily: tokens.mono, fontSize: 11.5, color: tokens.textMuted, marginTop: flush ? 0 : 12, lineHeight: 1.6, overflowWrap: 'anywhere' }}>{children}</div>;
}

export function Hint({ tokens, children }) {
    return <p style={{ fontSize: 13, lineHeight: 1.6, color: tokens.textMuted, margin: 0 }}>{children}</p>;
}

export function Placeholder({ tokens, children }) {
    return (
        <div style={{ border: `1px dashed ${tokens.borderStrong}`, borderRadius: 12, padding: '26px 18px', fontSize: 13.5, lineHeight: 1.6, color: tokens.textMuted, textAlign: 'center' }}>{children}</div>
    );
}

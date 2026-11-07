import { useEffect, useRef, useState } from 'react';
import { TURBO } from '../components/turbo.jsx';
import { Account, statusText, visuallyHidden } from './parts.jsx';

// The Turbo look's menu bar in place of the modern toolbar, with the same actions: Run, the samples, packages and a
// new file; ≡ is only drawn, as in the hero. A menu is a button that shows a list of buttons; the background is left
// to styles.css, so hovering an item lights it.

const item = (mono) => ({
    border: 'none', padding: '0 8px', font: 'inherit', fontFamily: mono, color: TURBO.black, cursor: 'pointer', whiteSpace: 'pre',
});

// Turbo C++ drew each menu's first letter in red. The letter's own span splits the name a screen reader computes, so
// each of these buttons carries its word as aria-label.
const Hotkey = ({ children }) => (
    <>
        <span style={{ color: TURBO.red }}>{children[0]}</span>
        {children.slice(1)}
    </>
);

// Picking an item gives focus back to the menu's button before the item acts, so an item that moves focus itself
// (New file…) still can. The list closes once focus leaves it.
function Menu({
    id, mono, label, title, items, alignRight = false,
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const trigger = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const close = (event) => {
            if (!ref.current?.contains(event.target)) setOpen(false);
        };
        addEventListener('pointerdown', close);
        return () => removeEventListener('pointerdown', close);
    }, [open]);
    return (
        <span
            ref={ref}
            style={{ position: 'relative' }}
            onKeyDown={(event) => {
                if (event.key !== 'Escape' || !open) return;
                setOpen(false);
                trigger.current?.focus();
            }}
            // Only a move to somewhere else on the page: a click in Safari blurs to nothing, and outside clicks close it above.
            onFocusOut={(event) => {
                if (event.relatedTarget && !ref.current?.contains(event.relatedTarget)) setOpen(false);
            }}
        >
            <button ref={trigger} id={id} type="button" aria-expanded={open} aria-label={title} onClick={() => setOpen(!open)} className="tap-target" style={{ ...item(mono), ...(open ? { background: TURBO.green } : {}) }}>
                {label}
            </button>
            {open && (
                <ul style={{
                    position: 'absolute', top: '100%', ...(alignRight ? { right: 0 } : { left: 0 }), zIndex: 30, minWidth: 220, margin: 0, padding: '4px 0', listStyle: 'none', background: TURBO.gray, border: `1px solid ${TURBO.black}`, boxShadow: `6px 6px 0 ${TURBO.black}`,
                }}
                >
                    {items.map((entry) => (
                        <li key={entry.label}>
                            <button
                                type="button"
                                disabled={entry.disabled}
                                aria-current={entry.current ? 'true' : undefined}
                                onClick={() => {
                                    setOpen(false);
                                    trigger.current?.focus();
                                    entry.onSelect();
                                }}
                                style={{
                                    ...item(mono), display: 'block', width: '100%', textAlign: 'left', padding: '0 12px', opacity: entry.disabled ? 0.55 : 1, cursor: entry.disabled ? 'default' : 'pointer',
                                }}
                            >
                                {`${entry.current ? '√' : ' '} ${entry.label}`}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </span>
    );
}

export default function TurboBar({
    tokens, phase, session, ready, runOff, prebuilt, samples, sampleId, edited,
    onRun, onStop, onSelectSample, onNewFile, onReset, onAddPackage, onSignOut, onDeleteAccount,
}) {
    const { mono } = tokens;
    const busy = phase !== 'idle';
    const runLabel = { loading: 'Loading…', compiling: 'Compiling…', running: 'Stop' }[phase];
    const bar = {
        ...tokens, text: TURBO.black, textDim: TURBO.black, accentText: TURBO.black,
    };
    return (
        <div className="turbo-bar" style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', background: TURBO.gray, color: TURBO.black, fontFamily: mono, fontSize: 13, lineHeight: '22px', padding: '0 4px',
        }}
        >
            <h1 style={visuallyHidden}>Playground</h1>
            <span aria-hidden="true" className="tap-target" style={{ padding: '0 8px' }}>≡</span>
            <Menu
                id="turbo-file-menu"
                mono={mono}
                label={<Hotkey>File</Hotkey>}
                title="File"
                items={[
                    { label: 'New file…', onSelect: onNewFile, disabled: busy },
                    { label: 'Reset sample', onSelect: onReset, disabled: busy || !edited },
                ]}
            />
            <button type="button" onClick={onAddPackage} disabled={busy} aria-label="Packages" className="tap-target" style={item(mono)}>
                <Hotkey>Packages</Hotkey>
            </button>
            <Menu
                mono={mono}
                label={<Hotkey>Samples</Hotkey>}
                title="Samples"
                alignRight
                items={samples.map((sample) => ({
                    label: sample.title, current: sample.id === sampleId, disabled: busy, onSelect: () => onSelectSample(sample.id),
                }))}
            />
            {/* Some browsers give a disabled button no pointer, so the reason sits on a wrapper the pointer reaches. */}
            <span title={runOff ?? undefined} style={{ display: 'inline-flex' }}>
                <button
                    type="button"
                    onClick={phase === 'running' ? onStop : onRun}
                    disabled={phase !== 'running' && !ready}
                    aria-label={runLabel ?? 'Run'}
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                    className="tap-target"
                    style={{
                        ...item(mono), opacity: phase === 'running' || ready ? 1 : 0.55, cursor: phase === 'running' || ready ? 'pointer' : 'default', pointerEvents: runOff ? 'none' : undefined,
                    }}
                >
                    {runLabel ?? <Hotkey>Run</Hotkey>}
                </button>
            </span>
            <span style={{ flex: 1 }} />
            <span aria-live="polite" style={{ padding: '0 8px' }}>{statusText(phase, session, prebuilt)}</span>
            <span style={{ padding: '0 8px' }}>
                <Account tokens={bar} session={session} onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} />
            </span>
        </div>
    );
}

import { useEffect, useRef, useState } from 'react';
import {
    MAIN, fileNames, newFileError, packageOf,
} from './project.js';

// The project's files with the config the compiler writes for it, and its packages: the modern look's side panel, and
// the lists both looks share.

export const CONFIG = 'crossbind.config.js';
export const SOURCE_LABELS = Object.freeze({ port: 'crossbind port', crate: 'crates.io', conan: 'ConanCenter' });

export const plainButton = {
    background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer',
};

function Heading({
    tokens, children, action, actionLabel, onAction, disabled,
}) {
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 10px 6px', fontSize: 12, fontWeight: 600, color: tokens.textMuted,
        }}
        >
            <h2 style={{ margin: 0, font: 'inherit' }}>{children}</h2>
            <button type="button" onClick={onAction} disabled={disabled} aria-label={actionLabel} className="tap-target" style={{ ...plainButton, fontWeight: 500, color: tokens.textDim }}>
                {action}
            </button>
        </div>
    );
}

// A selected row takes rowActiveBg and rowActiveText where a look has them (Turbo's cyan bar). A row nothing can open
// is text, not a button.
function Row({
    tokens, label, note, active, onSelect, onRemove, removeLabel, disabled,
}) {
    const Item = onSelect ? 'button' : 'span';
    return (
        <li style={{
            display: 'flex', alignItems: 'center', borderRadius: tokens.rowRadius ?? 6, background: active ? (tokens.rowActiveBg ?? tokens.pillBg) : 'transparent',
        }}
        >
            <Item
                {...(onSelect ? { type: 'button', onClick: onSelect, 'aria-current': active ? 'true' : undefined } : {})}
                style={{
                    ...plainButton,
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: tokens.rowPadding ?? '6px 10px',
                    textAlign: 'left',
                    color: active ? (tokens.rowActiveText ?? tokens.text) : tokens.textDim,
                    cursor: onSelect ? 'pointer' : 'default',
                }}
            >
                <span style={{ fontFamily: tokens.mono, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                <span style={{ fontSize: 11.5, color: active ? (tokens.rowActiveText ?? tokens.textMuted) : tokens.textMuted, whiteSpace: 'nowrap' }}>{note}</span>
            </Item>
            {onRemove && (
                <button type="button" onClick={onRemove} disabled={disabled} aria-label={removeLabel} title={removeLabel} style={{ ...plainButton, padding: '4px 8px', color: active ? (tokens.rowActiveText ?? tokens.textMuted) : tokens.textMuted }}>
                    ×
                </button>
            )}
        </li>
    );
}

// `request` changes each time a new file is asked for, and each time the name field takes focus.
function NewFile({
    tokens, project, request, onCreate, onCancel,
}) {
    const [name, setName] = useState('');
    const [error, setError] = useState(null);
    const input = useRef(null);
    useEffect(() => {
        input.current?.focus();
    }, [request]);
    const submit = (event) => {
        event.preventDefault();
        const problem = newFileError(project, name.trim());
        if (problem) setError(problem);
        else onCreate(name.trim());
    };
    return (
        <form onSubmit={submit} style={{ padding: '4px 10px 8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: tokens.mono, fontSize: 12.5, color: tokens.textMuted }}>
                native/
                <input
                    ref={input}
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                        setError(null);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') onCancel();
                    }}
                    placeholder="name.h"
                    aria-label="New file name"
                    aria-invalid={Boolean(error)}
                    spellcheck={false}
                    autocapitalize="off"
                    style={{
                        flex: 1, minWidth: 0, padding: '5px 8px', font: 'inherit', color: tokens.inputText ?? tokens.text, background: tokens.inputBg ?? tokens.panel, border: `1px solid ${tokens.borderStrong}`, borderRadius: tokens.rowRadius ?? 6,
                    }}
                />
            </label>
            {error && <div role="alert" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.45, color: tokens.warn }}>{error}</div>}
            <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12.5 }}>
                <button type="submit" style={{ ...plainButton, color: tokens.accentText, fontWeight: 500 }}>Create</button>
                <button type="button" onClick={onCancel} style={{ ...plainButton, color: tokens.textDim }}>Cancel</button>
            </div>
        </form>
    );
}

const LIST = { listStyle: 'none', margin: 0, padding: 0 };

export function FileList({
    tokens, project, active, disabled, creating, onCreating, onOpen, onCreateFile, onRemoveFile,
}) {
    return (
        <>
            {creating > 0 && (
                <NewFile
                    tokens={tokens}
                    project={project}
                    request={creating}
                    onCreate={(name) => {
                        onCreating(false);
                        onCreateFile(name);
                    }}
                    onCancel={() => onCreating(false)}
                />
            )}
            <ul style={LIST}>
                {fileNames(project).map((name) => (
                    <Row
                        key={name}
                        tokens={tokens}
                        label={name}
                        active={name === active}
                        onSelect={() => onOpen(name)}
                        onRemove={name === MAIN ? null : () => onRemoveFile(name)}
                        removeLabel={`Delete ${name}`}
                        disabled={disabled}
                    />
                ))}
                <Row tokens={tokens} label={CONFIG} active={active === CONFIG} onSelect={() => onOpen(CONFIG)} />
            </ul>
        </>
    );
}

export function PackageList({
    tokens, project, disabled, onRemovePackage,
}) {
    if (project.packages.length === 0) return <p style={{ margin: '4px 10px', fontSize: 12.5, color: tokens.textMuted }}>None yet.</p>;
    return (
        <ul style={LIST}>
            {project.packages.map((id) => packageOf(id)).map((pkg) => (
                <Row
                    key={pkg.id}
                    tokens={tokens}
                    label={pkg.name}
                    note={SOURCE_LABELS[pkg.source]}
                    onRemove={() => onRemovePackage(pkg.id)}
                    removeLabel={`Remove ${pkg.name}`}
                    disabled={disabled}
                />
            ))}
        </ul>
    );
}

export default function ProjectPanel({
    tokens, disabled, onCreating, onAddPackage, ...lists
}) {
    return (
        <nav aria-label="Project" style={{ padding: '4px 10px 16px' }}>
            <Heading tokens={tokens} action="+ New" actionLabel="New file" onAction={() => onCreating(true)} disabled={disabled}>Files</Heading>
            <FileList tokens={tokens} disabled={disabled} onCreating={onCreating} {...lists} />
            <Heading tokens={tokens} action="+ Add" actionLabel="Add package" onAction={onAddPackage} disabled={disabled}>Packages</Heading>
            <PackageList tokens={tokens} disabled={disabled} {...lists} />
        </nav>
    );
}

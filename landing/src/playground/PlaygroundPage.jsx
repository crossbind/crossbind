import { useEffect, useRef, useState } from 'react';
import {
    PLAYGROUND_DRAFT_KEY, editDraft, projectOf, readDrafts, updateDrafts, without,
} from './drafts.js';
import ModernWorkspace from './ModernWorkspace.jsx';
import PackageDialog from './PackageDialog.jsx';
import { CONFIG } from './ProjectPanel.jsx';
import TurboBar from './TurboBar.jsx';
import TurboWorkspace from './TurboWorkspace.jsx';
import { Notice, Toolbar, linkButtonStyle, visuallyHidden } from './parts.jsx';
import {
    MAIN, addFile, addPackage, removeFile, removePackage, setFile,
} from './project.js';
import { DEFAULT_SAMPLE, SAMPLES, findSample } from './samples.js';
import { SKIN_PARAM, readSkin } from './skin.js';
import { canRunPrebuilt, useRunner } from './useRunner.js';
import { shortName } from './workspace.jsx';

// /playground/: a project of files and packages, the open file and the console. useRunner.js runs main.js against
// the sample's prebuilt module, or against one the playground compiler (tooling/cloud) builds from the edited
// project. All of it lives here once; the modern and the Turbo look only draw it. The first render matches the
// prerendered page: the drafts, the linked sample, the look, the sign-in result and the session load afterwards.

const SAMPLE_PARAM = 'sample';
const RESET_QUESTION = 'Discard your changes to this sample?';
const LOGIN_NOTICES = Object.freeze({
    ok: 'Signed in.',
    'too-new': 'This GitHub account is too new to sign in here yet.',
    blocked: 'This GitHub account may not use the playground.',
    failed: 'Signing in did not work; try again.',
    cancelled: 'Signing in was cancelled.',
});

// ?sample=<id> opens that sample, and the address follows the picker, so every sample can be linked to.
const linkedSample = () => findSample(new URLSearchParams(location.search).get(SAMPLE_PARAM))?.id;

function setParam(name, value) {
    const url = new URL(location.href);
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    history.replaceState(null, '', url);
}

function takeLoginResult() {
    const result = new URLSearchParams(location.hash.slice(1)).get('login');
    if (!result) return null;
    history.replaceState(null, '', location.pathname + location.search);
    return Object.hasOwn(LOGIN_NOTICES, result) ? LOGIN_NOTICES[result] : null;
}

function SamplePicker({
    tokens, sampleId, edited, disabled, onSelect, onReset,
}) {
    return (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13, color: tokens.textDim }}>
            <label htmlFor="playground-sample">Sample</label>
            <select
                id="playground-sample"
                value={sampleId}
                disabled={disabled}
                onChange={(event) => onSelect(event.target.value)}
                className="tap-target"
                style={{
                    padding: '7px 10px',
                    fontSize: 13.5,
                    fontFamily: 'inherit',
                    color: tokens.text,
                    background: tokens.panel,
                    border: `1px solid ${tokens.borderStrong}`,
                    borderRadius: 8,
                    cursor: disabled ? 'default' : 'pointer',
                }}
            >
                {SAMPLES.map((sample) => (
                    <option key={sample.id} value={sample.id}>{sample.title}</option>
                ))}
            </select>
            {edited && (
                <button type="button" onClick={onReset} disabled={disabled} className="tap-target" style={linkButtonStyle(tokens)}>
                    Reset
                </button>
            )}
        </span>
    );
}

export default function PlaygroundPage({ tokens, page }) {
    const [sampleId, setSampleId] = useState(DEFAULT_SAMPLE.id);
    const [drafts, setDrafts] = useState({});
    const [restored, setRestored] = useState(false);
    const [skin, setSkin] = useState('modern');
    const [active, setActive] = useState(MAIN);
    const [view, setView] = useState('code');
    // 0 while closed; each request for a new file counts up, so the form takes focus again when asked again.
    const [creating, setCreating] = useState(0);
    const [adding, setAdding] = useState(false);
    const creatingRequests = useRef(0);
    const returnFocus = useRef(null);
    const runner = useRunner();
    const sample = findSample(sampleId);
    const project = projectOf(sample, drafts[sampleId]);
    const prebuilt = canRunPrebuilt(sampleId, project, sample.project);
    const shown = active === CONFIG || active in project.files ? active : MAIN;
    const busy = runner.phase !== 'idle';
    const edited = Boolean(drafts[sampleId]);
    const ready = restored && !busy && (prebuilt || runner.canCompile);

    useEffect(() => {
        const stored = readDrafts(PLAYGROUND_DRAFT_KEY, SAMPLES);
        const linked = linkedSample();
        const id = linked ?? stored.sample ?? DEFAULT_SAMPLE.id;
        setDrafts(stored.drafts);
        setSampleId(id);
        setSkin(readSkin(location.search));
        setRestored(true);
        // A sample restored from an earlier visit goes into the address too, so a copied link keeps it.
        if (!linked && id !== DEFAULT_SAMPLE.id) setParam(SAMPLE_PARAM, id);
        const loginNotice = takeLoginResult();
        if (loginNotice) runner.setNotice({ text: loginNotice });
    }, []);

    // The pre-paint script in index.html hides the modern look from a Turbo visitor until this has run.
    useEffect(() => {
        if (!restored) return undefined;
        document.documentElement.dataset.playgroundSkin = skin;
        return () => delete document.documentElement.dataset.playgroundSkin;
    }, [restored, skin]);

    // Applied to the project as each copy holds it, so a second tab's edits to the same sample survive.
    const change = (edit) => {
        setDrafts((current) => editDraft(current, sample, edit));
        updateDrafts(PLAYGROUND_DRAFT_KEY, SAMPLES, (store) => ({ ...store, drafts: editDraft(store.drafts, sample, edit) }));
    };

    const run = () => {
        setView('console');
        runner.run({ sampleId, project, original: sample.project });
    };

    // Leaving the Turbo look drops the ?skin= the visit came with, so a reload opens the modern look too. The mark
    // changes at once, or the Turbo look would hide the modern one until the effect above runs.
    function showModern() {
        document.documentElement.dataset.playgroundSkin = 'modern';
        setSkin('modern');
        setParam(SKIN_PARAM, null);
    }

    function selectSample(id) {
        setSampleId(id);
        setActive(MAIN);
        setCreating(0);
        setParam(SAMPLE_PARAM, id);
        updateDrafts(PLAYGROUND_DRAFT_KEY, SAMPLES, (store) => ({ ...store, sample: id }));
        runner.clear();
    }

    // The Reset link goes with the draft, so focus moves to the picker beside it; Turbo's File menu keeps its own.
    function resetSample() {
        if (!window.confirm(RESET_QUESTION)) return;
        setDrafts((current) => without(current, sampleId));
        updateDrafts(PLAYGROUND_DRAFT_KEY, SAMPLES, (store) => ({ ...store, drafts: without(store.drafts, sampleId) }));
        setActive(MAIN);
        if (skin === 'modern') document.getElementById('playground-sample')?.focus();
    }

    function open(name) {
        setActive(name);
        setView('code');
    }

    const onKeyDown = (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            if (ready) run();
        }
    };

    const workspace = {
        tokens,
        project,
        sampleId,
        shown,
        view,
        busy,
        creating,
        lines: runner.lines,
        buildLog: runner.buildLog,
        lastRun: runner.lastRun,
        intro: page.intro,
        onView: setView,
        onOpen: open,
        onSelectFile: setActive,
        // Focus goes back to whatever asked for the form once it closes.
        onCreating: (on) => {
            if (on) {
                returnFocus.current = document.activeElement;
                creatingRequests.current += 1;
                setCreating(creatingRequests.current);
                setView('files');
                return;
            }
            setCreating(0);
            requestAnimationFrame(() => {
                if (returnFocus.current?.isConnected) returnFocus.current.focus();
            });
        },
        onCreateFile: (name) => {
            change((current) => addFile(current, name));
            open(`native/${name}`);
        },
        onRemoveFile: (name) => {
            if (window.confirm(`Delete ${shortName(name)}?`)) change((current) => removeFile(current, name));
        },
        onAddPackage: () => setAdding(true),
        onRemovePackage: (id) => change((current) => removePackage(current, id)),
        onEdit: (text) => change((current) => setFile(current, shown, text)),
    };

    return (
        <main id="content">
            <section className="playground-app" data-skin={skin} aria-label="Playground" onKeyDown={onKeyDown} style={{ borderBottom: `1px solid ${tokens.border}` }}>
                {skin === 'turbo' ? (
                    <TurboBar
                        tokens={tokens}
                        phase={runner.phase}
                        session={runner.session}
                        ready={ready}
                        prebuilt={prebuilt}
                        samples={SAMPLES}
                        sampleId={sampleId}
                        edited={edited}
                        onRun={run}
                        onStop={runner.stop}
                        onSelectSample={selectSample}
                        onNewFile={() => workspace.onCreating(true)}
                        onReset={resetSample}
                        onAddPackage={() => setAdding(true)}
                        onModern={showModern}
                        onSignOut={runner.leave}
                        onDeleteAccount={runner.removeAccount}
                    />
                ) : (
                    <Toolbar
                        tokens={tokens}
                        phase={runner.phase}
                        session={runner.session}
                        ready={ready}
                        prebuilt={prebuilt}
                        onRun={run}
                        onStop={runner.stop}
                        onSignOut={runner.leave}
                        onDeleteAccount={runner.removeAccount}
                        // On the files pane's surface, so the toolbar reads as the editor's and not as a second navbar.
                        style={{ margin: 0, padding: '10px var(--playground-x)', background: tokens.panelAlt, borderBottom: `1px solid ${tokens.border}` }}
                    >
                        <h1 style={visuallyHidden}>{page.title}</h1>
                        <SamplePicker tokens={tokens} sampleId={sampleId} edited={edited} disabled={busy} onSelect={selectSample} onReset={resetSample} />
                    </Toolbar>
                )}
                <div ref={runner.check} />
                {runner.notice && (
                    <Notice tokens={tokens} notice={runner.notice} canSignIn={Boolean(runner.session?.canSignIn)} style={{ margin: '10px var(--playground-x)' }} />
                )}
                {skin === 'turbo' ? <TurboWorkspace {...workspace} /> : <ModernWorkspace {...workspace} />}
            </section>

            <PackageDialog
                tokens={tokens}
                turbo={skin === 'turbo'}
                open={adding}
                project={project}
                onAdd={(id) => change((current) => addPackage(current, id))}
                onClose={() => setAdding(false)}
            />
        </main>
    );
}

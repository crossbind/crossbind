import { useEffect, useRef, useState } from 'react';
import { configSource } from '../../../tooling/cloud/compiler/packages.js';
import PrevNext from '../components/PrevNext.jsx';
import Tabs from '../components/Tabs.jsx';
import { NavMenu } from '../components/menu.jsx';
import { CodeWindow } from '../components/ui.jsx';
import { PLAYGROUND_URL } from '../data.js';
import Article from '../guide/Article.jsx';
import { inline } from '../guide/inline.jsx';
import { TUTORIAL_PAGES } from '../pages/tutorial.js';
import {
    PLAYGROUND_DRAFT_KEY, editDraft, projectOf, readDrafts, replacesEdits, updateDrafts, without,
} from '../playground/drafts.js';
import Editor, { fitHeight } from '../playground/Editor.jsx';
import {
    Console, Notice, Toolbar, linkButtonStyle,
} from '../playground/parts.jsx';
import { MAIN, setFile } from '../playground/project.js';
import { CONFIG } from '../playground/ProjectPanel.jsx';
import { SAMPLES, findSample } from '../playground/samples.js';
import { canRunPrebuilt, useRunner } from '../playground/useRunner.js';

// /tutorial/: one step per page, the lesson beside the step's playground sample in one tabbed editor, the run
// controls and the console. Edits are kept per step in this browser; useRunner.js runs an unedited step's prebuilt
// module, so reading through the tutorial never needs a compile.

const DRAFT_KEY = 'crossbind.tutorial.project';
const RESET_QUESTION = 'Discard your changes to this step?';
const REPLACE_QUESTION = 'Replace your changes to this sample in the playground?';
const MIN_EDITOR_HEIGHT = 320;

// The header first, as most lessons read, then the rest of the native files, then main.js, and last the config the
// compiler writes from the packages, read-only as in the playground.
const isHeader = (name) => /\.(?:h|hh|hpp|hxx)$/.test(name);
const filesOf = (project) => [
    ...Object.keys(project.files)
        .sort((a, b) => Number(a === MAIN) - Number(b === MAIN) || Number(isHeader(b)) - Number(isHeader(a)) || a.localeCompare(b))
        .map((name) => ({ id: name, label: name.replace(/^native\//, '') })),
    ...(project.packages.length ? [{ id: CONFIG, label: CONFIG }] : []),
];
const configOf = (project) => (project.packages.length ? configSource([...project.packages].sort()) : '');

export default function TutorialPage({ tokens, page }) {
    const sample = findSample(page.sample);
    const files = filesOf(sample.project);
    const [file, setOpenFile] = useState(page.open ?? files[0].id);
    const [drafts, setDrafts] = useState({});
    const [restored, setRestored] = useState(false);
    const runner = useRunner({ lazy: true });
    const output = useRef(null);
    const project = projectOf(sample, drafts[sample.id]);
    const prebuilt = canRunPrebuilt(sample.id, project, sample.project);
    const index = TUTORIAL_PAGES.findIndex((step) => step.path === page.path);
    // The last step's "where to go next" sits with the links to the other steps, so it follows the code once the
    // columns stack.
    const onwardAt = page.blocks.findIndex((block) => block.id === 'next');
    const lesson = onwardAt === -1 ? page.blocks : page.blocks.slice(0, onwardAt);
    const onward = onwardAt === -1 ? [] : page.blocks.slice(onwardAt);
    // As tall as the sample's longest file, so switching files never moves the console.
    const editorHeight = Math.max(MIN_EDITOR_HEIGHT, ...[...Object.values(sample.project.files), configOf(sample.project)].map(fitHeight));

    useEffect(() => {
        setDrafts(readDrafts(DRAFT_KEY, SAMPLES).drafts);
        setRestored(true);
    }, []);

    // An unedited step runs its prebuilt module, so the session loads only once the project needs a compile.
    useEffect(() => {
        if (restored && !prebuilt) runner.connect();
    }, [restored, prebuilt]);

    const edit = (text) => {
        const change = (current) => setFile(current, file, text);
        setDrafts((current) => editDraft(current, sample, change));
        updateDrafts(DRAFT_KEY, SAMPLES, (store) => ({ ...store, drafts: editDraft(store.drafts, sample, change) }));
    };
    // A long sample pushes the console below the fold, so a run brings it into view.
    const run = () => {
        output.current?.scrollIntoView({ block: 'nearest' });
        runner.run({ sampleId: sample.id, project, original: sample.project });
    };

    function reset() {
        if (!window.confirm(RESET_QUESTION)) return;
        setDrafts((current) => without(current, sample.id));
        updateDrafts(DRAFT_KEY, SAMPLES, (store) => ({ ...store, drafts: without(store.drafts, sample.id) }));
        // The button goes with the draft, so focus moves to the open file's tab.
        document.getElementById(`tutorial-file-${file}`)?.focus();
    }

    // The playground opens the step as edited here. Its own different edits to the sample go only on a yes.
    function openInPlayground(event) {
        const draft = drafts[sample.id];
        if (!draft) return;
        if (replacesEdits(readDrafts(PLAYGROUND_DRAFT_KEY, SAMPLES).drafts, sample, draft) && !window.confirm(REPLACE_QUESTION)) {
            event.preventDefault();
            return;
        }
        updateDrafts(PLAYGROUND_DRAFT_KEY, SAMPLES, (store) => ({ ...store, drafts: { ...store.drafts, [sample.id]: draft } }));
    }

    const onKeyDown = (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            run();
        }
    };

    return (
        <main id="content" className="tutorial-grid" style={{ padding: '48px var(--content-x) 80px' }}>
            <article style={{ minWidth: 0 }}>
                <NavMenu
                    tokens={tokens}
                    label={`TUTORIAL · STEP ${index + 1} OF ${TUTORIAL_PAGES.length}`}
                    items={TUTORIAL_PAGES.map((step, at) => ({ label: `${at + 1}. ${step.title}`, href: step.href, current: at === index }))}
                    style={{ width: 'fit-content', margin: '-4px 0 10px -8px' }}
                    summaryStyle={{ padding: '4px 8px', fontFamily: tokens.mono, fontSize: 11, letterSpacing: 1.2, color: tokens.textMuted }}
                    // Under the sticky header (z-index 5), so a page scrolled with the list open slides it beneath.
                    panelStyle={{ minWidth: 240, zIndex: 4 }}
                />
                <h1 style={{ fontSize: 'clamp(30px, 3.4vw, 42px)', fontWeight: 600, letterSpacing: -1.2, lineHeight: 1.08, margin: '0 0 16px', color: tokens.text }}>
                    {page.title}
                </h1>
                <p style={{ fontSize: 16.5, lineHeight: 1.65, color: tokens.textDim, margin: '0 0 24px' }}>{inline(page.lede, tokens)}</p>
                <Article tokens={tokens} blocks={lesson} />
            </article>

            <section aria-label="Code" onKeyDown={onKeyDown} style={{ minWidth: 0 }}>
                <div style={{ marginBottom: 16 }}>
                    <CodeWindow
                        tokens={tokens}
                        padded={false}
                        title={<Tabs tokens={tokens} label="Files" tabs={files} panelId="tutorial-file" active={file} onSelect={setOpenFile} style={{ marginBottom: 0, flexWrap: 'wrap' }} />}
                    >
                        <div role="tabpanel" id="tutorial-file" aria-labelledby={`tutorial-file-${file}`}>
                            {file === CONFIG ? (
                                <Editor key={`${sample.id}/${CONFIG}`} tokens={tokens} label={`${CONFIG}, written from the packages`} value={configOf(project)} onChange={() => {}} minHeight={editorHeight} readOnly />
                            ) : (
                                <Editor key={`${sample.id}/${file}`} tokens={tokens} label={file} value={project.files[file] ?? ''} onChange={edit} minHeight={editorHeight} />
                            )}
                        </div>
                    </CodeWindow>
                </div>
                <Toolbar
                    tokens={tokens}
                    phase={runner.phase}
                    session={runner.session}
                    ready={restored && runner.phase === 'idle' && (prebuilt || runner.canCompile)}
                    prebuilt={prebuilt}
                    away
                    onRun={run}
                    onStop={runner.stop}
                    onSignOut={runner.leave}
                    onDeleteAccount={runner.removeAccount}
                >
                    <a href={`${PLAYGROUND_URL}?sample=${sample.id}`} onClick={openInPlayground} onAuxClick={(event) => { if (event.button === 1) openInPlayground(event); }} className="tap-target" style={{ ...linkButtonStyle(tokens), fontSize: 13, textDecoration: 'none' }}>
                        Open in playground
                    </a>
                    {drafts[sample.id] && (
                        <button type="button" onClick={reset} disabled={runner.phase !== 'idle'} className="tap-target" style={{ ...linkButtonStyle(tokens), fontSize: 13 }}>
                            Reset
                        </button>
                    )}
                </Toolbar>
                <div ref={runner.check} />
                {runner.notice && <Notice tokens={tokens} notice={runner.notice} canSignIn={Boolean(runner.session?.canSignIn)} away />}
                <div ref={output}>
                    <Console tokens={tokens} lines={runner.lines} buildLog={runner.buildLog} lastRun={runner.lastRun} />
                </div>
            </section>

            <div style={{ minWidth: 0 }}>
                {onward.length > 0 && <Article tokens={tokens} blocks={onward} />}
                <PrevNext tokens={tokens} label="Tutorial steps" prev={TUTORIAL_PAGES[index - 1]} next={TUTORIAL_PAGES[index + 1]} />
            </div>
        </main>
    );
}

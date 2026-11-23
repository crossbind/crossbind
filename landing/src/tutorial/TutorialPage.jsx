import { useEffect, useRef, useState } from 'react';
import { configSource } from '../../../tooling/cloud/compiler/packages.js';
import PrevNext from '../components/PrevNext.jsx';
import { NavMenu } from '../components/menu.jsx';
import {
    TURBO, TurboMenu, TurboMenuLink, TurboWindow, turboOutputTokens, turboTokens,
} from '../components/turbo.jsx';
import { PLAYGROUND_URL } from '../data.js';
import Article from '../guide/Article.jsx';
import { inline } from '../../../tooling/learn/src/inline.jsx';
import { TUTORIAL_PAGES, TUTORIAL_SECTIONS } from '../pages/tutorial.js';
import {
    PLAYGROUND_DRAFT_KEY, editDraft, projectOf, readDrafts, replacesEdits, updateDrafts, without,
} from '../../../tooling/learn/src/drafts.js';
import Editor, { fitHeight } from '../../../tooling/learn/src/Editor.jsx';
import { ConsoleLines, runInfo } from '../../../tooling/learn/src/output.jsx';
import { Notice, Toolbar } from '../playground/parts.jsx';
import { canRunPrebuilt, hasPrebuilt } from '../../../tooling/learn/src/prebuilt.js';
import { MAIN, setFile } from '../../../tooling/learn/src/project.js';
import { CONFIG } from '../playground/ProjectPanel.jsx';
import { runOffReason } from '../../../tooling/learn/src/runReason.js';
import { SAMPLES, findSample } from '../../../tooling/learn/src/samples.js';
import { useRunner } from '../../../tooling/learn/src/useRunner.js';
import { samplePrebuilt } from '../demos.js';
import { useSession } from '../playground/useSession.js';
import { shortName } from '../playground/workspace.jsx';
import Contents from './Contents.jsx';
import { positionOf } from '../../../tooling/learn/src/sections.js';

// /tutorial/: one step per page, laid out as a workbench. The contents stay at the left of a wide screen and fold
// into the step menu on a narrower one. The lesson has Run and the output under it. Beside them the step's playground
// sample sits in two Turbo windows, its native file over main.js, so a declaration and its call show together.
// Edits are kept per step in this browser; @crossbind/learn's useRunner.js runs an unedited step's prebuilt module, so
// reading through the tutorial never needs a compile. The columns and their breakpoints are in styles.css.

const DRAFT_KEY = 'crossbind.tutorial.project';
const RESET_QUESTION = 'Discard your changes to this step?';
const REPLACE_QUESTION = 'Replace your changes to this sample in the playground?';
// The hero's line, closer than the playground's, so a lesson's header and its main.js both show whole.
const LINE = 20;
const MENU_COLUMNS = 2;

// main.js has the second window to itself. The first one's tabs are the other files: the header first, as most lessons
// read, then the rest, and last the config the compiler writes from the packages, read-only as in the playground.
const isHeader = (name) => /\.(?:h|hh|hpp|hxx)$/.test(name);
const tabsOf = (project) => [
    ...Object.keys(project.files)
        .filter((name) => name !== MAIN)
        .sort((a, b) => Number(isHeader(b)) - Number(isHeader(a)) || a.localeCompare(b))
        .map((name) => ({ id: name, label: shortName(name) })),
    ...(project.packages.length ? [{ id: CONFIG, label: CONFIG }] : []),
];
const configOf = (project) => configSource([...project.packages].sort());
const textOf = (project, file) => (file === CONFIG ? configOf(project) : project.files[file] ?? '');
// A window's height for its text: its frame's two borders and the room the frame leaves above the first line.
const windowHeight = (text) => fitHeight(text, LINE) + 14;

export default function TutorialPage({ tokens, page }) {
    const sample = findSample(page.sample);
    const tabs = tabsOf(sample.project);
    const [file, setOpenFile] = useState(tabs[0].id);
    const [drafts, setDrafts] = useState({});
    const [restored, setRestored] = useState(false);
    const service = useSession({ lazy: true });
    const runner = useRunner({ compile: service.compile, canCompile: service.canCompile, prebuilt: samplePrebuilt });
    const output = useRef(null);
    const project = projectOf(sample, drafts[sample.id]);
    const edited = Boolean(drafts[sample.id]);
    const prebuilt = canRunPrebuilt(samplePrebuilt(sample.id), project, sample.project);
    const idle = restored && runner.phase === 'idle';
    const ready = idle && (prebuilt || service.canCompile);
    const runOff = idle && !ready
        ? runOffReason({ prebuilt, session: service.session, canReset: edited && hasPrebuilt(samplePrebuilt(sample.id)) })
        : null;
    const index = TUTORIAL_PAGES.findIndex((step) => step.path === page.path);
    const position = positionOf(TUTORIAL_SECTIONS, page.path);
    // The last step's "where to go next" sits with the links to the other steps, after the output.
    const onwardAt = page.blocks.findIndex((block) => block.id === 'next');
    const lesson = onwardAt === -1 ? page.blocks : page.blocks.slice(0, onwardAt);
    const onward = onwardAt === -1 ? [] : page.blocks.slice(onwardAt);
    const turbo = turboTokens(tokens);
    const desk = { fontFamily: tokens.mono, fontSize: 13, lineHeight: `${LINE}px` };
    // The first window is sized for the sample's longest file, so switching files never resizes the windows, and
    // both for the sample as written, so typing does not either.
    const tabbedHeight = Math.max(...tabs.map((tab) => windowHeight(textOf(sample.project, tab.id))));
    const mainHeight = windowHeight(sample.project.files[MAIN] ?? '');

    useEffect(() => {
        setDrafts(readDrafts(DRAFT_KEY, SAMPLES).drafts);
        setRestored(true);
    }, []);

    // An unedited step runs its prebuilt module, so the session loads only once the project needs a compile.
    useEffect(() => {
        if (restored && !prebuilt) service.connect();
    }, [restored, prebuilt]);

    const edit = (name) => (text) => {
        const change = (current) => setFile(current, name, text);
        setDrafts((current) => editDraft(current, sample, change));
        updateDrafts(DRAFT_KEY, SAMPLES, (store) => ({ ...store, drafts: editDraft(store.drafts, sample, change) }));
    };
    // A long lesson pushes the output below the fold, so a run brings it into view.
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
        <main id="content" className="tutorial-page" style={{ padding: '28px var(--content-x) 20px' }}>
            <nav aria-label="Tutorial contents" className="tutorial-rail">
                <Contents tokens={tokens} sections={TUTORIAL_SECTIONS} path={page.path} />
            </nav>

            <article className="tutorial-lesson">
                <NavMenu
                    tokens={tokens}
                    className="tutorial-menu"
                    label={`TUTORIAL · ${position.section.toUpperCase()} ${position.step} OF ${position.steps}`}
                    style={{ width: 'fit-content', margin: '-4px 0 10px -8px' }}
                    summaryStyle={{ padding: '4px 8px', fontFamily: tokens.mono, fontSize: 11, letterSpacing: 1.2, color: tokens.textMuted }}
                    // Under the sticky header (z-index 5), so a page scrolled with the list open slides it beneath.
                    panelStyle={{ padding: '16px 20px 16px 26px', zIndex: 4 }}
                >
                    <nav aria-label="Tutorial contents">
                        <Contents tokens={tokens} sections={TUTORIAL_SECTIONS} path={page.path} columns={MENU_COLUMNS} />
                    </nav>
                </NavMenu>
                <h1 style={{ fontSize: 'clamp(28px, 2.4vw, 34px)', fontWeight: 600, letterSpacing: -1, lineHeight: 1.1, margin: '0 0 12px', color: tokens.text }}>
                    {page.title}
                </h1>
                <p style={{ fontSize: 16, lineHeight: 1.6, color: tokens.textDim, margin: '0 0 18px' }}>{inline(page.lede, tokens)}</p>
                <Article tokens={tokens} blocks={lesson} />
            </article>

            <section aria-label="Code" className="tutorial-desk" onKeyDown={onKeyDown} style={{ ...desk, background: TURBO.blue, color: TURBO.yellow }}>
                <TurboMenu tokens={tokens} label="Files" tabs={tabs} panelId="tutorial-file" active={file} onSelect={setOpenFile}>
                    {edited && (
                        <button type="button" onClick={reset} disabled={runner.phase !== 'idle'} className="tap-target turbo-action" style={{ marginLeft: 'auto', padding: '0 8px', border: 'none', font: 'inherit', color: TURBO.black, cursor: 'pointer' }}>
                            Reset
                        </button>
                    )}
                    <TurboMenuLink
                        href={`${PLAYGROUND_URL}?sample=${sample.id}`}
                        onClick={openInPlayground}
                        onAuxClick={(event) => { if (event.button === 1) openInPlayground(event); }}
                        aria-label="Open in playground"
                        lead="Open"
                        rest=" in playground"
                        style={edited ? { marginLeft: 0 } : undefined}
                    />
                </TurboMenu>
                <div className="tutorial-windows">
                    <TurboWindow title={shortName(file)} number="1" label={`Editor, ${shortName(file)}`} className="playground-pane tutorial-window" style={{ '--window-h': `${tabbedHeight}px` }}>
                        <div role="tabpanel" id="tutorial-file" aria-labelledby={`tutorial-file-${file}`} style={{ flex: 1, minHeight: 0, paddingTop: 8 }}>
                            {file === CONFIG ? (
                                <Editor key={`${sample.id}/${CONFIG}`} tokens={turbo} label={`${CONFIG}, written from the packages`} value={configOf(project)} onChange={() => {}} lineHeight={desk.lineHeight} fill readOnly />
                            ) : (
                                <Editor key={`${sample.id}/${file}`} tokens={turbo} label={file} value={project.files[file] ?? ''} onChange={edit(file)} lineHeight={desk.lineHeight} fill />
                            )}
                        </div>
                    </TurboWindow>
                    <TurboWindow title={MAIN} number="2" label={`Editor, ${MAIN}`} className="playground-pane tutorial-window tutorial-main" style={{ '--window-h': `${mainHeight}px` }}>
                        <div style={{ flex: 1, minHeight: 0, paddingTop: 8 }}>
                            <Editor key={`${sample.id}/${MAIN}`} tokens={turbo} label={MAIN} value={project.files[MAIN] ?? ''} onChange={edit(MAIN)} lineHeight={desk.lineHeight} fill />
                        </div>
                    </TurboWindow>
                </div>
            </section>

            <div className="tutorial-run">
                <Toolbar
                    tokens={tokens}
                    phase={runner.phase}
                    session={service.session}
                    ready={ready}
                    runOff={runOff}
                    prebuilt={prebuilt}
                    away
                    runFirst
                    onRun={run}
                    onStop={runner.stop}
                    onSignOut={service.leave}
                    style={{ marginBottom: 12 }}
                />
                <div ref={service.check} />
                {runner.notice && <Notice tokens={tokens} notice={runner.notice} canSignIn={Boolean(service.session?.canSignIn)} away style={{ margin: '0 0 12px' }} />}
                <div ref={output} className="tutorial-output" style={{ ...desk, background: TURBO.black }}>
                    <TurboWindow title="Output" number={runInfo(runner.lastRun, '') || null} background={TURBO.black} className="playground-pane" style={{ flex: 1 }}>
                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 14px' }}>
                            <ConsoleLines tokens={turboOutputTokens(tokens)} lines={runner.lines} buildLog={runner.buildLog} />
                        </div>
                    </TurboWindow>
                </div>
                {onward.length > 0 && <Article tokens={tokens} blocks={onward} />}
                <PrevNext tokens={tokens} label="Tutorial steps" prev={TUTORIAL_PAGES[index - 1]} next={TUTORIAL_PAGES[index + 1]} style={{ marginTop: 14, paddingTop: 0, borderTop: 'none' }} />
            </div>
        </main>
    );
}

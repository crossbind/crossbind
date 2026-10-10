import { useEffect, useRef, useState } from 'react';
import { CodeWindow, primaryButtonStyle, secondaryButtonStyle } from '../components/ui.jsx';
import { inline } from '../guide/inline.jsx';
import {
    LOGIN_URL, deleteAccount, fetchSession, requestCompile, signOut, turnstileToken,
} from './client.js';
import Editor from './Editor.jsx';
import { runInSandbox } from './sandbox.js';
import { SAMPLE_FILES, SAMPLE_SCRIPT } from './samples.js';

// /playground/: three editors, a Run button and a console. Run sends native.h and native.cpp to the playground
// compiler (tooling/cloud) and runs the module it returns, with main.js, in a sandboxed frame (sandbox.js).
// The first render matches the prerendered page: the draft, the sign-in result and the session load afterwards.

const DRAFT_KEY = 'crossbind.playground.draft';
const MAX_LINES = 500;
const SAMPLE = Object.freeze({ ...SAMPLE_FILES, 'main.js': SAMPLE_SCRIPT });
const ERROR_STREAMS = new Set(['stderr', 'warn', 'error']);
const LOGIN_NOTICES = Object.freeze({
    ok: 'Signed in.',
    'too-new': 'This GitHub account is too new to sign in here yet.',
    blocked: 'This GitHub account may not use the playground.',
    failed: 'Signing in did not work; try again.',
    cancelled: 'Signing in was cancelled.',
});
const DELETE_QUESTION = 'Delete your crossbind cloud account? This signs you out here and on every machine where crossbind login used it.';
const UNREACHABLE = 'The playground service cannot be reached right now.';
const FAILURE_NOTICES = Object.freeze({
    compile: 'The build failed; its log is in the console.',
    timeout: 'The compile ran out of time.',
    memory: 'The compile ran out of memory.',
    output: 'The build printed too much or left no module.',
});

// The draft survives the round trip through a sign-in. Storage can be blocked, as in private windows; the page then
// starts from the sample.
function readDraft() {
    try {
        const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
        return Object.keys(SAMPLE).every((name) => typeof draft?.[name] === 'string') ? draft : null;
    } catch {
        return null;
    }
}

function writeDraft(draft) {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
        // Not stored; the code stays on the page.
    }
}

function takeLoginResult() {
    const result = new URLSearchParams(location.hash.slice(1)).get('login');
    if (!result) return null;
    history.replaceState(null, '', location.pathname + location.search);
    return LOGIN_NOTICES[result] ?? null;
}

function statusText(phase, session) {
    if (phase === 'compiling') return 'Compiling on the playground server…';
    if (phase === 'running') return 'Running in your browser…';
    if (!session) return 'Connecting…';
    if (session.error) return session.error;
    if (!session.enabled) return 'The playground is paused for now.';
    return `${session.remaining} of ${session.limit} compiles left today`;
}

function SignInLink({ tokens }) {
    return (
        <a href={LOGIN_URL} className="tap-target" style={{ color: tokens.accentText, fontWeight: 500, textDecoration: 'none' }}>
            Sign in with GitHub
        </a>
    );
}

function Account({
    tokens, session, onSignOut, onDeleteAccount,
}) {
    if (!session || session.error) return null;
    const style = { display: 'inline-flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 13, color: tokens.textDim, marginLeft: 'auto' };
    const linkButton = { background: 'none', border: 'none', padding: 0, color: tokens.accentText, cursor: 'pointer', font: 'inherit' };
    if (session.user) {
        return (
            <span style={style}>
                {`Signed in as ${session.user.name}`}
                <button type="button" onClick={onSignOut} className="tap-target" style={linkButton}>Sign out</button>
                <button type="button" onClick={onDeleteAccount} className="tap-target" style={{ ...linkButton, color: tokens.textDim }}>Delete account</button>
            </span>
        );
    }
    if (!session.canSignIn) return null;
    return (
        <span style={style}>
            More compiles a day:
            <SignInLink tokens={tokens} />
        </span>
    );
}

function Toolbar({
    tokens, phase, session, onRun, onStop, onSignOut, onDeleteAccount,
}) {
    const ready = phase === 'idle' && Boolean(session) && !session.error && session.enabled;
    const button = { padding: '10px 20px', fontSize: 14, cursor: 'pointer' };
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            {phase === 'running' ? (
                <button type="button" onClick={onStop} className="tap-target" style={{ ...secondaryButtonStyle(tokens), ...button }}>Stop</button>
            ) : (
                <button
                    type="button"
                    onClick={onRun}
                    disabled={!ready}
                    className="tap-target"
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                    style={{ ...primaryButtonStyle(tokens), ...button, opacity: ready ? 1 : 0.55, cursor: ready ? 'pointer' : 'default' }}
                >
                    {phase === 'compiling' ? 'Compiling…' : 'Run'}
                </button>
            )}
            <span aria-live="polite" style={{ fontSize: 13, color: tokens.textDim }}>{statusText(phase, session)}</span>
            <Account tokens={tokens} session={session} onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} />
        </div>
    );
}

function Notice({ tokens, notice, canSignIn }) {
    return (
        <div role="status" style={{ border: `1px solid ${tokens.borderStrong}`, borderRadius: 10, padding: '12px 16px', margin: '0 0 16px', fontSize: 14, color: tokens.text, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <span>{notice.text}</span>
            {notice.login && canSignIn && <SignInLink tokens={tokens} />}
        </div>
    );
}

function Console({ tokens, lines, buildLog }) {
    return (
        <CodeWindow tokens={tokens} title="Console">
            <div aria-live="polite" style={{ minHeight: 140, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {buildLog && <div style={{ color: tokens.warn }}>{buildLog}</div>}
                {/* Lines only ever append, so the index is a stable key. */}
                {lines.map((line, index) => (
                    <div key={index} style={{ color: ERROR_STREAMS.has(line.stream) ? tokens.warn : tokens.codeText }}>{line.text}</div>
                ))}
                {!buildLog && lines.length === 0 && <span style={{ color: tokens.codeMuted }}>Press Run, or Ctrl+Enter, to compile and run.</span>}
            </div>
        </CodeWindow>
    );
}

// Tall enough for the sample without a scrollbar; the editors still grow by their resize handle.
const EDITOR_HEIGHTS = Object.freeze({ 'native.h': 400, 'native.cpp': 400, 'main.js': 240 });

function EditorWindow({ tokens, name, value, onChange }) {
    return (
        <CodeWindow tokens={tokens} title={name} padded={false}>
            <Editor tokens={tokens} label={name} value={value} onChange={onChange} minHeight={EDITOR_HEIGHTS[name]} />
        </CodeWindow>
    );
}

export default function PlaygroundPage({ tokens, page }) {
    const [sources, setSources] = useState(SAMPLE);
    const [session, setSession] = useState(null);
    const [phase, setPhase] = useState('idle');
    const [notice, setNotice] = useState(null);
    const [lines, setLines] = useState([]);
    const [buildLog, setBuildLog] = useState('');
    const check = useRef(null);
    const stop = useRef(null);
    const reloadSession = () => fetchSession().then(setSession, () => setSession({ error: UNREACHABLE }));

    useEffect(() => {
        const draft = readDraft();
        if (draft) setSources(draft);
        const loginNotice = takeLoginResult();
        if (loginNotice) setNotice({ text: loginNotice });
        reloadSession();
    }, []);

    useEffect(() => {
        if (sources !== SAMPLE) writeDraft(sources);
    }, [sources]);

    const edit = (name) => (text) => setSources((current) => ({ ...current, [name]: text }));
    const print = (line) => setLines((current) => [...current.slice(-(MAX_LINES - 1)), line]);

    async function run() {
        if (phase !== 'idle' || !session || session.error || !session.enabled) return;
        setLines([]);
        setBuildLog('');
        setNotice(null);
        setPhase('compiling');
        try {
            const turnstile = session.user ? undefined : await turnstileToken(check.current, session.turnstileSiteKey);
            const result = await requestCompile({ 'native.h': sources['native.h'], 'native.cpp': sources['native.cpp'] }, turnstile);
            if (typeof result.remaining === 'number') setSession((current) => ({ ...current, remaining: result.remaining }));
            if (result.status !== 200) {
                setNotice({ text: result.error ?? `The playground answered ${result.status}.`, login: Boolean(result.login) });
                return;
            }
            if (!result.ok) {
                setBuildLog(result.log ?? '');
                setNotice({ text: FAILURE_NOTICES[result.reason] ?? 'The build failed.' });
                return;
            }
            setPhase('running');
            const runner = runInSandbox({ js: result.js, wasm: result.wasm, code: sources['main.js'], onOutput: print });
            stop.current = runner.stop;
            await runner.done;
        } catch (error) {
            setNotice({ text: error.message || UNREACHABLE });
        } finally {
            stop.current = null;
            setPhase('idle');
        }
    }

    async function leave() {
        await signOut().catch(() => undefined);
        reloadSession();
    }

    async function removeAccount() {
        if (!window.confirm(DELETE_QUESTION)) return;
        const response = await deleteAccount().catch(() => null);
        setNotice({ text: response?.ok ? 'Your crossbind cloud account is deleted, and every machine is signed out of it.' : 'The account could not be deleted; try again.' });
        reloadSession();
    }

    const onKeyDown = (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            run();
        }
    };

    return (
        <main id="content">
            <section style={{ padding: '52px var(--content-x) 24px' }}>
                <div style={{ maxWidth: 880 }}>
                    <h1 style={{ fontSize: 'clamp(36px, 5vw, 54px)', fontWeight: 600, letterSpacing: -2, lineHeight: 1.02, margin: '0 0 16px', color: tokens.text }}>
                        {page.title}
                    </h1>
                    <p style={{ fontSize: 17, lineHeight: 1.65, color: tokens.textDim, margin: 0 }}>{inline(page.lede, tokens)}</p>
                </div>
            </section>

            <section style={{ padding: '0 var(--content-x) 32px' }} onKeyDown={onKeyDown}>
                <Toolbar tokens={tokens} phase={phase} session={session} onRun={run} onStop={() => stop.current?.()} onSignOut={leave} onDeleteAccount={removeAccount} />
                <div ref={check} />
                {notice && <Notice tokens={tokens} notice={notice} canSignIn={Boolean(session?.canSignIn)} />}
                <div className="playground-grid">
                    <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                        <EditorWindow tokens={tokens} name="native.h" value={sources['native.h']} onChange={edit('native.h')} />
                        <EditorWindow tokens={tokens} name="native.cpp" value={sources['native.cpp']} onChange={edit('native.cpp')} />
                    </div>
                    <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                        <EditorWindow tokens={tokens} name="main.js" value={sources['main.js']} onChange={edit('main.js')} />
                        <Console tokens={tokens} lines={lines} buildLog={buildLog} />
                    </div>
                </div>
            </section>

            <section style={{ padding: '0 var(--content-x) 80px' }}>
                <div style={{ maxWidth: 880 }}>
                    {page.blocks.map((block) => (block.type === 'h2' ? (
                        <h2 key={block.id} id={block.id} style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, margin: '32px 0 10px', color: tokens.text }}>{block.text}</h2>
                    ) : (
                        <p key={block.text} style={{ fontSize: 15, lineHeight: 1.7, color: tokens.textDim, margin: 0 }}>{inline(block.text, tokens)}</p>
                    )))}
                </div>
            </section>
        </main>
    );
}

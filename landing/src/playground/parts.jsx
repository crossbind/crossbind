import { CodeWindow, primaryButtonStyle, secondaryButtonStyle } from '../components/ui.jsx';
import { PLAYGROUND_URL } from '../data.js';
import { inline } from '../guide/inline.jsx';
import { LOGIN_URL } from './client.js';
import { PAUSED } from './runReason.js';

// The run controls and the console the playground and the tutorial share; useRunner.js holds their state.

const ERROR_STREAMS = new Set(['stderr', 'warn', 'error']);

// The page's h1, for screen readers only: the navbar's Playground already names the page on screen.
export const visuallyHidden = {
    position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
};

export const linkButtonStyle = (tokens, color = tokens.accentText) => ({
    background: 'none', border: 'none', padding: 0, color, cursor: 'pointer', font: 'inherit',
});

export function statusText(phase, session, prebuilt) {
    if (phase === 'loading') return 'Loading the prebuilt module…';
    if (phase === 'compiling') return 'Compiling on the playground server…';
    if (phase === 'running') return 'Running in your browser…';
    if (prebuilt) return 'Runs without a compile until the C++, Rust, packages or imports change.';
    if (!session) return 'Connecting…';
    if (session.error) return session.error;
    if (!session.enabled) return PAUSED;
    return `${session.remaining} of ${session.limit} compiles left today`;
}

export const runInfo = (lastRun) => (lastRun ? `Ran in ${lastRun.seconds.toFixed(1)} s · ${lastRun.prebuilt ? 'prebuilt' : 'compiled'}` : '');

// Signing in always returns to the playground page (tooling/cloud/worker/oauth.js), so a page elsewhere (`away`)
// sends the visitor there to do it.
function SignInLink({ tokens, away }) {
    return (
        <a href={away ? PLAYGROUND_URL : LOGIN_URL} className="tap-target" style={{ color: tokens.accentText, fontWeight: 500, textDecoration: 'none' }}>
            {away ? 'Sign in on the playground' : 'Sign in with GitHub'}
        </a>
    );
}

export function Account({
    tokens, session, away, onSignOut, onDeleteAccount,
}) {
    if (!session || session.error) return null;
    const style = { display: 'inline-flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 13, color: tokens.textDim };
    if (session.user) {
        return (
            <span style={style}>
                {`Signed in as ${session.user.name}`}
                <button type="button" onClick={onSignOut} className="tap-target" style={linkButtonStyle(tokens)}>Sign out</button>
                <button type="button" onClick={onDeleteAccount} className="tap-target" style={linkButtonStyle(tokens, tokens.textDim)}>Delete account</button>
            </span>
        );
    }
    if (!session.canSignIn) return null;
    return (
        <span style={style}>
            More compiles a day:
            <SignInLink tokens={tokens} away={away} />
        </span>
    );
}

export function Toolbar({
    tokens, phase, session, ready, runOff, prebuilt, away, onRun, onStop, onSignOut, onDeleteAccount, children, style,
}) {
    const button = { padding: '10px 20px', fontSize: 14, cursor: 'pointer' };
    const busy = { loading: 'Loading…', compiling: 'Compiling…' }[phase];
    return (
        <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginBottom: 16, ...style,
        }}
        >
            {children}
            <span style={{ flex: 1 }} />
            <span aria-live="polite" style={{ fontSize: 13, color: tokens.textDim }}>{statusText(phase, session, prebuilt)}</span>
            <Account tokens={tokens} session={session} away={away} onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} />
            {phase === 'running' ? (
                <button type="button" onClick={onStop} className="tap-target" style={{ ...secondaryButtonStyle(tokens), ...button }}>Stop</button>
            ) : (
                // Some browsers give a disabled button no pointer, so the reason sits on a wrapper the pointer reaches.
                <span title={runOff ?? undefined} style={{ display: 'inline-flex' }}>
                    <button
                        type="button"
                        onClick={onRun}
                        disabled={!ready}
                        className="tap-target"
                        aria-keyshortcuts="Control+Enter Meta+Enter"
                        style={{
                            ...primaryButtonStyle(tokens), ...button, opacity: ready ? 1 : 0.55, cursor: ready ? 'pointer' : 'default', pointerEvents: runOff ? 'none' : undefined,
                        }}
                    >
                        {busy ?? 'Run'}
                    </button>
                </span>
            )}
        </div>
    );
}

export function Notice({
    tokens, notice, canSignIn, away, style,
}) {
    return (
        <div role="status" style={{
            border: `1px solid ${tokens.borderStrong}`, borderRadius: 10, padding: '12px 16px', margin: '0 0 16px', fontSize: 14, color: tokens.text, display: 'flex', flexWrap: 'wrap', gap: 10, ...style,
        }}
        >
            <span>{notice.text}</span>
            {notice.login && canSignIn && <SignInLink tokens={tokens} away={away} />}
        </div>
    );
}

// `intro` is what the playground says until the first run; the tutorial's steps explain themselves and pass none.
export function ConsoleLines({ tokens, lines, buildLog, intro }) {
    const colorOf = ({ stream }) => {
        if (stream === 'done') return tokens.codeMuted;
        return ERROR_STREAMS.has(stream) ? tokens.warn : tokens.codeText;
    };
    return (
        <div aria-live="polite" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {buildLog && <div style={{ color: tokens.warn }}>{buildLog}</div>}
            {/* Lines only ever append, so the index is a stable key. */}
            {lines.map((line, index) => (
                <div key={index} style={{ color: colorOf(line) }}>{line.text}</div>
            ))}
            {!buildLog && lines.length === 0 && (
                <>
                    <span style={{ color: tokens.codeMuted }}>Press Run, or Ctrl+Enter, to run main.js.</span>
                    {intro?.map((text) => (
                        <p key={text} style={{ margin: '12px 0 0', fontFamily: tokens.sans, fontSize: 13, lineHeight: 1.65, color: tokens.textDim, whiteSpace: 'normal' }}>
                            {inline(text, tokens)}
                        </p>
                    ))}
                </>
            )}
        </div>
    );
}

export function Console({
    tokens, lines, buildLog, lastRun,
}) {
    const title = (
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>Console</span>
            <span>{runInfo(lastRun)}</span>
        </span>
    );
    return (
        <CodeWindow tokens={tokens} title={title}>
            <div style={{ minHeight: 140 }}>
                <ConsoleLines tokens={tokens} lines={lines} buildLog={buildLog} />
            </div>
        </CodeWindow>
    );
}

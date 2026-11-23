import { PAUSED } from '../../../tooling/learn/src/runReason.js';
import { primaryButtonStyle, secondaryButtonStyle } from '../components/ui.jsx';
import { PLAYGROUND_URL } from '../data.js';
import { ACCOUNT_URL, LOGIN_URL } from './client.js';

// The run controls the playground and the tutorial share, with the site's sign-in; useSession.js and @crossbind/learn's
// useRunner.js hold their state.

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

// Signing in from the playground returns to the playground page (tooling/cloud/worker/oauth.js), so a page elsewhere
// (`away`) sends the visitor there to do it. The account's page offers each way in.
function SignInLink({ tokens, away }) {
    return (
        <a href={away ? PLAYGROUND_URL : LOGIN_URL} className="tap-target" style={{ color: tokens.accentText, fontWeight: 500, textDecoration: 'none' }}>
            {away ? 'Sign in on the playground' : 'Sign in'}
        </a>
    );
}

export function Account({
    tokens, session, away, onSignOut,
}) {
    if (!session || session.error) return null;
    const style = { display: 'inline-flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 13, color: tokens.textDim };
    if (session.user) {
        return (
            <span style={style}>
                {`Signed in as ${session.user.name}`}
                <button type="button" onClick={onSignOut} className="tap-target" style={linkButtonStyle(tokens)}>Sign out</button>
                <a href={ACCOUNT_URL} className="tap-target" style={{ ...linkButtonStyle(tokens, tokens.textDim), textDecoration: 'none' }}>Delete account</a>
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

// Run closes the row, after what it says; `runFirst` leads with it and lets the text take the rest of the row, for a
// toolbar under a text rather than over a window.
export function Toolbar({
    tokens, phase, session, ready, runOff, prebuilt, away, runFirst = false, onRun, onStop, onSignOut, children, style,
}) {
    const button = { padding: '10px 20px', fontSize: 14, cursor: 'pointer' };
    const busy = { loading: 'Loading…', compiling: 'Compiling…' }[phase];
    const run = phase === 'running' ? (
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
    );
    return (
        <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginBottom: 16, ...style,
        }}
        >
            {runFirst && run}
            {children}
            {!runFirst && <span style={{ flex: 1 }} />}
            <span aria-live="polite" style={{ fontSize: 13, color: tokens.textDim, ...(runFirst ? { flex: 1, minWidth: 180 } : {}) }}>{statusText(phase, session, prebuilt)}</span>
            <Account tokens={tokens} session={session} away={away} onSignOut={onSignOut} />
            {!runFirst && run}
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

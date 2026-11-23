import { inline } from './inline.jsx';

// The console's lines the playground and the tutorial share, and what the last run took; useRunner.js holds their
// state.

const ERROR_STREAMS = new Set(['stderr', 'warn', 'error']);

// `lead` is left out where the text sits on a narrow window's frame, beside its title.
export const runInfo = (lastRun, lead = 'Ran in ') => (lastRun ? `${lead}${lastRun.seconds.toFixed(1)} s · ${lastRun.prebuilt ? 'prebuilt' : 'compiled'}` : '');

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

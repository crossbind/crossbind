import { useState } from 'react';
import DocCode from '../guide/DocCode.jsx';
import { inline } from '../guide/inline.jsx';
import { isLive, liveDemo, loadDemo } from '../live/runtime.js';
import { megabytes, RunButton } from './AppCard.jsx';

// A usage example as the port pages show it: the header, the JavaScript that calls it and what it
// prints. The text comes from the generated examples data; the code that runs is the same file,
// loaded only when the visitor presses run, against the library's module built into the site.
// Where the library has them, a second tab shows the same example written against the library's
// own headers with no C++ at all, run against a module built from those headers alone.
const EXAMPLE_MODULES = import.meta.glob(['../../demos/lib-*/examples/*.js', '../../demos/lib-*/direct/examples/*.js']);

const MODES = [
    { key: 'cpp', label: 'With a C++ header' },
    { key: 'js', label: 'JavaScript only' },
];

// What the example prints, as the site build checked it, and a run button when this tab can run it.
function Output({ tokens, mode, moduleId, init, loadExample, expected, runnable }) {
    const [state, setState] = useState({ status: 'idle' });
    const live = Boolean(runnable && loadExample && moduleId && isLive(moduleId));
    const run = async () => {
        setState({ status: 'running' });
        try {
            const [module, m] = await Promise.all([loadExample(), loadDemo(moduleId, init ?? {})]);
            const printed = [];
            await module.default(m, { log: (...values) => printed.push(values.map(String).join(' ')) });
            setState({ status: 'ready', printed, matches: JSON.stringify(printed) === JSON.stringify(expected) });
        } catch (error) {
            setState({ status: 'failed', message: error?.message ?? String(error) });
        }
    };
    const ran = state.status === 'ready';
    const label = ran ? (state.matches ? 'PRINTED IN THIS TAB · SAME AS THE CHECKED OUTPUT' : 'PRINTED IN THIS TAB · DIFFERS FROM THE CHECKED OUTPUT') : 'PRINTS';
    return (
        <div data-mode={mode} data-status={state.status} style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, overflow: 'hidden', background: tokens.codeBg, marginTop: -8 }}>
            <div
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '8px 14px',
                    background: tokens.codeSurface,
                    borderBottom: `1px solid ${tokens.border}`,
                }}
            >
                <span style={{ fontFamily: tokens.mono, fontSize: 11, letterSpacing: 0.8, color: ran && !state.matches ? tokens.warn : tokens.codeMuted }}>{label}</span>
                {live ? (
                    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                        {state.status === 'idle' ? (
                            <span style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.codeMuted }}>{`first run downloads ${megabytes(liveDemo(moduleId).bytes ?? 0)}`}</span>
                        ) : null}
                        <RunButton tokens={tokens} busy={state.status === 'running'} onClick={run}>Run in this tab</RunButton>
                    </span>
                ) : null}
            </div>
            <pre
                data-output=""
                style={{
                    margin: 0,
                    padding: 14,
                    fontFamily: tokens.mono,
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    color: state.status === 'failed' ? tokens.warn : tokens.codeText,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                }}
            >
                {state.status === 'failed' ? state.message : (ran ? state.printed : expected).join('\n')}
            </pre>
        </div>
    );
}

function ModeSwitch({ tokens, id, mode, onChange, impossible }) {
    return (
        <div role="tablist" aria-label="How the example calls the library" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '16px 0 0' }}>
            {MODES.map((item) => {
                const active = item.key === mode;
                return (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        id={`${id}-${item.key}-tab`}
                        aria-selected={active}
                        aria-controls={`${id}-${item.key}`}
                        data-mode-tab={item.key}
                        className="tap-target"
                        onClick={() => onChange(item.key)}
                        style={{
                            padding: '6px 13px',
                            borderRadius: 999,
                            fontSize: 13,
                            cursor: 'pointer',
                            border: `1px solid ${active ? tokens.accentText : tokens.pillBorder}`,
                            background: active ? tokens.pillBg : 'transparent',
                            color: active ? tokens.text : tokens.textDim,
                        }}
                    >
                        {item.label}
                        {/* .tap-target is a flex box, which drops a leading space, so the gap is a margin. */}
                        {item.key === 'js' && impossible ? <span style={{ color: tokens.textMuted, marginLeft: 5 }}>· not possible</span> : null}
                    </button>
                );
            })}
        </div>
    );
}

// Why the example cannot be written against the library's headers alone.
function Impossible({ tokens, reason }) {
    return (
        <div
            data-mode="js"
            data-impossible=""
            style={{
                margin: '18px 0 0',
                padding: '14px 18px',
                background: tokens.panel,
                border: `1px solid ${tokens.border}`,
                borderLeft: `3px solid ${tokens.warn}`,
                borderRadius: 8,
                fontSize: 14,
                lineHeight: 1.65,
                color: tokens.textDim,
                overflowWrap: 'anywhere',
            }}
        >
            <div style={{ fontFamily: tokens.mono, fontSize: 11, letterSpacing: 0.6, color: tokens.warn, marginBottom: 6 }}>Not possible from JavaScript alone</div>
            {inline(reason, tokens)}
        </div>
    );
}

function DirectPanel({ tokens, demo, example, direct, runnable }) {
    if (example.direct.impossible) return <Impossible tokens={tokens} reason={example.direct.impossible} />;
    return (
        <>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: tokens.textDim, margin: '14px 0 0', overflowWrap: 'anywhere' }}>{inline(example.direct.note, tokens)}</p>
            <DocCode tokens={tokens} file="main.js" code={example.direct.usage} />
            <Output
                tokens={tokens}
                mode="js"
                moduleId={direct.demo}
                init={direct.init}
                loadExample={EXAMPLE_MODULES[`../../demos/${demo}/direct/examples/${example.id}.js`]}
                expected={example.direct.expected}
                runnable={runnable}
            />
        </>
    );
}

export default function RunnableExample({ tokens, demo, example, runnable, direct = null }) {
    const [mode, setMode] = useState('cpp');
    const withDirect = Boolean(direct && example.direct);
    return (
        <div data-example={example.id} style={{ margin: '30px 0 38px' }}>
            <h3 id={example.id} style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.2, color: tokens.text, margin: '0 0 8px', scrollMarginTop: 90 }}>{example.title}</h3>
            <p style={{ fontSize: 14.5, lineHeight: 1.7, color: tokens.textDim, margin: 0, overflowWrap: 'anywhere' }}>{inline(example.summary, tokens)}</p>
            {withDirect ? <ModeSwitch tokens={tokens} id={example.id} mode={mode} onChange={setMode} impossible={Boolean(example.direct.impossible)} /> : null}
            <div role={withDirect ? 'tabpanel' : undefined} id={`${example.id}-cpp`} aria-labelledby={withDirect ? `${example.id}-cpp-tab` : undefined} hidden={mode !== 'cpp'}>
                <DocCode tokens={tokens} file={`src/native/${example.native}`} code={example.nativeSource} maxHeight={380} />
                <DocCode tokens={tokens} file="main.js" code={example.usage} />
                <Output
                    tokens={tokens}
                    mode="cpp"
                    moduleId={demo}
                    loadExample={EXAMPLE_MODULES[`../../demos/${demo}/examples/${example.id}.js`]}
                    expected={example.expected}
                    runnable={runnable}
                />
            </div>
            {withDirect ? (
                <div role="tabpanel" id={`${example.id}-js`} aria-labelledby={`${example.id}-js-tab`} hidden={mode !== 'js'}>
                    <DirectPanel tokens={tokens} demo={demo} example={example} direct={direct} runnable={runnable} />
                </div>
            ) : null}
        </div>
    );
}

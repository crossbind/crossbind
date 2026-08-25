import { CodeWindow, Pill } from '../components/ui.jsx';
import { AGENT_STEPS, AGENT_URL } from '../data.js';

export default function Agent({ tokens }) {
    const code = {
        background: tokens.codeBg,
        padding: '1px 7px',
        borderRadius: 5,
        fontFamily: tokens.mono,
        fontSize: 13.5,
        color: tokens.codeAccent,
    };
    const dim = { color: tokens.codeText, opacity: 0.75 };

    return (
        <section style={{ padding: '40px var(--content-x) 80px' }}>
            <div style={{
                padding: 'var(--card-p)',
                borderRadius: 24,
                position: 'relative',
                overflow: 'hidden',
                background: `linear-gradient(135deg, ${tokens.violet}1a, ${tokens.blue}0d 50%, ${tokens.isLight ? 'rgba(255,255,255,0.5)' : 'rgba(7,11,20,0.5)'})`,
                border: `1px solid ${tokens.borderStrong}`,
            }}
            >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 48 }}>
                    <div>
                        <Pill tokens={tokens} color={tokens.violet} style={{ marginBottom: 16, background: `${tokens.violet}1a` }}>
                            <span style={{ color: tokens.violet }}>★</span>
                            {' '}
                            NEW
                        </Pill>
                        <h2 style={{
                            fontSize: 42,
                            margin: '0 0 14px',
                            fontWeight: 600,
                            letterSpacing: -1.2,
                            lineHeight: 1.05,
                            color: tokens.text,
                        }}
                        >
                            Drop crossbind in,
                            <br />
                            without reading the docs.
                        </h2>
                        <p style={{ color: tokens.textDim, fontSize: 16, lineHeight: 1.6, marginBottom: 24 }}>
                            The portable crossbind skill helps your coding agent inspect the project, write
                            {' '}
                            <code style={code}>crossbind.config.js</code>
                            {' and '}
                            <code style={code}>crossbind.build.js</code>
                            , wires
                            {' '}
                            <code style={code}>initNative()</code>
                            {' '}
                            into the right entrypoint, then verifies the build.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
                            {AGENT_STEPS.map((step) => (
                                <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10, color: tokens.textDim }}>
                                    <span style={{ color: tokens.violet }}>›</span>
                                    {step}
                                </div>
                            ))}
                        </div>

                        <a
                            href={AGENT_URL}
                            className="tap-target"
                            style={{
                                marginTop: 24,
                                background: tokens.violet,
                                // The dark theme's violet is a light tone, so white text lands at 2.7:1.
                                color: tokens.isLight ? '#fff' : '#0a0a0a',
                                padding: '12px 22px',
                                borderRadius: 10,
                                fontWeight: 600,
                                fontSize: 14,
                            }}
                        >
                            Install the skill →
                        </a>
                    </div>

                    <CodeWindow tokens={tokens} title="agent · integrating into vite app" accent={tokens.violet} glass>
                        <div style={{ color: tokens.codeMuted }}>&gt; Add crossbind to this Vite app and verify the build.</div>
                        <div style={{ marginTop: 8, color: tokens.accent }}>┌─ Detecting project</div>
                        <div style={dim}>│ ✓ Vite + React + TypeScript</div>
                        <div style={dim}>│ ✓ vendored C++ at ./vendor/matrix.cpp</div>
                        <div style={{ marginTop: 8, color: tokens.blue }}>┌─ Writing config</div>
                        <div style={dim}>│ ✓ crossbind.config.js</div>
                        <div style={dim}>│ ✓ crossbind.build.js</div>
                        <div style={dim}>│ ✓ vite.config.ts &nbsp; + @crossbind/plugin-vite</div>
                        <div style={dim}>│ ✓ src/main.tsx &nbsp;&nbsp; await initNative()</div>
                        <div style={{ marginTop: 8, color: tokens.warn }}>⚠ React Native target requested but no RN setup</div>
                        <div style={dim}>&nbsp;&nbsp;Skipped — this project has no mobile target</div>
                        <div style={{ marginTop: 8, color: tokens.accent }}>✓ npm run dev compiles · WASM 184 kB</div>
                        <div style={{ marginTop: 8, color: tokens.violet }}>
                            &gt;
                            {' '}
                            <span style={{ borderRight: '8px solid', borderColor: tokens.violet, animation: 'blink 1s steps(1) infinite' }}>
                                &nbsp;
                            </span>
                        </div>
                    </CodeWindow>
                </div>
            </div>
        </section>
    );
}

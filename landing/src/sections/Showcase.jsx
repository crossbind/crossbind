import { Pill } from '../components/ui.jsx';
import { LIBRARIES_URL, SHOWCASE, SHOWCASE_COUNT } from '../data.js';

export default function Showcase({ tokens }) {
    return (
        <section style={{ padding: '40px var(--content-x) 80px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 16, marginBottom: 30 }}>
                <div>
                    <Pill tokens={tokens} style={{ marginBottom: 14 }}>PREBUILT LIBRARIES</Pill>
                    <h2 style={{ fontSize: 36, margin: 0, fontWeight: 600, letterSpacing: -1, color: tokens.text }}>
                        Drop in real C++ libraries.
                    </h2>
                </div>
                <a href={LIBRARIES_URL} className="tap-target" style={{ marginLeft: 'auto', color: tokens.accentText, fontSize: 14 }}>
                    {`View all ${SHOWCASE_COUNT} →`}
                </a>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
                {SHOWCASE.map((item) => (
                    // The card carries an "install →" affordance, so it has to be a link.
                    <a
                        key={item.name}
                        href={item.href || LIBRARIES_URL}
                        className="tap-target"
                        style={{
                            padding: 18,
                            background: tokens.panel,
                            border: `1px solid ${tokens.border}`,
                            borderRadius: 14,
                            color: tokens.text,
                            display: 'block',
                        }}
                    >
                        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: tokens.text }}>{item.name}</div>
                        <div style={{ fontSize: 12, color: tokens.textDim, lineHeight: 1.5, marginBottom: 14, minHeight: 36 }}>
                            {item.desc}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: tokens.mono, fontSize: 12 }}>
                            <span style={{ color: tokens.textMuted }}>{item.tag}</span>
                            <span style={{ color: tokens.accentText }}>install →</span>
                        </div>
                    </a>
                ))}
            </div>
        </section>
    );
}

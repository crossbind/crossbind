import { Pill } from '../components/ui.jsx';
import {
    COMMUNITY, LIBRARIES_URL, REPO_URL, SHOWCASE, SHOWCASE_COUNT,
} from '../data.js';

function Libraries({ tokens }) {
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

function Community({ tokens }) {
    return (
        <div>
            <Pill tokens={tokens} style={{ marginBottom: 14 }}>COMMUNITY</Pill>
            <h2 style={{ fontSize: 32, margin: '0 0 20px', fontWeight: 600, letterSpacing: -1, color: tokens.text }}>
                Build it together
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {COMMUNITY.map((item) => {
                    const tint = tokens.accent;
                    return (
                        <a
                            key={item.label}
                            href={REPO_URL}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 14,
                                padding: '14px 18px',
                                background: tokens.panel,
                                border: `1px solid ${tokens.border}`,
                                borderRadius: 12,
                                color: tokens.text,
                            }}
                        >
                            <div style={{
                                width: 36,
                                height: 36,
                                borderRadius: 9,
                                background: `${tint}26`,
                                display: 'grid',
                                placeItems: 'center',
                                color: tint,
                                fontSize: 14,
                                fontWeight: 600,
                            }}
                            >
                                {item.label[0]}
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
                                <div style={{ color: tokens.textMuted, fontSize: 12 }}>{item.meta}</div>
                            </div>
                            <span style={{ color: tokens.textMuted, fontSize: 12, fontFamily: tokens.mono }}>{item.count}</span>
                        </a>
                    );
                })}
            </div>
        </div>
    );
}

export default function Showcase({ tokens }) {
    return (
        <>
            <Libraries tokens={tokens} />
            <section id="community" style={{ padding: '40px var(--content-x) 80px' }}>
                <Community tokens={tokens} />
            </section>
        </>
    );
}

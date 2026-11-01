import { inline } from '../guide/inline.jsx';
import { ANOTHER_TOOL, INTEGRATION_GROUPS } from './integrations.js';

// /integrations/ (pages/integrations.js): a section per kind of tool and a card per tool. A card is one link, to the
// section of the guide that sets the tool up, with the crossbind packages it takes at its foot.

const headingStyle = (tokens) => ({ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: '44px 0 8px', color: tokens.text, scrollMarginTop: 90 });
const hintStyle = (tokens) => ({ fontSize: 15, lineHeight: 1.6, color: tokens.textDim, maxWidth: 760, margin: '0 0 18px' });

function IntegrationCard({ tokens, item }) {
    return (
        <a href={item.href} className="integration-card">
            <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, letterSpacing: '-0.01em', color: tokens.text }}>{item.name}</span>
            <span style={{ fontSize: 14, lineHeight: 1.6, color: tokens.textDim }}>{inline(item.summary, tokens)}</span>
            {item.packages.length > 0 && (
                <span
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        marginTop: 'auto',
                        paddingTop: 10,
                        borderTop: `1px solid ${tokens.border}`,
                        fontFamily: tokens.mono,
                        fontSize: 12,
                        color: tokens.textMuted,
                        overflowWrap: 'anywhere',
                    }}
                >
                    {item.packages.map((name) => <span key={name}>{name}</span>)}
                </span>
            )}
        </a>
    );
}

export default function IntegrationsPage({ tokens, page }) {
    return (
        <main id="content" style={{ padding: '52px var(--content-x) 96px' }}>
            <h1 style={{ fontSize: 'clamp(34px, 4.6vw, 52px)', fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1.06, margin: '0 0 18px', color: tokens.text, maxWidth: 900 }}>
                {page.title}
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.6, color: tokens.textDim, maxWidth: 760, margin: '0 0 28px' }}>{inline(page.lede, tokens)}</p>

            <nav aria-label="Kinds of integration" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 14 }}>
                {INTEGRATION_GROUPS.map((group) => (
                    <a key={group.id} href={`#${group.id}`} className="tap-target" style={{ gap: 6, color: tokens.accentText, textDecoration: 'none' }}>
                        {group.label}
                        <span style={{ color: tokens.textMuted }}>{group.items.length}</span>
                    </a>
                ))}
            </nav>

            {INTEGRATION_GROUPS.map((group) => (
                <section key={group.id} aria-labelledby={group.id}>
                    <h2 id={group.id} style={headingStyle(tokens)}>{group.label}</h2>
                    <p style={hintStyle(tokens)}>{inline(group.hint, tokens)}</p>
                    <div className="integrations-grid" style={{ '--rule': tokens.border, '--lit': tokens.accent, '--card': tokens.panel }}>
                        {group.items.map((item) => <IntegrationCard key={item.id} tokens={tokens} item={item} />)}
                    </div>
                </section>
            ))}

            <section aria-labelledby={ANOTHER_TOOL.id}>
                <h2 id={ANOTHER_TOOL.id} style={headingStyle(tokens)}>{ANOTHER_TOOL.title}</h2>
                <p style={hintStyle(tokens)}>{inline(ANOTHER_TOOL.text, tokens)}</p>
            </section>
        </main>
    );
}

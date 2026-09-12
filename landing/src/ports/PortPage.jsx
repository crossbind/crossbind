import CommandChip from '../components/CommandChip.jsx';
import { Pill } from '../components/ui.jsx';
import Article from '../guide/Article.jsx';
import { inline } from '../guide/inline.jsx';
import {
    BIN_TARGET, CATEGORY_LABELS, PORTS, PORTS_CATALOG, publishedLibraryTargets, publishedTarget, TARGET_LABELS,
} from './catalog.js';
import { PORTS_INDEX_HREF, portHref } from './pages.js';

// /ports/<name>/ as a spec sheet: identity and the install line up top, the details as an article,
// the facts a reader scans for in a rail that stays put, and the rest of the catalog at the foot.

function Row({ tokens, label, children }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', gap: 12, padding: '10px 0', borderTop: `1px solid ${tokens.border}`, fontSize: 13 }}>
            <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.1, color: tokens.textMuted, paddingTop: 2 }}>{label.toUpperCase()}</div>
            <div style={{ color: tokens.textDim, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</div>
        </div>
    );
}

function Glance({ tokens, port }) {
    const targets = publishedLibraryTargets(port);
    const bin = publishedTarget(port, BIN_TARGET);
    return (
        <aside className="port-aside" aria-label="At a glance" style={{ background: tokens.panel, border: `1px solid ${tokens.border}`, borderRadius: 14, padding: '16px 18px 6px' }}>
            <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.5, color: tokens.textMuted, marginBottom: 8 }}>AT A GLANCE</div>
            <Row tokens={tokens} label="Upstream"><span style={{ color: tokens.text }}>{`${port.name} ${port.nativeVersion}`}</span></Row>
            <Row tokens={tokens} label="npm">
                <code style={{ fontFamily: tokens.mono, fontSize: 12 }}>{port.published ? `${port.npm}@${port.published}` : `${port.npm} - not published`}</code>
            </Row>
            <Row tokens={tokens} label="Licence"><code style={{ fontFamily: tokens.mono, fontSize: 12 }}>{port.license}</code></Row>
            <Row tokens={tokens} label="Targets">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {targets.length ? targets.map((target) => (
                        <Pill key={target.target} tokens={tokens} style={{ fontSize: 11, padding: '2px 9px' }}>{TARGET_LABELS[target.target]}</Pill>
                    )) : <span>none published</span>}
                </div>
            </Row>
            <Row tokens={tokens} label="Commands">
                {bin ? <a href="#commands" style={{ color: tokens.accentText }}>{`${port.binCommands.length} via ${bin.package}`}</a> : 'none'}
            </Row>
        </aside>
    );
}

export default function PortPage({ tokens, page }) {
    const { port } = page;
    const others = PORTS.filter((entry) => entry.family !== port.family);
    return (
        <main id="content">
            <section style={{ padding: '40px var(--content-x) 0' }}>
                <nav aria-label="Breadcrumb" style={{ fontFamily: tokens.mono, fontSize: 11, letterSpacing: 1.5, color: tokens.textMuted, marginBottom: 18 }}>
                    <a href={PORTS_INDEX_HREF} className="tap-target" style={{ color: tokens.textDim }}>LIBRARIES</a>
                    <span>{` · ${(CATEGORY_LABELS[port.category] ?? port.category).toUpperCase()}`}</span>
                </nav>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <h1 style={{ fontSize: 'clamp(34px, 5vw, 52px)', fontWeight: 600, letterSpacing: -1.8, lineHeight: 1.05, margin: 0, color: tokens.text }}>{port.name}</h1>
                    <Pill tokens={tokens} color={tokens.accentText} style={{ fontFamily: tokens.mono, fontSize: 12 }}>{`v${port.nativeVersion}`}</Pill>
                    <Pill tokens={tokens}>{CATEGORY_LABELS[port.category] ?? port.category}</Pill>
                </div>
                <p style={{ fontSize: 16.5, lineHeight: 1.65, color: tokens.textDim, margin: '0 0 22px', maxWidth: 760 }}>{inline(page.lede, tokens)}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px' }}>
                    {page.install ? <CommandChip tokens={tokens} command={page.install} /> : null}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13.5 }}>
                        {page.links.filter((link) => link.external).map((link) => (
                            <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="tap-target" style={{ color: tokens.accentText }}>{`${link.label} ↗`}</a>
                        ))}
                    </div>
                </div>
            </section>

            <section className="port-layout" style={{ padding: '30px var(--content-x) 56px' }}>
                <div className="port-main" style={{ minWidth: 0 }}>
                    <Article tokens={tokens} blocks={page.blocks} />
                    <p style={{ fontSize: 13.5, lineHeight: 1.65, color: tokens.textMuted, marginTop: 30 }}>
                        {inline(`Facts on this page come from the port manifests in the repository and from what npm served on \`${PORTS_CATALOG.distTag}\` when the site was built. See the [Libraries guide](/guide/libraries/) for the full consumer flow.`, tokens)}
                    </p>
                </div>
                <Glance tokens={tokens} port={port} />
            </section>

            <section style={{ padding: '0 var(--content-x) 80px' }}>
                <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.5, color: tokens.textMuted, marginBottom: 12 }}>MORE LIBRARIES</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {others.map((entry) => (
                        <a key={entry.family} href={portHref(entry.family)} className="tap-target" style={{ padding: '6px 12px', borderRadius: 999, background: tokens.pillBg, border: `1px solid ${tokens.pillBorder}`, color: tokens.textDim, fontSize: 13 }}>
                            {entry.name}
                        </a>
                    ))}
                </div>
            </section>
        </main>
    );
}

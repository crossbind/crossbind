import { Chevron } from '../components/menu.jsx';
import { RowGroup, RowsPage } from '../ports/LibrariesPage.jsx';
import { NOT_PUBLISHED, PACKAGE_GROUPS, packagesLabel } from './packages.js';

// /packages/ (pages/packages.js), as /ports/ is laid out: a package's name and its version per row, and a row per library
// that opens to its packages. A row opens its package's page wherever it is clicked but on its npm and GitHub links.

const rowStyle = (tokens) => ({ color: tokens.textDim, fontSize: 14, lineHeight: 1.5 });

function Version({ tokens, version }) {
    return (
        <span className="lib-version" style={{ fontFamily: tokens.mono, fontSize: 12.5 }}>
            {version ?? NOT_PUBLISHED}
        </span>
    );
}

function PackageRow({ tokens, item, isNested = false }) {
    const className = ['lib-row', 'package-row', isNested && 'is-nested', !item.href && 'is-static'].filter(Boolean).join(' ');
    const nameStyle = { color: tokens.text, fontWeight: isNested ? 400 : 600, fontSize: 15 };
    return (
        <li style={{ borderTop: `1px solid ${tokens.border}` }}>
            <div className={className} style={rowStyle(tokens)}>
                {item.href ? (
                    <a href={item.href} className="lib-name package-link" style={nameStyle}>
                        {item.name}
                    </a>
                ) : (
                    <span className="lib-name" style={nameStyle}>
                        {item.name}
                    </span>
                )}
                <Version tokens={tokens} version={item.version} />
                {item.npm ? (
                    <span className="package-links" style={{ color: tokens.textDim, fontSize: 12.5 }}>
                        <a href={item.npm} target="_blank" rel="noreferrer" aria-label={`${item.name} on npm`}>
                            npm ↗
                        </a>
                        <a href={item.github} target="_blank" rel="noreferrer" aria-label={`${item.name} on GitHub`}>
                            GitHub ↗
                        </a>
                    </span>
                ) : null}
            </div>
        </li>
    );
}

function LibraryRow({ tokens, library }) {
    return (
        <li style={{ borderTop: `1px solid ${tokens.border}` }}>
            <details className="disclosure">
                <summary className="lib-row package-row" style={{ ...rowStyle(tokens), cursor: 'pointer', listStyle: 'none' }}>
                    <span className="lib-name" style={{ color: tokens.text, fontWeight: 600, fontSize: 15 }}>
                        {library.name} <span style={{ color: tokens.textMuted, fontWeight: 400 }}>{packagesLabel(library)}</span>
                    </span>
                    <Version tokens={tokens} version={library.version} />
                    <span className="package-marker">
                        <Chevron />
                    </span>
                </summary>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {library.packages.map((item) => (
                        <PackageRow key={item.name} tokens={tokens} item={item} isNested />
                    ))}
                </ul>
            </details>
        </li>
    );
}

export default function PackagesPage({ tokens, page }) {
    return (
        <RowsPage tokens={tokens} page={page}>
            {PACKAGE_GROUPS.map((group) => (
                <RowGroup key={group.id} tokens={tokens} id={group.id} label={group.label}>
                    {group.families
                        ? group.families.map((library) => <LibraryRow key={library.id} tokens={tokens} library={library} />)
                        : group.items.map((item) => <PackageRow key={item.name} tokens={tokens} item={item} />)}
                </RowGroup>
            ))}
        </RowsPage>
    );
}

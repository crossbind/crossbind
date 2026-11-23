// Inline markup for guide copy. Page content is plain data, so paragraphs need a way to carry
// links, code spans and emphasis without shipping a markdown parser: three tokens, one regex.
//
//   `code`  **bold**  [label](/guide/x/)
const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

function CodeSpan({ tokens, style, children }) {
    return (
        <code style={{
            fontFamily: tokens.mono,
            fontSize: '0.92em',
            background: tokens.codeSurface,
            border: `1px solid ${tokens.border}`,
            borderRadius: 4,
            padding: '1px 5px',
            // Breaks a span only where it cannot fit a line, so a table cell never shrinks to one letter.
            overflowWrap: 'break-word',
            ...style,
        }}
        >
            {children}
        </code>
    );
}

function Link({ tokens, href, children }) {
    // Anything that is not a same-site path or an anchor leaves the tab it came from.
    const isExternal = !href.startsWith('/') && !href.startsWith('#');
    return (
        <a
            href={href}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noreferrer' : undefined}
            style={{ color: tokens.accentText, textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
            {children}
        </a>
    );
}

export function inline(text, tokens, codeStyle) {
    return String(text).split(TOKEN).filter(Boolean).map((part, i) => {
        const key = `${i}-${part}`;
        if (part.startsWith('`') && part.endsWith('`')) {
            return <CodeSpan key={key} tokens={tokens} style={codeStyle}>{part.slice(1, -1)}</CodeSpan>;
        }
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={key} style={{ color: tokens.text, fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
        }
        const link = part.match(LINK);
        if (link) {
            return <Link key={key} tokens={tokens} href={link[2]}>{link[1]}</Link>;
        }
        return <span key={key}>{part}</span>;
    });
}

// The way on through a reading order: the guide's pages, the tutorial's steps. A page outside the order has neither.
// On phones the .tap-target rule makes each link a flex row, so the column direction keeps its caption above it.
// `style` lets a page with less room tighten the space above the links.
export default function PrevNext({ tokens, label, prev, next, style }) {
    if (!prev && !next) return null;
    const caption = {
        fontFamily: tokens.mono,
        fontSize: 10,
        letterSpacing: 1.2,
        color: tokens.textMuted,
        display: 'block',
        marginBottom: 4,
    };

    return (
        <nav
            aria-label={label}
            style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 14,
                marginTop: 52,
                paddingTop: 20,
                borderTop: `1px solid ${tokens.border}`,
                fontSize: 13.5,
                ...style,
            }}
        >
            {prev ? (
                <a href={prev.href} className="tap-target" style={{ color: tokens.textDim, display: 'block', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={caption}>← PREV</span>
                    {prev.title}
                </a>
            ) : (
                <span />
            )}
            {next ? (
                <a href={next.href} className="tap-target" style={{ color: tokens.accentText, display: 'block', textAlign: 'right', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <span style={caption}>NEXT →</span>
                    {next.title}
                </a>
            ) : (
                <span />
            )}
        </nav>
    );
}

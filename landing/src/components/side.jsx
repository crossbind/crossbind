// A side list's heading and link: the guide's sidebar and its "on this page" rail, and the tutorial's contents.
// `number` goes before the label; `style` lets a denser list set its own spacing.

function SideNumber({ tokens, children }) {
    return <span style={{ display: 'inline-block', flex: 'none', width: 30, fontFamily: tokens.mono, fontSize: 12, fontWeight: 400, color: tokens.textMuted }}>{children}</span>;
}

export function SideLink({
    tokens, href, label, active, current = 'page', number, style,
}) {
    return (
        <a
            href={href}
            className="tap-target"
            aria-current={active ? current : undefined}
            style={{
                fontSize: 13,
                lineHeight: 1.5,
                padding: '3px 0 3px 10px',
                marginLeft: -12,
                borderLeft: `2px solid ${active ? tokens.accentText : 'transparent'}`,
                color: active ? tokens.text : tokens.textDim,
                ...style,
            }}
        >
            {number && <SideNumber tokens={tokens}>{number}</SideNumber>}
            {label}
        </a>
    );
}

export function SideHeading({
    tokens, number, style, children,
}) {
    return (
        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text, margin: '18px 0 6px', ...style }}>
            {number && <SideNumber tokens={tokens}>{number}</SideNumber>}
            {children}
        </div>
    );
}

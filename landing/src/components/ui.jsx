export function Pill({ tokens, children, color, style }) {
    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 12,
            background: tokens.pillBg,
            border: `1px solid ${color ? `${color}44` : tokens.pillBorder}`,
            color: color || tokens.textDim,
            fontFamily: tokens.sans,
            letterSpacing: 0.3,
            ...style,
        }}
        >
            {children}
        </span>
    );
}

export const primaryButtonStyle = (tokens) => ({
    background: tokens.buttonBg,
    color: tokens.buttonText,
    border: 'none',
    padding: '14px 24px',
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 15,
    display: 'inline-block',
});

export const secondaryButtonStyle = (tokens) => ({
    background: tokens.pillBg,
    color: tokens.text,
    border: `1px solid ${tokens.borderStrong}`,
    padding: '14px 22px',
    borderRadius: 10,
    fontWeight: 500,
    fontSize: 15,
    display: 'inline-block',
});

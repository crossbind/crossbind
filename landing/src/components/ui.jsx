// One alternation, one pass. Chained per-rule replaces re-scan the spans they just injected:
// the string rule eats a comment span's own quotes and the number rule eats its colour hex, so
// every `//` comment - and every https:// inside a code block - renders as broken markup.
// The (?<!:) keeps a URL's // out of the comment rule, which would grey out the rest of the line.
const TOKEN = /(?<comment>(?<!:)\/\/[^\n]*)|(?<string>(?<quote>['"`])(?:\\.|(?!\k<quote>).)*?\k<quote>)|(?<keyword>\b(?:import|from|const|let|var|await|async|function|class|extends|new|return|if|else|export|default|public|useState|useEffect|std)\b)|(?<number>\b\d+\.?\d*\b)/g;

const TOKEN_COLOR = {
    comment: 'codeMuted',
    string: 'codeStr',
    keyword: 'codeKey',
    number: 'codeAccent',
};

// Escapes first, then colours: the spans it injects must survive the escape pass.
export function highlight(raw, tokens) {
    return raw.split('\n').map((line, i) => {
        const html = line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(TOKEN, (match, ...rest) => {
                const groups = rest.at(-1);
                const kind = Object.keys(TOKEN_COLOR).find((name) => groups[name] !== undefined);
                return `<span style="color:${tokens[TOKEN_COLOR[kind]]}">${match}</span>`;
            });
        return <div key={`${i}-${line}`} dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }} />;
    });
}

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

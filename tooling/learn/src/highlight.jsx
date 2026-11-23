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

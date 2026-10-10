import { useRef, useState } from 'react';
import { highlight } from '../components/ui.jsx';

// A textarea over a highlighted copy of its own text: the browser's own editing, selection, undo and screen reader
// support, in the site's code colours. Both layers share font, padding and scroll position, so the caret sits on
// the coloured glyphs. Tab is left to move focus, so the keyboard never gets stuck in the editor; the focus ring is
// drawn around the whole editor, since the textarea's own would sit under the highlighted layer.
export default function Editor({ tokens, label, value, onChange, minHeight = 220 }) {
    const highlighted = useRef(null);
    const [focused, setFocused] = useState(false);
    const layer = {
        margin: 0,
        padding: 16,
        boxSizing: 'border-box',
        fontFamily: tokens.mono,
        fontSize: 13,
        lineHeight: 1.7,
        whiteSpace: 'pre',
        tabSize: 4,
        letterSpacing: 0,
    };
    const follow = (event) => {
        highlighted.current.scrollTop = event.target.scrollTop;
        highlighted.current.scrollLeft = event.target.scrollLeft;
    };
    return (
        <div style={{ position: 'relative', minHeight, background: tokens.codeBg, outline: focused ? `2px solid ${tokens.accent}` : 'none', outlineOffset: -2 }}>
            <div ref={highlighted} aria-hidden="true" style={{ ...layer, position: 'absolute', inset: 0, overflow: 'hidden', color: tokens.codeText, pointerEvents: 'none' }}>
                {highlight(`${value}\n`, tokens)}
            </div>
            <textarea
                aria-label={label}
                value={value}
                onInput={(event) => onChange(event.target.value)}
                onScroll={follow}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                spellcheck={false}
                autocapitalize="off"
                autocomplete="off"
                style={{
                    ...layer,
                    position: 'relative',
                    display: 'block',
                    width: '100%',
                    minHeight,
                    resize: 'vertical',
                    overflow: 'auto',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: 'transparent',
                    caretColor: tokens.codeText,
                }}
            />
        </div>
    );
}

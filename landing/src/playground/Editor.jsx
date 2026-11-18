import { useRef, useState } from 'react';
import { highlight } from '../components/ui.jsx';

const FONT_SIZE = 13;
const LINE_HEIGHT = 1.7;
const PADDING = 16;

// The height that shows all of `text` without a scrollbar, at `linePx` a line.
export const fitHeight = (text, linePx = FONT_SIZE * LINE_HEIGHT) => Math.ceil(text.split('\n').length * linePx + 2 * PADDING);

// A textarea over a highlighted copy of its own text: the browser's own editing, selection, undo and screen reader
// support, in the site's code colours. Both layers share font, padding and scroll position, so the caret sits on
// the coloured glyphs. Tab is left to move focus, so the keyboard never gets stuck in the editor; the focus ring is
// drawn around the whole editor, since the textarea's own would sit under the highlighted layer.
// `fill` makes it as tall as its container instead of growing with a resize handle; `lineHeight` is CSS's, for a
// window that sets its lines closer.
export default function Editor({
    tokens, label, value, onChange, minHeight = 220, fill = false, readOnly = false, lineHeight = LINE_HEIGHT,
}) {
    const highlighted = useRef(null);
    const [focused, setFocused] = useState(false);
    const layer = {
        margin: 0,
        padding: PADDING,
        boxSizing: 'border-box',
        fontFamily: tokens.mono,
        fontSize: FONT_SIZE,
        lineHeight,
        whiteSpace: 'pre',
        tabSize: 4,
        letterSpacing: 0,
    };
    const follow = (event) => {
        highlighted.current.scrollTop = event.target.scrollTop;
        highlighted.current.scrollLeft = event.target.scrollLeft;
    };
    return (
        <div style={{
            position: 'relative', ...(fill ? { height: '100%' } : { minHeight }), background: tokens.codeBg, outline: focused ? `2px solid ${tokens.accent}` : 'none', outlineOffset: -2,
        }}
        >
            <div ref={highlighted} aria-hidden="true" style={{ ...layer, position: 'absolute', inset: 0, overflow: 'hidden', color: tokens.codeText, pointerEvents: 'none' }}>
                {highlight(`${value}\n`, tokens)}
            </div>
            <textarea
                aria-label={label}
                value={value}
                readOnly={readOnly}
                onInput={(event) => onChange(event.target.value)}
                onScroll={follow}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                spellcheck={false}
                autocapitalize="off"
                autocomplete="off"
                style={{
                    ...layer,
                    ...(fill ? { position: 'absolute', inset: 0, height: '100%', resize: 'none' } : { position: 'relative', minHeight, resize: 'vertical' }),
                    display: 'block',
                    width: '100%',
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

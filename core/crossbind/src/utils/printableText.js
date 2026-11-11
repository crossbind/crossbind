// C0 and C1 controls, which carry terminal escape sequences.
export const isControlCharacter = (char) => char < ' ' || (char >= '\u007f' && char <= '\u009f');

// Text a recipe or a tool wrote, for a terminal or a message: its lines and tabs, without any other control character.
export const printable = (text) => [...text].filter((char) => char === '\n' || char === '\t' || !isControlCharacter(char)).join('');

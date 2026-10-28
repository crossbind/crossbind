import { randomBytes } from 'node:crypto';

// NIST SP 800-63B-4's least length for a password that alone guards what it locks, as an upload key's does.
export const MIN_PASSWORD_LENGTH = 15;
// Rows a password can run along, either way and around: the alphabet, the digits, and a keyboard's.
const ROWS = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiopasdfghjklzxcvbnm', '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p', 'q1w2e3r4t5y6u7i8o9p0'];
// Long passwords others try first, which the rules above let through.
const GUESSED = ['correcthorsebatterystaple', 'thequickbrownfoxjumpsoverthelazydog', 'crossbinduploadkey', 'androiduploadkey'];

// What the user reads before typing an upload key's password.
export const PASSWORD_RULES = [
    `${MIN_PASSWORD_LENGTH} characters or more; spaces and any characters are welcome, so a few words make a good one`,
    'not one part repeated, not a run as 1234, abcd or qwerty, and not a well-known password',
];

const runsAlong = (text, row) => {
    const around = row.repeat(Math.ceil(text.length / row.length) + 1);
    return around.includes(text) || [...around].reverse().join('').includes(text);
};

// Why a password is too weak to lock an upload key, or null when it is not. NIST asks for no mix of kinds of characters.
export function passwordProblem(password) {
    const length = [...password].length;
    if (length < MIN_PASSWORD_LENGTH) return `it has ${length} characters and needs at least ${MIN_PASSWORD_LENGTH}`;
    if (/\p{Cc}/u.test(password)) return 'it has a control character, which no terminal types';
    const plain = password.toLowerCase();
    if (/^(.+?)\1+$/su.test(plain)) return 'it repeats one part';
    if (ROWS.some((row) => runsAlong(plain, row))) return 'it runs along a row, as 1234, abcd and qwerty do';
    if (GUESSED.includes(plain.replace(/\s+/g, ''))) return 'it is a password others guess first';
    return null;
}

// A password crossbind makes: 18 random bytes, 144 bits, as 24 characters any terminal and keytool take.
export const makePassword = () => randomBytes(18).toString('base64url');

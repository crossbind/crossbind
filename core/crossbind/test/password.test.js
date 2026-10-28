import { describe, expect, test } from 'vitest';
import { MIN_PASSWORD_LENGTH, makePassword, passwordProblem } from '../src/utils/password.js';

const RUN = 'it runs along a row, as 1234, abcd and qwerty do';

describe("an upload key's password", () => {
    test('takes 15 characters or more, spaces and any characters included, as NIST SP 800-63B-4 asks', () => {
        expect(MIN_PASSWORD_LENGTH).toBe(15);
        expect(passwordProblem('fourteen chars')).toBe('it has 14 characters and needs at least 15');
        expect(passwordProblem('blue river at noon')).toBe(null);
        expect(passwordProblem('Ünlü kuş — 15 karakter')).toBe(null);
    });

    test('has no rule on kinds of characters, so a long lowercase phrase passes', () => {
        expect(passwordProblem('quiet pony hinge market')).toBe(null);
    });

    test('refuses one part repeated, a run along a row, a password others guess first, and control characters', () => {
        expect(passwordProblem('aaaaaaaaaaaaaaaa')).toBe('it repeats one part');
        expect(passwordProblem('passwordpassword')).toBe('it repeats one part');
        expect(passwordProblem('1234567890123456')).toBe(RUN);
        expect(passwordProblem('ZYXWVUTSRQPONMLK')).toBe(RUN);
        expect(passwordProblem('qwertyuiopasdfgh')).toBe(RUN);
        expect(passwordProblem('correct horse battery staple')).toBe('it is a password others guess first');
        expect(passwordProblem('line one\nline two')).toBe('it has a control character, which no terminal types');
    });

    test('is 24 random characters when crossbind makes it', () => {
        const made = makePassword();
        expect(made).toMatch(/^[A-Za-z0-9_-]{24}$/);
        expect(passwordProblem(made)).toBe(null);
        expect(makePassword()).not.toBe(made);
    });
});

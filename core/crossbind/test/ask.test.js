import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { askHidden, askLine } from '../src/utils/ask.js';

// A terminal that types what it is given once the question is out, and keeps what it shows.
function terminal(typed) {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = '';
    output.on('data', (chunk) => { shown += chunk; });
    setImmediate(() => (typed === null ? input.end() : input.write(typed)));
    return { input, output, shown: () => shown };
}

describe('a question on the terminal', () => {
    test('reads a password without showing it', async () => {
        const typing = terminal('s3cret pass phrase\n');
        expect(await askHidden('Password: ', typing)).toBe('s3cret pass phrase');
        expect(typing.shown()).toBe('Password: \n');
    });

    test('reads an answer', async () => {
        const typing = terminal('2\n');
        expect(await askLine('Choose 1 or 2: ', typing)).toBe('2');
        expect(typing.shown()).toContain('Choose 1 or 2: ');
    });

    test('stops when the terminal closes before an answer', async () => {
        await expect(askHidden('Password: ', terminal(null))).rejects.toThrow('crossbind: the terminal closed before an answer.');
    });
});

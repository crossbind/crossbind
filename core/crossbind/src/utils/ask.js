import readline from 'node:readline';
import { Writable } from 'node:stream';

// Whether someone is at a terminal to answer a question, as no one is in CI or behind a pipe.
export const hasTerminal = () => Boolean(process.stdin.isTTY && process.stderr.isTTY);

function ask(question, { input, output, isHidden }) {
    output.write(question);
    // A hidden answer is echoed into nothing, while the terminal, in raw mode, shows none of it either.
    const echo = isHidden ? new Writable({ write: (chunk, encoding, done) => done() }) : output;
    const reader = readline.createInterface({ input, output: echo, terminal: isHidden });
    return new Promise((resolve, reject) => {
        let isAnswered = false;
        reader.once('line', (line) => {
            isAnswered = true;
            reader.close();
            if (isHidden) output.write('\n');
            resolve(line);
        });
        reader.once('SIGINT', () => {
            reader.close();
            output.write('\n');
            reject(new Error('crossbind: stopped at the question.'));
        });
        reader.once('close', () => {
            if (!isAnswered) reject(new Error('crossbind: the terminal closed before an answer.'));
        });
    });
}

// An answer typed on the terminal that the terminal does not show, as a password.
export const askHidden = (question, { input = process.stdin, output = process.stderr } = {}) => ask(question, { input, output, isHidden: true });

// An answer typed on the terminal.
export const askLine = (question, { input = process.stdin, output = process.stderr } = {}) => ask(question, { input, output, isHidden: false });

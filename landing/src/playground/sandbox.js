import { ImportError, prepareModules } from './modules.js';

const SANDBOX_URL = '/playground/sandbox.html';
const RUN_TIMEOUT_MS = 20_000;
const STREAMS = new Set(['log', 'stdout', 'stderr', 'warn', 'error']);

const randomToken = () => `crossbind-${[...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;

// Runs the compiled module and main.js in a fresh frame with an opaque origin (see public/playground/sandbox.html):
// it can reach neither this page, its cookies nor the network. `imports` is the build's import list, which maps
// main.js's native imports (modules.js); `scripts` are the project's other scripts, by name. `onOutput` gets one
// { stream, text } per printed line. Returns { done, stop }; `done` settles with 'done', 'error', 'timeout' or
// 'stopped', after which the frame is gone.
export function runInSandbox({ js, wasm, imports, code, scripts, onOutput }) {
    const token = randomToken();
    let modules;
    try {
        modules = prepareModules({ code, imports, token, scripts });
    } catch (error) {
        if (!(error instanceof ImportError)) throw error;
        onOutput({ stream: 'error', text: error.message });
        return { done: Promise.resolve('error'), stop: () => {} };
    }
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = 'Playground sandbox';
    frame.hidden = true;
    frame.src = SANDBOX_URL;

    let finish;
    const done = new Promise((resolve) => {
        let timer;
        const onMessage = (event) => {
            if (event.source !== frame.contentWindow || event.data?.channel !== 'crossbind-playground') return;
            const { type, stream, text } = event.data;
            if (type === 'ready') frame.contentWindow.postMessage({ type: 'run', js, wasm, modules, token }, '*');
            if (type === 'output') onOutput({ stream: STREAMS.has(stream) ? stream : 'log', text: String(text) });
            if (type === 'error') {
                onOutput({ stream: 'error', text: String(text) });
                finish('error');
            }
            if (type === 'done') finish('done');
        };
        finish = (outcome) => {
            if (!frame.isConnected) return;
            clearTimeout(timer);
            removeEventListener('message', onMessage);
            frame.remove();
            resolve(outcome);
        };
        timer = setTimeout(() => {
            onOutput({ stream: 'error', text: `Stopped after ${RUN_TIMEOUT_MS / 1000} s.` });
            finish('timeout');
        }, RUN_TIMEOUT_MS);
        addEventListener('message', onMessage);
    });
    document.body.append(frame);
    return { done, stop: () => finish('stopped') };
}

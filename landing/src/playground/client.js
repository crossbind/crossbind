// The playground API (tooling/cloud/worker). VITE_PLAYGROUND_API points the dev server at `wrangler dev`.
export const API_URL = import.meta.env.VITE_PLAYGROUND_API ?? 'https://api.crossbind.dev/playground';

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Every answer comes back as { status, ...body }; a body that is not JSON becomes an error the page can show.
async function call(path, init = {}) {
    const response = await fetch(`${API_URL}${path}`, { credentials: 'include', ...init });
    const body = await response.json().catch(() => ({ error: `The playground answered ${response.status}.` }));
    return { status: response.status, ...body };
}

export const fetchSession = () => call('/session');

export const requestCompile = ({ files, packages }, turnstile) => call('/compile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files, packages, turnstile }),
});

export const signOut = () => fetch(`${API_URL}/logout`, { method: 'POST', credentials: 'include' });

// Signing in starts on crossbind cloud's own origin and comes back here; the account's page, where it is deleted, is
// the cloud's own too.
const CLOUD_URL = new URL(API_URL).origin;
export const LOGIN_URL = `${CLOUD_URL}/account/login/github?next=playground`;
export const ACCOUNT_URL = `${CLOUD_URL}/login`;

let turnstileScript = null;

// Loaded only when an anonymous visitor presses Run.
function loadTurnstile() {
    turnstileScript ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT;
        script.async = true;
        script.addEventListener('load', () => resolve(globalThis.turnstile));
        script.addEventListener('error', () => {
            turnstileScript = null;
            reject(new Error('The browser check could not load.'));
        });
        document.head.append(script);
    });
    return turnstileScript;
}

// A token is good for one compile, so every compile renders its own widget. It stays invisible unless
// Cloudflare wants the visitor to interact.
export async function turnstileToken(container, siteKey) {
    const turnstile = await loadTurnstile();
    return new Promise((resolve, reject) => {
        let widget;
        const settle = (outcome) => {
            turnstile.remove(widget);
            outcome();
        };
        widget = turnstile.render(container, {
            sitekey: siteKey,
            action: 'compile',
            appearance: 'interaction-only',
            callback: (token) => settle(() => resolve(token)),
            'error-callback': () => settle(() => reject(new Error('The browser check did not pass; reload the page and try again.'))),
            'timeout-callback': () => settle(() => reject(new Error('The browser check timed out; press Run again.'))),
        });
    });
}

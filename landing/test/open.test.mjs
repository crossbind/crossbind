import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appLink } from '../public/open/open.js';
import { SITE_ROUTES } from '../src/site-pages.js';

// crossbind.dev/open/?s=<session>, the address of a preview's QR code: a page of its own, which hands a session's id to
// the crossbind app by its scheme and asks nothing of any server.

const html = readFileSync(new URL('../public/open/index.html', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const ruleOf = (path) => headers.match(new RegExp(`^${path.replaceAll('*', '\\*')}\\n((?: {2}.+\\n?)+)`, 'm'))?.[1].trim().split('\n').map((line) => line.trim());
const SESSION = 'IRVUB8Fpwuh0lT_7NkiJ8Q';

test('hands the crossbind app the session its address names, as crossbind://open?s=<session>', () => {
    assert.equal(appLink(`?s=${SESSION}`), `crossbind://open?s=${SESSION}`);
    assert.equal(appLink(`?x=1&s=${SESSION}`), `crossbind://open?s=${SESSION}`);
});

test('names no session for an address whose s is out of its form: 22 characters of base64url alone', () => {
    const refused = ['', '?s=', `?s=${SESSION.slice(1)}`, `?s=${SESSION}A`, `?s=${SESSION.slice(1)}+`, `?s=${SESSION.slice(1)}%2F`, `?s=${SESSION}%0A`, '?s=<script>alert(1)</script>', `?S=${SESSION}`];
    assert.deepEqual(refused.map(appLink), refused.map(() => null));
});

test('is a page apart from the site\'s, never indexed, with no script or style of its own inline', () => {
    assert.ok(!SITE_ROUTES.includes('/open/'));
    assert.ok(html.includes('<meta name="robots" content="noindex" />'));
    assert.ok(html.includes('<script type="module" src="/open/open.js"></script>') && html.includes('<link rel="stylesheet" href="/open/open.css" />'));
    assert.equal(html.match(/<script/g).length, 1);
    assert.ok(!html.includes('<style') && !html.includes(' style=') && !html.includes('crossbind://'));
});

test('comes with a policy that lets it ask nothing of any server or be framed, and sends its address on with no link', () => {
    assert.deepEqual(ruleOf('/open/*'), [
        "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy: no-referrer',
    ]);
});

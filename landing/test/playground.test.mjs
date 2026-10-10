import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SITE_ROUTES } from '../src/site-pages.js';
import PLAYGROUND_PAGE from '../src/pages/playground.js';
import { LIMITS } from '../../tooling/cloud/compiler/sandbox.js';

const html = readFileSync(new URL('../public/playground/sandbox.html', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.indexOf('</script>'));
const scriptHash = `'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`;
const headerPolicy = headers.split('\n').map((line) => line.trim()).find((line) => line.startsWith('Content-Security-Policy: sandbox'));

test('the sandbox page runs its one inline script by hash, in its own policy and in the header', () => {
    assert.equal(html.match(/<script/g).length, 1);
    assert.ok(html.includes(`script-src ${scriptHash} blob:`), 'the meta policy names the script hash');
    assert.ok(headerPolicy.includes(`script-src ${scriptHash} blob:`), 'the header policy names the script hash');
});

test('the sandbox header keeps visitor code in an opaque origin with no way out, even on its own', () => {
    assert.match(headerPolicy, /^Content-Security-Policy: sandbox allow-scripts; /);
    assert.doesNotMatch(headerPolicy, /allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/);
    assert.match(headerPolicy, /default-src 'none'/);
    assert.doesNotMatch(headerPolicy, /connect-src|img-src|frame-src/);
    assert.match(headerPolicy, /frame-ancestors 'self'/);
});

test('the playground is a page of the site, so it is prerendered and in the sitemap', () => {
    assert.ok(SITE_ROUTES.includes('/playground/'));
});

test('the page names the time and memory a compile gets in the sandbox', () => {
    const text = JSON.stringify(PLAYGROUND_PAGE);
    assert.ok(text.includes(`${LIMITS.wallMs / 1000} seconds`));
    assert.ok(text.includes(`${LIMITS.dataBytes / 1024 ** 3} GB of memory`));
});

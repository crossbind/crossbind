import { test } from 'node:test';
import assert from 'node:assert/strict';
import PRIVACY_PAGE from '../src/pages/privacy.js';
import { SITE_ROUTES } from '../src/site-pages.js';
import { TOKEN_IDLE_DAYS, USAGE_MONTHS_KEPT } from '../../tooling/cloud/worker/accounts.js';
import { SESSION_TTL_MS } from '../../tooling/cloud/worker/session.js';
import { RUNNER_IDLE_SECONDS } from '../../tooling/cloud/worker/runner-api.js';

const DAY_MS = 24 * 3600 * 1000;
const text = JSON.stringify(PRIVACY_PAGE);

test('is a page of the site', () => {
    assert.ok(SITE_ROUTES.includes('/privacy/'));
});

test('names the periods crossbind cloud enforces', () => {
    assert.ok(text.includes(`${TOKEN_IDLE_DAYS} days unused`));
    assert.ok(text.includes(`signed in for ${SESSION_TTL_MS / DAY_MS} days`));
    assert.equal(USAGE_MONTHS_KEPT, 3);
    assert.ok(text.includes('the three before it'));
    assert.equal(RUNNER_IDLE_SECONDS, 60);
    assert.ok(text.includes('a minute after your last step'));
    assert.ok(!text.includes('two minutes'));
});

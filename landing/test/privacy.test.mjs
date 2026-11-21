import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import PRIVACY_PAGE from '../src/pages/privacy.js';
import { SITE_ROUTES } from '../src/site-pages.js';
import { PLAY_SCOPE } from '../../extensions/google-play/src/googlePlay.js';
import { TOKEN_IDLE_DAYS, USAGE_MONTHS_KEPT } from '../../tooling/cloud/worker/accounts.js';
import { DEVICE_CODE_SECONDS } from '../../tooling/cloud/worker/devices.js';
import { DEV_SESSION_SECONDS } from '../../tooling/cloud/worker/project-sessions.js';
import { minAccountDays } from '../../tooling/cloud/worker/oauth.js';
import { PENDING_TTL_SECONDS, SESSION_TTL_MS } from '../../tooling/cloud/worker/session.js';
import { RUNNER_IDLE_SECONDS } from '../../tooling/cloud/worker/runner-api.js';
import { settingsOf } from '../../tooling/cloud/worker/settings.js';

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

test('names what an account with no GitHub account linked has, and how long a first sign-in waits', () => {
    const wrangler = readFileSync(new URL('../../tooling/cloud/wrangler.jsonc', import.meta.url), 'utf8');
    const production = wrangler.slice(0, wrangler.indexOf('"env"'));
    // The Worker's own defaults, and production's vars, which deploy over them.
    assert.equal(minAccountDays({}), 30);
    assert.equal(settingsOf({}).newAccountDaily, 20);
    assert.ok(production.includes('"MIN_GITHUB_ACCOUNT_DAYS": "30"') && production.includes('"NEW_ACCOUNT_DAILY": "20"'));
    assert.ok(text.includes('compiles 20 a day of its own') && text.includes('for its first 30 days'));
    assert.equal(PENDING_TTL_SECONDS, 600);
    assert.ok(text.includes('for ten minutes') && text.includes('Ten minutes, in your browser alone'));
});

test('names how long a device\'s sign-in code works, and that the daily prune deletes it within a day', () => {
    const wrangler = readFileSync(new URL('../../tooling/cloud/wrangler.jsonc', import.meta.url), 'utf8');
    const crons = [...wrangler.matchAll(/"crons": \[([^\]]*)\]/g)].map(([, list]) => list);
    assert.equal(DEVICE_CODE_SECONDS, 10 * 60);
    // Production's trigger and staging's, each once a day: a minute and an hour, every day.
    assert.deepEqual(crons, ['"17 3 * * *"', '"17 3 * * *"']);
    assert.ok(text.includes('The code works for ten minutes') && text.includes('is deleted within a day'));
    assert.ok(text.includes('It works ten minutes, and is deleted within a day'));
});

test('names how long a preview\'s session stays listed once it ends without stopping, and that the daily prune deletes it within a day', () => {
    const wrangler = readFileSync(new URL('../../tooling/cloud/wrangler.jsonc', import.meta.url), 'utf8');
    const scheduled = readFileSync(new URL('../../tooling/cloud/worker/index.js', import.meta.url), 'utf8');
    const crons = [...wrangler.matchAll(/"crons": \[([^\]]*)\]/g)].map(([, list]) => list);
    assert.equal(DEV_SESSION_SECONDS, 10 * 60);
    assert.deepEqual(crons, ['"17 3 * * *"', '"17 3 * * *"']);
    assert.ok(scheduled.includes('createProjectSessions(env.DB).prune()'));
    assert.ok(text.includes('leaves your devices\' list within ten minutes, and is deleted within a day'));
    assert.ok(text.includes('within ten minutes if it ends without stopping, and deleted within a day'));
});

test("names the one permission the CLI's Google Play sign-in asks for, and the keychain entry it keeps", () => {
    // The keychain keeps an extension's secrets under the service crossbind <name>, as the api names it.
    const api = readFileSync(new URL('../../core/crossbind/src/actions/extensionApi.js', import.meta.url), 'utf8');
    const publisher = readFileSync(new URL('../../extensions/google-play/crossbind.extension.js', import.meta.url), 'utf8');
    assert.ok(api.includes('const service = `crossbind ${name}`;'));
    const service = `crossbind ${publisher.match(/name: '([^']+)',/)[1]}`;
    assert.ok(text.includes(`(\`${PLAY_SCOPE.split('/').at(-1)}\`)`));
    assert.ok(text.includes(`\`${service}\` entry`));
});

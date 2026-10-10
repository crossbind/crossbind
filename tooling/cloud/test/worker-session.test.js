import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, readSession, sessionCookie, clearCookie, readCookie, SESSION_COOKIE } from '../worker/session.js';

const SECRET = 'a-session-secret-of-at-least-32-characters';
const user = { id: '583231', name: 'octocat' };
const NOW = Date.parse('2026-10-07T12:00:00Z');

const requestWith = (cookie) => new Request('https://api.example/playground/session', { headers: { cookie } });

test('reads back the user a session was signed for', async () => {
    const value = await signSession(user, SECRET, NOW);

    assert.deepEqual(await readSession(requestWith(`other=1; ${SESSION_COOKIE}=${value}`), SECRET, NOW), user);
});

test('ignores a session whose payload, signature or secret does not match', async () => {
    const value = await signSession(user, SECRET, NOW);
    const [payload, signature] = value.split('.');
    const forged = btoa(JSON.stringify({ id: '1', n: 'admin', exp: NOW + 1000 })).replace(/=+$/, '');

    assert.equal(await readSession(requestWith(`${SESSION_COOKIE}=${forged}.${signature}`), SECRET, NOW), null);
    assert.equal(await readSession(requestWith(`${SESSION_COOKIE}=${payload}.${signature.slice(1)}A`), SECRET, NOW), null);
    assert.equal(await readSession(requestWith(`${SESSION_COOKIE}=${value}`), `${SECRET}-rotated`, NOW), null);
});

test('ignores an expired, malformed or missing session', async () => {
    const value = await signSession(user, SECRET, NOW);

    assert.equal(await readSession(requestWith(`${SESSION_COOKIE}=${value}`), SECRET, NOW + 31 * 24 * 3600 * 1000), null);
    assert.equal(await readSession(requestWith(`${SESSION_COOKIE}=not-a-session`), SECRET, NOW), null);
    assert.equal(await readSession(requestWith('theme=dark'), SECRET, NOW), null);
});

test('refuses to sign or read without a secret long enough to resist guessing', async () => {
    await assert.rejects(() => signSession(user, 'short', NOW), /SESSION_SECRET/);
    assert.equal(await readSession(requestWith(`${SESSION_COOKIE}=x.y`), undefined, NOW), null);
});

test('sets the cookie host-only, secure, HTTP-only and same-site', () => {
    assert.equal(
        sessionCookie(SESSION_COOKIE, 'v', 60),
        `${SESSION_COOKIE}=v; Max-Age=60; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
    assert.equal(clearCookie(SESSION_COOKIE), `${SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);
});

test('finds a cookie by its exact name', () => {
    assert.equal(readCookie(requestWith('a=1; __Host-pg_session_x=2; __Host-pg_session=3'), SESSION_COOKIE), '3');
    assert.equal(readCookie(requestWith('a=1'), SESSION_COOKIE), null);
});

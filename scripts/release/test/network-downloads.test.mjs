import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DOWNLOAD = path.join(ROOT, 'tooling/docker/download.sh');
const RETRY = path.join(ROOT, 'tooling/docker/retry-network.sh');
const exec = promisify(execFile);
const hasWget = spawnSync('wget', ['--version']).status === 0;

async function run(command, args, options = {}) {
    try {
        return { ...(await exec(command, args, options)), code: 0 };
    } catch (error) {
        if (typeof error.code !== 'number') throw error;
        return { stdout: error.stdout, stderr: error.stderr, code: error.code };
    }
}

function work(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-download-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

async function serve(t, handler) {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
        () =>
            new Promise((resolve) => {
                server.closeAllConnections();
                server.close(resolve);
            }),
    );
    return `http://127.0.0.1:${server.address().port}/archive`;
}

test('downloads recover from HTTP 429 and 503 without changing the payload', { skip: !hasWget }, async (t) => {
    const directory = work(t);
    let requests = 0;
    const body = Buffer.from('reviewed upstream archive\0\xff', 'latin1');
    const url = await serve(t, (_request, response) => {
        requests += 1;
        response.writeHead(requests === 1 ? 429 : requests === 2 ? 503 : 200);
        response.end(requests < 3 ? 'temporarily unavailable' : body);
    });
    const output = path.join(directory, 'archive');
    const result = await run('sh', [DOWNLOAD, url, output]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests, 3);
    assert.match(result.stderr, /429/);
    assert.match(result.stderr, /503/);
    assert.deepEqual(fs.readFileSync(output), body);
    assert.equal(fs.statSync(output).mode & 0o777, 0o644);
    assert.deepEqual(fs.readdirSync(directory), ['archive']);
});

test('a broken transfer is retried and never exposes a partial destination', { skip: !hasWget }, async (t) => {
    const directory = work(t);
    const output = path.join(directory, 'archive');
    fs.writeFileSync(output, 'previous complete archive');
    const body = Buffer.from('the entire replacement archive');
    let requests = 0;
    const url = await serve(t, (_request, response) => {
        requests += 1;
        assert.equal(fs.readFileSync(output, 'utf8'), 'previous complete archive');
        response.writeHead(200, { 'Content-Length': body.length });
        if (requests === 1) {
            response.write(body.subarray(0, 3), () => response.destroy());
        } else {
            response.end(body);
        }
    });
    const result = await run('sh', [DOWNLOAD, url, output]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests, 2);
    assert.deepEqual(fs.readFileSync(output), body);
});

test('HTTP 404 fails immediately and preserves an existing complete destination', { skip: !hasWget }, async (t) => {
    const directory = work(t);
    const output = path.join(directory, 'archive');
    fs.writeFileSync(output, 'previous complete archive');
    let requests = 0;
    const url = await serve(t, (_request, response) => {
        requests += 1;
        response.writeHead(404);
        response.end('not found');
    });
    const result = await run('sh', [DOWNLOAD, url, output]);
    assert.equal(result.code, 8);
    assert.equal(requests, 1);
    assert.match(result.stderr, /404/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'previous complete archive');
    assert.deepEqual(fs.readdirSync(directory), ['archive']);
});

test('persistent HTTP 503 fails after five attempts and removes the partial file', { skip: !hasWget }, async (t) => {
    const directory = work(t);
    let requests = 0;
    const url = await serve(t, (_request, response) => {
        requests += 1;
        response.writeHead(503);
        response.end('still unavailable');
    });
    const result = await run('sh', [DOWNLOAD, url, path.join(directory, 'archive')]);
    assert.notEqual(result.code, 0);
    assert.equal(requests, 5);
    assert.match(result.stderr, /crossbind-download: transfer failed/);
    assert.deepEqual(fs.readdirSync(directory), []);
});

function commandFixture(t, message, failures) {
    const directory = work(t);
    const command = path.join(directory, 'command.sh');
    const counter = path.join(directory, 'counter');
    const delays = path.join(directory, 'delays');
    fs.writeFileSync(counter, '0');
    fs.writeFileSync(delays, '');
    fs.writeFileSync(
        command,
        [
            '#!/bin/sh',
            'count=$(cat "$RETRY_TEST_COUNT")',
            'count=$((count + 1))',
            'printf "%s" "$count" > "$RETRY_TEST_COUNT"',
            'if [ "$count" -le "$RETRY_TEST_FAILURES" ]; then',
            '  printf "%s\\n" "$RETRY_TEST_MESSAGE" >&2',
            '  exit 17',
            'fi',
            'echo command-completed',
        ].join('\n'),
    );
    fs.writeFileSync(path.join(directory, 'sleep'), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$RETRY_TEST_DELAYS"\n', { mode: 0o755 });
    return {
        command,
        counter,
        delays,
        env: {
            ...process.env,
            PATH: `${directory}${path.delimiter}${process.env.PATH}`,
            RETRY_TEST_COUNT: counter,
            RETRY_TEST_DELAYS: delays,
            RETRY_TEST_FAILURES: String(failures),
            RETRY_TEST_MESSAGE: message,
        },
    };
}

test('Gradle-style HTTP 504 failures recover with bounded increasing waits', async (t) => {
    const fixture = commandFixture(t, 'Received status code 504 from server: Gateway Time-out', 2);
    const result = await run('bash', [RETRY, 'sh', fixture.command], { env: fixture.env });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /command-completed/);
    assert.equal(fs.readFileSync(fixture.counter, 'utf8'), '3');
    assert.equal(fs.readFileSync(fixture.delays, 'utf8'), '5\n10\n');
});

test('persistent connection failures return the command failure after three attempts', async (t) => {
    const fixture = commandFixture(t, 'Connection reset by peer', 20);
    const result = await run('bash', [RETRY, 'sh', fixture.command], { env: fixture.env });
    assert.equal(result.code, 17);
    assert.equal(fs.readFileSync(fixture.counter, 'utf8'), '3');
    assert.equal(fs.readFileSync(fixture.delays, 'utf8'), '5\n10\n');
});

for (const [label, message] of [
    ['compile error', 'error: cannot find symbol Example'],
    ['missing dependency', 'Received status code 404 from server: Not Found'],
    ['verification error alongside a network message', 'HTTP 504\nDependency verification failed: checksum mismatch'],
]) {
    test(`${label} is never retried`, async (t) => {
        const fixture = commandFixture(t, message, 20);
        const result = await run('bash', [RETRY, 'sh', fixture.command], { env: fixture.env });
        assert.equal(result.code, 17);
        assert.equal(fs.readFileSync(fixture.counter, 'utf8'), '1');
        assert.equal(fs.readFileSync(fixture.delays, 'utf8'), '');
    });
}

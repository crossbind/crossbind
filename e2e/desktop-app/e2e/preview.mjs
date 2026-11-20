import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import config from '../crossbind.config.mjs';
import { REACH_PORT } from './launch.mjs';
import { answerPreview } from './endpoint.mjs';

// Opens a preview in the conformance app `pnpm build` made, as the crossbind app will: runs crossbind app preview in the
// project given, serves its open: line at the run's endpoint, which src/preview.js opens, and reads what the previewed
// page logs in the preview's terminal as the run edits the project's files; then asks the dev server from this machine
// as another one on the network would. A project other than e2e/app-preview gets that page's check module beside its
// src/main.js for the run, and every file the run touched is put back as it ends. With CROSSBIND_APP_PLATFORM=ios the
// app opens in the Simulator, with android on the attached device.
//   node e2e/preview.mjs <project folder> [crossbind app preview's options, as --host 0.0.0.0]
const RUN_TIMEOUT_MS = 900000;
// The preview's first native build comes before its open: line, and an iOS or Android app's build before its page.
const START_MS = 300000;
const OPEN_MS = 120000;
const LOAD_MS = 60000;
const HOT_MS = 5000;
const NATIVE_MS = 60000;
const LINE_MS = 30000;
const ASKED_MS = 10000;
const SETTLE_MS = 1000;
const CHECK_FILES = ['preview-check.js', 'preview-greeting.js'];
const RESULT = '"J₃ * (2*J₃) = "';
const ROLE_REFUSAL = 'a page of the role project does not reach app.paths, which pages of the role app call';
const PLATFORMS = { darwin: 'macos', linux: 'linux', win32: 'windows' };

const root = resolve(import.meta.dirname, '..');
const repository = resolve(root, '..', '..');
const project = resolve(process.argv[2] ?? '.');
const fixture = resolve(repository, 'e2e', 'app-preview');
const isFixture = project === fixture;
const { name } = config.general;
const platform = process.env.CROSSBIND_APP_PLATFORM;
const devicePlatform = platform ?? PLATFORMS[process.platform];
process.chdir(root);

// The lines a child writes, each with the time it came, and a wait for the first that matches from a line on.
function lineStream() {
    const lines = [];
    const waiters = [];
    let partial = '';
    const take = (chunk) => {
        const parts = `${partial}${chunk}`.split(/\r?\n/);
        partial = parts.pop();
        for (const text of parts) {
            const line = { text, at: performance.now(), index: lines.length };
            lines.push(line);
            for (const waiter of [...waiters]) {
                if (line.index >= waiter.from && waiter.pattern.test(line.text)) waiter.resolve(line);
            }
        }
    };
    const waitFor = (pattern, ms, what, from = 0) => new Promise((done, fail) => {
        const found = lines.slice(from).find((line) => pattern.test(line.text));
        if (found) {
            done(found);
            return;
        }
        const waiter = { pattern, from };
        const timer = setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            fail(new Error(`${what} did not come in ${ms / 1000} s`));
        }, ms);
        waiter.resolve = (line) => {
            clearTimeout(timer);
            waiters.splice(waiters.indexOf(waiter), 1);
            done(line);
        };
        waiters.push(waiter);
    });
    return { lines, take, waitFor, text: () => lines.map((line) => line.text).join('\n') };
}
const jsonOf = (line, prefix) => JSON.parse(line.text.slice(line.text.indexOf(prefix) + prefix.length));

const terminal = lineStream();
const device = lineStream();
const kept = new Map();
let preview = null;
let opened = null;
let endpoint = null;

// Each file the run changes or makes, as it was, which the run puts back however it ends.
function keep(file) {
    if (!kept.has(file)) kept.set(file, existsSync(file) ? readFileSync(file, 'utf8') : null);
}
function putBack() {
    for (const [file, text] of kept) {
        if (text === null) rmSync(file, { force: true });
        else writeFileSync(file, text);
    }
    kept.clear();
}

// The check module beside the project's main.js, which calls it with the project's own initNative().
function addCheck() {
    if (isFixture) return;
    for (const file of CHECK_FILES) {
        keep(join(project, 'src', file));
        copyFileSync(join(fixture, 'src', file), join(project, 'src', file));
    }
    const main = join(project, 'src', 'main.js');
    keep(main);
    writeFileSync(main, `${readFileSync(main, 'utf8')}\nimport { checkPreview } from './preview-check.js';\n\ncheckPreview(initNative);\n`);
}

// A child and those it started, as crossbind app preview's Vite, which a signal reaches through it but on Windows.
function endTree(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
}

let isFinished = false;
function finish(problem) {
    if (isFinished) return;
    isFinished = true;
    opened?.close?.();
    endTree(opened?.child);
    endTree(preview);
    endpoint?.close();
    putBack();
    const said = `--- the preview's terminal:\n${terminal.text()}\n--- the app:\n${device.text()}`;
    if (problem) {
        console.error(`FAIL: ${problem}\n${said}`);
        process.exit(1);
    }
    console.log(said);
    process.exit(0);
}
process.on('SIGINT', () => finish('the run was stopped'));
process.on('SIGTERM', () => finish('the run was stopped'));
process.on('exit', putBack);

function startPreview() {
    const crossbind = join(dirname(createRequire(join(project, 'package.json')).resolve('crossbind/package.json')), 'src', 'cli.js');
    const { FORCE_COLOR, ...env } = process.env;
    const child = spawn(process.execPath, [crossbind, 'app', 'preview', ...process.argv.slice(3)], { cwd: project, env: { ...env, NO_COLOR: '1' } });
    child.stdout.on('data', terminal.take);
    child.stderr.on('data', terminal.take);
    child.once('exit', (code) => setTimeout(() => finish(`crossbind app preview exited with ${code}`), SETTLE_MS));
    return child;
}

function serveLine(line) {
    const server = createServer((asked, answer) => {
        if (!answerPreview(asked, answer, line)) answer.writeHead(404).end();
    });
    return new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(REACH_PORT, '127.0.0.1', () => done(server));
    });
}

function missing(file) {
    finish(`${file} is missing - run \`pnpm build\` first.`);
}

// The app, as e2e/run.mjs opens it, its page's console in its output.
async function launch() {
    const env = { CROSSBIND_APP_CONSOLE: '1' };
    let app;
    if (platform) {
        const built = `${root}/dist/${name}-${platform}`;
        if (!existsSync(built)) missing(built);
        const { buildForSimulator, openInSimulator, buildApk, openOnDevice, adbPath } = await import('crossbind');
        if (platform === 'android') execFileSync(adbPath(), ['reverse', `tcp:${REACH_PORT}`, `tcp:${REACH_PORT}`]);
        app = platform === 'android' ? openOnDevice(buildApk(built), { env }) : openInSimulator(buildForSimulator(built), { env });
    } else {
        const executable = process.platform === 'darwin'
            ? `${root}/dist/${name}.app/Contents/MacOS/${name}`
            : `${root}/dist/${name}-${process.platform}-${process.arch}/${name}${process.platform === 'win32' ? '.exe' : ''}`;
        if (!existsSync(executable)) missing(executable);
        app = { child: spawn(executable, [], { env: { ...process.env, ...env } }), close: () => {} };
    }
    app.child.stdout?.on('data', device.take);
    app.child.stderr?.on('data', device.take);
    return app;
}

const isRunning = (child) => child.exitCode === null && child.signalCode === null;

// What a request from this machine gets of the dev server, as another machine on the network would ask it.
async function statusOf(url) {
    const answer = await fetch(url, { signal: AbortSignal.timeout(ASKED_MS) });
    await answer.arrayBuffer();
    return answer.status;
}

// A socket of Vite's protocol without Vite's token, with an Origin as a browser sends one or without, as a program may.
function socketOf(source, origin) {
    const { hostname, port } = new URL(source);
    return new Promise((done) => {
        const asked = request({
            hostname,
            port,
            path: '/',
            timeout: ASKED_MS,
            headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
                'Sec-WebSocket-Protocol': 'vite-hmr',
                ...(origin ? { Origin: origin } : {}),
            },
        });
        asked.once('upgrade', (answer, socket) => {
            socket.destroy();
            done(`opened ${answer.statusCode}`);
        });
        asked.once('response', (answer) => done(`answered ${answer.statusCode}`));
        asked.once('error', (error) => done(`refused (${error.code ?? error.message})`));
        asked.end();
    });
}

function expect(isHeld, problem) {
    if (!isHeld) throw new Error(problem);
}

// 5. Each way the session stops says so, and the dev server says which side to update; none served the origin, which
// the one that opens served.
async function checkStops() {
    const said = await device.waitFor(/PAGE GETS preview-stops |CONFORMANCE ERR/, OPEN_MS, "the app page's stops");
    expect(!said.text.includes('CONFORMANCE ERR'), said.text);
    const stops = jsonOf(said, 'PAGE GETS preview-stops ');
    expect(stops['wrong key']?.includes('could not prove it is the preview you scanned'), `a wrong key did not stop the session: ${stops['wrong key']}`);
    expect(/older than this app takes \(protocol 1, from 2\): update crossbind in the project: \S+ (up|update) crossbind$/.test(stops['protocol below']), `a protocol below the app's did not stop the session: ${stops['protocol below']}`);
    expect(stops['protocol above']?.includes('newer than this app (protocol 1, up to 0): update the crossbind app'), `a protocol above the app's did not stop the session: ${stops['protocol above']}`);
    await terminal.waitFor(/takes protocols 2–3 asked for this preview, which speaks 1: update crossbind in the project/, LINE_MS, "the terminal's line of an app of protocols 2–3");
    await terminal.waitFor(/takes protocols 0–0 asked for this preview, which speaks 1: update the crossbind app on the device/, LINE_MS, "the terminal's line of an app of protocol 0");
    const opening = await device.waitFor(/PAGE GETS preview-open |CONFORMANCE ERR/, LINE_MS, "the app page's opening");
    expect(!opening.text.includes('CONFORMANCE ERR'), opening.text);
    return stops;
}

// 9. The device asked the dev server for nothing its app answers itself.
function checkPageApiAsked() {
    const asked = terminal.lines.filter((line) => line.text.includes('asked this dev server for /__crossbind/app.js'));
    expect(asked.length === 0, `the device asked the dev server for /__crossbind/app.js ${asked.length} times`);
}

// 3, 6 and 10: the page's first line, through the module whose id has a colon, in the terminal, with the device's
// platform; 4 and 8: the app's function refused naming the role, and the system's dialog.
async function checkLoad() {
    const loaded = await terminal.waitFor(/PREVIEW (load|ERR)/, LOAD_MS, "the previewed page's first line").catch((error) => error);
    checkPageApiAsked();
    if (loaded instanceof Error) throw loaded;
    const loadLine = loaded;
    expect(!loadLine.text.includes('PREVIEW ERR'), `the previewed page did not load: ${loadLine.text}`);
    const load = jsonOf(loadLine, 'PREVIEW load ');
    expect(load.platform === devicePlatform && load.device === devicePlatform, `the page reads the platform ${load.platform}, and device.platform ${load.device}, on ${devicePlatform}`);
    const pathsLine = await terminal.waitFor(/PREVIEW (paths|failure) /, LINE_MS, "the page's app.paths()", loadLine.index);
    expect(pathsLine.text.includes('PREVIEW paths '), pathsLine.text);
    const paths = jsonOf(pathsLine, 'PREVIEW paths ');
    expect(paths.includes(ROLE_REFUSAL), `the page's app.paths() got ${paths}`);
    const dialog = jsonOf(await terminal.waitFor(/PREVIEW dialog /, LINE_MS, "the page's dialog", loadLine.index), 'PREVIEW dialog ');
    expect(dialog.dialog === 'shown' && dialog.closed === true && /^answered \d+$/.test(dialog.answer), `dialog.message did not show the system's dialog: ${JSON.stringify(dialog)}`);
    return { load, paths, dialog };
}

// 1. An edit of the module the page accepts comes in place: its line with the new value, the page's state kept.
async function checkJsEdit(load) {
    const file = join(project, 'src', 'preview-greeting.js');
    keep(file);
    const greeting = `second-${Date.now()}`;
    const from = terminal.lines.length;
    const saved = performance.now();
    writeFileSync(file, `export const greeting = '${greeting}';\n`);
    const line = await terminal.waitFor(new RegExp(`PREVIEW hot .*"greeting":"${greeting}"`), HOT_MS, 'the edited module in place', from);
    const hot = jsonOf(line, 'PREVIEW hot ');
    const reloads = terminal.lines.slice(from, line.index).filter((each) => each.text.includes('PREVIEW load '));
    expect(hot.isReload === load.isReload && hot.ticks > 0 && reloads.length === 0, `the edit reloaded the page: ${JSON.stringify(hot)}, ${reloads.length} loads between`);
    return Math.round(line.at - saved);
}

// 2. A C++ edit shows without a reinstall: the new result, the app's process the same.
async function checkNativeEdit(app) {
    const file = join(project, 'src', 'native', 'native.cpp');
    if (!existsSync(file) || !readFileSync(file, 'utf8').includes(RESULT)) return null;
    keep(file);
    const marker = `e${Date.now()}`;
    const from = terminal.lines.length;
    const saved = performance.now();
    writeFileSync(file, kept.get(file).replace(RESULT, `"${marker} J₃ * (2*J₃) = "`));
    const line = await terminal.waitFor(new RegExp(`Matrix multiplier with c\\+\\+ => ${marker} `), NATIVE_MS, "the edited C++'s result", from);
    expect(isRunning(app.child), 'the app ended as the C++ changed');
    return Math.round(line.at - saved);
}

// 11. Another machine on the network gets nothing of the project's but the session; the editor's path is asked only
// once the gate refused the files, as without it this machine would open an editor.
async function checkOtherMachine(source, token) {
    const file = join(project, 'package.json').replaceAll('\\', '/');
    const files = await statusOf(`${source}/@fs/${file.replace(/^\//, '')}`);
    expect(files === 403, `/@fs/ of the project's package.json got ${files} without the gate's token`);
    // The fixture's path, which a middleware of a plugin before crossbind's answers, and the device still reaches.
    const early = await statusOf(`${source}/__e2e/early`);
    expect(early === 403, `/__e2e/early, which a plugin before crossbind's answers, got ${early} without the gate's token`);
    const earlyWithToken = isFixture ? await (await fetch(`${source}/__e2e/early`, { headers: { 'x-crossbind-preview': token }, signal: AbortSignal.timeout(ASKED_MS) })).text() : null;
    expect(!isFixture || earlyWithToken === 'early', `/__e2e/early with the gate's token got ${earlyWithToken}`);
    const editor = await statusOf(`${source}/__open-in-editor?file=${encodeURIComponent(file)}`);
    expect(editor === 403, `/__open-in-editor got ${editor} without the gate's token`);
    const sockets = [await socketOf(source), await socketOf(source, source)];
    expect(sockets.every((socket) => socket.startsWith('refused')), `a socket without Vite's token: ${sockets.join(', ')}`);
    const session = await statusOf(`${source}/__crossbind/session?challenge=${randomBytes(32).toString('base64url')}`);
    const odd = await statusOf(`${source}/__crossbind/session?challenge=${'A'.repeat(42)}.`);
    expect(session === 200 && odd === 400, `the session answered ${session}, and a challenge of another form ${odd}`);
    return {
        files, early, earlyWithToken, editor, sockets, session, odd,
    };
}

// 13. The fixture's dependency, as Vite's optimizer bundled it, takes crossbind/app from the module of the project's side,
// with no copy of its own.
async function checkOptimizedDependency(source, token) {
    if (!isFixture) return null;
    const asked = (path) => fetch(`${source}${path}`, { headers: { 'x-crossbind-preview': token } }).then((answer) => answer.text());
    const main = await asked('/src/main.js');
    const dependency = main.match(/"(\/node_modules\/\.vite\/deps\/@crossbind_extension-clipboard\.js[^"]*)"/)?.[1];
    expect(dependency, `the page's main.js imports no optimized @crossbind/extension-clipboard: ${main.slice(0, 400)}`);
    const code = await asked(dependency);
    expect(code.includes('/@id/__x00__crossbind-preview:app') && !/hostOf|deviceOf|globalThis\.Crossbind/.test(code), `the optimized dependency holds its own crossbind/app: ${code.slice(0, 400)}`);
    return dependency;
}

async function run() {
    addCheck();
    preview = startPreview();
    const open = (await terminal.waitFor(/^\s*open: http:\/\/\S+/, START_MS, "crossbind app preview's open: line")).text.trim().slice('open: '.length);
    const source = new URL(open).origin;
    const token = createHmac('sha256', Buffer.from(new URLSearchParams(new URL(open).hash.slice(1)).get('k'), 'base64url')).update('crossbind-requests').digest('base64url');
    endpoint = await serveLine(open);
    opened = await launch();
    opened.child.once('exit', (code) => setTimeout(() => finish(`the app exited with ${code}`), SETTLE_MS));
    const stops = await checkStops();
    const { load, paths, dialog } = await checkLoad();
    const js = await checkJsEdit(load);
    const cpp = await checkNativeEdit(opened);
    const other = await checkOtherMachine(source, token);
    const dependency = await checkOptimizedDependency(source, token);
    checkPageApiAsked();
    const named = relative(repository, project).replaceAll('\\', '/');
    console.log(`PREVIEW CHECKS ${JSON.stringify({ platform: devicePlatform, project: named, stops, load, paths, dialog, other, dependency })}`);
    console.log(`TIMING a JavaScript edit to the page: ${js} ms${cpp === null ? '' : `; a C++ edit to the page: ${cpp} ms`}`);
    console.log(`ok: ${devicePlatform} preview of ${named}`);
}

setTimeout(() => finish('the run did not finish in time'), RUN_TIMEOUT_MS).unref();
run().then(() => finish(), (error) => finish(error.message));

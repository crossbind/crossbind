import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
    existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { defaultRouteAddress } from 'crossbind/src/utils/previewAddress.js';
import { previewRefusal } from 'crossbind/src/utils/previewModule.js';
import config from '../crossbind.config.mjs';
import {
    ACCOUNTS, CLI_TOKEN, COMPILED, gateToken, newId, newKey, sessionAnswer, standInCloud, standInSource,
} from './cloud.mjs';
import { checkClearing, checkDeletedAccount } from './clearing.mjs';
import { checkConsents } from './consents.mjs';
import { checkIndicator } from './indicator.mjs';
import { checkPermissions } from './permissions.mjs';
import { checkPickers } from './pickers.mjs';
import { serveEndpoint } from './endpoint.mjs';
import {
    CLOUD, CLOUD_PORT, ENDPOINT_PORT, SNAPSHOTS_PORT,
} from './steps.mjs';

// The fixture's app, which `pnpm build` made, opens the previews of made-up accounts as the crossbind app does, against
// a stand-in for crossbind cloud (cloud.mjs): crossbind app preview runs e2e/app-preview, on Linux --cloud first uploads
// it as a snapshot, and servers of the run's own, at this machine's address on its network, answer the check of sessions that
// stop and are a second project. The app's page and each project's take the run's steps through the fixture's hooks and
// report what they got (src/main.js, e2e/app-preview/src/project-steps.js); the previewed page's own lines come to the
// preview's terminal, as phase 2's checks read them. With CROSSBIND_APP_PLATFORM=ios the app opens in the Simulator,
// with android on the attached device.
//   node e2e/run.mjs
const RUN_TIMEOUT_MS = 1500000;
const START_MS = 300000;
const LOAD_MS = 180000;
const HOT_MS = 5000;
const LINE_MS = 30000;
const ASKED_MS = 10000;
const SETTLE_MS = 1000;
const NUMBER = 47;
const PREVIEW_LISTED = /Projects lists it in the crossbind app on every device signed in as made-up-e2e/;
const ROLE_REFUSAL = (name) => `a page of the role project does not reach ${name}, which pages of the role app call`;
const ABSENT = (name) => `Error: crossbind: an app has no function ${name}`;
// The host's words for a status the proxy cannot answer a web view with.
const UNTAKEN = (status) => `crossbind: a route answers with a status of 2xx, 4xx or 5xx, which a webview takes, not ${status}`;
const CLIPBOARD_TEXT = 'crossbind e2e: a project wrote this';
// What a page of the role project reaches of the app's functions, and what each answers options it does not take: the
// design's 6.1 as the first version has it. Every other function the app registers refuses it, with the host's words.
const OPEN = {
    'dialog.message': (answer) => answer === 'Error: crossbind: a message dialog takes a message',
    'clipboard.writeText': (answer) => answer === 'Error: crossbind: clipboard.writeText takes a string',
    'shell.openExternal': (answer) => answer.startsWith('Error: crossbind: openExternal opens http, https and mailto addresses alone'),
};
// Where the system tells its user of a read, the clipboard's read is a project's too.
const OPEN_ON_A_PHONE = { 'clipboard.readText': (answer) => answer === `answered ${JSON.stringify(CLIPBOARD_TEXT)}` };
const SOURCE = /\.(c|cc|cpp|h|hpp|m|mm)$/;
const NAMED = /"([a-z][a-z0-9-]*\.[a-z][A-Za-z0-9]*)"/g;
const REGISTERED = /(?:\.|->)function\(\s*([^,]+?)\s*,/g;
const HOOKS = 'e2e-hooks.';
// What a preview refuses through the project's crossbind/app, one of each kind: a function that belongs to the built
// app, one that would end the preview, one of a name refused whole, a file dialog, and a notification.
const MODULE_REFUSED = ['app.paths', 'app.quit', 'shell.openPath', 'windows.set', 'dialog.open', 'notification.show'];
// The runtime permissions the fixture's app.permissions gives an Android app, which a run before left given.
const ANDROID_PERMISSIONS = ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'];
const PLATFORMS = { darwin: 'macos', linux: 'linux', win32: 'windows' };
const WORDS = {
    signedOut: 'Sign in to open your projects. crossbind app preview lists each project it runs on the account it is signed in with.',
    empty: (account) => `No preview runs as ${account}. Run crossbind app preview in your project, signed in as ${account} (crossbind login), and it shows here.`,
    notListed: (account) => `This preview is not on ${account}'s list. It ended, or it runs as another account: sign in to the same account here and in crossbind app preview.`,
    wrongNumber: 'That was not the number the page showed. Start again.',
    checkFirst: 'crossbind opens the preview it checked last: check it first.',
    signedInAs: (account) => `crossbind is signed in as ${account}: sign out first.`,
};

const root = resolve(import.meta.dirname, '..');
const repository = resolve(root, '..', '..');
const fixture = join(repository, 'e2e', 'app-preview');
const { name } = config.general;
const platform = process.env.CROSSBIND_APP_PLATFORM;
const devicePlatform = platform ?? PLATFORMS[process.platform];
const isPhone = platform === 'ios' || platform === 'android';
const isApple = platform === 'ios' || (!platform && process.platform === 'darwin');
// Android's and Windows' served origins are http://<name>.localhost, the others' crossbind://<name>.
const isHttpOrigin = platform === 'android' || (!platform && process.platform === 'win32');
// --cloud builds e2e/app-preview for the web, whose toolchain CI's Linux runners have, in Docker, and its macOS and
// Windows runners have not.
const isWebBuilt = process.platform === 'linux';
const isWindows = !platform && process.platform === 'win32';
// The port WebView2's DevTools listen on in a Windows run, through which the run clicks in the page, as its user would.
const DEVTOOLS_PORT = 9224;
// How much of a page's text a failure quotes.
const SHOWN_CHARACTERS = 300;
const CLICK_MS = 5000;
const run = randomBytes(4).toString('hex');
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
let cloud = null;
let endpoint = null;
let preview = null;
let opened = null;
const sources = [];
const made = [];
const kept = new Map();

function keep(file) {
    if (!kept.has(file)) kept.set(file, readFileSync(file, 'utf8'));
}
function putBack() {
    for (const [file, text] of kept) writeFileSync(file, text);
    kept.clear();
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
    cloud?.close();
    sources.forEach((source) => source.close());
    made.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
    putBack();
    const calls = (cloud?.calls ?? []).map(({ host, call, status }) => `${host} ${call}${status ? ` ${status}` : ''}`).join('\n');
    const said = `--- the preview's terminal:\n${terminal.text()}\n--- the app:\n${device.text()}\n--- the pages' notes:\n${(endpoint?.notes ?? []).map((note) => JSON.stringify(note)).join('\n')}\n--- crossbind cloud's calls:\n${calls}`;
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

function expect(isHeld, problem) {
    if (!isHeld) throw new Error(problem);
}

const app = (what) => endpoint.step('app', what);
const project = (what) => endpoint.step('project', what);

// The value a step answered, else the run's failure naming what it answered instead.
async function valueOf(what, asked) {
    const answered = await app(asked);
    expect(answered.error === undefined, `${what}: ${answered.error}`);
    return answered.value;
}
async function errorOf(what, asked) {
    const answered = await app(asked);
    expect(answered.error !== undefined, `${what} answered ${JSON.stringify(answered.value)}`);
    return answered.error;
}

const cliOf = () => join(dirname(createRequire(join(fixture, 'package.json')).resolve('crossbind/package.json')), 'src', 'cli.js');

function startPreview(args) {
    const { FORCE_COLOR, ...env } = process.env;
    const child = spawn(process.execPath, [cliOf(), 'app', 'preview', ...args], { cwd: fixture, env: { ...env, ...cloud.env, NO_COLOR: '1' } });
    child.stdout.on('data', terminal.take);
    child.stderr.on('data', terminal.take);
    return child;
}

function uploadSnapshot() {
    return new Promise((done, fail) => {
        const child = startPreview(['--cloud']);
        const timer = setTimeout(() => {
            endTree(child);
            fail(new Error(`crossbind app preview --cloud did not end in ${START_MS / 1000} s`));
        }, START_MS);
        child.once('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) done();
            else fail(new Error(`crossbind app preview --cloud exited with ${code}`));
        });
    });
}

function missing(file) {
    finish(`${file} is missing - run \`pnpm build\` first.`);
}

let builtForDevice = null;
// The app, as e2e/desktop-app/e2e/run.mjs opens it, its page's console in its output: on the desktop with the
// arguments given, as a link the system hands it as it starts. Its page says so once it loaded.
async function launch(args = []) {
    const env = { CROSSBIND_APP_CONSOLE: '1', ...(isWindows ? { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEVTOOLS_PORT}` } : {}) };
    const loaded = endpoint.waitForNote((note) => note.role === 'app' && note.loaded, LOAD_MS, "the app's page");
    if (platform) {
        const built = `${root}/dist/${name}-${platform}`;
        if (!existsSync(built)) missing(built);
        const { default: openInSimulator, buildForSimulator } = await import('crossbind/src/actions/iosSimulator.js');
        const { buildApk } = await import('crossbind/src/actions/androidGradle.js');
        const { default: openOnDevice, adbPath } = await import('crossbind/src/actions/androidDevice.js');
        if (platform === 'android') {
            for (const port of [ENDPOINT_PORT, CLOUD_PORT, SNAPSHOTS_PORT]) execFileSync(adbPath(), ['reverse', `tcp:${port}`, `tcp:${port}`]);
            if (!builtForDevice) {
                builtForDevice = buildApk(built);
                // So that Android asks its own question again after the extension's Allow: a revoke ends a running app.
                for (const permission of ANDROID_PERMISSIONS) spawnSync(adbPath(), ['shell', 'pm', 'revoke', applicationIdOf(builtForDevice), `android.permission.${permission}`]);
            }
            opened = openOnDevice(builtForDevice, { env });
        } else {
            builtForDevice ??= buildForSimulator(built);
            opened = openInSimulator(builtForDevice, { env });
        }
    } else {
        const executable = process.platform === 'darwin'
            ? `${root}/dist/${name}.app/Contents/MacOS/${name}`
            : `${root}/dist/${name}-${process.platform}-${process.arch}/${name}${process.platform === 'win32' ? '.exe' : ''}`;
        if (!existsSync(executable)) missing(executable);
        const child = spawn(executable, args, { env: { ...process.env, ...env } });
        opened = { child, close: () => endTree(child) };
    }
    const { child } = opened;
    child.stdout?.on('data', device.take);
    child.stderr?.on('data', device.take);
    opened.onExit = (code) => setTimeout(() => finish(`the app exited with ${code}`), SETTLE_MS);
    child.once('exit', opened.onExit);
    return loaded;
}

// The app ended and opened again, which reads its sign-in from the system's store.
async function relaunch() {
    const { child, onExit } = opened;
    child.off('exit', onExit);
    const ended = new Promise((done) => {
        if (child.exitCode !== null || child.signalCode !== null) done();
        else child.once('exit', done);
    });
    opened.close();
    if (!isPhone) await ended;
    return launch();
}

// A link of crossbind.dev/open the system hands the running phone app, as a scan of a QR code does: on Android an app
// link, to the app that names its package, as once the site verified it; on iOS a user activity of the web, which the
// fixture's hook hands the scene's delegate as iOS does.
async function handLink(session) {
    const url = `https://crossbind.dev/open/?s=${session}`;
    if (platform === 'ios') {
        await valueOf('the link handed as iOS hands one', { do: 'handLink', url });
        return;
    }
    const { adbPath } = await import('crossbind/src/actions/androidDevice.js');
    execFileSync(adbPath(), ['shell', `am start -W -a android.intent.action.VIEW -p ${applicationIdOf(builtForDevice)} -d '${url}'`]);
}

function applicationIdOf(apk) {
    return JSON.parse(readFileSync(join(dirname(apk), 'output-metadata.json'), 'utf8')).applicationId;
}

// A link of the app's own scheme, which a desktop's /open/ page opens it with.
const linkOf = (session) => `dev.crossbind.app://open?s=${session}`;
const NO_SESSION = 'no-session';
const NO_PREVIEW = 'This link opens no preview.';
const originName = (account, projectId) => createHash('sha256').update(`crossbind-origin.${account.id}.${projectId}`).digest('hex').slice(0, 32);
const originUrl = (origin) => (isHttpOrigin ? `http://${origin}.localhost/` : `crossbind://${origin}/`);

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

// A server of the run's own as a listed session's source, which answers its check as told.
async function listedSource(address, what, answer, files) {
    const session = cloud.list(ACCOUNTS.main, { source: 'dev', addresses: [], ...what });
    const source = await standInSource(address, { key: session.key, answer: (challenge) => answer(session, challenge), files });
    session.addresses = [source.address];
    sources.push(source);
    return { session, source };
}

// When, in ms from a moment of the system's clock on, the stand-in cloud read a listed session and its source heard its
// check: an open's check asks the one, then the other.
function heardOf(session, from) {
    const after = (records, test) => {
        const found = records.find((each) => each.at >= from && test(each));
        return found ? found.at - from : null;
    };
    const source = sources.find((each) => session.addresses.includes(each.address));
    return {
        cloud: after(cloud.calls, (call) => call.call === `GET /v1/sessions/${session.id}`),
        source: source ? after(source.asked, (asked) => asked.path === '/__crossbind/session') : null,
    };
}

// The check's answer of a preview of the session's own key, but for what is overridden.
const asPreview = (overrides = {}, fields = {}) => (session, challenge) => sessionAnswer({
    key: session.key,
    protocol: 1,
    challenge,
    session: {
        protocol: overrides.protocol ?? 1, project: { name: session.project.name }, account: ACCOUNTS.main, session: session.id, ...fields,
    },
    ...overrides,
});

// The address rule's table: a neighbour of each range of a local address on either side, public addresses, the loopback,
// names off .local, ports out of their range, and an address with a userinfo, a path or numbers no URL writes.
const FARAWAY = [
    '9.255.255.255:5173', '11.0.0.0:5173', '172.15.255.255:5173', '172.32.0.0:5173', '192.167.255.255:5173', '192.169.0.0:5173',
    '100.63.255.255:5173', '100.128.0.0:5173', '169.253.255.255:5173', '169.255.0.0:5173', '[fbff:ffff::1]:5173', '[fe00::1]:5173',
    '8.8.8.8:5173', '[2001:db8::1]:5173', 'localhost:5173', '127.0.0.1:5173', 'printer.localhost:5173', 'printer.local.:5173',
    'printer-local:5173', 'Printer.local:5173', '192.168.001.006:5173', '192.168.1.6:0', '192.168.1.6:65536', '192.168.1.6:05173',
    '192.168.1.6', 'user@192.168.1.6:5173', '192.168.1.6:5173/x',
];
// The listed name's: a control, a mark of direction and 65 characters, none of which a dialog may show.
const UNSHOWN = ['e2e\u0007project', 'e2e\u202Eproject', 'n'.repeat(65)];

// The sessions that stop before anything of their project loads, each with the words the app's page gets: the tables'
// stop before any connection, of which a source of the run's own on the loopback, at two of the table's addresses,
// and the sources of the names' are never asked.
async function stoppingSessions(address) {
    const closed = await standInSource(address, { key: newKey(), answer: () => null });
    const unreachableAt = closed.address;
    closed.close();
    const loopback = await standInSource('127.0.0.1', { key: newKey(), answer: () => null });
    sources.push(loopback);
    const loopbackPort = loopback.address.split(':').pop();
    const faraway = [...FARAWAY, loopback.address, `localhost:${loopbackPort}`];
    const stops = {
        ...Object.fromEntries(faraway.map((far) => [`faraway ${far}`, { session: cloud.list(ACCOUNTS.main, { source: 'dev', addresses: [far] }) }])),
        ...Object.fromEntries(await Promise.all(UNSHOWN.map(async (name, index) => [`unshown ${index}`, await listedSource(address, { project: { id: newId(), name } }, asPreview())]))),
        nameless: await listedSource(address, { project: { id: newId(), name: '' } }, asPreview()),
        newer: await listedSource(address, { protocol: 2 }, asPreview()),
        older: await listedSource(address, {}, asPreview({ protocol: 0 }, { update: 'pnpm up crossbind' })),
        other: await listedSource(address, {}, asPreview({}, { account: ACCOUNTS.other })),
        forged: await listedSource(address, {}, asPreview({ key: newKey() })),
        unread: await listedSource(address, {}, asPreview({ sent: 'no+base64url' })),
        none: await listedSource(address, {}, () => null),
    };
    const at = (stop) => stops[stop].session.addresses[0];
    const nameless = 'crossbind cloud lists this preview with a name crossbind shows on no dialog';
    const words = {
        ...Object.fromEntries(faraway.map((far) => [`faraway ${far}`, `crossbind opens a preview at a local address alone, and crossbind cloud lists this one at ${far}.`])),
        ...Object.fromEntries(UNSHOWN.map((name, index) => [`unshown ${index}`, nameless])),
        nameless,
        newer: "this project's crossbind is newer than this app (protocol 2, up to 1): update the crossbind app",
        older: "this project's crossbind is older than this app takes (protocol 0, from 1): update crossbind in the project: pnpm up crossbind",
        other: `crossbind app preview on ${at('other')} runs as other-e2e, and this app is signed in as made-up-e2e: sign in to the same account on both.`,
        forged: `the server at ${at('forged')} could not prove it is the preview crossbind cloud lists: is crossbind app preview running there?`,
        unread: `the server at ${at('unread')} sent a session this app cannot read: run crossbind app preview again`,
        none: `${at('none')} is no crossbind preview: run crossbind app preview in the project`,
    };
    const unreachable = cloud.list(ACCOUNTS.main, { source: 'dev', addresses: [unreachableAt] });
    return {
        stops, words, unreachable, loopback,
    };
}

// A page of the project's steps alone, as a second project's and as a snapshot made without a web build.
const STEPS_PAGE = '<!doctype html><meta charset="utf-8"><title>e2e project</title><script type="module">'
    + "const api = await import('/__crossbind/app.js'); const { runSteps } = await import('/project-steps.js'); runSteps(api.invoke, api);</script>";
const stepsModule = () => readFileSync(join(fixture, 'src', 'project-steps.js'), 'utf8');

// The files of a page of the project's steps alone: its first page, three more of the same origin, one of which would
// hold Back, and a video.
const stepsFiles = () => ({
    'index.html': STEPS_PAGE,
    'first.html': STEPS_PAGE,
    'second.html': STEPS_PAGE,
    'holds-back.html': STEPS_PAGE,
    'project-steps.js': stepsModule(),
    'inline.mp4': readFileSync(join(repository, 'e2e', 'desktop-app', 'public', 'inline.mp4')),
});

// A project of this name, served by a server of the run's own, whose page takes the project's steps alone, with these
// files of its own beside them: at its origin's name and URL, with what its source was asked.
async function stepsProject(address, projectName, extra = {}) {
    const files = Object.fromEntries(Object.entries({ ...stepsFiles(), ...extra }).map(([path, body]) => [`/${path}`, body]));
    const { session, source } = await listedSource(address, { project: { id: newId(), name: projectName } }, asPreview(), files);
    const origin = originName(ACCOUNTS.main, session.project.id);
    return {
        session, origin, url: originUrl(origin), asked: source.asked,
    };
}

// A snapshot of a project of this name, of the same steps page, which the stand-in's snapshot host serves.
function stepsSnapshot(projectName, extra = {}) {
    const session = cloud.snapshot(ACCOUNTS.main, { id: newId(), name: projectName }, { ...stepsFiles(), ...extra });
    const origin = originName(ACCOUNTS.main, session.project.id);
    return { session, origin, url: originUrl(origin) };
}

// A second project, served by a server of the run's own, whose /elsewhere redirects to another host and /odd answers a
// status no webview takes.
function secondProject(address) {
    const files = {
        '/index.html': STEPS_PAGE, '/project-steps.js': stepsModule(), '/elsewhere': { status: 302, location: 'http://127.0.0.1:9/elsewhere' }, '/odd': { status: 600 },
    };
    return listedSource(address, { project: { id: newId(), name: 'e2e second project' } }, asPreview(), files);
}

// The snapshot of the dev session's project: on Linux crossbind app preview --cloud uploads e2e/app-preview's web
// build; elsewhere the run uploads a page of the project's steps with crossbind's own upload, which --cloud calls once
// its build is made. Either is a snapshot of the dev session's project, of its one origin.
async function snapshotOf(dev) {
    if (!isWebBuilt) {
        const dir = mkdtempSync(join(tmpdir(), 'crossbind-e2e-snapshot-'));
        made.push(dir);
        writeFileSync(join(dir, 'index.html'), STEPS_PAGE);
        writeFileSync(join(dir, 'project-steps.js'), stepsModule());
        writeFileSync(join(dir, 'range.bin'), readFileSync(join(fixture, 'public', 'range.bin')));
        const { uploadSnapshot: upload } = await import('crossbind/src/actions/cloudCommands.js');
        await upload({
            url: CLOUD.cloud, token: CLI_TOKEN, project: dev.project, protocol: 1, dir,
        });
    }
    const snapshot = cloud.snapshotOf(ACCOUNTS.main);
    expect(snapshot?.project.id === dev.project.id, `the snapshot is of ${JSON.stringify(snapshot?.project)}, not of the dev session's ${JSON.stringify(dev.project)}`);
    return snapshot;
}

// 1, the sign-in: the run approves each code for an account and a number, which the page types; a wrong one ends the
// code with its words and no token.
async function signIn(account, typed) {
    cloud.approve(account, NUMBER);
    const { messages, signedIn, after } = await valueOf('the sign-in', { do: 'signIn', number: typed });
    expect(messages[0]?.code === 'NPCC-CNQN' && messages[0]?.page === `${CLOUD.cloud}/device` && messages.some((message) => message.number === true),
        `the sign-in's messages were ${JSON.stringify(messages)}`);
    return { signedIn, after };
}

// 3, the stops: each check that stops says why, serves no origin and leaves nothing to open.
async function checkStops(stoppers) {
    const said = {};
    for (const [stop, { session }] of Object.entries(stoppers.stops)) {
        const { checked, served, opened: open } = await valueOf(`the check of ${stop}`, { do: 'refuses', session: session.id, origin: originName(ACCOUNTS.main, session.project.id) });
        expect(checked.error?.startsWith(stoppers.words[stop]), `the check of ${stop} said ${checked.error ?? JSON.stringify(checked.value)}, not "${stoppers.words[stop]}"`);
        expect(served === false, `the check of ${stop} left its origin served`);
        expect(open.error === WORDS.checkFirst, `${stop} opened after its check stopped: ${JSON.stringify(open)}`);
        const table = stop.split(' ')[0];
        if (table === 'faraway' || table === 'unshown') said[table] = (said[table] ?? 0) + 1;
        else said[stop] = checked.error;
    }
    // Before any connection: the stops of a protocol, of the names and of the loopback ask their sources nothing.
    const silent = [stoppers.stops.newer.source, ...UNSHOWN.map((name, index) => stoppers.stops[`unshown ${index}`].source), stoppers.loopback];
    expect(silent.every((source) => source.asked.length === 0), `a source a check stops before was asked: ${JSON.stringify(silent.map((source) => source.asked))}`);
    // No source that stops is sent the gate's token: the others were asked for the session's check alone, with none.
    for (const [stop, { source }] of Object.entries(stoppers.stops)) {
        const odd = (source?.asked ?? []).filter(({ path, gate }) => path !== '/__crossbind/session' || gate !== undefined);
        expect(odd.length === 0, `the source of ${stop}, which stops, was asked ${JSON.stringify(odd)}`);
    }
    const { messages, checked } = await valueOf('the check of a source not reached', { do: 'unreachable', session: stoppers.unreachable.id });
    const on = stoppers.unreachable.addresses[0];
    if (isApple) {
        expect(messages[0]?.waiting?.startsWith(`crossbind cannot reach ${on} yet. Allow crossbind on the local network`), `a source not reached said ${JSON.stringify(messages)}`);
    } else {
        const where = isPhone ? 'device' : 'computer';
        expect(checked.error?.startsWith(`crossbind cannot reach ${on}: `) && checked.error.endsWith(`is this ${where} on its network?`),
            `a source not reached said ${JSON.stringify(checked)}`);
    }
    said.unreachable = messages[0]?.waiting ?? checked.error;
    return said;
}

// A promise's value, else the run's failure once ms passed.
function within(promise, ms, what) {
    return Promise.race([promise, new Promise((done, fail) => { setTimeout(() => fail(new Error(`${what} did not come in ${ms / 1000} s`)), ms).unref(); })]);
}

// A check that lands after a sign-out opens nothing: its source holds its answer until the page signed out, which the
// page does once the source has the check. The main account then signs in again.
async function checkAcrossSignOut(address) {
    let reached;
    let release;
    const isReached = new Promise((done) => { reached = done; });
    const isReleased = new Promise((done) => { release = done; });
    const { session } = await listedSource(address, {}, async (listed, challenge) => {
        reached();
        await isReleased;
        return asPreview()(listed, challenge);
    });
    const origin = originName(ACCOUNTS.main, session.project.id);
    const report = app({ do: 'checkAcrossSignOut', session: session.id, origin });
    await within(isReached, LINE_MS, "the check's request at its source");
    const signedOut = await app({ do: 'go' });
    expect(signedOut.value?.revoked === true, `the sign-out during a check was ${JSON.stringify(signedOut)}`);
    release();
    const { value, error } = await report;
    expect(error === undefined, `the check across a sign-out: ${error}`);
    expect(value.opened.error === WORDS.checkFirst && value.served === false, `a check that ended after a sign-out opened ${JSON.stringify(value)}`);
    await signIn(ACCOUNTS.main, NUMBER);
    return value.opened.error;
}

// Phase 2's checks of a previewed page, now opened by the app: its first lines in the preview's terminal, the device
// asking the dev server for nothing its app answers itself.
async function checkLoad(from) {
    const loaded = await terminal.waitFor(/PREVIEW (load|ERR)/, LOAD_MS, "the previewed page's first line", from);
    expect(!loaded.text.includes('PREVIEW ERR'), `the previewed page did not load: ${loaded.text}`);
    const load = jsonOf(loaded, 'PREVIEW load ');
    expect(load.platform === devicePlatform && load.device === devicePlatform, `the page reads the platform ${load.platform}, and device.platform ${load.device}, on ${devicePlatform}`);
    expect(load.secure === true, `the previewed page is no secure context: ${loaded.text}`);
    const pathsLine = await terminal.waitFor(/PREVIEW (paths|failure) /, LINE_MS, "the page's app.paths()", loaded.index);
    const paths = jsonOf(pathsLine, 'PREVIEW paths ');
    expect(paths.includes(previewRefusal('app.paths')), `the page's app.paths() got ${paths}`);
    const dialog = jsonOf(await terminal.waitFor(/PREVIEW dialog /, LINE_MS, "the page's dialog", loaded.index), 'PREVIEW dialog ');
    expect(dialog.dialog === 'shown' && dialog.answer.startsWith('AbortError'), `dialog.message did not wait for its user until cancelled: ${JSON.stringify(dialog)}`);
    const asked = terminal.lines.filter((line) => line.text.includes('asked this dev server for /__crossbind/app.js'));
    expect(asked.length === 0, `the device asked the dev server for /__crossbind/app.js ${asked.length} times`);
    return { load, paths, dialog };
}

// An edit of the module the page accepts comes in place: its line with the new value, the page's state kept.
async function checkJsEdit(load) {
    const file = join(fixture, 'src', 'preview-greeting.js');
    keep(file);
    const greeting = `second-${Date.now()}`;
    const from = terminal.lines.length;
    const saved = performance.now();
    writeFileSync(file, `export const greeting = '${greeting}';\n`);
    const line = await terminal.waitFor(new RegExp(`PREVIEW hot .*"greeting":"${greeting}"`), HOT_MS, 'the edited module in place', from);
    const hot = jsonOf(line, 'PREVIEW hot ');
    expect(hot.isReload === load.isReload && hot.ticks > 0, `the edit reloaded the page: ${JSON.stringify(hot)}`);
    putBack();
    return Math.round(line.at - saved);
}

// Another machine on the network gets nothing of the project's but the session, whose ranges of protocols the terminal
// names once each; the editor's path is asked only once the gate refused the files.
async function checkOtherMachine(source, token) {
    const file = join(fixture, 'package.json').replaceAll('\\', '/');
    const files = await statusOf(`${source}/@fs/${file.replace(/^\//, '')}`);
    expect(files === 403, `/@fs/ of the project's package.json got ${files} without the gate's token`);
    const early = await statusOf(`${source}/__e2e/early`);
    expect(early === 403, `/__e2e/early, which a plugin before crossbind's answers, got ${early} without the gate's token`);
    const earlyWithToken = await (await fetch(`${source}/__e2e/early`, { headers: { 'x-crossbind-preview': token }, signal: AbortSignal.timeout(ASKED_MS) })).text();
    expect(earlyWithToken === 'early', `/__e2e/early with the gate's token got ${earlyWithToken}`);
    const editor = await statusOf(`${source}/__open-in-editor?file=${encodeURIComponent(file)}`);
    expect(editor === 403, `/__open-in-editor got ${editor} without the gate's token`);
    const sockets = [await socketOf(source), await socketOf(source, source)];
    expect(sockets.every((socket) => socket.startsWith('refused')), `a socket without Vite's token: ${sockets.join(', ')}`);
    const challenge = randomBytes(32).toString('base64url');
    const session = await statusOf(`${source}/__crossbind/session?challenge=${challenge}`);
    const odd = await statusOf(`${source}/__crossbind/session?challenge=${'A'.repeat(42)}.`);
    expect(session === 200 && odd === 400, `the session answered ${session}, and a challenge of another form ${odd}`);
    const protocolLines = [
        ['2-3', /takes protocols 2–3 asked for this preview, which speaks 1: update crossbind in the project/],
        ['0-0', /takes protocols 0–0 asked for this preview, which speaks 1: update the crossbind app on the device/],
    ];
    for (const [range, line] of protocolLines) {
        await statusOf(`${source}/__crossbind/session?challenge=${challenge}&protocols=${range}`);
        await terminal.waitFor(line, LINE_MS, `the terminal's line of an app of protocols ${range}`);
    }
    return {
        files, early, earlyWithToken, editor, sockets, session, odd,
    };
}

// The fixture's dependency, as Vite's optimizer bundled it, takes crossbind/app from the module of the project's side,
// with no copy of its own.
async function checkOptimizedDependency(source, token) {
    const asked = (path) => fetch(`${source}${path}`, { headers: { 'x-crossbind-preview': token } }).then((answer) => answer.text());
    const main = await asked('/src/main.js');
    const dependency = main.match(/"(\/node_modules\/\.vite\/deps\/@crossbind_extension-clipboard\.js[^"]*)"/)?.[1];
    expect(dependency, `the page's main.js imports no optimized @crossbind/extension-clipboard: ${main.slice(0, 400)}`);
    const code = await asked(dependency);
    expect(code.includes('/@id/__x00__crossbind-preview:app') && !/hostOf|deviceOf|globalThis\.Crossbind/.test(code), `the optimized dependency holds its own crossbind/app: ${code.slice(0, 400)}`);
    return dependency;
}

// Opens a session from the app's page and waits for its page, which says so as it takes the run's steps.
async function openSession(session, origin) {
    const from = endpoint.notes.length;
    const loaded = endpoint.waitForNote((note) => note.role === 'project' && note.loaded, LOAD_MS, "the project's page");
    const { sheet, url } = await valueOf(`the open of ${session.id}`, { do: 'open', session: session.id });
    expect(url === originUrl(origin), `the session opened at ${url}, not at its account's and project's ${originUrl(origin)}`);
    const shown = await loaded.catch(async (error) => {
        throw new Error(isWindows ? `${error.message}: ${JSON.stringify(await shownInstead(origin, from))}` : error.message);
    });
    expect(shown.loaded === url.replace(/\/$/, ''), `the project's page loaded at ${shown.loaded}, not at ${url}`);
    return sheet;
}

// Where a project's page did not come on Windows: what WebView2 shows, by its DevTools, as no page of the fixture's
// there reports it, and each request for the origin's first page it handed the host since the open, with what asked it.
async function shownInstead(origin, from) {
    const read = async (what) => {
        try {
            return await what();
        } catch (error) {
            return { devTools: error.message };
        }
    };
    const targets = await read(async () => (await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`, { signal: AbortSignal.timeout(ASKED_MS) })).json())
        .map(({ type, url, title }) => ({ type, url, title })));
    const page = await read(() => inPage(`({ url: location.href, title: document.title, text: (document.body?.innerText ?? '').slice(0, ${SHOWN_CHARACTERS}),
        controller: navigator.serviceWorker?.controller?.scriptURL ?? null })`));
    const handed = endpoint.notes.slice(from).filter((note) => note.event === 'handed' && note.url.startsWith(originUrl(origin)));
    return { targets, page, handed };
}

// The WebView2 Runtime the app runs on, as its DevTools name it.
async function webView2Version() {
    return (await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/version`, { signal: AbortSignal.timeout(ASKED_MS) })).json()).Browser;
}

// Ends the preview from the project's page, a message dialog of its own up or none, and waits for the app's page.
async function closePreview(withDialog = false) {
    const back = endpoint.waitForNote((note) => note.role === 'app' && note.loaded, LOAD_MS, "the app's page after the preview");
    const { value } = await project({ do: 'close', withDialog });
    if (withDialog) expect(value.dialog === 'shown', `the project's dialog did not wait for its user: ${JSON.stringify(value)}`);
    return back;
}

async function storageOf(role, mark) {
    const answered = await endpoint.step(role, {
        do: 'storage', run, marks: ['first', 'second'], mark,
    });
    expect(answered.error === undefined, `the ${role}'s storage: ${answered.error}`);
    return answered.value;
}
const holds = (storage, mark) => storage.seen[mark].database && storage.seen[mark].file !== false;
const holdsNone = (storage, mark) => !storage.seen[mark].database && storage.seen[mark].file !== true;

// The files below a folder, by their paths in it, a package's own packages left unopened: their links may lead back to
// the folder itself.
const filesBelow = (folder, under = '') => readdirSync(join(folder, under))
    .filter((name) => name !== 'node_modules')
    .flatMap((name) => {
        const file = join(under, name);
        return statSync(join(folder, file), { throwIfNoEntry: false })?.isDirectory() ? filesBelow(folder, file) : [file];
    });

// Every function the app may register, as the names its sources write: each string literal shaped <prefix>.<member> in
// each C, C++ and Objective-C++ source of the host and of each extension the app has, crossbind's own and those its
// config lists, so that one a helper or a table registers is among them. A registration whose name is neither a
// literal nor a plain name, which this reading would miss, stops the run.
function functionNames() {
    const host = dirname(createRequire(join(root, 'package.json')).resolve('@crossbind/core-app-host/package.json'));
    const fromHost = createRequire(join(host, 'package.json'));
    const own = Object.keys(JSON.parse(readFileSync(join(host, 'package.json'), 'utf8')).dependencies ?? {})
        .filter((name) => name.startsWith('@crossbind/extension-'))
        .map((name) => dirname(fromHost.resolve(`${name}/crossbind.extension.js`)));
    const names = new Set();
    for (const folder of [join(host, 'cpp'), ...own, ...config.extensions.map((extension) => extension.root)]) {
        for (const file of filesBelow(folder)) {
            if (!SOURCE.test(file)) continue;
            const text = readFileSync(join(folder, file), 'utf8');
            for (const [, name] of text.matchAll(NAMED)) names.add(name);
            for (const [, argument] of text.matchAll(REGISTERED)) {
                expect(/^("[^"]*"|[A-Za-z_]\w*)$/.test(argument), `${join(folder, file)} registers a function named ${argument}, which the run does not read`);
            }
        }
    }
    return [...names].filter((name) => !name.startsWith(HOOKS)).sort();
}

// Rule 1 of the roles: the project's page calls every function the app may register itself, past its crossbind/app;
// each it reaches answers as the design's 6.1 says, every other one refuses it with the host's words, and a name the
// app has no function of on this platform says so.
async function checkFunctions() {
    const open = { ...OPEN, ...(isPhone ? OPEN_ON_A_PHONE : {}) };
    const names = functionNames();
    const { value: answers, error } = await project({ do: 'sweep', names, text: isPhone ? CLIPBOARD_TEXT : null });
    expect(error === undefined, `the project's calls of the app's functions: ${error}`);
    const counted = { refused: 0, open: 0, absent: 0 };
    for (const name of names) {
        const answer = answers[name];
        if (answer === ABSENT(name)) {
            expect(!Object.hasOwn(open, name), `the app has no ${name}, which a project's page reaches`);
            counted.absent += 1;
        } else if (Object.hasOwn(open, name)) {
            expect(open[name](answer), `a project's page called ${name} and got ${answer}`);
            counted.open += 1;
        } else {
            expect(answer?.startsWith(`Error: crossbind: a page of the role project does not reach ${name}, which pages of the role`), `a project's page called ${name} and got ${answer}`);
            counted.refused += 1;
        }
    }
    return { found: names.length, ...counted };
}

// What the project's page hears: an event sent to every page of the role app reaches it not, one sent to its own page
// does.
async function checkEvents() {
    const { value: heard } = await project({ do: 'heard', ms: LINE_MS });
    expect(JSON.stringify(heard) === '["own"]', `the project's page heard ${JSON.stringify(heard)}`);
    return heard;
}

// A path the app's own page may reach, as one its user picked, is no project's: the shell's file functions refuse its
// page by its role.
const PICKED = join(tmpdir(), `crossbind-e2e-picked-${run}.txt`);
async function checkPicked() {
    const { value: answers } = await project({ do: 'picked', path: PICKED });
    for (const [name, answer] of Object.entries(answers)) expect(answer.includes(ROLE_REFUSAL(name)), `a project's page called ${name} for a path the app picked and got ${answer}`);
    return Object.keys(answers).length;
}

// DevTools' answer to commands given the page WebView2 shows, the last one's.
async function devTools(commands) {
    const signal = AbortSignal.timeout(ASKED_MS);
    const targets = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`, { signal })).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('WebView2 lists no page');
    const sent = [{ method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } }, ...commands];
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    try {
        const { error, result } = await new Promise((done, fail) => {
            signal.addEventListener('abort', () => fail(new Error('DevTools did not answer in time')));
            socket.onerror = () => fail(new Error('DevTools refused the connection'));
            socket.onopen = () => sent.forEach((command, index) => socket.send(JSON.stringify({ id: index + 1, ...command })));
            socket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.id === sent.length) done(message);
            };
        });
        if (error || result?.exceptionDetails) throw new Error(JSON.stringify(error ?? result.exceptionDetails));
        return result;
    } finally {
        socket.close();
    }
}

const inPage = async (expression, ...before) => (await devTools([...before, {
    method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true },
}])).result.value;

// What the page's clipboard read gives on its user's click, which DevTools gives with the mouse on a button at the page's
// corner: Windows hands such a read to page-permissions, as no other platform does.
async function clickedRead() {
    const mouse = (type) => ({ method: 'Input.dispatchMouseEvent', params: { type, x: 20, y: 20, button: 'left', clickCount: 1 } });
    await inPage(`void (globalThis.crossbindClicked = new Promise((resolve) => {
        const button = document.body.appendChild(document.createElement('button'));
        button.style.cssText = 'position: fixed; left: 0; top: 0; width: 40px; height: 40px; z-index: 2147483647';
        button.onclick = () => { resolve(navigator.clipboard.readText().then(() => 'read', (error) => error.name)); button.remove(); };
        setTimeout(() => resolve('the click missed its button'), ${CLICK_MS});
    }))`);
    return inPage('globalThis.crossbindClicked', mouse('mousePressed'), mouse('mouseReleased'));
}

// A click on the page as its user's, on which a step of its armed what the click asks: on Apple's platforms a script
// the hooks run as WebKit takes its user's tap, on Linux xdotool's click in the app's window, on Windows DevTools' mouse.
async function clickPage(role) {
    if (isApple) {
        await endpoint.step(role, { do: 'gesture', script: 'e2eFullScreen(); undefined' });
        return;
    }
    if (isWindows) {
        const mouse = (type) => ({ method: 'Input.dispatchMouseEvent', params: { type, x: 120, y: 120, button: 'left', clickCount: 1 } });
        await devTools([mouse('mousePressed'), mouse('mouseReleased')]);
        return;
    }
    const windows = spawnSync('xdotool', ['search', '--onlyvisible', '--pid', String(opened.child.pid)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    const window = windows.at(-1);
    expect(window, "xdotool found no window of the app's to click");
    spawnSync('xdotool', ['windowactivate', '--sync', window]);
    spawnSync('xdotool', ['mousemove', '--window', window, '200', '240', 'click', '1']);
}

// The app gone behind another and in front again, where a run can make its return to the front: whether it did.
async function returnToFront() {
    if (!platform && process.platform === 'darwin') {
        const { value } = await project({ do: 'cycleActive' });
        return value?.wasActive === true && value.isActive === true;
    }
    if (platform === 'ios') {
        const app = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(builtForDevice, 'Info.plist')], { encoding: 'utf8' }).trim();
        execFileSync('xcrun', ['simctl', 'launch', 'booted', 'com.apple.Preferences']);
        await new Promise((done) => { setTimeout(done, 2000); });
        execFileSync('xcrun', ['simctl', 'launch', 'booted', app]);
        return true;
    }
    if (platform === 'android') {
        const { adbPath } = await import('crossbind/src/actions/androidDevice.js');
        execFileSync(adbPath(), ['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
        await new Promise((done) => { setTimeout(done, 2000); });
        execFileSync(adbPath(), ['shell', 'monkey', '-p', applicationIdOf(builtForDevice), '-c', 'android.intent.category.LAUNCHER', '1']);
        return true;
    }
    return false;
}

// 2, 4 and 5 for the first project: its page's lines, its JavaScript in place, every function the app may register
// called by it, the events it hears, a path the app picked, the clipboard's read on its user's click on Windows, and its
// storage.
async function checkProject(terminalFrom) {
    const load = await checkLoad(terminalFrom);
    const js = await checkJsEdit(load.load);
    const functions = await checkFunctions();
    const events = await checkEvents();
    const picked = await checkPicked();
    const clipboard = isWindows ? await clickedRead() : 'no request a run makes';
    expect(!isWindows || clipboard === 'NotAllowedError', `a project's page read the clipboard on its user's click: ${clipboard}`);
    // 6.1's words, which the project's own import of crossbind/app gives: one of each kind it refuses.
    const { value: words } = await project({ do: 'throughModule', names: MODULE_REFUSED });
    for (const name of MODULE_REFUSED) expect(words[name] === `Error: ${previewRefusal(name)}`, `the project's ${name}() through its crossbind/app got ${words[name]}`);
    const first = await storageOf('project', 'first');
    expect(holdsNone(first, 'first') && holdsNone(first, 'second'), `the first project's storage held marks at its first open: ${JSON.stringify(first)}`);
    return {
        load, js, functions, events, picked, clipboard, words, storage: first,
    };
}

// 7, the snapshot: its page through the proxy, a ranged read of it, and a new key, which the proxy reads again, checks
// and takes.
async function checkSnapshot(snapshot) {
    const asked = { do: 'range', path: '/range.bin', asked: 'bytes=10-19' };
    const isRange = (answer) => answer.value?.status === 206 && answer.value.range === 'bytes 10-19/64' && answer.value.bytes.join() === '10,11,12,13,14,15,16,17,18,19';
    const first = await project(asked);
    expect(isRange(first), `a ranged read of the snapshot got ${JSON.stringify(first)}`);
    const before = cloud.calls.length;
    const oldGate = gateToken(snapshot.key);
    cloud.rekey(snapshot.id);
    const renewed = gateToken(snapshot.key);
    const second = await project(asked);
    expect(isRange(second), `a ranged read once the snapshot's key was made anew got ${JSON.stringify(second)}`);
    const after = cloud.calls.slice(before);
    const at = (test) => after.findIndex(test);
    const refused = at((call) => call.host === 'snapshots' && call.gate === oldGate && call.status === 403);
    const reread = at((call) => call.host === 'api' && call.call === `GET /v1/sessions/${snapshot.id}`);
    const checked = at((call) => call.host === 'snapshots' && call.call.includes('/__crossbind/session?') && call.gate === renewed);
    const retried = at((call) => call.host === 'snapshots' && call.call.endsWith('/range.bin') && call.gate === renewed && call.status === 206);
    expect(refused >= 0 && reread > refused && checked > reread && retried > checked,
        `the proxy did not read the session again, check it and take the new key in that order: ${JSON.stringify(after.map(({ call, status }) => `${call} ${status ?? ''}`))}`);
    return { first: first.value.status, renewed: second.value.status };
}

// 1 to 3: signed out, a wrong number, an account whose list is empty and where the link's session is not, its sign-out,
// then the account of the preview, whose list holds it with the snapshot and the sessions that stop.
async function checkAccounts(dev, snapshot) {
    const out = await valueOf('the list signed out', { do: 'sessions' });
    cloud.pageAt('https://crossbind-e2e.invalid/device');
    cloud.approve(ACCOUNTS.empty, NUMBER);
    const offPage = await valueOf('a sign-in whose page is off the cloud', { do: 'signIn', number: NUMBER });
    cloud.pageAt(null);
    expect(offPage.signedIn.error === 'crossbind cloud named a sign-in page off its own address: https://crossbind-e2e.invalid/device' && offPage.after.account === null,
        `a sign-in whose page is off the cloud answered ${JSON.stringify(offPage)}`);
    expect(out.account === null && out.message === WORDS.signedOut, `the list signed out was ${JSON.stringify(out)}`);
    expect(await errorOf('the link signed out', { do: 'check', session: dev.id }) === WORDS.signedOut, 'the link signed out did not ask for a sign-in');
    const wrong = await signIn(ACCOUNTS.empty, NUMBER - 1);
    expect(wrong.signedIn.error === WORDS.wrongNumber && wrong.after.account === null, `a wrong number signed in as ${JSON.stringify(wrong)}`);
    const empty = await signIn(ACCOUNTS.empty, NUMBER);
    expect(empty.signedIn.value?.account?.name === ACCOUNTS.empty.name, `the sign-in gave ${JSON.stringify(empty)}`);
    const emptyList = await valueOf('the empty list', { do: 'sessions' });
    expect(emptyList.sessions.length === 0 && emptyList.message === WORDS.empty(ACCOUNTS.empty.name), `the empty list was ${JSON.stringify(emptyList)}`);
    expect(await errorOf("another account's link", { do: 'check', session: dev.id }) === WORDS.notListed(ACCOUNTS.empty.name), "another account's session opened");
    const signedOut = await valueOf('the sign-out', { do: 'signOut' });
    expect(signedOut.revoked === true && cloud.calls.some((call) => call.call === 'DELETE /v1/token'), `the sign-out was ${JSON.stringify(signedOut)}`);
    const main = await signIn(ACCOUNTS.main, NUMBER);
    expect(main.signedIn.value?.account?.name === ACCOUNTS.main.name, `the sign-in gave ${JSON.stringify(main)}`);
    const { keyring } = main.signedIn.value;
    // One account at a time: a sign-in over the one signed in is refused before crossbind cloud hears of it.
    const authorizations = () => cloud.calls.filter((call) => call.call === 'POST /v1/device/authorize').length;
    const authorized = authorizations();
    const over = await valueOf('a sign-in over the account signed in', { do: 'signIn', number: NUMBER });
    expect(over.signedIn.error === WORDS.signedInAs(ACCOUNTS.main.name) && over.after.account?.id === ACCOUNTS.main.id && authorizations() === authorized,
        `a sign-in over the account signed in answered ${JSON.stringify(over)}`);
    // An id that reaches a URL's path is checked for its form first: none of these asks crossbind cloud.
    const before = cloud.calls.length;
    for (const odd of ['../account', `${dev.id.slice(1)}/`, `${dev.id}A`]) {
        expect(await errorOf(`the check of ${odd}`, { do: 'check', session: odd }) === NO_PREVIEW, `the check of ${odd} went on`);
    }
    expect(cloud.calls.length === before, `an id out of its form reached crossbind cloud: ${JSON.stringify(cloud.calls.slice(before))}`);
    expect(keyring || devicePlatform === 'linux', `the system's store did not keep the token on ${devicePlatform}`);
    const listed = await valueOf('the list', { do: 'sessions' });
    expect(listed.message === null && listed.sessions.some((session) => session.id === dev.id && session.on === dev.addresses[0])
        && listed.sessions.some((session) => session.id === snapshot.id && session.version === 1 && session.opened === null)
        && listed.sessions.every((session) => !('key' in session)), `the list was ${JSON.stringify(listed)}`);
    return keyring;
}

// The token's other calls: a compile, a snapshot's removal, and an id the list does not hold, refused before any call.
async function checkTokenCalls(snapshot) {
    const appToken = [...cloud.calls].reverse().find((call) => call.call === 'GET /v1/sessions')?.authorization;
    const compiled = await valueOf('the compile', { do: 'compile', files: { 'main.js': 'console.log(1);' }, packages: [] });
    const compileCall = cloud.calls.find((call) => call.call === 'POST /playground/compile');
    expect(JSON.stringify(compiled) === JSON.stringify({ status: 200, ...COMPILED }) && compileCall?.authorization === appToken, `the compile answered ${JSON.stringify(compiled)}`);
    const before = cloud.calls.length;
    expect((await errorOf('the removal of an id off the list', { do: 'remove', session: newId() })).includes('removes a snapshot of the list'), 'an id off the list was removed');
    expect(cloud.calls.slice(before).every((call) => !call.call.startsWith('DELETE /v1/snapshots')), 'the removal of an id off the list asked crossbind cloud');
    await valueOf("the snapshot's removal", { do: 'remove', session: snapshot.id });
    const removed = await valueOf('the list after the removal', { do: 'sessions' });
    expect(!removed.sessions.some((session) => session.id === snapshot.id) && cloud.calls.some((call) => call.call === `DELETE /v1/snapshots/${snapshot.id}`), `the snapshot stayed: ${JSON.stringify(removed)}`);
}

// The system's store: a start again keeps the sign-in where the store took the token, and the account's deletion signs
// out, which a start again keeps.
async function checkStore(keyring) {
    await relaunch();
    if (keyring) {
        // The store is read before a sign-in starts: the first call after a start, a sign-in, meets the account kept.
        const first = await valueOf('a sign-in as the app starts again', { do: 'signIn', number: NUMBER });
        expect(first.signedIn.error === WORDS.signedInAs(ACCOUNTS.main.name), `a sign-in as the app started again answered ${JSON.stringify(first)}`);
    }
    const held = await valueOf('the account after a start again', { do: 'account' });
    expect(keyring ? held.account?.id === ACCOUNTS.main.id : held.account === null, `after a start again the app was signed in as ${JSON.stringify(held)}`);
    if (!keyring) await signIn(ACCOUNTS.main, NUMBER);
    if (platform === 'android') {
        // A key of the Keystore's that no longer seals is made anew: the next sign-in keeps its token.
        await valueOf("the preview's key of the Keystore broken", { do: 'breakKey' });
        await valueOf('the sign-out before a sign-in with a broken key', { do: 'signOut' });
        const again = await signIn(ACCOUNTS.main, NUMBER);
        expect(again.signedIn.value?.keyring === true, `a sign-in with a key that no longer seals answered ${JSON.stringify(again)}`);
    }
    const deleted = await valueOf("the account's deletion", { do: 'deleteAccount' });
    expect(deleted.message === `${ACCOUNTS.main.name} is deleted, with its tokens, sessions and snapshots.` && cloud.calls.some((call) => call.call === 'DELETE /v1/account'), `the deletion was ${JSON.stringify(deleted)}`);
    await relaunch();
    const gone = await valueOf('the account after the deletion and a start again', { do: 'account' });
    expect(gone.account === null, `after the deletion the app was signed in as ${JSON.stringify(gone)}`);
}

// Part 14's 1: nothing a page got, the app printed or the preview's terminal printed holds a token, a session's key or a
// gate's token, of all the stand-in cloud gave, took or made.
function checkSecrets() {
    const said = [terminal.text(), device.text(), JSON.stringify(endpoint.reports)].join('\n');
    const secrets = cloud.secrets();
    const held = secrets.filter((secret) => said.includes(secret));
    expect(held.length === 0, `what the pages got or the app and the terminal printed holds ${held.length} of the ${secrets.length} tokens, keys and gates' tokens`);
    return secrets.length;
}

async function flow() {
    const address = await defaultRouteAddress();
    expect(address, 'this machine has no address on a network, at which a device reaches a dev server');
    cloud = await standInCloud({ apiPort: CLOUD_PORT, snapshotsPort: SNAPSHOTS_PORT });
    endpoint = await serveEndpoint(ENDPOINT_PORT);
    // A token a run before left in this Mac's file-based keychain, which a rebuilt app would ask its user for.
    if (!platform && process.platform === 'darwin') spawnSync('security', ['delete-generic-password', '-s', `dev.crossbind.${name}.cloud`, '-a', CLOUD.cloud]);
    if (isWebBuilt) {
        const uploading = terminal.lines.length;
        await uploadSnapshot();
        // Its last lines may come after its exit.
        await terminal.waitFor(/uploaded as a snapshot, version 1,/, LINE_MS, 'crossbind app preview --cloud\'s line of version 1', uploading);
    }
    const started = terminal.lines.length;
    preview = startPreview([]);
    preview.once('exit', (code) => setTimeout(() => finish(`crossbind app preview exited with ${code}`), SETTLE_MS));
    await terminal.waitFor(PREVIEW_LISTED, START_MS, "crossbind app preview's session on the account's list", started);
    const printed = terminal.lines.slice(started).map((line) => line.text).join('\n');
    expect(/^ {2}on \S+:\d+/m.test(printed) && !/^\s*open: /m.test(printed), `crossbind app preview printed:\n${printed}`);
    const dev = [...cloud.sessions.values()].find((session) => session.source === 'dev' && session.project.name === 'crossbind-e2e-app-preview');
    expect(dev, `crossbind app preview listed ${JSON.stringify([...cloud.sessions.values()].map((session) => [session.source, session.project?.name]))}`);
    const snapshot = await snapshotOf(dev);
    const devOrigin = originName(ACCOUNTS.main, dev.project.id);
    const stoppers = await stoppingSessions(address);
    const second = await secondProject(address);

    // 2, a link at the app's start: on the desktop the system's argument, on a phone handed to the app as it runs.
    const loaded = await launch(isPhone ? [] : [linkOf(dev.id), linkOf(NO_SESSION)]);
    let { links } = loaded;
    if (isPhone) {
        links = [];
        for (const session of [dev.id, NO_SESSION]) {
            const linked = endpoint.waitForNote((note) => note.event === 'link', LINE_MS, 'a link handed to the app');
            await handLink(session);
            links.push((await linked).link);
        }
    }
    expect(JSON.stringify(links) === JSON.stringify([{ session: dev.id }, { message: NO_PREVIEW }]), `the app's page got the links ${JSON.stringify(links)}`);
    // Each Windows runner's WebView2 Runtime, which its image brings.
    if (isWindows) console.log(`PROJECTS WEBVIEW2 ${await webView2Version()}`);
    // A token a run before left on the device.
    if ((await valueOf('the account at the start', { do: 'account' })).account) await valueOf('the sign-out of a run before', { do: 'signOut' });
    const keyring = await checkAccounts(dev, snapshot);
    const stops = await checkStops(stoppers);
    stops.acrossSignOut = await checkAcrossSignOut(address);

    // The app's own page reads the clipboard on its user's click, as with the host's page-permissions, where a run makes
    // that request.
    const ownClipboard = isWindows ? await clickedRead() : 'no request a run makes';
    expect(!isWindows || ownClipboard === 'read', `the app's own page could not read the clipboard on its user's click: ${ownClipboard}`);
    await valueOf("the app's own page's pick", { do: 'allow', path: PICKED });

    // 2 and 4: the link's session opened, phase 2's checks of its page and its storage; then closed with a dialog of the
    // project's up, after which the app's own dialog shows; the second project, and the first again.
    const terminalFrom = terminal.lines.length;
    const sheet = await openSession(dev, devOrigin);
    expect(sheet.project.name === 'crossbind-e2e-app-preview' && sheet.account.name === ACCOUNTS.main.name && sheet.on === dev.addresses[0], `the Open sheet read ${JSON.stringify(sheet)}`);
    const first = await checkProject(terminalFrom);
    await closePreview(true);
    const own = await valueOf("the app's own dialog", { do: 'dialog' });
    expect(own.first === 'shown' && /abort/i.test(own.then.error ?? ''), `the app's own dialog after the preview was ${JSON.stringify(own)}`);
    await openSession(second.session, originName(ACCOUNTS.main, second.session.project.id));
    const secondStorage = await storageOf('project', 'second');
    expect(holdsNone(secondStorage, 'first') && holdsNone(secondStorage, 'second'), `the second project saw ${JSON.stringify(secondStorage)}`);
    // A source that redirects elsewhere answers the page 502, the redirect unfollowed, as one whose status no webview
    // takes does, in the host's words.
    const elsewhere = await project({ do: 'fetched', path: '/elsewhere' });
    expect(elsewhere.value?.status === 502 && elsewhere.value.text === UNTAKEN(302), `a redirect of the source to another host gave the page ${JSON.stringify(elsewhere)}`);
    const odd = await project({ do: 'fetched', path: '/odd' });
    expect(odd.value?.status === 502 && odd.value.text === UNTAKEN(600), `a status of 600 from the source gave the page ${JSON.stringify(odd)}`);
    await closePreview();
    await openSession(dev, devOrigin);
    const again = await storageOf('project');
    expect(holds(again, 'first') && holdsNone(again, 'second'), `the first project, opened again, saw ${JSON.stringify(again)}`);
    await closePreview();
    const ownStorage = await storageOf('app');
    expect(holdsNone(ownStorage, 'first') && holdsNone(ownStorage, 'second'), `the app's own page saw ${JSON.stringify(ownStorage)}`);

    // 5, the consent: what a project's user is asked before its page uses the camera, the microphone or the location.
    const { adbPath } = await import('crossbind/src/actions/androidDevice.js');
    const consents = await checkConsents({
        platform: devicePlatform,
        endpoint,
        app,
        project,
        openSession,
        closePreview,
        inPage,
        device,
        second: { session: second.session, origin: originName(ACCOUNTS.main, second.session.project.id) },
        stepsProject: (projectName) => stepsProject(address, projectName),
        adb: adbPath,
        applicationId: () => applicationIdOf(builtForDevice),
        appPid: () => opened.child.pid,
        appTitle: config.app.name,
    });

    // 8: what shows that a preview is one, and what leaves it.
    const indicator = await checkIndicator({
        closePreview,
        appPid: () => opened.child.pid,
        clickPage,
        returnToFront,
        platform: devicePlatform,
        endpoint,
        app,
        openSession,
        stepsProject: (projectName) => stepsProject(address, projectName),
        stepsSnapshot,
        second: { session: second.session, origin: originName(ACCOUNTS.main, second.session.project.id) },
        cloud,
        heardOf,
        signIn: () => signIn(ACCOUNTS.main, NUMBER),
        inPage,
        adb: adbPath,
        applicationId: () => applicationIdOf(builtForDevice),
        appTitle: config.app.name,
        accountName: ACCOUNTS.main.name,
        signedOutWords: WORDS.signedOut,
    });
    // What the preview's menu changes of what is kept: Permissions.
    const permissions = await checkPermissions({
        platform: devicePlatform,
        endpoint,
        openSession,
        closePreview,
        stepsProject: (projectName) => stepsProject(address, projectName),
        device,
        adb: adbPath,
        applicationId: () => applicationIdOf(builtForDevice),
        appPid: () => opened.child.pid,
        appTitle: config.app.name,
    });
    // What the preview's menu and the app's page clear of what a project keeps, and what Settings calls.
    const clearing = await checkClearing({
        shownInstead,
        platform: devicePlatform,
        endpoint,
        app,
        openSession,
        closePreview,
        stepsProject: (projectName, extra) => stepsProject(address, projectName, extra),
        stepsSnapshot,
        cloud,
        signIn: () => signIn(ACCOUNTS.main, NUMBER),
        returnToFront,
        device,
        adb: adbPath,
        applicationId: () => applicationIdOf(builtForDevice),
        appPid: () => opened.child.pid,
        appTitle: config.app.name,
        accountName: ACCOUNTS.main.name,
    });
    // A file input's picker closes as its page goes, where the host shows it.
    const pickers = await checkPickers({
        platform: devicePlatform,
        endpoint,
        openSession,
        stepsProject: (projectName) => stepsProject(address, projectName),
        adb: adbPath,
        applicationId: () => applicationIdOf(builtForDevice),
    });

    // 7: the snapshot, at the project's one origin.
    const snapshotSheet = await openSession(snapshot, devOrigin);
    expect(snapshotSheet.source === 'snapshot' && snapshotSheet.version === 1 && snapshotSheet.opened === null, `the snapshot's Open sheet read ${JSON.stringify(snapshotSheet)}`);
    const ranges = await checkSnapshot(snapshot);
    await closePreview();
    const relisted = await valueOf('the list after the snapshot', { do: 'sessions' });
    expect(relisted.sessions.find((session) => session.id === snapshot.id)?.opened === 1, `the snapshot's version opened was not noted: ${JSON.stringify(relisted)}`);

    await checkTokenCalls(snapshot);
    await checkStore(keyring);

    const source = `http://${dev.addresses[0]}`;
    const other = await checkOtherMachine(source, gateToken(dev.key));
    const dependency = await checkOptimizedDependency(source, gateToken(dev.key));
    // An account's deletion takes the account out of the note of the projects opened.
    const deletedAccount = await checkDeletedAccount({
        platform: devicePlatform,
        endpoint,
        adb: adbPath,
        applicationId: () => applicationIdOf(builtForDevice),
        accountName: ACCOUNTS.main.name,
        otherAccount: ACCOUNTS.other,
        signIn: () => signIn(ACCOUNTS.main, NUMBER),
        openSession,
        closePreview,
        stepsProject: (projectName) => stepsProject(address, projectName),
    });
    const secrets = checkSecrets();
    console.log(`PROJECTS CHECKS ${JSON.stringify({
        platform: devicePlatform, keyring, stops, ownClipboard, first, consents, indicator, permissions, clearing, pickers, ranges, other, dependency, deletedAccount, secrets,
    })}`);
    console.log(`TIMING a JavaScript edit to the page: ${first.js} ms`);
    console.log(`ok: ${devicePlatform} projects of e2e/app-projects`);
}

setTimeout(() => finish('the run did not finish in time'), RUN_TIMEOUT_MS).unref();
flow().then(() => finish(), (error) => finish(error.message));

// The probe's origins, opened as the crossbind app will open a project's page: the conformance page serves them, opens
// the one of the role project in its window, which runs what follows there and comes back, and checks what the pages
// left with the probe, whose stage outlives each page. A project's page that fails says so as the suite would.
import { app as host, device, events, invoke } from 'crossbind/app';
import * as ownApi from 'crossbind/app';
import { initNative } from '@crossbind/conformance/native/confconstants.h';
import { REACH_PORT } from '../e2e/launch.mjs';
import { reportWebFeatures } from './web-features.js';

const PROJECT = 'e2e-project';
const OTHER = 'e2e-other';
const ENDED = 'e2e-ended';
const POSTED = 'e2e-posted';
const SLOW = 'e2e-slow';
const WAIT = 'e2e-wait';
const SOON = 'e2e-soon';
const FIRST = 'e2e-first';
const FRAME_PAGE = 'frame-probe.html';
const NO_ROLE_PAGE = 'no-role.html';
const PAGE_API_PAGE = 'page-api.html';
const WAIT_PAGE = 'page-wait.html';
const SOON_PAGE = 'page-soon.html';
const FIRST_PAGE = 'page-first.html';
// What arms the app's first page after page-first.html's end to go within the app at once, for the window's session.
const FIRST_ARMED = 'e2e-first-navigation';
// Where page-first.html's first script goes first, which page-navigation refuses.
const FIRST_ELSEWHERE = 'https://crossbind-e2e.invalid/first';
// What the project's origin is labelled with, which its pages' dialogs show: but at the stage again, served without one.
const PROJECT_LABEL = 'Öffnen e2e project';
// crossbind/app as a served origin's page imports it, which the host answers from the app's own files.
const PAGE_API = '/__crossbind/app.js';
// The message dialog page-api.html shows as its origin ends, which closes with it, and the one page-soon.html asks as
// its origin ends, which closes as it shows.
const ENDED_MESSAGE = "crossbind e2e: a project's dialog its end closes";
const SOON_MESSAGE = "crossbind e2e: a project's dialog its end reached on its way";
// The run's endpoint, on the device's own loopback, or where a build for a phone names it, as http://<the Mac's
// address>:47831, which e2e/endpoint.mjs serves when run alone.
const ENDPOINT = import.meta.env.VITE_E2E_ENDPOINT || `http://127.0.0.1:${REACH_PORT}`;
const SOURCE = `${ENDPOINT}/page`;
const FETCHED = `${ENDPOINT}/fetch`;
// How long a page waits for what must not come: a load the host refused, an event of another page's.
const QUIET_MS = 1500;
// How long a frame that the host lets load takes to say what it got, which takes it two seconds where it gets no answer.
const FRAME_MS = 4000;
const ANSWER_MS = 10000;
const POLL_MS = 100;
const MAX_FETCH_BYTES = 256 * 1024 * 1024;
const MAX_FETCH_BODY_BYTES = 1024 * 1024;
const LARGE_BYTES = 64 * 1024 * 1024;
const FETCH_MS = 60000;
// A length declared over the limit fails before the body comes, far within the time an answer may take.
const AT_ONCE_MS = 5000;
// The project's best loop against the app's own: an interpreted page runs about thirty times slower, a window that is
// not in front three to four.
const MAX_LOOP_RATIO = 8;
// The probe ends the project's origin from a thread of its own while the page goes on calling.
const END_AFTER_MS = 300;
// How long the app's page holds up the module's thread as it opens the project's, past that page's first script.
const HOLD_MS = 2000;
// How long the origin a page of no role posts toward stays served: past that page's POSTs and its way back.
const POSTED_END_MS = 20000;
// When the origin whose first page the run's endpoint answers late ends, while that page is on its way.
const SLOW_END_MS = 1000;
// How long an end's dialogs have had to go, a dialog that was on its way among them, as the app's page looks.
const GONE_MS = 3000;
// How long the UI thread's Java messages wait on Android as a page starts, past what that page asks first.
const HOLD_UI_MS = 2000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// A path of an origin, or of a URL whose path is "/".
const under = (base, path) => `${base.replace(/\/$/, '')}/${path}`;
const failure = (error) => `${error?.name ?? 'Error'}: ${error?.message ?? error}`;
const show = (name, value) => console.log(`PAGE GETS served-${name} ${JSON.stringify(value)}`);
// WebView2's pages, to whose webview the host posts each reply.
const isWebView2 = () => Boolean(globalThis.chrome?.webview);

export const isServedPage = () => /^e2e-[a-z0-9-]+(\.localhost)?$/.test(location.hostname);

// The first record of an extension's function that find takes, once there is one.
async function until(name, find, what) {
    const end = Date.now() + ANSWER_MS;
    for (;;) {
        const found = (await invoke(name)).find(find);
        if (found) return found;
        if (Date.now() > end) throw new Error(what);
        await sleep(POLL_MS);
    }
}

// The next message of the frame-probe.html of this frame that matches.
function frameSays(frame, matches) {
    return new Promise((resolve) => {
        const heard = ({ source, data }) => {
            if (source !== frame.contentWindow || !data?.frameProbe || !matches(data)) return;
            removeEventListener('message', heard);
            resolve(data);
        };
        addEventListener('message', heard);
    });
}

// Where a frame is: its own first document, which the page reads, or another origin's, which it cannot.
function placeOf(frame) {
    try {
        return frame.contentWindow.location.href;
    } catch {
        return "a document of another origin's";
    }
}

// A frame of frame-probe.html at this origin in the page, with what it said it got, or null if it said nothing in time.
async function frameAt(origin, waitMs) {
    const frame = document.createElement('iframe');
    frame.src = under(origin, FRAME_PAGE);
    const said = frameSays(frame, (data) => data.loaded !== undefined);
    document.body.append(frame);
    return { frame, said: await Promise.race([said, sleep(waitMs).then(() => null)]) };
}

let fetches = 0;
// What the frame's fetch of its own origin answered.
async function fetchInFrame(frame, url) {
    fetches += 1;
    const id = fetches;
    const answered = frameSays(frame, (data) => data.id === id);
    frame.contentWindow.postMessage({ fetch: url, id }, '*');
    const answer = await Promise.race([answered, sleep(ANSWER_MS).then(() => null)]);
    if (!answer) throw new Error(`a frame did not fetch ${url} in time`);
    return answer;
}

// 4. A frame of another origin gets none of a top frame's globals and reaches no function.
function checkFrameGotNothing(said, where) {
    if (said.globals.length > 0) throw new Error(`${where} got ${said.globals.join(', ')}`);
    if (/^answered \[0,|^a port/.test(said.reached)) throw new Error(`${where} reached the host: ${said.reached}`);
}

// 7. What serveOrigin() refuses: the name app, a name served now, another letter, 64 letters, and the role app.
function checkRefusals(refusals) {
    const name = (given) => `takes a name of lowercase letters and digits, which dashes may join, 63 at most, and not app: "${given}" is none`;
    const expected = [name('app'), `the origin ${OTHER} is served already`, name('e2e_x'), name('a'.repeat(64)),
        'takes a role of lowercase letters and digits, which dashes may join, 63 at most, and not app: "app" is none'];
    if (expected.some((part, i) => !refusals[i]?.includes(part))) throw new Error(`serveOrigin() did not refuse as it should: ${JSON.stringify(refusals)}`);
    show('refusals', refusals);
}

const fetchOf = (path, options = {}) => invoke('probe.fetch', { url: `${FETCHED}/${path}`, ...options });

// 8. The host's fetch: redirects, no cookie and no cache, the declared length, a large body, and where this run asks for
// them, an answer past the limit and one past the time.
async function checkFetch() {
    const within = await fetchOf('redirect-in');
    if (within.status !== 200 || !/^\d+$/.test(within.text ?? '')) throw new Error(`a redirect within the origin was not followed: ${JSON.stringify(within)}`);
    const out = await fetchOf('redirect-out');
    if (out.status !== 302 || out.headers?.location !== `http://localhost:${REACH_PORT}/fetch/count`) throw new Error(`a redirect elsewhere did not come back: ${JSON.stringify(out)}`);
    const looped = await fetchOf('redirect-loop');
    if (!looped.failure?.includes('redirected the fetch more than 20 times')) throw new Error(`endless redirects did not fail: ${JSON.stringify(looped)}`);
    const cookies = [await fetchOf('cookie'), await fetchOf('cookie')].map(({ text }) => text);
    if (cookies.some((sent) => sent !== 'none')) throw new Error(`the fetch sent a cookie: ${cookies.join(', ')}`);
    const counts = [await fetchOf('count'), await fetchOf('count')].map(({ text }) => Number(text));
    if (counts[1] !== counts[0] + 1) throw new Error(`the endpoint did not hear each fetch of an answer a cache keeps: ${counts.join(', ')}`);
    const declared = await fetchOf('declared-over');
    if (!declared.failure?.includes(`declares ${MAX_FETCH_BYTES + 1} bytes`) || declared.ms > AT_ONCE_MS) {
        throw new Error(`a length declared over the limit did not fail at once: ${JSON.stringify(declared)}`);
    }
    const large = await fetchOf('large', { pattern: true });
    if (large.status !== 200 || large.size !== LARGE_BYTES || !large.isPattern) throw new Error(`a body of 64 MiB came as ${JSON.stringify({ ...large, headers: undefined })}`);
    show('fetch', { within: within.text, out: out.headers.location, looped: looped.failure, cookies, counts, declared, large: { size: large.size, ms: large.ms } });
    if ((await fetchOf('limits')).text !== 'yes') return;
    const over = await fetchOf('undeclared-over');
    if (!over.failure?.includes(`passed the ${MAX_FETCH_BYTES} bytes`)) throw new Error(`an answer past the limit did not fail: ${JSON.stringify(over)}`);
    const slow = await fetchOf('slow');
    if (!slow.failure?.includes('took over 60 s') || slow.ms < FETCH_MS - 1000 || slow.ms > FETCH_MS + ANSWER_MS) throw new Error(`an answer past the time came as ${JSON.stringify(slow)}`);
    show('fetch-limits', { over, slow });
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

// What the endpoint got of a fetch, and what it should have: the method, the type its headers named, and the body's
// length and SHA-256.
async function echoOf(method, body, type) {
    const answer = await fetchOf('echo', { method, body, headers: { 'Content-Type': type } });
    if (answer.status !== 200) throw new Error(`a ${method} of a body got ${JSON.stringify(answer)}`);
    const bytes = new TextEncoder().encode(body);
    return { got: JSON.parse(answer.text), sent: { method, type, length: bytes.length, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)) } };
}

// 8. A POST and a DELETE send their body, of the type their headers name, a body of 1 MiB among them, and follow no
// redirect, so the body goes to the URL alone; a GET's body, another method and a body over 1 MiB are refused.
async function checkFetchBody() {
    const text = JSON.stringify({ text: 'Öffnen 😀' });
    const full = 'x'.repeat(MAX_FETCH_BODY_BYTES);
    const echoes = [await echoOf('POST', text, 'application/json'), await echoOf('DELETE', text, 'application/json'), await echoOf('POST', full, 'text/plain'),
        await echoOf('POST', '', 'text/plain')];
    const wrong = echoes.filter(({ got, sent }) => JSON.stringify(got) !== JSON.stringify(sent));
    if (wrong.length > 0) throw new Error(`the endpoint got ${wrong.map(({ got, sent }) => `${JSON.stringify(got)}, not ${JSON.stringify(sent)}`).join('; ')}`);
    const counted = async () => Number((await fetchOf('count')).text);
    const before = await counted();
    const redirected = await fetchOf('redirect-in', { method: 'POST', body: text, headers: { 'Content-Type': 'application/json' } });
    const after = await counted();
    if (redirected.status !== 302 || redirected.headers?.location !== '/fetch/count?redirected' || after !== before + 1) {
        throw new Error(`a POST's redirect within the origin was followed: ${redirected.status}, the endpoint counted ${after - before} fetches, not 1`);
    }
    const refused = (options) => fetchOf('echo', options).then((answer) => `answered ${answer.status}`, failure);
    const refusals = [await refused({ method: 'GET', body: 'x' }), await refused({ method: 'PUT' }), await refused({ method: 'POST', body: `${full}x` })];
    const words = ['sends a body with POST and DELETE alone, not with GET', 'takes GET, HEAD, POST or DELETE, not PUT',
        `sends a body of ${MAX_FETCH_BODY_BYTES} bytes at most, not ${MAX_FETCH_BODY_BYTES + 1}`];
    if (words.some((word, i) => !refusals[i].includes(word))) throw new Error(`fetch() did not refuse as it should: ${JSON.stringify(refusals)}`);
    // The type a system's client names for a body its headers give none, which the run shows.
    const untyped = JSON.parse((await fetchOf('echo', { method: 'POST', body: text })).text).type;
    show('fetch-body', { echoes: echoes.map(({ got }) => ({ ...got, sha256: got.sha256.slice(0, 12) })), redirected: redirected.status, refusals, untyped });
}

// 3. The app's token at a served origin's calls, and a served origin's at the app's and at another served origin's.
async function checkTokens(isAndroid, otherUrl, token, owner) {
    const { frame, said } = await frameAt(otherUrl, ANSWER_MS);
    if (!said) throw new Error(`a frame of ${OTHER} said nothing: its handler took ${await invoke('probe.handled', { name: OTHER })} requests, the frame shows ${placeOf(frame)}`);
    checkFrameGotNothing(said, `a frame of ${OTHER} in the app's page`);
    const atOther = await fetchInFrame(frame, `/__crossbind/b/result?id=1&t=${token}`);
    frame.remove();
    // On Android the bytes travel over the page's port alone, and no origin serves such a request.
    if (atOther.status !== (isAndroid ? 404 : 403)) throw new Error(`${owner}'s token at ${OTHER}'s calls got ${atOther.status} ${atOther.text}`);
    const checked = { frame: said, atOther: `${atOther.status} ${atOther.text}` };
    if (owner === PROJECT && !isAndroid) {
        const atApp = await fetch(`crossbind://app/b/result?id=1&t=${token}`);
        const sent = await Promise.resolve(window.webkit.messageHandlers.crossbind.postMessage(`${token}["app",1,["probe.role",{}],[]]`)).then(String, failure);
        // WebKitGTK tells the channel no sender's origin: the window's page, of another origin, refuses it there.
        if (atApp.status !== 403 || !/does not carry the page's token|the page that made the call went away/.test(sent)) {
            throw new Error(`the project's token reached the app's calls: ${atApp.status}, ${sent}`);
        }
        Object.assign(checked, { atApp: atApp.status, message: sent });
    }
    show(`tokens-${owner}`, checked);
}

// The label of the page that calls, which its dialogs are titled with, against what it should be: the app's name where none
// is given.
async function checkLabel(wanted) {
    const { label, appName } = await invoke('probe.label');
    if (label !== (wanted ?? appName)) throw new Error(`a page of ${location.origin} is labelled ${label}, not ${wanted ?? appName}`);
    return label;
}

// The host takes no request of another origin's: on Windows the filter that hands it http://<name>.localhost's matches
// over the whole URL, as this one's query.
async function checkOtherRequests() {
    const url = `${ENDPOINT}/reach?u=http://a.localhost/`;
    const reached = await fetch(url).then(async (response) => `${response.status} ${await response.text()}`, failure);
    if (reached !== '200 ok') throw new Error(`a fetch of ${url} got ${reached}`);
    show('other-requests', { url, reached });
}

// Replies of the app's page that come once the project's page shows: an answer, as its function holds up the module's
// thread past that page's first script, and the cancel of a call that answered nothing, which checkHeardReplies() seeks.
function holdUpReplies() {
    invoke('probe.holdUp', { ms: HOLD_MS }).catch(() => {});
    invoke('probe.appWaits').catch(() => {});
}

// The page of no role at the run's endpoint, public/no-role.html, with the app's origin and the served one it posts
// toward.
const noRolePage = (app, served) => `${SOURCE}/${NO_ROLE_PAGE}?app=${encodeURIComponent(app)}&served=${encodeURIComponent(served)}`;

// The app's page as the round trip starts: it serves the origins, checks what needs no project's page, and opens a page
// of no role in its window. 5. It does so by a form's POST toward that other origin, which page-navigation loads, after
// one it refuses, which loads nothing: were it loaded, the page of no role would come back saying so.
async function start(isAndroid) {
    const otherUrl = await invoke('probe.serveOrigin', { name: OTHER, source: SOURCE });
    checkRefusals(await invoke('probe.refusedOrigins', { served: OTHER }));
    show('label', { app: await checkLabel() });
    await checkFetch();
    await checkFetchBody();
    if (isWebView2()) await checkOtherRequests();
    await checkTokens(isAndroid, otherUrl, globalThis.__crossbind_token, 'app');
    const posted = await invoke('probe.serveOrigin', { name: POSTED, source: SOURCE });
    // A POST that loaded this origin's page, which has no script, leaves the window there until the origin ends.
    await invoke('probe.endOrigin', { name: POSTED, afterMs: POSTED_END_MS });
    await invoke('probe.report', { key: 'app', value: { href: location.href, origin: location.origin, other: otherUrl, posted } });
    await invoke('probe.setStage', { stage: 'no-role' });
    const page = noRolePage(location.origin, posted);
    post(`${page}&refused=app`);
    await sleep(QUIET_MS);
    post(page);
    await sleep(ANSWER_MS);
    throw new Error(`the window did not open ${page}`);
}

// 5. The app's page once the page of no role came back by its way back, which page-navigation loads, having stayed
// through its POSTs toward the app's origin and a served one. Were a POST loaded, the window shows this page at its URL,
// or at its first once the served origin ended. page-navigation heard both of the app's page's POSTs with its role.
// Then the project's page opens.
async function afterNoRole(reports) {
    const back = new URLSearchParams(location.search);
    if (back.get('from') !== 'no-role-back') {
        const loaded = back.get('from') === 'no-role-post' ? 'it' : `a page of ${POSTED}, whose end brought the window back`;
        throw new Error(`the app's page opened at ${location.href} at the stage no-role: a POST of a page of no role loaded ${loaded}`);
    }
    const asked = await invoke('page-navigation.asked');
    const page = noRolePage(reports.app.origin, reports.app.posted);
    const unheard = [`${page}&refused=app`, page].filter((url) => !asked.some((one) => one.url === url && one.role === 'app'));
    if (unheard.length > 0) throw new Error(`page-navigation did not hear the app's page's POST of ${unheard.join(' and ')} with the role app`);
    const heard = asked.filter(({ url }) => url.includes('no-role')).map(({ url, role }) => ({ url, role }));
    show('no-role', { back: location.href, heard });
    const project = await invoke('probe.serveOrigin', { name: PROJECT, source: SOURCE, label: PROJECT_LABEL });
    await invoke('probe.setStage', { stage: 'project' });
    if (isWebView2()) holdUpReplies();
    location.href = project;
    await sleep(ANSWER_MS);
    throw new Error(`the window did not open ${project}`);
}

// 6. The app's page once the project's origin ended: the window shows its first page, the open call was cancelled, and a
// later request of an ended origin gets 404 without the handler, as a frame of one the app's page holds asks.
async function afterTheEnd(isAndroid, reports) {
    if (location.href !== reports.app.href) throw new Error(`the window showed ${location.href}, not the app's first page, once the project's origin ended`);
    const cancels = await invoke('probe.projectCancels');
    if (cancels !== 1) throw new Error(`the project's open call heard of ${cancels} cancels as its origin ended, not one`);
    const { frame, said } = await frameAt(await invoke('probe.serveOrigin', { name: ENDED, source: SOURCE }), ANSWER_MS);
    if (!said) throw new Error(`a frame of ${ENDED} said nothing: its handler took ${await invoke('probe.handled', { name: ENDED })} requests, the frame shows ${placeOf(frame)}`);
    // 7 of the note's section 8: the project's page left a mark in its storage, which no other origin sees.
    if (said.keys.includes('e2e-mark') || localStorage.getItem('e2e-mark') !== null) throw new Error("another origin saw the project's storage");
    const before = await fetchInFrame(frame, `/${FRAME_PAGE}`);
    const handled = await invoke('probe.handled', { name: ENDED });
    await invoke('probe.endOrigin', { name: ENDED });
    const after = await fetchInFrame(frame, `/${FRAME_PAGE}`);
    const handledAfter = await invoke('probe.handled', { name: ENDED });
    frame.remove();
    if (before.status !== 200 || after.status !== 404 || !after.text?.includes(`the origin ${ENDED} is not served`) || handledAfter !== handled) {
        throw new Error(`a request of an ended origin got ${after.status} ${after.text}, the handler ${handledAfter - handled} more requests`);
    }
    show('end', { cancels, before: before.status, after: `${after.status} ${after.text}`, handled: [handled, handledAfter] });
    const project = await invoke('probe.serveOrigin', { name: PROJECT, source: SOURCE });
    await checkTokens(isAndroid, reports.app.other, reports.projectToken, PROJECT);
    await invoke('probe.setStage', { stage: 'again' });
    location.href = project;
    await sleep(ANSWER_MS);
    throw new Error(`the window did not open ${project} again`);
}

// The project's page that imports crossbind/app from PAGE_API, public/page-api.html, from source: the run's endpoint, or
// a development session's dev server. It reports what it got, and ends the origin, which brings the app's page back.
async function openPageApi(source) {
    const page = under(await invoke('probe.serveOrigin', { name: PROJECT, source, label: PROJECT_LABEL }), PAGE_API_PAGE);
    await invoke('probe.setStage', { stage: 'page-api' });
    location.href = page;
    await sleep(ANSWER_MS);
    throw new Error(`the window did not open ${page}`);
}

// Whether the holder of page-dialogs was handed a dialog of this message a page left open, and heard it answer as
// cancelled as its page went.
async function heardOf(message) {
    const { handed, cancelled } = await invoke('page-dialogs.heard');
    return { handed: handed.includes(message), cancelled: cancelled.includes(message) };
}

// 11. A project's message dialog held its window alone, which Windows' task dialog holds with the window's thread, as
// page-api.html found while it waited, and the project's end closed it and the alert() its page asked over it: none
// waits for a page that went. On Windows that alert() waited in the queue the task dialog held, through which a page's
// dialog reaches its holder, and is never handed over once its origin has ended; elsewhere its holder heard it go.
async function checkEndClosedMessage({ pageApi }) {
    if (device.platform !== 'windows' && !String(pageApi?.mainThread).startsWith('answered')) {
        throw new Error(`a project's message dialog held the app's main thread: ${pageApi?.mainThread}`);
    }
    await sleep(QUIET_MS);
    const left = await invoke('probe.closeDialog', { message: ENDED_MESSAGE });
    if (left.isShown) throw new Error("the project's end left its message dialog up");
    const over = await heardOf('wait over');
    if (device.platform === 'windows' && over.handed) throw new Error("the alert() a project's page asked over its message dialog reached its holder once its origin had ended");
    if (device.platform !== 'windows' && !(over.handed && over.cancelled)) {
        throw new Error(`the holder of page-dialogs ${over.handed ? 'did not hear' : 'was never handed'} the alert() a project's page asked over its message dialog${over.handed ? ' go as its origin ended' : ''}`);
    }
    show('end-message', { mainThread: pageApi.mainThread, left: left.isShown, over });
}

// The project's page that leaves its own dialog open as its origin ends, public/page-wait.html.
async function openWait() {
    const page = under(await invoke('probe.serveOrigin', { name: WAIT, source: SOURCE }), WAIT_PAGE);
    await invoke('probe.setStage', { stage: 'wait' });
    location.href = page;
    await sleep(ANSWER_MS);
    throw new Error(`the window did not open ${page}`);
}

// 12. The end of page-wait.html's origin answered its alert() as cancelled, which its holder of page-dialogs heard: no
// page's dialog waits for a page that went.
async function checkEndCancelledDialog() {
    const wait = await heardOf('wait');
    if (!(wait.handed && wait.cancelled)) {
        throw new Error(`the holder of page-dialogs ${wait.handed ? "did not hear a project's page's alert() go as its origin ended" : "was never handed a project's page's alert()"}`);
    }
    show('end-dialog', wait);
}

// The project's page that asks a message dialog as its origin ends, public/page-soon.html.
async function openSoon() {
    const page = under(await invoke('probe.serveOrigin', { name: SOON, source: SOURCE }), SOON_PAGE);
    await invoke('probe.setStage', { stage: 'soon' });
    location.href = page;
    await sleep(ANSWER_MS);
    throw new Error(`the window did not open ${page}`);
}

// 13. A message dialog its origin's end reached on its way closed as it showed: none is left.
async function checkSoonGone() {
    await sleep(GONE_MS);
    const left = await invoke('probe.closeDialog', { message: SOON_MESSAGE });
    if (left.isShown) throw new Error("a message dialog its origin's end reached on its way was left up");
    show('end-soon', { left: left.isShown });
}

// 14. An origin that ends while its first page is on its way: the window shows the app's first page again, as for one
// that ended once its page showed. Were the page shown, it would say so.
async function openSlowly() {
    const slow = under(await invoke('probe.serveOrigin', { name: SLOW, source: SOURCE }), '__e2e/slow');
    await invoke('probe.setStage', { stage: 'first-load' });
    await invoke('probe.endOrigin', { name: SLOW, afterMs: SLOW_END_MS });
    location.href = slow;
    await sleep(ANSWER_MS);
    throw new Error(`the window did not open ${slow}`);
}

async function afterFirstLoad(reports) {
    if (location.href !== reports.app.href) throw new Error(`the window showed ${location.href}, not the app's first page, once ${SLOW} ended during its first load`);
    show('first-load', { back: location.href, handled: await invoke('probe.handled', { name: SLOW }) });
    return reports;
}

// 15. On Android the host hears of a page once its first scripts may have asked, so a request is judged by the page the
// WebView shows as the host decides. page-first.html, opened with the UI thread's Java messages held there, goes in its
// first script by a link elsewhere, which page-navigation hears with its role, and toward the app's origin by a GET and
// a form's POST, each refused a project's page; it ends its origin with them held again, so the app's first page, heard
// of late as well, goes within the app at once, which loads.
async function openFirst(isAndroid) {
    const page = `${under(await invoke('probe.serveOrigin', { name: FIRST, source: SOURCE }), FIRST_PAGE)}?app=${encodeURIComponent(location.origin)}`;
    await invoke('probe.setStage', { stage: 'first' });
    sessionStorage.setItem(FIRST_ARMED, 'armed');
    if (isAndroid) await invoke('probe.holdUi', { ms: HOLD_UI_MS });
    location.href = page;
    await sleep(ANSWER_MS);
    throw new Error(`the window did not open ${page}`);
}

// The app's first page after page-first.html's end, which openFirst() arms, goes within the app before it waits for
// anything, on Android before the host may have heard of it, and runs nothing else: true where it goes. Were its
// navigation refused, the page stays and says so.
export function goWithinTheAppFirst() {
    if (sessionStorage.getItem(FIRST_ARMED) === null || location.search !== '') return false;
    sessionStorage.removeItem(FIRST_ARMED);
    location.replace('/?from=first-navigation');
    setTimeout(() => {
        console.error(`CONFORMANCE ERR: the app's first page after a project's end was refused its navigation within the app, as the project's, at ${location.href}`);
    }, QUIET_MS);
    return true;
}

async function afterFirst(reports) {
    const from = new URLSearchParams(location.search).get('from');
    if (from === 'project-first' || from === 'project-first-post') {
        throw new Error(`a project's page's first ${from === 'project-first' ? 'GET' : 'POST'} toward the app's origin loaded ${location.href}`);
    }
    if (from !== 'first-navigation') throw new Error(`the app's first page after ${FIRST_PAGE}'s end did not go within the app: ${location.href}`);
    if (!reports.first?.stayed) throw new Error(`${FIRST_PAGE} did not tell it stayed through its GET and POST toward the app's origin: ${JSON.stringify(reports.first)}`);
    const elsewhere = (await invoke('page-navigation.asked')).find(({ url }) => url === FIRST_ELSEWHERE);
    if (elsewhere?.role !== 'project') {
        throw new Error(`page-navigation heard ${FIRST_PAGE}'s first link elsewhere ${elsewhere ? `with the role ${JSON.stringify(elsewhere.role)}` : 'nowhere'}, not with the role project`);
    }
    show('first', { stayed: reports.first.stayed, elsewhere: { role: elsewhere.role, isPage: elsewhere.isPage }, back: location.href });
}

// The app's page at the stage the round trip reached: false once it sent the window elsewhere, else what the project's
// pages reported, at its end.
export async function runServedRoundTrip(isAndroid) {
    const refused = new URLSearchParams(location.search).get('refused');
    if (refused) {
        throw new Error(`a form's POST of a page of the role ${refused} toward another origin, which page-navigation refused, loaded the page of no role, which came back to ${location.href}`);
    }
    const stage = await invoke('probe.stage');
    const reports = await invoke('probe.reports');
    if (stage === 'start') return start(isAndroid).then(() => false);
    if (stage === 'no-role') return afterNoRole(reports).then(() => false);
    if (stage === 'ended') return afterTheEnd(isAndroid, reports).then(() => false);
    if (stage === 'done') return openPageApi(SOURCE).then(() => false);
    if (stage === 'page-api-done') return checkEndClosedMessage(reports).then(openWait).then(() => false);
    if (stage === 'wait-done') return checkEndCancelledDialog().then(openSoon).then(() => false);
    if (stage === 'soon-done') return checkSoonGone().then(() => openFirst(isAndroid)).then(() => false);
    if (stage === 'first') return afterFirst(reports).then(openSlowly).then(() => false);
    if (stage === 'first-load') return afterFirstLoad(reports);
    throw new Error(`the app's page opened at ${location.href} at the stage ${stage}${stage === 'refused' ? ", which the project's page navigated to" : ''}`);
}

// A development session's app page, which has no endpoint: the page that imports crossbind/app alone, from the dev
// server, the app's page's own source.
export async function runPageApiTrip() {
    const stage = await invoke('probe.stage');
    if (stage === 'start') return openPageApi(location.origin).then(() => false);
    if (stage === 'page-api-done') return invoke('probe.reports');
    throw new Error(`the app's page opened at ${location.href} at the stage ${stage}`);
}

// macOS and iOS, with the probe's dialog of the window standing for another holder's: a message dialog whose call is
// cancelled goes, asked behind the other or shown under it, and never shows later; and of two message dialogs the
// second is refused, so no two are up together.
function checkAnother(another) {
    if (!another?.behindAnswer?.includes('AbortError') || another.behind !== false || another.other !== true || another.behindLater !== false) {
        throw new Error(`a message dialog cancelled as it was asked behind another dialog of its window showed: ${JSON.stringify(another)}`);
    }
    if (!another.second?.includes('another dialog is open')) throw new Error(`a second message dialog was not refused: ${another.second}`);
    if (another.underShown !== 'shown' || !another.underAnswer?.includes('AbortError') || another.under !== false) {
        throw new Error(`a message dialog cancelled under another dialog of its window stayed: ${JSON.stringify(another)}`);
    }
}

// What public/page-api.html got from PAGE_API, which the host answers, so the origin's handler never got it: the names of
// the app's own page's crossbind/app; an app's function refused naming the role, also once a web build's crossbind.js
// took globalThis.Crossbind; and the system's message dialog, which waited for its user until the probe closed it, where
// a refused call answers at once.
export async function checkPageApi({ pageApi: got }) {
    if (!got || got.failure) throw new Error(`${PAGE_API_PAGE} of ${PROJECT} failed: ${got?.failure ?? 'it told nothing'}`);
    const names = Object.keys(ownApi).sort();
    if (got.names.join() !== names.join()) throw new Error(`${PAGE_API} gave ${got.names.join(', ')}, not the app's crossbind/app's ${names.join(', ')}`);
    const refusal = 'a page of the role project does not reach app.paths, which pages of the role app call';
    if (got.role !== 'project' || !got.paths?.includes(refusal)) throw new Error(`app.paths of ${PAGE_API} in a page of the role ${got.role} got ${got.paths}`);
    if (!got.pathsAfter?.includes(refusal)) throw new Error(`app.paths of ${PAGE_API}, once a web build's crossbind.js took globalThis.Crossbind, got ${got.pathsAfter}`);
    if (got.dialog !== 'shown') throw new Error(`dialog.message of a project's page answered at once: ${got.dialog}`);
    if (got.closed?.isShown !== true || !/^answered \d+$/.test(got.dialogClosed)) {
        throw new Error(`no message dialog of the project's page was there to close: ${JSON.stringify(got.closed)}, ${got.dialogClosed}`);
    }
    // Windows and Linux title a message dialog's window, with the label of the page that shows it.
    if (['windows', 'linux'].includes(device.platform) && got.closed.title !== PROJECT_LABEL) {
        throw new Error(`the project's message dialog is titled ${got.closed.title}, not its origin's label ${PROJECT_LABEL}`);
    }
    if (['macos', 'ios'].includes(device.platform)) checkAnother(got.another);
    const handled = await invoke('probe.handled', { name: PROJECT, path: PAGE_API });
    if (handled !== 0) throw new Error(`the handler of ${PROJECT} got ${PAGE_API} ${handled} times`);
    show('page-api', { ...got, names: got.names.length, handled });
}

// 1, 6 and the loop, once the round trip is done and the app's page has timed its own.
export function checkServedReports(reports, features) {
    const { mark, waited, after } = reports.again ?? {};
    if (mark !== 'kept') throw new Error(`the project's origin, served again, did not find its storage: ${JSON.stringify(reports.again)}`);
    if (!waited?.includes('AbortError') || !waited.includes('probe.projectWait was cancelled')) throw new Error(`the project's open call ended as ${waited}, as its origin ended`);
    if (!after?.includes(`the origin ${PROJECT} has ended`)) throw new Error(`the project's call after its origin ended got ${after}`);
    if (reports.again.label !== reports.again.appName) throw new Error(`the project's origin served without a label labels its page ${reports.again.label}, not the app's name`);
    const ratio = reports.projectLoop / features['js-loop'].best;
    show('loop', { project: reports.projectLoop, app: features['js-loop'].best, ratio: Math.round(ratio * 100) / 100 });
    if (!(ratio < MAX_LOOP_RATIO)) throw new Error(`the project's page ran the loop ${ratio.toFixed(1)} times as long as the app's own`);
}

// 1. What a project's page gets: all of it, OPFS but on Linux, which prints what it has.
function checkWhatThePageGets(got, isAndroid) {
    const isLinux = !isAndroid && /Linux/.test(navigator.userAgent);
    const workers = [got['worker-classic'], got['worker-module']];
    const missing = [
        got.page?.isSecureContext !== true && 'a secure context',
        got.webassembly !== 'ok' && 'wasm',
        got.indexeddb !== 'ok' && 'IndexedDB',
        got.subtle !== 'ok' && 'crypto.subtle',
        got.locks !== 'ok' && 'locks',
        workers.some((worker) => worker?.isSecureContext !== true || worker.wasm !== 'ok') && 'both Workers with wasm in a secure context',
        !isLinux && got.opfs !== 'ok' && 'OPFS',
        !isLinux && workers.some((worker) => !worker?.opfsSync?.startsWith('ok')) && "OPFS's sync handle in both Workers",
    ].filter(Boolean);
    if (missing.length > 0) throw new Error(`a project's page lacks ${missing.join(', ')}`);
}

// 2. A function of the app's pages alone is refused before it runs, naming the role; one that lists project answers
// with it; the module and the events the app holds are refused; an event for every page is not heard, the page's own is.
async function checkRoles(m) {
    const refused = await invoke('probe.appOnly').then(() => 'answered', failure);
    if (!refused.includes('a page of the role project does not reach probe.appOnly, which pages of the role app call') || await invoke('probe.appOnlyRuns') !== 0) {
        throw new Error(`a function of the app's pages alone answered a project's page: ${refused}`);
    }
    const role = await invoke('probe.role');
    if (role !== 'project') throw new Error(`a project's page called with the role ${role}`);
    const paths = await host.paths().then(() => 'answered', failure);
    if (!paths.includes('does not reach app.paths')) throw new Error(`app.paths answered a project's page: ${paths}`);
    const module = await Promise.resolve().then(() => new m.ConfBox(2, 3)).then(() => 'answered', failure);
    if (!module.includes("a page of the role project reaches the app's functions alone, not its module")) throw new Error(`the module answered a project's page: ${module}`);
    const held = await events.held('probe.every').then(() => 'answered', failure);
    if (!held.includes('takes no events the app holds for its own pages')) throw new Error(`events.held answered a project's page: ${held}`);
    const heard = [];
    const offs = ['probe.every', 'probe.mine'].map((name) => events.on(name, () => heard.push(name)));
    await invoke('probe.emitBoth');
    await sleep(QUIET_MS);
    offs.forEach((off) => off());
    if (heard.join() !== 'probe.mine') throw new Error(`a project's page heard ${heard.join(', ') || 'nothing'}, not its own event alone`);
    show('roles', { refused, role, paths, module, held, heard });
}

// 3. A project's page calls with its own token at its own origin: bytes in a frame, and a large result.
async function checkOwnCalls() {
    const large = Uint8Array.from({ length: 70000 }, (_, i) => i % 251);
    const echoed = await invoke('probe.bytes', { data: large.buffer });
    const big = await invoke('probe.bigBytes');
    if (echoed.size !== 70000 || echoed.back[0] !== large[69999] || big?.length !== 100000 || big.some((byte, i) => byte !== i % 251)) {
        throw new Error(`a project's page's bytes came back as ${echoed.size} and ${big?.length}`);
    }
}

// 4. A frame of the app's page in a project's: the host refuses its load, and on Android, whose WebView loads a frame
// without asking, the app's documents refuse to show in it.
async function checkAppFrame(appOrigin, isAndroid) {
    const { frame, said } = await frameAt(appOrigin, FRAME_MS);
    let isFirstDocument = false;
    try {
        isFirstDocument = frame.contentWindow.location.href === 'about:blank';
    } catch {
        // A document of another origin, which loaded, or the error page Android's WebView shows in its place.
    }
    frame.remove();
    if (said) checkFrameGotNothing(said, "a frame of the app's page in the project's");
    const read = await fetch(under(appOrigin, FRAME_PAGE)).then((response) => `read ${response.status}`, failure);
    if (read.startsWith('read')) throw new Error(`a project's page ${read} of the app's origin`);
    if (said || (!isAndroid && !isFirstDocument)) throw new Error(`a frame of the app's page loaded in the project's: ${JSON.stringify(said)}`);
    show('app-frame', { frame: 'loaded nothing', read });
}

// A form's POST of the top frame, which Android's WebView asks the host nothing of before its request.
function post(url) {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = url;
    document.body.append(form);
    form.submit();
}

// 5. A link elsewhere reaches page-navigation with the role, and so does a form's POST elsewhere, which it refuses, so
// it loads nothing; the app's own origin and another served one, as the top frame's, with a user's name, which is no
// part of an origin, as a form's POST or as a window's, are refused before any holder hears of them. Were one loaded,
// its page would find the stage refused and say so, and the page of no role would say whose POST it was.
async function checkNavigation(app) {
    const away = 'https://crossbind-e2e.invalid/project';
    location.href = away;
    const asked = await until('page-navigation.asked', ({ url }) => url === away, `page-navigation was not asked for ${away}`);
    if (asked.role !== 'project') throw new Error(`page-navigation heard of the project's ${away} with the role ${JSON.stringify(asked.role)}`);
    const refused = [under(app.origin, '?from=project'), under(app.other, '?from=project')];
    const named = refused.map((url) => url.replace('://', '://x@'));
    const posted = [under(app.origin, '?from=project-post'), under(app.other, '?from=project-post')];
    const elsewhere = `${noRolePage(app.origin, app.posted)}&refused=project`;
    await invoke('probe.setStage', { stage: 'refused' });
    for (const url of [...refused, ...named]) {
        location.href = url;
        await sleep(QUIET_MS);
    }
    for (const url of [...posted, elsewhere]) {
        post(url);
        await sleep(QUIET_MS);
    }
    window.open(refused[0]);
    await sleep(QUIET_MS);
    await invoke('probe.setStage', { stage: 'project' });
    const heard = (await invoke('page-navigation.asked')).filter(({ url }) => url.includes('from=project'));
    if (heard.length > 0) throw new Error(`page-navigation heard of ${JSON.stringify(heard)}`);
    const postedElsewhere = (await invoke('page-navigation.asked')).find(({ url }) => url === elsewhere);
    if (postedElsewhere?.role !== 'project') throw new Error(`page-navigation did not hear the project's POST of ${elsewhere} with the role project: ${JSON.stringify(postedElsewhere)}`);
    show('navigation', { away: asked, refused: [...refused, ...named, ...posted], elsewhere: { url: elsewhere, role: postedElsewhere.role } });
}

// 9. The probe's proxy: a Range, the headers it drops, its source down, a method the host refuses, and a path with a
// colon, as a dev server names its virtual modules.
async function checkProxy() {
    const ranged = await fetch('/index.html', { headers: { Range: 'bytes=0-14' } });
    const range = { status: ranged.status, contentRange: ranged.headers.get('content-range'), text: await ranged.text() };
    if (range.status !== 206 || !/^bytes 0-14\/\d+$/.test(range.contentRange ?? '') || range.text !== '<!doctype html>') throw new Error(`a Range came back as ${JSON.stringify(range)}`);
    // A HEAD has the length the source gave, as the proxy passes it, and no other.
    const head = await fetch('/index.html', { method: 'HEAD' });
    const length = head.headers.get('content-length');
    if (head.status !== 200 || length !== range.contentRange.split('/')[1]) throw new Error(`a HEAD came back as ${head.status} of the length ${length}, not ${range.contentRange}'s`);
    // One whose handler gives a Content-Length that is no number has the length of the body it would get, none.
    const unsized = await fetch('/__e2e/head-length', { method: 'HEAD' }).then((answer) => `${answer.status} ${answer.headers.get('content-length')}`, failure);
    if (unsized !== '200 0') throw new Error(`a HEAD whose handler gave the length -5 came back as ${unsized}, not 200 of the length 0`);
    const headed = await fetch('/__e2e/headers');
    if (headed.status !== 200 || headed.headers.has('x-e2e') || document.cookie.includes('e2e-proxy')) throw new Error('the proxy passed a header it drops, or the cookie');
    const down = await fetch('/down/page');
    const reason = await down.text();
    if (down.status !== 502 || !reason || reason.startsWith('crossbind:')) throw new Error(`the proxy of a source that is down answered ${down.status} ${reason}`);
    const routed = await fetch('/ext/probe/hello.txt');
    const routeText = await routed.text();
    if (routed.status !== 404 || routeText.startsWith('hello')) throw new Error(`a served origin's /ext/ reached a route: ${routed.status} ${routeText}`);
    const posted = await fetch('/index.html', { method: 'POST', body: 'x' });
    const refusal = await posted.text();
    if (posted.status !== 405 || !refusal.includes(`the origin ${PROJECT} answers GET and HEAD alone`)) throw new Error(`a POST got ${posted.status} ${refusal}`);
    const named = await fetch('/__e2e/id:virtual');
    const namedText = await named.text();
    if (named.status !== 200 || namedText !== 'id:virtual') throw new Error(`a path with a colon, as a dev server names, got ${named.status} ${namedText}`);
    show('proxy', { range, head: length, unsized, down: `${down.status} ${reason}`, ext: `${routed.status} ${routeText}`, post: `${posted.status} ${refusal}`, colon: namedText });
}

// 10. On an Android emulator, plain http and ws from a project's page reach the run's machine, as the probe's cleartext
// lets them.
function checkPlainHttp(got) {
    const http = got['http-network']?.result;
    const ws = got['ws-network']?.result;
    if (http !== '200 ok' || ws !== 'message ok') throw new Error(`a project's page did not reach the run's machine: ${JSON.stringify({ http, ws })}`);
}

// 6. The project's origin ends from a thread of the probe's while its page calls on: the open call is cancelled, the
// next fails saying it ended, and the window shows the app's first page. The page keeps what it heard for its next load.
async function endFromWithin() {
    invoke('probe.projectWait').then(() => 'answered', failure).then((text) => localStorage.setItem('e2e-waited', text));
    await invoke('probe.setStage', { stage: 'ended' });
    await invoke('probe.endOrigin', { name: PROJECT, afterMs: END_AFTER_MS });
    for (const end = Date.now() + ANSWER_MS; Date.now() < end;) {
        const refused = await invoke('probe.role').then(() => null, failure);
        if (refused) {
            localStorage.setItem('e2e-after', refused);
            break;
        }
    }
    await sleep(ANSWER_MS);
    throw new Error("the window did not show the app's first page once the project's origin ended");
}

// What the project's page heard on WebView2's channel from its first script on, index.html's: none of the app's page's
// replies that holdUpReplies() asked for.
function checkHeardReplies() {
    const others = (globalThis.e2eHeard ?? []).filter((text) => /probe\.appWaits|held up for the app's page/.test(text));
    if (others.length > 0) throw new Error(`a project's page heard the app's page's replies: ${others.join(' | ')}`);
    show('replies', { heard: globalThis.e2eHeard?.length ?? 'nothing' });
}

async function projectStage(m, isAndroid) {
    if (isWebView2()) checkHeardReplies();
    localStorage.clear();
    const { app } = await invoke('probe.reports');
    const got = await reportWebFeatures(isAndroid, 'project-');
    checkWhatThePageGets(got, isAndroid);
    await invoke('probe.report', { key: 'projectLoop', value: got['js-loop'].best });
    await checkRoles(m);
    await checkOwnCalls();
    await invoke('probe.report', { key: 'projectToken', value: globalThis.__crossbind_token });
    await checkAppFrame(app.origin, isAndroid);
    await checkNavigation(app);
    await checkProxy();
    if (isAndroid && device.isVirtual) checkPlainHttp(got);
    show('label', { project: await checkLabel(PROJECT_LABEL) });
    const prompted = JSON.parse(prompt('role', '') ?? 'null');
    if (prompted?.role !== 'project' || prompted.label !== PROJECT_LABEL) throw new Error(`page-dialogs heard a project's prompt() as ${JSON.stringify(prompted)}`);
    localStorage.setItem('e2e-mark', 'kept');
    await endFromWithin();
}

// The project's origin served again finds what its page kept, and ends once more.
async function againStage() {
    const again = { mark: localStorage.getItem('e2e-mark'), waited: localStorage.getItem('e2e-waited'), after: localStorage.getItem('e2e-after'),
        ...await invoke('probe.label') };
    await invoke('probe.report', { key: 'again', value: again });
    await invoke('probe.setStage', { stage: 'done' });
    await invoke('probe.endOrigin', { name: PROJECT }).catch(() => {});
    await sleep(ANSWER_MS);
    throw new Error("the window did not show the app's first page once the project's origin ended again");
}

// The page of one of the probe's origins, at the stage the app's page left.
export async function runProjectPage() {
    try {
        const m = await initNative();
        const isAndroid = Boolean(globalThis.__crossbind_port);
        const stage = await invoke('probe.stage');
        if (location.hostname.split('.')[0] !== PROJECT) throw new Error(`the window opened ${location.href} at the stage ${stage}`);
        if (stage === 'project') await projectStage(m, isAndroid);
        else if (stage === 'again') await againStage();
        else throw new Error(`the project's page opened at the stage ${stage}`);
    } catch (error) {
        console.error(`CONFORMANCE ERR: ${location.origin}: ${error?.message ?? error}`);
    }
}

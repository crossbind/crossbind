// The probe's origins, opened as the crossbind app will open a project's page: the conformance page serves them, opens
// the one of the role project in its window, which runs what follows there and comes back, and checks what the pages
// left with the probe, whose stage outlives each page. A project's page that fails says so as the suite would.
import { app as host, device, events, invoke } from 'crossbind/app';
import { initNative } from '@crossbind/conformance/native/confconstants.h';
import { REACH_PORT } from '../e2e/launch.mjs';
import { reportWebFeatures } from './web-features.js';

const PROJECT = 'e2e-project';
const OTHER = 'e2e-other';
const ENDED = 'e2e-ended';
const FRAME_PAGE = 'frame-probe.html';
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
const LARGE_BYTES = 64 * 1024 * 1024;
const FETCH_MS = 60000;
// A length declared over the limit fails before the body comes, far within the time an answer may take.
const AT_ONCE_MS = 5000;
// The project's best loop against the app's own: an interpreted page runs about thirty times slower, a window that is
// not in front three to four.
const MAX_LOOP_RATIO = 8;
// The probe ends the project's origin from a thread of its own while the page goes on calling.
const END_AFTER_MS = 300;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// A path of an origin, or of a URL whose path is "/".
const under = (base, path) => `${base.replace(/\/$/, '')}/${path}`;
const failure = (error) => `${error?.name ?? 'Error'}: ${error?.message ?? error}`;
const show = (name, value) => console.log(`PAGE GETS served-${name} ${JSON.stringify(value)}`);

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

// The app's page as the round trip starts: it serves the origins, checks what needs no project's page, and opens the
// project's page in its window.
async function start(isAndroid) {
    const otherUrl = await invoke('probe.serveOrigin', { name: OTHER, source: SOURCE });
    checkRefusals(await invoke('probe.refusedOrigins', { served: OTHER }));
    await checkFetch();
    await checkTokens(isAndroid, otherUrl, globalThis.__crossbind_token, 'app');
    const project = await invoke('probe.serveOrigin', { name: PROJECT, source: SOURCE });
    await invoke('probe.report', { key: 'app', value: { href: location.href, origin: location.origin, other: otherUrl } });
    await invoke('probe.setStage', { stage: 'project' });
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

// The app's page at the stage the round trip reached: false once it sent the window elsewhere, else what the project's
// pages reported, at its end.
export async function runServedRoundTrip(isAndroid) {
    const stage = await invoke('probe.stage');
    const reports = await invoke('probe.reports');
    if (stage === 'start') return start(isAndroid).then(() => false);
    if (stage === 'ended') return afterTheEnd(isAndroid, reports).then(() => false);
    if (stage === 'done') return reports;
    throw new Error(`the app's page opened at ${location.href} at the stage ${stage}${stage === 'refused' ? ", which the project's page navigated to" : ''}`);
}

// 1, 6 and the loop, once the round trip is done and the app's page has timed its own.
export function checkServedReports(reports, features) {
    const { mark, waited, after } = reports.again ?? {};
    if (mark !== 'kept') throw new Error(`the project's origin, served again, did not find its storage: ${JSON.stringify(reports.again)}`);
    if (!waited?.includes('AbortError') || !waited.includes('probe.projectWait was cancelled')) throw new Error(`the project's open call ended as ${waited}, as its origin ended`);
    if (!after?.includes(`the origin ${PROJECT} has ended`)) throw new Error(`the project's call after its origin ended got ${after}`);
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

// 4. A frame of the app's page in a project's: the host refuses its load but on Android, whose WebView loads a frame
// without asking, and there it gets nothing of the app's.
async function checkAppFrame(appOrigin, isAndroid) {
    const { frame, said } = await frameAt(appOrigin, FRAME_MS);
    let isFirstDocument = false;
    try {
        isFirstDocument = frame.contentWindow.location.href === 'about:blank';
    } catch {
        // A document of another origin, which loaded.
    }
    frame.remove();
    if (said) checkFrameGotNothing(said, "a frame of the app's page in the project's");
    const read = await fetch(under(appOrigin, FRAME_PAGE)).then((response) => `read ${response.status}`, failure);
    if (read.startsWith('read')) throw new Error(`a project's page ${read} of the app's origin`);
    if (!isAndroid && (said || !isFirstDocument)) throw new Error(`a frame of the app's page loaded in the project's: ${JSON.stringify(said)}`);
    show('app-frame', { frame: said ?? 'loaded nothing', read });
}

// 5. A link elsewhere reaches page-navigation with the role; the app's own origin and another served one, as the top
// frame's or a window's, are refused before any holder hears of them. Were one loaded, its page would find the stage
// refused and say so.
async function checkNavigation(app) {
    const away = 'https://crossbind-e2e.invalid/project';
    location.href = away;
    const asked = await until('page-navigation.asked', ({ url }) => url === away, `page-navigation was not asked for ${away}`);
    if (asked.role !== 'project') throw new Error(`page-navigation heard of the project's ${away} with the role ${JSON.stringify(asked.role)}`);
    const refused = [under(app.origin, '?from=project'), under(app.other, '?from=project')];
    await invoke('probe.setStage', { stage: 'refused' });
    for (const url of refused) {
        location.href = url;
        await sleep(QUIET_MS);
    }
    window.open(refused[0]);
    await sleep(QUIET_MS);
    await invoke('probe.setStage', { stage: 'project' });
    const heard = (await invoke('page-navigation.asked')).filter(({ url }) => refused.includes(url));
    if (heard.length > 0) throw new Error(`page-navigation heard of ${JSON.stringify(heard)}`);
    show('navigation', { away: asked, refused });
}

// 9. The probe's proxy: a Range, the headers it drops, its source down, and a method the host refuses.
async function checkProxy() {
    const ranged = await fetch('/index.html', { headers: { Range: 'bytes=0-14' } });
    const range = { status: ranged.status, contentRange: ranged.headers.get('content-range'), text: await ranged.text() };
    if (range.status !== 206 || !/^bytes 0-14\/\d+$/.test(range.contentRange ?? '') || range.text !== '<!doctype html>') throw new Error(`a Range came back as ${JSON.stringify(range)}`);
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
    show('proxy', { range, down: `${down.status} ${reason}`, ext: `${routed.status} ${routeText}`, post: `${posted.status} ${refusal}` });
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

async function projectStage(m, isAndroid) {
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
    const prompted = JSON.parse(prompt('role', '') ?? 'null');
    if (prompted?.role !== 'project') throw new Error(`page-dialogs heard a project's prompt() as ${JSON.stringify(prompted)}`);
    localStorage.setItem('e2e-mark', 'kept');
    await endFromWithin();
}

// The project's origin served again finds what its page kept, and ends once more.
async function againStage() {
    const again = { mark: localStorage.getItem('e2e-mark'), waited: localStorage.getItem('e2e-waited'), after: localStorage.getItem('e2e-after') };
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

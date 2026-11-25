import { setTimeout as sleep } from 'node:timers/promises';
import { questionsOn, storeOn } from './questions.mjs';

// What the preview extension asks a project's user before its page uses the camera, the microphone or the location, as
// e2e/run.mjs checks it on each platform, each question drawn, its words read and its button pressed as its user would
// (questions.mjs): a project whose preview ends with its question up, the second project with its own, a project
// allowed its devices, and the first again. A request goes by the page's own web API where it reaches page-permissions,
// else by the fixture's hook, which asks for the page's origin as an extension asks.
const QUESTION_MS = 30000;
const OUTCOME_MS = 60000;
const LOAD_MS = 180000;
const POLL_MS = 300;
const SETTLED_MS = 1500;
const SYSTEM_TRIES = 6;
const DETAIL = "It is a preview of your project. You can change this in the preview's menu.";
const NOUNS = { camera: 'the camera', microphone: 'the microphone', location: 'your location' };
const COULD_NOT_KEEP = 'crossbind: preview could not keep an answer in its consents.json, which holds for this run';
// Where a page's own request reaches page-permissions, as measured: the location everywhere. On macOS WebKit asks the
// system's own question before page-permissions for the camera and the microphone, which no run answers; a runner of
// Windows or Linux has neither, which their web views find before they ask.
const PAGE_REACHES = {
    macos: ['location'], ios: ['camera', 'microphone', 'location'], android: ['camera', 'microphone', 'location'], windows: ['location'], linux: ['location'],
};

const ENDED = 'e2e ended project';
const SECOND = 'e2e second project';
const ALLOWED = 'e2e allowed project';

function expect(isHeld, problem) {
    if (!isHeld) throw new Error(problem);
}

// A button's label, or none, as the platform draws it: Android's theme draws a dialog's buttons in capitals.
const isLabel = (drawn, label) => typeof drawn === 'string' && drawn.toLowerCase() === label.toLowerCase();
const isDontAllowOrNone = (drawn) => drawn === null || isLabel(drawn, "Don't Allow");

function messageOf(project, kinds) {
    const named = kinds.map((kind, index) => `${index === 0 ? '' : index + 1 === kinds.length ? ' and ' : ', '}${NOUNS[kind]}`).join('');
    return `Allow “${project}” to use ${named}?`;
}

export async function checkConsents(run) {
    const {
        platform, endpoint, app, project, openSession, closePreview, inPage, device, second, stepsProject,
    } = run;
    const byPage = (kinds) => kinds.every((kind) => PAGE_REACHES[platform].includes(kind));
    // A denial goes by the page where it reaches page-permissions. An Allow goes by the page where nothing the system
    // asks follows it unanswered: on Android, whose own question the run answers, and for the iOS Simulator's mock camera
    // and microphone; elsewhere by the hook, of the same holder, as CoreLocation's question would follow it, which no run
    // answers and which outlives the app.
    const denyVia = (kinds) => (byPage(kinds) ? 'page' : 'hook');
    const allowVia = (kinds) => (byPage(kinds) && (platform === 'android' || (platform === 'ios' && !kinds.includes('location'))) ? 'page' : 'hook');
    // iOS's WebKit keeps a page's denial and asks no more, so a question asked again goes by the hook there.
    const againVia = () => (platform === 'android' ? 'page' : 'hook');
    const valueOf = async (asked, what) => {
        const answered = await asked;
        expect(answered.error === undefined, `${what}: ${answered.error}`);
        return answered.value;
    };
    const { data } = await valueOf(app({ do: 'paths' }), "the app's paths");
    const store = storeOn({ ...run, data });
    const questions = questionsOn(run);
    // What a run before left.
    store.remove();
    const report = {
        first: null, left: [], defaultKey: null, reach: {}, system: [], store: {}, notification: null,
    };

    let tags = 0;
    const noted = (tag) => endpoint.notes.find((note) => note.event === 'requested' && note.tag === tag);
    async function start(requests) {
        const given = requests.map((asked) => ({ tag: (tags += 1), ...asked }));
        const started = await valueOf(project({ do: 'request', requests: given }), "the project's requests");
        expect(started === 'started', `the project's page started its requests as ${JSON.stringify(started)}`);
        return given.map((asked) => asked.tag);
    }
    const outcome = async (tag) => (noted(tag) ?? await endpoint.waitForNote((note) => note.event === 'requested' && note.tag === tag, OUTCOME_MS, `the end of request ${tag}`)).outcome;
    const isAllowed = (answered, via) => (via === 'hook' ? answered === 'allowed' : answered !== 'denied' && !/^\w*Error: /.test(answered));
    async function expectAllowed(tag, via, what) {
        const answered = await outcome(tag);
        expect(isAllowed(answered, via), `${what} answered ${answered}, not allowed`);
        return answered;
    }
    async function expectDenied(tag, what) {
        const answered = await outcome(tag);
        expect(answered === 'denied', `${what} answered ${answered}, not denied`);
    }

    // The question that comes, else the request's end where it ends first.
    async function questionOrEnd(role, tag) {
        const deadline = Date.now() + QUESTION_MS;
        for (;;) {
            const question = await questions.read(role);
            if (question) return { question };
            const ended = tag !== undefined && noted(tag);
            if (ended) return { ended: ended.outcome };
            expect(Date.now() < deadline, `no question came in ${QUESTION_MS / 1000} s`);
            await sleep(POLL_MS);
        }
    }
    // The words of the question read last, by which its button is pressed.
    let asking = null;
    // Its words and its two buttons, read again until both have come, as a platform may build them one after the
    // other.
    async function questionOf(role, tag, project, kinds) {
        const message = messageOf(project, kinds);
        const isWhole = (up) => up.texts.includes(message) && up.texts.includes(DETAIL) && up.buttons.length === 2
            && up.buttons.some((button) => isLabel(button, "Don't Allow")) && up.buttons.some((button) => isLabel(button, 'Allow'));
        const deadline = Date.now() + QUESTION_MS;
        let { question, ended } = await questionOrEnd(role, tag);
        expect(question, `a request of ${kinds.join(' and ')} ended ${ended} with no question`);
        while (!isWhole(question) && Date.now() < deadline) {
            await sleep(POLL_MS);
            question = await questions.read(role) ?? question;
        }
        expect(isWhole(question), `the question read ${JSON.stringify(question)}, not "${message}" with its detail and its two buttons`);
        asking = message;
        return question;
    }
    const press = (button) => questions.press('project', button, asking);
    // The question up once its default reads as Don't Allow.
    async function settled() {
        const deadline = Date.now() + QUESTION_MS;
        for (;;) {
            const up = await questions.read('project');
            if (isLabel(up?.preferred, "Don't Allow")) return up;
            expect(Date.now() < deadline, `the question's default never read Don't Allow: ${JSON.stringify(up)}`);
            await sleep(POLL_MS);
        }
    }
    async function noQuestion(role, what) {
        await sleep(SETTLED_MS);
        const question = await questions.read(role);
        expect(question === null, `${what} brought a question: ${JSON.stringify(question)}`);
    }
    const kept = (origin, kind) => store.read()?.[origin]?.[kind];
    // Android's own question for each runtime permission the extension's Allow goes on to, which the run allows.
    async function answerSystem() {
        const asked = [];
        let quiet = 0;
        while (platform === 'android' && quiet < (asked.length > 0 ? 2 : 3) && asked.length < SYSTEM_TRIES) {
            await sleep(SETTLED_MS);
            const system = questions.system();
            if (!system) {
                quiet += 1;
                continue;
            }
            asked.push(system.texts.join(' / '));
            questions.allowSystem();
        }
        return asked;
    }
    // The preview's end, which on Windows goes through DevTools while a task dialog holds the page's answers.
    async function endPreview() {
        if (platform !== 'windows') return closePreview();
        const back = endpoint.waitForNote((note) => note.role === 'app' && note.loaded, LOAD_MS, "the app's page after the preview");
        await inPage("void globalThis.crossbindE2e.invoke('e2e-hooks.closePreview')");
        return back;
    }

    // 1. A project whose preview ends with its question up: the question closes, nothing is kept, and a request after
    // the end is denied with no question. The first question's words, its default, its focus, and the keys and the
    // closes that leave it up.
    const ended = await stepsProject(ENDED);
    await openSession(ended.session, ended.origin);
    const [endedAsk] = await start([{ kinds: ['microphone'], via: denyVia(['microphone']) }]);
    const first = await questionOf('project', endedAsk, ENDED, ['microphone']);
    report.first = {
        texts: first.texts, buttons: first.buttons, preferred: first.preferred, focused: first.focused,
    };
    // As it comes up, its default and its first focus are Don't Allow or none: macOS gives a sheet's buttons their keys
    // once it shows. Where the run reads it, the default is Don't Allow once it has settled.
    expect(isDontAllowOrNone(first.focused) && isDontAllowOrNone(first.preferred), `the question came up as ${JSON.stringify(first)}`);
    const isDefaultRead = ['macos', 'ios', 'linux'].includes(platform);
    const steady = isDefaultRead ? await settled() : await questions.read('project');
    report.settled = { preferred: steady?.preferred ?? null, focused: steady?.focused ?? null };
    expect(isDefaultRead || steady?.preferred === null, `the question's default is ${JSON.stringify(steady)}`);
    expect(isDontAllowOrNone(steady?.focused ?? null), `the question's focus is ${JSON.stringify(steady)}`);
    for (const [way, send] of questions.waysOut('project')) {
        await send();
        await sleep(SETTLED_MS);
        expect(await questions.read('project') !== null, `the question went at ${way}: ${JSON.stringify(questions.screen())}`);
        report.left.push(way);
    }
    await endPreview();
    await noQuestion('app', "the preview's end");
    expect(kept(ended.origin, 'microphone') === undefined, `the preview's end with its question up kept ${JSON.stringify(store.read())}`);
    if (platform !== 'android') {
        const after = await valueOf(app({ do: 'askPermission', kinds: ['microphone'], origin: ended.url.replace(/\/$/, '') }), 'a request after the end');
        expect(after.allowed === false, `a request after the preview's end answered ${JSON.stringify(after)}`);
        await noQuestion('app', 'a request after the end');
    }

    // 2. The second project's own question. Two requests at once: the second waits for the first's answer. Don't Allow
    // for each kind, kept, and asked no more; the default key, as the question comes up, allows nothing.
    await openSession(second.session, second.origin);
    // The two go by different ways on some platforms, which reach page-permissions in either order.
    const atOnce = await start([{ kinds: ['camera'], via: denyVia(['camera']) }, { kinds: ['location'], via: denyVia(['location']) }]);
    const { question: up } = await questionOrEnd('project');
    const firstIndex = ['camera', 'location'].findIndex((kind) => up.texts.includes(messageOf(SECOND, [kind])));
    expect(firstIndex >= 0, `two requests at once brought ${JSON.stringify(up)}`);
    const [firstTag, secondTag] = firstIndex === 0 ? atOnce : [...atOnce].reverse();
    const [firstKind, secondKind] = firstIndex === 0 ? ['camera', 'location'] : ['location', 'camera'];
    await questionOf('project', firstTag, SECOND, [firstKind]);
    await sleep(SETTLED_MS);
    expect(!noted(secondTag), `the second request did not wait for the question up: it ended ${noted(secondTag)?.outcome}`);
    const stillFirst = await questions.read('project');
    expect(stillFirst?.texts.includes(messageOf(SECOND, [firstKind])), `a second question came while the first was up: ${JSON.stringify(stillFirst)}`);
    await press("Don't Allow");
    await expectDenied(firstTag, `the ${firstKind}'s request after Don't Allow`);
    await questionOf('project', secondTag, SECOND, [secondKind]);
    // Where the run's key reaches the question, it presses Don't Allow, the default, which the key that left it up
    // before is thus shown to reach as well; Android's Enter may find no focus and press nothing. macOS gives a sheet its
    // default once it shows, so the key goes once the run reads the default there.
    if (platform === 'macos') await settled();
    report.defaultKey = await questions.pressDefaultKey('project');
    if (report.defaultKey) await sleep(SETTLED_MS);
    const isUpAfterKey = await questions.read('project') !== null;
    expect(!isUpAfterKey || !['macos', 'linux'].includes(platform), `${report.defaultKey} as the question came up pressed none of its buttons`);
    if (isUpAfterKey) await press("Don't Allow");
    report.keyPressed = report.defaultKey && !isUpAfterKey ? "Don't Allow" : 'nothing';
    await expectDenied(secondTag, `the ${secondKind}'s request after Don't Allow`);
    const [microphone] = await start([{ kinds: ['microphone'], via: denyVia(['microphone']) }]);
    await questionOf('project', microphone, SECOND, ['microphone']);
    await press("Don't Allow");
    await expectDenied(microphone, "the microphone's request after Don't Allow");
    for (const kind of ['camera', 'microphone', 'location']) {
        expect(kept(second.origin, kind) === false, `Don't Allow kept ${JSON.stringify(store.read())} for ${kind}`);
    }
    const again = await start(['camera', 'microphone', 'location'].map((kind) => ({ kinds: [kind], via: denyVia([kind]) })));
    for (const tag of again) await expectDenied(tag, "a request after Don't Allow");
    await noQuestion('project', "a request after Don't Allow");
    // What the page's own request ends with where the hook asks instead, a denial kept now: NotAllowedError where it
    // reached page-permissions, the web view's own where it ended there.
    for (const kind of ['camera', 'microphone'].filter((each) => !PAGE_REACHES[platform].includes(each) && platform !== 'macos')) {
        const [tag] = await start([{ kinds: [kind], via: 'page' }]);
        report.reach[kind] = await outcome(tag);
    }
    // A kind outside the three, which no question asks.
    report.notification = await valueOf(project({ do: 'notified' }), "the web's question for notifications");
    expect(['denied', 'no Notification'].includes(report.notification), `the web's question for notifications answered ${report.notification}`);
    await noQuestion('project', "the web's question for notifications");
    await closePreview();

    // 3. A project allowed its devices. Two kinds in one request: one question names both, its answer kept for each;
    // on Android the system's own question then, after the extension's. One kind asked twice at once: one question.
    const allowed = await stepsProject(ALLOWED);
    await openSession(allowed.session, allowed.origin);
    const both = ['camera', 'microphone'];
    const [pair] = await start([{ kinds: both, via: allowVia(both) }]);
    await questionOf('project', pair, ALLOWED, both);
    expect(questions.system() === null, "the system's own question came before the extension's");
    await press('Allow');
    report.system.push(...await answerSystem());
    report.allowed = { pair: await expectAllowed(pair, allowVia(both), 'two kinds after Allow') };
    expect(kept(allowed.origin, 'camera') === true && kept(allowed.origin, 'microphone') === true, `Allow kept ${JSON.stringify(store.read())}`);
    const [pairAgain] = await start([{ kinds: both, via: allowVia(both) }]);
    await expectAllowed(pairAgain, allowVia(both), 'two kinds asked again');
    await noQuestion('project', 'a request after Allow');
    const twice = await start([{ kinds: ['location'], via: allowVia(['location']) }, { kinds: ['location'], via: allowVia(['location']) }]);
    await questionOf('project', twice[0], ALLOWED, ['location']);
    await press('Allow');
    report.system.push(...await answerSystem());
    report.allowed.location = await Promise.all(twice.map((tag) => expectAllowed(tag, allowVia(['location']), 'one kind asked twice at once')));
    await noQuestion('project', 'one kind asked twice at once');
    expect(kept(allowed.origin, 'location') === true, `Allow kept ${JSON.stringify(store.read())}`);
    expect(platform !== 'android' || report.system.length > 0, "Android's own question did not come after the extension's Allow");

    // The store fails closed: one that is no JSON, of another shape or that cannot be read gives no consent, and the kind
    // is asked again; an answer it cannot take holds for the app's run, and the output says so.
    const name = allowed.origin;
    const broken = {
        'no JSON': `{"${name}":{"camera":true`,
        'an array': JSON.stringify([{ [name]: { camera: true } }]),
        'an entry that is no object': JSON.stringify({ [name]: true }),
        'a value that is no boolean': JSON.stringify({ [name]: { camera: 'true' } }),
        unreadable: null,
    };
    for (const [shape, text] of Object.entries(broken)) {
        if (text === null) store.unreadable();
        else store.write(text);
        const [tag] = await start([{ kinds: ['camera'], via: againVia() }]);
        await questionOf('project', tag, ALLOWED, ['camera']);
        await press("Don't Allow");
        await expectDenied(tag, `the camera asked again of a store ${shape}`);
        report.store[shape] = 'asked again';
    }
    expect(device.lines.some((line) => line.text.includes(COULD_NOT_KEEP)), `the app did not say "${COULD_NOT_KEEP}"`);
    const [held] = await start([{ kinds: ['camera'], via: againVia() }]);
    await expectDenied(held, "the camera once its store could not keep Don't Allow");
    await noQuestion('project', 'an answer held for the run');
    store.remove();
    await closePreview();

    // 4. The project that ended with its question up, opened again: asked anew. A reload with the question up leaves it
    // up; it is answered once, and kept.
    await openSession(ended.session, ended.origin);
    const [anew] = await start([{ kinds: ['microphone'], via: allowVia(['microphone']) }]);
    await questionOf('project', anew, ENDED, ['microphone']);
    const reloaded = endpoint.waitForNote((note) => note.role === 'project' && note.loaded, LOAD_MS, "the project's page after its reload");
    if (platform === 'windows') await inPage('void setTimeout(() => location.reload(), 0)');
    else await valueOf(project({ do: 'reload' }), "the project's reload");
    await reloaded;
    await questionOf('project', undefined, ENDED, ['microphone']);
    await press('Allow');
    report.system.push(...await answerSystem());
    await noQuestion('project', 'the answer of a question asked before a reload');
    expect(kept(ended.origin, 'microphone') === true, `the answer after a reload kept ${JSON.stringify(store.read())}`);
    const [afterReload] = await start([{ kinds: ['microphone'], via: allowVia(['microphone']) }]);
    await expectAllowed(afterReload, allowVia(['microphone']), 'the microphone after the reload');
    await noQuestion('project', 'a request after the answer');
    await closePreview();
    await noQuestion('app', "the app's own page");
    return report;
}

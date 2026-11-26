import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { PAGE_REACHES, messageOf } from './consents.mjs';
import { indicatorsOn } from './indicator.mjs';
import {
    centerOf, questionsOn, screenOf, storeOn,
} from './questions.mjs';

// What the preview's menu changes of what is kept, as e2e/run.mjs checks it on each platform: Permissions, a control of
// two states for each kind its project's user answered, read and pressed as its user would (the fixture's hooks on
// macOS, iOS, Windows and Linux; uiautomator and adb on Android), each change kept as the question's answer is, in the
// store or for the run, and the project's page reloaded once as the surface closes.
const QUESTION_MS = 30000;
const OUTCOME_MS = 60000;
const LOAD_MS = 180000;
const LINE_MS = 30000;
const POLL_MS = 300;
const SETTLED_MS = 1500;
const TOOL_MS = 30000;
// Android's emulator may give an allowed page no position, so its location requests end this long after they are made.
const POSITION_MS = 30000;
const NOTHING = 'Nothing asked yet.';
const COULD_NOT_KEEP = 'crossbind: preview could not keep an answer in its consents.json, which holds for this run';
const PROJECT = 'e2e permissions project';
const DIALOG = "crossbind e2e: a project's own dialog, up under Permissions";

function expect(isHeld, problem) {
    if (!isHeld) throw new Error(problem);
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function checkPermissions(run) {
    const {
        platform, endpoint, openSession, closePreview, stepsProject, device, adb, applicationId,
    } = run;
    const isDesktop = ['macos', 'windows', 'linux'].includes(platform);
    const indicators = indicatorsOn(run);
    const questions = questionsOn(run);
    await questions.prepare();
    const step = async (role, what) => {
        const answered = await endpoint.step(role, what);
        expect(answered.error === undefined, `the ${role}'s page's ${what.do}: ${answered.error}`);
        return answered.value;
    };
    const { data } = await step('app', { do: 'paths' });
    const store = storeOn({ ...run, data });
    store.remove();
    const report = {};
    // As consents.mjs asks: a denial by the page where its request reaches page-permissions; an Allow by the page where
    // nothing the system asks follows it unanswered, else by the hook, of the same holder.
    const reaches = (kind) => PAGE_REACHES[platform].includes(kind);
    const denyVia = (kind) => (reaches(kind) ? 'page' : 'hook');
    const allowVia = (kind) => (reaches(kind) && (platform === 'android' || (platform === 'ios' && kind !== 'location')) ? 'page' : 'hook');
    const isAllowed = (answered, via) => (via === 'hook' ? answered === 'allowed' : answered !== 'denied' && !/^\w*Error: /.test(answered));

    let tags = 7000;
    const noted = (tag) => endpoint.notes.find((note) => note.event === 'requested' && note.tag === tag);
    async function start(kind, via, positionMs = platform === 'android' ? POSITION_MS : undefined) {
        const tag = (tags += 1);
        const position = kind === 'location' && positionMs ? { positionMs } : {};
        const started = await step('project', { do: 'request', requests: [{ tag, kinds: [kind], via, ...position }] });
        expect(started === 'started', `the project's request of ${kind} started as ${JSON.stringify(started)}`);
        return tag;
    }
    // The request's end; Android's own question for the app, which follows the extension's Allow, allowed meanwhile.
    async function outcome(tag) {
        const deadline = Date.now() + OUTCOME_MS;
        for (;;) {
            const done = noted(tag);
            if (done) return done.outcome;
            if (platform === 'android' && questions.system()) questions.allowSystem();
            expect(Date.now() < deadline, `request ${tag} did not end in ${OUTCOME_MS / 1000} s; the screen showed ${JSON.stringify(questions.screen())}`);
            await sleep(POLL_MS);
        }
    }
    async function noQuestion(what) {
        await sleep(SETTLED_MS);
        const up = await questions.read('project');
        expect(up === null, `${what} brought a question: ${JSON.stringify(up)}`);
    }
    async function questionOf(kind) {
        const message = messageOf(PROJECT, [kind]);
        const deadline = Date.now() + QUESTION_MS;
        for (;;) {
            const up = await questions.read('project');
            if (up?.texts.includes(message)) return message;
            expect(Date.now() < deadline, `no question of ${kind} came: ${JSON.stringify(up)}`);
            await sleep(POLL_MS);
        }
    }
    // A kind asked and answered at its question.
    async function answered(kind, button, via) {
        const tag = await start(kind, via);
        await questions.press('project', button, await questionOf(kind));
        return outcome(tag);
    }

    const adbShell = (...args) => spawnSync(adb(), ['shell', ...args], { encoding: 'utf8', timeout: TOOL_MS });
    // Android's Permissions: a dialog titled with the project's name, its check boxes or its message, and Done.
    function androidSurface() {
        const own = screenOf(adb()).filter((node) => node.package === applicationId());
        const title = own.find((node) => node['resource-id'] === 'android:id/alertTitle');
        const done = own.find((node) => node['resource-id'] === 'android:id/button1' && /^done$/i.test(node.text));
        if (!title || !done) return null;
        const message = own.find((node) => node['resource-id'] === 'android:id/message');
        const controls = own.filter((node) => node['resource-id'] === 'android:id/text1').map((node) => ({ words: node.text, on: node.checked === 'true', node }));
        return {
            name: title.text, nothing: message?.text === NOTHING, controls, done,
        };
    }
    // Permissions as its user sees it: the project's name, whether it says nothing was asked yet, its controls in order
    // with their states, and on iOS the window it is in; null where it is not up.
    async function surface() {
        if (isDesktop) {
            const all = ((await indicators.read('project')).items ?? []).filter((item) => item.words === 'Permissions');
            // The menu made anew at each change leaves none of its earlier Permissions behind.
            expect(all.length <= 1, `the menu holds ${all.length} Permissions: ${JSON.stringify(all)}`);
            const items = all[0]?.items;
            if (!items) return null;
            const [name, ...rest] = items;
            return {
                name: name?.words,
                nothing: rest.some((item) => item.words === NOTHING && !item.enabled),
                controls: rest.filter((item) => item.enabled).map(({ words, checked }) => ({ words, on: checked })),
            };
        }
        if (platform === 'ios') {
            const shown = (await indicators.read('project')).permissions;
            if (!shown) return null;
            return {
                name: shown.title,
                in: shown.in,
                nothing: shown.rows.length === 1 && shown.rows[0].words === NOTHING && shown.rows[0].on === null,
                controls: shown.rows.filter((row) => row.on !== null).map(({ words, on }) => ({ words, on })),
            };
        }
        return androidSurface();
    }
    // Permissions read, opened first where it is a surface of its own, a phone's, which then stays up.
    async function opened() {
        if (!isDesktop && !(await surface())) {
            if (platform === 'ios') await step('project', { do: 'pressIndicator', item: 'Permissions…' });
            else await indicators.press('project', 'Permissions…', 0, true);
        }
        const deadline = Date.now() + QUESTION_MS;
        for (;;) {
            const shown = await surface();
            if (shown) return shown;
            expect(Date.now() < deadline, 'Permissions did not show');
            await sleep(POLL_MS);
        }
    }
    const pagesSince = (from) => endpoint.notes.slice(from).filter((note) => note.event === 'page' && note.role === 'project');
    // A phone's surface closed at Done with nothing changed: no page starts.
    async function closed() {
        if (isDesktop) return;
        const from = endpoint.notes.length;
        if (platform === 'ios') await step('project', { do: 'pressIndicator', item: 'Done' });
        else adbShell('input', 'tap', ...centerOf(androidSurface().done));
        await sleep(SETTLED_MS);
        expect(await surface() === null, 'Permissions stayed after Done');
        expect(pagesSince(from).length === 0, `Permissions closed with nothing changed started ${JSON.stringify(pagesSince(from))}`);
    }

    const permissions = await stepsProject(PROJECT);
    const kept = (kind) => store.read()?.[permissions.origin]?.[kind];
    // These controls turned, then the surface closed: on a desktop each turn is a press of the menu's, which closes it,
    // so one turn at a time; on a phone the surface closes once, after all of them. The project's page starts anew at
    // the same origin, once.
    async function changed(words, what) {
        const from = endpoint.notes.length;
        const loaded = endpoint.waitForNote((note) => note.role === 'project' && note.loaded, LOAD_MS, `the project's page after ${what}`);
        if (isDesktop) {
            expect(words.length === 1, 'a desktop turns one control a press');
            await indicators.press('project', words[0]);
        } else if (platform === 'ios') {
            await opened();
            for (const each of words) await step('project', { do: 'pressIndicator', item: each });
            await indicators.press('project', 'Done');
        } else {
            let shown = await opened();
            for (const each of words) {
                const control = shown.controls.find((item) => item.words === each);
                expect(control, `Permissions has no ${each}: ${JSON.stringify(shown)}`);
                adbShell('input', 'tap', ...centerOf(control.node));
                await sleep(SETTLED_MS);
                shown = androidSurface();
            }
            // The page takes no next step, as Done will reload it.
            await step('project', { do: 'stop' });
            adbShell('input', 'tap', ...centerOf(shown.done));
        }
        const page = await loaded;
        await sleep(SETTLED_MS);
        expect(pagesSince(from).length === 1 && page.loaded === permissions.url.replace(/\/$/, ''), `${what} started ${JSON.stringify(pagesSince(from))}, loaded ${page.loaded}`);
    }
    const controlsOf = (shown) => JSON.stringify(shown.controls.map(({ words, on }) => ({ words, on })));

    await openSession(permissions.session, permissions.origin);

    // A project asked nothing: Permissions names it and says so, with no control.
    const empty = await opened();
    expect(empty.name === PROJECT && empty.nothing && empty.controls.length === 0, `Permissions of a project asked nothing read ${JSON.stringify(empty)}`);
    await closed();
    report.nothingAsked = NOTHING;

    // The camera allowed at its question and the location not: a control for each, on and off, in that order, and none
    // for the microphone.
    expect(isAllowed(await answered('camera', 'Allow', allowVia('camera')), allowVia('camera')), 'the camera was not allowed at its question');
    expect(await answered('location', "Don't Allow", denyVia('location')) === 'denied', "the location was allowed at its question's Don't Allow");
    const both = await opened();
    expect(both.name === PROJECT && controlsOf(both) === JSON.stringify([{ words: 'Camera', on: true }, { words: 'Location', on: false }]),
        `Permissions after Allow and Don't Allow read ${JSON.stringify(both)}`);
    report.controls = JSON.parse(controlsOf(both));
    await closed();

    // The camera turned off: the page anew, false kept, and the next request denied with no question.
    await changed(['Camera'], 'the camera turned off');
    expect(kept('camera') === false, `the camera turned off kept ${JSON.stringify(store.read())}`);
    expect(await outcome(await start('camera', denyVia('camera'))) === 'denied', 'the camera turned off was not denied');
    await noQuestion('the camera turned off');
    // The location turned on: the page anew, true kept, and the next request allowed with no question of the app's.
    await changed(['Location'], 'the location turned on');
    expect(kept('location') === true, `the location turned on kept ${JSON.stringify(store.read())}`);
    expect(isAllowed(await outcome(await start('location', allowVia('location'))), allowVia('location')), 'the location turned on was not allowed');
    await noQuestion('the location turned on');
    report.turned = { cameraOff: 'denied, false kept', locationOn: 'allowed, true kept' };
    // On Windows and Linux, where the requests above go by the hook, the page's own: its location, with a time of its
    // own as no position may come, allowed once turned on and denied once turned off again, so that neither web view
    // keeps an answer of its own past the reload.
    if (platform === 'windows' || platform === 'linux') {
        const onByPage = await outcome(await start('location', 'page', POSITION_MS));
        expect(isAllowed(onByPage, 'page'), `the location turned on was ${onByPage} to the page`);
        await changed(['Location'], 'the location turned off');
        const offByPage = await outcome(await start('location', 'page', POSITION_MS));
        expect(offByPage === 'denied', `the location turned off was ${offByPage} to the page`);
        report.byPage = { locationOn: onByPage, locationOff: offByPage };
    }

    // A store that cannot be written: a change holds for the run, and the output says so. Written again, a change takes
    // the place of the answer held for the run.
    const linesFrom = device.lines.length;
    store.unwritable();
    await changed(['Camera'], 'the camera turned on with a store that cannot be written');
    await device.waitFor(new RegExp(escaped(COULD_NOT_KEEP)), LINE_MS, `the app's line "${COULD_NOT_KEEP}"`, linesFrom);
    expect(kept('camera') === false, `a change the store could not take changed it: ${JSON.stringify(store.read())}`);
    expect(isAllowed(await outcome(await start('camera', allowVia('camera'))), allowVia('camera')), 'the camera turned on for the run was not allowed');
    store.writable();
    await changed(['Camera'], 'the camera turned off with the store written again');
    expect(kept('camera') === false && await outcome(await start('camera', denyVia('camera'))) === 'denied', 'the answer held for the run stood after a change was kept');
    report.held = 'held for the run, then replaced';

    // On a phone, two controls turned before the surface closes: the page anew, once, both kept.
    if (!isDesktop) {
        await changed(['Camera', 'Location'], 'two controls turned before Permissions closed');
        expect(kept('camera') === true && kept('location') === false, `two controls turned kept ${JSON.stringify(store.read())}`);
        report.twiceBeforeClose = 'one reload';
    }

    // A control turned as its preview ends, held past the end where a run can hold one: nothing kept, and no page of
    // the project's starts.
    if (platform === 'macos' || platform === 'ios') {
        const before = JSON.stringify(store.read());
        if (platform === 'ios') await opened();
        const from = endpoint.notes.length;
        const back = endpoint.waitForNote((note) => note.role === 'app' && note.loaded, LOAD_MS, "the app's page after a change held past the end");
        await indicators.presses('project', [{ item: 'Location', afterEnd: true, ms: 0 }]);
        await back;
        await sleep(SETTLED_MS);
        expect(JSON.stringify(store.read()) === before && pagesSince(from).length === 0, `a change past the end kept ${JSON.stringify(store.read())}, started ${JSON.stringify(pagesSince(from))}`);
        report.asItEnds = 'nothing kept, no page';
        await openSession(permissions.session, permissions.origin);
    }

    // iOS: Permissions is the pill's window's, above the page's own alert.
    if (platform === 'ios') {
        const noted = endpoint.waitForNote((note) => note.event === 'later' && note.tag === 'permissions-over-alert', LOAD_MS, 'the note of Permissions over the alert');
        await step('project', { do: 'noteLater', ms: 2500, tag: 'permissions-over-alert' });
        await step('project', {
            do: 'held',
            dialog: 'alert',
            text: DIALOG,
            presses: [{ item: 'Permissions…', ms: 1000 }, { item: 'Done', ms: 3500 }, { button: 'OK', words: PROJECT, ms: 4500 }],
            resume: true,
        });
        const { indicator, alerts } = await noted;
        expect(indicator.permissions?.in === 'pill' && alerts.some((alert) => alert.window === 'app' && alert.title === PROJECT),
            `with the page's alert up Permissions was ${JSON.stringify(indicator.permissions)} over ${JSON.stringify(alerts)}`);
        report.overAlert = "the pill's window, above the page's alert";
        await sleep(SETTLED_MS * 3);
    }

    await closePreview();
    store.remove();
    return report;
}

import state from '../state/index.js';
import extensionApi from './extensionApi.js';
import { publishersOf } from './publish.js';
import { extensionStep } from '../utils/appExtensions.js';
import { appDisplayName } from '../utils/appOptions.js';
import { hasTerminal } from '../utils/ask.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTexts = (value) => Array.isArray(value) && value.every((text) => typeof text === 'string');
const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]);
const unprefixed = (line) => line.replace(/^crossbind: /, '');

// The publishers crossbind app store tells of: the one it names, else every one whose publisher has a guide.
export function guidedPublishers(publishers, store) {
    const guided = publishers.filter(({ publisher }) => publisher.guide);
    if (store === undefined) return guided;
    const named = publishers.find(({ name }) => name === store);
    if (!named) throw new Error(`crossbind: crossbind app store tells of ${listed(guided.map(({ name }) => name))}, not ${store}.`);
    if (!named.publisher.guide) throw new Error(`crossbind: ${store}'s publisher has no guide, so it tells nothing of its store.`);
    return [named];
}

// The publishers crossbind app store --send sends the page of: the one it names, else every one whose publisher sends one.
export function sendingPublishers(publishers, store) {
    const sending = publishers.filter(({ publisher }) => publisher.send);
    if (store === undefined) return sending;
    const named = publishers.find(({ name }) => name === store);
    if (!named) throw new Error(`crossbind: crossbind app store --send sends the page of ${listed(sending.map(({ name }) => name))}, not ${store}.`);
    if (!named.publisher.send) throw new Error(`crossbind: ${store}'s publisher sends no page of its store.`);
    return [named];
}

// The platforms a store's page goes for: the one -p names, which its publisher takes, else every one it takes, as App
// Store Connect keeps an iOS app's page and a macOS app's apart.
export function pagePlatforms({ name, publisher }, platform) {
    if (platform === undefined) return publisher.platforms;
    if (!publisher.platforms.includes(platform)) throw new Error(`crossbind: ${name} takes ${listed(publisher.platforms)} apps, not ${platform}'s, which -p names.`);
    return [platform];
}

// A guide as its publisher gives it, which crossbind writes as it is: lines of what an upload sends, what --send sends,
// what the store would refuse, and the steps its own site takes, each a text, maybe with a link and the lines of its
// details.
export function checkedGuide(name, guide) {
    const isStep = (step) => isObject(step) && typeof step.text === 'string' && (step.url === undefined || typeof step.url === 'string')
        && (step.details === undefined || isTexts(step.details));
    if (!isObject(guide) || !isTexts(guide.publishes) || !isTexts(guide.sends) || !isTexts(guide.problems) || typeof guide.where !== 'string'
        || !Array.isArray(guide.steps) || !guide.steps.every(isStep)) {
        throw new Error(`crossbind: ${name}'s guide gives no { publishes, sends, problems, where, steps }: lines of what an upload sends, what crossbind app store --send sends, what the store would refuse, where the steps are done, and the steps, each { text, url, details }.`);
    }
    return guide;
}

// What a store has now, as its publisher's state gives it: lines crossbind writes as they are.
export function checkedState(name, lines) {
    if (!isTexts(lines)) throw new Error(`crossbind: ${name}'s state gives no list of lines of what its store has.`);
    return lines;
}

// The text crossbind app store writes of a store, with what it has now.
export function guideText({ name, publisher }, {
    publishes, sends, problems, where, steps,
}, app, now = []) {
    const store = publisher.store ?? name;
    const lines = [`${store} · ${app}`];
    if (publishes.length > 0) lines.push('', `crossbind app upload ${name} sends:`, ...publishes.map((line) => `  ✓ ${line}`));
    if (sends.length > 0) lines.push('', `crossbind app store ${name} --send sends:`, ...sends.map((line) => `  ✓ ${line}`));
    if (problems.length > 0) lines.push('', `To fix first, as ${store} would refuse it:`, ...problems.map((problem) => `  ✗ ${unprefixed(problem)}`));
    if (steps.length > 0) {
        lines.push('', `By hand in ${where}, once for the app:`, ...steps.flatMap(({ text, url, details = [] }, index) => [
            `  ${index + 1}. ${text}`, ...details.map((detail) => `     - ${detail}`), ...(url ? [`     ${url}`] : []),
        ]));
    }
    if (now.length > 0) lines.push('', `${store} has now:`, ...now.map((line) => `  ${unprefixed(line)}`));
    return lines.join('\n');
}

// What a store has now, as its publisher tells with no question, or the failure to tell, a line of its own, as it stops
// no guide.
async function stateOf({ name, publisher }, api) {
    try {
        return checkedState(name, await extensionStep(name, 'state', () => publisher.state(api)));
    } catch (error) {
        return [error.message];
    }
}

// The publishers of a store crossbind app store goes to, of those chosen: those that take apps of the platform -p
// names, and the one named, which has to.
function forPlatform(chosen, store, platform) {
    if (platform === undefined) return chosen;
    if (store !== undefined) return chosen.filter((extension) => pagePlatforms(extension, platform));
    const taking = chosen.filter(({ publisher }) => publisher.platforms.includes(platform));
    if (taking.length === 0) throw new Error(`crossbind: no store crossbind app store goes to takes ${platform} apps.`);
    return taking;
}

// Sends the page of each store, or the one named, for each platform its publisher takes, or the one -p names, with no
// build. A terminal asks for what is missing; without one every missing piece is named at once.
async function sendPages(publishers, store, platform) {
    const isGuided = hasTerminal();
    const missing = [];
    for (const extension of forPlatform(sendingPublishers(publishers, store), store, platform)) {
        for (const target of pagePlatforms(extension, platform)) {
            const api = extensionApi(extension.name, { platform: target, isGuided });
            const result = await extensionStep(extension.name, 'send', () => extension.publisher.send(api));
            missing.push(...(result?.missing ?? []));
        }
    }
    if (missing.length > 0) throw new Error([...new Set(missing)].join('\n'));
}

// Says of each store, or the one named, what crossbind app upload sends to it, what --send sends, what it would refuse
// of the project's page, the steps only its own site takes, and what it has now where crossbind can tell without asking,
// with no build. Gives how many problems it found, so a check of the page fails on any. With send, sends each store's
// page instead, with no build.
export default async function storeGuide(store, { send = false, platform } = {}) {
    const publishers = publishersOf(state.config.extensions);
    if (send) {
        await sendPages(publishers, store, platform);
        return 0;
    }
    const app = `${appDisplayName(state.config)} ${state.config.package?.version ?? '1.0.0'}`;
    let problems = 0;
    for (const [index, extension] of forPlatform(guidedPublishers(publishers, store), store, platform).entries()) {
        const api = extensionApi(extension.name, { platform: platform ?? extension.publisher.platforms[0], isGuided: false });
        const guide = checkedGuide(extension.name, await extensionStep(extension.name, 'guide', () => extension.publisher.guide(api)));
        const now = extension.publisher.state ? await stateOf(extension, api) : [];
        console.log(`${index > 0 ? '\n' : ''}${guideText(extension, guide, app, now)}`);
        problems += guide.problems.length;
    }
    return problems;
}

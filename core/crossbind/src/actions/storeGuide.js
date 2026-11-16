import state from '../state/index.js';
import extensionApi from './extensionApi.js';
import { publishersOf } from './publish.js';
import { extensionStep } from '../utils/appExtensions.js';
import { appDisplayName } from '../utils/appOptions.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTexts = (value) => Array.isArray(value) && value.every((text) => typeof text === 'string');
const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]);

// The publishers crossbind app store tells of: the one it names, else every one whose publisher has a guide.
export function guidedPublishers(publishers, store) {
    const guided = publishers.filter(({ publisher }) => publisher.guide);
    if (store === undefined) return guided;
    const named = publishers.find(({ name }) => name === store);
    if (!named) throw new Error(`crossbind: crossbind app store tells of ${listed(guided.map(({ name }) => name))}, not ${store}.`);
    if (!named.publisher.guide) throw new Error(`crossbind: ${store}'s publisher has no guide, so it tells nothing of its store.`);
    return [named];
}

// A guide as its publisher gives it, which crossbind writes as it is: lines of what a publish sends, what the store
// would refuse, and the steps its own site takes, each a text, maybe with a link and the lines of its details.
export function checkedGuide(name, guide) {
    const isStep = (step) => isObject(step) && typeof step.text === 'string' && (step.url === undefined || typeof step.url === 'string')
        && (step.details === undefined || isTexts(step.details));
    if (!isObject(guide) || !isTexts(guide.sends) || !isTexts(guide.problems) || typeof guide.where !== 'string'
        || !Array.isArray(guide.steps) || !guide.steps.every(isStep)) {
        throw new Error(`crossbind: ${name}'s guide gives no { sends, problems, where, steps }: lines of what a publish sends, what the store would refuse, where the steps are done, and the steps, each { text, url, details }.`);
    }
    return guide;
}

// The text crossbind app store writes of a store.
export function guideText({ name, publisher }, {
    sends, problems, where, steps,
}, app) {
    const lines = [`${publisher.store ?? name} · ${app}`];
    if (sends.length > 0) lines.push('', `crossbind app publish ${name} sends:`, ...sends.map((line) => `  ✓ ${line}`));
    if (problems.length > 0) {
        lines.push('', `To fix first, as ${publisher.store ?? name} refuses it and a publish stops before its build:`, ...problems.map((problem) => `  ✗ ${problem.replace(/^crossbind: /, '')}`));
    }
    if (steps.length > 0) {
        lines.push('', `By hand in ${where}, once for the app:`, ...steps.flatMap(({ text, url, details = [] }, index) => [
            `  ${index + 1}. ${text}`, ...details.map((detail) => `     - ${detail}`), ...(url ? [`     ${url}`] : []),
        ]));
    }
    return lines.join('\n');
}

// Says of each store, or the one named, what crossbind app publish sends to it, what it would refuse of the project's
// listing, and the steps only its own site takes, with no build and no credentials. Gives how many problems it found,
// so a check of the listing fails on any.
export default async function storeGuide(store) {
    const chosen = guidedPublishers(publishersOf(state.config.extensions), store);
    const app = `${appDisplayName(state.config)} ${state.config.package?.version ?? '1.0.0'}`;
    let problems = 0;
    for (const [index, extension] of chosen.entries()) {
        const api = extensionApi(extension.name, { platform: extension.publisher.platforms[0], isGuided: false });
        const guide = checkedGuide(extension.name, await extensionStep(extension.name, 'guide', () => extension.publisher.guide(api)));
        console.log(`${index > 0 ? '\n' : ''}${guideText(extension, guide, app)}`);
        problems += guide.problems.length;
    }
    return problems;
}

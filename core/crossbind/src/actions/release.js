import state from '../state/index.js';
import extensionApi from './extensionApi.js';
import { publishPlatforms, publishersOf, storeOf } from './publish.js';
import { extensionStep } from '../utils/appExtensions.js';
import { appStores } from '../utils/appOptions.js';
import { hasTerminal } from '../utils/ask.js';

const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]);
const PERCENT = /^\d+(\.\d{1,2})?%?$/;

// The percent of the users a release reaches at first, as --rollout gives it: 10, or 10%.
export function rolloutPercent(value) {
    const percent = PERCENT.test(value) ? Number.parseFloat(value) : Number.NaN;
    if (!(percent > 0 && percent <= 100)) {
        throw new Error(`crossbind: --rollout takes the percent of the users a release reaches at first, above 0 and at most 100 with two decimals at most, as 10 or 12.5%, not ${value}.`);
    }
    return percent;
}

// The share of users a release on the stores reaches at first, below 100, or null for all of them at once; one below 100
// stops before any store releases where a store puts the app out to every user at once.
export function stagedRollout(stores, rollout) {
    const percent = rollout === null ? null : rolloutPercent(rollout);
    if (percent === null || percent === 100) return null;
    const unstaged = stores.filter(({ publisher }) => !publisher.canStage).map(({ name }) => name);
    if (unstaged.length > 0) {
        const others = stores.filter(({ name }) => !unstaged.includes(name)).map(({ name }) => name);
        const them = unstaged.join(' and ');
        throw new Error(`crossbind: ${them} put${unstaged.length > 1 ? '' : 's'} the app out to every user at once, which --rollout ${rollout} cannot stage: release ${them} without --rollout${others.length > 0 ? `, and ${others.join(' and ')} by name with it` : ''}.`);
    }
    return percent;
}

// The stores crossbind app release puts the app out on: the one named, else those app.stores names that take apps of
// the platform -p or CROSSBIND_APP_PLATFORM names, or all of them without it, else the one that goes first for that
// platform.
export function releaseStores(publishers, {
    store, platform, envPlatform, stores = null,
}) {
    const releasing = publishers.filter(({ publisher }) => publisher.release).map(({ name }) => name);
    const known = (name) => {
        const extension = publishers.find((one) => one.name === name);
        if (!extension) throw new Error(`crossbind: crossbind app release puts the app out on ${listed(releasing)}, not ${name}.`);
        if (!extension.publisher.release) throw new Error(`crossbind: ${name}'s publisher puts nothing out, as it has no release.`);
        return extension;
    };
    if (store) return [known(store)];
    const where = platform ?? envPlatform;
    const named = (stores ?? []).map(known).filter(({ publisher }) => !where || publisher.platforms.includes(where));
    if (named.length > 0) return named;
    const usual = storeOf([], platform, envPlatform, publishers).store;
    if (usual) return [known(usual)];
    throw new Error(`crossbind: crossbind app release takes the store it puts the app out on: ${listed(releasing)}, or app.stores in crossbind.config.js names them.`);
}

// Puts out to everyone what a store's testers have, with no build, on the store named or each app.stores names, for
// each platform its publisher takes or the one -p names: App Review, production, certification or the release out, as
// the store does it, --rollout's percent giving the share of users it reaches at first. A terminal asks for what is
// missing; without one, every missing piece of every store is named at once.
export default async function release(args, { platform, envPlatform, rollout = null }) {
    const publishers = publishersOf(state.config.extensions);
    const stores = releaseStores(publishers, {
        store: args[0], platform, envPlatform, stores: appStores(state.config),
    });
    const staged = stagedRollout(stores, rollout);
    const isGuided = hasTerminal();
    const missing = [];
    for (const extension of stores) {
        for (const target of publishPlatforms([extension], platform, envPlatform)) {
            const api = extensionApi(extension.name, { platform: target, options: { rollout: staged }, isGuided });
            const result = await extensionStep(extension.name, 'release', () => extension.publisher.release(api));
            missing.push(...(result?.missing ?? []));
        }
    }
    if (missing.length > 0) throw new Error([...new Set(missing)].join('\n'));
}

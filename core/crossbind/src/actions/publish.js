import state from '../state/index.js';
import loadConfig from '../state/loadConfig.js';
import {
    DESKTOP_PLATFORMS, MAX_VERSION_CODE, appOutputOf, clearAppOutputs,
} from './buildApp.js';
import extensionApi from './extensionApi.js';
import {
    PUBLISH_PLATFORMS, extensionStep, isJsonValue, ownExtensions, withListed, withoutNamed,
} from '../utils/appExtensions.js';
import { CONFIG_CHANGES } from '../utils/configChanges.js';
import { hasTerminal } from '../utils/ask.js';
import resolveAppHostRoot from '../utils/resolveAppHost.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const possessive = (name) => (name.endsWith('s') ? `${name}'` : `${name}'s`);
const listed = (names, word = 'or') => (names.length > 1 ? `${names.slice(0, -1).join(', ')} ${word} ${names.at(-1)}` : names[0]);
const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const camel = (name) => name.replace(/-([a-z0-9])/g, (dash, letter) => letter.toUpperCase());
const storeName = ({ name, publisher }) => publisher.store ?? name;
// How many builds a publish makes at most, as its first publisher may ask for another.
const MAX_BUILDS = 4;

// A step of the publisher's, which its publisher may lack.
const step = ({ name, publisher }, which, ...args) => extensionStep(name, which, () => publisher[which]?.(...args));

// crossbind's own publishers, which the host brings as it brings its other extensions.
export const builtInPublishers = () => withoutNamed(ownExtensions(resolveAppHostRoot()), state.config?.app).filter(({ publisher }) => publisher);

// The publishers an app has: crossbind's own, each in the place of the app's extension of its name that has a
// publisher, then those of the app's other extensions.
export const publishersOf = (extensions) => withListed(builtInPublishers(), extensions.filter((extension) => extension.publisher));

// The store the command names first, before the options, else the last publisher that says it is the one of the platform
// -p, or CROSSBIND_APP_PLATFORM, names, and the arguments after it. A store named after the options, of those crossbind
// knows, is refused, as Vite would take it.
export function storeOf(args, platform, envPlatform, publishers = []) {
    const [first, ...rest] = args;
    const named = first !== undefined && !first.startsWith('-') ? first : null;
    const late = named ? null : args.find((arg) => publishers.some(({ name }) => name === arg));
    if (late) throw new Error(`crossbind: crossbind app publish takes the store first, before the options: crossbind app publish ${late} ${args.filter((arg) => arg !== late).join(' ')}.`);
    const where = platform ?? envPlatform;
    const usual = publishers.findLast(({ publisher }) => publisher.isDefault && publisher.platforms.includes(where));
    return { store: named ?? usual?.name ?? null, rest: named ? rest : args };
}

// The publisher of a store, after those it comes after, first to last.
export function publishChain(publishers, store) {
    if (!publishers.some(({ name }) => name === store)) {
        throw new Error(`crossbind: crossbind app publish takes the store it sends the app to first: ${listed(publishers.map(({ name }) => name))}${store ? `, not ${store}` : ''}.`);
    }
    const chain = [];
    for (let current = store; current;) {
        const extension = publishers.find(({ name }) => name === current);
        if (!extension) throw new Error(`crossbind: ${chain[0].name} comes after ${current}, which no publisher is named.`);
        if (chain.includes(extension)) throw new Error(`crossbind: ${listed([extension, ...chain].map(({ name }) => name), 'and')} come after one another in a circle.`);
        chain.unshift(extension);
        current = extension.publisher.after;
    }
    return chain;
}

// The platform a publish builds for: the one -p names, which every publisher of it takes, else the only one they take,
// else CROSSBIND_APP_PLATFORM's, else this machine's desktop one.
export function publishPlatform(chain, platform, envPlatform, host = process.platform) {
    const store = chain.at(-1).name;
    const platforms = chain.reduce((taken, { publisher }) => taken.filter((one) => publisher.platforms.includes(one)), PUBLISH_PLATFORMS);
    if (platforms.length === 0) throw new Error(`crossbind: ${store} comes after ${chain[0].name}, which takes apps of none of its platforms.`);
    const takes = `${store} takes ${listed(platforms)} apps`;
    if (platform) {
        if (!platforms.includes(platform)) throw new Error(`crossbind: ${takes}, not ${possessive(platform)}, which -p names.`);
        return platform;
    }
    if (platforms.length === 1) return platforms[0];
    if (envPlatform) {
        if (!platforms.includes(envPlatform)) throw new Error(`crossbind: ${takes}, not ${possessive(envPlatform)}, which CROSSBIND_APP_PLATFORM names.`);
        return envPlatform;
    }
    if (platforms.includes(DESKTOP_PLATFORMS[host])) return DESKTOP_PLATFORMS[host];
    throw new Error(`crossbind: ${takes}: name one with -p.`);
}

// The options of each publisher of a publish, as the command line gives them, and the arguments Vite takes. An option
// that another publisher takes is refused, naming whose it is; any other goes on to Vite.
export function publishOptions(chain, args, publishers) {
    const kinds = new Map();
    chain.forEach(({ name, publisher }) => Object.entries(publisher.options).forEach(([option, { value }]) => {
        const first = kinds.get(option);
        if (first && (first.value === null) !== (value === null)) {
            throw new Error(`crossbind: ${first.name} and ${name} both take --${kebab(option)}, one as a flag and one with a value: one of them names it otherwise.`);
        }
        if (!first) kinds.set(option, { name, value });
    }));
    const given = new Map(chain.map(({ name }) => [name, new Map()]));
    const foreign = new Map();
    const viteArgs = [];
    for (let index = 0; index < args.length; index += 1) {
        const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/s.exec(args[index]);
        const option = match && camel(match[1]);
        const owners = match ? chain.filter(({ publisher }) => Object.hasOwn(publisher.options, option)) : [];
        if (owners.length === 0) {
            const other = match && publishers.find(({ publisher }) => Object.hasOwn(publisher.options, option));
            if (other) foreign.set(other.name, [...(foreign.get(other.name) ?? []), `--${match[1]}`]);
            else viteArgs.push(args[index]);
            continue;
        }
        const { value: placeholder } = owners.at(-1).publisher.options[option];
        let value = true;
        if (placeholder !== null && match[2] === undefined) {
            value = args[index + 1];
            index += 1;
            if (value === undefined || value.startsWith('-')) throw new Error(`crossbind: --${match[1]} takes a value, as ${placeholder}.`);
        } else if (placeholder !== null) {
            value = match[2];
        } else if (match[2] !== undefined) {
            throw new Error(`crossbind: --${match[1]} takes no value.`);
        }
        owners.forEach(({ name }) => given.get(name).set(option, value));
    }
    if (foreign.size > 0) {
        const whose = [...foreign].map(([owner, names]) => `${listed(names, 'and')} ${names.length > 1 ? 'are' : 'is'} ${possessive(owner)}`);
        throw new Error(`crossbind: ${listed(whose, 'and')}, which ${chain.at(-1).name} takes none of.`);
    }
    const options = Object.fromEntries(chain.map(({ name, publisher }) => [name, Object.fromEntries(Object.entries(publisher.options)
        .map(([option, { value, default: fallback }]) => [option, given.get(name).get(option) ?? (value === null ? false : fallback)]))]));
    return { options, viteArgs };
}

// The help of the stores crossbind publishes to itself, with the options each takes after its name.
export function publishHelp(publishers = builtInPublishers()) {
    const signature = (option, { value }) => `--${kebab(option)}${value ? ` ${value}` : ''}`;
    const width = Math.max(...publishers.flatMap(({ publisher }) => Object.entries(publisher.options).map(([option, declared]) => signature(option, declared).length)));
    return [
        '',
        'Stores, each with the options it takes after its name:',
        ...publishers.flatMap(({ name, publisher }) => [
            `  ${name}: ${storeName({ name, publisher })}, for ${listed(publisher.platforms)} apps${publisher.isDefault ? ', which goes first for them' : ''}`,
            ...Object.entries(publisher.options).map(([option, declared]) => `    ${signature(option, declared).padEnd(width)}  ${declared.help}${declared.default ? ` (default: ${declared.default})` : ''}`),
        ]),
        "An app's extensions add stores of their own, each with the options its package gives.",
    ].join('\n');
}

// The changes the first publisher makes to the config for its build: a JSON merge patch of crossbind.config.js's
// export.
async function buildChanges(extension, api) {
    const { name } = extension;
    const changes = await step(extension, 'build', api);
    if (changes === null || changes === undefined) return null;
    if (!isObject(changes) || !isJsonValue(changes)) {
        throw new Error(`crossbind: ${name}'s build gives no changes to crossbind.config.js, which are an object of JSON values merged into its export, where null removes a key.`);
    }
    return changes;
}

// Hands the build's output to the uploads of the publishers after the first, each with what the one before it put out.
async function uploadAfter(chain, apis, sessions, output, firstPublished) {
    let published = firstPublished;
    for (const [index, extension] of chain.entries()) {
        const { name } = extension;
        if (index > 0) {
            const answer = await step(extension, 'upload', apis[index], sessions[index], output, published);
            if (answer?.isRebuildAsked) throw new Error(`crossbind: ${name} asks for another build, which ${chain[0].name}, whose build it publishes from, alone can ask for.`);
            published = answer?.published;
        }
    }
}

// Sends an app to a store through its publisher, after those it comes after. All they need is checked before the build,
// which takes minutes: on a terminal they ask for what is missing and set it up; without one, as in CI, every missing
// piece is named at once. crossbind then builds the app once, with the first publisher's changes to the config, build
// number and environment, and hands its output to each one's upload in turn. The first may ask for another build, as
// an iOS app's does once its user has given Apple's reasons for an API it calls.
export default async function publish(args, { platform, envPlatform, runVite }) {
    const publishers = publishersOf(state.config.extensions);
    const { store, rest } = storeOf(args, platform, envPlatform, publishers);
    const chain = publishChain(publishers, store);
    const own = builtInPublishers().map(({ name }) => name);
    chain.filter((extension) => own.includes(extension.name) && state.config.extensions.includes(extension))
        .forEach(({ name, root }) => console.log(`crossbind: the extension ${name} of ${root} replaces crossbind's own publisher of its name.`));
    const target = publishPlatform(chain, platform, envPlatform);
    const { options, viteArgs } = publishOptions(chain, rest, publishers);
    const run = { buildNumber: undefined };
    const isGuided = hasTerminal();
    const apis = chain.map(({ name }) => extensionApi(name, {
        platform: target, options: options[name], isGuided, run,
    }));
    const [first] = chain;
    const changes = await buildChanges(first, apis[0]);
    if (changes) state.config = await loadConfig(undefined, undefined, { changes });
    const checked = [];
    for (const [index, extension] of chain.entries()) checked.push((await step(extension, 'check', apis[index])) ?? {});
    const missing = checked.flatMap((result) => result.missing ?? []);
    if (missing.length > 0) throw new Error(missing.join('\n'));
    const sessions = checked.map(({ session }) => session);
    run.buildNumber = (await step(first, 'buildNumber', apis[0], sessions[0])) ?? null;
    if (run.buildNumber !== null && !(Number.isInteger(run.buildNumber) && run.buildNumber >= 1 && run.buildNumber <= MAX_VERSION_CODE)) {
        throw new Error(`crossbind: ${first.name}'s buildNumber gives ${JSON.stringify(run.buildNumber)}, which is no build number: a whole number from 1 to ${MAX_VERSION_CODE}, as both stores take, or null for the app's own.`);
    }
    for (let builds = 1; ; builds += 1) {
        clearAppOutputs();
        const buildEnv = await step(first, 'buildEnv', apis[0], sessions[0]);
        const exitCode = await runVite(['build', ...viteArgs], {
            ...process.env,
            ...(changes ? { [CONFIG_CHANGES]: JSON.stringify(changes) } : {}),
            ...buildEnv,
            CROSSBIND_APP_PLATFORM: target,
            ...(run.buildNumber === null ? {} : { CROSSBIND_APP_BUILD_NUMBER: String(run.buildNumber) }),
        });
        if (exitCode !== 0) {
            throw Object.assign(new Error(`crossbind: the build ended with exit code ${exitCode}, so nothing went to ${storeName(first)}.`), { exitCode });
        }
        const output = appOutputOf(target);
        const answer = await step(first, 'upload', apis[0], sessions[0], output);
        if (!answer?.isRebuildAsked) {
            await uploadAfter(chain, apis, sessions, output, answer?.published);
            return;
        }
        if (builds === MAX_BUILDS) throw new Error(`crossbind: ${first.name} asks for another build after ${MAX_BUILDS}, as many as a publish makes.`);
    }
}

import fs from 'node:fs';
import { createRequire } from 'node:module';
import upath from 'upath';
import { projectPaths } from '../state/loadConfig.js';
import { listedExtension } from '../utils/appExtensions.js';
import { crossbindExtensions } from '../utils/crossbindExtensions.js';
import apiHandle from './apiHandle.js';

// crossbind() is the one plugin crossbind gives every tool. It names no tool: at the first use of the object it hands a
// tool, it asks the project's integrations whose use that is, and the one that says yes makes the plugin the object
// stands for from then on. A tool with no plugin list takes crossbind(config) around its config instead.

// The files crossbind's config is read from, in the order its state looks for them.
const CONFIG_FILES = ['json', 'js', 'mjs', 'cjs', 'ts'].map((ext) => `crossbind.config.${ext}`);

// The project's config, read as the tool's config loads, which waits for nothing.
function projectConfig(root) {
    const file = CONFIG_FILES.map((name) => upath.join(root, name)).find((candidate) => fs.existsSync(candidate));
    if (!file) return {};
    let config;
    try {
        config = file.endsWith('.json') ? JSON.parse(fs.readFileSync(file, 'utf8')) : createRequire(file)(file);
    } catch (error) {
        const why = error.code === 'ERR_REQUIRE_ASYNC_MODULE' ? ', which crossbind() reads as the tool\'s config loads, so it takes no top-level await' : '';
        throw new Error(`crossbind: cannot read ${file}${why}: ${error.message}`, { cause: error });
    }
    if (config?.default) config = config.default;
    if (typeof config === 'function') config = config();
    if (typeof config?.then === 'function') {
        throw new Error(`crossbind: ${file} gives a Promise, which crossbind() cannot wait for as the tool's config loads: export the config itself.`);
    }
    return config ?? {};
}

// The integrations crossbind.config.js lists, each checked as crossbind's state checks the extensions it lists.
function listedIntegrations(root) {
    const config = projectConfig(root);
    if (!Array.isArray(config.extensions)) return [];
    const { base } = projectPaths(config.paths ?? {}, root);
    return config.extensions.flatMap((extension, i) => (extension?.integration ? [listedExtension(extension, `extensions[${i}]`, base)] : []));
}

const integrationsByRoot = new Map();

// A project's integrations, in the order they are asked: those crossbind.config.js lists, then crossbind's own, but one
// that a listed one of its name takes the place of.
export function projectIntegrations(root = process.cwd()) {
    if (!integrationsByRoot.has(root)) {
        const listed = listedIntegrations(root);
        const own = crossbindExtensions().filter(({ name, integration }) => integration && !listed.some((it) => it.name === name));
        integrationsByRoot.set(root, [...listed, ...own]);
    }
    return integrationsByRoot.get(root);
}

const namesOf = (integrations) => integrations.map(({ name }) => name).join(', ');

// A key of the chosen plugin as the object a tool holds shows it, which the tool may copy.
function described(chosen, key) {
    const own = Reflect.getOwnPropertyDescriptor(chosen, key);
    return own && { value: chosen[key], writable: true, enumerable: own.enumerable, configurable: true };
}

// crossbind() over the integrations integrationsOf gives as it is called.
export function createCrossbind(integrationsOf) {
    return function crossbind(config) {
        const integrations = integrationsOf();
        if (config !== undefined) {
            const owner = integrations.find(({ integration }) => integration.wraps?.(config));
            if (!owner) {
                throw new Error(`crossbind: crossbind(config) got a config none of this project's integrations (${namesOf(integrations)}) wraps: list the extension for its tool in crossbind.config.js.`);
            }
            return owner.integration.wrap(apiHandle(owner.name), config);
        }
        let chosen = null;
        const choose = (use) => {
            if (chosen) return chosen;
            const owner = integrations.find(({ integration }) => integration.claims?.(use));
            if (owner) chosen = owner.integration.plugin(apiHandle(owner.name));
            return chosen;
        };
        const unclaimed = (key) => {
            throw new Error(`crossbind: crossbind() was called (${String(key)}) by a tool none of this project's integrations (${namesOf(integrations)}) takes: list the extension for it in crossbind.config.js.`);
        };
        // The methods the integrations say their tools call first; a read no integration claims is undefined, as of a
        // plain object.
        const target = { name: 'crossbind' };
        for (const key of new Set(integrations.flatMap(({ integration }) => integration.calls ?? []))) {
            target[key] = (...args) => (choose({ key, args }) ?? unclaimed(key))[key](...args);
        }
        return new Proxy(target, {
            get: (t, key) => (chosen ? chosen[key] : key in t ? t[key] : choose({ key })?.[key]),
            set: (t, key, value) => Reflect.set(chosen ?? t, key, value),
            has: (t, key) => key in (chosen ?? t),
            deleteProperty: (t, key) => Reflect.deleteProperty(chosen ?? t, key),
            ownKeys: (t) => Reflect.ownKeys(chosen ?? t),
            getOwnPropertyDescriptor: (t, key) => (chosen ? described(chosen, key) : Reflect.getOwnPropertyDescriptor(t, key)),
        });
    };
}

export default createCrossbind(() => projectIntegrations());

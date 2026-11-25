import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import upath from 'upath';
import { afterEach, describe, expect, test, vi } from 'vitest';
import apiHandle from '../src/integration/apiHandle.js';
import { createCrossbind, projectIntegrations } from '../src/integration/crossbind.js';

vi.mock('../src/integration/api.js', () => ({ default: () => Object.freeze({ targets: { release: 'wasm32' } }) }));
// crossbind's own: two integrations, and a package source, which is none.
vi.mock('../src/utils/crossbindExtensions.js', () => ({
    crossbindExtensions: () => [
        { name: 'conan', packageSource: {} },
        { name: 'metro', integration: { wraps: () => false, wrap: () => ({}) } },
        { name: 'vite', integration: { calls: ['apply'], claims: () => false, plugin: () => ({}) } },
    ],
}));

const SRC = upath.join(import.meta.dirname, '..', 'src');

// Two made-up tools: alpha calls start(options) first, beta reads its setup hook first; and gamma, which has no plugin
// list and takes its config wrapped.
const alpha = {
    name: 'alpha',
    integration: {
        calls: ['start'],
        claims: ({ key, args }) => key === 'start' && args?.[0]?.tool === 'alpha',
        plugin: (api) => ({ name: 'alpha-plugin', api, start: (options) => `alpha started for ${options.tool}`, hook: () => 'alpha hook' }),
    },
};
const beta = {
    name: 'beta',
    integration: {
        claims: ({ key, args }) => key === 'setup' && args === undefined,
        plugin: () => ({ name: 'beta-plugin', setup: { order: 'pre', handler: () => 'beta setup' } }),
    },
};
const gamma = { name: 'gamma', integration: { wraps: (config) => 'gamma' in config, wrap: (api, config) => ({ ...config, api, wrapped: true }) } };
const crossbind = createCrossbind(() => [alpha, beta, gamma]);

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

// A project folder whose crossbind.config.mjs is this source.
function projectWith(configSource) {
    const root = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-facade-'))));
    roots.push(root);
    fs.writeFileSync(upath.join(root, 'package.json'), JSON.stringify({ name: 'facade-project', type: 'module' }));
    fs.writeFileSync(upath.join(root, 'crossbind.config.mjs'), configSource);
    return root;
}

describe('crossbind()', () => {
    test('becomes the plugin of the integration that claims the tool\'s first call, and answers it', () => {
        const plugin = crossbind();
        expect(plugin.start({ tool: 'alpha' })).toBe('alpha started for alpha');
        expect(plugin.name).toBe('alpha-plugin');
        expect(plugin.hook()).toBe('alpha hook');
    });

    test("becomes the plugin of the integration that claims the tool's first read, whose hook objects it hands as they are", () => {
        const plugin = crossbind();
        expect(plugin.then).toBeUndefined();
        const { setup } = plugin;
        expect(setup).toEqual({ order: 'pre', handler: expect.any(Function) });
        expect(plugin.setup).toBe(setup);
        expect(plugin.name).toBe('beta-plugin');
    });

    test("is crossbind's own object until a use chooses, and lists the chosen plugin's keys after, which a tool may copy", () => {
        const plugin = crossbind();
        expect(Object.keys(plugin)).toEqual(['name', 'start']);
        expect(plugin.name).toBe('crossbind');
        plugin.start({ tool: 'alpha' });
        expect(Object.keys(plugin)).toEqual(['name', 'api', 'start', 'hook']);
        const copy = Object.assign({}, plugin);
        expect(copy.hook()).toBe('alpha hook');
        expect('hook' in plugin).toBe(true);
    });

    test("stops a call no integration claims, naming the project's integrations", () => {
        expect(() => crossbind().start({ tool: 'delta' })).toThrow(
            "crossbind: crossbind() was called (start) by a tool none of this project's integrations (alpha, beta, gamma) takes: list the extension for it in crossbind.config.js.",
        );
    });

    test('wraps a config the integration that says it is its tool\'s, else names the integrations', () => {
        expect(crossbind({ gamma: 1 })).toMatchObject({ gamma: 1, wrapped: true });
        expect(() => crossbind({ delta: 1 })).toThrow(
            "crossbind: crossbind(config) got a config none of this project's integrations (alpha, beta, gamma) wraps: list the extension for its tool in crossbind.config.js.",
        );
    });
});

describe("an integration's api", () => {
    test('loads crossbind\'s state on ready() alone, and reads before it name the integration', async () => {
        const api = apiHandle('alpha');
        expect(() => api.targets).toThrow('crossbind: the alpha integration read api.targets before api.ready() resolved.');
        expect(api.then).toBeUndefined();
        expect(await api.ready()).toBe(api);
        expect(api.targets).toEqual({ release: 'wasm32' });
        expect(api.ready()).toBe(api.ready());
    });

    test('names the module a worker of the tool makes an api of its own with, and the headers that isolate a page, and does not change', () => {
        const { api } = crossbind({ gamma: 1 });
        expect(upath.normalize(decodeURIComponent(new URL(api.workerModule).pathname)).endsWith('/src/integration/api.js')).toBe(true);
        expect(api.isolationHeaders).toEqual({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
        expect(() => { api.targets = null; }).toThrow('crossbind: the api crossbind() gives the gamma integration does not change.');
    });
});

describe("a project's integrations", () => {
    const listed = (name, integration) => `{ contract: 5, name: '${name}', root: import.meta.dirname, integration: ${integration} }`;

    test("are those crossbind.config lists, asked first, then crossbind's own, one of which a listed one of its name replaces", () => {
        const root = projectWith(`export default { extensions: [
            ${listed('farm', "{ calls: ['apply'], claims: () => false, plugin: () => ({}) }")},
            ${listed('vite', '{ wraps: () => false, wrap: (api, config) => config }')},
            { contract: 1, name: 'clipboard', root: import.meta.dirname, app: {} },
        ] };`);
        const integrations = projectIntegrations(root);
        expect(integrations.map(({ name }) => name)).toEqual(['farm', 'vite', 'metro']);
        expect(integrations[1].integration.wraps).toBeTypeOf('function');
        expect(projectIntegrations(projectWith('export default {};')).map(({ name }) => name)).toEqual(['metro', 'vite']);
    });

    test('are read as the tool\'s config loads: a config that waits stops, saying what to do', () => {
        const waits = projectWith('await Promise.resolve();\nexport default {};');
        expect(() => projectIntegrations(waits)).toThrow("which crossbind() reads as the tool's config loads, so it takes no top-level await");
        const promised = projectWith('export default async () => ({ extensions: [] });');
        expect(() => projectIntegrations(promised)).toThrow(
            `crossbind: ${upath.join(promised, 'crossbind.config.mjs')} gives a Promise, which crossbind() cannot wait for as the tool's config loads: export the config itself.`,
        );
    });

    test('stop on a listed integration that is not one, as crossbind\'s state would', () => {
        const root = projectWith(`export default { extensions: [${listed('farm', '{ claims: () => false }')}] };`);
        expect(() => projectIntegrations(root)).toThrow("crossbind: extensions[0]'s integration gives claims: it gives claims and plugin");
    });
});

describe("crossbind's one export", () => {
    test('is crossbind(), which require gives as well, as no module it loads waits at its top level', () => {
        const entry = upath.join(SRC, 'index.js');
        const script = `const c = require(${JSON.stringify(entry)}); process.stdout.write(typeof c + ' ' + c.name);`;
        expect(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })).toBe('function crossbind');
    });

    test('names no tool where it chooses an integration', () => {
        const TOOLS = /\b(vite|rollup|rolldown|webpack|rspack|metro|expo|esbuild|turbopack|parcel|next\.?js)\b/i;
        const named = ['crossbind.js', 'apiHandle.js']
            .flatMap((file) => fs.readFileSync(upath.join(SRC, 'integration', file), 'utf8').split('\n').map((line, i) => [file, i + 1, line]))
            .filter(([, , line]) => TOOLS.test(line))
            .map(([file, line]) => `${file}:${line}`);
        expect(named).toEqual([]);
    });
});

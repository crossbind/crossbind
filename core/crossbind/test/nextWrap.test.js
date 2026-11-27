import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';

// crossbind(nextConfig) on an api whose builds are stood in for: the config Next is handed for `next build` and for
// `next dev`, as Next calls a config function with its phase.
const { default: wrap } = await import('../../../extensions/next/src/wrap.js');
const { default: nextExtension } = await import('../../../extensions/next/crossbind.extension.js');
const { appSourceImports } = await import('../src/utils/appSources.js');

const BUILD = 'phase-production-build';
const DEV = 'phase-development-server';
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
const target = (buildType, runtime) => ({
    platform: 'wasm', arch: 'wasm32', runtime, buildType, runtimeEnv: 'browser', path: `wasm-wasm32-${runtime}-${buildType}`,
});
// webpack as Next hands it to the config's hook.
class NormalModuleReplacementPlugin {
    constructor(test, replace) {
        this.test = test;
        this.replace = replace;
    }
}
const webpackContext = { webpack: { NormalModuleReplacementPlugin } };
let project;

function fakeApi({ runtime = 'st' } = {}) {
    const release = target('release', runtime);
    const debug = target('debug', runtime);
    const files = {
        'cargo:uuid': upath.join(project, '.crossbind', 'rust-crates', 'uuid.rs'),
        'dep/x.h': upath.join(project, 'node_modules', 'dep', 'include', 'x.h'),
    };
    const api = {
        ready: vi.fn(async () => {}),
        dirs: { project },
        targets: { release, debug },
        prepare: vi.fn(async () => {}),
        workerModule: 'file:///crossbind/src/integration/api.js',
        ext: { header: ['h'], module: ['i'], source: ['cpp'] },
        rustPackages: () => [{ name: 'rusty', entry: upath.join(project, 'rusty', 'src', 'lib.rs') }],
        appImports: () => appSourceImports(project),
        kindOf: (file) => (file.endsWith('.h') ? 'header' : null),
        // As crossbind answers a `cargo:` import of a crate crossbind.config.js does not declare.
        resolve: (request) => {
            if (request === 'cargo:gone') throw new Error("crossbind: 'cargo:gone' is not declared - add 'gone' to packages.cargo in crossbind.config.");
            return files[request] ?? null;
        },
        isolationHeaders: ISOLATION,
        link: vi.fn(async () => {}),
        writeOutputs: vi.fn(),
        serve: vi.fn(() => (req, res, next) => (req.url === '/crossbind.js' ? res.end('glue') : next())),
    };
    return { api, release, debug };
}

beforeEach(() => {
    project = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-next-wrap-'))));
    fs.mkdirSync(upath.join(project, 'app'));
    fs.writeFileSync(upath.join(project, 'app', 'page.jsx'), [
        "import { useEffect } from 'react';",
        "import { initNative, Native } from './native.h';",
        "import { Uuid } from 'cargo:uuid';",
        "import { x } from 'dep/x.h';",
        "import { tag } from 'rusty';",
    ].join('\n'));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    delete process.env.NEXT_RUNTIME;
});

describe('crossbind(nextConfig)', () => {
    test('is taken while Next loads its config, an object or a function, and by no tool else', () => {
        const { integration } = nextExtension();
        expect(integration.wraps({})).toBe(false);
        process.env.NEXT_RUNTIME = 'nodejs';
        expect(integration.wraps({})).toBe(true);
        expect(integration.wraps(() => ({}))).toBe(true);
        expect(integration.wraps(null)).toBe(false);
    });

    test("gives `next build` the loader under Turbopack and webpack, the named imports' files, and the release glue after the compile", async () => {
        const { api, release } = fakeApi();
        const config = await wrap(api, { reactStrictMode: true })(BUILD, {});

        expect(config.reactStrictMode).toBe(true);
        expect(api.prepare).toHaveBeenCalledWith(release);
        expect(Object.keys(config.turbopack.rules)).toEqual(['*.h', '*.i', '*.rs']);
        const [loader] = config.turbopack.rules['*.h'].loaders;
        expect(config.turbopack.rules['*.h'].as).toBe('*.js');
        expect(loader.options).toEqual({ workerModule: api.workerModule, base: '/_next/static/crossbind/' });
        // Turbopack takes a target relative to the project; a relative import names a file already.
        expect(config.turbopack.resolveAlias).toEqual({
            'cargo:uuid': './.crossbind/rust-crates/uuid.rs', 'dep/x.h': './node_modules/dep/include/x.h', rusty: './rusty/src/lib.rs',
        });
        expect(config.rewrites).toBeUndefined();
        expect(config.headers).toBeUndefined();

        const webpackConfig = config.webpack({ module: { rules: [] }, plugins: [] }, webpackContext);
        expect(webpackConfig.module.rules).toEqual([{ test: expect.any(RegExp), use: [loader] }]);
        expect(['a.h', 'a.i', 'a.rs', 'a.js'].map((file) => webpackConfig.module.rules[0].test.test(file))).toEqual([true, true, true, false]);
        const [replacement] = webpackConfig.plugins;
        const named = { request: 'cargo:uuid' };
        const other = { request: 'react' };
        replacement.replace(named);
        replacement.replace(other);
        expect(named.request).toBe(upath.join(project, '.crossbind', 'rust-crates', 'uuid.rs'));
        expect(other.request).toBe('react');

        const distDir = upath.join(project, '.next');
        await config.compiler.runAfterProductionCompile({ projectDir: project, distDir });
        expect(api.link).toHaveBeenCalledWith(release, { prepare: true, allBridges: true });
        expect(upath.normalize(api.writeOutputs.mock.calls[0][1])).toBe(upath.join(distDir, 'static', 'crossbind'));
    });

    test('names no file for an import in a comment, so one of a crate since taken out of the config stops nothing', async () => {
        fs.appendFileSync(upath.join(project, 'app', 'page.jsx'), [
            '',
            "// import { Gone } from 'cargo:gone';",
            "/* import { y } from 'dep/y.h'; */",
        ].join('\n'));
        const { api } = fakeApi();

        const config = await wrap(api, {})(BUILD, {});

        expect(config.turbopack.resolveAlias).toEqual({
            'cargo:uuid': './.crossbind/rust-crates/uuid.rs', 'dep/x.h': './node_modules/dep/include/x.h', rusty: './rusty/src/lib.rs',
        });
    });

    test("keeps the app's own rules, aliases, webpack hook, headers and after-compile step, and isolates a multithreaded page", async () => {
        const { api } = fakeApi({ runtime: 'mt' });
        const ran = [];
        const config = await wrap(api, () => ({
            turbopack: { rules: { '*.svg': { loaders: ['svgr'], as: '*.js' } }, resolveAlias: { 'dep/x.h': './own.h' } },
            webpack: (own) => ({ ...own, plugins: [...own.plugins, 'own'] }),
            headers: async () => [{ source: '/api', headers: [{ key: 'X-Own', value: 'yes' }] }],
            compiler: { runAfterProductionCompile: async () => { ran.push('own'); } },
        }))(BUILD, {});

        expect(config.turbopack.rules['*.svg']).toEqual({ loaders: ['svgr'], as: '*.js' });
        expect(config.turbopack.resolveAlias['dep/x.h']).toBe('./own.h');
        expect(config.webpack({ module: { rules: [] }, plugins: [] }, webpackContext).plugins[0]).toBe('own');
        expect(await config.headers()).toEqual([
            { source: '/api', headers: [{ key: 'X-Own', value: 'yes' }] },
            { source: '/:path*', headers: Object.entries(ISOLATION).map(([key, value]) => ({ key, value })) },
        ]);
        api.link.mockImplementation(async () => { ran.push('link'); });
        await config.compiler.runAfterProductionCompile({ projectDir: project, distDir: upath.join(project, '.next') });
        expect(ran).toEqual(['own', 'link']);
    });

    test("under `next dev`, a rewrite hands the glue's requests to crossbind's own server, which links the debug glue as the page asks", async () => {
        const { api, debug } = fakeApi();
        const config = await wrap(api, { basePath: '/docs', rewrites: async () => [{ source: '/old', destination: '/new' }] })(DEV, {});

        expect(config.turbopack.rules['*.h'].loaders[0].options.base).toBe('/docs/_crossbind/');
        expect(api.serve).toHaveBeenCalledWith(debug, { link: { prepare: true, allBridges: true }, isolate: true });
        const rewrites = await config.rewrites();
        expect(rewrites.afterFiles).toEqual([{ source: '/old', destination: '/new' }]);
        const [glue] = rewrites.beforeFiles;
        expect(glue.source).toBe('/_crossbind/:file');
        expect(await (await fetch(glue.destination.replace(':file', 'crossbind.js'))).text()).toBe('glue');
        expect((await fetch(glue.destination.replace(':file', 'other.js'))).status).toBe(404);
    });
});

import {
    describe, test, expect, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    remoteRoots, baseMount, remoteExecParams, referencedPaths, REMOTE_EXCLUDE_RULES,
} from '../src/utils/remoteRunner.js';

const config = {
    paths: {
        base: '/w',
        native: ['/w/app/src/native'],
        header: ['/w/app/src/native'],
        cache: '/w/app/.crossbind',
        output: '/w/app/.crossbind/build',
        cli: '/w/core/crossbind/src',
    },
    allDependencies: [
        { paths: { output: '/w/lib/dist', native: ['/w/lib/src/native'], header: ['/w/lib/src/native'] } },
    ],
};

describe('remoteRoots', () => {
    test('lists native, header, cache, cli asset and dependency folders relative to the base, nested ones folded', () => {
        const roots = remoteRoots(config);

        expect([...roots.inputRoots].sort()).toEqual(['app/.crossbind', 'app/src/native', 'core/crossbind/src/assets', 'lib/dist', 'lib/src/native']);
        expect(roots.outputRoots).toEqual(['app/.crossbind']);
    });

    test('adds what a step only reads to the inputs, and what it reads and writes, like a crate, to both', () => {
        const roots = remoteRoots(config, { extraInputs: ['/w/core/embind-rust/adapters/web.cpp'], extraOutputs: ['/w/ports/x/crate'] });

        expect(roots.inputRoots).toEqual(expect.arrayContaining(['core/embind-rust/adapters/web.cpp', 'ports/x/crate']));
        expect(roots.outputRoots).toContain('ports/x/crate');
        expect(roots.outputRoots).not.toContain('core/embind-rust/adapters/web.cpp');
    });

    test('leaves out a folder outside the base, which a local docker run does not mount either', () => {
        // A port's base is its own package folder, while crossbind's assets live in the CLI package.
        const port = { ...config, paths: { ...config.paths, cli: '/elsewhere/crossbind/src' } };

        const roots = remoteRoots(port, { extraInputs: ['/elsewhere/include/x.h'], extraOutputs: ['/elsewhere/crate'] });

        expect([...roots.inputRoots].sort()).toEqual(['app/.crossbind', 'app/src/native', 'lib/dist', 'lib/src/native']);
        expect(roots.outputRoots).toEqual(['app/.crossbind']);
    });
});

describe('a file the command line names outside the configured folders', () => {
    test('travels with the package that holds it, since it may include its neighbours, unless a configured folder holds it', () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-pkg-'));
        ['package.json', 'core/embind-rust/package.json', 'core/embind-rust/adapters/web.cpp', 'core/embind-rust/include/x.h',
            'core/crossbind/package.json', 'core/crossbind/src/assets/cpp-runtime/browser.cpp', 'loose/a.cpp'].forEach((rel) => {
            fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
            fs.writeFileSync(path.join(base, rel), 'x');
        });
        const local = { ...config, paths: { ...config.paths, base, native: [`${base}/app/src/native`], header: [], cache: `${base}/app/.crossbind`, output: `${base}/app/.crossbind`, cli: `${base}/core/crossbind/src` }, allDependencies: [] };

        const { inputRoots } = remoteRoots(local, {
            extraInputs: [`${base}/core/embind-rust/adapters/web.cpp`, `${base}/core/crossbind/src/assets/cpp-runtime/browser.cpp`, `${base}/loose/a.cpp`],
        });

        expect([...inputRoots].sort()).toEqual(['app/.crossbind', 'app/src/native', 'core/crossbind/src/assets', 'core/embind-rust', 'loose/a.cpp']);
        fs.rmSync(base, { recursive: true, force: true });
    });
});

describe('referencedPaths', () => {
    test('finds the existing paths below the base that a command line names, whatever flag carries them', () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-refs-'));
        ['adapters/web.cpp', 'include/x.h', 'data/proj.db'].forEach((rel) => {
            fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
            fs.writeFileSync(path.join(base, rel), 'x');
        });

        const found = referencedPaths(base, [
            'em++', `${base}/adapters/web.cpp`, `-I${base}/include`, '--preload-file', `${base}/data/proj.db@/crossbind/proj.db`,
            `-o${base}/out/not-yet.js`, `-DPATH=${base}`, '/elsewhere/a.cpp',
        ]);

        expect(found.sort()).toEqual([`${base}/adapters/web.cpp`, `${base}/data/proj.db`, `${base}/include`]);
        fs.rmSync(base, { recursive: true, force: true });
    });
});

describe('baseMount', () => {
    test('maps the project base where a local docker run mounts it', () => {
        expect(baseMount(config)).toEqual({ host: '/w', container: '/tmp/crossbind/live', ...remoteRoots(config) });
    });
});

describe('remoteExecParams', () => {
    const step = {
        role: 'web', image: 'ghcr.io/crossbind/web@sha256:1',
        mounts: [baseMount(config)], cwd: '/tmp/crossbind/live/app/.crossbind/build', argv: ['emcmake', 'cmake', '..'], env: { CFLAGS: '-O2' },
    };
    const remoteAt = (url, token = 'secret-token', tokenVariable = 'CROSSBIND_TOKEN_WEB') => ({
        url, from: '$CROSSBIND_REMOTE_URL_WEB', token, tokenVariable,
    });

    test('runs the remote client with the step, its mounts and the exclusion rules, and hands it the token only through its environment', () => {
        const options = { cwd: '/w/app/.crossbind/build', stdio: 'inherit' };

        const [program, args, passedOptions] = remoteExecParams({ ...step, remote: remoteAt('https://runner.example') }, options);
        const payload = JSON.parse(args[1]);

        expect(program).toBe(process.execPath);
        expect(args[0]).toMatch(/remoteClient\.js$/);
        expect(passedOptions).toEqual({ ...options, env: expect.objectContaining({ CROSSBIND_TOKEN: 'secret-token' }) });
        expect(payload).toEqual({ ...step, url: 'https://runner.example', rules: JSON.parse(JSON.stringify(REMOTE_EXCLUDE_RULES)) });
        expect(args[1]).not.toContain('secret-token');
    });

    test('stops a step whose image has no runner address, naming the settings that would give it one', () => {
        expect(() => remoteExecParams({ ...step, role: 'android', remote: null }, {}))
            .toThrow('crossbind: RUNNER=REMOTE, but the android image has no runner address - set REMOTE_URL_ANDROID (or REMOTE_URL), or build with CROSSBIND_RUNNER=DOCKER_RUN. A machine that names no runner address builds on crossbind cloud after crossbind login.');
    });

    test('stops before the step when the runner\'s address comes without its own token, naming the variable to set', () => {
        const remote = { url: 'https://linux.example', from: '$CROSSBIND_REMOTE_URL_LINUX', token: undefined, tokenVariable: 'CROSSBIND_TOKEN_LINUX' };

        expect(() => remoteExecParams({ ...step, role: 'linux', remote }, {})).toThrow(/https:\/\/linux\.example needs a token - set CROSSBIND_TOKEN_LINUX\./);
    });

    test('warns once per address when the token would cross the network in plain http, and not for this machine', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        remoteExecParams({ ...step, role: 'linux', remote: remoteAt('http://192.168.1.20:8787') }, {});
        remoteExecParams({ ...step, role: 'linux', remote: remoteAt('http://192.168.1.20:8787') }, {});
        remoteExecParams({ ...step, remote: remoteAt('http://127.0.0.1:8787') }, {});

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/http:\/\/192\.168\.1\.20:8787 is plain http/);
        warn.mockRestore();
    });

    test('keeps JavaScript sources on the machine and cargo target folders on the runner', () => {
        expect(REMOTE_EXCLUDE_RULES.extensions).toEqual(expect.arrayContaining(['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx']));
        expect(REMOTE_EXCLUDE_RULES.dirs).toEqual(expect.arrayContaining(['node_modules', '.git']));
        expect(REMOTE_EXCLUDE_RULES.serverOnly).toEqual({ names: ['target', 'target-mt'], marker: 'Cargo.toml', keep: ['*/release/*.a'] });
    });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectCrossbindTarball, packCrossbind, smokeTestCrossbindTarball } from '../package-artifact.mjs';

test('the exact tarball is installed and smoked without release credentials', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-package-artifact-test-'));
    const tarball = path.join(root, 'crossbind-9.9.9-beta.41.tgz');
    const smoke = path.join(root, 'smoke');
    fs.writeFileSync(tarball, 'fixture tarball bytes');
    const calls = [];
    const previousToken = process.env.NODE_AUTH_TOKEN;
    process.env.NODE_AUTH_TOKEN = 'must-not-reach-smoke-test';
    try {
        const result = smokeTestCrossbindTarball({
            tarball,
            expectedVersion: '9.9.9-beta.41',
            temporaryRoot: smoke,
            run(command, args, options) {
                if (command === 'tar') return JSON.stringify({ dependencies: { upath: '^2.0.1' } });
                calls.push({ command, args, options });
                if (command === 'npm') {
                    const installed = path.join(smoke, 'node_modules', 'crossbind');
                    fs.mkdirSync(installed, { recursive: true });
                    fs.writeFileSync(
                        path.join(installed, 'package.json'),
                        `${JSON.stringify({ name: 'crossbind', version: '9.9.9-beta.41', bin: { crossbind: './src/cli.js' } })}\n`,
                    );
                    return '';
                }
                return args.includes('--version') ? '9.9.9-beta.41\n' : '';
            },
        });
        assert.equal(result.integrity, inspectCrossbindTarball(tarball).integrity);
        assert.equal(calls[0].command, 'npm');
        assert.deepEqual(calls[0].args.slice(0, 4), ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
        assert.equal(calls[0].args.at(-1), tarball);
        assert.equal(calls[0].options.env.NODE_AUTH_TOKEN, undefined);
        assert.equal(calls.filter((call) => call.command === process.execPath).length, 2);
        assert.deepEqual(calls[1].args, [path.join(smoke, 'node_modules', 'crossbind', 'src', 'cli.js'), '--version']);
    } finally {
        if (previousToken === undefined) delete process.env.NODE_AUTH_TOKEN;
        else process.env.NODE_AUTH_TOKEN = previousToken;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a missing tarball fails before npm is invoked', () => {
    assert.throws(() => inspectCrossbindTarball('/definitely/missing/crossbind.tgz'), /does not exist/);
});

// A train publishes crossbind with the packages of the workspace it depends on, so the registry has none of that
// version yet when its tarball is smoked.
test('the packages crossbind is published with are installed from the tarballs beside its own', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-package-artifact-test-'));
    const tarball = path.join(root, 'crossbind-9.9.9-beta.41.tgz');
    const companion = path.join(root, 'crossbind-extension-conan-9.9.9-beta.41.tgz');
    const smoke = path.join(root, 'smoke');
    // The optional one lies beside them in a train too: npm would refuse it by name where its os is another.
    const optional = path.join(root, 'crossbind-bridge-tools-9.9.9-beta.41.tgz');
    for (const file of [tarball, companion, optional]) fs.writeFileSync(file, 'fixture tarball bytes');
    const installs = [];
    try {
        smokeTestCrossbindTarball({
            tarball,
            expectedVersion: '9.9.9-beta.41',
            temporaryRoot: smoke,
            run(command, args) {
                if (command === 'tar') {
                    // One packed beside it, one of the workspace that is not, and one of the registry.
                    return JSON.stringify({
                        dependencies: { '@crossbind/extension-conan': '9.9.9-beta.41', '@crossbind/elsewhere': '9.9.9-beta.41', upath: '^2.0.1' },
                        optionalDependencies: { '@crossbind/bridge-tools': '9.9.9-beta.41' },
                    });
                }
                if (command !== 'npm') return args.includes('--version') ? '9.9.9-beta.41\n' : '';
                installs.push(args);
                const installed = path.join(smoke, 'node_modules', 'crossbind');
                fs.mkdirSync(installed, { recursive: true });
                fs.writeFileSync(
                    path.join(installed, 'package.json'),
                    `${JSON.stringify({ name: 'crossbind', version: '9.9.9-beta.41', bin: { crossbind: './src/cli.js' } })}\n`,
                );
                return '';
            },
        });
        assert.deepEqual(installs[0].slice(-2), [tarball, companion]);
        assert.equal(installs[0].filter((argument) => argument.endsWith('.tgz')).length, 2);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('crossbind is packed with the packages of the workspace it depends on beside it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-package-artifact-test-'));
    const artifactDirectory = path.join(root, 'artifacts');
    const names = { 'core/crossbind': 'crossbind', 'extensions/conan': '@crossbind/extension-conan' };
    const workspace = [
        { name: '@crossbind/extension-conan', version: '9.9.9-beta.41', path: 'extensions/conan' },
        { name: '@crossbind/bridge-tools', version: '9.9.9-beta.41', path: 'tooling/bridge-tools' },
    ];
    fs.mkdirSync(path.join(root, 'core', 'crossbind'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'core', 'crossbind', 'package.json'),
        JSON.stringify({
            name: 'crossbind',
            version: '9.9.9-beta.41',
            dependencies: { '@crossbind/extension-conan': 'workspace:*', upath: '^2.0.1' },
            // npm leaves out an optional dependency it cannot get, and this one installs on a Mac alone.
            optionalDependencies: { '@crossbind/bridge-tools': 'workspace:*' },
        }),
    );
    const packed = [];
    const run = (command, args) => {
        if (command === 'tar') return JSON.stringify({ name: fs.readFileSync(args[1], 'utf8'), version: '9.9.9-beta.41' });
        const folder = path.relative(root, args[1]).split(path.sep).join('/');
        const filename = path.join(args.at(-1), `${names[folder].replace('@', '').replace('/', '-')}-9.9.9-beta.41.tgz`);
        fs.writeFileSync(filename, names[folder]);
        packed.push(folder);
        return JSON.stringify({ name: names[folder], version: '9.9.9-beta.41', filename });
    };
    try {
        const artifact = packCrossbind({ root, artifactDirectory, workspace, run });

        assert.deepEqual(packed, ['extensions/conan', 'core/crossbind']);
        assert.equal(artifact.tarball, path.join(artifactDirectory, 'crossbind-9.9.9-beta.41.tgz'));
        assert.ok(fs.existsSync(path.join(artifactDirectory, 'crossbind-extension-conan-9.9.9-beta.41.tgz')));
        assert.throws(
            () => packCrossbind({ root, artifactDirectory, workspace: [], run }),
            /depends on @crossbind\/extension-conan of the workspace/,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

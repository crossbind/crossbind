import {
    describe, test, expect, beforeAll, afterAll, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// buildProvenance reads the live build state; give it a synthetic package graph instead.
const state = { config: {} };
vi.mock('../src/state/index.js', () => ({ default: state }));

let work;
let variantDir;
let sdkDir;
let clangSha;

function setState({ withSha256 = true } = {}) {
    // The sdk path resolver reads the environment first; pin it so a developer's real sdk cannot leak in.
    vi.stubEnv('CROSSBIND_WASI_SDK_PATH', sdkDir);
    state.config = {
        package: { name: '@demo/family-standalone-wasi', nativeVersion: '3.13.2' },
        general: { alias: { package: '@demo/family' } },
        paths: { project: variantDir },
        system: { WASI_SDK_PATH: sdkDir },
        build: {
            getURL: (version) => `https://example.invalid/demo-${version}.tar.gz`,
            ...(withSha256 ? { sha256: 'a'.repeat(64) } : {}),
        },
    };
}

beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-provenance-'));
    variantDir = path.join(work, 'demo-standalone-wasi');
    const familyDir = path.join(variantDir, 'node_modules/@demo/family');
    fs.mkdirSync(familyDir, { recursive: true });
    fs.writeFileSync(path.join(variantDir, 'package.json'), JSON.stringify({ name: '@demo/family-standalone-wasi' }));
    fs.writeFileSync(path.join(familyDir, 'package.json'), JSON.stringify({ name: '@demo/family', version: '2.0.0-beta.33' }));

    sdkDir = path.join(work, 'wasi-sdk');
    fs.mkdirSync(path.join(sdkDir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(sdkDir, 'VERSION'), `34.0\nwasi-libc: ${'1'.repeat(40)}\nllvm-project: ${'2'.repeat(40)}\n`);
    fs.writeFileSync(path.join(sdkDir, 'bin/clang'), 'not a real compiler');
    clangSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(sdkDir, 'bin/clang'))).digest('hex');
});

afterAll(() => {
    vi.unstubAllEnvs();
    fs.rmSync(work, { recursive: true, force: true });
});

describe('wasiToolchainIdentity', () => {
    test('reads the sdk release, its pins and the clang hash', async () => {
        const { wasiToolchainIdentity } = await import('../src/utils/provenance.js');
        expect(wasiToolchainIdentity(sdkDir)).toMatchObject({
            name: 'wasi-sdk',
            version: '34.0',
            'wasi-libc': '1'.repeat(40),
            'llvm-project': '2'.repeat(40),
            clangSha256: clangSha,
        });
    });

    test('still hashes clang when the sdk ships no VERSION file', async () => {
        const { wasiToolchainIdentity } = await import('../src/utils/provenance.js');
        const bare = path.join(work, 'bare-sdk');
        fs.mkdirSync(path.join(bare, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(bare, 'bin/clang'), 'not a real compiler');
        const toolchain = wasiToolchainIdentity(bare);
        expect(toolchain.version).toBeUndefined();
        expect(toolchain.clangSha256).toBe(clangSha);
    });
});

describe('buildProvenance', () => {
    test('derives recipe, source and environment for a wasi build', async () => {
        setState();
        const { default: buildProvenance } = await import('../src/utils/provenance.js');
        const provenance = buildProvenance({ platform: 'wasi', path: 'wasi-wasm32-st-release' });
        expect(provenance.recipe).toEqual({ name: '@demo/family', version: '2.0.0-beta.33', nativeVersion: '3.13.2' });
        expect(provenance.source).toEqual({ url: 'https://example.invalid/demo-3.13.2.tar.gz', sha256: 'a'.repeat(64) });
        expect(provenance.environment.builder).toBe('host');
        expect(provenance.environment.dockerImage).toMatch(/^ghcr\.io\/crossbind\/web@sha256:[0-9a-f]{64}$/);
        expect(provenance.environment.hostPlatform).toBe(`${os.platform()}-${os.arch()}`);
        expect(provenance.environment.toolchain.version).toBe('34.0');
        expect(provenance.sbom).toBe('dist/prebuilt/wasi-wasm32-st-release/sbom.cdx.json');
    });

    test('records the docker builder for non-wasi targets and omits the host toolchain', async () => {
        setState();
        const { default: buildProvenance } = await import('../src/utils/provenance.js');
        const provenance = buildProvenance({ platform: 'wasm', path: 'wasm-wasm32-st-release-browser' });
        expect(provenance.environment.builder).toBe('docker');
        expect(provenance.environment.toolchain).toBeUndefined();
        expect(provenance.environment.hostPlatform).toBeUndefined();
    });

    test('refuses to derive provenance without a source hash', async () => {
        setState({ withSha256: false });
        const { default: buildProvenance } = await import('../src/utils/provenance.js');
        expect(() => buildProvenance({ platform: 'wasm', path: 'wasm-wasm32-st-release-browser' }))
            .toThrow(/no source sha256/);
    });

    test('refuses to derive provenance when the family recipe is unresolvable', async () => {
        setState();
        state.config.general.alias.package = '@demo/absent';
        const { default: buildProvenance } = await import('../src/utils/provenance.js');
        expect(() => buildProvenance({ platform: 'wasm', path: 'wasm-wasm32-st-release-browser' }))
            .toThrow(/cannot resolve the family recipe package/);
    });
});

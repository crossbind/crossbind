import { describe, test, expect } from 'vitest';
import {
    wasiCFlags, wasiCxxFlags, resolveWasiSdkPath, exportWasiSdkPath, WASI_LINK_LIBS,
} from '../src/utils/wasiToolchain.js';

describe('wasi flag composition', () => {
    test('C flags carry the emulation defines and the sjlj/new-EH toggles', () => {
        const flags = wasiCFlags();
        expect(flags).toContain('-D_WASI_EMULATED_SIGNAL');
        expect(flags).toContain('-mexception-handling');
        expect(flags.join(' ')).toContain('-mllvm -wasm-enable-sjlj');
        expect(flags.join(' ')).toContain('-mllvm -wasm-use-legacy-eh=false');
        expect(flags).not.toContain('-fwasm-exceptions');
    });

    test('C++ flags additionally enable wasm exceptions', () => {
        expect(wasiCxxFlags()).toContain('-fwasm-exceptions');
    });

    test('both flag sets lead with the wasip3 target triple', () => {
        expect(wasiCFlags()[0]).toBe('--target=wasm32-wasip3');
        expect(wasiCxxFlags()[0]).toBe('--target=wasm32-wasip3');
    });

    test('link libs end with the emulation archives and start with unwind', () => {
        expect(WASI_LINK_LIBS[0]).toBe('-lunwind');
        expect(WASI_LINK_LIBS).toContain('-lsetjmp');
    });
});

describe('resolveWasiSdkPath', () => {
    test('env override wins over system config under RUNNER=LOCAL', () => {
        expect(resolveWasiSdkPath({ RUNNER: 'LOCAL', WASI_SDK_PATH: '/sys' }, { CROSSBIND_WASI_SDK_PATH: '/env' })).toBe('/env');
        expect(resolveWasiSdkPath({ WASI_SDK_PATH: '/sys' }, { CROSSBIND_RUNNER: 'LOCAL', CROSSBIND_WASI_SDK_PATH: '/env' })).toBe('/env');
    });

    test('falls back to system config, then null', () => {
        expect(resolveWasiSdkPath({ RUNNER: 'LOCAL', WASI_SDK_PATH: '/sys' }, {})).toBe('/sys');
        expect(resolveWasiSdkPath({ RUNNER: 'LOCAL', WASI_SDK_PATH: '' }, {})).toBeNull();
        expect(resolveWasiSdkPath(undefined, {})).toBeNull();
    });

    test('is null under every other runner: their builds use the sdk in the image', () => {
        ['DOCKER_RUN', 'DOCKER_EXEC', 'REMOTE'].forEach((RUNNER) => {
            expect(resolveWasiSdkPath({ RUNNER, WASI_SDK_PATH: '/sys' }, { CROSSBIND_WASI_SDK_PATH: '/env' })).toBeNull();
        });
    });

    test('leaves an invalid runner to the step that uses it, so `crossbind config set` can still repair it', () => {
        expect(resolveWasiSdkPath({ RUNNER: 'remote', WASI_SDK_PATH: '/sys' }, {})).toBeNull();
    });
});

describe('exportWasiSdkPath', () => {
    test('hands recipes the host sdk under RUNNER=LOCAL, from the system config too', () => {
        const env = { CROSSBIND_RUNNER: 'LOCAL' };

        exportWasiSdkPath({ WASI_SDK_PATH: '/sys' }, env);

        expect(env.CROSSBIND_WASI_SDK_PATH).toBe('/sys');
    });

    test('takes a host sdk away from recipes under the other runners, so no host path reaches the image', () => {
        const env = { CROSSBIND_WASI_SDK_PATH: '/env' };

        exportWasiSdkPath({ RUNNER: 'DOCKER_RUN', WASI_SDK_PATH: '/sys' }, env);

        expect(env).not.toHaveProperty('CROSSBIND_WASI_SDK_PATH');
    });
});

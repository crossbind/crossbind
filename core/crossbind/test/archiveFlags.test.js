import { describe, test, expect } from 'vitest';
import { targetArchiveFlags } from '../src/utils/archiveFlags.js';

describe('archive flags', () => {
    test('a single-threaded wasm archive is built with SIMD only', () => {
        expect(targetArchiveFlags({ platform: 'wasm', arch: 'wasm32', runtime: 'st' })).toEqual(['-msimd128']);
    });

    test('the mt runtime builds with pthreads, on wasm and native platforms alike', () => {
        expect(targetArchiveFlags({ platform: 'wasm', arch: 'wasm32', runtime: 'mt' })).toEqual(['-pthread', '-msimd128']);
        expect(targetArchiveFlags({ platform: 'android', arch: 'arm64-v8a', runtime: 'mt' })).toEqual(['-pthread']);
    });

    test('wasm64 archives use 64-bit memory', () => {
        expect(targetArchiveFlags({ platform: 'wasm', arch: 'wasm64', runtime: 'st' })).toEqual(['-msimd128', '-sMEMORY64=1']);
    });
});

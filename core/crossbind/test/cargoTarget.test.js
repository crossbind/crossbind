import { describe, test, expect } from 'vitest';
import { cargoTripleFor } from '../src/utils/cargoTarget.js';

describe('cargoTripleFor', () => {
    test('maps wasm to the emscripten triple', () => {
        expect(cargoTripleFor({ platform: 'wasm', arch: 'wasm32' })).toBe('wasm32-unknown-emscripten');
    });

    test('separates the ios device and simulator triples', () => {
        expect(cargoTripleFor({ platform: 'ios', arch: 'iphoneos' })).toBe('aarch64-apple-ios');
        expect(cargoTripleFor({ platform: 'ios', arch: 'iphonesimulator' })).toBe('aarch64-apple-ios-sim');
    });

    test('maps both android architectures', () => {
        expect(cargoTripleFor({ platform: 'android', arch: 'arm64-v8a' })).toBe('aarch64-linux-android');
        expect(cargoTripleFor({ platform: 'android', arch: 'x86_64' })).toBe('x86_64-linux-android');
    });

    test('maps both macOS architectures of the Node-API addons', () => {
        expect(cargoTripleFor({ platform: 'darwin', arch: 'arm64' })).toBe('aarch64-apple-darwin');
        expect(cargoTripleFor({ platform: 'darwin', arch: 'x64' })).toBe('x86_64-apple-darwin');
    });

    test('returns null for platforms rust cannot target yet', () => {
        expect(cargoTripleFor({ platform: 'wasi', arch: 'wasm32' })).toBeNull();
        expect(cargoTripleFor({ platform: 'unknown', arch: 'x86_64' })).toBeNull();
    });
});

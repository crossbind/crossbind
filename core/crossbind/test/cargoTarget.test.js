import { describe, test, expect } from 'vitest';
import { cargoTripleFor, rustStdLibsFor } from '../src/utils/cargoTarget.js';

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

    test('maps both architectures of the glibc, musl and Windows Node-API addons', () => {
        expect(cargoTripleFor({ platform: 'linux', arch: 'x64' })).toBe('x86_64-unknown-linux-gnu');
        expect(cargoTripleFor({ platform: 'linux', arch: 'arm64' })).toBe('aarch64-unknown-linux-gnu');
        expect(cargoTripleFor({ platform: 'linuxmusl', arch: 'x64' })).toBe('x86_64-unknown-linux-musl');
        expect(cargoTripleFor({ platform: 'linuxmusl', arch: 'arm64' })).toBe('aarch64-unknown-linux-musl');
        expect(cargoTripleFor({ platform: 'win32', arch: 'x64' })).toBe('x86_64-pc-windows-gnullvm');
        expect(cargoTripleFor({ platform: 'win32', arch: 'arm64' })).toBe('aarch64-pc-windows-gnullvm');
    });

    test('returns null for platforms rust cannot target yet', () => {
        expect(cargoTripleFor({ platform: 'wasi', arch: 'wasm32' })).toBeNull();
        expect(cargoTripleFor({ platform: 'unknown', arch: 'x86_64' })).toBeNull();
    });
});

describe('rustStdLibsFor', () => {
    test('names the system libraries Rust std links against in a Linux or Windows addon', () => {
        expect(rustStdLibsFor({ platform: 'linux', arch: 'x64' })).toEqual(['-lgcc_s', '-lutil', '-lrt', '-lpthread', '-lm', '-ldl']);
        expect(rustStdLibsFor({ platform: 'linuxmusl', arch: 'arm64' })).toEqual(['-lgcc_s']);
        expect(rustStdLibsFor({ platform: 'win32', arch: 'arm64' })).toEqual(['-lkernel32', '-lntdll', '-luserenv', '-lws2_32', '-ldbghelp', '-lunwind']);
    });

    test('adds nothing where the platform toolchain links them already', () => {
        expect(rustStdLibsFor({ platform: 'darwin', arch: 'arm64' })).toEqual([]);
        expect(rustStdLibsFor({ platform: 'android', arch: 'x86_64' })).toEqual([]);
    });
});

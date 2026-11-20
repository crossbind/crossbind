import { describe, expect, test } from 'vitest';
import { identityLine, previewBlockers } from '../src/utils/previewBlockers.js';

const web = { platform: 'wasm', arch: 'wasm32', runtime: 'st', runtimeEnv: 'browser' };
const project = (more = {}) => ({ target: {}, extensions: [], app: {}, ...more });
// A package of a dependency, as loadConfig gives it, that serves the targets isEnabled takes.
const packageOf = (name, isEnabled, type = 'cmake') => ({
    general: { name: 'acme-x' }, package: { name }, export: { type }, functions: { isEnabled },
});

describe('what a preview cannot run', () => {
    test('stops a project of no web build, which target.runtimeEnv app leaves out, by that alone', () => {
        expect(previewBlockers(project({ target: { runtimeEnv: 'app', runtime: 'mt' } }), undefined)).toEqual([
            "crossbind: crossbind app preview runs the project's web build, which target.runtimeEnv 'app' in crossbind.config.js leaves out: leave target.runtimeEnv out, so each command builds what it runs, or run crossbind app dev.",
        ]);
    });

    test("stops threads, which a preview's WebAssembly runs without", () => {
        expect(previewBlockers(project({ target: { runtime: 'mt' } }), web)).toEqual([
            "crossbind: a preview runs single-threaded WebAssembly, and target.runtime is 'mt': leave it out, or run crossbind app dev.",
        ]);
    });

    test('stops each extension with native code the crossbind app does not carry, by its name', () => {
        const extensions = [
            { name: 'acme-camera', app: { sources: ['camera.cpp'] } },
            { name: 'acme-plist', app: { ios: { plist: { NSCameraUsageDescription: 'x' } } } },
            { name: 'acme-java', app: { android: { java: 'native/android', class: 'dev.acme.Camera' } } },
            { name: 'acme-page', app: {} },
            { name: 'acme-files', app: { files: ['data.txt'] } },
            { name: 'clipboard', app: { sources: ['native/clipboard.cpp'] } },
        ];
        expect(previewBlockers(project({ extensions }), web)).toEqual(['acme-camera', 'acme-plist', 'acme-java'].map((name) => `crossbind: the extension ${name} has native code, which the crossbind app does not carry: crossbind app dev runs it.`));
    });

    test("stops a dependency none of whose packages serves the web build's target, naming them", () => {
        const native = (name) => packageOf(name, (target) => target.platform !== 'wasm');
        const allDependencies = [native('@acme/port-x-android'), native('@acme/port-x-ios')];
        expect(previewBlockers(project({ allDependencies }), web)).toEqual([
            "crossbind: crossbind app preview runs the project's web build, and @acme/port-x-android and @acme/port-x-ios have no WebAssembly build: list its wasm package beside the native ones, or run crossbind app dev.",
        ]);
        const withWasm = [...allDependencies, packageOf('@acme/port-x-wasm', (target) => target.platform === 'wasm')];
        expect(previewBlockers(project({ allDependencies: withWasm }), web)).toEqual([]);
    });

    test('takes a cargo dependency, which builds for the target as the build needs it, and the project itself', () => {
        const config = project();
        config.allDependencies = [config, packageOf('acme-crate', () => false, 'cargo')];
        expect(previewBlockers(config, web)).toEqual([]);
    });

    test('runs a project of none of them', () => {
        expect(previewBlockers(project(), web)).toEqual([]);
    });
});

describe("what is the crossbind app's in a preview", () => {
    test('names what of the app its identity holds, and stops nothing', () => {
        const app = {
            urlSchemes: ['acme'], links: ['acme.example/open'], activityTypes: ['dev.acme.view'], shortcutItems: [{ type: 'dev.acme.new' }], name: 'Acme', icon: 'icon.png',
        };
        expect(identityLine(project({ app }))).toBe("in a preview these are the crossbind app's: app.urlSchemes (links of acme open nothing of this project), app.links (acme.example/open open nothing of this project), app.activityTypes, app.shortcutItems, app.name, app.icon");
        expect(previewBlockers(project({ app }), web)).toEqual([]);
    });

    test('says nothing of an app without them', () => {
        expect(identityLine(project({ app: { urlSchemes: [] } }))).toBeNull();
        expect(identityLine(project())).toBeNull();
    });
});

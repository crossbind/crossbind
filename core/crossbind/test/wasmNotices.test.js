import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { run, state, image } = vi.hoisted(() => ({ run: vi.fn(), state: { config: {} }, image: { ref: '' } }));
vi.mock('../src/actions/run.js', () => ({ default: run }));
vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('../src/utils/pullDockerImage.js', () => ({ getDockerImage: () => image.ref, imageRoleFor: () => 'web' }));

const { default: copyWasmNotices, hasWasmNotices } = await import('../src/actions/wasmNotices.js');

const target = { platform: 'wasm', runtimeEnv: 'browser' };

describe("a wasm build's toolchain notices", () => {
    let build;

    beforeEach(() => {
        build = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-wasm-notices-')));
        state.config = { paths: { build } };
        image.ref = 'ghcr.io/crossbind/web@sha256:aaa';
        run.mockReset();
    });

    afterEach(() => {
        fs.rmSync(build, { recursive: true, force: true });
    });

    test("are Emscripten's and LLVM's license texts and versions, copied out of the web image the module links in", () => {
        expect(hasWasmNotices()).toBe(false);

        copyWasmNotices(target);

        expect(run).toHaveBeenCalledTimes(1);
        const [program, [flag, script], prefix, calledTarget] = run.mock.calls[0];
        expect([program, flag, prefix, calledTarget]).toEqual(['sh', '-c', null, target]);
        expect(script).toContain('mkdir -p toolchain-licenses/wasm');
        // A file an image lacks is left out, and the build goes on.
        expect(script).toContain('if [ -f /opt/licenses/emscripten-LICENSE ]; then cp /opt/licenses/emscripten-LICENSE toolchain-licenses/wasm/emscripten-LICENSE; fi');
        expect(script).toContain('if [ -f /opt/licenses/llvm-LICENSE.TXT ]; then cp /opt/licenses/llvm-LICENSE.TXT toolchain-licenses/wasm/llvm-LICENSE.TXT; fi');
        expect(script).toContain('cp /emsdk/upstream/emscripten/emscripten-version.txt toolchain-licenses/wasm/emscripten-version.txt');
        expect(script).toContain('/emsdk/upstream/bin/clang --version > toolchain-licenses/wasm/clang-version.txt');
        expect(hasWasmNotices()).toBe(true);
    });

    test('are copied once for each image', () => {
        copyWasmNotices(target);
        copyWasmNotices(target);
        expect(run).toHaveBeenCalledTimes(1);

        image.ref = 'ghcr.io/crossbind/web@sha256:bbb';
        copyWasmNotices(target);
        expect(run).toHaveBeenCalledTimes(2);
    });
});

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What a Mac makes macOS and iOS bridges with, in place of the web image: its SWIG as WebAssembly, and the flags with
// which Xcode's clang reads headers as the image's em++ does.
const dist = new URL('./dist/', import.meta.url);
const at = (relative) => fileURLToPath(new URL(relative, dist));
const manifest = JSON.parse(fs.readFileSync(at('manifest.json'), 'utf8'));
const createSwig = createRequire(import.meta.url)(at(manifest.swig.js));
const wasmBinary = fs.readFileSync(at(manifest.swig.wasm));
const O_RDONLY = 0;
const O_WRONLY = 1;
const S_IFCHR = 0o20000;

// clang reads CPATH and CPLUS_INCLUDE_PATH despite -nostdinc, so it must run without them.
export const preprocessorArgs = Object.freeze([
    '--target=wasm32-unknown-emscripten',
    '-nostdinc',
    '-undef',
    '-Wno-builtin-macro-redefined',
    '-include',
    at(manifest.predefined),
    ...manifest.includeDirs.flatMap((dir) => ['-isystem', at(dir)]),
]);

// Runs a new SWIG in this process, which sees what the image's swig sees: cwd as its working directory, and of the
// environment SWIG reads only SWIG_LIB. Its output comes back in the result, and this process keeps its exit code. A
// crash throws, with the output so far.
export function swig(args, { cwd }) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error(`crossbind: SWIG needs an absolute working directory, not ${cwd}.`);
    const chunks = [];
    const write = (stream, buffer, offset, length) => {
        chunks.push(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length).slice());
        return length;
    };
    const print = (text) => chunks.push(Buffer.from(`${text}\n`));
    const output = () => Buffer.concat(chunks).toString('utf8');
    const device = (FS, name, flags, streamOps) => ({
        path: `/dev/${name}`,
        flags,
        position: 0,
        node: new FS.FSNode(null, name, S_IFCHR, 0),
        stream_ops: streamOps,
    });
    // The loader reads its environment from process.env, sets process.exitCode and asks process.binding, which node
    // deprecates, for the fs flags.
    const ownProcess = Object.create(process, {
        env: { value: { SWIG_LIB: at(manifest.swig.lib) } },
        exitCode: { value: undefined, writable: true },
        binding: { value: () => ({ fs: fs.constants }) },
    });
    const instance = createSwig(
        {
            wasmBinary,
            thisProgram: 'swig',
            noFSInit: true,
            print,
            printErr: print,
            preRun: [
                ({ FS }) => {
                    // SWIG looks for each file in its working directory first, through relative paths that FS.cwd resolves.
                    FS.cwd = () => cwd;
                    FS.createStream(device(FS, 'stdin', O_RDONLY, { read: () => 0 }), 0);
                    FS.createStream(device(FS, 'stdout', O_WRONLY, { write }), 1);
                    FS.createStream(device(FS, 'stderr', O_WRONLY, { write }), 2);
                },
            ],
        },
        ownProcess,
    );
    try {
        return { status: instance.callMain([...args]), output: output() };
    } catch (error) {
        // A crash skips SWIG's exit, which closes the files it opened.
        new Set(instance.FS.streams.map((stream) => stream?.nfd).filter((fd) => fd > 2)).forEach((fd) => fs.closeSync(fd));
        throw Object.assign(new Error(`crossbind: SWIG crashed: ${error.message}`, { cause: error }), { output: output() });
    }
}

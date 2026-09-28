

import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import virtual from '@rollup/plugin-virtual';
import state from '../state/index.js';
import getData from './getData.js';

const SUPPRESSED_WARN_CODES = new Set([
    'MISSING_GLOBAL_NAME',
    'MISSING_NODE_BUILTINS',
    'MIXED_EXPORTS',
]);

export function suppressNodeBuiltinWarnings(warning, defaultHandler) {
    if (SUPPRESSED_WARN_CODES.has(warning.code)) return;
    if (warning.code === 'UNRESOLVED_IMPORT' && /^node:/.test(warning.exporter || warning.source || warning.id || '')) return;
    defaultHandler(warning);
}

const nodeLibs = {
    fs: 'export default {};', 'node:fs': 'export default {};',
    path: 'export default {};', 'node:path': 'export default {};',
    crypto: 'export default {};', 'node:crypto': 'export default {};',
    buffer: 'export default {};', 'node:buffer': 'export default {};',
    stream: 'export default {};', 'node:stream': 'export default {};',
    string_decoder: 'export default {};', 'node:string_decoder': 'export default {};',
    util: 'export default {};', 'node:util': 'export default {};',
    os: 'export default {};', 'node:os': 'export default {};',
    'node:module': 'export default {};',
    'node:worker_threads': 'export default {};',
    ws: 'export default {};',
};

const options = {
    browser: {
        plugins: [virtual(nodeLibs), nodeResolve(), commonjs({ transformMixedEsModules: true, ignoreTryCatch: 'remove' })],
        output: {
            format: 'umd',
            name: 'initNative',
        },
    },
    node: {
        plugins: [nodeResolve(), commonjs()],
        output: {
            format: 'umd',
            name: 'initNative',
        },
    },
};
options.edge = options.browser;

export default async function buildJS(target) {
    const entryJS = `${state.config.paths.cli}/assets/js-runtime/${target.runtimeEnv}.js`;
    const rawEnv = getData('env', target);
    const resolvedEnv = Object.fromEntries(
        Object.entries(rawEnv).map(([key, value]) => [
            key,
            typeof value === 'function' ? value(state, target) : value,
        ]),
    );
    const env = JSON.stringify(resolvedEnv);
    const systemConfig = `export default {
        env: ${env},
        useWorker: !!globalThis.Worker,
        general: {
            name: '${state.config.general.name}',
        },
        fs: {
            opfs: ${target.runtime === 'mt'},
        },
        paths: {
            wasm: '${target.wasmName}',
            data: '${target.dataTxtName}',
            worker: '${target.rawJsName}',
            js: '${target.jsName}',
        }
    }`;

    // fs.renameSync(input, `${input}.raw.js`);
    const option = options[target.runtimeEnv];
    option.plugins = [virtual({
        'crossbind/systemConfig': systemConfig,
        'crossbind/module': `export { default } from '${state.config.paths.build}/${target.rawJsName}';`,
    }), ...option.plugins];
    option.input = entryJS;
    option.output.file = `${state.config.paths.build}/${target.jsName}`;
    option.onwarn = suppressNodeBuiltinWarnings;
    const bundle = await rollup(option);
    await bundle.write(option.output);
    // fs.rmSync(`${input}.raw.js`, { force: true });
}

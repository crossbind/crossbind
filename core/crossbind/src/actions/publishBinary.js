import fs from 'node:fs';
import path from 'node:path';
import state from '../state/index.js';
import replaceFile from '../utils/replaceFile.js';

// paths.output defaults to paths.build, where a built command and its data already are; copying them onto
// themselves would delete them first.
const outputIsBuild = () => path.resolve(state.config.paths.output) === path.resolve(state.config.paths.build);

export function publishNativeCommand(target) {
    if (outputIsBuild()) return;
    fs.mkdirSync(state.config.paths.output, { recursive: true });
    replaceFile(`${state.config.paths.build}/${target.commandName}`, `${state.config.paths.output}/${target.commandName}`);
}

export function publishNodeAddon(target) {
    if (outputIsBuild()) return;
    fs.mkdirSync(state.config.paths.output, { recursive: true });
    replaceFile(`${state.config.paths.build}/${target.addonName}`, `${state.config.paths.output}/${target.addonName}`);
    fs.copyFileSync(`${state.config.paths.build}/${target.jsName}`, `${state.config.paths.output}/${target.jsName}`);
}

export function publishWasiCommand(target) {
    if (outputIsBuild()) return;
    fs.copyFileSync(`${state.config.paths.build}/${target.wasmName}`, `${state.config.paths.output}/${target.wasmName}`);
    // Copied (not renamed) so a later fingerprint cache-hit still has the
    // build-dir tree to serve from.
    if (fs.existsSync(`${state.config.paths.build}/data`)) {
        fs.rmSync(`${state.config.paths.output}/data`, { recursive: true, force: true });
        fs.cpSync(`${state.config.paths.build}/data`, `${state.config.paths.output}/data`, { recursive: true });
    }
}

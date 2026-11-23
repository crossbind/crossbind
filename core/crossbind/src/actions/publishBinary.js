import fs from 'node:fs';
import path from 'node:path';
import state from '../state/index.js';
import {
    APP_STUB, appBinTool, missingBinEntries, renderBinCommands, renderBinJson, renderCommandStub,
} from '../utils/binTools.js';
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

// An app's own command on npm: the bin map of its config lays the command out as a port's tools are, where crossbind's
// runner looks, with a stub per command. package.json has to point each command at its stub; crossbind leaves it as it is.
export function publishWasiBin(target) {
    const { bin, paths } = state.config;
    if (!bin || target.runtimeEnv !== 'wasi') return;
    const tool = appBinTool(bin);
    if (outputIsBuild()) {
        throw new Error("crossbind: bin needs the package's files out of the build directory: set paths: { output: 'dist' } in crossbind.config.js.");
    }
    const commands = renderBinCommands(bin);
    const manifest = JSON.parse(fs.readFileSync(`${paths.project}/package.json`, 'utf8'));
    const missing = missingBinEntries(manifest, commands);
    if (missing.length > 0) {
        const entries = missing.map(([command, file]) => `"${command}": "${file}"`).join(', ');
        throw new Error(`crossbind: package.json needs "bin": { ${entries} }, the command its crossbind config's bin names; add it and build again.`);
    }

    const own = `${paths.output}/prebuilt/${target.path}`;
    fs.mkdirSync(`${own}/bin`, { recursive: true });
    fs.copyFileSync(`${paths.build}/${target.wasmName}`, `${own}/bin/${tool}`);
    fs.writeFileSync(`${own}/crossbind-bin.json`, renderBinJson(bin));
    for (const file of Object.values(commands)) {
        const stub = `${paths.project}/${file}`;
        fs.mkdirSync(path.dirname(stub), { recursive: true });
        fs.writeFileSync(stub, renderCommandStub(tool, APP_STUB));
        fs.chmodSync(stub, 0o755);
    }
}

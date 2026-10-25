import fs from 'node:fs';
import replace from 'replace';
import downloadAndExtractFile, { sourcesOf } from '../utils/downloadAndExtractFile.js';
import copyToDistSource from '../utils/copyToDistSource.js';
import { getBuildTargets } from './target.js';
import state from '../state/index.js';
import buildLib from './buildLib.js';
import buildBinTools from './buildBinTools.js';
import { copyBundledLicenses } from '../utils/bundledLicenses.js';
import { applyRecipePatches, refreshPatchedSource, writePatchedSourceStamp } from '../utils/recipePatches.js';

export default async function buildExternal(targetParams, options = {}) {
    const version = state.config.package.nativeVersion;
    if (!version) {
        throw new Error(`crossbind: "${state.config.general?.name}" has a crossbind.build recipe but no "nativeVersion" in package.json — cannot build from source.`);
    }

    const { sha256, replaceList, copyToSource, copyToDist, patches } = state.config.build;
    refreshPatchedSource(state.config.paths.build, patches);
    const isNewlyCreated = await downloadAndExtractFile(sourcesOf(state.config.build, version), state.config.paths.build, sha256);
    const sourcePath = `${state.config.paths.build}/source`;
    // Upstream fixes are diffs against the source as released, so they go in before crossbind's own edits.
    if (isNewlyCreated) {
        applyRecipePatches(sourcePath, patches);
        writePatchedSourceStamp(state.config.paths.build, patches);
    }
    if (isNewlyCreated && replaceList) {
        replaceList.forEach(({ regex, replacement, paths }) => {
            replace({
                regex, replacement, paths: paths.map((p) => `${sourcePath}/${p}`), recursive: false, silent: true,
            });
        });
    }

    if (isNewlyCreated && copyToSource) {
        Object.entries(copyToSource).forEach(([key, value]) => {
            fs.copyFileSync(`${state.config.paths.project}/${key}`, `${sourcePath}/${value}`);
        });
    }

    buildLib(targetParams, options);

    const { bundled } = state.config.build;
    if (bundled) {
        new Set(getBuildTargets(targetParams).map((target) => target.platform))
            .forEach((platform) => copyBundledLicenses(bundled[platform], sourcePath, state.config.paths.output));
    }

    if (state.config.build.bin) {
        await buildBinTools(targetParams);
    }

    if (copyToDist) {
        const targets = getBuildTargets(targetParams);
        Object.entries(copyToDist).forEach(([key, value]) => {
            const values = [];
            if (Array.isArray(value)) {
                values.push(...value);
            } else {
                values.push(value);
            }
            values.forEach(v => {
                targets.forEach(target => {
                    const assetPath = `${state.config.paths.output}/prebuilt/${target.path}/${v}`;
                    if (!fs.existsSync(assetPath)) {
                        fs.copyFileSync(copyToDistSource(state.config.paths.project, key), assetPath);
                    }
                });
            });
        });
    }
}

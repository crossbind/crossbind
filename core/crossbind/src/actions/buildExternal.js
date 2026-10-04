import fs from 'node:fs';
import replace from 'replace';
import downloadAndExtractFile from '../utils/downloadAndExtractFile.js';
import copyToDistSource from '../utils/copyToDistSource.js';
import { getBuildTargets } from './target.js';
import state from '../state/index.js';
import buildLib from './buildLib.js';
import buildBinTools from './buildBinTools.js';
import { copyBundledLicenses } from '../utils/bundledLicenses.js';

export default async function buildExternal(targetParams, options = {}) {
    const version = state.config.package.nativeVersion;
    if (!version) {
        throw new Error(`crossbind: "${state.config.general?.name}" has a crossbind.build recipe but no "nativeVersion" in package.json — cannot build from source.`);
    }

    const { getURL, sha256, replaceList, copyToSource, copyToDist } = state.config.build;
    const isNewlyCreated = await downloadAndExtractFile(getURL(version), state.config.paths.build, sha256);
    const sourcePath = `${state.config.paths.build}/source`;
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

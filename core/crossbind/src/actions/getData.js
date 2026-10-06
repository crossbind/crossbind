import fs from 'node:fs';
import state from '../state/index.js';
import { getFilteredTargetSpec, getBuildTargets } from './target.js';

function getRecursiveData(obj, config, dependency, field, target) {
    // An app may list a port's wasm, Android and iOS packages together. One with no prebuilt for the target
    // drops out of the link, and its data stays out with it.
    const skipsTarget = field === 'data' && dependency !== config && dependency.functions?.isEnabled && !dependency.functions.isEnabled(target);
    const entryArray = skipsTarget ? [] : getFilteredTargetSpec(dependency?.targetSpecs, target).map(s => s[field]);
    const entries = Object.assign({}, ...entryArray);
    Object.entries(entries).forEach(([dKey, value]) => {
        if (field === 'data') {
            let key;
            if (fs.existsSync(`${dependency.paths.output}/prebuilt/${target.path}`)) {
                key = `${dependency.paths.output}/prebuilt/${target.path}/${dKey}`;
            } else {
                const releaseTarget = getBuildTargets({
                    platform: [target.platform], arch: [target.arch], runtime: [target.runtime],
                    runtimeEnv: [target.runtimeEnv], buildType: ['release']
                })?.[0];
                if (releaseTarget) {
                    key = `${dependency.paths.output}/prebuilt/${releaseTarget.path}/${dKey}`;
                } else {
                    throw new Error('Data not found');
                }
            }
            obj[key] = value;
        } else {
            if (typeof value === 'object' && Array.isArray(value)) {
                obj[dKey] = [...(obj[dKey] || []), ...value];
            } else if (typeof value === 'object') {
                obj[dKey] = { ...(obj[dKey] || {}), ...value };
            } else {
                obj[dKey] = value;
            }
        }
    });

    dependency.dependencies.forEach((dep) => {
        getRecursiveData(obj, config, dep, field, target);
    });
}

export default function getData(field, target) {
    const output = {};
    getRecursiveData(output, state.config, state.config, field, target);

    return output;
}

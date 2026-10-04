import attachConanDependencies from './attachConanDependencies.js';
import { conanStageDir } from '../utils/conanImport.js';
import { conanManifestsStamp } from '../utils/conanStage.js';

const attachedFrom = new WeakMap();

// Attaches what a build staged since this config last attached: a process that loaded state before
// the build, such as a Metro server, would otherwise bind headers without the packages. Says whether
// it attached again.
export default function refreshConanDependencies(config) {
    if (Object.keys(config.conanDependencies ?? {}).length === 0) return false;
    const stamp = conanManifestsStamp(conanStageDir(config.paths.cache));
    if (attachedFrom.get(config) === stamp) return false;
    attachedFrom.set(config, stamp);
    attachConanDependencies(config);
    return true;
}

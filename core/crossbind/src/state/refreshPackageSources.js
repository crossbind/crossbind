import attachPackageSources from './attachPackageSources.js';
import { sourceStageDir } from '../utils/packageSourceImport.js';
import { declaredSources } from '../utils/packageSources.js';
import { sourceManifestsStamp } from '../utils/packageSourceStage.js';

const attachedFrom = new WeakMap();

// Attaches what a build staged since this config last attached: a process that loaded state before
// the build, such as a Metro server, would otherwise bind headers without the packages. Says whether
// it attached again.
export default function refreshPackageSources(config) {
    const declared = declaredSources(config);
    if (declared.length === 0) return false;
    const stamp = declared.map(({ name }) => `${name}:${sourceManifestsStamp(sourceStageDir(config.paths.cache, name))}`).join('\n');
    if (attachedFrom.get(config) === stamp) return false;
    attachedFrom.set(config, stamp);
    attachPackageSources(config);
    return true;
}

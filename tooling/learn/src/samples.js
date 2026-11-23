// The compiler template's C++: its image warms the build tree on these very files, so the sample that has nothing
// else to bind compiles once and then comes from the cache.
import header from '../../cloud/compiler/template/src/native/native.h?raw';
import source from '../../cloud/compiler/template/src/native/native.cpp?raw';
import { SAMPLE_LIST } from './sampleList.js';

const TEMPLATE_NATIVE = Object.freeze({ 'native/native.h': header, 'native/native.cpp': source });
const FILES = import.meta.glob('./samples/*/**/*', { query: '?raw', import: 'default', eager: true });

// A sample with no native file of its own and no package has nothing to bind, so it uses the template's C++, as the
// demo build does (scripts/site/build-example-demos.mjs). One that only imports a package stays without C++.
function filesOf(id, packages) {
    const prefix = `./samples/${id}/`;
    const own = Object.fromEntries(Object.entries(FILES)
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, text]) => [path.slice(prefix.length), text]));
    const binds = packages.length > 0 || Object.keys(own).some((name) => name.startsWith('native/'));
    return Object.freeze(binds ? own : { ...own, ...TEMPLATE_NATIVE });
}

export const SAMPLES = Object.freeze(SAMPLE_LIST.map(({ id, title, packages }) => Object.freeze({
    id,
    title,
    project: Object.freeze({ files: filesOf(id, packages), packages }),
})));

export const DEFAULT_SAMPLE = SAMPLES[0];

export const findSample = (id) => SAMPLES.find((candidate) => candidate.id === id);

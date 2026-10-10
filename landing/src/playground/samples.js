// The compiler image warms its build tree on these very files, so the sample compiles once and then comes from
// the cache.
import header from '../../../tooling/cloud/compiler/template/src/native/native.h?raw';
import source from '../../../tooling/cloud/compiler/template/src/native/native.cpp?raw';

export const SAMPLE_FILES = Object.freeze({ 'native.h': header, 'native.cpp': source });

export const SAMPLE_SCRIPT = `// Module holds everything native.h declares.
console.log(Module.greet('crossbind'));

const counter = new Module.Counter(41);
counter.increment();
console.log('the counter is at', counter.value());
`;

import bindings from '../standalone-napi/crossbind.config.js';

export default { ...bindings, paths: { ...bindings.paths, config: import.meta.url } };

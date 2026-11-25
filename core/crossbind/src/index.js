import crossbind from './integration/crossbind.js';

// crossbind's one export: crossbind() in a tool's plugin list, or crossbind(config) around the config of a tool that has
// none. require('crossbind') gives the same function.
export default crossbind;
export { crossbind as 'module.exports' };

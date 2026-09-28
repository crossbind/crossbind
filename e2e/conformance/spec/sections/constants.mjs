// The constants of native/confconstants.h a leg imports by name, and `module`, the runtime module itself, to show that a
// name no leg imports and a global that is not const stayed out. Worker legs hand out proxies, so every value is awaited.
export function constantChecks({ add }, c, { native }) {
    const read = (...names) => Promise.all(names.map((name) => c[name]));
    add('const:int', () => read('CONF_INT', 'CONF_NEGATIVE', 'CONF_HEX'), [42, -7, 16]);
    add('const:expression', () => read('CONF_EXPRESSION'), [87]);
    add('const:double', () => read('CONF_DOUBLE'), [2.5]);
    add('const:string', () => read('CONF_STRING'), ['crossbind']);
    add('const:charCode', () => read('CONF_CHAR'), [65]);
    add('const:wideNumber', () => read('CONF_WIDE'), [4294967296]);
    add('const:bool', () => read('CONF_TRUE'), [true]);
    add('const:fromIncludedHeader', () => read('CONF_BASE', 'CONF_BASE_NAME'), [3, 'base']);
    add('const:platformBranch', () => read('CONF_PLATFORM'), [native ? 2 : 1]);
    add('const:constGlobal', () => read('confGlobal', 'confGlobalName'), [5, 'global']);
    add('const:notImportedUnbound', async () => [await c.module.CONF_NOT_IMPORTED, await c.module.confMutable].map((v) => v ?? 'unbound'), ['unbound', 'unbound']);
}

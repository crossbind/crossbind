// Rust surface rules: consts and statics cross as module constants (numbers, booleans and
// strings), closures take JS functions; async and inline modules are todo; pub(crate) stays hidden.
export function rustSurfaceChecks({ add, todo, skip }, s, { worker }) {
    if (worker) skip('rs:cb:*', 'JS functions cannot cross a worker boundary');
    else {
        add('rs:cb:implFn', () => s.confRsApply((x) => x + 1, 2), 3);
        add('rs:cb:boxedFn', () => s.confRsApplyBoxed((x) => x * 2, 2), 4);
    }
    todo('rs:async:promise', () => s.confRsAsyncDouble(4), 8);
    add('rs:static:const', async () => s.CONF_RS_LIMIT, 42);
    add('rs:static:static', async () => s.CONF_RS_NAME, 'confrust');
    todo('rs:mod:inline', () => s.confRsGeo.area(2, 3), 6);
    add('rs:vis:crateHidden', async () => typeof (await s.confRsHidden), 'undefined');
    add('rs:vis:hiddenUsed', () => s.confRsUsesHidden(), 63);
}

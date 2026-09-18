// Every symbol the kit's bridges export must be touched by a check, so a declaration added to
// a header cannot go untested. A leg that builds the bridges itself wires `coverage` with the
// list from spec/bridgeExports.mjs; the vector every class registers rides along untouched by
// name. This module stays free of node builtins because run.mjs imports it on every runtime.
export function trackExports(module) {
    const seen = new Set();
    const proxy = new Proxy(module, {
        get(target, key) {
            if (typeof key === 'string') seen.add(key);
            return target[key];
        },
    });
    return { proxy, seen };
}

export function untouchedExports(exports, seen) {
    return exports.filter((name) => !seen.has(name) && !/^Vector/.test(name));
}

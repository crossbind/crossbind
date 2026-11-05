// The changes a publisher makes to crossbind.config.js's export for the build it publishes, as JSON in the build's
// environment: its own process reads the config again.
export const CONFIG_CHANGES = 'CROSSBIND_CONFIG_CHANGES';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A JSON merge patch of a value, as RFC 7386 has it: an object's keys merge into the value's, null removes a key, and
// any other value takes the place of the one it patches.
export function mergePatch(target, patch) {
    if (!isObject(patch)) return patch;
    const base = isObject(target) ? target : {};
    return Object.fromEntries([
        ...Object.entries(base).filter(([key]) => !Object.hasOwn(patch, key)),
        ...Object.entries(patch).filter(([, value]) => value !== null).map(([key, value]) => [key, mergePatch(base[key], value)]),
    ]);
}

// The changes the environment gives a build, or null for none.
export function configChangesOf(env = process.env) {
    const text = env[CONFIG_CHANGES];
    if (!text) return null;
    let changes;
    try {
        changes = JSON.parse(text);
    } catch (error) {
        throw new Error(`crossbind: ${CONFIG_CHANGES} holds no JSON: ${error.message}`, { cause: error });
    }
    if (!isObject(changes)) throw new Error(`crossbind: ${CONFIG_CHANGES} is no object of changes to crossbind.config.js.`);
    return changes;
}

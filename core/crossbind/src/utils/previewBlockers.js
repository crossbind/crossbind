// What a preview cannot run, which crossbind app preview finds before Vite starts, each stopping it by its name; and
// what belongs to the app's identity, which it names and runs.

// The extensions the crossbind app carries beside crossbind's own, which the protocol's number fixes.
export const CARRIED_EXTENSIONS = ['clipboard', 'preview'];
const PLATFORMS = ['macos', 'ios', 'linux', 'windows', 'android'];
// What of an extension's app part is native code, or the app's own build, which the crossbind app has instead.
const NATIVE_PARTS = ['sources', 'java', 'libraries', 'frameworks', 'plist', 'entitlements', 'targets', 'manifest', 'packages'];

const isGiven = (value) => value !== undefined && value !== null && value !== false
    && (typeof value !== 'object' || Object.keys(value).length > 0);
const hasNativeParts = ({ app = {} }) => isGiven(app.sources)
    || PLATFORMS.some((platform) => NATIVE_PARTS.some((part) => isGiven(app[platform]?.[part])));

// The project builds for the web, as a preview runs it.
function webBuildBlocker({ target }) {
    if (target.runtimeEnv !== 'app') return null;
    return "crossbind: crossbind app preview runs the project's web build, which target.runtimeEnv 'app' in crossbind.config.js leaves out: leave target.runtimeEnv out, so each command builds what it runs, or run crossbind app dev.";
}

function threadsBlocker({ target }) {
    if (target.runtime !== 'mt') return null;
    return "crossbind: a preview runs single-threaded WebAssembly, and target.runtime is 'mt': leave it out, or run crossbind app dev.";
}

function extensionBlockers({ extensions = [] }, carried) {
    return extensions.filter((extension) => hasNativeParts(extension) && !carried.includes(extension.name))
        .map(({ name }) => `crossbind: the extension ${name} has native code, which the crossbind app does not carry: crossbind app dev runs it.`);
}

// A dependency's packages share its name, as a port's of each platform do; one of them serves the web build's target,
// or none does. A cargo dependency builds for the target as the build needs it.
function dependencyBlockers(config, target) {
    const families = new Map();
    for (const dependency of config.allDependencies ?? []) {
        if (dependency === config || dependency.export?.type !== 'cmake') continue;
        families.set(dependency.general.name, [...(families.get(dependency.general.name) ?? []), dependency]);
    }
    return [...families.values()]
        .filter((family) => !family.some((dependency) => dependency.functions?.isEnabled?.(target) !== false))
        .map((family) => {
            const names = family.map((dependency) => dependency.package?.name ?? dependency.general.name);
            return `crossbind: crossbind app preview runs the project's web build, and ${names.join(' and ')} ${names.length > 1 ? 'have' : 'has'} no WebAssembly build: list its wasm package beside the native ones, or run crossbind app dev.`;
        });
}

// Each blocker of the project, in the order a developer mends them; target is the web build's of its dev server.
export function previewBlockers(config, target, carried = CARRIED_EXTENSIONS) {
    const webBuild = webBuildBlocker(config);
    if (webBuild) return [webBuild];
    return [threadsBlocker(config), ...extensionBlockers(config, carried), ...dependencyBlockers(config, target)].filter(Boolean);
}

// What the crossbind app's identity stands in for in a preview: none of it stops one.
export function identityLine({ app = {} }) {
    const items = [
        isGiven(app.urlSchemes) && `app.urlSchemes (links of ${app.urlSchemes.join(', ')} open nothing of this project)`,
        isGiven(app.links) && `app.links (${app.links.join(', ')} open nothing of this project)`,
        isGiven(app.activityTypes) && 'app.activityTypes',
        isGiven(app.shortcutItems) && 'app.shortcutItems',
        isGiven(app.name) && 'app.name',
        isGiven(app.icon) && 'app.icon',
    ].filter(Boolean);
    return items.length > 0 ? `in a preview these are the crossbind app's: ${items.join(', ')}` : null;
}

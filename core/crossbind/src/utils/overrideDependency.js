import { getContentHash } from './hash.js';

const REPLACE_RECIPE_KEYS = [
    'buildType', 'configureProgram', 'getURL', 'env', 'copyToSource', 'copyToDist',
    'beforeRun', 'useIOSCMake', 'sourceReplaceList', 'getExtraLibs',
];

function identityNames(dep) {
    return [dep.general?.name, dep.package?.name, dep.general?.alias?.package].filter(Boolean);
}

function matchEntry(map, dep) {
    if (!map || typeof map !== 'object') return null;
    for (const name of identityNames(dep)) {
        if (Object.prototype.hasOwnProperty.call(map, name)) return { key: name, value: map[name] };
    }
    return null;
}

function normalizeOverride(value) {
    if (!value || typeof value !== 'object') return null;
    const { replace, rebuild, exclude, ...recipe } = value;
    if (rebuild === true) return recipe;
    if (Object.keys(recipe).length > 0) return recipe;
    return null;
}

export function resolveDependencyOverride(overrides, dep) {
    const match = matchEntry(overrides, dep);
    if (!match) return null;
    const override = normalizeOverride(match.value);
    return override ? { key: match.key, override } : null;
}

export function resolveDependencyReplace(replaces, dep) {
    const match = matchEntry(replaces, dep);
    const replace = match?.value && typeof match.value === 'object' ? match.value.replace : null;
    return replace || null;
}

export function resolveExcludedNames(overrides) {
    if (!overrides || typeof overrides !== 'object') return [];
    return Object.keys(overrides).filter((k) => overrides[k]?.exclude === true);
}

// Keep the old package's identity (name/alias/package.name/libName); take the new package's
// implementation (paths, dependencies, build, targetSpecs, version) — so every consumer of the
// old identity keeps resolving while artifacts come from the replacement.
export function restampIdentity(newNode, oldNode) {
    return {
        ...newNode,
        general: oldNode.general,
        package: { ...newNode.package, name: oldNode.package?.name },
        export: { ...newNode.export, libName: oldNode.export.libName },
    };
}

export function mergeBuildOverride(recipe = {}, override = {}) {
    if (!override) return recipe;
    const merged = { ...recipe };

    REPLACE_RECIPE_KEYS.forEach((key) => {
        if (key in override) merged[key] = override[key];
    });

    if (override.replaceList) {
        if (Array.isArray(override.replaceList)) {
            merged.replaceList = [...(recipe.replaceList || []), ...override.replaceList];
        } else if (override.replaceList.set) {
            merged.replaceList = [...override.replaceList.set];
        } else if (override.replaceList.append) {
            merged.replaceList = [...(recipe.replaceList || []), ...override.replaceList.append];
        }
    }

    if (typeof override.getBuildParams === 'function') {
        const base = typeof recipe.getBuildParams === 'function' ? recipe.getBuildParams : () => [];
        merged.getBuildParams = (...args) => override.getBuildParams(base, ...args);
    }

    return merged;
}

// Functions are keyed by their source text: editing the literal changes the key (rebuild),
// but values captured from outer scope do NOT — an override function must stay self-contained
// or a changed captured value silently keeps the stale cache.
export function getOverrideKey(dep) {
    const override = dep.overrideBuild || {};
    const serial = JSON.stringify(
        override,
        (key, value) => (typeof value === 'function' ? `fn:${value.toString()}` : value),
    );
    const parts = [
        dep.general?.name || '',
        override.nativeVersion || dep.package?.nativeVersion || '',
        serial,
    ];
    return getContentHash(parts.join(' '));
}

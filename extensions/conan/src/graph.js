function sourceOf(entry) {
    const source = Array.isArray(entry) ? entry[0] : entry;
    if (!source?.url) return null;
    return { url: Array.isArray(source.url) ? source.url[0] : source.url, sha256: source.sha256 ?? null };
}

function packageOf(node, requires) {
    const components = Object.values(node.cpp_info ?? {});
    const collect = (key) => [...new Set(components.flatMap((component) => component?.[key] ?? []))];
    return {
        name: node.name,
        version: node.version,
        ref: node.ref,
        license: node.license,
        homepage: node.homepage,
        source: sourceOf(node.conandata?.sources?.[node.version]),
        libs: collect('libs'),
        requires,
        systemLibs: collect('system_libs'),
        frameworks: collect('frameworks'),
        defines: collect('defines'),
        packageFolder: node.package_folder,
        includedirs: collect('includedirs'),
        libdirs: collect('libdirs'),
    };
}

// Host packages of a `conan install --format=json` graph, as the recipes wrote them: crossbind checks every field
// itself. Left out are the consumer, build tools, test requirements and packages conan skipped because the consumer
// needs nothing of them.
export function conanPackagesOf(graph) {
    const nodes = graph?.nodes;
    if (!nodes || typeof nodes !== 'object' || !graph.root) {
        throw new Error('crossbind: conan install printed a graph without nodes or a root.');
    }
    const [root] = Object.keys(graph.root);
    const isPackage = (id) => id !== root && nodes[id]?.context === 'host' && !nodes[id].test && nodes[id].binary !== 'Skip';
    const ids = Object.keys(nodes).filter(isPackage);
    const requiresOf = (id) => Object.entries(nodes[id].dependencies ?? {})
        .filter(([dependency, edge]) => !edge?.build && !edge?.test && ids.includes(dependency))
        .map(([dependency]) => nodes[dependency].name);
    return ids.map((id) => packageOf(nodes[id], requiresOf(id)));
}

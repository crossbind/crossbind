import path from 'node:path';

// appExtensions.js with crossbind's own extensions loaded by vitest, whose mocks reach them, as the require() a build
// loads them with does not.
export default async function withOwnTools(importOriginal) {
    const original = await importOriginal();
    const packages = original.ownPackages(path.join(import.meta.dirname, '..', '..', 'app-host'));
    const modules = await Promise.all(packages.map((name) => import(`../../../extensions/${name.replace('@crossbind/extension-', '')}/crossbind.extension.js`)));
    const tools = modules.map(({ default: extension }) => {
        const made = extension();
        return original.checkedExtension(made, made.root, made.name);
    });
    return { ...original, ownExtensions: () => tools };
}

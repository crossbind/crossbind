import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const filesIn = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesIn(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

describe("crossbind's own publishers and installers", () => {
    test.each(['publishers', 'installers'])("of src/%s import nothing of crossbind's, as an extension's package does not: what they use comes through the api", (folder) => {
        const own = path.join(import.meta.dirname, '..', 'src', folder);
        const outside = filesIn(own).filter((file) => file.endsWith('.js')).flatMap((file) => [...fs.readFileSync(file, 'utf8')
            .matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)]
            .map((match) => match[1] ?? match[2])
            .filter((specifier) => !specifier.startsWith('node:') && !path.resolve(path.dirname(file), specifier).startsWith(`${own}${path.sep}`))
            .map((specifier) => `${path.relative(own, file)}: ${specifier}`));
        expect(outside).toEqual([]);
    });
});

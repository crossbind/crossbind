import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'crossbind');

function routedPaths() {
    const skill = fs.readFileSync(path.join(SKILL_ROOT, 'SKILL.md'), 'utf8');
    const spans = skill.match(/`[^`\n]+`/g) ?? [];
    return [...new Set(spans
        .map((span) => span.slice(1, -1))
        .filter((value) => value.startsWith('references/') || value.startsWith('scripts/'))
        .map((value) => value.replace(/\/$/, '')))].sort();
}

test('every path SKILL.md routes to exists in the bundle', () => {
    const routes = routedPaths();
    // Guards against a reformat that makes the extraction silently match nothing.
    assert.ok(routes.length >= 6, `expected SKILL.md to route to bundled paths; extracted ${routes.length}`);
    for (const route of routes) {
        assert.ok(fs.existsSync(path.join(SKILL_ROOT, route)), `SKILL.md routes to missing ${route}`);
    }
});

test('routed directories carry references', () => {
    for (const route of routedPaths()) {
        const absolute = path.join(SKILL_ROOT, route);
        if (!fs.statSync(absolute).isDirectory()) continue;
        assert.ok(fs.readdirSync(absolute).length > 0, `${route} is an empty directory`);
    }
});

test('the inspector the skill routes to is executable as a module', async () => {
    const inspectorUrl = pathToFileURL(path.join(SKILL_ROOT, 'scripts', 'inspect-project.mjs')).href;
    const module = await import(inspectorUrl);
    assert.equal(typeof module.inspectProject, 'function');
});

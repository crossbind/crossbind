import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';

const REPOSITORY = path.join(import.meta.dirname, '..', '..', '..');
const OWN_PACKAGE = '@crossbind/extension-';
const SHARED = '@crossbind/core-store-kit';
// What a package's page.js alone takes of crossbind's, as a page runs it.
const PAGE_API = 'crossbind/app/core';
// What an app lists itself, as its page imports it.
const OPTIONAL = ['clipboard'];

const filesIn = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== 'node_modules')
    .flatMap((entry) => (entry.isDirectory() ? filesIn(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const { dependencies } = JSON.parse(fs.readFileSync(path.join(REPOSITORY, 'core', 'app-host', 'package.json'), 'utf8'));
const own = Object.keys(dependencies).filter((name) => name.startsWith(OWN_PACKAGE)).map((name) => name.slice(OWN_PACKAGE.length));

describe("crossbind's own extensions", () => {
    test.each(own)("%s's README names what it reads, the roles it holds, its options and commands, and how to leave it out", async (name) => {
        const dir = path.join(REPOSITORY, 'extensions', name);
        const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
        const { default: descriptor } = await import(pathToFileURL(path.join(dir, 'crossbind.extension.js')).href);
        const extension = descriptor();
        const kebab = (option) => option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        const named = [
            ...(extension.reads ?? []).map((option) => `app.${option}`),
            ...(extension.app ? (extension.holds ?? [name]).map((role) => `\`${role}\``) : []),
            ...Object.keys(extension.publisher?.options ?? {}).map((option) => `--${kebab(option)}`),
            ...Object.keys(extension.commands ?? {}).map((command) => `crossbind app ${command}`),
            `without: ['${name}']`,
        ];
        expect(named.filter((text) => !readme.includes(text))).toEqual([]);
    });

    test("READMEs link to headings their documents have", () => {
        const slug = (heading) => heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
        const headings = (file) => new Set([...fs.readFileSync(path.join(REPOSITORY, 'docs', 'api', file), 'utf8').matchAll(/^#{2,3} (.+)$/gm)].map((match) => slug(match[1])));
        const missing = fs.readdirSync(path.join(REPOSITORY, 'extensions')).flatMap((name) => [...fs.readFileSync(path.join(REPOSITORY, 'extensions', name, 'README.md'), 'utf8')
            .matchAll(/docs\/api\/([a-z-]+\.md)#([a-z0-9-]+)/g)]
            .filter(([, file, anchor]) => !headings(file).has(anchor))
            .map(([link]) => `${name}: ${link}`));
        expect(missing).toEqual([]);
    });

    test('carry the npm keyword crossbind-extension, as every extension does, those the host brings as well', () => {
        const folders = fs.readdirSync(path.join(REPOSITORY, 'extensions'));
        const without = folders.filter((name) => !JSON.parse(fs.readFileSync(path.join(REPOSITORY, 'extensions', name, 'package.json'), 'utf8')).keywords?.includes('crossbind-extension'));
        expect(without).toEqual([]);
    });

    test('are every package of the extensions folder that an app does not list itself', () => {
        const folders = fs.readdirSync(path.join(REPOSITORY, 'extensions')).filter((name) => !OPTIONAL.includes(name));
        expect(own.toSorted()).toEqual(folders.toSorted());
    });

    test.each(own)("%s imports nothing of crossbind's but in its page.js, as an extension's package does not: what it uses comes through the api", (name) => {
        const dir = path.join(REPOSITORY, 'extensions', name);
        const outside = filesIn(dir).filter((file) => file.endsWith('.js')).flatMap((file) => [...fs.readFileSync(file, 'utf8')
            .matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)]
            .map((match) => match[1] ?? match[2])
            .filter((specifier) => !specifier.startsWith('node:') && specifier !== SHARED && !(path.basename(file) === 'page.js' && specifier === PAGE_API)
                && !(specifier.startsWith('.') && path.resolve(path.dirname(file), specifier).startsWith(`${dir}${path.sep}`)))
            .map((specifier) => `${path.relative(dir, file)}: ${specifier}`));
        expect(outside).toEqual([]);
    });
});

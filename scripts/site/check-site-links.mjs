import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Static integrity check for the built site (landing/dist): every internal link and anchor
// resolves to a prerendered page, every redirect lands on a real page without chaining, the
// routes the site promises exist, and llms.txt is a text file rather than an HTML fallback.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.resolve(process.argv[2] ?? path.join(ROOT, 'landing', 'dist'));
export const REQUIRED_ROUTES = [
    '/',
    '/guide/',
    '/guide/quick-start/',
    '/ports/',
    '/api/',
    '/agent/',
    '/changelog/',
    '/llms.txt',
    '/sitemap.xml',
    '/robots.txt',
];

const HREF = /\b(?:href|src)="([^"]*)"/g;
const ID = /\bid="([^"]+)"/g;

function walk(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walk(absolute));
        else files.push(absolute);
    }
    return files;
}

function routeToFile(route) {
    const clean = route.split('#')[0].split('?')[0];
    const candidates = clean.endsWith('/') ? [path.join(DIST, clean, 'index.html')] : [path.join(DIST, clean), path.join(DIST, clean, 'index.html')];
    return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function routeOf(file) {
    const relative = path.relative(DIST, file).split(path.sep).join('/');
    return relative.endsWith('index.html') ? `/${relative.slice(0, -'index.html'.length)}` : `/${relative}`;
}

function decode(value) {
    return value.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
}

export function checkSite(dist = DIST, { pageAnchors = new Map() } = {}) {
    const failures = [];
    // /examples/<id>/ holds the example apps built for the page (their own bundles, verified in a
    // browser by build-example-demos.mjs); they are not site pages and use root-relative assets.
    const isDemoApp = (file) => /^examples\/[^/]+\//.test(path.relative(dist, file));
    const pages = walk(dist).filter((file) => file.endsWith('.html') && !isDemoApp(file));
    const ids = new Map(pages.map((file) => [file, new Set([...fs.readFileSync(file, 'utf8').matchAll(ID)].map((match) => match[1]))]));

    for (const route of REQUIRED_ROUTES) {
        if (!routeToFile(route)) failures.push(`required route ${route} is not in the build`);
    }
    const llms = path.join(dist, 'llms.txt');
    if (fs.existsSync(llms) && /^\s*<!doctype html/i.test(fs.readFileSync(llms, 'utf8'))) failures.push('llms.txt is HTML, not text');

    for (const file of pages) {
        const html = fs.readFileSync(file, 'utf8');
        const here = routeOf(file);
        for (const match of html.matchAll(HREF)) {
            const raw = decode(match[1]);
            if (!raw || raw.startsWith('http') || raw.startsWith('mailto:') || raw.startsWith('data:') || raw.startsWith('//')) continue;
            const [target, anchor] = raw.split('#');
            const targetFile =
                target === '' ? file : routeToFile(target.startsWith('/') ? target : path.posix.join(path.posix.dirname(here), target));
            if (!targetFile) {
                failures.push(`${here} links to ${raw}, which is not in the build`);
                continue;
            }
            if (anchor && targetFile.endsWith('.html') && !ids.get(targetFile)?.has(anchor)) {
                failures.push(`${here} links to ${raw}, but that anchor does not exist`);
            }
        }
    }

    const redirects = path.join(dist, '_redirects');
    if (fs.existsSync(redirects)) {
        const rules = fs
            .readFileSync(redirects, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => line.split(/\s+/));
        const sources = new Set(rules.map(([from]) => from));
        for (const [from, to, status] of rules) {
            if (!from?.startsWith('/') || !to) failures.push(`_redirects: malformed rule "${from} ${to}"`);
            if (status && status !== '301') failures.push(`_redirects: ${from} uses status ${status}; only 301 is expected`);
            if (from === to) failures.push(`_redirects: ${from} redirects to itself`);
            if (routeToFile(from) && !from.includes('*')) failures.push(`_redirects: ${from} shadows a real page`);
            if (to.startsWith('/')) {
                if (sources.has(to)) failures.push(`_redirects: ${from} -> ${to} chains into another redirect`);
                if (!to.includes(':splat') && !routeToFile(to)) failures.push(`_redirects: ${from} -> ${to}, but that page is not in the build`);
            }
        }
    }

    // Search results link to /<page>#<h2 id> straight from the page objects, not from rendered
    // HTML, so a custom page layout that drops a heading id breaks a link no static scan sees.
    for (const [href, anchorIds] of pageAnchors) {
        const file = routeToFile(href);
        if (!file) continue;
        for (const id of anchorIds) {
            if (!ids.get(file)?.has(id)) failures.push(`search would link to ${href}#${id}, but that id is not rendered`);
        }
    }

    const sitemap = path.join(dist, 'sitemap.xml');
    if (fs.existsSync(sitemap)) {
        for (const match of fs.readFileSync(sitemap, 'utf8').matchAll(/<loc>https:\/\/crossbind\.dev([^<]*)<\/loc>/g)) {
            if (!routeToFile(match[1])) failures.push(`sitemap lists ${match[1]}, which is not in the build`);
        }
    }
    return { pages: pages.length, failures };
}

// The page objects need the generated modules a build leaves behind; without them the anchor
// check is skipped and said so.
async function loadPageAnchors() {
    const generated = path.join(ROOT, 'landing', 'generated', 'release-snapshot.js');
    if (!fs.existsSync(generated)) {
        process.stderr.write('note: landing/generated is missing, search-anchor check skipped\n');
        return new Map();
    }
    const { SITE_PAGES } = await import(pathToFileURL(path.join(ROOT, 'landing', 'src', 'site-pages.js')).href);
    return new Map(SITE_PAGES.map((page) => [page.href, page.blocks.filter((block) => block.type === 'h2' && block.id).map((block) => block.id)]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { pages, failures } = checkSite(DIST, { pageAnchors: await loadPageAnchors() });
    if (failures.length) {
        process.stderr.write(`Site check failed (${pages} pages):\n- ${failures.join('\n- ')}\n`);
        process.exit(1);
    }
    process.stdout.write(`Site check passed: ${pages} pages, every internal link, anchor, redirect and sitemap entry resolves.\n`);
}

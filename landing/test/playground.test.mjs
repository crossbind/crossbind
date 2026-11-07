import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SITE_ROUTES } from '../src/site-pages.js';
import PLAYGROUND_PAGE from '../src/pages/playground.js';
import { PAUSED, runOffReason } from '../src/playground/runReason.js';
import { LIMITS } from '../../tooling/cloud/compiler/sandbox.js';
import { sampleProject } from '../../scripts/site/build-example-demos.mjs';

const html = readFileSync(new URL('../public/playground/sandbox.html', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.indexOf('</script>'));
const scriptHash = `'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`;
const headerPolicy = headers.split('\n').map((line) => line.trim()).find((line) => line.startsWith('Content-Security-Policy: sandbox'));
const ruleOf = (path) => headers.match(new RegExp(`^${path.replaceAll('.', '\\.')}\\n((?: {2}.+\\n?)+)`, 'm'))?.[1].trim();

test('the sandbox page runs its one inline script by hash, in its own policy and in the header', () => {
    assert.equal(html.match(/<script/g).length, 1);
    assert.ok(html.includes(`script-src ${scriptHash} blob:`), 'the meta policy names the script hash');
    assert.ok(headerPolicy.includes(`script-src ${scriptHash} blob:`), 'the header policy names the script hash');
});

test('the sandbox header keeps visitor code in an opaque origin with no way out, even on its own', () => {
    assert.match(headerPolicy, /^Content-Security-Policy: sandbox allow-scripts; /);
    assert.doesNotMatch(headerPolicy, /allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/);
    assert.match(headerPolicy, /default-src 'none'/);
    assert.doesNotMatch(headerPolicy, /connect-src|img-src|frame-src/);
    assert.match(headerPolicy, /frame-ancestors 'self'/);
});

test('Cloudflare Pages serves the sandbox page at /playground/sandbox, so that path has the same headers', () => {
    assert.ok(ruleOf('/playground/sandbox.html').includes(headerPolicy));
    assert.equal(ruleOf('/playground/sandbox'), ruleOf('/playground/sandbox.html'));
});

test('the playground is a page of the site, so it is prerendered and in the sitemap', () => {
    assert.ok(SITE_ROUTES.includes('/playground/'));
});

test('the page names the time and memory a compile gets in the sandbox', () => {
    const text = JSON.stringify(PLAYGROUND_PAGE);
    assert.ok(text.includes(`${LIMITS.wallMs / 1000} seconds`));
    assert.ok(text.includes(`${LIMITS.dataBytes / 1024 ** 3} GB of memory`));
});

test('until the first run the console says what a compile gets and links Privacy', () => {
    const intro = PLAYGROUND_PAGE.intro.join(' ');
    assert.ok(intro.includes(`${LIMITS.wallMs / 1000} seconds`));
    assert.ok(intro.includes(`${LIMITS.dataBytes / 1024 ** 3} GB of memory`));
    assert.ok(intro.includes('](/privacy/)'));
});

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the playground always opens in the Turbo look and nothing leads to the modern one', () => {
    assert.match(source('../src/playground/PlaygroundPage.jsx'), /^const SKIN = 'turbo';$/m);
    assert.ok(!source('../src/playground/TurboBar.jsx').includes('Modern view'));
    assert.ok(!source('../src/sections/Hero.jsx').includes('skin='));
    assert.ok(!source('../index.html').includes('data-playground-skin'));
});

test('Run closes the Turbo menu bar, after File, Packages and Samples', () => {
    const bar = source('../src/playground/TurboBar.jsx');
    const at = (label) => bar.indexOf(`<Hotkey>${label}</Hotkey>`);
    const labels = ['Run', 'Samples', 'Packages', 'File'].filter((label) => at(label) >= 0);
    assert.deepEqual(labels.toSorted((a, b) => at(a) - at(b)), ['File', 'Packages', 'Samples', 'Run']);
});

test('the project lists crossbind.config.js with no note beside it', () => {
    const row = source('../src/playground/ProjectPanel.jsx').split('\n').find((line) => line.includes('label={CONFIG}'));
    assert.ok(row && !row.includes('note='), row);
});

test('the hero shows the hero sample in the 66 characters its code column holds; it takes no packages, having no config tab to declare them', () => {
    const { files, packages } = sampleProject('hero');
    [files['main.js'], files['native/greet.h'], files['native/math.rs']].join('\n').split('\n')
        .forEach((line) => assert.ok(line.length <= 66, line));
    assert.deepEqual(packages, []);
});

test('Run that cannot run says why: the compile the project needs, and what keeps the service from it', () => {
    const unreachable = 'The playground service cannot be reached right now.';
    assert.equal(runOffReason({ prebuilt: true, session: null }), null);
    assert.equal(runOffReason({ prebuilt: false, session: { enabled: true } }), null);
    assert.equal(runOffReason({ prebuilt: false, session: null }), 'This project needs a compile. The playground service has not answered yet.');
    assert.equal(runOffReason({ prebuilt: false, session: { error: unreachable } }), `This project needs a compile. ${unreachable}`);
    assert.equal(runOffReason({ prebuilt: false, session: { enabled: false } }), `This project needs a compile. ${PAUSED}`);
    assert.equal(
        runOffReason({ prebuilt: false, session: { error: unreachable }, canReset: true }),
        `This project needs a compile. ${unreachable} Reset your changes to run it without one.`,
    );
});

test("the package dialog's close box is a button that closes it, as Turbo Vision's was, and comes last so the search keeps the opening focus", () => {
    const dialog = readFileSync(new URL('../src/playground/PackageDialog.jsx', import.meta.url), 'utf8');
    const closeBox = dialog.search(/<button type="button" onClick=\{onClose\} aria-label="Close" className="turbo-close"[^>]*>\s*\[<span>■<\/span>\]/);
    assert.ok(closeBox > 0);
    assert.ok(closeBox > dialog.indexOf('type="search"'));
    // Its mark lightens on the hover's green, or the green square would vanish into it.
    assert.match(readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8'), /\.turbo-close:hover span \{\s*color: #55ff55;/);
});

test('on a phone the package dialog puts what a package is under its name, beside its box, and leaves the version to the desktop', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n    .turbo-package'));
    assert.ok(phone.length < css.length);
    // A 44px column, the phone's tap target, so an added row's narrower [X] keeps its name in line with the others.
    assert.match(phone, /\.turbo-package \{\s*grid-template-columns: 44px minmax\(0, 1fr\);/);
    assert.match(phone, /\.turbo-package \.package-add \{\s*grid-row: 1 \/ span 2;\s*justify-self: center;/);
    assert.match(phone, /\.turbo-package \.package-summary \{\s*grid-column: 2;\s*grid-row: 2;/);
    assert.match(phone, /\.turbo-package \.package-version \{\s*display: none;/);
});

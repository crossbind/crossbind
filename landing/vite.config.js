import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { vitePrerenderPlugin } from 'vite-prerender-plugin';
// Both of these read the generated release snapshot (landing/generated/release-snapshot.js), which
// `pnpm run resolve:release` writes before dev and build. A missing-module error here means that
// step did not run, or the release metadata failed verification and the build must not go on.
import { assertSnapshotMatchesConfig, BUILD_TOKEN_ENVIRONMENT_VARIABLE } from '../scripts/release/resolve-site-release.mjs';
import { BUILD_TOKEN } from './generated/release-snapshot.js';
import releaseConfig from './release.config.js';
import { SITE } from './src/data.js';
import { renderLlmsText } from './src/llms.js';
import { RELEASE } from './src/release.js';
import { SITE_ROUTES } from './src/site-pages.js';

// The sitemap is derived from the same route list the prerenderer walks, so a new guide page
// cannot be prerendered and left out of it. Replaces the hand-written public/sitemap.xml; no
// lastmod, because a hand-maintained date goes stale without anyone noticing.
function sitemap() {
    return {
        name: 'sitemap',
        apply: 'build',
        closeBundle() {
            const urls = ['/', ...SITE_ROUTES].map((path) => `${SITE}${path}`);
            const xml = [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
                ...urls.map((url) => `    <url><loc>${url}</loc></url>`),
                '</urlset>',
                '',
            ].join('\n');
            writeFileSync(resolve(import.meta.dirname, 'dist/sitemap.xml'), xml);
        },
    };
}

// What this build was resolved from, next to the site so the deploy step can refuse a fixture
// build (scripts/release/check-site-snapshot.mjs) and anyone can see which release is live.
function releaseSnapshot() {
    return {
        name: 'release-snapshot',
        apply: 'build',
        closeBundle() {
            const {
                source,
                resolvedAt,
                package: name,
                version,
                channel,
                prerelease,
                distTag,
                gitTag,
                gitCommit,
                publishedAt,
                npmUrl,
                githubReleaseUrl,
                companions,
                history,
            } = RELEASE;
            const summary = {
                source,
                resolvedAt,
                package: name,
                version,
                channel,
                prerelease,
                distTag,
                gitTag,
                gitCommit,
                publishedAt,
                npmUrl,
                githubReleaseUrl,
                companions,
                changelogPages: history.map((entry) => entry.version),
            };
            writeFileSync(resolve(import.meta.dirname, 'dist/release-snapshot.json'), `${JSON.stringify(summary, null, 2)}\n`);
        },
    };
}

// /llms.txt is a real text file next to the pages, generated from the same snapshot and catalog,
// so agents fetching it never get the HTML fallback.
function llmsText() {
    return {
        name: 'llms-txt',
        apply: 'build',
        closeBundle() {
            writeFileSync(resolve(import.meta.dirname, 'dist/llms.txt'), renderLlmsText());
        },
    };
}

// Preact via preset-vite: this page has three onClick handlers, so React's runtime was most
// of the bundle. Source keeps importing from 'react'; the preset aliases it to preact/compat.
//
// The prerender plugin bakes the rendered markup into index.html at build time, so clients that
// do not run JS - AI crawlers among them - get the whole page instead of an empty root element.
// It also walks the links returned by prerender(), which is how each /guide/ route gets its own
// static HTML file.
//
// A snapshot left behind by an earlier run, or resolved for another channel, must not build or
// serve: the resolver hands a token to the vite process it spawns, so only `pnpm run build`/`dev`
// produce a site that says what npm says. `vite preview` only serves what a build already wrote.
// Dev only: Vite serves public/ by exact path, so /examples/<id>/ (a live demo built into
// public/examples/) would fall through to the SPA index. The static build and Pages serve the
// directory's index.html on their own.
function demoDirectories() {
    return {
        name: 'crossbind-demo-directories',
        configureServer(server) {
            server.middlewares.use((request, _response, next) => {
                const match = /^\/examples\/([^/?]+)\/(\?.*)?$/.exec(request.url ?? '');
                if (match && existsSync(resolve('public', 'examples', match[1], 'index.html'))) {
                    request.url = `/examples/${match[1]}/index.html${match[2] ?? ''}`;
                }
                next();
            });
        },
    };
}

export default defineConfig(({ isPreview }) => {
    if (!isPreview) {
        assertSnapshotMatchesConfig(RELEASE, {
            channel: releaseConfig.channel,
            buildToken: BUILD_TOKEN,
            environmentToken: process.env[BUILD_TOKEN_ENVIRONMENT_VARIABLE],
        });
    }
    return {
        plugins: [preact(), vitePrerenderPlugin({ renderTarget: '#root' }), sitemap(), releaseSnapshot(), llmsText(), demoDirectories()],
        build: { outDir: 'dist' },
    };
});

import { posix } from 'node:path';

const API_DOC = /\/blob\/main\/docs\/api\/([\w-]+\.md)$/;

// Same-site links in Markdown output point at the Markdown twin of the page when there is one,
// so an agent that follows them keeps reading Markdown instead of landing on the HTML build.
export function createLinkResolver({ site, repoUrl, pagePaths }) {
    const pages = new Set(pagePaths);
    const twin = (path) => `${site}${path === '/' ? '/index' : path}.md`;

    return (href) => {
        if (href.startsWith('#')) return href;
        if (href.startsWith(repoUrl)) {
            const doc = href.match(API_DOC);
            return doc ? `${site}/api/${doc[1]}` : href;
        }
        if (!href.startsWith('/')) return href;
        const [target, hash] = href.split('#');
        const path = target.replace(/\/+$/, '') || '/';
        if (path !== '/' && !pages.has(path)) return `${site}${href}`;
        return `${twin(path)}${hash ? `#${hash}` : ''}`;
    };
}

// A reference document's parent-relative links name repository files the site does not serve.
export function rewriteDocLinks(markdown, { repoUrl, docsDir }) {
    return markdown.replace(
        /\]\((\.\.\/[^)\s]+)\)/g,
        (_, relative) => `](${repoUrl}/blob/main/${posix.normalize(posix.join(docsDir, relative))})`,
    );
}

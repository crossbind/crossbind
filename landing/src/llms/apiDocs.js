import { readdirSync, readFileSync } from 'node:fs';
import { REPO_URL, SITE } from '../data.js';
import { rewriteDocLinks } from './links.js';

const DOCS_DIR = new URL('../../../docs/api/', import.meta.url);
const DOCS_REPO_DIR = 'docs/api';

export const API_DOCS_BASE = '/api';

// The canonical reference documents, served next to the site so an agent fetches Markdown
// rather than a GitHub page. Build-time only: the app never imports this module.
export function readApiDocs() {
    return readdirSync(DOCS_DIR)
        .filter((file) => file.endsWith('.md'))
        .sort()
        .map((file) => ({
            file,
            path: `${API_DOCS_BASE}/${file}`,
            url: `${SITE}${API_DOCS_BASE}/${file}`,
            markdown: rewriteDocLinks(readFileSync(new URL(file, DOCS_DIR), 'utf8'), { repoUrl: REPO_URL, docsDir: DOCS_REPO_DIR }),
        }));
}

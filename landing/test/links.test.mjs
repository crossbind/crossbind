import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLinkResolver, rewriteDocLinks } from '../src/llms/links.js';

const resolve = createLinkResolver({
    site: 'https://example.test',
    repoUrl: 'https://github.com/o/r',
    pagePaths: ['/guide', '/guide/quick-start', '/ports/gdal'],
});

test('points site pages at their Markdown twins and keeps anchors', () => {
    assert.equal(resolve('/guide/quick-start/'), 'https://example.test/guide/quick-start.md');
    assert.equal(resolve('/guide/quick-start/#first-call'), 'https://example.test/guide/quick-start.md#first-call');
    assert.equal(resolve('/guide/'), 'https://example.test/guide.md');
    assert.equal(resolve('/'), 'https://example.test/index.md');
    assert.equal(resolve('#install'), '#install');
});

test('makes other site paths absolute and leaves external links alone', () => {
    assert.equal(resolve('/examples/web-react-vite/'), 'https://example.test/examples/web-react-vite/');
    assert.equal(resolve('/llms.txt'), 'https://example.test/llms.txt');
    assert.equal(resolve('https://npmjs.com/x'), 'https://npmjs.com/x');
    assert.equal(resolve('https://github.com/o/r/discussions'), 'https://github.com/o/r/discussions');
});

test('maps repository API documents to their served copies', () => {
    assert.equal(resolve('https://github.com/o/r/blob/main/docs/api/init.md'), 'https://example.test/api/init.md');
});

test('rewrites a document\'s parent-relative links to the repository', () => {
    const markdown = 'See [ADR](../adr/0003-x.md), [ports](../../ports/README.md) and [init](./init.md).';

    assert.equal(
        rewriteDocLinks(markdown, { repoUrl: 'https://github.com/o/r', docsDir: 'docs/api' }),
        'See [ADR](https://github.com/o/r/blob/main/docs/adr/0003-x.md), '
            + '[ports](https://github.com/o/r/blob/main/ports/README.md) and [init](./init.md).',
    );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { decode } from '../check-site-links.mjs';

test('attribute entities are decoded in one pass, so an escaped entity is not decoded twice', () => {
    assert.equal(decode('/guide/?a=1&amp;b=2'), '/guide/?a=1&b=2');
    assert.equal(decode('&#39;x&#39; &quot;y&quot;'), '\'x\' "y"');
    assert.equal(decode('&amp;quot;'), '&quot;');
    assert.equal(decode('&amp;#39;'), '&#39;');
});

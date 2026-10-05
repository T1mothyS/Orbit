import assert from 'node:assert/strict';
import test from 'node:test';
import { noteLinkPieces } from '../src/utils/note-links.js';
const origin = 'https://orbit.example';
const links = (text: string) => noteLinkPieces(text, origin).filter(piece => piece.href);

test('note links recognize bare domains, subdomains and paths without changing visible text', () => {
  const text = 'ippure.com，www.example.com/path?a=1&b=2；news.example.co.uk/#section。';
  assert.deepEqual(links(text).map(piece => piece.href), ['https://ippure.com/', 'https://www.example.com/path?a=1&b=2', 'https://news.example.co.uk/#section']);
  assert.equal(noteLinkPieces(text, origin).map(piece => piece.text).join(''), text);
  assert.equal(links('(example.com)').at(0)?.href, 'https://example.com/');
  assert.equal(links('example.com:8443/path')[0].href, 'https://example.com:8443/path');
});
test('existing external, Markdown and internal note links retain safe navigation', () => {
  assert.deepEqual(links('http://example.com/a https://example.com/a_(b) [事项](/schedule?schedule=1) /project?view=statistics [网站](ippure.com)').map(piece => piece.href), ['http://example.com/a', 'https://example.com/a_(b)', '/schedule?schedule=1', '/project?view=statistics', 'https://ippure.com/']);
  assert.equal(links('https://orbit.example/library/a')[0].href, '/library/a');
});
test('note links reject embedded emails, numeric values, files and unsafe schemes', () => {
  for (const text of ['me@ippure.com', 'a.b@example.com', 'me@example.com:8443', '1.23 127.0.0.1', 'report.pdf notes.txt file.docx src/index.ts', 'javascript:example.com', 'ftp://example.com', 'data:text/html,example.com', '[坏链接](javascript:example.com)', 'https://user:password@example.com', '//example.com', 'C:\\example.com']) {
    assert.deepEqual(links(text), [], text);
    assert.equal(noteLinkPieces(text, origin).map(piece => piece.text).join(''), text);
  }
});

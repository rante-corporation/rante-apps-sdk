'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkPath } = require('../lib/paths');

test('accepts ordinary build output paths', () => {
  for (const p of ['index.html', 'assets/index-DwP3k_1a.js', 'static/js/main.8f3c1e.chunk.js', 'img/logo@2x.png',
    'fonts/Inter-Regular.woff2', '.well-known/security.txt', 'a/b/c/d.json', '_next/static/chunks/app-1(2).js']) {
    const r = checkPath(p);
    assert.equal(r.ok, true, p);
    assert.equal(r.path, p);
    assert.equal(r.isDirectory, false);
  }
  assert.deepEqual(checkPath('assets/'), { ok: true, path: 'assets', isDirectory: true });
});

test('refuses zip slip: traversal, absolute paths and drive letters', () => {
  const cases = ['../evil.js', 'a/../../evil.js', 'a/./b.js', './index.html', '/etc/passwd', 'C:/Windows/win.ini', 'c:evil.js'];
  for (const p of cases) {
    const r = checkPath(p);
    assert.equal(r.ok, false, p);
    assert.equal(r.code, 'path_traversal', p);
  }
});

test('refuses backslashes, empty segments and unsafe characters', () => {
  const cases = ['..\\evil.js', 'a\\b.js', 'a//b.js', 'a b.js', 'a%2e.js', 'a#b.js', 'a?b.js', 'quote".js', 'a:b.js',
    'caf\u00e9.js', 'tab\t.js', 'nul\u0000.js', 'end.', 'x/con', 'NUL.txt', 'lpt1.js', ''];
  for (const p of cases) {
    const r = checkPath(p);
    assert.equal(r.ok, false, JSON.stringify(p));
    assert.equal(r.code, 'path_invalid', JSON.stringify(p));
  }
});

test('refuses hidden files and macOS metadata', () => {
  for (const p of ['.env', 'config/.secrets', '.git/config', 'a/.well-known/x.txt', '__MACOSX/._index.html', '.DS_Store']) {
    const r = checkPath(p);
    assert.equal(r.ok, false, p);
    assert.equal(r.code, 'hidden_file', p);
  }
});

test('limits length and depth', () => {
  assert.equal(checkPath('a/'.repeat(32) + 'x.js').ok, false);
  assert.equal(checkPath('a/'.repeat(31) + 'x.js').ok, true);
  assert.equal(checkPath('x'.repeat(256) + '.js').ok, false);
  assert.equal(checkPath(('d'.repeat(100) + '/').repeat(5) + 'x.js').ok, false);
});

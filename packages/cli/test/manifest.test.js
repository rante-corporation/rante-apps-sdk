'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest, SCOPES } = require('../lib/manifest');
const { bundleManifest, externalManifest } = require('./helpers');

function fields(errors) {
  return errors.map((e) => e.field);
}

test('accepts a bundle manifest and an external manifest', () => {
  assert.deepEqual(validateManifest(bundleManifest()), []);
  assert.deepEqual(validateManifest(externalManifest()), []);
  assert.deepEqual(validateManifest(bundleManifest({
    $schema: 'https://example.com/schema.json',
    description: 'Line one.\nLine two.',
    author: { name: 'Contoso Ltd', email: 'apps@contoso.example', url: 'https://contoso.example' },
    permissions: Object.keys(SCOPES),
    connect: ['https://api.contoso.example', 'wss://live.contoso.example:8443', 'https://*.cdn.contoso.example'],
    version: '10.20.30-beta.1'
  })), []);
});

test('needs the required fields', () => {
  const errors = validateManifest({});
  for (const f of ['manifestVersion', 'id', 'name', 'version', 'hosting']) assert.ok(fields(errors).includes(f), f);
  assert.equal(validateManifest(null)[0].message, 'manifest.json must contain a JSON object.');
  assert.equal(validateManifest([])[0].field, '');
});

test('refuses unknown fields, including typos', () => {
  const errors = validateManifest(bundleManifest({ permisions: [] }));
  assert.deepEqual(fields(errors), ['permisions']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ author: { name: 'A', twitter: '@a' } }))), ['author.twitter']);
});

test('checks the app id', () => {
  assert.deepEqual(fields(validateManifest(bundleManifest({ id: 'contoso.app' }))), ['id']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ id: '00000000-0000-0000-0000-000000000000' }))), ['id']);
  assert.deepEqual(validateManifest(bundleManifest({ id: '3F2B8C1E-7D4A-4E9B-A6C5-1D2E3F4A5B6C' })), []);
});

test('checks the version is semantic', () => {
  for (const v of ['1.0.0', '0.0.1', '1.2.3-rc.1', '1.2.3-0a', '1.2.3-x-y']) assert.deepEqual(validateManifest(bundleManifest({ version: v })), [], v);
  for (const v of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-01', '1.0.0+build', '1.0.0-', '1.0.0-a..b', 1]) {
    assert.deepEqual(fields(validateManifest(bundleManifest({ version: v }))), ['version'], String(v));
  }
});

test('checks text fields', () => {
  assert.deepEqual(fields(validateManifest(bundleManifest({ name: '' }))), ['name']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ name: ' Padded' }))), ['name']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ name: 'x'.repeat(61) }))), ['name']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ name: 'Bad' + String.fromCharCode(0x202e) + 'name' }))), ['name']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ name: 'Tab' + String.fromCharCode(9) + 'name' }))), ['name']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ description: 'x'.repeat(501) }))), ['description']);
});

test('a bundle entry point is an HTML file inside the package', () => {
  assert.deepEqual(validateManifest(bundleManifest({ entryPoint: 'app/index.htm' })), []);
  for (const e of ['../index.html', '/index.html', 'index.js', 'app/', 'index.html?x=1']) {
    assert.deepEqual(fields(validateManifest(bundleManifest({ entryPoint: e }))), ['entryPoint'], e);
  }
  const hint = validateManifest(bundleManifest({ entryPoint: 'https://app.example.com/' }))[0].message;
  assert.match(hint, /set "hosting" to "external"/);
});

test('an external entry point is a public https URL', () => {
  for (const e of ['http://app.example.com', 'https://localhost:3000', 'https://127.0.0.1/', 'https://[::1]/',
    'https://user:pw@app.example.com', 'https://app.example.com/#x', 'https://intranet/', 'app.example.com', 'https://a b.com',
    'https://localhost./', 'https://intranet./', 'https://app.example.com./', 'https://localhost%2E/', 'https://127.1/',
    'https://0x7f.1/', 'https://app.example.123/']) {
    assert.deepEqual(fields(validateManifest(externalManifest({ entryPoint: e }))), ['entryPoint'], e);
  }
  assert.deepEqual(validateManifest(externalManifest({ entryPoint: 'https://app.example.com:8443/rante?tenant=1' })), []);
  assert.deepEqual(validateManifest(externalManifest({ entryPoint: 'https://app.xn--zckzah/' })), []);
});

test('icons: a file in the package for bundles, an https URL for external apps', () => {
  assert.deepEqual(fields(validateManifest(bundleManifest({ icon: 'icon.gif' }))), ['icon']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ icon: 'https://cdn.example.com/i.png' }))), ['icon']);
  assert.deepEqual(fields(validateManifest(externalManifest({ icon: 'icon.png' }))), ['icon']);
  assert.deepEqual(fields(validateManifest(externalManifest({ icon: 'https://localhost./icon.png' }))), ['icon']);
});

test('author: an email address without control or invisible characters, and a public https URL', () => {
  const withAuthor = (author) => bundleManifest({ author: Object.assign({ name: 'A' }, author) });
  assert.deepEqual(validateManifest(withAuthor({ email: 'apps@contoso.example' })), []);
  assert.deepEqual(validateManifest(withAuthor({ email: 'j' + String.fromCharCode(0xf6) + 'rg@contoso.example' })), []);
  for (const c of [0x01, 0x1b, 0x85, 0x9f, 0x200b, 0x202e, 0xfeff]) {
    const email = 'apps' + String.fromCharCode(c) + '@contoso.example';
    assert.deepEqual(fields(validateManifest(withAuthor({ email }))), ['author.email'], c.toString(16));
  }
  assert.deepEqual(fields(validateManifest(withAuthor({ url: 'https://contoso.example./' }))), ['author.url']);
});

test('permissions must be known scopes, listed once', () => {
  assert.deepEqual(fields(validateManifest(bundleManifest({ permissions: ['user.read', 'files.write'] }))), ['permissions[1]']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ permissions: ['user.read', 'user.read'] }))), ['permissions[1]']);
  assert.deepEqual(fields(validateManifest(bundleManifest({ permissions: 'user.read' }))), ['permissions']);
});

test('connect lists origins for bundle apps only', () => {
  const bad = ['https://api.example.com/path', 'http://api.example.com', 'https://API.example.com', 'https://*.com',
    'https://localhost', 'https://api.example.com:0', 'https://api.example.com:70000', 'ftp://x.example.com', '*'];
  for (const c of bad) assert.equal(fields(validateManifest(bundleManifest({ connect: [c] })))[0], 'connect[0]', c);
  assert.deepEqual(fields(validateManifest(bundleManifest({ connect: ['https://a.example.com', 'https://a.example.com'] }))), ['connect[1]']);
  assert.deepEqual(fields(validateManifest(externalManifest({ connect: ['https://a.example.com'] }))), ['connect']);
  const many = Array.from({ length: 21 }, (_, i) => `https://h${i}.example.com`);
  assert.deepEqual(fields(validateManifest(bundleManifest({ connect: many }))), ['connect']);
});

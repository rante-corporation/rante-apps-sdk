'use strict';
// Repository-level checks: copies stay identical, the JSON Schema agrees with the CLI, the examples are valid.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SCOPES, FIELDS } = require('../packages/cli/lib/manifest');
const { packFolder, parseManifestBytes } = require('../packages/cli/lib/package');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p));

test('the bundle example ships the current SDK, byte for byte', () => {
  assert.equal(Buffer.compare(read('examples/hello-bundle/rante-sdk.js'), read('packages/sdk/rante-sdk.js')), 0,
    'copy packages/sdk/rante-sdk.js to examples/hello-bundle/rante-sdk.js');
});

test('package versions agree with the file headers', () => {
  const sdk = JSON.parse(read('packages/sdk/package.json'));
  const cli = JSON.parse(read('packages/cli/package.json'));
  assert.match(read('packages/sdk/rante-sdk.js').toString(), new RegExp(`Rante Apps SDK ${sdk.version.replace(/\./g, '\\.')} `));
  assert.match(read('packages/sdk/rante-sdk.js').toString(), new RegExp(`var VERSION = '${sdk.version}'`));
  assert.match(read('packages/sdk/rante-host.js').toString(), new RegExp(`var VERSION = '${sdk.version}'`));
  assert.equal(require('../packages/sdk/rante-sdk.js').version, sdk.version);
  assert.equal(require('../packages/cli/lib/cli').VERSION, cli.version);
});

test('the JSON Schema lists the same fields and permissions as the CLI', () => {
  const schema = JSON.parse(read('schema/manifest.schema.json'));
  assert.deepEqual(Object.keys(schema.properties).sort(), FIELDS.slice().sort());
  assert.deepEqual(schema.properties.permissions.items.enum.slice().sort(), Object.keys(SCOPES).sort());
  assert.equal(schema.additionalProperties, false);
});

test('every permission is documented', () => {
  const doc = read('docs/manifest.md').toString();
  for (const scope of Object.keys(SCOPES)) assert.ok(doc.includes('`' + scope + '`'), scope);
});

test('the examples are valid', () => {
  const packed = packFolder(path.join(root, 'examples', 'hello-bundle'));
  assert.deepEqual(packed.errors, []);
  assert.equal(packed.ok, true);
  const external = parseManifestBytes(read('examples/hello-external/manifest.json'));
  assert.deepEqual(external.errors, []);
});

test('the token conformance cases are well formed', () => {
  const doc = JSON.parse(read('conformance/tokens.json'));
  const codes = [null, 'missing_token', 'invalid_token', 'token_expired', 'tenant_not_allowed', 'insufficient_scope'];
  const names = new Set();
  for (const c of doc.cases) {
    assert.ok(codes.includes(c.expect), `${c.name}: expect ${JSON.stringify(c.expect)}`);
    assert.ok(!names.has(c.name), `duplicate case ${c.name}`);
    names.add(c.name);
    if (c.sign !== undefined) assert.ok(['key-1', 'other-key', 'es256', 'hs256-public-key', 'none'].includes(c.sign), c.name);
    for (const k of Object.keys(c)) assert.ok(['name', 'expect', 'principal', 'claims', 'header', 'sign', 'tamper', 'raw', 'options'].includes(k), `${c.name}: ${k}`);
  }
  const doc2 = read('docs/tokens.md').toString();
  for (const code of codes.filter(Boolean)) assert.ok(doc2.includes('`' + code + '`'), code);
});

test('text files are ASCII, without stray control characters', () => {
  const skip = new Set(['.git', 'node_modules']);
  const bad = [];
  (function walk(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.(js|json|md|ts|html|css|svg|yml)$/.test(d.name)) {
        const b = fs.readFileSync(p);
        for (let i = 0; i < b.length; i++) {
          if (b[i] >= 0x80 || (b[i] < 0x20 && b[i] !== 0x0a && b[i] !== 0x0d && b[i] !== 0x09)) {
            bad.push(`${path.relative(root, p)} byte ${i}`);
            break;
          }
        }
      }
    }
  })(root);
  assert.deepEqual(bad, []);
});

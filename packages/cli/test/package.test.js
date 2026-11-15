'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validatePackage, packFolder, unpackPackage, packageFileName, LIMITS } = require('../lib/package');
const { writeZip } = require('../lib/zip');
const { bundleManifest, externalManifest, tempDir, writeTree, sampleApp } = require('./helpers');

const INDEX = Buffer.from('<!doctype html><title>x</title>');
const ICON = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

function zipOf(extra, manifest) {
  return writeZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest || bundleManifest())) },
    { name: 'index.html', data: INDEX },
    { name: 'icon.svg', data: ICON }
  ].concat(extra || []));
}

function codes(result) {
  return result.errors.map((e) => e.code);
}

test('a valid package passes and lists its files with hashes and content types', () => {
  const result = validatePackage(zipOf([{ name: 'assets/app.js', data: Buffer.from('console.log(1)') }]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.manifest.name, 'Hello Rante');
  assert.deepEqual(result.files.map((f) => f.path), ['assets/app.js', 'icon.svg', 'index.html', 'manifest.json']);
  const js = result.files[0];
  assert.equal(js.contentType, 'text/javascript; charset=utf-8');
  assert.match(js.sha256, /^[0-9a-f]{64}$/);
  assert.match(result.packageSha256, /^[0-9a-f]{64}$/);
});

test('step 1: refuses files without the ZIP signature, and oversized packages', () => {
  assert.deepEqual(codes(validatePackage(Buffer.from('MZ not a zip at all'))), ['not_a_zip']);
  assert.deepEqual(codes(validatePackage(Buffer.from('Rar!\x1a\x07\x00'))), ['not_a_zip']);
  const zip = zipOf();
  assert.deepEqual(codes(validatePackage(zip, { limits: { maxPackageBytes: zip.length - 1 } })), ['package_too_large']);
  assert.equal(LIMITS.maxPackageBytes, 50 * 1024 * 1024);
});

test('step 2: needs a valid manifest.json at the root', () => {
  const noManifest = writeZip([{ name: 'index.html', data: INDEX }]);
  assert.deepEqual(codes(validatePackage(noManifest)), ['manifest_missing']);

  const nested = writeZip([{ name: 'dist/manifest.json', data: Buffer.from('{}') }, { name: 'dist/index.html', data: INDEX }]);
  const r = validatePackage(nested);
  assert.deepEqual(codes(r), ['manifest_missing']);
  assert.match(r.errors[0].message, /found "dist\/manifest.json"/);

  const badJson = writeZip([{ name: 'manifest.json', data: Buffer.from('{"id": ') }, { name: 'index.html', data: INDEX }]);
  assert.deepEqual(codes(validatePackage(badJson)), ['manifest_invalid_json']);

  const dup = writeZip([{ name: 'manifest.json', data: Buffer.from('{"name":"a","name":"b"}') }]);
  assert.deepEqual(codes(validatePackage(dup)), ['manifest_invalid_json']);

  assert.ok(codes(validatePackage(zipOf([], bundleManifest({ version: 'one' })))).includes('manifest_invalid'));
});

test('step 2: the entry point and icon must be in the package; external apps are not packages', () => {
  const noEntry = writeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(bundleManifest({ icon: undefined }))) }]);
  assert.deepEqual(codes(validatePackage(noEntry)), ['entry_point_missing']);
  const noIcon = writeZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(bundleManifest())) },
    { name: 'index.html', data: INDEX }
  ]);
  assert.deepEqual(codes(validatePackage(noIcon)), ['icon_missing']);
  const external = writeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(externalManifest())) }]);
  assert.deepEqual(codes(validatePackage(external)), ['manifest_invalid']);
});

test('step 2: refuses forbidden and unknown file types, and executable content', () => {
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'tools/setup.exe', data: Buffer.from('x') }]))), ['file_type_forbidden']);
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'api/index.php', data: Buffer.from('<?php') }]))), ['file_type_forbidden']);
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'deploy.sh', data: Buffer.from('rm -rf /') }]))), ['file_type_forbidden']);
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'web.config', data: Buffer.from('<configuration/>') }]))), ['file_type_forbidden']);
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'LICENSE', data: Buffer.from('MIT') }]))), ['file_type_unknown']);
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'data.sqlite', data: Buffer.from('x') }]))), ['file_type_unknown']);
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'bundle.js', data: Buffer.from('MZ\x90\x00 disguised') }]))), ['executable_content']);
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'run.js', data: Buffer.from('#!/bin/sh\necho hi') }]))), ['executable_content']);
});

test('step 3: refuses zip slip paths before anything is read', () => {
  const cases = {
    '../evil.js': 'path_traversal',
    'assets/../../evil.js': 'path_traversal',
    '/etc/cron.d/evil.js': 'path_traversal',
    'C:/Windows/evil.js': 'path_traversal',
    '..\\..\\evil.js': 'path_invalid',
    'a//b.js': 'path_invalid',
    '.env': 'hidden_file',
    '__MACOSX/._index.html': 'hidden_file'
  };
  for (const [name, code] of Object.entries(cases)) {
    assert.deepEqual(codes(validatePackage(zipOf([{ name, data: Buffer.from('x') }]))), [code], name);
  }
});

test('step 3: refuses duplicates, case-only duplicates and symbolic links', () => {
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'index.html', data: INDEX }]))), ['path_duplicate']);
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'Index.html', data: INDEX }]))), ['path_case_duplicate']);
  const link = { name: 'link.js', data: Buffer.from('/etc/passwd'), versionMadeBy: (3 << 8) | 20, externalAttributes: (0o120777 << 16) >>> 0 };
  assert.deepEqual(codes(validatePackage(zipOf([link]))), ['symlink']);
  const unixFile = { name: 'app.js', data: Buffer.from('1'), versionMadeBy: (3 << 8) | 20, externalAttributes: (0o100644 << 16) >>> 0 };
  assert.deepEqual(codes(validatePackage(zipOf([unixFile]))), []);
});

test('step 3: refuses zip bombs by ratio and by size', () => {
  const zeros = Buffer.alloc(2 * 1024 * 1024);
  assert.deepEqual(codes(validatePackage(zipOf([{ name: 'bomb.txt', data: zeros }]))), ['compression_ratio']);
  const small = zipOf([{ name: 'big.txt', data: Buffer.alloc(5000, 0x61) }]);
  assert.deepEqual(codes(validatePackage(small, { limits: { maxFileBytes: 4000 } })), ['file_too_large']);
  assert.deepEqual(codes(validatePackage(small, { limits: { maxTotalBytes: 4000 } })), ['total_too_large']);
});

test('folder entries are allowed and ignored', () => {
  const result = validatePackage(zipOf([{ name: 'assets/', data: Buffer.alloc(0) }, { name: 'assets/a.css', data: Buffer.from('a{}') }]));
  assert.equal(result.ok, true);
  assert.ok(!result.files.some((f) => f.path === 'assets'));
});

test('pack: writes a valid, byte-for-byte reproducible package', (t) => {
  const dir = sampleApp(tempDir(t));
  const first = packFolder(dir);
  assert.deepEqual(first.errors, []);
  assert.equal(first.ok, true);
  const second = packFolder(dir);
  assert.equal(Buffer.compare(first.buffer, second.buffer), 0);
  assert.equal(first.validation.ok, true);
  assert.equal(first.validation.files.length, 6);
  // manifest.json is the first entry
  assert.equal(first.buffer.toString('utf8', 30, 30 + 'manifest.json'.length), 'manifest.json');
  assert.equal(packageFileName(first.manifest), 'hello-rante-1.0.0.rante');
});

test('pack: skips hidden files, junk and .ranteignore entries; refuses unknown types', (t) => {
  const dir = sampleApp(tempDir(t));
  writeTree(dir, {
    '.env': 'SECRET=1',
    '.git/HEAD': 'ref: refs/heads/main',
    'Thumbs.db': 'x',
    'notes/draft.txt': 'skip me',
    'assets/app.js.map': '{}',
    '.ranteignore': '# local files\nnotes/\n*.map\n',
    'old.rante': 'PK'
  });
  const packed = packFolder(dir);
  assert.deepEqual(packed.errors, []);
  const paths = packed.validation.files.map((f) => f.path);
  assert.ok(!paths.some((p) => p.startsWith('.') || p.startsWith('notes/') || p.endsWith('.map') || p === 'Thumbs.db' || p === 'old.rante'));
  assert.ok(packed.warnings.some((w) => w.code === 'hidden_skipped'));

  writeTree(dir, { 'server/index.php': '<?php' });
  const refused = packFolder(dir);
  assert.equal(refused.ok, false);
  assert.deepEqual(codes(refused), ['file_type_forbidden']);
});

test('pack: refuses external apps, missing entry points and missing manifests', (t) => {
  const external = writeTree(tempDir(t), { 'manifest.json': JSON.stringify(externalManifest()) });
  assert.deepEqual(codes(packFolder(external)), ['manifest_invalid']);
  const noEntry = writeTree(tempDir(t), { 'manifest.json': JSON.stringify(bundleManifest({ icon: undefined })), 'app.js': '1' });
  assert.deepEqual(codes(packFolder(noEntry)), ['entry_point_missing']);
  assert.deepEqual(codes(packFolder(tempDir(t))), ['manifest_missing']);
});

test('pack: refuses symbolic links', (t) => {
  const dir = sampleApp(tempDir(t));
  try {
    fs.symlinkSync(path.join(dir, 'app.js'), path.join(dir, 'link.js'));
  } catch (err) {
    t.skip('this system does not allow creating symbolic links');
    return;
  }
  assert.deepEqual(codes(packFolder(dir)), ['symlink']);
});

test('unpack: writes every file of a valid package and nothing of an invalid one', (t) => {
  const dir = sampleApp(tempDir(t));
  const packed = packFolder(dir);
  const out = path.join(tempDir(t), 'out');
  const result = unpackPackage(packed.buffer, out);
  assert.equal(result.ok, true);
  assert.equal(result.written.length, 6);
  assert.equal(fs.readFileSync(path.join(out, 'assets', 'data.json'), 'utf8'), fs.readFileSync(path.join(dir, 'assets', 'data.json'), 'utf8'));

  const again = unpackPackage(packed.buffer, out);
  assert.deepEqual(codes(again), ['folder_not_empty']);

  const evil = zipOf([{ name: '../escaped.js', data: Buffer.from('x') }]);
  const target = path.join(tempDir(t), 'evil-out');
  const refused = unpackPackage(evil, target);
  assert.equal(refused.ok, false);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(path.join(path.dirname(target), 'escaped.js')), false);
});

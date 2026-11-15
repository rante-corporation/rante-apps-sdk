'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { main, parseArgs, VERSION } = require('../lib/cli');
const { APP_ID, externalManifest, tempDir, writeTree, sampleApp } = require('./helpers');

function run(args, cwd) {
  let stdout = '';
  let stderr = '';
  const code = main(args, { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, cwd });
  return { code, stdout, stderr };
}

test('parses options with values, booleans and repeats', () => {
  const spec = { values: ['out', 'permission'], booleans: ['force'] };
  assert.deepEqual(parseArgs(['dist', '--out', 'x.rante', '--force', '--permission=user.read', '--permission', 'tenant.read'], spec), {
    positional: ['dist'], flags: { out: 'x.rante', force: true, permission: ['user.read', 'tenant.read'] }
  });
  assert.throws(() => parseArgs(['--nope'], spec), /Unknown option --nope/);
  assert.throws(() => parseArgs(['--out'], spec), /needs a value/);
  assert.throws(() => parseArgs(['--force=yes'], spec), /takes no value/);
});

test('help, version and unknown commands', () => {
  assert.equal(run(['--version'], process.cwd()).stdout.trim(), VERSION);
  assert.match(run(['--help'], process.cwd()).stdout, /Commands:/);
  assert.match(run(['help', 'pack'], process.cwd()).stdout, /rante pack \[folder\]/);
  assert.equal(run([], process.cwd()).code, 2);
  const unknown = run(['deploy'], process.cwd());
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown command "deploy"/);
  assert.equal(run(['pack', '--bogus'], process.cwd()).code, 2);
});

test('init writes a valid manifest and refuses to overwrite it', (t) => {
  const dir = tempDir(t);
  const r = run(['init', 'app', '--id', APP_ID, '--name', 'My App', '--permission', 'user.read'], dir);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /keep it in a folder they copy, such as public\//);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'app', 'manifest.json'), 'utf8'));
  assert.equal(manifest.hosting, 'bundle');
  assert.equal(manifest.entryPoint, 'index.html');
  assert.deepEqual(manifest.permissions, ['user.read']);
  assert.match(manifest.$schema, /manifest\.schema\.json$/);
  assert.equal(run(['init', 'app', '--id', APP_ID, '--name', 'My App'], dir).code, 1);
  assert.equal(run(['init', 'app', '--id', APP_ID, '--name', 'My App', '--force'], dir).code, 0);
  assert.equal(run(['init', 'x', '--id', 'nope', '--name', 'My App'], dir).code, 1);
  assert.equal(run(['init', 'x', '--name', 'My App'], dir).code, 2);
  assert.equal(run(['init', 'ext', '--id', APP_ID, '--name', 'Ext', '--hosting', 'external'], dir).code, 2);
  assert.equal(run(['init', 'ext', '--id', APP_ID, '--name', 'Ext', '--hosting', 'external', '--entry', 'https://app.example.com/'], dir).code, 0);
});

test('pack, validate, inspect and unpack a sample app', (t) => {
  const work = tempDir(t);
  sampleApp(path.join(work, 'dist'));

  const packed = run(['pack', 'dist'], work);
  assert.equal(packed.code, 0, packed.stderr);
  assert.match(packed.stdout, /Packed .*hello-rante-1\.0\.0\.rante/);
  assert.match(packed.stdout, /sha256 {4}[0-9a-f]{64}/);
  const file = path.join(work, 'hello-rante-1.0.0.rante');
  assert.ok(fs.existsSync(file));

  assert.equal(run(['pack', 'dist'], work).code, 1, 'refuses to overwrite');
  assert.equal(run(['pack', 'dist', '--force'], work).code, 0);

  const validated = run(['validate', 'hello-rante-1.0.0.rante'], work);
  assert.equal(validated.code, 0, validated.stderr);
  assert.match(validated.stdout, /OK: .* is a valid \.rante package \(Hello Rante 1\.0\.0, bundle\)/);

  const json = JSON.parse(run(['validate', 'hello-rante-1.0.0.rante', '--json'], work).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.kind, 'package');
  assert.equal(json.files.length, 6);

  assert.equal(run(['validate', 'dist'], work).code, 0);
  const inspected = run(['inspect', 'hello-rante-1.0.0.rante'], work);
  assert.equal(inspected.code, 0);
  assert.match(inspected.stdout, /entry point {2}index\.html/);

  const unpacked = run(['unpack', 'hello-rante-1.0.0.rante', '--out', 'copy'], work);
  assert.equal(unpacked.code, 0, unpacked.stderr);
  assert.ok(fs.existsSync(path.join(work, 'copy', 'assets', 'data.json')));
});

test('validate reports problems with exit code 1', (t) => {
  const work = tempDir(t);
  fs.writeFileSync(path.join(work, 'not-a-package.rante'), 'hello');
  const r = run(['validate', 'not-a-package.rante'], work);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not_a_zip/);

  writeTree(work, { 'ext/manifest.json': JSON.stringify(externalManifest()) });
  assert.equal(run(['validate', 'ext/manifest.json'], work).code, 0);
  assert.equal(run(['validate', 'ext'], work).code, 0);
  writeTree(work, { 'bad/manifest.json': JSON.stringify(externalManifest({ entryPoint: 'http://insecure.example.com' })) });
  assert.equal(run(['validate', 'bad/manifest.json'], work).code, 1);
  assert.equal(run(['validate', 'missing.rante'], work).code, 2);
});

test('the bin script runs under node', (t) => {
  const bin = path.join(__dirname, '..', 'bin', 'rante.js');
  const r = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), VERSION);
});

'use strict';
// Shared test helpers: temporary folders and sample manifests.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_ID = '3f2b8c1e-7d4a-4e9b-a6c5-1d2e3f4a5b6c';

function bundleManifest(overrides) {
  return Object.assign({
    manifestVersion: 1,
    id: APP_ID,
    name: 'Hello Rante',
    version: '1.0.0',
    hosting: 'bundle',
    entryPoint: 'index.html',
    icon: 'icon.svg',
    permissions: ['user.read', 'tenant.read']
  }, overrides);
}

function externalManifest(overrides) {
  return Object.assign({
    manifestVersion: 1,
    id: APP_ID,
    name: 'Contoso CRM',
    version: '2.3.0',
    hosting: 'external',
    entryPoint: 'https://crm.contoso.example/rante',
    icon: 'https://crm.contoso.example/icon-128.png',
    permissions: ['user.read', 'tenant.read', 'auth.token']
  }, overrides);
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rante-cli-test-'));
  if (t && typeof t.after === 'function') t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes files into a folder. Values are strings or Buffers; keys use "/". */
function writeTree(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

function sampleApp(root, manifestOverrides) {
  return writeTree(root, {
    'manifest.json': JSON.stringify(bundleManifest(manifestOverrides), null, 2),
    'index.html': '<!doctype html><html><head><script src="app.js"></script></head><body>Hello</body></html>\n',
    'app.js': 'console.log("hello from a Rante app");\n'.repeat(20),
    'styles.css': 'body { font-family: system-ui; }\n',
    'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>\n',
    'assets/data.json': JSON.stringify({ items: [1, 2, 3] })
  });
}

module.exports = { APP_ID, bundleManifest, externalManifest, tempDir, writeTree, sampleApp };

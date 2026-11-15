'use strict';
// Programmatic API of @rante/cli: the same checks the command line runs.

const pkg = require('./lib/package');
const { validateManifest, SCOPES, MANIFEST_VERSION } = require('./lib/manifest');
const { checkPath } = require('./lib/paths');
const { checkFileType, CONTENT_TYPES } = require('./lib/mime');
const { parseJsonStrict } = require('./lib/json');
const { readZip, readEntryData, writeZip, ZipError } = require('./lib/zip');

module.exports = {
  LIMITS: pkg.LIMITS,
  SCOPES,
  MANIFEST_VERSION,
  CONTENT_TYPES,
  validatePackage: pkg.validatePackage,
  packFolder: pkg.packFolder,
  unpackPackage: pkg.unpackPackage,
  packageFileName: pkg.packageFileName,
  validateManifest,
  parseManifest: pkg.parseManifestBytes,
  checkPath,
  checkFileType,
  parseJsonStrict,
  zip: { readZip, readEntryData, writeZip, ZipError }
};

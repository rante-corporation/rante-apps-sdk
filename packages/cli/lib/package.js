'use strict';
// .rante packages: validate, pack and unpack.
//
// A .rante file is a plain ZIP archive with manifest.json at its root and the app's static files next to it.
// validatePackage() applies the checks Rante's servers apply to an upload, in the same order:
//   1. the ZIP signature (50 4B 03 04) and the size limit (50 MiB);
//   2. manifest.json, read and validated in memory, the entry point and icon present, no forbidden file types;
//   3. every path relative and inside the package (no zip slip), no duplicates, no links, no zip bombs;
//   4. (servers only) the files are written to storage under apps/{id}/{version}/; unpackPackage() does the same
//      to a local folder, with the same path checks.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readZip, readEntryData, writeZip, ZipError } = require('./zip');
const { parseJsonStrict } = require('./json');
const { validateManifest } = require('./manifest');
const { checkFileType, sniffExecutable } = require('./mime');
const { checkPath } = require('./paths');
const { compileIgnore } = require('./ignore');

const MiB = 1024 * 1024;

/** Limits applied to every package. Rante's servers use the same values. */
const LIMITS = Object.freeze({
  maxPackageBytes: 50 * MiB,
  maxEntries: 5000,
  maxFileBytes: 50 * MiB,
  maxTotalBytes: 200 * MiB,
  maxManifestBytes: 64 * 1024,
  ratioCheckBytes: 1 * MiB,
  maxCompressionRatio: 200
});

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MANIFEST_NAME = 'manifest.json';
const UNIX_HOST = 3;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const OS_JUNK = new Set(['thumbs.db', 'desktop.ini', 'ehthumbs.db']);

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function issue(code, message, file) {
  const result = { code, message };
  if (file !== undefined) result.path = file;
  return result;
}

const utf8Fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Parses manifest.json bytes.
 * @returns {{manifest?: object, errors: object[], warnings: object[]}}
 */
function parseManifestBytes(bytes) {
  const errors = [];
  const warnings = [];
  let text;
  try {
    text = utf8Fatal.decode(bytes);
  } catch (err) {
    errors.push(issue('manifest_invalid_json', 'manifest.json is not valid UTF-8.', MANIFEST_NAME));
    return { errors, warnings };
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    warnings.push(issue('manifest_bom', 'manifest.json starts with a byte order mark; save it as UTF-8 without BOM.', MANIFEST_NAME));
  }
  let manifest;
  try {
    manifest = parseJsonStrict(text);
  } catch (err) {
    errors.push(issue('manifest_invalid_json', `manifest.json is not valid JSON: ${err.message}.`, MANIFEST_NAME));
    return { errors, warnings };
  }
  for (const e of validateManifest(manifest)) errors.push(Object.assign({ path: MANIFEST_NAME }, e));
  return { manifest, errors, warnings };
}

function isSymlinkEntry(entry) {
  if ((entry.versionMadeBy >> 8) !== UNIX_HOST) return false;
  return ((entry.externalAttributes >>> 16) & S_IFMT) === S_IFLNK;
}

function unixFileType(entry) {
  if ((entry.versionMadeBy >> 8) !== UNIX_HOST) return 0;
  return (entry.externalAttributes >>> 16) & S_IFMT;
}

/**
 * Validates a .rante package held in memory.
 * @param {Buffer} buffer the package
 * @param {{limits?: Partial<typeof LIMITS>}} [options]
 * @returns {{ok: boolean, errors: object[], warnings: object[], manifest: object|null, files: object[],
 *   packageSha256: string, packageBytes: number, totalBytes: number}}
 */
function validatePackage(buffer, options) {
  const limits = Object.assign({}, LIMITS, options && options.limits);
  const errors = [];
  const warnings = [];
  const result = {
    ok: false, errors, warnings, manifest: null, files: [], packageSha256: '', packageBytes: 0, totalBytes: 0
  };
  if (!Buffer.isBuffer(buffer)) throw new TypeError('validatePackage expects a Buffer.');
  result.packageBytes = buffer.length;
  result.packageSha256 = sha256(buffer);

  // Step 1: signature and size.
  if (buffer.length > limits.maxPackageBytes) {
    errors.push(issue('package_too_large', `The package is ${buffer.length} bytes; the limit is ${limits.maxPackageBytes} (50 MiB).`));
    return result;
  }
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) {
    errors.push(issue('not_a_zip', 'The file does not start with the ZIP signature 50 4B 03 04, so it is not a .rante package.'));
    return result;
  }

  let zip;
  try {
    zip = readZip(buffer, { maxEntries: limits.maxEntries });
  } catch (err) {
    if (err instanceof ZipError) {
      errors.push(issue(err.code, err.message, err.path));
      return result;
    }
    throw err;
  }

  // Step 3 (paths) runs before step 2 needs the files: every entry is checked from the central directory alone.
  const files = [];
  const exact = new Set();
  const folded = new Map();
  let declaredTotal = 0;
  let totalReported = false;
  for (const entry of zip.entries) {
    const check = checkPath(entry.name);
    if (!check.ok) {
      errors.push(issue(check.code, check.message, entry.name));
      continue;
    }
    if (isSymlinkEntry(entry)) {
      errors.push(issue('symlink', `"${check.path}" is a symbolic link. Links are not allowed in a package.`, check.path));
      continue;
    }
    const type = unixFileType(entry);
    if (check.isDirectory) {
      if (entry.uncompressedSize !== 0) errors.push(issue('zip_invalid', `The folder entry "${entry.name}" has data.`, check.path));
      if (type !== 0 && type !== S_IFDIR) errors.push(issue('zip_invalid', `"${entry.name}" is not a regular folder.`, check.path));
      continue;
    }
    if (type !== 0 && type !== S_IFREG) {
      errors.push(issue('zip_invalid', `"${check.path}" is not a regular file.`, check.path));
      continue;
    }
    if (exact.has(check.path)) {
      errors.push(issue('path_duplicate', `"${check.path}" appears twice in the archive.`, check.path));
      continue;
    }
    exact.add(check.path);
    const lower = check.path.toLowerCase();
    if (folded.has(lower)) {
      errors.push(issue('path_case_duplicate',
        `"${check.path}" and "${folded.get(lower)}" differ only in upper and lower case.`, check.path));
      continue;
    }
    folded.set(lower, check.path);

    const fileType = checkFileType(check.path);
    if (!fileType.ok) {
      errors.push(issue(fileType.code, fileType.message, check.path));
      continue;
    }
    if (entry.uncompressedSize > limits.maxFileBytes) {
      errors.push(issue('file_too_large', `"${check.path}" is ${entry.uncompressedSize} bytes; the limit per file is ${limits.maxFileBytes}.`, check.path));
      continue;
    }
    if (entry.uncompressedSize >= limits.ratioCheckBytes &&
        entry.uncompressedSize > entry.compressedSize * limits.maxCompressionRatio) {
      errors.push(issue('compression_ratio',
        `"${check.path}" expands more than ${limits.maxCompressionRatio} times (${entry.compressedSize} to ${entry.uncompressedSize} bytes).`, check.path));
      continue;
    }
    declaredTotal += entry.uncompressedSize;
    if (declaredTotal > limits.maxTotalBytes && !totalReported) {
      errors.push(issue('total_too_large', `The files add up to more than ${limits.maxTotalBytes} bytes when unpacked.`));
      totalReported = true;
    }
    files.push({ entry, path: check.path, contentType: fileType.contentType });
  }

  // Step 2: manifest.json at the root.
  const manifestFile = files.find((f) => f.path === MANIFEST_NAME);
  if (!manifestFile) {
    const nested = zip.entries.map((e) => e.name).find((n) => n.endsWith('/' + MANIFEST_NAME));
    errors.push(issue('manifest_missing', nested
      ? `manifest.json must be at the root of the package; found "${nested}". Pack the folder that contains manifest.json.`
      : 'The package has no manifest.json at its root.'));
  } else if (manifestFile.entry.uncompressedSize > limits.maxManifestBytes) {
    errors.push(issue('manifest_too_large', `manifest.json is larger than ${limits.maxManifestBytes} bytes.`, MANIFEST_NAME));
  } else {
    try {
      const parsed = parseManifestBytes(readEntryData(buffer, manifestFile.entry));
      errors.push(...parsed.errors);
      warnings.push(...parsed.warnings);
      if (parsed.manifest !== undefined) result.manifest = parsed.manifest;
    } catch (err) {
      if (!(err instanceof ZipError)) throw err;
      errors.push(issue(err.code, err.message, MANIFEST_NAME));
    }
  }

  // Read every file only when the archive passed the checks above, so a hostile archive is never inflated.
  if (errors.length === 0) {
    for (const f of files) {
      let data;
      try {
        data = readEntryData(buffer, f.entry);
      } catch (err) {
        if (!(err instanceof ZipError)) throw err;
        errors.push(issue(err.code, err.message, f.path));
        continue;
      }
      const executable = sniffExecutable(data);
      if (executable) {
        errors.push(issue('executable_content', `"${f.path}" contains ${executable}.`, f.path));
        continue;
      }
      result.files.push({
        path: f.path,
        size: data.length,
        compressedSize: f.entry.compressedSize,
        method: f.entry.method === 8 ? 'deflate' : 'stored',
        contentType: f.contentType,
        sha256: sha256(data)
      });
      result.totalBytes += data.length;
    }
  }

  // The manifest must describe this package.
  const manifest = result.manifest;
  if (manifest && errors.length === 0) {
    if (manifest.hosting !== 'bundle') {
      errors.push(issue('manifest_invalid',
        'A .rante package holds a bundle app ("hosting": "bundle"). External apps are registered with their manifest.json alone.',
        MANIFEST_NAME));
    } else {
      if (!exact.has(manifest.entryPoint)) {
        errors.push(issue('entry_point_missing', `The entry point "${manifest.entryPoint}" is not in the package.`, MANIFEST_NAME));
      }
      if (typeof manifest.icon === 'string' && !exact.has(manifest.icon)) {
        errors.push(issue('icon_missing', `The icon "${manifest.icon}" is not in the package.`, MANIFEST_NAME));
      }
    }
  }

  result.files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  result.ok = errors.length === 0;
  if (!result.ok) result.files = [];
  return result;
}

// ------------------------------------------------------------------------------------------------ pack

function readIgnoreFile(root) {
  const file = path.join(root, '.ranteignore');
  try {
    return compileIgnore(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return () => false;
    throw err;
  }
}

/**
 * Lists the files a folder would put in a package, relative to the folder, with "/" separators.
 * Hidden files and folders are skipped with a warning; links and special files are errors.
 */
function collectFolder(root, options) {
  const errors = [];
  const warnings = [];
  const files = [];
  const isIgnored = readIgnoreFile(root);
  const outputPath = options && options.outputPath ? path.resolve(options.outputPath) : null;

  function walk(absoluteDir, relativeDir) {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of entries) {
      const relative = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
      const absolute = path.join(absoluteDir, dirent.name);
      const isDirectory = dirent.isDirectory();
      if (relative === '.ranteignore') continue;
      if (dirent.name[0] === '.' && !(relativeDir === '' && dirent.name === '.well-known' && isDirectory)) {
        warnings.push(issue('hidden_skipped', `Skipped hidden ${isDirectory ? 'folder' : 'file'} "${relative}".`, relative));
        continue;
      }
      if (dirent.name === '__MACOSX' || OS_JUNK.has(dirent.name.toLowerCase())) {
        warnings.push(issue('junk_skipped', `Skipped "${relative}".`, relative));
        continue;
      }
      if (isIgnored(relative, isDirectory)) continue;
      if (dirent.isSymbolicLink()) {
        errors.push(issue('symlink', `"${relative}" is a symbolic link. Copy the real file into the folder instead.`, relative));
        continue;
      }
      if (isDirectory) {
        walk(absolute, relative);
        continue;
      }
      if (!dirent.isFile()) {
        errors.push(issue('zip_invalid', `"${relative}" is not a regular file.`, relative));
        continue;
      }
      if (outputPath && path.resolve(absolute) === outputPath) continue;
      if (/\.rante$/i.test(dirent.name)) {
        warnings.push(issue('package_skipped', `Skipped the package file "${relative}".`, relative));
        continue;
      }
      files.push({ relative, absolute });
    }
  }

  walk(root, '');
  return { files, errors, warnings };
}

/** The default package file name: {name}-{version}.rante, with the name made file-name safe. */
function packageFileName(manifest) {
  const slug = String(manifest.name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'app';
  return `${slug}-${manifest.version}.rante`;
}

/**
 * Packs a folder into a .rante package (in memory). The folder must contain manifest.json.
 * @param {string} folder
 * @param {{outputPath?: string, limits?: Partial<typeof LIMITS>}} [options]
 * @returns {{ok: boolean, errors: object[], warnings: object[], buffer?: Buffer, manifest?: object, validation?: object}}
 */
function packFolder(folder, options) {
  const limits = Object.assign({}, LIMITS, options && options.limits);
  const root = path.resolve(folder);
  const errors = [];
  const warnings = [];

  let stat;
  try {
    stat = fs.statSync(root);
  } catch (err) {
    return { ok: false, errors: [issue('folder_missing', `The folder "${folder}" does not exist.`)], warnings };
  }
  if (!stat.isDirectory()) return { ok: false, errors: [issue('folder_missing', `"${folder}" is not a folder.`)], warnings };

  let manifestBytes;
  try {
    manifestBytes = fs.readFileSync(path.join(root, MANIFEST_NAME));
  } catch (err) {
    return { ok: false, errors: [issue('manifest_missing', `There is no manifest.json in "${folder}". Run "rante init" to create one.`)], warnings };
  }
  if (manifestBytes.length > limits.maxManifestBytes) {
    return { ok: false, errors: [issue('manifest_too_large', `manifest.json is larger than ${limits.maxManifestBytes} bytes.`, MANIFEST_NAME)], warnings };
  }
  const parsed = parseManifestBytes(manifestBytes);
  errors.push(...parsed.errors);
  warnings.push(...parsed.warnings);
  const manifest = parsed.manifest;
  if (manifest && manifest.hosting === 'external') {
    errors.push(issue('manifest_invalid',
      'This is an external app ("hosting": "external"): there is nothing to pack. Register its manifest.json in the ' +
      'Developers portal; check it with "rante validate manifest.json".', MANIFEST_NAME));
  }

  const collected = collectFolder(root, options);
  errors.push(...collected.errors);
  warnings.push(...collected.warnings);

  const names = new Set();
  const folded = new Map();
  let total = 0;
  for (const f of collected.files) {
    const check = checkPath(f.relative);
    if (!check.ok) {
      errors.push(issue(check.code, check.message, f.relative));
      continue;
    }
    const lower = f.relative.toLowerCase();
    if (folded.has(lower)) {
      errors.push(issue('path_case_duplicate', `"${f.relative}" and "${folded.get(lower)}" differ only in upper and lower case.`, f.relative));
      continue;
    }
    folded.set(lower, f.relative);
    const type = checkFileType(f.relative);
    if (!type.ok) {
      errors.push(issue(type.code, type.message + ' Remove it, or list it in .ranteignore.', f.relative));
      continue;
    }
    const size = fs.statSync(f.absolute).size;
    if (size > limits.maxFileBytes) {
      errors.push(issue('file_too_large', `"${f.relative}" is ${size} bytes; the limit per file is ${limits.maxFileBytes}.`, f.relative));
      continue;
    }
    total += size;
    names.add(f.relative);
  }
  if (total > limits.maxTotalBytes) errors.push(issue('total_too_large', `The files add up to ${total} bytes; the limit is ${limits.maxTotalBytes}.`));
  if (collected.files.length > limits.maxEntries) {
    errors.push(issue('too_many_entries', `The folder has ${collected.files.length} files; the limit is ${limits.maxEntries}.`));
  }
  if (manifest && manifest.hosting === 'bundle' && parsed.errors.length === 0) {
    if (!names.has(manifest.entryPoint)) errors.push(issue('entry_point_missing', `The entry point "${manifest.entryPoint}" is not in the folder.`, MANIFEST_NAME));
    if (typeof manifest.icon === 'string' && !names.has(manifest.icon)) errors.push(issue('icon_missing', `The icon "${manifest.icon}" is not in the folder.`, MANIFEST_NAME));
  }
  if (errors.length > 0) return { ok: false, errors, warnings, manifest };

  // manifest.json first, then every other file in byte order of its path.
  const ordered = Array.from(names).filter((n) => n !== MANIFEST_NAME)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const entries = [{ name: MANIFEST_NAME, data: manifestBytes }];
  for (const name of ordered) {
    const data = fs.readFileSync(path.join(root, ...name.split('/')));
    const executable = sniffExecutable(data);
    if (executable) {
      errors.push(issue('executable_content', `"${name}" contains ${executable}.`, name));
      continue;
    }
    entries.push({ name, data });
  }
  if (errors.length > 0) return { ok: false, errors, warnings, manifest };

  const buffer = writeZip(entries);
  // The package must pass the same validation Rante's servers run.
  const validation = validatePackage(buffer, { limits });
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings, manifest };
  return { ok: true, errors, warnings: warnings.concat(validation.warnings), buffer, manifest, validation };
}

// ------------------------------------------------------------------------------------------------ unpack

/**
 * Validates a package, then writes its files into a new or empty folder. Nothing is written unless the whole
 * package is valid, and every file's final path is checked to be inside the folder.
 * @returns {{ok: boolean, errors: object[], warnings: object[], written: string[], validation: object}}
 */
function unpackPackage(buffer, folder, options) {
  const validation = validatePackage(buffer, options);
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings, written: [], validation };

  const root = path.resolve(folder);
  if (fs.existsSync(root)) {
    if (!fs.statSync(root).isDirectory() || fs.readdirSync(root).length > 0) {
      return { ok: false, errors: [issue('folder_not_empty', `"${folder}" exists and is not an empty folder.`)], warnings: [], written: [], validation };
    }
  } else {
    fs.mkdirSync(root, { recursive: true });
  }
  const realRoot = fs.realpathSync(root);

  const zip = readZip(buffer, { maxEntries: (options && options.limits && options.limits.maxEntries) || LIMITS.maxEntries });
  const byPath = new Map();
  for (const entry of zip.entries) {
    const check = checkPath(entry.name);
    if (check.ok && !check.isDirectory) byPath.set(check.path, entry);
  }

  const written = [];
  for (const file of validation.files) {
    const target = path.resolve(realRoot, ...file.path.split('/'));
    if (!target.startsWith(realRoot + path.sep)) {
      throw new Error(`Refusing to write outside the folder: ${file.path}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const parentReal = fs.realpathSync(path.dirname(target));
    if (parentReal !== realRoot && !parentReal.startsWith(realRoot + path.sep)) {
      throw new Error(`Refusing to write outside the folder: ${file.path}`);
    }
    const data = readEntryData(buffer, byPath.get(file.path));
    if (sha256(data) !== file.sha256) throw new Error(`The content of ${file.path} changed while unpacking.`);
    fs.writeFileSync(target, data, { flag: 'wx' });
    written.push(file.path);
  }
  return { ok: true, errors: [], warnings: validation.warnings, written, validation };
}

module.exports = {
  LIMITS,
  MANIFEST_NAME,
  validatePackage,
  packFolder,
  unpackPackage,
  packageFileName,
  parseManifestBytes,
  collectFolder,
  sha256
};

'use strict';
// Path rules for files inside a .rante package. Every path is relative, uses "/" and stays inside the package
// (this is what stops "zip slip": ../../evil.js, /etc/passwd, C:\Windows\...). Names use a conservative character set
// so they are the same on every file system and need no URL escaping when Rante serves them.

const SAFE_SEGMENT = /^[A-Za-z0-9._~@+=,()!-]+$/;
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
const MAX_PATH_BYTES = 512;
const MAX_SEGMENT_BYTES = 255;
const MAX_DEPTH = 32;
const ALLOWED_CHARACTERS = 'A-Z a-z 0-9 . _ ~ @ + = , ( ) ! -';

function problem(code, message) {
  return { ok: false, code, message };
}

/**
 * Checks one archive path.
 * @param {string} name the entry name as stored in the archive
 * @returns {{ok: true, path: string, isDirectory: boolean} | {ok: false, code: string, message: string}}
 */
function checkPath(name) {
  if (typeof name !== 'string' || name.length === 0) return problem('path_invalid', 'An entry has an empty name.');
  if (name.indexOf('\\') >= 0) {
    return problem('path_invalid', `"${name}" contains a backslash. Paths inside a package use forward slashes.`);
  }
  if (name[0] === '/') return problem('path_traversal', `"${name}" is an absolute path. Paths must be relative.`);
  if (/^[A-Za-z]:/.test(name)) return problem('path_traversal', `"${name}" starts with a drive letter. Paths must be relative.`);

  let path = name;
  const isDirectory = path.endsWith('/');
  if (isDirectory) path = path.slice(0, -1);
  if (path.length === 0) return problem('path_invalid', 'An entry is named "/".');
  if (Buffer.byteLength(path, 'utf8') > MAX_PATH_BYTES) {
    return problem('path_invalid', `"${path.slice(0, 60)}..." is longer than ${MAX_PATH_BYTES} bytes.`);
  }

  const segments = path.split('/');
  if (segments.length > MAX_DEPTH) return problem('path_invalid', `"${path}" is more than ${MAX_DEPTH} folders deep.`);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === '') return problem('path_invalid', `"${path}" has an empty folder name ("//").`);
    if (segment === '.' || segment === '..') {
      return problem('path_traversal', `"${path}" contains "${segment}". Paths must stay inside the package.`);
    }
    if (segment === '__MACOSX') {
      return problem('hidden_file', `"${path}" is macOS archive metadata. Remove the __MACOSX folder.`);
    }
    if (segment[0] === '.' && !(i === 0 && segment === '.well-known')) {
      return problem('hidden_file', `"${path}" is a hidden file or folder (its name starts with "."). Hidden files are not allowed.`);
    }
    if (Buffer.byteLength(segment, 'utf8') > MAX_SEGMENT_BYTES) {
      return problem('path_invalid', `A name in "${path}" is longer than ${MAX_SEGMENT_BYTES} bytes.`);
    }
    if (!SAFE_SEGMENT.test(segment)) {
      return problem('path_invalid', `"${path}" uses characters outside ${ALLOWED_CHARACTERS}.`);
    }
    if (segment.endsWith('.')) return problem('path_invalid', `"${path}" has a name that ends with a dot.`);
    if (RESERVED_DEVICE.test(segment)) return problem('path_invalid', `"${path}" uses a reserved device name (${segment}).`);
  }

  return { ok: true, path, isDirectory };
}

module.exports = { checkPath, ALLOWED_CHARACTERS, MAX_PATH_BYTES, MAX_DEPTH };

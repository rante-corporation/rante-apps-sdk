'use strict';
// The file types a .rante package may contain, and the Content-Type Rante serves each one with
// (always together with X-Content-Type-Options: nosniff). Anything else is refused: server-side code, executables
// and installers never belong in a static web app.

const CONTENT_TYPES = Object.freeze({
  // Pages, code and data
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  wasm: 'application/wasm',
  pdf: 'application/pdf',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  // Fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  // Audio and video
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  // 3D models
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json'
});

// Named explicitly so the error says why, not just "unknown type".
const FORBIDDEN = new Set([
  'exe', 'dll', 'com', 'bat', 'cmd', 'msi', 'msp', 'msix', 'appx', 'scr', 'pif', 'cpl', 'sys', 'drv', 'ocx',
  'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'lnk', 'reg', 'ps1', 'psm1', 'psd1',
  'sh', 'bash', 'zsh', 'ksh', 'csh', 'fish', 'command', 'run', 'out',
  'php', 'phtml', 'php3', 'php4', 'php5', 'php7', 'phar',
  'asp', 'aspx', 'ashx', 'asmx', 'axd', 'cshtml', 'vbhtml', 'jsp', 'jspx', 'cfm', 'cgi', 'fcgi',
  'pl', 'pm', 'py', 'pyc', 'pyo', 'rb', 'lua', 'tcl',
  'jar', 'war', 'ear', 'class', 'so', 'dylib', 'ko', 'bin', 'elf', 'o', 'a', 'lib',
  'app', 'apk', 'aab', 'ipa', 'dmg', 'pkg', 'deb', 'rpm', 'snap', 'iso', 'img', 'vhd', 'vhdx',
  'htaccess', 'htpasswd', 'config', 'ini', 'env', 'conf',
  'swf', 'xap', 'xbap'
]);

function extensionOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * @returns {{ok: true, extension: string, contentType: string} | {ok: false, code: string, message: string}}
 */
function checkFileType(path) {
  const extension = extensionOf(path);
  if (extension && Object.prototype.hasOwnProperty.call(CONTENT_TYPES, extension)) {
    return { ok: true, extension, contentType: CONTENT_TYPES[extension] };
  }
  if (FORBIDDEN.has(extension)) {
    return {
      ok: false,
      code: 'file_type_forbidden',
      message: `"${path}" is a .${extension} file. Executables, scripts for servers or shells, and server configuration ` +
        'are not allowed in a package.'
    };
  }
  return {
    ok: false,
    code: 'file_type_unknown',
    message: extension
      ? `"${path}" has a file type (.${extension}) that packages may not contain. See docs/package-format.md for the list.`
      : `"${path}" has no file extension. Every file needs one of the allowed extensions.`
  };
}

/**
 * Executable and script signatures. A web bundle never contains these, whatever the file is called.
 * @returns {string | null} a description when the content looks executable
 */
function sniffExecutable(data) {
  if (data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a) return 'a Windows executable (MZ header)';
  if (data.length >= 4 && data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) {
    return 'a Linux executable (ELF header)';
  }
  if (data.length >= 4) {
    const magic = data.readUInt32BE(0);
    if (magic === 0xfeedface || magic === 0xfeedfacf || magic === 0xcefaedfe || magic === 0xcffaedfe) {
      return 'a macOS executable (Mach-O header)';
    }
    if (magic === 0xcafebabe) return 'a Mach-O universal binary or Java class file';
  }
  if (data.length >= 2 && data[0] === 0x23 && data[1] === 0x21) return 'a script with an interpreter line (#!)';
  return null;
}

module.exports = { CONTENT_TYPES, FORBIDDEN, extensionOf, checkFileType, sniffExecutable };

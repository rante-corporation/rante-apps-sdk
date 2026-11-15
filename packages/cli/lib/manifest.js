'use strict';
// manifest.json validation. Every Rante app has one: inside the .rante package for bundle apps, or registered on its
// own in the Developers portal for external (developer-hosted) apps. Rante's servers apply the same rules.
// The JSON Schema in schema/manifest.schema.json describes the same format for editors.

const { checkPath } = require('./paths');
const { extensionOf } = require('./mime');

const MANIFEST_VERSION = 1;

/** The permission scopes an app can request. The tenant's admin approves them when installing the app. */
const SCOPES = Object.freeze({
  'user.read': "Read the signed-in person's ID and display name",
  'user.email': "Read the signed-in person's email address",
  'tenant.read': "Read the active tenant's ID and name",
  'auth.token': "Get access tokens for the app's own API, issued by login.rante.com",
  notifications: 'Show notifications in Rante',
  navigation: 'Open Rante pages, and external links in a new tab',
  'clipboard.write': 'Write to the clipboard'
});

const FIELDS = ['$schema', 'manifestVersion', 'id', 'name', 'version', 'description', 'author', 'icon', 'hosting',
  'entryPoint', 'permissions', 'connect'];
const AUTHOR_FIELDS = ['name', 'email', 'url'];

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMPTY_GUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;
const IDENT = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(
  `^(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})(?:-(${IDENT}(?:\\.${IDENT})*))?$`);
const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;
// Control characters, and the invisible formatting characters that can make text read differently than it is
// (bidirectional overrides and isolates, zero-width characters, the byte order mark).
function hasControl(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}
function hasInvisible(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2064) ||
        (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) return true;
  }
  return false;
}
const CONNECT_SOURCE = /^(https|wss):\/\/(\*\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)(?::(\d{1,5}))?$/;
const ICON_EXTENSIONS = ['png', 'svg', 'jpg', 'jpeg', 'webp'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function textProblem(value, label, max, options) {
  if (typeof value !== 'string') return `${label} must be a string.`;
  if (options.required && value.trim().length === 0) return `${label} must not be empty.`;
  if (value.length > max) return `${label} is ${value.length} characters long; the limit is ${max}.`;
  const control = options.allowNewlines ? value.replace(/\n/g, '') : value;
  if (hasControl(control)) return `${label} contains control characters.`;
  if (hasInvisible(value)) return `${label} contains invisible formatting characters (for example bidirectional overrides).`;
  if (options.trimmed && value !== value.trim()) return `${label} has spaces at the start or end.`;
  return null;
}

function isIpLiteral(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[');
}

/**
 * Checks an https URL. Returns a message when it is not acceptable.
 * @param {{allowLocal?: boolean}} [options]
 */
function httpsUrlProblem(value, label, options) {
  if (typeof value !== 'string') return `${label} must be a string.`;
  if (value.length > 2048) return `${label} is longer than 2048 characters.`;
  if (/\s/.test(value) || hasControl(value)) return `${label} contains spaces or control characters.`;
  let url;
  try {
    url = new URL(value);
  } catch (err) {
    return `${label} is not a valid URL.`;
  }
  if (url.protocol !== 'https:') return `${label} must start with https://.`;
  if (url.username || url.password) return `${label} must not contain a user name or password.`;
  if (url.hash) return `${label} must not contain a #fragment.`;
  const host = url.hostname.toLowerCase();
  // "localhost." and "intranet." are the same hosts as "localhost" and "intranet".
  if (host.endsWith('.')) return `${label} has a host name that ends with a dot (${host}).`;
  if (!(options && options.allowLocal)) {
    if (host === 'localhost' || host.endsWith('.localhost') || isIpLiteral(host)) {
      return `${label} must use a public host name, not ${host}.`;
    }
    if (host.indexOf('.') < 0) return `${label} must use a fully qualified host name.`;
    // Every top-level domain starts with a letter; a numeric last part is an IP address in some URL parsers.
    if (!/^[a-z]/.test(host.slice(host.lastIndexOf('.') + 1))) {
      return `${label} must use a host name whose last part starts with a letter, not ${host}.`;
    }
  }
  return null;
}

function relativeFileProblem(value, label, extensions) {
  if (typeof value !== 'string') return `${label} must be a string.`;
  const check = checkPath(value);
  if (!check.ok) return `${label}: ${check.message}`;
  if (check.isDirectory) return `${label} must name a file, not a folder.`;
  if (!extensions.includes(extensionOf(value))) return `${label} must be a ${extensions.map((e) => '.' + e).join(', ')} file.`;
  return null;
}

/**
 * Validates a parsed manifest.json.
 * @param {unknown} manifest
 * @returns {{code: 'manifest_invalid', field: string, message: string}[]} an empty list when the manifest is valid
 */
function validateManifest(manifest) {
  const errors = [];
  const add = (field, message) => errors.push({ code: 'manifest_invalid', field, message });

  if (!isPlainObject(manifest)) {
    add('', 'manifest.json must contain a JSON object.');
    return errors;
  }

  for (const key of Object.keys(manifest)) {
    if (!FIELDS.includes(key)) {
      add(key, `Unknown field "${key}". Allowed fields: ${FIELDS.slice(1).join(', ')}.`);
    }
  }

  if (has(manifest, '$schema') && typeof manifest.$schema !== 'string') add('$schema', '"$schema" must be a string.');

  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    add('manifestVersion', `"manifestVersion" must be ${MANIFEST_VERSION}.`);
  }

  if (typeof manifest.id !== 'string' || !GUID.test(manifest.id)) {
    add('id', '"id" must be your app\'s Application (client) ID, a GUID like 3f2b8c1e-7d4a-4e9b-a6c5-1d2e3f4a5b6c ' +
      '(Rante Portal > Developers > Apps).');
  } else if (EMPTY_GUID.test(manifest.id)) {
    add('id', '"id" is the empty GUID. Use your app\'s Application (client) ID.');
  }

  const nameProblem = textProblem(manifest.name, '"name"', 60, { required: true, trimmed: true });
  if (nameProblem) add('name', nameProblem);

  if (typeof manifest.version !== 'string' || manifest.version.length > 64 || !SEMVER.test(manifest.version)) {
    add('version', '"version" must be a semantic version such as 1.0.0 or 2.1.0-beta.1.');
  }

  if (has(manifest, 'description')) {
    const p = textProblem(manifest.description, '"description"', 500, { allowNewlines: true });
    if (p) add('description', p);
  }

  if (has(manifest, 'author')) {
    const author = manifest.author;
    if (!isPlainObject(author)) {
      add('author', '"author" must be an object with "name" and optionally "email" and "url".');
    } else {
      for (const key of Object.keys(author)) {
        if (!AUTHOR_FIELDS.includes(key)) add(`author.${key}`, `Unknown field "author.${key}". Allowed: name, email, url.`);
      }
      const p = textProblem(author.name, '"author.name"', 100, { required: true, trimmed: true });
      if (p) add('author.name', p);
      if (has(author, 'email') && (typeof author.email !== 'string' || author.email.length > 254 ||
          hasControl(author.email) || hasInvisible(author.email) || !EMAIL.test(author.email))) {
        add('author.email', '"author.email" must be an email address (no control or invisible formatting characters).');
      }
      if (has(author, 'url')) {
        const u = httpsUrlProblem(author.url, '"author.url"');
        if (u) add('author.url', u);
      }
    }
  }

  const hosting = manifest.hosting;
  if (hosting !== 'bundle' && hosting !== 'external') {
    add('hosting', '"hosting" must be "bundle" (Rante hosts your files) or "external" (you host the app at an HTTPS URL).');
  }

  if (hosting === 'bundle') {
    const p = relativeFileProblem(manifest.entryPoint, '"entryPoint"', ['html', 'htm']);
    if (p) add('entryPoint', p + (typeof manifest.entryPoint === 'string' && /^https?:/i.test(manifest.entryPoint)
      ? ' For an app on your own server, set "hosting" to "external".' : ''));
  } else if (hosting === 'external') {
    const p = httpsUrlProblem(manifest.entryPoint, '"entryPoint"');
    if (p) add('entryPoint', p);
  }

  if (has(manifest, 'icon')) {
    if (hosting === 'external') {
      const p = httpsUrlProblem(manifest.icon, '"icon"');
      if (p) add('icon', p);
    } else if (hosting === 'bundle') {
      const p = relativeFileProblem(manifest.icon, '"icon"', ICON_EXTENSIONS);
      if (p) add('icon', p);
    }
  }

  if (has(manifest, 'permissions')) {
    const permissions = manifest.permissions;
    if (!Array.isArray(permissions)) {
      add('permissions', '"permissions" must be an array of scope names.');
    } else {
      const seen = new Set();
      permissions.forEach((scope, index) => {
        if (typeof scope !== 'string' || !has(SCOPES, scope)) {
          add(`permissions[${index}]`, `Unknown permission ${JSON.stringify(scope)}. Known: ${Object.keys(SCOPES).join(', ')}.`);
        } else if (seen.has(scope)) {
          add(`permissions[${index}]`, `"${scope}" is listed twice.`);
        }
        seen.add(scope);
      });
    }
  }

  if (has(manifest, 'connect')) {
    const connect = manifest.connect;
    if (hosting === 'external') {
      add('connect', '"connect" applies only to bundle apps. An external app sets its own Content-Security-Policy.');
    } else if (!Array.isArray(connect)) {
      add('connect', '"connect" must be an array of origins such as "https://api.example.com".');
    } else if (connect.length > 20) {
      add('connect', `"connect" lists ${connect.length} origins; the limit is 20.`);
    } else {
      const seen = new Set();
      connect.forEach((source, index) => {
        const field = `connect[${index}]`;
        const m = typeof source === 'string' ? CONNECT_SOURCE.exec(source) : null;
        if (!m) {
          add(field, `${JSON.stringify(source)} is not an origin. Use https://host or wss://host (lowercase, no path), ` +
            'optionally *.host for its subdomains.');
          return;
        }
        if (m[2] && m[3].split('.').length < 2) add(field, `${source} is too broad: a wildcard needs at least two labels after "*.".`);
        if (m[4] !== undefined && (Number(m[4]) < 1 || Number(m[4]) > 65535)) add(field, `${source} has an invalid port.`);
        if (m[3] === 'localhost' || m[3].endsWith('.localhost')) add(field, `${source} is a local host name.`);
        if (seen.has(source)) add(field, `${source} is listed twice.`);
        seen.add(source);
      });
    }
  }

  return errors;
}

module.exports = { validateManifest, SCOPES, MANIFEST_VERSION, FIELDS, ICON_EXTENSIONS, isPlainObject };

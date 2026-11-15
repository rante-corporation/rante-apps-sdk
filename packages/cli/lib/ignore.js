'use strict';
// .ranteignore: files to leave out of a package, one pattern per line, in a subset of .gitignore syntax.
//   # comment          blank lines and lines starting with # are skipped
//   *.map              a pattern without "/" matches the file or folder name at any depth
//   /drafts            a leading "/" anchors the pattern at the package root
//   docs/internal/     a trailing "/" matches folders only; a "/" in the middle also anchors at the root
//   **/fixtures        "**" matches any number of folders; "*" and "?" never match "/"
// Negation ("!pattern") is not supported.

function escapeRegExp(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globToRegExpSource(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        out += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escapeRegExp(c);
    }
  }
  return out;
}

/**
 * Compiles .ranteignore text.
 * @returns {(relativePath: string, isDirectory: boolean) => boolean} true when the path is ignored
 */
function compileIgnore(text) {
  const rules = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    if (line[0] === '!') throw new Error(`.ranteignore: negation is not supported ("${line}").`);
    let pattern = line;
    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) pattern = pattern.slice(0, -1);
    const anchored = pattern.startsWith('/') || pattern.indexOf('/') >= 0;
    if (pattern.startsWith('/')) pattern = pattern.slice(1);
    if (!pattern) continue;
    const source = globToRegExpSource(pattern);
    const regex = anchored ? new RegExp(`^${source}$`) : new RegExp(`(?:^|/)${source}$`);
    rules.push({ regex, directoryOnly });
  }
  return function isIgnored(relativePath, isDirectory) {
    return rules.some((rule) => (!rule.directoryOnly || isDirectory) && rule.regex.test(relativePath));
  };
}

module.exports = { compileIgnore };

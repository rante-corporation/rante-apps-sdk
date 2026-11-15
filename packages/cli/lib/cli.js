'use strict';
// The rante command line: init, validate, pack, inspect, unpack.

const fs = require('node:fs');
const path = require('node:path');
const { LIMITS, MANIFEST_NAME, validatePackage, packFolder, unpackPackage, packageFileName, parseManifestBytes } = require('./package');
const { validateManifest, SCOPES } = require('./manifest');

const VERSION = require('../package.json').version;
const SCHEMA_URL = 'https://raw.githubusercontent.com/rante-corporation/rante-apps-sdk/main/schema/manifest.schema.json';

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const HELP = {
  main: `rante ${VERSION} - build and check Rante apps

Usage: rante <command> [options]

Commands:
  init [folder]          Create manifest.json for a new app
  validate <path>        Check a folder, a manifest.json or a .rante package
  pack [folder]          Check a folder and write {name}-{version}.rante
  inspect <package>      Show a package's manifest and files
  unpack <package>       Check a package and extract it into a new folder

Options:
  -h, --help             Show help (also: rante help <command>)
  -v, --version          Show the version

Docs: https://github.com/rante-corporation/rante-apps-sdk
`,
  init: `Usage: rante init [folder] --id <app-id> --name <name> [options]

Creates manifest.json in the folder (default: the current folder).

Options:
  --id <guid>              Your app's Application (client) ID (Rante Portal > Developers > Apps)
  --name <name>            The app's name, up to 60 characters
  --hosting <kind>         bundle (Rante hosts your files, the default) or external (your HTTPS server)
  --entry <file|url>       bundle: the HTML file to open (default index.html); external: the https:// URL
  --app-version <semver>   The app's version (default 1.0.0)
  --description <text>     A short description
  --permission <scope>     A permission to request; repeat for more (${Object.keys(SCOPES).join(', ')})
  --force                  Overwrite an existing manifest.json
`,
  validate: `Usage: rante validate <path> [--json]

  <path> is a folder with manifest.json (checked as "rante pack" would), a manifest.json file
  (for example an external app's), or a .rante package (checked as Rante's servers check uploads).

Options:
  --json   Print the result as JSON
`,
  pack: `Usage: rante pack [folder] [--out <file>] [--force] [--json]

Checks the folder (default: the current folder) and writes a .rante package. Hidden files, __MACOSX,
Thumbs.db and paths listed in .ranteignore are left out. The same input always gives the same bytes.

Options:
  --out <file>   Where to write the package (default: ./{name}-{version}.rante)
  --force        Overwrite an existing file
  --json         Print the result as JSON
`,
  inspect: `Usage: rante inspect <package> [--json]

Checks a .rante package and lists its manifest and files with their sizes and SHA-256 hashes.
`,
  unpack: `Usage: rante unpack <package> [--out <folder>] [--json]

Checks a .rante package, then extracts it into a new or empty folder (default: ./{name}-{version}).
Nothing is written unless the whole package is valid.
`
};

const COMMAND_FLAGS = {
  init: { values: ['id', 'name', 'hosting', 'entry', 'app-version', 'description', 'permission'], booleans: ['force'] },
  validate: { values: [], booleans: ['json'] },
  pack: { values: ['out'], booleans: ['force', 'json'] },
  inspect: { values: [], booleans: ['json'] },
  unpack: { values: ['out'], booleans: ['json'] }
};

class UsageError extends Error {}

function parseArgs(args, spec) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '-h' || arg === '--help') {
      flags.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      if (spec.booleans.includes(name)) {
        if (eq >= 0) throw new UsageError(`--${name} takes no value.`);
        flags[name] = true;
      } else if (spec.values.includes(name)) {
        let value;
        if (eq >= 0) value = arg.slice(eq + 1);
        else {
          value = args[i + 1];
          if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value.`);
          i++;
        }
        if (name === 'permission') (flags.permission = flags.permission || []).push(value);
        else flags[name] = value;
      } else {
        throw new UsageError(`Unknown option --${name}.`);
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) throw new UsageError(`Unknown option ${arg}.`);
    positional.push(arg);
  }
  return { positional, flags };
}

function formatBytes(n) {
  return `${n.toLocaleString('en-US')} bytes`;
}

function printIssues(io, result) {
  for (const w of result.warnings || []) io.stderr.write(`  warning: ${w.message}\n`);
  for (const e of result.errors || []) io.stderr.write(`  error: ${e.message} (${e.code})\n`);
}

function writeJson(io, value) {
  io.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function resolveFrom(io, p) {
  return path.resolve(io.cwd, p);
}

// ------------------------------------------------------------------------------------------------ commands

function cmdInit(io, positional, flags) {
  if (positional.length > 1) throw new UsageError('init takes at most one folder.');
  const folder = resolveFrom(io, positional[0] || '.');
  if (!flags.id || !flags.name) throw new UsageError('init needs --id <app-id> and --name <name>.');
  const hosting = flags.hosting || 'bundle';
  if (hosting !== 'bundle' && hosting !== 'external') throw new UsageError('--hosting must be bundle or external.');
  const entry = flags.entry || (hosting === 'bundle' ? 'index.html' : undefined);
  if (!entry) throw new UsageError('An external app needs --entry https://... (the address Rante loads).');

  const manifest = {
    $schema: SCHEMA_URL,
    manifestVersion: 1,
    id: flags.id,
    name: flags.name,
    version: flags['app-version'] || '1.0.0'
  };
  if (flags.description !== undefined) manifest.description = flags.description;
  manifest.hosting = hosting;
  manifest.entryPoint = entry;
  manifest.permissions = flags.permission || [];

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    io.stderr.write('The manifest would not be valid:\n');
    printIssues(io, { errors });
    return EXIT_FAILED;
  }
  const target = path.join(folder, MANIFEST_NAME);
  if (fs.existsSync(target) && !flags.force) {
    io.stderr.write(`${target} already exists. Use --force to replace it.\n`);
    return EXIT_FAILED;
  }
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n');
  io.stdout.write(`Created ${target}\n`);
  if (hosting === 'bundle') {
    io.stdout.write(`Next: build your app into ${folder} (the entry point is ${entry}), then run: rante pack ${positional[0] || '.'}\n`);
  } else {
    io.stdout.write('Next: register this manifest.json for your app in the Rante Portal (Developers > Apps > Hosting).\n');
  }
  return EXIT_OK;
}

function readPackageFile(io, file) {
  const absolute = resolveFrom(io, file);
  const stat = fs.statSync(absolute);
  if (stat.size > LIMITS.maxPackageBytes) {
    return {
      result: {
        ok: false, warnings: [], files: [], manifest: null,
        errors: [{ code: 'package_too_large', message: `The package is ${stat.size} bytes; the limit is ${LIMITS.maxPackageBytes} (50 MiB).` }]
      }
    };
  }
  const buffer = fs.readFileSync(absolute);
  return { buffer, result: validatePackage(buffer) };
}

function existingPath(io, p) {
  const absolute = resolveFrom(io, p);
  if (!fs.existsSync(absolute)) throw new UsageError(`${p} does not exist.`);
  return absolute;
}

function cmdValidate(io, positional, flags) {
  if (positional.length !== 1) throw new UsageError('validate needs exactly one path.');
  const target = existingPath(io, positional[0]);
  const stat = fs.statSync(target);
  let result;
  let kind;

  if (stat.isDirectory()) {
    kind = 'folder';
    const manifestPath = path.join(target, MANIFEST_NAME);
    let external = false;
    if (fs.existsSync(manifestPath)) {
      const parsed = parseManifestBytes(fs.readFileSync(manifestPath));
      external = parsed.manifest && parsed.manifest.hosting === 'external';
      if (external) result = { ok: parsed.errors.length === 0, errors: parsed.errors, warnings: parsed.warnings, manifest: parsed.manifest };
    }
    if (!external) {
      const packed = packFolder(target);
      result = packed.ok
        ? Object.assign({}, packed.validation, { warnings: packed.warnings })
        : { ok: false, errors: packed.errors, warnings: packed.warnings, manifest: packed.manifest || null };
    }
  } else if (/\.json$/i.test(target)) {
    kind = 'manifest';
    const parsed = parseManifestBytes(fs.readFileSync(target));
    const warnings = parsed.warnings.slice();
    if (parsed.manifest && parsed.manifest.hosting === 'bundle' && parsed.errors.length === 0) {
      warnings.push({ code: 'files_not_checked', message: 'Only the manifest was checked. Validate the folder or the .rante package to check the files too.' });
    }
    result = { ok: parsed.errors.length === 0, errors: parsed.errors, warnings, manifest: parsed.manifest || null };
  } else {
    kind = 'package';
    result = readPackageFile(io, positional[0]).result;
  }

  if (flags.json) {
    writeJson(io, Object.assign({ kind }, result));
  } else {
    printIssues(io, result);
    if (result.ok) {
      const m = result.manifest;
      io.stdout.write(`OK: ${positional[0]} is a valid ${kind === 'package' ? '.rante package' : kind === 'folder' ? 'app folder' : 'manifest'}` +
        (m ? ` (${m.name} ${m.version}, ${m.hosting})` : '') + '\n');
    } else {
      io.stderr.write(`${positional[0]} is not valid: ${result.errors.length} problem${result.errors.length === 1 ? '' : 's'}.\n`);
    }
  }
  return result.ok ? EXIT_OK : EXIT_FAILED;
}

function cmdPack(io, positional, flags) {
  if (positional.length > 1) throw new UsageError('pack takes at most one folder.');
  const folder = resolveFrom(io, positional[0] || '.');
  const outputOption = flags.out ? resolveFrom(io, flags.out) : null;
  const packed = packFolder(folder, { outputPath: outputOption || undefined });
  if (!packed.ok) {
    if (flags.json) writeJson(io, { ok: false, errors: packed.errors, warnings: packed.warnings });
    else {
      printIssues(io, packed);
      io.stderr.write(`Nothing was written: ${packed.errors.length} problem${packed.errors.length === 1 ? '' : 's'}.\n`);
    }
    return EXIT_FAILED;
  }
  const output = outputOption || resolveFrom(io, packageFileName(packed.manifest));
  if (fs.existsSync(output) && !flags.force) {
    io.stderr.write(`${output} already exists. Use --force to replace it.\n`);
    return EXIT_FAILED;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, packed.buffer);
  const v = packed.validation;
  if (flags.json) {
    writeJson(io, Object.assign({ output }, v, { warnings: packed.warnings }));
  } else {
    printIssues(io, { warnings: packed.warnings, errors: [] });
    const m = packed.manifest;
    io.stdout.write(`Packed ${output}\n`);
    io.stdout.write(`  app       ${m.name} ${m.version} (${m.id})\n`);
    io.stdout.write(`  files     ${v.files.length} (${formatBytes(v.totalBytes)} unpacked)\n`);
    io.stdout.write(`  package   ${formatBytes(v.packageBytes)}\n`);
    io.stdout.write(`  sha256    ${v.packageSha256}\n`);
  }
  return EXIT_OK;
}

function cmdInspect(io, positional, flags) {
  if (positional.length !== 1) throw new UsageError('inspect needs exactly one package.');
  existingPath(io, positional[0]);
  const { result } = readPackageFile(io, positional[0]);
  if (flags.json) {
    writeJson(io, result);
    return result.ok ? EXIT_OK : EXIT_FAILED;
  }
  printIssues(io, result);
  if (!result.ok) {
    io.stderr.write(`${positional[0]} is not a valid package.\n`);
    return EXIT_FAILED;
  }
  const m = result.manifest;
  io.stdout.write(`${m.name} ${m.version}\n`);
  io.stdout.write(`  id           ${m.id}\n`);
  if (m.author) io.stdout.write(`  author       ${m.author.name}\n`);
  io.stdout.write(`  entry point  ${m.entryPoint}\n`);
  if (m.icon) io.stdout.write(`  icon         ${m.icon}\n`);
  io.stdout.write(`  permissions  ${(m.permissions || []).join(', ') || '(none)'}\n`);
  if (m.connect && m.connect.length) io.stdout.write(`  connect      ${m.connect.join(', ')}\n`);
  io.stdout.write(`  package      ${formatBytes(result.packageBytes)}, sha256 ${result.packageSha256}\n`);
  io.stdout.write(`  files        ${result.files.length} (${formatBytes(result.totalBytes)} unpacked)\n`);
  const width = Math.max(...result.files.map((f) => String(f.size).length));
  for (const f of result.files) {
    io.stdout.write(`    ${String(f.size).padStart(width)}  ${f.sha256.slice(0, 16)}  ${f.path}\n`);
  }
  return EXIT_OK;
}

function cmdUnpack(io, positional, flags) {
  if (positional.length !== 1) throw new UsageError('unpack needs exactly one package.');
  existingPath(io, positional[0]);
  const { buffer, result } = readPackageFile(io, positional[0]);
  if (!result.ok) {
    if (flags.json) writeJson(io, result);
    else {
      printIssues(io, result);
      io.stderr.write('Nothing was written: the package is not valid.\n');
    }
    return EXIT_FAILED;
  }
  const folder = flags.out ? resolveFrom(io, flags.out) : resolveFrom(io, packageFileName(result.manifest).replace(/\.rante$/, ''));
  const unpacked = unpackPackage(buffer, folder);
  if (flags.json) writeJson(io, { ok: unpacked.ok, folder, errors: unpacked.errors, warnings: unpacked.warnings, written: unpacked.written });
  else if (unpacked.ok) io.stdout.write(`Unpacked ${unpacked.written.length} files into ${folder}\n`);
  else printIssues(io, unpacked);
  return unpacked.ok ? EXIT_OK : EXIT_FAILED;
}

const COMMANDS = { init: cmdInit, validate: cmdValidate, pack: cmdPack, inspect: cmdInspect, unpack: cmdUnpack };

/**
 * Runs the CLI.
 * @param {string[]} argv arguments after the program name
 * @param {{stdout: {write(s: string): void}, stderr: {write(s: string): void}, cwd: string}} io
 * @returns {number} the exit code
 */
function main(argv, io) {
  const args = argv.slice();
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    io.stdout.write(HELP.main);
    return args.length === 0 ? EXIT_USAGE : EXIT_OK;
  }
  if (args[0] === '-v' || args[0] === '--version') {
    io.stdout.write(`${VERSION}\n`);
    return EXIT_OK;
  }
  if (args[0] === 'help') {
    const topic = args[1];
    if (topic && !HELP[topic]) {
      io.stderr.write(`Unknown command "${topic}".\n\n${HELP.main}`);
      return EXIT_USAGE;
    }
    io.stdout.write(HELP[topic || 'main']);
    return EXIT_OK;
  }
  const command = args.shift();
  if (!COMMANDS[command]) {
    io.stderr.write(`Unknown command "${command}".\n\n${HELP.main}`);
    return EXIT_USAGE;
  }
  try {
    const { positional, flags } = parseArgs(args, COMMAND_FLAGS[command]);
    if (flags.help) {
      io.stdout.write(HELP[command]);
      return EXIT_OK;
    }
    return COMMANDS[command](io, positional, flags);
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr.write(`${err.message}\n\n${HELP[command]}`);
      return EXIT_USAGE;
    }
    io.stderr.write(`rante ${command} failed: ${err && err.message ? err.message : err}\n`);
    return EXIT_FAILED;
  }
}

module.exports = { main, parseArgs, VERSION, SCHEMA_URL, EXIT_OK, EXIT_FAILED, EXIT_USAGE };

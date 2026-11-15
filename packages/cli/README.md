# @rante/cli

The `rante` command line for Rante apps: create a `manifest.json`, check an app, and pack a static app into a
`.rante` package ready to upload. Node.js 20 or later, no dependencies.

```bash
npx @rante/cli <command>
# or
npm install --save-dev @rante/cli
```

## Commands

### `rante init [folder] --id <app-id> --name <name>`

Writes `manifest.json`. Options: `--hosting bundle|external` (default `bundle`), `--entry <file|url>` (default
`index.html`; external apps need an `https://` URL), `--app-version <semver>` (default `1.0.0`), `--description`,
`--permission <scope>` (repeat it), `--force`.

```bash
npx @rante/cli init dist --id 3f2b8c1e-7d4a-4e9b-a6c5-1d2e3f4a5b6c --name "Expense Tracker" --permission user.read
```

### `rante pack [folder] [--out <file>] [--force] [--json]`

Checks the folder and writes `{name}-{version}.rante`. Hidden files, `__MACOSX`, `Thumbs.db`, `desktop.ini` and the
paths in `.ranteignore` are left out. The output is reproducible: the same folder gives the same bytes.

Packing this repository's [hello-bundle example](../../examples/hello-bundle):

```
$ npx @rante/cli pack examples/hello-bundle
Packed /work/hello-rante-1.0.0.rante
  app       Hello Rante 1.0.0 (3f2b8c1e-7d4a-4e9b-a6c5-1d2e3f4a5b6c)
  files     6 (23,836 bytes unpacked)
  package   8,031 bytes
  sha256    abf3fcdaf64190163f032d19b048c570e40aeeabb01377225b3581a6bb068623
```

### `rante validate <path> [--json]`

- a folder: checked the way `pack` checks it;
- a `manifest.json`: the manifest alone (external apps);
- a `.rante` file: every check Rante's servers run on an upload (see
  [the package format](../../docs/package-format.md)).

Exit code 0 when valid, 1 when not, 2 for a usage error.

### `rante inspect <package> [--json]`

Checks a package and lists its manifest and its files with sizes and SHA-256 hashes.

### `rante unpack <package> [--out <folder>]`

Checks a package and extracts it into a new or empty folder. Nothing is written unless the whole package is valid, and
every path is checked to stay inside the folder.

## From code

```js
const { validatePackage, packFolder, validateManifest } = require('@rante/cli');

const result = validatePackage(fs.readFileSync('app-1.0.0.rante'));
if (!result.ok) console.error(result.errors); // [{ code, message, path? }]
```

Error codes are stable; Rante's servers use the same ones.

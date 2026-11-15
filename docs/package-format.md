# The .rante package format

A `.rante` file is a plain ZIP archive. There is no custom compression or binary format: `my-app-1.0.0.rante` is a
ZIP file with another extension, so any ZIP tool can open it. What makes it a package is its layout and the rules
below, which Rante's servers apply to every upload and `rante validate` applies on your machine.

```
expense-tracker-1.0.0.rante
  manifest.json              required, at the root
  index.html                 the manifest's entryPoint
  icon.svg                   the manifest's icon
  assets/index-DwP3k_1a.js
  assets/index-B7xQ2m9c.css
```

Build one with `npx @rante/cli pack dist`. You can zip a folder yourself too, as long as the archive follows these
rules; `rante validate` tells you what the servers would refuse.

## What happens to an upload

When you upload a package in the Rante Portal (Developers > Apps > Hosting), Rante:

1. **Checks the ZIP signature and size.** The file must start with the bytes `50 4B 03 04` (the `.rante` extension
   alone proves nothing) and be at most 50 MiB.
2. **Reads and checks `manifest.json` in memory, before anything is stored**: every [manifest rule](manifest.md),
   the entry point and icon present in the archive, and only [allowed file types](#file-types).
3. **Checks every path before extracting** (no "zip slip"): relative, inside the package, no duplicates, no links,
   no zip bombs. See [Paths](#paths) and [Archive rules](#archive-rules).
4. **Extracts the files** into the Rante Storage account you chose, under `apps/{id}/{version}/`, and records each
   file's SHA-256. Rante serves the files only while they still match those hashes.

Nothing is stored unless the whole package passes. Staff then review the version like any other listing version;
after approval you release it, and Rante serves it at `https://{app}.gallerycdn.rante.com/{version}/`.

## Limits

| Limit | Value |
|---|---|
| Package size | 50 MiB (52,428,800 bytes) |
| Entries | 5,000 |
| One file, unpacked | 50 MiB |
| All files, unpacked | 200 MiB |
| manifest.json | 64 KiB |
| Compression ratio | at most 200:1 for files of 1 MiB or more |
| Path length | 512 bytes, 255 per name, 32 folders deep |
| Archive comment | 1 KiB |

## Paths

Every entry name:

- is relative and uses `/` (no leading `/`, no drive letter such as `C:`, no `\`);
- has no `.` or `..` segments and no empty segments (`a//b`);
- uses only `A-Z a-z 0-9 . _ ~ @ + = , ( ) ! -` in each name: no spaces, `%`, `#`, `?` or non-ASCII letters, so
  every file has exactly one URL;
- has no hidden files or folders (names starting with `.`), except a top-level `.well-known/` folder;
- has no `__MACOSX/` metadata, no names ending in `.`, and no Windows device names (`CON`, `NUL`, `COM1`...);
- is unique, also when upper and lower case are ignored (`Index.html` and `index.html` cannot both exist).

Folder entries (names ending in `/`) are allowed and ignored.

## File types

Every file needs one of these extensions. Rante serves it with the Content-Type shown and
`X-Content-Type-Options: nosniff`.

| Kind | Extensions |
|---|---|
| Pages, code and data | `html` `htm` `css` `js` `mjs` `json` `map` `webmanifest` `txt` `md` `csv` `xml` `wasm` `pdf` |
| Images | `png` `jpg` `jpeg` `gif` `webp` `avif` `svg` `ico` `bmp` |
| Fonts | `woff` `woff2` `ttf` `otf` |
| Audio and video | `mp3` `m4a` `aac` `wav` `ogg` `oga` `flac` `mp4` `webm` `ogv` |
| 3D models | `glb` `gltf` |

Everything else is refused, and these are named in the error so the reason is clear: executables and installers
(`exe`, `dll`, `msi`, `dmg`, `apk`...), shell and server scripts (`sh`, `ps1`, `bat`, `php`, `asp`, `jsp`, `py`,
`rb`, `pl`, `cgi`...), Java archives, and server configuration (`web.config`, `.htaccess`, `.env`, `ini`). A file
that starts like an executable (an `MZ`, ELF or Mach-O header, or a `#!` interpreter line) is refused whatever its
name.

`rante pack` leaves out hidden files, `__MACOSX`, `Thumbs.db` and `desktop.ini` by itself. For anything else, add a
`.ranteignore` file to the folder:

```
# .ranteignore: one pattern per line
*.map          # a name anywhere in the folder
/drafts        # anchored at the folder root
docs/internal/ # a folder (trailing slash)
**/fixtures    # any depth
```

## Archive rules

- Compression is stored (method 0) or deflate (method 8). No encryption, no ZIP64, no split archives.
- Entry names are UTF-8 (general purpose flag bit 11) or plain ASCII.
- Each local file header matches its central directory entry (name, method, sizes, CRC-32).
- Entries do not overlap and nothing comes before the first entry, which rules out overlapping-entry zip bombs and
  polyglot files.
- Each file inflates to exactly its declared size (inflation stops at that size) and matches its CRC-32.
- No symbolic links or other special files (Unix mode bits in the external attributes).

## Reproducible packages

`rante pack` writes `manifest.json` first, then every other file sorted by its path's bytes, with fixed timestamps
(1980-01-01 00:00) and no extra fields. Packing the same folder with the same Node.js version gives the same bytes and
the same SHA-256, so you can check that the package you uploaded is the one you built:

```bash
npx @rante/cli inspect expense-tracker-1.0.0.rante
```

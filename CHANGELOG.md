# Changelog

## 0.1.0 (unreleased)

First version of both packages. Rante's hosting of apps (the Developers portal upload, gallerycdn.rante.com and the
My apps frame) is being built to this design; until it is live, the SDK has no host to connect to.

### @rante/sdk

- `Rante.init()` handshake with the Rante host over `postMessage` and a private `MessageChannel`; the hello goes only
  to `https://portal.rante.com`, never to `"*"`.
- `getContext()`, `getUser()`, `getTenant()`, `getAccessToken()` (cached), `notify()`, `openUrl()`, `resize()`
  (and `autoResize`), `setTitle()`, `ready()`, `on()` / `off()` for `theme.changed` and `context.changed`, and
  `request()` for raw protocol calls.
- Permission scopes: `user.read`, `user.email`, `tenant.read`, `auth.token`, `notifications`, `navigation`,
  `clipboard.write`.
- `@rante/sdk/host`: the reference host bridge, which checks every request against the tenant's grants, filters the
  context, rate-limits, and builds the frame's `sandbox` and `allow` attributes.
- TypeScript definitions for both.

### @rante/cli

- `rante init`, `validate`, `pack`, `inspect` and `unpack`.
- The package checks Rante's servers run: ZIP signature and 50 MiB limit, manifest.json validated in memory (strict
  JSON, no duplicate fields), entry point and icon present, an allow-list of file types, executable signatures,
  zip-slip path rules, duplicates, links, overlapping entries, size and ratio limits, CRC-32.
- Reproducible packages: the same folder gives the same bytes.
- `.ranteignore` support.

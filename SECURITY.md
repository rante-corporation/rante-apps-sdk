# Security policy

## Reporting a vulnerability

Please report security problems in this repository privately, through GitHub: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue, pull request or discussion for them.

Include what you found, how to reproduce it, and what an attacker could do with it. We will confirm that we received
the report, keep you informed while we work on a fix, and credit you when it is published, unless you prefer
otherwise.

## Scope

- `@rante/sdk` (`packages/sdk`): the app-side SDK and the host bridge, including the handshake and permission checks
  described in [docs/protocol.md](docs/protocol.md).
- `@rante/cli` (`packages/cli`): package validation and extraction, including the path, file-type and zip-bomb checks
  in [docs/package-format.md](docs/package-format.md).
- The isolation model in [docs/security.md](docs/security.md).

Problems in Rante's hosted services (portal.rante.com, gallerycdn.rante.com, login.rante.com) can be reported the
same way.

## Supported versions

Fixes go into the latest release of each package.

# manifest.json

Every Rante app has a `manifest.json`. A **bundle** app (Rante hosts its static files) keeps it at the root of its
`.rante` package. An **external** app (you host it on your own HTTPS server) registers it on its own in the Rante
Portal under **Developers > Apps > Hosting**.

Create one with the CLI:

```bash
npx @rante/cli init --id <your-app-id> --name "Expense Tracker"
```

## Bundle app

```json
{
  "$schema": "https://raw.githubusercontent.com/rante-corporation/rante-apps-sdk/main/schema/manifest.schema.json",
  "manifestVersion": 1,
  "id": "3f2b8c1e-7d4a-4e9b-a6c5-1d2e3f4a5b6c",
  "name": "Expense Tracker",
  "version": "1.0.0",
  "description": "Track your team's expenses.",
  "author": { "name": "Contoso Ltd", "url": "https://contoso.example" },
  "hosting": "bundle",
  "entryPoint": "index.html",
  "icon": "icon.svg",
  "permissions": ["user.read", "tenant.read", "auth.token"],
  "connect": ["https://api.contoso.example"]
}
```

## External app

```json
{
  "manifestVersion": 1,
  "id": "3f2b8c1e-7d4a-4e9b-a6c5-1d2e3f4a5b6c",
  "name": "Contoso CRM",
  "version": "2.3.0",
  "hosting": "external",
  "entryPoint": "https://crm.contoso.example/rante",
  "icon": "https://crm.contoso.example/icon-128.png",
  "permissions": ["user.read", "tenant.read", "auth.token"]
}
```

## Fields

| Field | Required | Rules |
|---|---|---|
| `$schema` | no | Any string. Point it at the schema above to get completion in your editor. |
| `manifestVersion` | yes | `1`. |
| `id` | yes | Your app's **Application (client) ID**, a GUID, from the Rante Portal (Developers > Apps). Rante checks that the person uploading or registering the manifest manages that app. |
| `name` | yes | 1 to 60 characters, no spaces at the start or end, no control or invisible formatting characters. |
| `version` | yes | A [semantic version](https://semver.org): `MAJOR.MINOR.PATCH`, optionally `-prerelease` (for example `1.2.0-beta.1`). No `+build` part. Every upload or registration needs a version Rante has not seen for the app; a version is never replaced. |
| `description` | no | Up to 500 characters; line breaks allowed. |
| `author` | no | `{ "name", "email"?, "url"? }`. `name` up to 100 characters, `url` an `https://` address. |
| `hosting` | yes | `"bundle"` or `"external"`. |
| `entryPoint` | yes | **bundle:** the `.html` or `.htm` file inside the package that Rante opens, for example `index.html` or `app/index.html`. It follows the [path rules](package-format.md#paths). **external:** the `https://` URL Rante loads in the frame. It needs a public host name (no `localhost`, no IP address), no user name or password and no `#fragment`. |
| `icon` | no | **bundle:** a `.png`, `.svg`, `.jpg`, `.jpeg` or `.webp` file inside the package. **external:** an `https://` URL. Without one, Rante uses the store listing's icon. |
| `permissions` | no | The scopes below, each at most once. Default: none. |
| `connect` | no | **Bundle apps only.** Up to 20 origins the app may call with `fetch`, `XMLHttpRequest`, `EventSource` or WebSockets: `https://host[:port]` or `wss://host[:port]`, lowercase, no path. `https://*.example.com` allows the subdomains of `example.com` (a wildcard needs at least two labels after `*.`). Rante puts these in the app's `Content-Security-Policy: connect-src`; anything else is blocked by the browser. |

Unknown fields are errors, so a typo such as `permisions` is caught instead of ignored. Two fields with the same name
are an error as well.

## Permissions

The tenant's admin sees these in plain words and approves them when installing the app. The Rante host refuses
every request that needs a permission the tenant did not grant, whatever the app sends.

| Scope | What the app can do | SDK |
|---|---|---|
| `user.read` | Read the signed-in person's ID and display name | `Rante.getUser()` |
| `user.email` | Read the signed-in person's email address | `Rante.getContext().user.email` |
| `tenant.read` | Read the active tenant's ID and name | `Rante.getTenant()` |
| `auth.token` | Get access tokens for the app's own API, issued by login.rante.com | `Rante.getAccessToken()` |
| `notifications` | Show notifications in Rante | `Rante.notify()` |
| `navigation` | Open Rante pages, and external links in a new tab | `Rante.openUrl()` |
| `clipboard.write` | Write to the clipboard (the frame gets `allow="clipboard-write"`) | `navigator.clipboard.writeText()` |

Changing `permissions` in a new version means the new version is reviewed again, and installed tenants approve the
new permissions before the version reaches their people.

Rante Graph API permissions (reading users, groups and so on through `graph.rante.com`) are not part of the manifest.
They belong to the app registration in the Portal (Developers > Apps > API permissions), where admins approve them
the same way.

## Checking a manifest

```bash
npx @rante/cli validate manifest.json   # just the manifest (external apps)
npx @rante/cli validate dist            # a bundle folder, as "rante pack" would check it
npx @rante/cli validate app-1.0.0.rante # a package, as Rante's servers check uploads
```

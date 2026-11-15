# Security model

Rante runs third-party code next to people's Rante sessions. These are the rules that keep that code away from
Rante's cookies, from other apps and from data the tenant did not grant.

## Two ways to host an app

| | Bundle (platform-hosted) | External (developer-hosted) |
|---|---|---|
| Where the code lives | Your static files, uploaded as a `.rante` package into a Rante Storage account you choose | Your own HTTPS server |
| Address in the frame | `https://{app}.gallerycdn.rante.com/{version}/{entryPoint}`, where `{app}` is your client ID without dashes | your `entryPoint` URL |
| Reviewed by Rante | every version: manifest, permissions and files | every version: manifest, permissions and URL |
| Can change without review | no: Rante serves only files matching the SHA-256 recorded at upload | your server's content (the URL and permissions cannot) |

## Isolation

**One origin per app.** Each bundle app has its own host name under `gallerycdn.rante.com`, so the browser's
same-origin policy keeps apps apart from each other and from `portal.rante.com`.

**Bundle apps run in an opaque origin.** `gallerycdn.rante.com` belongs to the same site as Rante itself, so a bundle
app's frame is sandboxed without `allow-same-origin`, and every file Rante serves for it carries the same sandbox in
its `Content-Security-Policy`, even when someone opens the file directly in a tab. The app's code then has an opaque
origin: it cannot read or set any `rante.com` cookie, and its requests to Rante never carry the person's session.
What that means while you build the app:

- `document.cookie`, `localStorage`, `sessionStorage`, IndexedDB, service workers and Web Workers are not available.
  Keep state in memory, or on your API with a token from `Rante.getAccessToken()`.
- Use hash-based routing (`/#/settings`). `history.pushState` with a new URL is refused in an opaque origin.
  React Router: `createHashRouter`. Vue Router: `createWebHashHistory`. Angular: `withHashLocation()`.
- Your own files are cross-origin to your page, so Rante serves them with `Access-Control-Allow-Origin: *`; module
  scripts (`<script type="module" crossorigin>`), `fetch('./data.json')` and fonts work as usual.

**External apps** are on your own domain, which is a different site from `rante.com`, so their frame keeps its
origin (`allow-same-origin`) and they can use storage. Browsers treat the frame as third-party, though: cookies set by
your server inside the frame are blocked or partitioned in most browsers. Authenticate with
`Rante.getAccessToken()` instead of cookies.

## The frame

```html
<iframe src="https://{app}.gallerycdn.rante.com/1.0.0/index.html"
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        allow="clipboard-write"            (only with the clipboard.write permission)
        referrerpolicy="strict-origin"></iframe>
```

External apps get the same sandbox plus `allow-same-origin`. No app gets `allow-top-navigation` (it cannot navigate
the Rante page away), `allow-modals` (no `alert()` over Rante), camera, microphone, location or payment features.
`allow-popups-to-escape-sandbox` lets "Sign in" and "Open in new tab" pop-ups work normally.

## What Rante serves with a bundle app's files

```
Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads;
  default-src 'none'; script-src {self} 'wasm-unsafe-eval'; style-src {self} 'unsafe-inline';
  img-src {self} data: blob: {connect}; media-src {self} data: blob: {connect}; font-src {self} data:;
  connect-src {self} {connect}; manifest-src {self}; form-action {connect or 'none'};
  base-uri 'none'; object-src 'none'; frame-src 'none'; worker-src 'none';
  frame-ancestors https://portal.rante.com
Access-Control-Allow-Origin: *
Cross-Origin-Resource-Policy: cross-origin
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()
Cache-Control: public, max-age=31536000, immutable
```

`{self}` is the app's own origin and `{connect}` the manifest's `connect` list. In practice:

- Scripts load only from your package: no inline `<script>` blocks, no `eval`, no scripts from CDNs. Bundle every
  library into your build. (Create React App: `INLINE_RUNTIME_CHUNK=false`. Vite builds need no change.)
- Your code can call only the origins in `connect`, and load images and media only from your package and those
  origins. Reviewers see that list, and so do admins.
- Other sites cannot frame your app; only Rante can.
- Requests to the gallery carry no cookies that reach your code, and responses never set any.

## Data the app can get

Only through the SDK, and only what the tenant's admin granted from the manifest's `permissions` (see
[manifest.md](manifest.md#permissions)). The host checks every request itself; the SDK's own check is a convenience.
Everything the host returns is filtered by the granted permissions, whatever the handler produced.

Tokens from `Rante.getAccessToken()` are issued by `login.rante.com` for the signed-in person, with the app's client
ID as `aud`. Validate them on your server before trusting anything in them: the signature against the keys at the
`jwks_uri` of `https://login.rante.com/common/v2.0/.well-known/openid-configuration`, then `iss`, `aud`, `exp`, and
`tid` for the tenant.

## The handshake

The SDK sends its hello only to `https://portal.rante.com` and never to `"*"`, accepts the answer only from its
parent window and that origin, and moves everything else to a private `MessageChannel`. The host accepts a hello
only from the iframe it created, from that iframe's exact origin, and for the app it opened. Details:
[protocol.md](protocol.md).

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md): report it privately through GitHub, not in a public issue.

# @rante/sdk

The JavaScript SDK for Rante apps. Your app runs in a sandboxed frame inside Rante; the SDK connects it to the Rante
page around it, over `postMessage` and a private `MessageChannel`, and asks for what the tenant allowed.

One file, plain ES2019, no dependencies: `rante-sdk.js`.

## Install

```bash
npm install @rante/sdk
```

```js
import Rante from '@rante/sdk';
```

Or copy `rante-sdk.js` into your app and load it before your own script; it defines `window.Rante`. Bundle apps must
ship the file inside their package: they can load scripts only from their own origin.

## Use

```js
const host = await Rante.init();
// host.permissions: what the tenant's admin granted, e.g. ['user.read', 'tenant.read']
// host.theme: 'light' or 'dark'

const user = await Rante.getUser();      // { id, displayName }   needs "user.read"
const tenant = await Rante.getTenant();  // { id, name }          needs "tenant.read"

const { token, expiresOn } = await Rante.getAccessToken(); // needs "auth.token"
await fetch('https://api.contoso.example/me', { headers: { Authorization: `Bearer ${token}` } });

Rante.on('theme.changed', ({ theme }) => document.documentElement.dataset.theme = theme);
await Rante.notify('Report saved', { kind: 'success' });     // needs "notifications"
await Rante.openUrl('https://contoso.example/help');         // needs "navigation"
```

Ask for permissions in your [manifest.json](../../docs/manifest.md#permissions). A call without the permission fails
with `code: 'permission_denied'`; Rante's host refuses it as well, whatever the app sends.

## API

| Method | Returns | Notes |
|---|---|---|
| `init(options?)` | `Promise<HostInfo>` | Connects to Rante. Options: `appId` (your client ID, checked by the host), `timeoutMs` (10000), `ready` (true: tell Rante the app loaded as soon as it connects), `autoResize` (false: report the page height whenever it changes), `hostOrigins` (`['https://portal.rante.com']`). Later calls return the same promise. |
| `getHostInfo()` | `HostInfo \| null` | `{ protocol, host, app, permissions, capabilities, locale, theme }` |
| `isConnected()` | `boolean` | |
| `hasPermission(scope)` | `boolean` | Whether the tenant granted the scope. |
| `supports(method)` | `boolean` | Whether this host answers a protocol method, e.g. `'auth.getToken'`. |
| `getContext()` | `Promise<{ locale, theme, user?, tenant? }>` | Only what the permissions allow. |
| `getUser()` | `Promise<{ id, displayName, email? }>` | `user.read`; `email` with `user.email`. |
| `getTenant()` | `Promise<{ id, name }>` | `tenant.read`. |
| `getAccessToken({ forceRefresh? })` | `Promise<{ token, expiresOn }>` | `auth.token`. A JWT from login.rante.com, `aud` = your client ID; cached until a minute before `expiresOn`. Validate it on your server. |
| `notify(message, { kind? })` | `Promise<void>` | `notifications`. `kind`: `info` (default), `success`, `warning`, `error`. |
| `openUrl(url, { target? })` | `Promise<void>` | `navigation`. `https://` only; `target` `blank` (new tab, default) or `self` (a Rante page). |
| `resize(height?)` | `Promise<void>` | Measures the page when `height` is omitted. |
| `setTitle(title)` | `Promise<void>` | Up to 100 characters. |
| `ready()` | `Promise<void>` | After `init({ ready: false })`, when your app has rendered. |
| `on(event, handler)` | `() => void` | Events: `theme.changed` `{ theme }`, `context.changed` `{}`. Returns an unsubscribe function. |
| `off(event, handler)` | | |
| `request(method, params?, { timeoutMs? })` | `Promise<any>` | A raw [protocol](../../docs/protocol.md) call. |
| `disconnect()` | | Closes the connection. |

Errors are `RanteError` objects with a `code`: `not_in_host`, `not_connected`, `timeout`, `permission_denied`,
`not_supported`, `invalid_request`, `rate_limited`, `unavailable`, `host_error`.

## Things to know

- **Bundle apps** (served from `gallerycdn.rante.com`) run in an opaque origin: no cookies, `localStorage`,
  IndexedDB or workers, and routing must use the URL hash. See [the security model](../../docs/security.md).
- **External apps** are third-party frames: browsers block or partition their cookies. Use `getAccessToken()`.
- The SDK talks only to `https://portal.rante.com`. Outside Rante, `init()` fails with `not_in_host` (no parent
  frame) or `timeout`.

## Host bridge

`@rante/sdk/host` (`rante-host.js`) is the other side of the protocol: the code Rante's pages use to answer apps.
It is published so the protocol can be read and tested end to end; apps do not need it.

```js
import { createBridge, frameAttributes } from '@rante/sdk/host';
```

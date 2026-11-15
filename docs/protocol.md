# The Rante Apps protocol (version 1)

Rante opens every app, bundle or external, in a sandboxed `<iframe>` on the host page (My apps in the Rante Portal,
`https://portal.rante.com`). The app and the host talk only through `postMessage`: first a handshake on the window,
then requests and events on a private `MessageChannel`. `@rante/sdk` (`rante-sdk.js`) is the app side;
`rante-host.js` is the reference host side and what Rante's pages use.

You need this document only to implement the protocol yourself. With the SDK, call `Rante.init()` and the methods in
the [SDK README](../packages/sdk/README.md).

## Handshake

```
 app (iframe)                                        host page (portal.rante.com)
     |  hello {rante:1, type:"hello", sdk, nonce, appId?}  |
     |  -> window.parent.postMessage(msg, hostOrigin)      |   every 250 ms until connected
     | --------------------------------------------------> |   checks: event.source is the app's iframe,
     |                                                     |   event.origin is the app's origin, appId matches
     |  connect {rante:1, type:"connect", nonce, protocol, |
     |           host, app, permissions, capabilities,     |
     |           locale, theme}  + MessagePort             |
     | <-------------------------------------------------- |   iframe.contentWindow.postMessage(msg, appOrigin, [port])
     |  checks: event.source === window.parent,            |
     |  event.origin is an allowed host origin,            |
     |  nonce matches its hello                            |
     |                                                     |
     |  requests and events on the MessagePort only        |
```

1. **hello.** The app posts `{ rante: 1, type: "hello", sdk: "<version>", nonce: "<random hex>", appId?: "<client id>" }`
   to `window.parent`, once for each allowed host origin (by default only `https://portal.rante.com`). It never posts
   to `"*"`: a page that frames the app without being Rante receives nothing. It repeats every 250 ms, because the host
   may attach its listener after the app starts.
2. **connect.** The host accepts a hello only when `event.source` is the iframe it created, `event.origin` is exactly
   the app's origin (`https://{app}.gallerycdn.rante.com` for bundles, the origin of `entryPoint` for external apps),
   and `appId`, when present, is the app it opened. It creates a `MessageChannel`, keeps `port1`, and posts `connect`
   with `port2` to that one origin:

   | Field | Meaning |
   |---|---|
   | `nonce` | the hello's nonce, so the app knows the answer is for this page load |
   | `protocol` | `1` |
   | `host` | `{ name: "portal", version }` |
   | `app` | `{ id, version }`: the app and version the host opened |
   | `permissions` | the scopes the tenant granted (a subset of the manifest's `permissions`) |
   | `capabilities` | the methods this host answers |
   | `locale` | the person's language, such as `en-US` |
   | `theme` | `"light"` or `"dark"` |

3. The app accepts `connect` only from `window.parent`, from an allowed host origin, with its own nonce and a port.
   From then on both sides use the port. A new page load in the frame says hello again; the host then closes the old
   port and hands over a new one.

## Requests and responses

On the port, the app sends `{ id, method, params }`; `id` is a number the app has not used on this port. The host
answers each request exactly once:

```json
{ "id": 7, "result": { } }
{ "id": 7, "error": { "code": "permission_denied", "message": "The app does not have the \"auth.token\" permission." } }
```

| Method | Permission | Params | Result |
|---|---|---|---|
| `context.get` | none (the result is filtered) | `{}` | `{ locale, theme, user?, tenant? }`. `user.id` and `user.displayName` with `user.read`; `user.email` with `user.email`; `tenant.id` and `tenant.name` with `tenant.read` |
| `auth.getToken` | `auth.token` | `{}` | `{ token, expiresOn }`: a JWT from login.rante.com for the signed-in person with `aud` = the app's client ID; `expiresOn` in milliseconds since 1970 |
| `notifications.show` | `notifications` | `{ message (1-500 chars), kind: "info"\|"success"\|"warning"\|"error" }` | `{}` |
| `navigation.open` | `navigation` | `{ url: "https://...", target: "blank"\|"self" }` | `{}`. `blank` opens a new tab after the host confirms it with the person; `self` opens a Rante page in place |
| `frame.ready` | none | `{}` | `{}`: the app has loaded; the host hides its loading indicator |
| `frame.resize` | none | `{ height: 0-100000 }` | `{}`: the frame's content height in CSS pixels |
| `frame.setTitle` | none | `{ title (0-100 chars) }` | `{}` |

The host checks the permission of every request against what the tenant granted, whatever the app claims or the SDK
checked. Requests over the host's rate (20 per second by default) get `rate_limited`.

### Error codes

| Code | Meaning |
|---|---|
| `permission_denied` | the tenant did not grant the permission the method needs |
| `not_supported` | this host does not answer the method (see `capabilities`) |
| `invalid_request` | the params are missing or out of range |
| `rate_limited` | too many requests; try again later |
| `unavailable` | the host cannot answer right now (for example tokens are not available yet) |
| `host_error` | anything else; the message never carries internal details |

The SDK adds three of its own: `not_in_host` (the page is not in a frame), `not_connected` (a call before `init()`
finished) and `timeout` (no answer in time: 10 s for the handshake, 15 s per request, 60 s for tokens).

## Events

The host sends `{ event, data }` on the port:

| Event | Data | When |
|---|---|---|
| `theme.changed` | `{ theme: "light" \| "dark" }` | the person switched Rante's theme |
| `context.changed` | `{}` | the person or tenant changed; call `context.get` again |

## Compatibility

Every window message carries `rante: 1`. A later protocol version will use a new number; hosts keep answering
version 1 apps. New methods and events may be added to version 1 at any time, so apps should check `capabilities`
before calling a method that not every host has, and ignore events they do not know.

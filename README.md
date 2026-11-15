# Rante Apps SDK

Build apps that run inside [Rante](https://rante.com): in the **My apps** page of the Rante Portal, in a sandboxed
frame, for the tenants that install them from the Rante marketplace.

| Package | What it is |
|---|---|
| [`@rante/sdk`](packages/sdk) | The JavaScript SDK your app uses to talk to Rante: the signed-in person, the tenant, access tokens for your API, notifications, theme. `postMessage` under the hood. |
| [`@rante/cli`](packages/cli) | The `rante` command: create `manifest.json`, check your app, and pack a static app into a `.rante` package. |

Both are plain JavaScript with no dependencies. Status: **0.1.0, not yet on npm.** Rante's hosting of apps is being
built to the design in [docs/](docs); until it is live the SDK has no host to connect to.

**Server SDKs.** Your app's backend checks the access tokens the SDK hands out (see [docs/tokens.md](docs/tokens.md))
with the server SDK for its language: [Node.js](https://github.com/rante-corporation/rante-apps-sdk-node),
[Python](https://github.com/rante-corporation/rante-apps-sdk-python), [.NET](https://github.com/rante-corporation/rante-apps-sdk-dotnet),
[Java](https://github.com/rante-corporation/rante-apps-sdk-java), [Go](https://github.com/rante-corporation/rante-apps-sdk-go) or
[PHP](https://github.com/rante-corporation/rante-apps-sdk-php).

## Two ways to host an app

**Bundle (Rante hosts it).** Build your app into static files, add a `manifest.json`, and pack the folder:

```bash
npx @rante/cli init dist --id <your-app-id> --name "Expense Tracker"
npm run build                       # your build writes index.html, JS and CSS into dist/
npx @rante/cli pack dist            # writes expense-tracker-1.0.0.rante
```

Upload the `.rante` file in the Rante Portal (Developers > Apps > Hosting) and choose the Rante Storage account it
goes into. Rante checks the package, stores its files under `apps/{id}/{version}/`, and serves each app from its own
origin, `https://{app}.gallerycdn.rante.com`.

**External (you host it).** Register a `manifest.json` whose `entryPoint` is your HTTPS address. Rante opens it in a
sandboxed frame. See [examples/hello-external](examples/hello-external).

Either way, your app's page uses the SDK:

```html
<script src="rante-sdk.js"></script>
<script src="app.js"></script>
```

```js
const host = await Rante.init();
const user = await Rante.getUser();           // permission "user.read"
const tenant = await Rante.getTenant();       // permission "tenant.read"
const { token } = await Rante.getAccessToken(); // permission "auth.token": send it to your API
```

## Documentation

- [manifest.json](docs/manifest.md): every field and permission.
- [The .rante package format](docs/package-format.md): the layout, the limits, and the checks Rante runs on uploads.
- [The protocol](docs/protocol.md): the handshake, requests, events and error codes between your frame and Rante.
- [Security model](docs/security.md): per-app origins, the sandbox, the Content-Security-Policy, what an app can
  and cannot reach.
- [App access tokens](docs/tokens.md): the token `Rante.getAccessToken()` returns, and how your API checks it.
- [JSON Schema for manifest.json](schema/manifest.schema.json).
- Examples: [hello-bundle](examples/hello-bundle) (a complete static app) and
  [hello-external](examples/hello-external).

## Developing this repository

Node.js 20 or later; there is nothing to install.

```bash
npm test
npm run pack:example
```

## License

[MIT](LICENSE). Report security problems privately as described in [SECURITY.md](SECURITY.md).

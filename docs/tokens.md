# App access tokens

`Rante.getAccessToken()` gives your frontend a token for the signed-in person. Send it to your API in an
`Authorization: Bearer` header; your API checks it before trusting anything in it. The server SDKs do those checks:

| Language | Repository |
|---|---|
| Node.js | [rante-apps-sdk-node](https://github.com/rante-corporation/rante-apps-sdk-node) |
| Python | [rante-apps-sdk-python](https://github.com/rante-corporation/rante-apps-sdk-python) |
| .NET | [rante-apps-sdk-dotnet](https://github.com/rante-corporation/rante-apps-sdk-dotnet) |
| Java | [rante-apps-sdk-java](https://github.com/rante-corporation/rante-apps-sdk-java) |
| Go | [rante-apps-sdk-go](https://github.com/rante-corporation/rante-apps-sdk-go) |
| PHP | [rante-apps-sdk-php](https://github.com/rante-corporation/rante-apps-sdk-php) |

All six pass the same cases, [conformance/tokens.json](../conformance/tokens.json).

## The token

A JSON Web Token signed by login.rante.com with RS256. Its keys are at the `jwks_uri` of
`https://login.rante.com/common/v2.0/.well-known/openid-configuration`.

| Claim | Value |
|---|---|
| `iss` | `https://login.rante.com/{tid}/v2.0` |
| `aud` | your app's Application (client) ID |
| `tid` | the tenant the person is working in (a GUID) |
| `oid` | the person's object ID in that tenant (a GUID) |
| `sub` | the person's subject for your app: stable, and different for every app |
| `azp` | the client that asked for the token on the person's behalf (the Rante Portal) |
| `idtyp` | `user` |
| `ver` | `2.0` |
| `name` | the person's display name (with the `user.read` permission) |
| `preferred_username`, `email` | the person's email address (with `user.email`) |
| `scp` | the permissions the tenant granted your app, separated by spaces, e.g. `user.read tenant.read auth.token` |
| `iat`, `nbf`, `exp` | issued, valid from, expires; tokens live 15 minutes |

## Checks

A token is accepted only when all of these hold:

1. It is a JWS in compact form whose `alg` is RS256 (or another algorithm you allowed: RS256 and ES256 only; never
   `none` or HMAC), and its `kid` names a key in the JWKS. An unknown `kid` makes the SDK fetch the keys again,
   at most once per cooldown period, so key rotation needs no restart.
2. The signature verifies with that key.
3. `aud` is your client ID (or contains it, when it is an array). GUIDs are compared without regard to case.
4. `tid` is a GUID and `iss` is exactly `{authority}/{tid}/v2.0`, where the authority is `https://login.rante.com`.
5. `exp` is present and in the future, `nbf` and `iat` (when present) are not in the future, each with 60 seconds of
   clock skew by default.
6. `oid` is a GUID, and `idtyp`, when present, is `user`.
7. Optional: `tid` is one of the tenants you allow, and `scp` contains every scope you require.

## Errors

The same codes in every language:

| Code | HTTP | Meaning |
|---|---|---|
| `missing_token` | 401 | no token was sent |
| `invalid_token` | 401 | the token is malformed, signed wrongly, for another app or issuer, or missing a claim |
| `token_expired` | 401 | `exp` has passed |
| `tenant_not_allowed` | 403 | the token is valid but its tenant is not in your list |
| `insufficient_scope` | 403 | the token lacks a scope you require |
| `discovery_failed` | 503 | the OpenID configuration could not be read |
| `network_error` | 503 | the signing keys could not be fetched |
| `invalid_configuration` | 500 | the verifier's options are wrong (for example the client ID is not a GUID) |

For 401 answers the SDKs give a `WWW-Authenticate: Bearer error="invalid_token"` value (RFC 6750); for
`insufficient_scope`, `Bearer error="insufficient_scope", scope="..."`.

## Frames

An external app's pages should also send `Content-Security-Policy: frame-ancestors https://portal.rante.com`, so that
only Rante can frame them. Every server SDK has that value as a constant.

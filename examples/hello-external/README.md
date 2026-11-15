# An external (developer-hosted) app

An external app runs on your own HTTPS server. You register only its `manifest.json` in the Rante Portal
(Developers > Apps > Hosting); Rante opens `entryPoint` in a sandboxed frame on My apps.

```bash
npx @rante/cli validate manifest.json
```

## What your page needs

1. **Allow Rante to frame it, and nobody else:**

   ```
   Content-Security-Policy: frame-ancestors https://portal.rante.com
   ```

   Without this header, other sites could frame your page. With `X-Frame-Options: DENY` or
   `frame-ancestors 'none'`, Rante cannot show it.

2. **The SDK**, from npm (`npm install @rante/sdk`) or as a file you serve yourself:

   ```js
   import Rante from '@rante/sdk';

   const host = await Rante.init({ appId: '3f2b8c1e-7d4a-4e9b-a6c5-1d2e3f4a5b6c' });
   const { token } = await Rante.getAccessToken();
   const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
   ```

3. **Tokens, not cookies.** Inside Rante your page is a third-party frame, so browsers block or partition cookies
   your server sets there. Send the token from `Rante.getAccessToken()` to your API instead.

4. **Check every token on your server** before trusting it: the signature (keys from the `jwks_uri` of
   `https://login.rante.com/common/v2.0/.well-known/openid-configuration`), `iss`, `aud` (your app's client ID),
   `exp`, and `tid` (the customer's tenant). With [jose](https://github.com/panva/jose) for Node.js:

   ```js
   import { createRemoteJWKSet, jwtVerify } from 'jose';

   const discovery = await (await fetch('https://login.rante.com/common/v2.0/.well-known/openid-configuration')).json();
   const keys = createRemoteJWKSet(new URL(discovery.jwks_uri));

   export async function verifyRanteToken(token) {
     const { payload } = await jwtVerify(token, keys, { audience: process.env.RANTE_CLIENT_ID });
     if (!/^https:\/\/login\.rante\.com\/[^/]+\/v2\.0$/.test(payload.iss)) throw new Error('Unexpected issuer');
     return payload; // payload.tid is the tenant, payload.oid the person
   }
   ```

5. **Stay on one origin.** The host talks only to the origin of `entryPoint`. If your page redirects to another
   origin (an identity provider, say), the SDK reconnects when it comes back.

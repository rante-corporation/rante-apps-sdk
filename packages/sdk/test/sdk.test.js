'use strict';
// Tests the SDK (app side) against the reference host bridge, in two fake windows that deliver postMessage the way
// browsers do: asynchronously, with origin and source set by the sender, dropped when the target origin differs,
// and with transferred MessagePorts (Node's real MessageChannel).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Rante = require('../rante-sdk.js');
const RanteHost = require('../rante-host.js');

const HOST_ORIGIN = 'https://portal.rante.com';
const APP_ORIGIN = 'https://3f2b8c1e7d4a4e9ba6c51d2e3f4a5b6c.gallerycdn.rante.com';
const APP = { id: '3f2b8c1e-7d4a-4e9b-a6c5-1d2e3f4a5b6c', version: '1.0.0' };

class FakeWindow {
  constructor(origin) {
    this.origin = origin;
    this.listeners = new Set();
    this.parent = this;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.setInterval = setInterval;
    this.clearInterval = clearInterval;
    this.crypto = globalThis.crypto;
    this.MessageChannel = MessageChannel;
    this.sent = [];
  }
  addEventListener(type, fn) { if (type === 'message') this.listeners.add(fn); }
  removeEventListener(type, fn) { if (type === 'message') this.listeners.delete(fn); }
  deliver(data, origin, source, ports) {
    const event = { data: structuredClone(data), origin, source, ports: ports || [] };
    setImmediate(() => { for (const fn of Array.from(this.listeners)) fn(event); });
  }
}

/** Puts appWin in an iframe of hostWin. Returns the host's view of the iframe ({ contentWindow }). */
function frame(hostWin, appWin) {
  const hostAsSeenByApp = {
    postMessage(data, targetOrigin, transfer) {
      appWin.sent.push({ data, targetOrigin });
      if (targetOrigin !== '*' && targetOrigin !== hostWin.origin) return; // a browser drops it
      hostWin.deliver(data, appWin.origin, appAsSeenByHost, transfer);
    }
  };
  const appAsSeenByHost = {
    postMessage(data, targetOrigin, transfer) {
      if (targetOrigin !== '*' && targetOrigin !== appWin.origin) return;
      appWin.deliver(data, hostWin.origin, hostAsSeenByApp, transfer);
    }
  };
  appWin.parent = hostAsSeenByApp;
  return { contentWindow: appAsSeenByHost };
}

function setup(t, options) {
  options = options || {};
  const hostWin = new FakeWindow(options.hostOrigin || HOST_ORIGIN);
  const appWin = new FakeWindow(options.appOrigin || APP_ORIGIN);
  const iframe = frame(hostWin, appWin);
  const events = [];
  const bridge = RanteHost.createBridge(Object.assign({
    window: hostWin,
    frame: iframe,
    appOrigin: options.appOrigin || APP_ORIGIN,
    app: APP,
    permissions: ['user.read', 'tenant.read'],
    host: { name: 'portal', version: '2026.11' },
    handlers: {
      'context.get': () => ({
        locale: 'en-GB',
        user: { id: 'u-1', displayName: 'Ada Lovelace', email: 'ada@example.com' },
        tenant: { id: 't-1', name: 'Contoso Ltd' }
      })
    },
    onEvent: (type, detail) => events.push({ type, detail })
  }, options.bridge));
  const sdk = Rante.create(appWin);
  t.after(() => {
    sdk.disconnect();
    bridge.dispose();
  });
  return { hostWin, appWin, bridge, sdk, events };
}

test('connects, hands over the granted permissions and says ready', async (t) => {
  const { sdk, events } = setup(t);
  const info = await sdk.init();
  assert.equal(info.host.name, 'portal');
  assert.deepEqual(info.app, APP);
  assert.deepEqual(info.permissions, ['user.read', 'tenant.read']);
  assert.ok(info.capabilities.includes('context.get'));
  assert.ok(!info.capabilities.includes('auth.getToken'));
  assert.equal(sdk.isConnected(), true);
  assert.equal(sdk.hasPermission('user.read'), true);
  assert.equal(sdk.hasPermission('auth.token'), false);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(events.some((e) => e.type === 'connected'));
  assert.ok(events.some((e) => e.type === 'ready'));
});

test('init returns the same promise when called twice', async (t) => {
  const { sdk } = setup(t);
  const a = sdk.init();
  const b = sdk.init();
  assert.equal(a, b);
  await a;
});

test('never posts to "*": hello goes only to the allowed host origins', async (t) => {
  const { sdk, appWin } = setup(t);
  await sdk.init();
  assert.ok(appWin.sent.length > 0);
  for (const m of appWin.sent) assert.equal(m.targetOrigin, HOST_ORIGIN);
});

test('reads the user and tenant, filtered by the granted permissions', async (t) => {
  const { sdk } = setup(t);
  await sdk.init();
  const ctx = await sdk.getContext();
  assert.equal(ctx.locale, 'en-GB');
  assert.deepEqual(ctx.user, { id: 'u-1', displayName: 'Ada Lovelace' }); // no user.email permission: no email
  assert.deepEqual(await sdk.getTenant(), { id: 't-1', name: 'Contoso Ltd' });
  assert.deepEqual(await sdk.getUser(), { id: 'u-1', displayName: 'Ada Lovelace' });
});

test('the email needs user.email; the tenant needs tenant.read', async (t) => {
  const { sdk } = setup(t, { bridge: { permissions: ['user.read', 'user.email'] } });
  await sdk.init();
  const ctx = await sdk.getContext();
  assert.equal(ctx.user.email, 'ada@example.com');
  assert.equal(ctx.tenant, undefined);
  await assert.rejects(sdk.getTenant(), { code: 'permission_denied' });
});

test('the host refuses what was not granted, even when the app skips the SDK check', async (t) => {
  const { sdk, events } = setup(t, {
    bridge: { handlers: { 'auth.getToken': () => ({ token: 'should-not-leak', expiresOn: Date.now() + 3600000 }) } }
  });
  await sdk.init();
  await assert.rejects(sdk.getAccessToken(), { code: 'permission_denied' }); // the SDK's own check
  await assert.rejects(sdk.request('auth.getToken', {}), { code: 'permission_denied' }); // the host's check
  assert.ok(events.some((e) => e.type === 'rejected' && e.detail.method === 'auth.getToken'));
});

test('access tokens are returned and cached until close to expiry', async (t) => {
  let calls = 0;
  const { sdk } = setup(t, {
    bridge: {
      permissions: ['auth.token'],
      handlers: { 'auth.getToken': () => { calls++; return { token: `jwt-${calls}`, expiresOn: Date.now() + 3600000, extra: 'dropped' }; } }
    }
  });
  await sdk.init();
  const first = await sdk.getAccessToken();
  assert.equal(first.token, 'jwt-1');
  assert.deepEqual(Object.keys(first).sort(), ['expiresOn', 'token']);
  assert.equal((await sdk.getAccessToken()).token, 'jwt-1');
  assert.equal((await sdk.getAccessToken({ forceRefresh: true })).token, 'jwt-2');
  assert.equal(calls, 2);
});

test('notifications, navigation, resize and title reach the host', async (t) => {
  const shown = [];
  const opened = [];
  const { sdk, events } = setup(t, {
    bridge: {
      permissions: ['notifications', 'navigation'],
      handlers: {
        'notifications.show': (p) => { shown.push(p); },
        'navigation.open': (p) => { opened.push(p); }
      }
    }
  });
  await sdk.init();
  await sdk.notify('Saved', { kind: 'success' });
  await sdk.openUrl('https://contoso.example/help');
  await sdk.resize(640);
  await sdk.setTitle('Expenses');
  assert.deepEqual(shown, [{ message: 'Saved', kind: 'success' }]);
  assert.deepEqual(opened, [{ url: 'https://contoso.example/help', target: 'blank' }]);
  assert.ok(events.some((e) => e.type === 'resize' && e.detail.height === 640));
  assert.ok(events.some((e) => e.type === 'title' && e.detail.title === 'Expenses'));
  await assert.rejects(sdk.openUrl('javascript:alert(1)'), { code: 'invalid_request' });
  await assert.rejects(sdk.notify(''), { code: 'invalid_request' });
  await assert.rejects(sdk.request('notifications.show', { message: 'x', kind: 'shout' }), { code: 'invalid_request' });
});

test('unknown methods are not supported; malformed method names never leave the app', async (t) => {
  const { sdk } = setup(t);
  await sdk.init();
  await assert.rejects(sdk.request('files.delete', {}), { code: 'not_supported' });
  await assert.rejects(sdk.request('../../x', {}), { code: 'invalid_request' });
});

test('host errors keep known codes and hide internal messages', async (t) => {
  const { sdk } = setup(t, {
    bridge: {
      permissions: ['auth.token', 'notifications'],
      handlers: {
        'auth.getToken': () => { const e = new Error('Sign-in needed'); e.code = 'unavailable'; throw e; },
        'notifications.show': () => { throw new Error('SQL timeout at db-7 (internal)'); }
      }
    }
  });
  await sdk.init();
  await assert.rejects(sdk.getAccessToken(), { code: 'unavailable', message: 'Sign-in needed' });
  await assert.rejects(sdk.notify('hi'), (err) => err.code === 'host_error' && !/db-7/.test(err.message));
});

test('theme and context events reach the app', async (t) => {
  const { sdk, bridge } = setup(t);
  await sdk.init();
  const seen = [];
  const unsubscribe = sdk.on('theme.changed', (e) => seen.push(e.theme));
  sdk.on('context.changed', () => seen.push('context'));
  bridge.setTheme('dark');
  bridge.notifyContextChanged();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, ['dark', 'context']);
  assert.equal(sdk.getHostInfo().theme, 'dark');
  unsubscribe();
  bridge.setTheme('light');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, ['dark', 'context']);
});

test('the SDK ignores connect messages from other origins or windows', async (t) => {
  const hostWin = new FakeWindow('https://evil.example');
  const appWin = new FakeWindow(APP_ORIGIN);
  frame(hostWin, appWin);
  // A hostile parent answers every hello with a connect message.
  hostWin.addEventListener('message', (event) => {
    const channel = new MessageChannel();
    channel.port1.close();
    event.source.postMessage({ rante: 1, type: 'connect', nonce: event.data.nonce }, '*', [channel.port2]);
  });
  const sdk = Rante.create(appWin);
  t.after(() => sdk.disconnect());
  // The hello is addressed to portal.rante.com only, so the hostile parent never even receives it.
  await assert.rejects(sdk.init({ timeoutMs: 300 }), { code: 'timeout' });
  assert.equal(appWin.sent.every((m) => m.targetOrigin === HOST_ORIGIN), true);

  // Even a connect pushed unasked (wrong nonce, wrong origin) is ignored.
  const sdk2 = Rante.create(appWin);
  t.after(() => sdk2.disconnect());
  const pending = sdk2.init({ timeoutMs: 300 });
  const channel = new MessageChannel();
  t.after(() => channel.port1.close());
  appWin.deliver({ rante: 1, type: 'connect', nonce: 'guess' }, 'https://evil.example', appWin.parent, [channel.port2]);
  appWin.deliver({ rante: 1, type: 'connect', nonce: 'guess' }, HOST_ORIGIN, {}, [channel.port2]);
  await assert.rejects(pending, { code: 'timeout' });
});

test('the host ignores hello messages from other frames, other origins or another app', async (t) => {
  const { sdk, bridge, appWin, hostWin, events } = setup(t);
  // Another iframe on the same host page, with a different origin.
  const intruder = new FakeWindow('https://other-app.gallerycdn.rante.com');
  frame(hostWin, intruder);
  const sdkIntruder = Rante.create(intruder);
  t.after(() => sdkIntruder.disconnect());
  await assert.rejects(sdkIntruder.init({ timeoutMs: 300 }), { code: 'timeout' });
  assert.equal(bridge.isConnected(), false);

  await assert.rejects(Rante.create(appWin).init({ appId: '00000000-1111-2222-3333-444444444444', timeoutMs: 300 }), { code: 'timeout' });
  assert.ok(events.some((e) => e.type === 'rejected' && e.detail.reason === 'app_mismatch'));
  await sdk.init({ appId: APP.id.toUpperCase() });
  assert.equal(bridge.isConnected(), true);
});

test('rate limits a flood of requests', async (t) => {
  let now = 1000;
  const { sdk } = setup(t, { bridge: { maxRequestsPerSecond: 5, now: () => now } });
  await sdk.init(); // init sends frame.ready: request 1 of this second
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => sdk.getContext()));
  const limited = results.filter((r) => r.status === 'rejected' && r.reason.code === 'rate_limited');
  assert.equal(limited.length, 4);
  now += 1000;
  await sdk.getContext();
});

test('init fails fast outside an iframe, and validates hostOrigins', async () => {
  const lonely = new FakeWindow(APP_ORIGIN);
  await assert.rejects(Rante.create(lonely).init(), { code: 'not_in_host' });
  const appWin = new FakeWindow(APP_ORIGIN);
  frame(new FakeWindow(HOST_ORIGIN), appWin);
  await assert.rejects(Rante.create(appWin).init({ hostOrigins: ['*'] }), { code: 'invalid_request' });
  await assert.rejects(Rante.create(appWin).init({ hostOrigins: ['http://portal.rante.com'] }), { code: 'invalid_request' });
  await assert.rejects(Rante.create(appWin).init({ hostOrigins: [] }), { code: 'invalid_request' });
});

test('calls before init are refused', async () => {
  const appWin = new FakeWindow(APP_ORIGIN);
  const sdk = Rante.create(appWin);
  await assert.rejects(sdk.getContext(), { code: 'not_connected' });
  await assert.rejects(sdk.getUser(), { code: 'not_connected' });
});

test('a new page load replaces the previous connection', async (t) => {
  const { appWin, bridge } = setup(t);
  const first = Rante.create(appWin);
  t.after(() => first.disconnect());
  await first.init();
  const second = Rante.create(appWin);
  t.after(() => second.disconnect());
  await second.init();
  assert.equal(bridge.isConnected(), true);
  await second.getContext();
  await assert.rejects(first.request('context.get', {}, { timeoutMs: 200 }), { code: 'timeout' });
});

test('the module export works without a browser window', async () => {
  assert.equal(typeof Rante.version, 'string');
  assert.equal(Rante.PROTOCOL_VERSION, 1);
  await assert.rejects(Rante.init(), { code: 'not_in_host' });
  assert.equal(Rante.isConnected(), false);
});

test('frameAttributes: bundle apps get no allow-same-origin', () => {
  const bundle = RanteHost.frameAttributes({ hosting: 'bundle', permissions: ['clipboard.write'] });
  assert.ok(!bundle.sandbox.split(' ').includes('allow-same-origin'));
  assert.ok(bundle.sandbox.split(' ').includes('allow-scripts'));
  assert.equal(bundle.allow, 'clipboard-write');
  const external = RanteHost.frameAttributes({ hosting: 'external' });
  assert.ok(external.sandbox.split(' ').includes('allow-same-origin'));
  assert.equal(external.allow, '');
  assert.ok(!external.sandbox.includes('allow-top-navigation'));
});

test('createBridge validates its options', () => {
  const win = new FakeWindow(HOST_ORIGIN);
  const base = { window: win, frame: { contentWindow: {} }, app: APP, permissions: [] };
  assert.throws(() => RanteHost.createBridge(Object.assign({}, base, { appOrigin: '*' })), TypeError);
  assert.throws(() => RanteHost.createBridge(Object.assign({}, base, { appOrigin: 'https://app.example.com/path' })), TypeError);
  assert.throws(() => RanteHost.createBridge(Object.assign({}, base, { appOrigin: 'http://localhost:5173' })), TypeError);
  const dev = RanteHost.createBridge(Object.assign({}, base, { appOrigin: 'http://localhost:5173', allowDevelopmentOrigin: true }));
  dev.dispose();
});

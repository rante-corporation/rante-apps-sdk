/*! Rante Apps host bridge 0.1.0 - https://github.com/rante-corporation/rante-apps-sdk - MIT License
 * The host side of the Rante Apps protocol (docs/protocol.md): the page that embeds an app's iframe answers the app's
 * requests here. This is the reference implementation Rante's own pages use, and what the SDK is tested against.
 * Every request is checked against the permissions the tenant granted, whatever the app claims.
 *
 *   const bridge = RanteHost.createBridge({
 *     window, frame: iframeElement, appOrigin: 'https://<label>.gallerycdn.rante.com',
 *     app: { id, version }, permissions: ['user.read'], host: { name: 'portal' },
 *     handlers: { 'context.get': () => ({ user: {...}, tenant: {...} }) },
 *     onEvent: (type, detail) => { ... }   // connected, ready, resize, title, rejected
 *   });
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root && root.document && !root.RanteHost) root.RanteHost = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '0.1.0';
  var PROTOCOL_VERSION = 1;
  var APP_ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/;
  var DEV_APP_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
  var ERROR_CODES = ['permission_denied', 'not_supported', 'invalid_request', 'rate_limited', 'unavailable', 'host_error'];
  var NOTIFICATION_KINDS = ['info', 'success', 'warning', 'error'];

  /** Which permission each method needs. Methods not listed here need none. */
  var METHOD_SCOPES = {
    'auth.getToken': 'auth.token',
    'notifications.show': 'notifications',
    'navigation.open': 'navigation'
  };
  var FRAME_METHODS = ['frame.ready', 'frame.resize', 'frame.setTitle'];
  var HANDLED_METHODS = ['context.get', 'auth.getToken', 'notifications.show', 'navigation.open'];

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function hostError(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  /** Validates a request's params. Returns an error message, or null when they are acceptable. */
  function paramsProblem(method, params) {
    if (!isObject(params)) return 'params must be an object.';
    switch (method) {
      case 'frame.resize':
        return typeof params.height === 'number' && params.height >= 0 && params.height <= 100000 ? null : 'height must be 0 to 100000.';
      case 'frame.setTitle':
        return typeof params.title === 'string' && params.title.length <= 100 ? null : 'title must be a string of at most 100 characters.';
      case 'notifications.show':
        if (typeof params.message !== 'string' || params.message.length === 0 || params.message.length > 500) return 'message must be 1 to 500 characters.';
        return NOTIFICATION_KINDS.indexOf(params.kind) >= 0 ? null : 'kind must be info, success, warning or error.';
      case 'navigation.open':
        if (typeof params.url !== 'string' || params.url.length > 2048 || !/^https:\/\//.test(params.url)) return 'url must be an https:// address.';
        return params.target === 'blank' || params.target === 'self' ? null : 'target must be blank or self.';
      default:
        return null;
    }
  }

  /** Only what the granted permissions allow leaves the host, whatever the handler returned. */
  function filterContext(ctx, granted, defaults) {
    ctx = isObject(ctx) ? ctx : {};
    var out = { locale: typeof ctx.locale === 'string' ? ctx.locale : defaults.locale, theme: ctx.theme === 'dark' ? 'dark' : defaults.theme };
    var user = isObject(ctx.user) ? ctx.user : null;
    if (user && (granted.indexOf('user.read') >= 0 || granted.indexOf('user.email') >= 0)) {
      out.user = {};
      if (granted.indexOf('user.read') >= 0) {
        out.user.id = typeof user.id === 'string' ? user.id : undefined;
        out.user.displayName = typeof user.displayName === 'string' ? user.displayName : undefined;
      }
      if (granted.indexOf('user.email') >= 0 && typeof user.email === 'string') out.user.email = user.email;
    }
    var tenant = isObject(ctx.tenant) ? ctx.tenant : null;
    if (tenant && granted.indexOf('tenant.read') >= 0) {
      out.tenant = { id: typeof tenant.id === 'string' ? tenant.id : undefined, name: typeof tenant.name === 'string' ? tenant.name : undefined };
    }
    return out;
  }

  /**
   * Connects the host page to one app iframe.
   * @param {object} options see the header comment and rante-host.d.ts
   */
  function createBridge(options) {
    if (!isObject(options)) throw new TypeError('createBridge needs options.');
    var win = options.window;
    var frame = options.frame;
    var appOrigin = options.appOrigin;
    if (!win || typeof win.addEventListener !== 'function') throw new TypeError('options.window must be the host window.');
    if (!frame) throw new TypeError('options.frame must be the app iframe (or an object with contentWindow).');
    if (typeof appOrigin !== 'string' || !(APP_ORIGIN.test(appOrigin) || (options.allowDevelopmentOrigin && DEV_APP_ORIGIN.test(appOrigin)))) {
      throw new TypeError('options.appOrigin must be the app\'s exact origin, such as https://app.example.com.');
    }
    var MessageChannelImpl = options.MessageChannel || win.MessageChannel || (typeof MessageChannel !== 'undefined' ? MessageChannel : null);
    if (!MessageChannelImpl) throw new TypeError('MessageChannel is not available.');

    var app = isObject(options.app) ? { id: options.app.id, version: options.app.version } : {};
    var granted = Array.isArray(options.permissions) ? options.permissions.filter(function (p) { return typeof p === 'string'; }) : [];
    var host = isObject(options.host) ? { name: options.host.name || 'rante', version: options.host.version || VERSION } : { name: 'rante', version: VERSION };
    var handlers = isObject(options.handlers) ? options.handlers : {};
    var onEvent = typeof options.onEvent === 'function' ? options.onEvent : function () {};
    var maxPerSecond = typeof options.maxRequestsPerSecond === 'number' ? options.maxRequestsPerSecond : 20;
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var locale = typeof options.locale === 'string' ? options.locale : 'en-US';
    var theme = options.theme === 'dark' ? 'dark' : 'light';

    var capabilities = FRAME_METHODS.concat(HANDLED_METHODS.filter(function (m) { return typeof handlers[m] === 'function'; }));
    var port = null;
    var disposed = false;
    var windowStart = 0;
    var windowCount = 0;

    function emit(type, detail) {
      try {
        onEvent(type, detail || {});
      } catch (err) {
        // The host page's own handler failed; the bridge carries on.
      }
    }

    function respond(target, id, result, error) {
      if (target !== port) return; // the connection was replaced meanwhile
      var message = error ? { id: id, error: error } : { id: id, result: result === undefined ? {} : result };
      try {
        target.postMessage(message);
      } catch (err) {
        target.postMessage({ id: id, error: { code: 'host_error', message: 'The host could not send its answer.' } });
      }
    }

    function closePort() {
      if (!port) return;
      port.onmessage = null;
      try {
        port.close();
      } catch (err) {
        // already closed
      }
      port = null;
    }

    function rateLimited() {
      var t = now();
      if (t - windowStart >= 1000) {
        windowStart = t;
        windowCount = 0;
      }
      windowCount++;
      return windowCount > maxPerSecond;
    }

    function onPortMessage(event) {
      var current = port;
      var msg = event && event.data;
      if (!isObject(msg) || typeof msg.id !== 'number' || typeof msg.method !== 'string') return;
      var id = msg.id;
      var method = msg.method;
      var params = msg.params === undefined ? {} : msg.params;

      if (rateLimited()) {
        respond(current, id, null, { code: 'rate_limited', message: 'Too many requests; slow down.' });
        return;
      }
      var scope = METHOD_SCOPES[method];
      if (scope && granted.indexOf(scope) < 0) {
        emit('rejected', { method: method, reason: 'permission_denied' });
        respond(current, id, null, { code: 'permission_denied', message: 'The app does not have the "' + scope + '" permission.' });
        return;
      }
      var problem = paramsProblem(method, params);
      if (problem) {
        respond(current, id, null, { code: 'invalid_request', message: problem });
        return;
      }
      if (FRAME_METHODS.indexOf(method) >= 0) {
        if (method === 'frame.ready') emit('ready', {});
        else if (method === 'frame.resize') emit('resize', { height: Math.ceil(params.height) });
        else emit('title', { title: params.title });
        respond(current, id, {});
        return;
      }
      var handler = HANDLED_METHODS.indexOf(method) >= 0 ? handlers[method] : null;
      if (typeof handler !== 'function') {
        respond(current, id, null, { code: 'not_supported', message: 'This Rante host does not support "' + method + '".' });
        return;
      }
      var context = { app: { id: app.id, version: app.version }, permissions: granted.slice() };
      Promise.resolve()
        .then(function () { return handler(params, context); })
        .then(function (result) {
          if (method === 'context.get') result = filterContext(result, granted, { locale: locale, theme: theme });
          else if (method === 'auth.getToken') {
            if (!isObject(result) || typeof result.token !== 'string' || typeof result.expiresOn !== 'number') {
              throw hostError('host_error', 'The host could not issue a token.');
            }
            result = { token: result.token, expiresOn: result.expiresOn };
          } else result = {};
          respond(current, id, result);
        })
        .catch(function (err) {
          var code = err && ERROR_CODES.indexOf(err.code) >= 0 ? err.code : 'host_error';
          var message = err && typeof err.message === 'string' && code !== 'host_error' ? err.message.slice(0, 300) : 'The host could not complete the request.';
          respond(current, id, null, { code: code, message: message });
        });
    }

    function onWindowMessage(event) {
      if (disposed || !event) return;
      if (event.source !== frame.contentWindow || event.origin !== appOrigin) return;
      var data = event.data;
      if (!isObject(data) || data.rante !== PROTOCOL_VERSION || data.type !== 'hello') return;
      if (typeof data.nonce !== 'string' || data.nonce.length === 0 || data.nonce.length > 128) return;
      if (typeof data.appId === 'string' && typeof app.id === 'string' && data.appId.toLowerCase() !== app.id.toLowerCase()) {
        emit('rejected', { reason: 'app_mismatch', appId: data.appId });
        return;
      }
      // Each page load says hello again: the previous connection is replaced.
      closePort();
      var channel = new MessageChannelImpl();
      port = channel.port1;
      port.onmessage = onPortMessage;
      frame.contentWindow.postMessage({
        rante: PROTOCOL_VERSION,
        type: 'connect',
        nonce: data.nonce,
        protocol: PROTOCOL_VERSION,
        host: host,
        app: app,
        permissions: granted.slice(),
        capabilities: capabilities.slice(),
        locale: locale,
        theme: theme
      }, appOrigin, [channel.port2]);
      emit('connected', { sdk: typeof data.sdk === 'string' ? data.sdk.slice(0, 20) : undefined });
    }

    function sendEvent(name, data) {
      if (!port) return false;
      port.postMessage({ event: name, data: data || {} });
      return true;
    }

    win.addEventListener('message', onWindowMessage);

    return {
      isConnected: function () { return port !== null; },
      setTheme: function (value) {
        theme = value === 'dark' ? 'dark' : 'light';
        return sendEvent('theme.changed', { theme: theme });
      },
      notifyContextChanged: function () {
        return sendEvent('context.changed', {});
      },
      dispose: function () {
        disposed = true;
        win.removeEventListener('message', onWindowMessage);
        closePort();
      }
    };
  }

  /**
   * The iframe attributes Rante uses for an app. Bundle apps (served from gallerycdn.rante.com) get no
   * allow-same-origin: they run in an opaque origin and cannot reach rante.com cookies or storage.
   * @param {{hosting: 'bundle'|'external', permissions?: string[]}} app
   */
  function frameAttributes(app) {
    var sandbox = ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-downloads'];
    if (app && app.hosting === 'external') sandbox.splice(1, 0, 'allow-same-origin');
    var allow = [];
    if (app && Array.isArray(app.permissions) && app.permissions.indexOf('clipboard.write') >= 0) allow.push('clipboard-write');
    return {
      sandbox: sandbox.join(' '),
      allow: allow.join('; '),
      referrerpolicy: 'strict-origin',
      loading: 'eager'
    };
  }

  return {
    version: VERSION,
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    METHOD_SCOPES: METHOD_SCOPES,
    createBridge: createBridge,
    frameAttributes: frameAttributes,
    internals: { filterContext: filterContext, paramsProblem: paramsProblem }
  };
});

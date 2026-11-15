// Hello Rante: connect to the host, greet the signed-in person, follow the theme.
(function () {
  'use strict';

  var greeting = document.getElementById('greeting');
  var tenantLine = document.getElementById('tenant');
  var notifyButton = document.getElementById('notify');
  var errorLine = document.getElementById('error');

  function showError(err) {
    errorLine.hidden = false;
    errorLine.textContent = err && err.code === 'not_in_host'
      ? 'Open this app from My apps in the Rante Portal.'
      : 'Something went wrong: ' + (err && err.message ? err.message : err);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
  }

  Rante.init({ appId: '3f2b8c1e-7d4a-4e9b-a6c5-1d2e3f4a5b6c', autoResize: true })
    .then(function (host) {
      applyTheme(host.theme);
      Rante.on('theme.changed', function (e) { applyTheme(e.theme); });
      Rante.setTitle('Hello Rante').catch(function () {});
      return Promise.all([Rante.getUser(), Rante.getTenant()]);
    })
    .then(function (results) {
      var user = results[0];
      var tenant = results[1];
      greeting.textContent = 'Hello, ' + (user.displayName || 'there') + '!';
      tenantLine.textContent = 'You are working in ' + (tenant.name || 'your organization') + '.';
      if (Rante.hasPermission('notifications')) {
        notifyButton.hidden = false;
        notifyButton.addEventListener('click', function () {
          Rante.notify('Hello from a Rante app!', { kind: 'success' }).catch(showError);
        });
      }
    })
    .catch(showError);
})();

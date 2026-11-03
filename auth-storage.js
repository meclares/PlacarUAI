(function () {
  'use strict';

  var config = window.PLACARUAI_SUPABASE_CONFIG || {};
  var preferenceKey = 'placaruai.auth.remember.v1';
  var projectMatch = typeof config.url === 'string'
    ? /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i.exec(config.url)
    : null;
  var projectRef = projectMatch ? projectMatch[1] : '';
  var tokenKey = projectRef ? 'sb-' + projectRef + '-auth-token' : '';

  function isRemembered() {
    return window.localStorage.getItem(preferenceKey) !== 'false';
  }

  function setRemembered(remember) {
    var persistentStorage = window.localStorage;
    var temporaryStorage = window.sessionStorage;
    var selectedStorage = remember ? persistentStorage : temporaryStorage;
    var fallbackStorage = remember ? temporaryStorage : persistentStorage;
    var existingToken = tokenKey
      ? selectedStorage.getItem(tokenKey) || fallbackStorage.getItem(tokenKey)
      : null;

    if (existingToken && tokenKey) selectedStorage.setItem(tokenKey, existingToken);
    if (tokenKey) fallbackStorage.removeItem(tokenKey);
    persistentStorage.setItem(preferenceKey, remember ? 'true' : 'false');
  }

  var storage = {
    getItem: function (key) {
      var selectedStorage = isRemembered() ? window.localStorage : window.sessionStorage;
      var fallbackStorage = isRemembered() ? window.sessionStorage : window.localStorage;
      var value = selectedStorage.getItem(key);
      if (value !== null) return value;
      value = fallbackStorage.getItem(key);
      if (value !== null) {
        selectedStorage.setItem(key, value);
        fallbackStorage.removeItem(key);
      }
      return value;
    },
    setItem: function (key, value) {
      var selectedStorage = isRemembered() ? window.localStorage : window.sessionStorage;
      var fallbackStorage = isRemembered() ? window.sessionStorage : window.localStorage;
      selectedStorage.setItem(key, value);
      fallbackStorage.removeItem(key);
    },
    removeItem: function (key) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    },
  };

  window.placaruaiAuthStorage = {
    isRemembered: isRemembered,
    setRemembered: setRemembered,
    storage: storage,
  };
})();

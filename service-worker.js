'use strict';

var CACHE_NAME = 'placaruai-app-v1';
var APP_SHELL = [
  './PlacarUai.html',
  './manifest.webmanifest',
  './favicon.svg',
  './assets/placaruai-icon-192.png',
  './assets/placaruai-icon-512.png',
  './assets/placaruai-icon.svg',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (key) {
          return key.indexOf('placaruai-app-') === 0 && key !== CACHE_NAME;
        }).map(function (key) { return caches.delete(key); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          return cache.put(request, copy);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (response) {
        return response || caches.match('./PlacarUai.html');
      });
    })
  );
});

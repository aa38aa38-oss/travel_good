/* 離線快取：App 本體與導覽內容預先快取；地圖圖磚看過的才快取 */
var VERSION = 'v2';
var SHELL = 'guide-shell-' + VERSION, TILES = 'guide-tiles';
var FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/data-a.js', 'js/data-b.js', 'js/data-c.js', 'js/data-d.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('guide-shell-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var isTile = /tile\.openstreetmap\.org$|arcgisonline\.com$/.test(url.hostname);
  if (isTile) {
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res.ok) { c.put(req, res.clone()); trim(c); }
          return res;
        });
      });
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // 本站檔案：先連網拿最新版，失敗才用快取（確保內容更新後看得到）
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); }); }));
});
var trimming = false;
function trim(c) {
  if (trimming) return; trimming = true;
  c.keys().then(function (ks) {
    var over = ks.length - 1500, jobs = [];
    for (var i = 0; i < over; i++) jobs.push(c.delete(ks[i]));
    return Promise.all(jobs);
  }).then(function () { trimming = false; }, function () { trimming = false; });
}

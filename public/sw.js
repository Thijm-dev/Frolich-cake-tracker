// Minimal service worker: makes the app installable and loads the shell
// if the Wi-Fi blips. Always tries the network first so nothing is stale.
const CACHE = 'cake-tracker-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'supabase.js', 'manifest.webmanifest', 'icons/icon.svg'];
const SHELL_URLS = SHELL.map((p) => new URL(p, self.registration.scope).href);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !SHELL_URLS.includes(e.request.url.split('?')[0])) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});

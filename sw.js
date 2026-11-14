/* Service worker: caches the app shell only. Audio is NEVER intercepted or cached. */
const VERSION = 'vmwg7imnj';
const CACHE = 'podcast-shell-' + VERSION;
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'site.json', 'episodes.json', 'manifest.webmanifest',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png'
];
const AUDIO_RE = /\.(mp3|m4a|m4b|aac|mp4|wav|ogg|oga|opus|flac|webm)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('podcast-shell-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res) {
  if (res && res.ok && res.status === 200 && res.type !== 'opaque') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

function networkFirst(req) {
  return fetch(req).then((res) => put(req, res)).catch(() =>
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('index.html').then((h) => h || caches.match('./'));
      return Response.error();
    })
  );
}

function cacheFirst(req) {
  return caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // R2 / other origins: straight to network
  if (req.headers.has('range')) return;                            // Range requests: never touch
  if (req.destination === 'audio' || req.destination === 'video' || AUDIO_RE.test(url.pathname)) return;

  const fresh = req.mode === 'navigate' || url.pathname.endsWith('/') || /\.(json|webmanifest|html|js|css)$/i.test(url.pathname);
  event.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});

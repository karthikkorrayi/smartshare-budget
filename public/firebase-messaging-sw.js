/* SmartShare Budget — service worker.
 * 1) Web push (Firebase Cloud Messaging): shows notifications while the app is closed; tapping one
 *    opens the app at the right page. The config is the same public web config as environment.ts.
 * 2) PWA: makes the app installable and gives it an offline fallback. Pages are network-first (so a
 *    new deploy is picked up straight away); hashed JS/CSS/fonts/icons are cache-first.
 *    Firestore / Auth / Google API traffic is never cached.
 * One worker handles both because a scope can only have one service worker. */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBNGnXXho0kHwmEUTFJKtM5rMeNzLckWB8',
  authDomain: 'mybudgetapp-54c43.firebaseapp.com',
  projectId: 'mybudgetapp-54c43',
  storageBucket: 'mybudgetapp-54c43.firebasestorage.app',
  messagingSenderId: '231457872788',
  appId: '1:231457872788:web:4fabec01905c59479a0d81',
});

// Messages with a `notification` payload are displayed automatically by the SDK,
// and fcmOptions.link opens the app on tap.
firebase.messaging();

// ── PWA caching ─────────────────────────────────────────────────
const VERSION = 'ssb-v2';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const PRECACHE = ['./', 'index.html', 'offline.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'favicon.ico'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('ssb-') && !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isAsset = url =>
  /\.(?:js|css|woff2?|ttf|png|svg|ico|webmanifest)$/.test(url.pathname) ||
  url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // App pages: network first, fall back to the cached shell, then the offline page.
  if (req.mode === 'navigate' && sameOrigin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put('index.html', copy)).catch(() => undefined);
          return res;
        })
        .catch(async () => (await caches.match('index.html', { ignoreSearch: true })) || (await caches.match('offline.html')) || Response.error())
    );
    return;
  }

  // Static, versioned files: cache first, refresh in the background.
  if ((sameOrigin || url.hostname.startsWith('fonts.')) && isAsset(url)) {
    event.respondWith(
      caches.open(ASSETS).then(async cache => {
        const hit = await cache.match(req);
        const net = fetch(req)
          .then(res => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => undefined);
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
  }
  // Everything else (Firestore, Auth, Cloud Functions, Gmail) goes straight to the network.
});

const CACHE_NAME = 'fee-tracker-v11';
const IMAGE_CACHE_NAME = 'fee-tracker-images-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './official.html',
  './student.html',
  './styles/main.css',
  './scripts/shared/session-guard.js',
  './scripts/shared/app-common.js',
  './scripts/pages/index-page.js',
  './scripts/pages/official-page.js',
  './scripts/pages/student-page.js',
  './config/firebase-config.js',
  './config/app-config.js',
  './config/version.js',
  './manifest.json',
  './assets/images/logo.png'
];

const SENSITIVE_ROUTE_SUFFIXES = [
  '/admin.html',
  '/collection.html',
  '/scripts/pages/admin-page.js',
  '/scripts/pages/collection-page.js',
  '/scripts/pages/student-page.js',
  '/student.html',
  '/scripts/shared/session-guard.js',
  '/scripts/shared/app-common.js'
];

const isSensitiveRequest = (url) => SENSITIVE_ROUTE_SUFFIXES.some((suffix) => url.pathname.endsWith(suffix));
const isSameOrigin = (url) => url.origin === self.location.origin;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    self.skipWaiting();
    const cache = await caches.open(CACHE_NAME);
    let loadedBytes = 0;
    let totalBytes = 0;
    const clientList = await self.clients.matchAll({ includeUncontrolled: true });
    for (const asset of ASSETS_TO_CACHE) {
      try {
        const response = await fetch(asset, { cache: 'no-cache' });
        if (response && response.ok) {
          const size = Number(response.headers.get('content-length') || 0);
          totalBytes += size;
          loadedBytes += size;
          await cache.put(asset, response.clone());
          clientList.forEach((client) => client.postMessage({ type: 'SW_INSTALL_PROGRESS', loaded: loadedBytes, total: totalBytes }));
        }
      } catch (error) {
        // Ignore single asset fetch failure; existing cache/network fallback remains active.
      }
    }
    clientList.forEach((client) => client.postMessage({ type: 'SW_UPDATE_READY' }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.map((cacheName) => cacheName !== CACHE_NAME ? caches.delete(cacheName) : Promise.resolve())
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  const isImageRequest = event.request.destination === 'image';

  if (isImageRequest) {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then(async (imageCache) => {
        const cachedImage = await imageCache.match(event.request);
        if (cachedImage) return cachedImage;
        try {
          const networkImage = await fetch(event.request);
          if (networkImage && (networkImage.ok || networkImage.type === 'opaque')) {
            imageCache.put(event.request, networkImage.clone());
          }
          return networkImage;
        } catch (_error) {
          return cachedImage || fetch(event.request);
        }
      })
    );
    return;
  }

  if (!isSameOrigin(requestUrl)) return;

  if (isSensitiveRequest(requestUrl)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request))
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    if (requestUrl.pathname.endsWith('/admin.html') || requestUrl.pathname.endsWith('/collection.html')) {
      event.respondWith(fetch(event.request, { cache: 'no-store' }));
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          if (requestUrl.pathname === '/' || requestUrl.pathname.endsWith('/index.html') || requestUrl.pathname.endsWith('/student.html')) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  const path = requestUrl.pathname || '';
  const isRuntimeCriticalScript = path.includes('/scripts/');
  const isStylesheet = path.includes('/styles/');
  const isConfigFile = path.includes('/config/');

  if (isRuntimeCriticalScript || isStylesheet || isConfigFile) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            const isStaticAsset = path.includes('/styles/')
              || path.includes('/assets/')
              || path.includes('/scripts/shared/')
              || path.includes('/scripts/pages/index-page')
              || path.includes('/scripts/pages/student-page')
              || path.includes('/config/')
              || path.endsWith('/manifest.json')
              || path.endsWith('/sw.js')
              || path.endsWith('/index.html')
              || path.endsWith('/student.html')
              || path === '/';
            if (isStaticAsset) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

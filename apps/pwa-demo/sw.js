/* ============================================================
 *  PWA Demo - Service Worker
 *  Version: v2.0.0
 *  Features: precache resources, offline fallback, background sync, push notifications
 * ============================================================ */

// ---- Cache name (versioned for easy updates) ----
var CACHE_NAME = 'pwa-demo-cache-v2';
var CACHE_PREFIX = 'pwa-demo-cache-';

// ---- Precached resource list ----
var PRECACHE_URLS = [
  '/wobbly-platypus/apps/pwa-demo/',
  '/wobbly-platypus/apps/pwa-demo/index.html',
  '/wobbly-platypus/apps/pwa-demo/offline.html',
  '/wobbly-platypus/apps/pwa-demo/manifest.json',
  '/wobbly-platypus/apps/pwa-demo/icons/icon-192.svg',
  '/wobbly-platypus/apps/pwa-demo/icons/icon-512.svg',
  '/wobbly-platypus/apps/pwa-demo/icons/favicon.svg'
];

/* ============================================================
 *  Install event: precache critical resources
 * ============================================================ */
self.addEventListener('install', function(event) {
  console.log('[SW] Install event triggered');

  // Force the waiting service worker to become active (skip waiting phase)
  // This allows new SW versions to take effect immediately
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Precaching resources:', PRECACHE_URLS);
      return cache.addAll(PRECACHE_URLS).catch(function(error) {
        console.error('[SW] Precaching failed:', error);
        // Partial cache failure does not block installation
      });
    })
  );
});

/* ============================================================
 *  Activate event: clean up old cache versions
 * ============================================================ */
self.addEventListener('activate', function(event) {
  console.log('[SW] Activate event triggered');

  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(name) {
          // Delete caches that don't match the current version
          if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) {
            console.log('[SW] Cleaning old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(function() {
      // Immediately claim all clients (including already open pages)
      return self.clients.claim();
    })
  );
});

/* ============================================================
 *  Fetch interception: cache-first strategy + offline fallback
 * ============================================================ */
self.addEventListener('fetch', function(event) {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip non-HTTP(S) requests (e.g. chrome-extension://)
  if (!event.request.url.startsWith('http')) return;

  // ---- Cache-first strategy ----
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      // Cache hit → return cached response
      if (cachedResponse) {
        return cachedResponse;
      }

      // Cache miss → make network request
      return fetch(event.request).then(function(networkResponse) {
        // Only cache same-origin successful responses
        if (networkResponse && networkResponse.status === 200) {
          var clonedResponse = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clonedResponse);
          });
        }
        return networkResponse;
      }).catch(function(error) {
        // ---- Network request failed → return offline fallback page ----
        console.log('[SW] Network request failed, returning offline page:', event.request.url);

        // If it's a navigation request (HTML page), return the offline page
        if (event.request.mode === 'navigate') {
          return caches.match('/wobbly-platypus/apps/pwa-demo/offline.html');
        }

        // For image requests, return a simple offline placeholder
        if (event.request.destination === 'image') {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
            '<rect width="200" height="200" fill="#f1f5f9"/>' +
            '<text x="100" y="105" font-family="sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">Offline</text>' +
            '</svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        }

        // Other resources: return empty response
        return new Response('Offline mode', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

/* ============================================================
 *  Message event: handle instructions from the page
 * ============================================================ */
self.addEventListener('message', function(event) {
  console.log('[SW] Received message:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    // Skip waiting, activate new SW version
    self.skipWaiting();
    // Notify all clients that SW has been updated
    self.clients.matchAll().then(function(clients) {
      clients.forEach(function(client) {
        client.postMessage({
          type: 'SW_UPDATED',
          timestamp: Date.now()
        });
      });
    });
  }
});

/* ============================================================
 *  Background sync event
 *  Automatically syncs todo data when network is restored
 * ============================================================ */
self.addEventListener('sync', function(event) {
  console.log('[SW] Background sync event:', event.tag);

  if (event.tag === 'sync-todos') {
    event.waitUntil(syncTodos());
  }
});

/**
 *  Execute todo sync
 *  Reads pending data from IndexedDB and sends to server (simulated)
 */
function syncTodos() {
  return new Promise(function(resolve, reject) {
    console.log('[SW] Starting todo sync...');

    // ---- Open IndexedDB ----
    var request = indexedDB.open('PWADemoDB', 1);

    request.onerror = function() {
      console.error('[SW] Failed to open IndexedDB');
      reject();
    };

    request.onsuccess = function(event) {
      var db = event.target.result;
      var transaction = db.transaction(['todos'], 'readonly');
      var store = transaction.objectStore('todos');
      var getAll = store.getAll();

      getAll.onsuccess = function() {
        var todos = getAll.result;
        var pendingTodos = todos.filter(function(t) { return !t.synced; });

        if (pendingTodos.length === 0) {
          console.log('[SW] No pending data to sync');
          resolve();
          return;
        }

        console.log('[SW] Pending items to sync:', pendingTodos.length);

        // ---- Simulate sending to server ----
        // In production, this would use fetch() to POST to a backend API
        var syncPromises = pendingTodos.map(function(todo) {
          // Simulate network request delay
          return new Promise(function(resolveSync) {
            setTimeout(function() {
              console.log('[SW] Sync complete:', todo.id, todo.title);
              // Mark as synced (in production, confirmed by server response)
              var updateTx = db.transaction(['todos'], 'readwrite');
              var updateStore = updateTx.objectStore('todos');
              todo.synced = true;
              todo.syncedAt = new Date().toISOString();
              updateStore.put(todo);
              resolveSync();
            }, 500);
          });
        });

        Promise.all(syncPromises).then(function() {
          console.log('[SW] All todos synced successfully');
          // Notify page that sync is complete
          self.clients.matchAll().then(function(clients) {
            clients.forEach(function(client) {
              client.postMessage({
                type: 'SYNC_COMPLETE',
                count: pendingTodos.length,
                timestamp: Date.now()
              });
            });
          });
          resolve();
        }).catch(function(error) {
          console.error('[SW] Sync failed:', error);
          reject();
        });
      };

      getAll.onerror = function() {
        console.error('[SW] Failed to read todos');
        reject();
      };
    };

    request.onupgradeneeded = function(event) {
      // Ensure object store exists (created by the page)
      var db = event.target.result;
      if (!db.objectStoreNames.contains('todos')) {
        db.createObjectStore('todos', { keyPath: 'id' });
      }
    };
  });
}

/* ============================================================
 *  Push notification event
 *  Handle push messages from the server
 * ============================================================ */
self.addEventListener('push', function(event) {
  console.log('[SW] Push message received');

  var title = 'PWA Demo';
  var options = {
    body: 'You have a new push notification',
    icon: '/wobbly-platypus/apps/pwa-demo/icons/icon-192.svg',
    badge: '/wobbly-platypus/apps/pwa-demo/icons/favicon.svg',
    vibrate: [200, 100, 200],
    tag: 'pwa-demo-push',
    data: {
      url: '/wobbly-platypus/apps/pwa-demo/',
      timestamp: Date.now()
    },
    actions: [
      { action: 'open', title: 'Open App' },
      { action: 'close', title: 'Close' }
    ]
  };

  // If push message contains data, use custom content
  if (event.data) {
    try {
      var payload = event.data.json();
      title = payload.title || title;
      options.body = payload.body || options.body;
      if (payload.icon) options.icon = payload.icon;
      if (payload.data) options.data = Object.assign(options.data, payload.data);
    } catch (e) {
      // Not JSON format, use as plain text
      options.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* ============================================================
 *  Notification click event
 *  Handle user clicking on a notification
 * ============================================================ */
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Notification clicked:', event.action);
  event.notification.close(); // Close the notification

  // Execute different behavior based on which action button was clicked
  var urlToOpen = '/wobbly-platypus/apps/pwa-demo/';

  if (event.action === 'open' || !event.action) {
    // Open the main page or the URL specified in the notification
    if (event.notification.data && event.notification.data.url) {
      urlToOpen = event.notification.data.url;
    }

    event.waitUntil(
      clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      }).then(function(windowClients) {
        // If a page is already open, focus it
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url.includes('/wobbly-platypus/apps/pwa-demo/') && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
    );
  }
});

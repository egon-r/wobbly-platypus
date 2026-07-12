/* ============================================================
 *  PWA 演示 - Service Worker
 *  版本: v2.0.0
 *  功能: 预缓存资源、离线回退、后台同步、推送通知
 * ============================================================ */

// ---- 缓存名称（版本化，便于更新） ----
var CACHE_NAME = 'pwa-demo-cache-v2';
var CACHE_PREFIX = 'pwa-demo-cache-';

// ---- 预缓存资源列表 ----
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
 *  安装事件：预缓存关键资源
 * ============================================================ */
self.addEventListener('install', function(event) {
  console.log('[SW] 安装事件触发');

  // 强制等待中的 SW 变为激活状态（跳过 waiting 阶段）
  // 这样新版本的 SW 安装后立即生效
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] 预缓存资源:', PRECACHE_URLS);
      return cache.addAll(PRECACHE_URLS).catch(function(error) {
        console.error('[SW] 预缓存失败:', error);
        // 部分资源缓存失败不阻塞安装
      });
    })
  );
});

/* ============================================================
 *  激活事件：清理旧版本缓存
 * ============================================================ */
self.addEventListener('activate', function(event) {
  console.log('[SW] 激活事件触发');

  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(name) {
          // 删除不属于当前版本的缓存
          if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) {
            console.log('[SW] 清理旧缓存:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(function() {
      // 立即控制所有客户端（包括已打开的页面）
      return self.clients.claim();
    })
  );
});

/* ============================================================
 *  请求拦截：缓存优先策略 + 离线回退
 * ============================================================ */
self.addEventListener('fetch', function(event) {
  // 仅处理 GET 请求
  if (event.request.method !== 'GET') return;

  // 不处理非 HTTP(S) 请求（如 chrome-extension://）
  if (!event.request.url.startsWith('http')) return;

  // ---- 缓存优先策略 ----
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      // 缓存命中 → 返回缓存内容
      if (cachedResponse) {
        return cachedResponse;
      }

      // 缓存未命中 → 发起网络请求
      return fetch(event.request).then(function(networkResponse) {
        // 只缓存同源的成功响应
        if (networkResponse && networkResponse.status === 200) {
          var clonedResponse = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clonedResponse);
          });
        }
        return networkResponse;
      }).catch(function(error) {
        // ---- 网络请求失败时返回离线回退页面 ----
        console.log('[SW] 网络请求失败，返回离线页面:', event.request.url);

        // 如果是导航请求（HTML 页面），返回离线页面
        if (event.request.mode === 'navigate') {
          return caches.match('/wobbly-platypus/apps/pwa-demo/offline.html');
        }

        // 对于图片等资源请求，返回一个简单的离线占位
        if (event.request.destination === 'image') {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
            '<rect width="200" height="200" fill="#f1f5f9"/>' +
            '<text x="100" y="105" font-family="sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">离线</text>' +
            '</svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        }

        // 其他资源：返回空响应
        return new Response('离线模式', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

/* ============================================================
 *  消息事件：处理来自页面的指令
 * ============================================================ */
self.addEventListener('message', function(event) {
  console.log('[SW] 收到消息:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    // 跳过 waiting，激活新版本 SW
    self.skipWaiting();
    // 通知所有客户端 SW 已更新
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
 *  后台同步事件
 *  当网络恢复时，自动同步待办事项数据
 * ============================================================ */
self.addEventListener('sync', function(event) {
  console.log('[SW] 后台同步事件:', event.tag);

  if (event.tag === 'sync-todos') {
    event.waitUntil(syncTodos());
  }
});

/**
 *  执行待办事项同步
 *  从 IndexedDB 读取待同步的数据，发送到服务器（模拟）
 */
function syncTodos() {
  return new Promise(function(resolve, reject) {
    console.log('[SW] 开始同步待办事项...');

    // ---- 打开 IndexedDB ----
    var request = indexedDB.open('PWADemoDB', 1);

    request.onerror = function() {
      console.error('[SW] 打开 IndexedDB 失败');
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
          console.log('[SW] 没有待同步的数据');
          resolve();
          return;
        }

        console.log('[SW] 待同步数据:', pendingTodos.length, '条');

        // ---- 模拟发送到服务器 ----
        // 实际项目中，这里应使用 fetch() 发送到后端 API
        var syncPromises = pendingTodos.map(function(todo) {
          // 模拟网络请求延迟
          return new Promise(function(resolveSync) {
            setTimeout(function() {
              console.log('[SW] 同步完成:', todo.id, todo.title);
              // 标记为已同步（在实际项目中由服务器响应确认）
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
          console.log('[SW] 所有待办事项同步完成');
          // 通知页面同步完成
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
          console.error('[SW] 同步失败:', error);
          reject();
        });
      };

      getAll.onerror = function() {
        console.error('[SW] 读取待办事项失败');
        reject();
      };
    };

    request.onupgradeneeded = function(event) {
      // 如果数据库不存在，确保结构创建（在页面中已创建）
      var db = event.target.result;
      if (!db.objectStoreNames.contains('todos')) {
        db.createObjectStore('todos', { keyPath: 'id' });
      }
    };
  });
}

/* ============================================================
 *  推送通知事件
 *  处理来自服务器的推送消息
 * ============================================================ */
self.addEventListener('push', function(event) {
  console.log('[SW] 收到推送消息');

  var title = 'PWA 演示';
  var options = {
    body: '您收到一条新的推送消息',
    icon: '/wobbly-platypus/apps/pwa-demo/icons/icon-192.svg',
    badge: '/wobbly-platypus/apps/pwa-demo/icons/favicon.svg',
    vibrate: [200, 100, 200],
    tag: 'pwa-demo-push',
    data: {
      url: '/wobbly-platypus/apps/pwa-demo/',
      timestamp: Date.now()
    },
    actions: [
      { action: 'open', title: '打开应用' },
      { action: 'close', title: '关闭' }
    ]
  };

  // 如果推送消息包含数据，使用自定义内容
  if (event.data) {
    try {
      var payload = event.data.json();
      title = payload.title || title;
      options.body = payload.body || options.body;
      if (payload.icon) options.icon = payload.icon;
      if (payload.data) options.data = Object.assign(options.data, payload.data);
    } catch (e) {
      // 非 JSON 格式，使用文本
      options.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* ============================================================
 *  通知点击事件
 *  用户点击通知时的处理
 * ============================================================ */
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] 通知被点击:', event.action);
  event.notification.close(); // 关闭通知

  // 根据用户点击的操作按钮执行不同行为
  var urlToOpen = '/wobbly-platypus/apps/pwa-demo/';

  if (event.action === 'open' || !event.action) {
    // 打开主页面或通知中指定的 URL
    if (event.notification.data && event.notification.data.url) {
      urlToOpen = event.notification.data.url;
    }

    event.waitUntil(
      clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      }).then(function(windowClients) {
        // 如果已有打开的页面，聚焦到它
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url.includes('/wobbly-platypus/apps/pwa-demo/') && 'focus' in client) {
            return client.focus();
          }
        }
        // 否则打开新窗口
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
    );
  }
});

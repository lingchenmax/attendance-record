// Service Worker：页面资源「网络优先，失败回落缓存」
// 说明：
// - 只处理同源 GET 请求；Supabase 等跨域接口不经过这里（数据快照由 app.js 单独存 Cache Storage）。
// - 不做强制版本升级，避免推送后用户长期看到旧页面；每次在线都会取最新文件并顺手更新缓存。
const SHELL_CACHE = 'attendance-shell-v1';
const DATA_CACHE = 'attendance-snapshot-v1'; // 与 app.js 中的快照缓存同名，升级时不能误删
const SHELL_FILES = ['./', './index.html'];

self.addEventListener('install', function (event) {
    self.skipWaiting();
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(function (cache) { return cache.addAll(SHELL_FILES); })
            .catch(function () { /* 首次安装失败不阻塞 */ })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil((async function () {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(function (k) { return k !== SHELL_CACHE && k !== DATA_CACHE; })
                .map(function (k) { return caches.delete(k); })
        );
        await self.clients.claim();
    })());
});

function isShellRequest(request, url) {
    if (request.mode === 'navigate') return true;
    if (url.pathname === '/' || url.pathname.endsWith('/')) return true;
    return /\.(?:html|js|css|json|png|svg|ico)$/i.test(url.pathname);
}

self.addEventListener('fetch', function (event) {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // 跨域接口不缓存
    if (!isShellRequest(request, url)) return;

    event.respondWith((async function () {
        try {
            const fresh = await fetch(request);
            if (fresh && fresh.ok) {
                const cache = await caches.open(SHELL_CACHE);
                cache.put(request, fresh.clone()).catch(function () { /* 忽略写入失败 */ });
            }
            return fresh;
        } catch (err) {
            const cached = await caches.match(request);
            if (cached) return cached;
            // 带版本号查询串的资源（app.js?v=...）忽略 search 再找一次
            const loose = await caches.match(request, { ignoreSearch: true });
            if (loose) return loose;
            if (request.mode === 'navigate') {
                const shell = await caches.match('./index.html', { ignoreSearch: true });
                if (shell) return shell;
            }
            return Response.error();
        }
    })());
});

/* ============================================================================
 *  حسابدار — Service Worker (نسخهٔ وب نصب‌شونده / آفلاین)
 *  هدف: نسخهٔ وب دقیقاً مثل نسخهٔ الکترون به‌صورت کامل آفلاین کار کند.
 *  استراتژی:
 *   • درخواست‌های هم‌مبدأ (same-origin) GET: stale-while-revalidate
 *     (فوراً از کش، و در پس‌زمینه نسخهٔ تازه دانلود و کش می‌شود).
 *   • درخواست‌های ناوبری (باز کردن اپ): آفلاین → index.html از کش.
 *   • درخواست‌های cross-origin (مثلِ Supabase) و غیرِ GET: دست‌نخورده عبور
 *     می‌کنند تا سینک/آنلاین هیچ اختلالی نبیند.
 *  مسیرها همه «نسبی» هستند تا روی GitHub Pages زیرِ هر زیرمسیری کار کنند.
 * ========================================================================== */

var SW_VERSION = 'jouya-v1.0.0';
var CACHE = SW_VERSION;

// فهرستِ هستهٔ اپ — پیش‌ذخیره (best-effort؛ نبودِ یک فایل نصب را خراب نمی‌کند)
var CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  // CSS
  './assets/fonts/vazirmatn.css',
  './assets/css/all.min.css',
  './assets/css/persian-datepicker.min.css',
  './style.css',
  './auth-system.css',
  './dashboard-store-info-fix.css',
  './mobile-responsive.css',
  // JS کتابخانه‌ها
  './assets/js/jquery-3.6.0.min.js',
  './assets/js/chart.min.js',
  './assets/js/persian-date.min.js',
  './assets/js/persian-datepicker.min.js',
  './assets/js/xlsx.full.min.js',
  './assets/js/html2canvas.min.js',
  './assets/js/jspdf.umd.min.js',
  // JS اپ
  './database.js',
  './script.js',
  './persian-date-utils.js',
  './auth-system.js',
  './drive-backup.js',
  './instant-update-fix.js',
  './delivery-list.js',
  './currency-system.js',
  './sync-config.js',
  './sync-layer.js',
  './auth-cloud.js',
  './demo-mode.js',
  './mobile-fit.js',
  './jouya-selftest.js',
  './pwa-register.js',
  // آیکن‌ها
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // هر فایل جداگانه اضافه می‌شود تا اگر یکی ۴۰۴ شد، بقیه کش شوند و نصب خراب نشود.
      return Promise.all(CORE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// پیام از صفحه: فعال‌سازی فوریِ نسخهٔ جدید (اختیاری)
self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // فقط GET را مدیریت می‌کنیم؛ POST/PUT و … دست‌نخورده عبور کنند (سینک/آپلود سالم بماند)
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // فقط http/https؛ درخواست‌های file:// (نسخهٔ الکترون) یا پروتکل‌های دیگر را اصلاً دست نمی‌زنیم
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // فقط هم‌مبدأ؛ cross-origin (Supabase, CDN realtime و …) را دست نمی‌زنیم
  if (url.origin !== self.location.origin) return;

  // درخواست‌های ناوبری (باز کردن اپ): شبکه‌محور با فالبکِ آفلاین به index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        try { var c = res.clone(); caches.open(CACHE).then(function (cache) { cache.put(req, c); }); } catch (e) {}
        return res;
      }).catch(function () {
        return caches.match(req).then(function (m) {
          return m || caches.match('./index.html') || caches.match('./');
        });
      })
    );
    return;
  }

  // بقیهٔ منابعِ هم‌مبدأ: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var network = fetch(req).then(function (res) {
          try {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          } catch (e) {}
          return res;
        }).catch(function () { return null; });
        // فوراً از کش (اگر بود)، وگرنه منتظرِ شبکه
        return cached || network.then(function (r) { return r || cached; });
      });
    })
  );
});

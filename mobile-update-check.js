/* ═══════════════════════════════════════════════════════════════════════════
 *  mobile-update-check.js — اعلانِ بروزرسانیِ نسخهٔ موبایل (حسابدار / فروشگاه جویا)
 * ---------------------------------------------------------------------------
 *  فقط روی نسخهٔ موبایل (Capacitor/Android) فعال می‌شود. روی دسکتاپ (Electron) و
 *  مرورگر هیچ کاری نمی‌کند تا سیستمِ بروزرسانیِ فعلیِ دسکتاپ دست‌نخورده بماند.
 *
 *  کارکرد: نسخهٔ نصب‌شده را (از خودِ اپ) با ردیفِ app_release در سوپابیس مقایسه
 *  می‌کند؛ اگر نسخهٔ جدیدتری موجود باشد، در همان بخشِ «بروزرسانی» نوارِ کناری یک
 *  پیام + دکمهٔ «دریافتِ نسخهٔ جدید» نشان می‌دهد که کاربر را به لینکِ دانلود
 *  (تلگرام/سایت) می‌برد. دانلود و نصب دستی است؛ این ماژول فقط اطلاع می‌دهد.
 *  هیچ دیتایی پاک نمی‌شود و هیچ منطقِ کسب‌وکاری تغییر نمی‌کند.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── تنظیمات ────────────────────────────────────────────────────────────────
  // این دو مقدار همان‌هایی هستند که اپ برای سینک از آن‌ها استفاده می‌کند.
  // اگر اپ آن‌ها را به‌صورتِ سراسری در دسترس گذاشته باشد، خودکار برداشته می‌شوند؛
  // در غیر این صورت این‌جا همان URL و anon key را بگذارید (کلیدِ عمومی/anon، نه service_role).
  var SUPABASE_URL =
    window.SUPABASE_URL ||
    (window.JOUYA_SUPABASE && window.JOUYA_SUPABASE.url) ||
    (window.SYNC_CONFIG && window.SYNC_CONFIG.supabaseUrl) ||
    'PUT_YOUR_SUPABASE_URL_HERE';

  var SUPABASE_ANON_KEY =
    window.SUPABASE_ANON_KEY ||
    (window.JOUYA_SUPABASE && window.JOUYA_SUPABASE.anonKey) ||
    (window.SYNC_CONFIG && window.SYNC_CONFIG.supabaseAnonKey) ||
    'PUT_YOUR_SUPABASE_ANON_KEY_HERE';

  var PLATFORM_ROW = 'android';           // کدام ردیفِ app_release خوانده شود
  var TARGET_SLOT_ID = 'jouya-mobile-update-slot'; // عنصری در نوارِ کناری که پیام داخلش می‌آید
  var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;      // بازبینیِ خودکار هر ۶ ساعت

  // ── ابزارهای محیط ───────────────────────────────────────────────────────────
  function isNative() {
    try {
      return !!(window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }

  function currentVersion() {
    // نسخهٔ واقعیِ نصب‌شده را از پلاگینِ App می‌گیریم (versionCode عددِ مقایسه است).
    return new Promise(function (resolve) {
      try {
        var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
        if (App && typeof App.getInfo === 'function') {
          App.getInfo().then(function (info) {
            resolve({
              versionName: (info && info.version) || '',
              versionCode: parseInt((info && info.build) || '0', 10) || 0
            });
          }).catch(function () {
            resolve(fallbackVersion());
          });
          return;
        }
      } catch (e) {}
      resolve(fallbackVersion());
    });
  }
  function fallbackVersion() {
    return {
      versionName: window.__APP_VERSION_NAME__ || '',
      versionCode: parseInt(window.__APP_VERSION_CODE__ || '0', 10) || 0
    };
  }

  // ── دریافتِ آخرین نسخه از سوپابیس ─────────────────────────────────────────────
  function fetchLatest() {
    var url = SUPABASE_URL.replace(/\/+$/, '') +
      '/rest/v1/app_release?platform=eq.' + encodeURIComponent(PLATFORM_ROW) +
      '&select=version_name,version_code,download_url,notes,mandatory&limit=1';
    return fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Accept': 'application/json'
      }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (rows) {
      return (rows && rows[0]) ? rows[0] : null;
    });
  }

  // ── بازکردنِ لینکِ دانلود در مرورگرِ سیستم/تلگرام ────────────────────────────────
  function openDownload(url) {
    if (!url) return;
    try {
      var B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
      if (B && typeof B.open === 'function') { B.open({ url: url }); return; }
    } catch (e) {}
    try { window.open(url, '_blank'); return; } catch (e) {}
    try { location.href = url; } catch (e) {}
  }

  // ── ساختِ کارتِ اعلان ────────────────────────────────────────────────────────
  function buildCard(latest) {
    var wrap = document.createElement('div');
    wrap.className = 'jmu-card' + (latest.mandatory ? ' jmu-card-mandatory' : '');
    wrap.setAttribute('dir', 'rtl');
    wrap.style.cssText =
      'background:#1e3a5f;color:#fff;border-radius:14px;padding:14px 16px;margin:10px 0;' +
      'box-shadow:0 6px 18px rgba(2,6,23,.28);font-family:inherit;';
    var notes = (latest.notes || '').toString().trim();
    wrap.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;font-weight:800;font-size:1rem;margin-bottom:6px;">' +
        '<i class="fas fa-cloud-arrow-down"></i><span>نسخهٔ جدید موجود است</span>' +
      '</div>' +
      '<div style="font-size:.9rem;opacity:.95;margin-bottom:4px;">نسخهٔ ' +
        escapeHtml(latest.version_name) + ' آمادهٔ دریافت است.</div>' +
      (notes ? '<div style="font-size:.82rem;opacity:.85;margin-bottom:10px;">' + escapeHtml(notes) + '</div>'
             : '<div style="height:6px"></div>') +
      '<button type="button" class="jmu-dl-btn" style="width:100%;border:none;border-radius:10px;' +
        'padding:11px 14px;font-family:inherit;font-weight:800;font-size:.92rem;cursor:pointer;' +
        'background:#c8a24a;color:#12233b;display:inline-flex;align-items:center;justify-content:center;gap:8px;">' +
        '<i class="fas fa-download"></i><span>دریافتِ نسخهٔ جدید</span>' +
      '</button>' +
      '<div style="font-size:.72rem;opacity:.8;margin-top:8px;line-height:1.6;">' +
        'برای بروزرسانی، فایلِ جدید را از لینکِ بالا دانلود و روی نسخهٔ فعلی نصب کنید. ' +
        'اطلاعاتِ شما پاک نمی‌شود.' +
      '</div>';
    wrap.querySelector('.jmu-dl-btn').addEventListener('click', function () {
      openDownload(latest.download_url);
    });
    return wrap;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function render(latest, targetId) {
    var slot = document.getElementById(targetId || TARGET_SLOT_ID);
    // اگر عنصرِ مقصد نبود، به‌عنوانِ پشتیبان یک نوارِ شناور در بالای صفحه نشان بده.
    if (!slot) {
      slot = document.getElementById('jmu-fallback-slot');
      if (!slot) {
        slot = document.createElement('div');
        slot.id = 'jmu-fallback-slot';
        slot.style.cssText = 'position:fixed;left:10px;right:10px;top:10px;z-index:2147483000;';
        document.body.appendChild(slot);
      }
    }
    slot.innerHTML = '';
    slot.appendChild(buildCard(latest));
  }

  // ── منطقِ اصلی ───────────────────────────────────────────────────────────────
  var _lastResult = null;

  function check(opts) {
    opts = opts || {};
    if (!isNative()) return Promise.resolve({ updateAvailable: false, reason: 'not-native' });
    return currentVersion().then(function (cur) {
      return fetchLatest().then(function (latest) {
        if (!latest) return { updateAvailable: false, reason: 'no-remote' };
        var remoteCode = parseInt(latest.version_code || 0, 10) || 0;
        var available = remoteCode > (cur.versionCode || 0);
        _lastResult = {
          updateAvailable: available,
          current: cur,
          latest: latest
        };
        if (available && opts.render !== false) render(latest, opts.targetId);
        return _lastResult;
      });
    }).catch(function (e) {
      // خطای شبکه/پیکربندی هرگز اپ را متوقف نمی‌کند.
      try { console.warn('[JouyaMobileUpdate] check failed:', e && e.message); } catch (x) {}
      return { updateAvailable: false, reason: 'error' };
    });
  }

  // API عمومی
  window.JouyaMobileUpdate = {
    isNative: isNative,
    check: check,                                   // بازبینی + نمایش (اگر جدید بود)
    getLast: function () { return _lastResult; },   // آخرین نتیجه
    renderInto: function (elId) {                    // نمایشِ دستی داخلِ یک عنصرِ مشخص
      return check({ targetId: elId });
    },
    openDownload: openDownload,
    _config: { get url() { return SUPABASE_URL; }, get platform() { return PLATFORM_ROW; } }
  };

  // اجرا: پس از آماده‌شدنِ محیطِ نیتیو، یک‌بار بررسی و سپس دوره‌ای.
  function boot() {
    if (!isNative()) return;                         // دسکتاپ/مرورگر: هیچ.
    check();
    setInterval(function () { check(); }, CHECK_INTERVAL_MS);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
  // اگر رویدادِ deviceready/ capacitor موجود بود هم یک‌بار تلاش کن.
  document.addEventListener('deviceready', boot, { once: true });
})();

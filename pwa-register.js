/* ============================================================================
 *  حسابدار — راه‌اندازِ PWA (ثبتِ Service Worker + دکمهٔ «نصب اپلیکیشن» + راهنمای iOS)
 *  ‑ روی دسکتاپ/اندروید: رویدادِ beforeinstallprompt گرفته و دکمهٔ نصب نشان داده می‌شود
 *    (همان «Install app» که در بروزر می‌آید).
 *  ‑ روی iOS (سافاری): چون beforeinstallprompt پشتیبانی نمی‌شود، راهنمای «افزودن به
 *    صفحهٔ اصلی» یک‌بار نشان داده می‌شود.
 *  ‑ کاملاً افزایشی و ایمن؛ هیچ منطقی از اپ را تغییر نمی‌دهد. اگر مرورگر PWA را
 *    پشتیبانی نکند، هیچ اتفاقی نمی‌افتد.
 * ========================================================================== */
(function () {
  'use strict';

  // ── ۱) ثبتِ Service Worker (مسیرِ نسبی تا روی GitHub Pages زیرِ هر زیرمسیری کار کند) ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      var swUrl = new URL('service-worker.js', document.baseURI).href;
      var scope = new URL('.', document.baseURI).href;
      navigator.serviceWorker.register(swUrl, { scope: scope }).then(function (reg) {
        try { console.log('[jouya-pwa] service worker ثبت شد:', reg.scope); } catch (e) {}
      }).catch(function (err) {
        try { console.warn('[jouya-pwa] ثبتِ service worker ناموفق:', err && err.message); } catch (e) {}
      });
    });
  }

  // ── ابزارِ کوچک ──
  function isStandalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
             window.navigator.standalone === true;
    } catch (e) { return false; }
  }
  function isIOS() {
    try {
      var ua = navigator.userAgent || '';
      var iOSDevice = /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
      return iOSDevice && /WebKit/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    } catch (e) { return false; }
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // ── استایلِ بنر/دکمه (تزریقِ یک‌باره) ──
  function injectStyle() {
    if (document.getElementById('jouya-pwa-style')) return;
    var css = ''
      + '#jouya-pwa-install,#jouya-pwa-ios{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;'
      + 'font-family:Vazirmatn,"Segoe UI",Tahoma,sans-serif;direction:rtl;display:none;}'
      + '#jouya-pwa-install .jp-card,#jouya-pwa-ios .jp-card{margin:0 auto;max-width:520px;'
      + 'background:linear-gradient(135deg,#1e293b,#2563eb);color:#fff;border-radius:16px 16px 0 0;'
      + 'box-shadow:0 -6px 24px rgba(0,0,0,.28);padding:14px 16px;display:flex;align-items:center;gap:12px;}'
      + '#jouya-pwa-install .jp-ico,#jouya-pwa-ios .jp-ico{width:44px;height:44px;border-radius:11px;flex:0 0 auto;'
      + 'background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;}'
      + '#jouya-pwa-install .jp-ico img,#jouya-pwa-ios .jp-ico img{width:100%;height:100%;object-fit:cover;}'
      + '#jouya-pwa-install .jp-txt,#jouya-pwa-ios .jp-txt{flex:1 1 auto;min-width:0;}'
      + '#jouya-pwa-install .jp-t1,#jouya-pwa-ios .jp-t1{font-weight:800;font-size:15px;margin:0 0 2px;}'
      + '#jouya-pwa-install .jp-t2,#jouya-pwa-ios .jp-t2{font-size:12.5px;opacity:.92;line-height:1.5;margin:0;}'
      + '#jouya-pwa-install .jp-btn{background:#fff;color:#1e293b;border:none;border-radius:10px;'
      + 'padding:10px 16px;font-weight:800;font-size:14px;font-family:inherit;cursor:pointer;flex:0 0 auto;}'
      + '#jouya-pwa-install .jp-btn:active{transform:scale(.96);}'
      + '.jp-x{background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;flex:0 0 auto;'
      + 'opacity:.8;line-height:1;padding:4px 6px;}'
      + '.jp-x:hover{opacity:1;}'
      + '#jouya-pwa-ios .jp-share{display:inline-block;width:16px;height:16px;vertical-align:-3px;margin:0 2px;}'
      + '@media (min-width:560px){#jouya-pwa-install .jp-card,#jouya-pwa-ios .jp-card{margin:0 auto 14px;border-radius:16px;}}';
    var st = document.createElement('style');
    st.id = 'jouya-pwa-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function iconTag() {
    return '<div class="jp-ico"><img src="' + new URL('assets/icons/icon-192.png', document.baseURI).href + '" alt="حسابدار"></div>';
  }

  // ── ۲) دکمهٔ نصب برای دسکتاپ/اندروید (beforeinstallprompt) ──
  var deferredPrompt = null;
  function showInstallBanner() {
    injectStyle();
    var el = document.getElementById('jouya-pwa-install');
    if (!el) {
      el = document.createElement('div');
      el.id = 'jouya-pwa-install';
      el.innerHTML =
        '<div class="jp-card">' +
          iconTag() +
          '<div class="jp-txt"><p class="jp-t1">نصبِ اپلیکیشنِ حسابدار</p>' +
          '<p class="jp-t2">برای استفادهٔ کامل و آفلاین، اپ را روی دستگاه نصب کنید.</p></div>' +
          '<button type="button" class="jp-btn" id="jouya-pwa-do">نصب</button>' +
          '<button type="button" class="jp-x" id="jouya-pwa-close" title="بستن">&times;</button>' +
        '</div>';
      document.body.appendChild(el);
      el.querySelector('#jouya-pwa-do').addEventListener('click', doInstall);
      el.querySelector('#jouya-pwa-close').addEventListener('click', function () {
        el.style.display = 'none'; lsSet('jouya_pwa_install_dismiss', String(Date.now()));
      });
    }
    el.style.display = 'block';
  }
  function doInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choice) {
      try { console.log('[jouya-pwa] نتیجهٔ نصب:', choice && choice.outcome); } catch (e) {}
      deferredPrompt = null;
      var el = document.getElementById('jouya-pwa-install'); if (el) el.style.display = 'none';
    }).catch(function () {});
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (isStandalone()) return;
    // اگر کاربر اخیراً بست، تا ۷ روز دوباره اذیت نکن
    var d = parseInt(lsGet('jouya_pwa_install_dismiss') || '0', 10);
    if (d && (Date.now() - d) < 7 * 24 * 3600 * 1000) return;
    setTimeout(showInstallBanner, 1500);
  });

  window.addEventListener('appinstalled', function () {
    var el = document.getElementById('jouya-pwa-install'); if (el) el.style.display = 'none';
    try { console.log('[jouya-pwa] اپ نصب شد'); } catch (e) {}
  });

  // امکانِ فراخوانیِ دستی از داخلِ اپ (مثلاً یک دکمه در تنظیمات): window.jouyaPromptInstall()
  window.jouyaPromptInstall = function () {
    if (deferredPrompt) { doInstall(); return true; }
    if (isIOS() && !isStandalone()) { showIOSHint(true); return true; }
    return false;
  };

  // ── ۳) راهنمای iOS «افزودن به صفحهٔ اصلی» ──
  function showIOSHint(force) {
    if (isStandalone()) return;
    if (!force) {
      if (lsGet('jouya_pwa_ios_dismiss')) return;
    }
    injectStyle();
    var el = document.getElementById('jouya-pwa-ios');
    if (!el) {
      el = document.createElement('div');
      el.id = 'jouya-pwa-ios';
      // آیکنِ اشتراک‌گذاریِ iOS (SVG)
      var shareSvg = '<svg class="jp-share" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/>' +
        '<path d="M20 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5"/></svg>';
      el.innerHTML =
        '<div class="jp-card">' +
          iconTag() +
          '<div class="jp-txt"><p class="jp-t1">نصبِ «حسابدار» روی iPhone/iPad</p>' +
          '<p class="jp-t2">دکمهٔ اشتراک‌گذاری ' + shareSvg + ' را در نوارِ سافاری بزنید، سپس «Add to Home Screen / افزودن به صفحهٔ اصلی» را انتخاب کنید.</p></div>' +
          '<button type="button" class="jp-x" id="jouya-pwa-ios-close" title="بستن">&times;</button>' +
        '</div>';
      document.body.appendChild(el);
      el.querySelector('#jouya-pwa-ios-close').addEventListener('click', function () {
        el.style.display = 'none'; lsSet('jouya_pwa_ios_dismiss', '1');
      });
    }
    el.style.display = 'block';
  }

  // نمایشِ خودکارِ راهنمای iOS (یک‌بار، کمی پس از باز شدن)
  if (isIOS() && !isStandalone()) {
    window.addEventListener('load', function () { setTimeout(function () { showIOSHint(false); }, 2500); });
  }
})();

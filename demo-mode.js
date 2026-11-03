/**
 * demo-mode.js — نسخهٔ آزمایشیِ یک‌هفته‌ای (فروشگاه جویا)
 * ---------------------------------------------------------------------------
 * لایهٔ کاملاً افزودنی و مستقل: هیچ فایلِ دیگری (auth-system/auth-cloud/sync-layer/
 * database/script) را تغییر نمی‌دهد. فقط از طریقِ DOM با صفحهٔ ورود و برنامه تعامل می‌کند.
 *
 * قرارداد امنیتی (صادقانه):
 *   • «مقاوم در برابرِ تغییرِ ساعتِ سیستم»: بله — با «آخرین‌زمانِ دیده‌شدهٔ یکنواخت» (seen).
 *     effNow = max(now, seen) و seen فقط جلو می‌رود؛ پس بردنِ ساعت به عقب مهلت را تمدید
 *     نمی‌کند و بردن به جلو فقط زودتر منقضی می‌کند (به سودِ ما).
 *   • «تشخیصِ دستکاریِ فایلِ Local»: بله — امضای checksum؛ اگر مقادیر دستکاری شوند،
 *     Demo قفل می‌شود (فرضِ «منقضی»). این امضا رمزنگاریِ قوی نیست، فقط ویرایشِ ساده را می‌بندد.
 *   • «پاک‌کردنِ کاملِ localStorage / نصبِ مجدد»: به‌صورتِ محلی قابلِ جلوگیری نیست (فرصت را
 *     ریست می‌کند). بستنِ این حفره فقط با یک لایهٔ ابری کلیدخوردهٔ «شناسهٔ پایدارِ دستگاه»
 *     ممکن است (نقاطِ اتصالِ اختیاری در JouyaDemo._cloudHook زیر آماده است؛ راهنما در
 *     DEMO-MODE-SETUP.md). این لایه Offline-first است و بدونِ ابر هم کار می‌کند.
 *
 * جداسازی از دادهٔ واقعی: دکمهٔ Demo فقط وقتی نمایش داده می‌شود که هیچ حسابِ واقعی روی این
 * دستگاه نباشد (jouya_user_account خالی) — تا Demo با دادهٔ واقعی مخلوط نشود. Demo هرگز به
 * ابر Login نمی‌کند (نه session، نه workspace) → Sync غیرفعال و کاملاً جدا از حسابِ واقعی است.
 */
(function () {
    'use strict';

    var DURATION_MS = 7 * 24 * 60 * 60 * 1000;   // یک هفته (۷ روز)
    var GRACE_MS = 6 * 60 * 60 * 1000;           // مهلتِ ارفاقیِ آفلاین (برای لغزشِ ساعت)
    var SALT = 'JOUYA::demo::v1::9f3a';          // نمکِ امضا (فقط سختی‌افزایی)
    var K_STATE = '__jouya_demo_state';          // { start, seen, sig }
    var K_ACCOUNT = 'jouya_user_account';        // حسابِ واقعی (فقط برای gating خوانده می‌شود)
    // (APEX) نشانهٔ «نسخهٔ آزمایشی روی این دستگاه یک‌بار استفاده شده» — پس از پایانِ مهلت و
    // پاک‌سازیِ کاملِ دستگاه هم می‌ماند تا حالتِ مهمان دوباره فعال نشود. نسخهٔ دوم در یک
    // پایگاهِ IndexedDBِ جدا نگه داشته می‌شود تا پاک‌کردنِ localStorage به‌تنهایی کافی نباشد.
    var K_USED = '__jouya_demo_used';
    var K_EXPIRED_NOTICE = '__jouya_demo_expired_notice';
    var MARK_DB = 'apex_demo_mark';

    function _now() { return Date.now(); }

    // hash سادهٔ رشته (djb2) — برای امضای مقادیر
    function _hash(str) {
        var h = 5381, i = str.length;
        while (i) { h = (h * 33) ^ str.charCodeAt(--i); }
        return (h >>> 0).toString(36);
    }
    function _sig(start, seen) { return _hash(String(start) + '|' + String(seen) + '|' + SALT); }

    // پیامِ کوتاه به کاربر (پیش‌تر صدا زده می‌شد ولی تعریف نشده بود)
    function _alert(msg) {
        try {
            if (window.AuthUI && typeof window.AuthUI.showAlert === 'function') { window.AuthUI.showAlert('error', msg); return; }
        } catch (e) {}
        try { alert(msg); } catch (e) {}
    }
    function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

    function _readState() {
        var raw = _lsGet(K_STATE);
        if (!raw) return null;
        try {
            var o = JSON.parse(raw);
            if (!o || typeof o.start !== 'number' || typeof o.seen !== 'number' || typeof o.sig !== 'string') {
                return { tampered: true, start: 0, seen: 0 };
            }
            if (o.sig !== _sig(o.start, o.seen)) return { tampered: true, start: o.start, seen: o.seen };
            return { tampered: false, start: o.start, seen: o.seen };
        } catch (e) { return { tampered: true, start: 0, seen: 0 }; }
    }

    function _writeState(start, seen) {
        _lsSet(K_STATE, JSON.stringify({ start: start, seen: seen, sig: _sig(start, seen) }));
    }

    function _hasRealAccount() {
        try { var a = JSON.parse(_lsGet(K_ACCOUNT) || 'null'); return !!(a && a.email); }
        catch (e) { return false; }
    }

    // ---- نشانهٔ «استفاده‌شده» (localStorage + IndexedDBِ جدا) ----
    function _usedSig(at) { return _hash('used|' + String(at) + '|' + SALT); }
    function _isUsedLS() {
        try { var o = JSON.parse(_lsGet(K_USED) || 'null'); return !!(o && typeof o.at === 'number'); } catch (e) { return !!_lsGet(K_USED); }
    }
    function _markUsed() {
        var at = _now();
        if (!_isUsedLS()) _lsSet(K_USED, JSON.stringify({ at: at, sig: _usedSig(at) }));
        try {
            var rq = indexedDB.open(MARK_DB, 1);
            rq.onupgradeneeded = function () { try { rq.result.createObjectStore('m'); } catch (e) {} };
            rq.onsuccess = function () {
                try { var d = rq.result, tx = d.transaction('m', 'readwrite'); tx.objectStore('m').put({ at: at }, 'used'); tx.oncomplete = function () { d.close(); }; } catch (e) {}
            };
        } catch (e) {}
    }
    // بررسیِ غیرهم‌زمانِ نسخهٔ IndexedDB؛ اگر بود، نشانهٔ localStorage هم دوباره نوشته می‌شود
    function _checkUsedIDB(cb) {
        try {
            var rq = indexedDB.open(MARK_DB, 1);
            rq.onupgradeneeded = function () { try { rq.result.createObjectStore('m'); } catch (e) {} };
            rq.onsuccess = function () {
                try {
                    var d = rq.result, tx = d.transaction('m', 'readonly'), g = tx.objectStore('m').get('used');
                    g.onsuccess = function () { var v = g.result; d.close(); if (v) { _markUsed(); cb(true); } else cb(false); };
                    g.onerror = function () { d.close(); cb(false); };
                } catch (e) { cb(false); }
            };
            rq.onerror = function () { cb(false); };
        } catch (e) { cb(false); }
    }
    function isUsed() { return _isUsedLS(); }

    // ---- پاک‌سازیِ کاملِ اطلاعاتِ این دستگاه پس از پایانِ نسخهٔ آزمایشی ----
    //  همهٔ کلیدهای localStorage (و از راهِ موتورِ حافظه، مقدارهای IndexedDBِ آن‌ها) + نسخه‌های
    //  پشتیبانِ داخلی و اصلِ تصاویر پاک می‌شوند؛ فقط نشانهٔ «استفاده‌شده» و پیامِ پایان می‌ماند.
    //  ایمنی: اگر روی دستگاه حسابِ واقعی ثبت شده باشد، هیچ داده‌ای پاک نمی‌شود.
    function _wipeDevice() {
        if (_hasRealAccount()) { try { localStorage.removeItem(K_STATE); } catch (e) {} return Promise.resolve(false); }
        _markUsed();
        var KEEP = {}; KEEP[K_USED] = 1; KEEP[K_EXPIRED_NOTICE] = 1;
        try {
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            keys.forEach(function (k) { if (k && !KEEP[k]) { try { localStorage.removeItem(k); } catch (e) {} } });
        } catch (e) {}
        try { sessionStorage.clear(); } catch (e) {}
        var JS = window.JouyaStore;
        var p = (JS && typeof JS.whenSaved === 'function') ? JS.whenSaved() : Promise.resolve(true);
        return p.then(function () {
            return (JS && typeof JS.wipeExtras === 'function') ? JS.wipeExtras() : true;
        }).then(function () { return true; }, function () { return true; });
    }

    // وضعیتِ فعلیِ Demo — با به‌روزرسانیِ یکنواختِ seen (ضدِ عقب‌بردنِ ساعت).
    function status() {
        var st = _readState();
        if (!st) return { active: false, expired: false, tampered: false, remainingMs: DURATION_MS };
        if (st.tampered) return { active: true, expired: true, tampered: true, remainingMs: 0 };
        var now = _now();
        var effNow = Math.max(now, st.seen);   // یکنواخت: هرگز عقب نمی‌رود
        // اگر ساعت به عقب رفته، effNow=seen است؛ زمان اعتبار داده نمی‌شود.
        if (effNow !== st.seen) _writeState(st.start, effNow);   // فقط وقتی جلو رفته persist کن
        var elapsed = effNow - st.start;
        var remaining = DURATION_MS - elapsed;
        return {
            active: true,
            expired: remaining <= 0,
            tampered: false,
            remainingMs: remaining > 0 ? remaining : 0,
            start: st.start,
            seen: effNow
        };
    }

    function isActive() { var st = _readState(); return !!st; }

    // شروعِ Demo (فقط اگر از قبل فعال نباشد و حسابِ واقعی وجود نداشته باشد)
    function start() {
        if (_hasRealAccount()) {
            _alert('برای نسخهٔ آزمایشی از دستگاهی بدونِ حسابِ ثبت‌شده استفاده کنید تا داده‌های واقعی با آزمایشی مخلوط نشود.');
            return false;
        }
        if (isActive()) { _afterStart(); return true; }   // قبلاً شروع شده — فقط ادامه بده
        if (isUsed()) {
            _alert('نسخهٔ آزمایشی روی این دستگاه یک‌بار استفاده شده است. برای ادامه لطفاً حساب بسازید و کد فعال‌سازی وارد کنید.');
            var b0 = document.getElementById('jouya-demo-login-btn'); if (b0 && b0.parentNode) b0.parentNode.remove();
            return false;
        }
        var t = _now();
        _writeState(t, t);
        _markUsed();
        // اطلاع به لایهٔ ابری (اختیاری) — بدونِ آن هم کار می‌کند
        try { if (typeof JouyaDemo._cloudHook === 'function') JouyaDemo._cloudHook('start', t); } catch (e) {}
        _afterStart();
        return true;
    }

    function _afterStart() {
        var s = status();
        if (s.expired) { _lock(); return; }
        _revealApp();
        _renderBadge();
        _scheduleChecks();
    }

    // ---- نمایشِ برنامه (هم‌رفتارِ closeAuthAndStart، بدونِ دست‌زدن به auth-system) ----
    function _revealApp() {
        var ov = document.getElementById('auth-screen-overlay');
        if (ov) { ov.style.transition = 'opacity 0.35s'; ov.style.opacity = '0'; setTimeout(function () { if (ov && ov.parentNode) ov.remove(); }, 380); }
        try { document.body.style.overflow = ''; } catch (e) {}
    }

    // ---- نشانِ «نسخهٔ آزمایشی — X روز/ساعت باقی‌مانده» ----
    function _fmtRemaining(ms) {
        if (ms <= 0) return 'پایان‌یافته';
        var totalMin = Math.floor(ms / 60000);
        var d = Math.floor(totalMin / (60 * 24));
        var h = Math.floor((totalMin - d * 60 * 24) / 60);
        if (d > 0) return d + ' روز و ' + h + ' ساعت';
        var m = totalMin - h * 60;
        return h + ' ساعت و ' + m + ' دقیقه';
    }
    function _renderBadge() {
        var s = status();
        if (!s.active) return;
        var el = document.getElementById('jouya-demo-badge');
        if (!el) {
            el = document.createElement('div');
            el.id = 'jouya-demo-badge';
            el.style.cssText = 'position:fixed;bottom:14px;inset-inline-start:14px;z-index:99990;background:#1e3a5f;color:#fff;' +
                'padding:8px 12px;border-radius:10px;font-family:inherit;font-size:12.5px;font-weight:700;' +
                'box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;gap:10px;';
            document.body.appendChild(el);
        }
        el.innerHTML =
            '<span><i class="fas fa-hourglass-half"></i> نسخهٔ آزمایشی — باقی‌مانده: ' + _fmtRemaining(s.remainingMs) + '</span>' +
            '<button id="jouya-demo-exit-btn" type="button" title="خروج از نسخهٔ آزمایشی و ساخت حساب واقعی" ' +
                'style="background:#fff;color:#1e3a5f;border:none;border-radius:8px;padding:5px 10px;font-family:inherit;font-weight:700;font-size:11.5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;">' +
                '<i class="fas fa-user-plus"></i> ساخت حساب / فعال‌سازی</button>';
        var xb = document.getElementById('jouya-demo-exit-btn');
        if (xb) xb.onclick = function () { _exitDemoToRegister(); };
    }

    // خروجِ امنِ Demo و رفتن به «ثبت‌نامِ واقعیِ موجود». Demo Data هرگز با حسابِ واقعی مخلوط
    // نمی‌شود چون Demo هیچ‌گاه به ابر Login نکرده (نه session/workspace/sync). فقط حالتِ Demo پاک
    // و صفحهٔ auth روی «ثبت‌نام» باز می‌شود؛ پس از ساختِ حساب، جریانِ واقعیِ auth-cloud (register
    // → workspace → sync) طبقِ معماریِ موجود فعال می‌گردد.
    function _exitDemoToRegister() {
        try { localStorage.removeItem(K_STATE); } catch (e) {}
        try { localStorage.removeItem(K_EXPIRED_NOTICE); } catch (e) {}
        // پاک‌سازیِ دادهٔ کسب‌وکارِ «Demo» (دورریختنی) تا با Workspace/Sync واقعی مخلوط نشود.
        // امن است: Demo فقط وقتی «حسابِ واقعی وجود ندارد» شروع می‌شود، پس این کلیدها یا خالی‌اند یا
        // ساختهٔ Demo. هویتِ دستگاه و ترجیحات حفظ می‌شوند.
        var DEMO_DATA_KEYS = ['persons', 'products', 'transactions', 'expenses', 'cashboxes', 'returns',
            'services', 'warehouses', 'warehouseTransfers', 'cashboxTransactions',
            'jouya-currencies', 'jouya-exchange-rates', 'jouya-reference-rates',
            'dashboardStats', 'activeWarehouseId', 'settings'];
        DEMO_DATA_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        try { localStorage.setItem('__jouya_demo_goto_register', '1'); } catch (e) {}
        var b = document.getElementById('jouya-demo-badge'); if (b) b.remove();
        var lk = document.getElementById('jouya-demo-lock'); if (lk) lk.remove();
        try { location.reload(); } catch (e) {}
    }
    if (typeof window !== 'undefined') window.__jouyaDemoExit = _exitDemoToRegister;

    // ---- قفلِ کاملِ برنامه پس از پایانِ مهلت ----
    function _lock() {
        try { document.body.style.overflow = 'hidden'; } catch (e) {}
        if (document.getElementById('jouya-demo-lock')) return;
        // (APEX) پایانِ مهلت → پاک‌سازیِ کاملِ اطلاعاتِ دستگاه، سپس بارگذاریِ دوباره تا هیچ دادهٔ
        // باقی‌مانده در حافظهٔ برنامه دوباره نوشته نشود. پیامِ پایان پس از بارگذاری نشان داده می‌شود.
        if (!window.__jouyaDemoWiping && !_hasRealAccount()) {
            window.__jouyaDemoWiping = true;
            var cover = document.createElement('div');
            cover.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;font-family:inherit;font-size:14px;';
            cover.textContent = 'مهلت نسخهٔ آزمایشی تمام شد — در حال پاک‌کردن اطلاعات آزمایشی…';
            try { document.body.appendChild(cover); } catch (e) {}
            _wipeDevice().then(function () {
                _lsSet(K_EXPIRED_NOTICE, '1');
                try { location.reload(); } catch (e) {}
            });
            return;
        }
        var ov = document.createElement('div');
        ov.id = 'jouya-demo-lock';
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.97);' +
            'display:flex;align-items:center;justify-content:center;font-family:inherit;color:#e2e8f0;padding:24px;';
        ov.innerHTML =
            '<div style="max-width:440px;text-align:center;background:#1e293b;border:1px solid #334155;border-radius:18px;padding:34px 28px;box-shadow:0 20px 60px rgba(0,0,0,.5);">' +
                '<div style="font-size:46px;color:#f59e0b;margin-bottom:14px;"><i class="fas fa-lock"></i></div>' +
                '<h2 style="margin:0 0 10px;font-size:20px;color:#fff;">مهلتِ نسخهٔ آزمایشی به پایان رسید</h2>' +
                '<p style="margin:0 0 22px;font-size:13.5px;line-height:2;color:#94a3b8;">' +
                    'یک هفته استفادهٔ آزمایشی تمام شد و اطلاعات آزمایشی این دستگاه پاک شد. نسخهٔ آزمایشی دوباره روی این دستگاه فعال نمی‌شود؛ برای ادامه لطفاً حساب بسازید و کد فعال‌سازی را وارد کنید.' +
                '</p>' +
                '<button id="jouya-demo-lock-register" style="background:#1e3a5f;border:none;color:#fff;border-radius:10px;' +
                    'padding:12px 22px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;">' +
                    '<i class="fas fa-user-plus"></i> ساخت حساب / فعال‌سازی' +
                '</button>' +
            '</div>';
        document.body.appendChild(ov);
        var btn = document.getElementById('jouya-demo-lock-register');
        if (btn) btn.onclick = function () { _openRegisterFromLock(); };
        var b = document.getElementById('jouya-demo-badge'); if (b) b.remove();
    }

    // پیامِ «مهلت تمام شد» پس از پاک‌سازی و بارگذاریِ دوباره (همان کارتِ قفل)
    function _showExpiredNotice() {
        window.__jouyaDemoWiping = true;   // داده پیش‌تر پاک شده؛ فقط پیام
        _lock();
    }

    // از صفحهٔ قفل → پایانِ امنِ Demo و بازگرداندنِ صفحهٔ ثبت‌نامِ واقعی (همان مسیرِ خروجِ Demo).
    function _openRegisterFromLock() {
        _exitDemoToRegister();
    }

    // ---- بررسیِ دوره‌ای (به‌روزرسانیِ نشان + قفل هنگام پایان، حتی اگر برنامه باز بماند) ----
    var _timer = null;
    function _scheduleChecks() {
        if (_timer) return;
        _timer = setInterval(function () {
            var s = status();
            if (!s.active) return;
            if (s.expired) { clearInterval(_timer); _timer = null; _lock(); return; }
            _renderBadge();
        }, 60 * 1000);   // هر دقیقه
    }

    // ---- افزودنِ دکمهٔ «ورود به‌عنوان مهمان (نسخهٔ آزمایشی)» به پنلِ ورود ----
    function _injectButton() {
        if (_hasRealAccount()) return;                       // دستگاهِ دارای حسابِ واقعی → پیشنهاد نشود
        if (isUsed()) return;                                // نسخهٔ آزمایشی یک‌بار استفاده شده → دیگر پیشنهاد نشود
        if (!window.__jouyaDemoIdbChecked) {
            window.__jouyaDemoIdbChecked = true;
            _checkUsedIDB(function (used) {
                if (!used) return;
                var bb = document.getElementById('jouya-demo-login-btn'); if (bb && bb.parentNode) bb.parentNode.remove();
            });
        }
        var panel = document.getElementById('auth-panel-login');
        if (!panel) return;
        if (document.getElementById('jouya-demo-login-btn')) return;
        var wrap = document.createElement('div');
        wrap.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px dashed #cbd5e1;text-align:center;';
        wrap.innerHTML =
            '<button id="jouya-demo-login-btn" type="button" style="width:100%;background:#fff;border:1.5px solid #1e3a5f;' +
                'color:#1e3a5f;border-radius:10px;padding:11px 16px;font-family:inherit;font-weight:700;font-size:13.5px;' +
                'cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">' +
                '<i class="fas fa-user-clock"></i> ورود به‌عنوان مهمان (نسخهٔ آزمایشی یک‌هفته‌ای)' +
            '</button>';
        panel.appendChild(wrap);
        var btn = document.getElementById('jouya-demo-login-btn');
        if (btn) btn.onclick = function () { start(); };
    }

    // ---- بررسیِ اولیه هنگام بالا آمدنِ برنامه ----
    function check() {
        if (_lsGet(K_EXPIRED_NOTICE) === '1' && !_hasRealAccount()) { _showExpiredNotice(); return; }
        var s = status();
        if (!s.active) { _injectButton(); return; }   // Demo فعال نیست → فقط دکمه را اضافه کن
        if (s.expired || s.tampered) { _lock(); return; }
        _revealApp();
        _renderBadge();
        _scheduleChecks();
    }

    // ---- ناظرِ DOM: هم دکمه را در صفحهٔ ورود تزریق می‌کند، هم اگر Demo فعال است اورلیِ
    //      ورود را برمی‌دارد (بدونِ وابستگی به ترتیبِ بارگذاریِ اسکریپت‌ها) ----
    function _observe() {
        try {
            var mo = new MutationObserver(function () {
                var s = status();
                if (s.active && !s.expired && !s.tampered) {
                    if (document.getElementById('auth-screen-overlay')) _revealApp();
                } else if (!s.active) {
                    if (document.getElementById('auth-panel-login')) _injectButton();
                } else if (s.expired || s.tampered) {
                    _lock();
                }
            });
            mo.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {}
    }

    // API عمومی
    var JouyaDemo = {
        start: start,
        status: status,
        isActive: isActive,
        isUsed: isUsed,
        check: check,
        // نقطهٔ اتصالِ اختیاریِ ابری (برای سخت‌سازی در برابرِ پاک‌کردنِ localStorage).
        // اگر تعریف شود، با ('start', ts) هنگامِ شروع و می‌تواند expiryِ ابری را برگرداند.
        _cloudHook: null,
        // برای تست/پشتیبانی: پاک‌سازیِ کاملِ حالتِ Demo
        _reset: function () { try { localStorage.removeItem(K_STATE); } catch (e) {} }
    };
    if (typeof window !== 'undefined') window.JouyaDemo = JouyaDemo;

    // راه‌اندازی
    function _boot() {
        _observe();
        // اگر از «خروج Demo» برگشته‌ایم، پس از آماده‌شدنِ صفحهٔ auth، تبِ «ثبت‌نامِ واقعی» را باز کن.
        _maybeOpenRegister();
        setTimeout(check, 60);
    }
    function _maybeOpenRegister() {
        var flag = null;
        try { flag = localStorage.getItem('__jouya_demo_goto_register'); } catch (e) {}
        if (flag !== '1') return;
        var tries = 0;
        var iv = setInterval(function () {
            tries++;
            try {
                if (window.AuthUI && typeof window.AuthUI.switchTab === 'function' && document.getElementById('auth-panel-register')) {
                    window.AuthUI.switchTab('register');
                    try { localStorage.removeItem('__jouya_demo_goto_register'); } catch (e) {}
                    clearInterval(iv);
                    return;
                }
            } catch (e) {}
            if (tries > 40) { clearInterval(iv); try { localStorage.removeItem('__jouya_demo_goto_register'); } catch (e) {} }
        }, 150);
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
        else _boot();
    }

    // برای Node/تست
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { _hash: _hash, _sig: _sig };
    }
})();

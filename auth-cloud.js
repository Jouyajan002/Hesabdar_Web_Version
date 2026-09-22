/**
 * auth-cloud.js — پلِ فعال‌سازیِ ابری (فروشگاه جویا) — فاز ۴
 * =============================================================================
 * افزایشی و غیرمسدودکننده. جای‌گزینِ مکانیزمِ گیت‌هاب برای هویت و لایسنس با
 * Supabase Auth + جدولِ licenses می‌شود، اما **گیتِ محلیِ فعلی را نمی‌شکند**:
 *   • اگر ابر در دسترس نباشد یا خطا کند، ورود/ثبت‌نام/فعال‌سازیِ محلی مثلِ همیشه کار می‌کند.
 *   • کاربرانِ فعلی مختل نمی‌شوند؛ حسابِ ابری «روی» حسابِ محلی ساخته/متصل می‌شود.
 *
 * وابسته به sync-layer.js (window.JouyaSync). اگر آن نبود، همه‌چیز بی‌صدا no-op می‌شود.
 * =============================================================================
 */
(function () {
    'use strict';
    if (window._jouyaAuthCloudInstalled) return;
    window._jouyaAuthCloudInstalled = true;

    var log  = function () { try { console.log.apply(console, ['%c[auth-cloud]', 'color:#fff;background:#7c3aed;padding:2px 6px;border-radius:3px'].concat([].slice.call(arguments))); } catch (e) {} };
    var warn = function () { try { console.warn.apply(console, ['[auth-cloud]'].concat([].slice.call(arguments))); } catch (e) {} };

    function LS_get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function LS_set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

    var LINK_KEY = 'jouya_cloud_linked';   // { email, workspaceId, at }

    function sync() { return window.JouyaSync || null; }
    function linked() { try { return JSON.parse(LS_get(LINK_KEY) || 'null'); } catch (e) { return null; } }
    function setLinked(email, workspaceId) { LS_set(LINK_KEY, JSON.stringify({ email: (email || '').toLowerCase(), workspaceId: workspaceId, at: new Date().toISOString() })); }

    // ایمیلِ آخرین کاربرِ این دستگاه (برای تشخیصِ «تعویضِ کاربر»).
    function prevLocalEmail() {
        var e = '';
        try { var acc = JSON.parse(LS_get('jouya_user_account') || 'null'); if (acc && acc.email) e = String(acc.email).toLowerCase(); } catch (x) {}
        if (!e) { try { var lk = linked(); if (lk && lk.email) e = String(lk.email).toLowerCase(); } catch (x) {} }
        return e;
    }

    // reset امنِ Local Context هنگامِ «ورودِ کاربرِ متفاوت».
    // مهم: این کار داده‌های کاربرِ قبلی را از ابر حذف نمی‌کند — فقط نسخهٔ محلی و حالتِ سینک را
    // پاک می‌کند تا نشت نکند. داده‌های کاربرِ قبلی در workspace/ابرِ خودش امن است و با ورودِ
    // مجددِ او از ابر Restore می‌شود (نیازی به Import JSON نیست). داده‌های unsynced باید پیش از
    // این (هنگامِ Logout) flush شده باشند.
    // device_key عمداً دست‌نخورده می‌ماند (هویتِ دستگاه نباید بی‌دلیل عوض شود).
    var USER_DATA_KEYS = ['persons', 'products', 'transactions', 'expenses', 'cashboxes', 'returns',
        'warehouses', 'warehouseTransfers', 'activeWarehouseId', 'cashboxTransactions', 'services',
        'jouya-currencies', 'jouya-exchange-rates', 'jouya-reference-rates', 'settings', 'dashboardStats'];
    var SYNC_STATE_KEYS = ['jouya_sync_snapshot', 'jouya_sync_cursor', 'jouya_sync_migrated', 'jouya_sync_workspace', 'jouya_sync_outbox', 'jouya_sync_conflicts'];
    function resetLocalContextForNewUser() {
        var S = sync();
        try { if (S && S.signOut) S.signOut(); } catch (e) {}     // بستنِ نشستِ قبلی + توقفِ حلقه‌ها/Realtime
        SYNC_STATE_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        USER_DATA_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        try { localStorage.removeItem(LINK_KEY); } catch (e) {}
        try { console.log('[auth-cloud] تعویضِ کاربر: Local Context کاربرِ قبلی پاک شد (داده‌اش در ابر امن است).'); } catch (e) {}
    }

    // نسخهٔ «امنِ پس از ورودِ موفق»: داده و حالتِ سینکِ کاربرِ قبلی را پاک می‌کند اما نشستِ
    // تازه‌ساخته را نگه می‌دارد (jouya_sync_session و workspaceِ کاربرِ جدید حذف نمی‌شوند).
    // این تضمین می‌کند reset فقط پس از احرازِ هویتِ موفق و برای «کاربرِ متفاوت» انجام شود
    // (نه پیش از signIn)، پس ورودِ ناموفق هرگز داده‌ی محلی را نمی‌بازد یا push نمی‌کند.
    var SESSION_KEEP_KEYS = ['jouya_sync_session', 'jouya_sync_workspace'];
    function resetPrevUserKeepSession() {
        var S = sync();
        try { if (S && S.stop) S.stop(); } catch (e) {}   // فقط حلقه‌ها را متوقف کن (نه signOut → نشست حفظ شود)
        SYNC_STATE_KEYS.forEach(function (k) {
            if (SESSION_KEEP_KEYS.indexOf(k) !== -1) return;   // workspaceِ کاربرِ جدید را نگه دار
            try { localStorage.removeItem(k); } catch (e) {}
        });
        USER_DATA_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        try { localStorage.removeItem(LINK_KEY); } catch (e) {}
        try { console.log('[auth-cloud] تعویضِ کاربر (پس از ورودِ موفق): داده‌ی محلیِ کاربرِ قبلی پاک شد؛ نشستِ جدید حفظ شد.'); } catch (e) {}
    }

    // ---------------------------------------------------------------------------
    //  ساختِ/اتصالِ حسابِ ابری با ایمیل+رمزِ همان کاربر.
    //  اول signIn؛ اگر کاربر وجود نداشت، signUp سپس signIn. برمی‌گرداند {ok, workspaceId}.
    // ---------------------------------------------------------------------------
    function ensureCloudAccount(email, password) {
        var S = sync();
        if (!S) return Promise.resolve({ ok: false, reason: 'no-sync' });
        email = (email || '').trim().toLowerCase();
        if (!email || !password) return Promise.resolve({ ok: false, reason: 'no-creds' });

        return S.signIn(email, password)
            .then(function (r) { return { ok: true, workspaceId: r.workspaceId, user: r.user }; })
            .catch(function () {
                // شاید کاربر هنوز در ابر نیست → ثبت‌نام، سپس ورود
                return S.signUp(email, password)
                    .then(function () { return S.signIn(email, password); })
                    .then(function (r) { return { ok: true, workspaceId: r.workspaceId, user: r.user }; })
                    .catch(function (e) { warn('اتصالِ حسابِ ابری ناموفق:', e && e.message); return { ok: false, reason: 'auth-failed', error: e }; });
            });
    }

    // ---------------------------------------------------------------------------
    //  ادعای لایسنس در ابر (اختیاری — اگر کد داده شود). خطاها بی‌صدا؛ محلی مختل نمی‌شود.
    // ---------------------------------------------------------------------------
    function claimIfCode(code, workspaceId) {
        var S = sync();
        if (!S || !code) return Promise.resolve({ ok: true, skipped: true });
        return S.claimLicense(code, workspaceId)
            .then(function (res) { return res || { ok: true }; })
            .catch(function (e) { warn('claimLicense ناموفق:', e && e.message); return { ok: false, error: e }; });
    }

    // ---------------------------------------------------------------------------
    //  دانلودِ کامل از ابر (bootstrap) سپس شروعِ سینکِ زنده. امن در همهٔ حالت‌ها:
    //  bootstrap «اول دانلود، بعد آپلود (union)» است و هیچ‌وقت داده‌ای حذف نمی‌کند —
    //  فقط رکوردهایی که این دستگاه ندارد را از ابر می‌آورد و رکوردهای فقط‌محلی را بالا می‌برد.
    //  bootstrap کلید ماجرا: cursor را به epoch ریست می‌کند و همهٔ ابر را می‌کشد، پس هر
    //  کمبودِ محلی (کاملِ پس از «حذف دیتابیس»، یا جزئیِ پس از «حذف افراد») کامل بازیابی می‌شود.
    // ---------------------------------------------------------------------------
    function fullRestoreThenStart(workspaceId) {
        var S = sync();
        var boot = (S.bootstrap ? S.bootstrap(workspaceId) : S.migrate(workspaceId));
        return boot.then(function (r) {
            try { if (S.start) S.start(); } catch (e) {}
            // پس از دانلود، برنامه را تازه کن تا داده‌های ابری فوری در UI بیایند.
            try { if (typeof window.rebuildAllDerivedData === 'function') window.rebuildAllDerivedData(); } catch (e) {}
            try { window.dispatchEvent(new CustomEvent('jouya-data-change', { detail: { reason: 'cloud-restore', remote: true } })); } catch (e) {}
            return r || { ok: true };
        }).catch(function (e) {
            warn('bootstrap ناموفق:', e && e.message);
            try { if (S.start) S.start(); } catch (x) {}   // دستِ‌کم سینکِ زنده روشن بماند (poll بعداً داده می‌آورد)
            return { ok: false, error: e };
        });
    }

    // ---------------------------------------------------------------------------
    //  مهاجرت + شروعِ سینک. best-effort.
    //  اصلاحِ باگ: پیش‌تر «اگر قبلاً migrated بود فقط start()» می‌شد؛ اما پس از «حذف کامل
    //  دیتابیس/افراد» (Local-Only Wipe) پرچمِ migrated هنوز true و cursor کهنه است، پس
    //  start() فقط تغییراتِ بعد از cursor را می‌گیرد و اکثرِ دادهٔ ابر برنمی‌گردد. اکنون
    //  «ورودِ صریحِ کاربر» همیشه یک دانلودِ کاملِ union (bootstrap) انجام می‌دهد تا هر
    //  کمبودِ محلی از ابر بازیابی شود. (Resumeِ سریعِ عادیِ باز‌شدنِ برنامه در sync-layer/
    //  autoStart دست‌نخورده است؛ این تنها مسیرِ ورودِ دستی را پوشش می‌دهد.)
    // ---------------------------------------------------------------------------
    function migrateAndStart(workspaceId) {
        var S = sync();
        if (!S) return Promise.resolve({ ok: false });
        return fullRestoreThenStart(workspaceId);
    }

    // ===========================================================================
    //  API عمومی — auth-system.js این‌ها را در نقاطِ موفقیت صدا می‌زند (همه غیرمسدودکننده)
    // ===========================================================================
    window.JouyaAuth = {
        isLinked: function () { return !!linked(); },
        linkInfo: linked,

        // -----------------------------------------------------------------------
        //  ورودِ ابری (برای دستگاهی که localStorage خالی است: دستگاهِ جدید یا کاربری که
        //  داده‌اش را پاک کرده). handleLogin در auth-system.js دقیقاً این را صدا می‌زند.
        //  کار: ۱) ورود به Supabase  ۲) دانلودِ کاملِ داده‌ها از ابر (bootstrap)
        //       ۳) بازگرداندنِ { ok, account, license } تا اکانتِ محلی بازسازی شود.
        //  خروجیِ ناموفق: { ok:false, reason:'network'|'invalid-credentials' }.
        // -----------------------------------------------------------------------
        login: function (email, password) {
            var S = sync();
            if (!S) return Promise.resolve({ ok: false, reason: 'no-sync' });
            email = (email || '').trim().toLowerCase();
            if (!email || !password) return Promise.resolve({ ok: false, reason: 'invalid-credentials' });
            // «تعویضِ کاربر» را پیش از ورود فقط تشخیص می‌دهیم، ولی هیچ reset/حذفی انجام نمی‌دهیم.
            // reset فقط پس از signInِ موفق و برای کاربرِ متفاوت اجرا می‌شود؛ پس ورودِ ناموفق هرگز
            // داده‌ی محلی را نمی‌بازد و push/تعویضِ workspace رخ نمی‌دهد.
            var prev = prevLocalEmail();
            var isSwitch = !!(prev && prev !== email);
            return S.signIn(email, password).then(function (r) {
                var ws = r && r.workspaceId;
                if (!ws) return { ok: false, reason: 'invalid-credentials' };
                // ✅ ورود موفق شد و workspaceِ کاربرِ جدید مشخص است → حالا (و فقط حالا) اگر کاربرِ
                //    متفاوتی است، داده‌ی محلیِ کاربرِ قبلی را پاک کن (نشستِ جدید حفظ می‌شود).
                if (isSwitch) resetPrevUserKeepSession();
                setLinked(email, ws);
                // دانلودِ کاملِ داده‌های ابری به این دستگاه (اگر bootstrap شکست خورد، ورود
                // باز هم موفق است و داده بعداً با poll می‌آید).
                var boot = (S.bootstrap ? S.bootstrap(ws) : S.migrate(ws));
                return boot.catch(function (e) { warn('bootstrap در login ناموفق:', e && e.message); return null; }).then(function () {
                    try { if (S.start) S.start(); } catch (e) {}
                    // پس از دانلود، برنامه را تازه کن تا داده‌های ابری فوری نمایش داده شوند.
                    try { if (typeof window.rebuildAllDerivedData === 'function') window.rebuildAllDerivedData(); } catch (e) {}
                    try { window.dispatchEvent(new CustomEvent('jouya-data-change', { detail: { reason: 'cloud-login', remote: true } })); } catch (e) {}
                    // پروفایلِ اکانت را از تنظیماتِ دانلودشده بساز
                    var s = {}; try { s = JSON.parse(LS_get('settings') || '{}') || {}; } catch (e) {}
                    var account = {
                        fullName: s.storeOwner || s.ownerName || '',
                        storeName: s.storeName || '',
                        phone: s.storePhone || '',
                        address: s.storeAddress || '',
                        email: email,
                        logo: s.storeLogo || null,
                        createdAt: new Date().toISOString()
                    };
                    var lic = {}; try { lic = JSON.parse(LS_get('jouya_license_info') || '{}') || {}; } catch (e) {}
                    return { ok: true, account: account, license: { code: lic.code || '' }, workspaceId: ws };
                });
            }).catch(function (e) {
                var msg = (e && e.message) || '';
                var reason = /network|failed to fetch|networkerror|timeout|fetch/i.test(msg) ? 'network' : 'invalid-credentials';
                warn("login ابری ناموفق:", msg, e && e.stack);
                return { ok: false, reason: reason, error: msg };
            });
        },

        // -----------------------------------------------------------------------
        //  تعویضِ حساب: ساختِ یک اکانتِ «جدید» در ابر و انتقالِ دقیقِ همهٔ داده‌های
        //  فعلیِ این دستگاه به workspaceِ حسابِ جدید — بدونِ حذفِ داده‌های کسب‌وکار.
        //  فقط «حالتِ سینکِ حسابِ قبلی» (snapshot/cursor/session/workspace/link) صفر
        //  می‌شود؛ کلیدهای داده (transactions/products/persons/...) اصلاً دست نمی‌خورند.
        //  مهاجرتِ سه‌مرحله‌ای با تأییدِ شمارش انجام می‌شود، پس هیچ داده‌ای گم نمی‌شود.
        //  خروجی: { ok, workspaceId, migrate, license }.
        // -----------------------------------------------------------------------
        switchToNewCloudAccount: function (email, password, licenseCode) {
            var S = sync();
            if (!S) return Promise.resolve({ ok: false, reason: 'no-sync' });
            email = (email || '').trim().toLowerCase();
            if (!email || !password) return Promise.resolve({ ok: false, reason: 'no-creds' });

            // گاردِ زمان: اگر شبکه کند بود، UI هرگز بی‌نهایت منتظر نمی‌ماند؛ داده محلی محفوظ
            // است و در پس‌زمینه/اتصالِ بعدی سینک می‌شود.
            var timed = new Promise(function (resolve) {
                setTimeout(function () { resolve({ ok: false, reason: 'timeout' }); }, 45000);
            });
            return Promise.race([this._doSwitch(email, password, licenseCode), timed]);
        },
        _doSwitch: function (email, password, licenseCode) {
            var S = sync();            // ۱) صفر کردنِ «حالتِ سینکِ حسابِ قبلی» — نه داده‌ها. این تضمین می‌کند که
            //    مهاجرتِ حسابِ جدید از صفر و بدونِ تداخل با record_idهای workspaceِ قبلی انجام شود.
            try {
                ['jouya_sync_snapshot', 'jouya_sync_cursor', 'jouya_sync_migrated', 'jouya_sync_workspace']
                    .forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
                try { localStorage.removeItem(LINK_KEY); } catch (e) {}
                if (S.signOut) S.signOut();   // نشستِ ابریِ قبلی هم پاک می‌شود (نه داده‌ها)
            } catch (e) {}

            // ۲) ساختِ حسابِ ابریِ جدید + workspace
            return ensureCloudAccount(email, password).then(function (a) {
                if (!a.ok) return { ok: false, reason: a.reason, error: a.error };
                setLinked(email, a.workspaceId);
                // ۳) ادعای لایسنس (اختیاری، بی‌صدا)
                return claimIfCode(licenseCode, a.workspaceId).then(function (lic) {
                    // ۴) مهاجرتِ کاملِ داده‌های محلی به workspaceِ جدید (۳ مرحله + تأییدِ شمارش)
                    return (S.bootstrap ? S.bootstrap(a.workspaceId) : S.migrate(a.workspaceId)).then(function (m) {
                        try { if (S.start) S.start(); } catch (e) {}
                        var ok = !!(m && m.ok !== false);
                        log('تعویضِ حساب:', ok ? 'موفق' : 'مهاجرت ناتمام', a.workspaceId);
                        return { ok: ok, workspaceId: a.workspaceId, migrate: m, license: lic };
                    }).catch(function (e) {
                        warn('مهاجرتِ حسابِ جدید ناموفق:', e && e.message);
                        return { ok: false, reason: 'migrate-failed', error: e, workspaceId: a.workspaceId };
                    });
                });
            }).catch(function (e) { warn('تعویضِ حساب ناموفق:', e && e.message); return { ok: false, error: e && e.message }; });
        },

        // پس از ثبت‌نامِ موفقِ محلی: حسابِ ابری بساز + لایسنس را ادعا کن + مهاجرت
        onRegisterSuccess: function (email, password, licenseCode) {
            return ensureCloudAccount(email, password).then(function (a) {
                if (!a.ok) return { ok: false, reason: a.reason };
                setLinked(email, a.workspaceId);
                return claimIfCode(licenseCode, a.workspaceId).then(function (lic) {
                    return migrateAndStart(a.workspaceId).then(function (m) {
                        log('ثبت‌نامِ ابری کامل شد');
                        return { ok: true, license: lic, migrate: m, workspaceId: a.workspaceId };
                    });
                });
            });
        },

        // پس از ورودِ موفقِ محلی: اگر هنوز به ابر متصل نشده، متصل کن + مهاجرت (سینکِ دستگاهِ جدید)
        onLoginSuccess: function (email, password, licenseCode) {
            var lk = linked();
            if (lk && lk.email === (email || '').toLowerCase()) {
                var S = sync();
                var haveSession = !!(S && S.session && S.session() && S.session().access_token);
                if (haveSession) {
                    // نشستِ معتبر داریم. ورودِ صریح = دانلودِ کاملِ union از ابر تا هر کمبودِ
                    // محلی (کامل یا جزئی، مثلِ بعد از «حذف افراد») بازیابی شود. bootstrap امن است.
                    var ws = (S.session().workspaceId) || (lk && lk.workspaceId);
                    if (ws) return fullRestoreThenStart(ws);
                    try { if (S && S.start) S.start(); } catch (e) {}
                    return Promise.resolve({ ok: true, already: true });
                }
                // توکن نداریم (نشست پاک شده، مثلِ بعد از Logout) → دوباره وارد شو؛ سپس
                // migrateAndStart دانلودِ کاملِ union انجام می‌دهد.
                return ensureCloudAccount(email, password).then(function (a) {
                    if (a.ok) { setLinked(email, a.workspaceId); return migrateAndStart(a.workspaceId); }
                    return { ok: false };
                });
            }
            // هنوز متصل نشده → اتصال + مهاجرت
            return ensureCloudAccount(email, password).then(function (a) {
                if (!a.ok) return { ok: false, reason: a.reason };
                setLinked(email, a.workspaceId);
                return claimIfCode(licenseCode, a.workspaceId).then(function () {
                    return migrateAndStart(a.workspaceId).then(function (m) { log('ورودِ ابری کامل شد'); return { ok: true, migrate: m, workspaceId: a.workspaceId }; });
                });
            });
        },

        // برای بنرِ «فعال‌سازیِ سینکِ ابری» برای کاربرانِ فعلی: با رمزی که کاربر یک‌بار وارد می‌کند
        enableCloudForExisting: function (password) {
            var acc = null;
            try { acc = JSON.parse(LS_get('jouya_user_account') || 'null'); } catch (e) {}
            var lic = null;
            try { lic = JSON.parse(LS_get('jouya_license_info') || 'null'); } catch (e) {}
            if (!acc || !acc.email) return Promise.resolve({ ok: false, reason: 'no-local-account' });
            return this.onLoginSuccess(acc.email, password, lic && lic.code);
        },

        // اعتبارسنجیِ لایسنس در ابر بدونِ ادعا (برای فرمِ ثبت‌نام). نیازی به ورود ندارد.
        // اگر RPCِ check_license موجود نبود یا ابر نبود، null برمی‌گرداند تا auth-system به
        // مسیرِ محلی/فالبکِ خودش برگردد (مختل نمی‌شود).
        checkLicense: function (code) {
            var S = sync();
            if (!S || !S._sb) return Promise.resolve(null);
            return S._sb.rpc('check_license', { p_code: (code || '').trim().toUpperCase() })
                .then(function (res) { return res || null; })
                .catch(function () { return null; });
        },

        signOut: function () {
            var S = sync();
            try { if (S && S.signOut) S.signOut(); } catch (e) {}
            try { localStorage.removeItem(LINK_KEY); } catch (e) {}
        },

        // ---------------------------------------------------------------------
        //  خروجِ «کاملِ» محلی: اکانت + نشست + همهٔ دادهٔ محلیِ این دستگاه پاک می‌شود، اما
        //  فضای ابری دست‌نخورده می‌ماند. برای «خروج از حساب» به‌کار می‌رود تا:
        //    • هیچ اطلاعاتِ اکانت/داده‌ای روی این دستگاه نماند (بدونِ نیاز به دستورِ کنسول)،
        //    • ورودِ بعدی «از فضای ابری» انجام شود (اکانت و داده از ابر Restore می‌شود)،
        //    • ساختِ «اکانتِ جدید» بدونِ تداخل با بازمانده‌های اکانتِ قبلی ممکن شود.
        //  امنیت: چون اول signOut می‌شود (نشست null + توقفِ حلقه‌ها) و اصلاحِ pushNow بدونِ
        //  نشست push نمی‌کند، هیچ Delete/tombstone به ابر نمی‌رود. فقط localStorageِ همین
        //  دستگاه پاک می‌شود؛ device_id و ترجیحاتِ دستگاه (قفل/دارک‌مود/چاپ) حفظ می‌شوند.
        //  ابتدا تغییراتِ همگام‌نشده (اگر آنلاین) flush می‌شود تا داده گم نشود.
        fullSignOut: function () {
            var S = sync();
            var offline = (typeof navigator !== 'undefined' && navigator && navigator.onLine === false);
            var flush = (S && S.pushNow && !offline) ? Promise.resolve(S.pushNow()) : Promise.resolve();
            return flush.catch(function () {}).then(function () {
                try { if (S && S.signOut) S.signOut(); } catch (e) {}   // نشست null + توقفِ push/pull/Realtime
                // کلیدهایی که باید «حفظ» شوند: هویتِ دستگاه + ترجیحات/امنیتِ دستگاه (نه دادهٔ اکانت).
                var PRESERVE = { 'jouya_device_id': 1, 'darkMode': 1, 'numberSystem': 1,
                    'dbLockEnabled': 1, 'dbLockHash': 1, 'sysPassword': 1 };
                try {
                    var keys = [];
                    for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
                    keys.forEach(function (k) {
                        if (!k) return;
                        if (PRESERVE[k]) return;
                        if (k.indexOf('print-') === 0) return;   // تنظیماتِ چاپِ دستگاه حفظ شود
                        try { localStorage.removeItem(k); } catch (e) {}
                    });
                    console.log('[auth-cloud] خروجِ کامل: همهٔ دادهٔ محلیِ این دستگاه پاک شد (ابر دست‌نخورده؛ device_id و ترجیحاتِ دستگاه حفظ شد).');
                } catch (e) {}
                return { ok: true };
            });
        },

        // Logout امن: ابتدا تغییراتِ unsyncedِ کاربرِ فعلی را به ابرِ خودش flush کن (تا داده‌ی
        // ثبت‌شده در حالتِ آفلاین گم نشود)، سپس نشستِ سینک را ببند. داده‌های محلی/اکانت عمداً
        // پاک نمی‌شوند تا ورودِ مجددِ همان کاربر فوری و آفلاین بماند (نشتِ بین‌کاربری هنگامِ
        // ورودِ کاربرِ متفاوت، در login() مدیریت می‌شود). خروجی یک Promise است.
        logout: function () {
            var S = sync();
            var flush = Promise.resolve();
            try {
                var offline = (typeof navigator !== 'undefined' && navigator && navigator.onLine === false);
                if (S && S.pushNow && !offline) flush = Promise.resolve(S.pushNow());
            } catch (e) {}
            return flush.catch(function () {}).then(function () {
                try { if (S && S.signOut) S.signOut(); } catch (e) {}
                try { localStorage.removeItem(LINK_KEY); } catch (e) {}
                return { ok: true };
            });
        }
    };

    // ===========================================================================
    //  راه‌اندازیِ خودکار برای کاربرانِ فعلی:
    //  اگر کاربر از قبل واردِ برنامه است (حسابِ محلی + ورودِ به‌خاطر‌سپرده) و هنوز به ابر
    //  متصل نشده، در اولین اجرا بی‌صدا تلاش می‌کنیم متصل + مهاجرت کنیم. غیرمسدودکننده و
    //  best-effort؛ اگر نشد، برنامه دقیقاً مثلِ قبل کار می‌کند.
    // ===========================================================================
    function autoLinkExisting() {
        try {
            if (!sync()) return;
            if (linked()) { // قبلاً متصل — فقط سینک را روشن کن
                try { var S = sync(); if (S && S.session && S.session() && S.start) S.start(); } catch (e) {}
                return;
            }
            var acc = null, rem = null;
            try { acc = JSON.parse(LS_get('jouya_user_account') || 'null'); } catch (e) {}
            try { rem = JSON.parse(LS_get('jouya_remember_login') || 'null'); } catch (e) {}
            if (!acc || !acc.email || !rem || !rem.email || !rem.password) return;
            if ((rem.email || '').toLowerCase() !== (acc.email || '').toLowerCase()) return;
            var lic = null; try { lic = JSON.parse(LS_get('jouya_license_info') || 'null'); } catch (e) {}
            log('کاربرِ فعلی شناسایی شد — تلاش برای اتصالِ ابری در پس‌زمینه');
            window.JouyaAuth.onLoginSuccess(rem.email, rem.password, lic && lic.code)
                .then(function (r) { if (r && r.ok) log('کاربرِ فعلی با موفقیت به ابر متصل شد'); })
                .catch(function () {});
        } catch (e) {}
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('load', function () { setTimeout(autoLinkExisting, 1500); });
    }

    log('پلِ فعال‌سازیِ ابری بارگذاری شد. sync=', !!sync());
})();

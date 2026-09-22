/**
 * jouya-selftest.js — ابزارِ تشخیصِ کاملِ سینک و احراز هویت (فروشگاه جویا)
 * =============================================================================
 * این فایل را موقتاً کنارِ بقیه بگذارید و یک <script src="jouya-selftest.js"></script>
 * در انتهای index.html اضافه کنید (یا کلِ محتوا را در Console بچسبانید).
 *
 * سپس در Console بزنید:   await JouyaTest.run()
 *
 * خروجی یک گزارشِ کامل است که می‌توانید کپی کنید و بفرستید. متنِ کاملِ خطاهای
 * سرور (به‌جای فقط «۵۰۰») و وضعیتِ همهٔ بخش‌ها را نشان می‌دهد. هیچ داده‌ای را
 * تغییر نمی‌دهد جز یک رکوردِ آزمایشیِ موقت که خودش پاک می‌کند.
 * =============================================================================
 */
(function () {
    'use strict';

    var CFG = window.JOUYA_SYNC_CONFIG || {};
    var URL = (CFG.url || '').replace(/\/+$/, '');
    var ANON = CFG.anonKey || '';

    var out = [];
    function line(s) { out.push(s); }
    function hr() { line('────────────────────────────────────────'); }
    function ok(b) { return b ? '✅' : '❌'; }

    function tokenOf() {
        try { var s = JSON.parse(localStorage.getItem('jouya_sync_session') || 'null'); return s && s.access_token; } catch (e) { return null; }
    }
    function headers(extra) {
        var h = { 'apikey': ANON, 'Authorization': 'Bearer ' + (tokenOf() || ANON), 'Content-Type': 'application/json' };
        if (extra) for (var k in extra) h[k] = extra[k];
        return h;
    }
    function readArr(k) { try { var v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function readObj(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }

    // درخواستِ خام با نمایشِ متنِ کاملِ خطا
    function rawReq(method, path, body, extraHeaders) {
        return fetch(URL + path, {
            method: method, headers: headers(extraHeaders),
            body: body ? JSON.stringify(body) : undefined
        }).then(function (r) {
            return r.text().then(function (t) {
                var data = null; try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
                return { status: r.status, ok: r.ok, data: data, raw: t };
            });
        });
    }

    var COLLECTIONS = [
        ['transactions', 'transactions'], ['products', 'products'], ['persons', 'persons'],
        ['expenses', 'expenses'], ['cashboxes', 'cashboxes'], ['cashboxTransactions', 'cashbox_transactions'],
        ['returns', 'returns'], ['warehouses', 'warehouses'], ['warehouseTransfers', 'warehouse_transfers'],
        ['services', 'services'], ['jouya-currencies', 'currencies'], ['jouya-exchange-rates', 'exchange_rates']
    ];

    var JouyaTest = {
        async run() {
            out = [];
            line('══════════ گزارشِ تشخیصِ جویا ══════════');
            line('زمان: ' + new Date().toISOString());
            hr();

            // ۱) پیکربندی
            line('۱) پیکربندی');
            line('  ' + ok(!!URL) + ' Supabase URL: ' + (URL || '(خالی)'));
            line('  ' + ok(!!ANON) + ' anon key: ' + (ANON ? (ANON.slice(0, 12) + '…') : '(خالی)'));
            line('  ' + ok(!!window.JouyaSync) + ' sync-layer.js بارگذاری شده');
            line('  ' + ok(!!window.JouyaAuth) + ' auth-cloud.js بارگذاری شده');
            line('  liveSyncEnabled: ' + !!CFG.liveSyncEnabled);
            hr();

            // ۲) وضعیتِ اکانت‌های محلی
            line('۲) اکانت‌های محلی و فعال‌سازی');
            var acc = readObj('jouya_user_account');
            var lic = readObj('jouya_license_info');
            var rem = readObj('jouya_remember_login');
            var linked = readObj('jouya_cloud_linked');
            line('  اکانتِ محلیِ فعلی (jouya_user_account): ' + (acc ? (acc.email || '(بدون ایمیل)') : '(هیچ)'));
            line('  لایسنسِ محلی: ' + (lic ? (lic.code || '(بدون کد)') : '(هیچ)'));
            line('  ورودِ به‌خاطر‌سپرده: ' + (rem ? (rem.email || '') : '(هیچ)'));
            line('  متصل به ابر (jouya_cloud_linked): ' + (linked ? (linked.email + ' → ' + linked.workspaceId) : '(خیر)'));
            line('  ⚠️ توجه: معماریِ فعلی روی هر دستگاه فقط «یک» اکانتِ محلی نگه می‌دارد.');
            line('     ثبت‌نامِ اکانتِ جدید، اکانتِ محلیِ قبلی را جای‌گزین می‌کند (نه داده‌ها را).');
            hr();

            // ۳) نشستِ ابری
            line('۳) نشستِ ابری (Auth)');
            var sess = readObj('jouya_sync_session');
            line('  ' + ok(!!(sess && sess.access_token)) + ' توکنِ دسترسی موجود: ' + (sess && sess.access_token ? 'بله' : 'خیر'));
            line('  ایمیلِ نشست: ' + (sess && sess.email || '(هیچ)'));
            line('  workspaceId: ' + (sess && sess.workspaceId || readObj('jouya_sync_workspace') || '(هیچ)'));
            if (sess && sess.expires_at) line('  انقضای توکن: ' + new Date(sess.expires_at).toISOString());
            hr();

            // ۴) اتصال به سرور
            line('۴) اتصال به Supabase');
            try {
                var ping = await rawReq('GET', '/rest/v1/');
                line('  ' + ok(ping.status < 500) + ' پاسخِ REST: HTTP ' + ping.status);
            } catch (e) { line('  ❌ اتصال ناموفق: ' + e.message); }
            hr();

            // ۵) شمارشِ محلی در برابر ابر
            line('۵) شمارشِ رکوردها (محلی → ابر)');
            var ws = (sess && sess.workspaceId) || readObj('jouya_sync_workspace');
            if (!ws) {
                line('  ⚠️ workspaceId نداریم — اول وارد شوید (JouyaSync.signIn).');
            } else {
                for (var i = 0; i < COLLECTIONS.length; i++) {
                    var key = COLLECTIONS[i][0], table = COLLECTIONS[i][1];
                    var localN = readArr(key).length;
                    var cloudN = '?';
                    try {
                        var cr = await fetch(URL + '/rest/v1/' + table + '?workspace_id=eq.' + encodeURIComponent(ws) + '&deleted_at=is.null&select=record_id',
                            { method: 'HEAD', headers: headers({ 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' }) });
                        var range = cr.headers.get('content-range') || '';
                        cloudN = range.split('/')[1] || '0';
                    } catch (e) { cloudN = 'خطا'; }
                    var match = String(localN) === String(cloudN);
                    line('  ' + (match ? '✅' : '⚠️') + ' ' + table + ': محلی=' + localN + ' ابر=' + cloudN);
                }
            }
            hr();

            // ۶) تستِ نوشتنِ واقعی (کشفِ علتِ خطای ۵۰۰) — رویِ جدولِ currencies
            line('۶) تستِ نوشتنِ زنده (کشفِ علتِ خطای ۵۰۰)');
            if (!ws) {
                line('  ⚠️ workspaceId نداریم — از این تست صرفِ‌نظر شد.');
            } else {
                var testRid = '__selftest__:' + Date.now();
                var testRow = { workspace_id: ws, record_id: testRid, data: { code: '__SELFTEST__', nameLocal: 'تست' }, device_key: 'SELFTEST' };
                // ۶-الف) بدونِ فرستادنِ updated_at/revision (مثلِ فاز ۳ — نیازمندِ trigger)
                var w1 = await rawReq('POST', '/rest/v1/currencies?on_conflict=workspace_id,record_id', [testRow], { 'Prefer': 'resolution=merge-duplicates,return=representation' });
                line('  ۶-الف) نوشتن بدونِ زمان (نیازمندِ trigger فاز۳): HTTP ' + w1.status + ' ' + (w1.ok ? '✅' : '❌'));
                if (!w1.ok) {
                    line('        متنِ کاملِ خطای سرور:');
                    line('        ' + JSON.stringify(w1.data));
                }
                // ۶-ب) با فرستادنِ updated_at/revision صریح (اگر trigger نباشد این باید کار کند)
                var testRow2 = { workspace_id: ws, record_id: testRid, data: { code: '__SELFTEST__', nameLocal: 'تست' }, device_key: 'SELFTEST', updated_at: new Date().toISOString(), revision: 1 };
                var w2 = await rawReq('POST', '/rest/v1/currencies?on_conflict=workspace_id,record_id', [testRow2], { 'Prefer': 'resolution=merge-duplicates,return=representation' });
                line('  ۶-ب) نوشتن با زمانِ صریح: HTTP ' + w2.status + ' ' + (w2.ok ? '✅' : '❌'));
                if (!w2.ok) { line('        متنِ خطا: ' + JSON.stringify(w2.data)); }

                // تشخیص
                if (w1.ok) {
                    line('  → نتیجه: trigger فاز۳ نصب است و نوشتن درست کار می‌کند. ✅');
                } else if (w2.ok) {
                    line('  → نتیجه: ⚠️ trigger فاز۳ (supabase-trigger.sql) هنوز اجرا نشده!');
                    line('     برای همین نوشتنِ بدونِ زمان خطا می‌دهد. لطفاً supabase-trigger.sql را اجرا کنید.');
                } else {
                    line('  → نتیجه: ❌ هر دو حالت خطا داد. متنِ خطای بالا علت را نشان می‌دهد');
                    line('     (احتمالاً RLS/عضویت workspace یا نبودِ ستون).');
                }

                // پاک‌سازیِ رکوردِ آزمایشی
                try { await rawReq('PATCH', '/rest/v1/currencies?workspace_id=eq.' + encodeURIComponent(ws) + '&record_id=eq.' + encodeURIComponent(testRid), { deleted_at: new Date().toISOString(), device_key: 'SELFTEST' }); line('  (رکوردِ آزمایشی حذف شد)'); } catch (e) {}
            }
            hr();

            // ۷) وضعیتِ مهاجرت و سینک
            line('۷) مهاجرت و سینک');
            line('  jouya_sync_migrated: ' + (localStorage.getItem('jouya_sync_migrated') || '(خیر)'));
            line('  cursor: ' + (localStorage.getItem('jouya_sync_cursor') || '(هیچ)'));
            var outbox = readArr('jouya_sync_outbox');
            line('  صفِ آفلاین (outbox): ' + outbox.length + ' مورد');
            var snap = readObj('jouya_sync_snapshot') || {};
            var snapCounts = Object.keys(snap).map(function (t) { return t + '=' + Object.keys(snap[t] || {}).length; });
            line('  snapshot: ' + (snapCounts.length ? snapCounts.join(', ') : '(خالی)'));
            hr();

            // ۸) بررسیِ داده‌های تکراری یا خرابِ محلی
            line('۸) سلامتِ دادهٔ محلی');
            for (var j = 0; j < COLLECTIONS.length; j++) {
                var kk = COLLECTIONS[j][0];
                var arr = readArr(kk);
                var ids = {}, dup = 0, noId = 0;
                arr.forEach(function (r) {
                    var id = r && (r.id != null ? r.id : r._id);
                    if (id == null) { noId++; return; }
                    if (ids[id]) dup++; ids[id] = true;
                });
                if (arr.length && (dup || noId)) {
                    line('  ⚠️ ' + kk + ': ' + arr.length + ' رکورد، ' + dup + ' تکراری، ' + noId + ' بدونِ شناسه');
                }
            }
            line('  (اگر خطی نیامد، یعنی داده‌ی محلی سالم است ✅)');
            hr();

            line('══════════ پایانِ گزارش ══════════');
            var report = out.join('\n');
            console.log('%c' + report, 'font-family:monospace;font-size:12px;');
            try { await navigator.clipboard.writeText(report); console.log('%c✅ گزارش در کلیپ‌بورد کپی شد — می‌توانید بچسبانید و بفرستید.', 'color:#16a34a;font-weight:bold'); } catch (e) { console.log('(برای کپی: متنِ بالا را دستی انتخاب کنید)'); }
            return report;
        },

        // تستِ زندهٔ سینک: یک محصولِ آزمایشی می‌سازد، push می‌کند، از ابر می‌خواند، پاک می‌کند.
        async testRoundTrip() {
            if (!window.JouyaSync) { console.log('❌ JouyaSync نیست'); return; }
            var S = window.JouyaSync;
            var ws = (S.session && S.session() && S.session().workspaceId) || readObj('jouya_sync_workspace');
            if (!ws) { console.log('❌ اول وارد شوید'); return; }
            console.log('در حال تستِ رفت‌وبرگشتِ سینک…');
            var before = readArr('products').length;
            var testProd = { id: 'RT-' + Date.now(), name: 'محصولِ تستِ سینک', stock: 0, __selftest: true };
            var prods = readArr('products'); prods.push(testProd); localStorage.setItem('products', JSON.stringify(prods));
            await S.pushNow();
            console.log('  push انجام شد. حالا از ابر می‌خوانیم…');
            var res = await fetch(URL + '/rest/v1/products?workspace_id=eq.' + encodeURIComponent(ws) + '&select=record_id,data&limit=1000', { headers: headers() });
            var rows = await res.json();
            var found = Array.isArray(rows) && rows.some(function (r) { return r.data && r.data.id === testProd.id; });
            console.log('  ' + (found ? '✅ محصولِ تست در ابر پیدا شد — سینک کار می‌کند!' : '❌ در ابر پیدا نشد'));
            // پاک‌سازی
            var cleaned = readArr('products').filter(function (p) { return p.id !== testProd.id; });
            localStorage.setItem('products', JSON.stringify(cleaned));
            await S.pushNow();
            console.log('  (محصولِ تست پاک شد)');
            return found;
        },

        // نمایشِ همهٔ کلیدهای localStorage مرتبط با اکانت (برای عیب‌یابیِ ورودِ اکانتِ قدیمی)
        // تشخیصِ «چرا داده از ابر نمی‌آید»: به‌زور از ابر دانلود می‌کند و گزارش می‌دهد
        // که آیا نشست/workspace هست، ابر چند رکورد دارد، و بعد از دانلود لوکال چند رکورد شد.
        async forceDownload() {
            var sess = readObj('jouya_sync_session');
            var ws = (sess && sess.workspaceId) || readObj('jouya_sync_workspace');
            console.log('%c— تشخیصِ دانلود از ابر —', 'font-weight:bold;color:#2563eb');
            console.log('نشست:', sess ? ('بله ('+(sess.email||'')+')') : '❌ نیست — اول وارد شوید');
            console.log('workspace:', ws || '❌ نیست');
            if (!ws) { console.log('❌ بدونِ workspace نمی‌توان دانلود کرد. اول وارد شوید.'); return; }
            // شمارشِ ابر
            var total = 0;
            for (var i = 0; i < COLLECTIONS.length; i++) {
                var table = COLLECTIONS[i][1];
                try {
                    var cr = await fetch(URL + '/rest/v1/' + table + '?workspace_id=eq.' + encodeURIComponent(ws) + '&deleted_at=is.null&select=record_id',
                        { method: 'HEAD', headers: headers({ 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' }) });
                    var n = parseInt((cr.headers.get('content-range') || '0-0/0').split('/')[1] || '0', 10);
                    total += n;
                    if (n > 0) console.log('  ابر ' + table + ': ' + n + ' رکورد');
                } catch (e) {}
            }
            console.log('مجموعِ رکوردهای ابر:', total);
            if (total === 0) { console.log('⚠️ ابر برای این workspace خالی است — یعنی داده‌ها با اکانت/workspaceِ دیگری ذخیره شده‌اند. با همان اکانتی وارد شوید که داده را ساخته.'); return; }
            // دانلودِ واقعی از طریقِ bootstrap
            if (window.JouyaSync && window.JouyaSync.bootstrap) {
                console.log('در حال دانلود (bootstrap)...');
                var r = await window.JouyaSync.bootstrap(ws);
                console.log('نتیجهٔ bootstrap:', JSON.stringify(r));
                try { if (window.rebuildAllDerivedData) window.rebuildAllDerivedData(); } catch (e) {}
                // شمارشِ لوکال بعد از دانلود
                var localTotal = 0;
                COLLECTIONS.forEach(function (c) { localTotal += readArr(c[0]).length; });
                console.log('%c✅ بعد از دانلود، لوکال ' + localTotal + ' رکورد دارد. صفحه را رفرش کنید (F5) تا در UI ببینید.', 'color:#16a34a;font-weight:bold');
            } else {
                console.log('❌ JouyaSync.bootstrap موجود نیست — نسخهٔ جدیدِ sync-layer.js را نصب کنید.');
            }
        },

        accounts() {
            console.log('اکانتِ محلیِ فعلی:', readObj('jouya_user_account'));
            console.log('لایسنس:', readObj('jouya_license_info'));
            console.log('به‌خاطر‌سپرده:', readObj('jouya_remember_login'));
            console.log('متصل‌به‌ابر:', readObj('jouya_cloud_linked'));
            console.log('نشستِ ابری:', readObj('jouya_sync_session'));
            console.log('⚠️ روی هر دستگاه فقط یک اکانتِ محلی نگه‌داری می‌شود. برای چند اکانت باید از ابر (ورودِ آنلاین) استفاده شود.');
        },

        // تعمیر: snapshotِ ارز/تنظیمات را پاک می‌کند تا رکوردهای شناسه‌تصادفیِ قدیمی
        // «حذفِ شبح» نسازند، سپس یک push تمیز می‌زند. بی‌خطر — فقط snapshot را دست می‌زند.
        async repair() {
            try {
                var snap = readObj('jouya_sync_snapshot') || {};
                var removed = [];
                ['currencies', 'store_settings'].forEach(function (t) {
                    if (snap[t]) { removed.push(t + '(' + Object.keys(snap[t]).length + ')'); delete snap[t]; }
                });
                localStorage.setItem('jouya_sync_snapshot', JSON.stringify(snap));
                console.log('%c🔧 snapshot پاک‌سازی شد: ' + (removed.join(', ') || 'چیزی نبود'), 'color:#7c3aed;font-weight:bold');
                if (window.JouyaSync && window.JouyaSync.pushNow) {
                    await window.JouyaSync.pushNow();
                    console.log('✅ push تمیز انجام شد. حالا دوباره JouyaTest.run() را بزنید تا شمارشِ ارز هماهنگ شود.');
                }
            } catch (e) { console.log('❌ تعمیر ناموفق:', e.message); }
        }
    };

    window.JouyaTest = JouyaTest;
    console.log('%c✅ ابزارِ تستِ جویا آماده است. بزنید: await JouyaTest.run()', 'color:#fff;background:#2563eb;padding:4px 8px;border-radius:4px;font-weight:bold');
})();

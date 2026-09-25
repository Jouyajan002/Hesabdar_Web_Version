/**
 * sync-layer.js — لایهٔ سینکِ ابریِ فروشگاه جویا (فاز ۳ — کامل)
 * =============================================================================
 * افزایشی، بدونِ تغییرِ کدِ فعلی (مثلِ delivery-list.js). منبعِ محلی
 * (localStorage + کلاسِ Database) دست‌نخورده می‌ماند. طبقِ SYNC-CONTRACT.md.
 *
 * این نسخه شاملِ:
 *   • Push:  تشخیصِ تغییرِ محلی با diff نسبت به آخرین snapshot → آپلود (upsert)
 *   • Pull:  polling نسبت به cursorِ زمان (تضمینی) + شتاب‌دهندهٔ Realtime WebSocket
 *   • حلِ تعارض: آخرین‌نوشته‌بُرد روی updated_at (سپس revision، سپس device_key)
 *   • حذفِ نرم (soft delete) و اعمالِ آن روی همهٔ دستگاه‌ها
 *   • صفِ آفلاین + تلاشِ دوباره هنگامِ اتصال
 *   • تازه‌سازیِ توکنِ ورود (برای نشست‌های طولانیِ دسکتاپ)
 *   • جلوگیری از حلقه: پرچمِ _applyingRemote + هم‌گام‌سازیِ snapshot
 *
 * فقط دادهٔ خام سینک می‌شود؛ موجودی/FIFO/مانده روی هر دستگاه با
 * rebuildAllDerivedData بازساخته می‌شوند.
 * =============================================================================
 */
(function () {
    'use strict';
    if (window._jouyaSyncInstalled) return;
    window._jouyaSyncInstalled = true;

    var CFG = window.JOUYA_SYNC_CONFIG || {};
    var log  = function () { try { console.log.apply(console, ['%c[sync]', 'color:#fff;background:#2563eb;padding:2px 6px;border-radius:3px'].concat([].slice.call(arguments))); } catch (e) {} };
    var warn = function () { try { console.warn.apply(console, ['[sync]'].concat([].slice.call(arguments))); } catch (e) {} };

    // ===========================================================================
    //  کلیدها و پیکربندی
    // ===========================================================================
    var COLLECTIONS = [
        { key: 'transactions',        table: 'transactions' },
        { key: 'products',            table: 'products' },
        { key: 'persons',             table: 'persons' },
        { key: 'expenses',            table: 'expenses' },
        { key: 'cashboxes',           table: 'cashboxes' },
        { key: 'cashboxTransactions', table: 'cashbox_transactions' },
        { key: 'returns',             table: 'returns' },
        { key: 'warehouses',          table: 'warehouses' },
        { key: 'warehouseTransfers',  table: 'warehouse_transfers' },
        { key: 'services',            table: 'services' },
        { key: 'jouya-currencies',    table: 'currencies' },
        { key: 'jouya-exchange-rates',table: 'exchange_rates' }
    ];
    var TABLE_BY_KEY = {}; COLLECTIONS.forEach(function (c) { TABLE_BY_KEY[c.key] = c.table; });
    var KEY_BY_TABLE = {}; COLLECTIONS.forEach(function (c) { KEY_BY_TABLE[c.table] = c.key; });

    var STORE_SETTING_KEYS = [
        'settings', 'jouya-reference-rates', 'jouya-asset-kinds',
        'customProductCategories', 'customProductSubCategories', 'customProductUnits',
        'customPersonCategories', 'customExpenseCategories'
    ];
    var STORE_SETTINGS_TABLE = 'store_settings';

    // ── کاهشِ مصرفِ پهنای‌باندِ سوپابیس (Egress) ──────────────────────────────────
    // قبلاً polling هر ۱٫۵ ثانیه بود و در هر چرخه ۱۴ درخواست (برای ۱۴ جدول) می‌فرستاد؛
    // یعنی ~۹ درخواست در ثانیه، همیشه و برای هر دستگاه — همین سقفِ رایگانِ Egress را سریع
    // پر می‌کرد. Realtime (WebSocket) از قبل به‌روزرسانی‌ها را «لحظه‌ای» می‌آورد، پس polling
    // فقط نقشِ fallback دارد و با «فاصلهٔ تطبیقی» اجرا می‌شود:
    //   • وقتی Realtime وصل است → هر ۳۰ ثانیه (مصرفِ بسیار کم؛ به‌روزرسانی‌ها لحظه‌ای از Realtime می‌آیند)
    //   • وقتی Realtime قطع است → هر ۸ ثانیه تا سینک همچنان سریع کار کند
    // این تغییر منطقِ سینک (cursor/incremental/conflict/bootstrap) را دست نمی‌زند؛ فقط فرکانسِ
    // polling را کم می‌کند. نتیجه: تا ~۹۵٪ کاهشِ درخواست‌های بی‌نتیجه و افتِ چشمگیرِ Egress.
    var POLL_SLOW_MS  = 30000;   // fallback وقتی Realtime سالم/وصل است
    var POLL_FAST_MS  = 8000;    // fallback وقتی Realtime قطع است
    var RETRY_MS      = 6000;    // تلاشِ دوبارهٔ صف هنگامِ خطا
    var BATCH_UPLOAD  = 500;

    // ===========================================================================
    //  ابزارِ محلی
    // ===========================================================================
    function LS_get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function LS_set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function readArray(key) { try { var v = JSON.parse(LS_get(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function writeArray(key, arr) { LS_set(key, JSON.stringify(arr || [])); }
    function nowIso() { return new Date().toISOString(); }

    // ===========================================================================
    //  پاک‌سازیِ تنظیمات پیش از سینک:
    //  فیلدهای «حجیم/باینری» (مثلِ لوگوی فروشگاه که یک تصویرِ base64 است) از رکوردِ
    //  store_settings حذف می‌شوند. این تصاویر گاهی چند مگابایت‌اند و بدنهٔ POST را آن‌قدر
    //  بزرگ می‌کنند که اتصالِ HTTP/2 می‌شکند (ERR_HTTP2_PROTOCOL_ERROR) → push مدام
    //  شکست می‌خورد و کلِ سینک را مسدود می‌کند. لوگو صرفاً ظاهری است و روی هر دستگاه
    //  جداگانه تنظیم می‌شود؛ پس از سینک کنار گذاشته می‌شود.
    var MAX_SETTING_BYTES = 300000;   // سقفِ امنِ اندازهٔ هر رکوردِ تنظیمات (~۳۰۰KB)
    var HEAVY_SETTING_FIELDS = ['storeLogo', 'billLogo', 'logo', 'logoData', 'storeLogoData'];
    function isDataUrl(v) { return typeof v === 'string' && v.slice(0, 5) === 'data:'; }
    function sanitizeSettingValue(key, val) {
        if (!val || typeof val !== 'object' || Array.isArray(val)) {
            // مقدارِ رشته‌ایِ حجیم/تصویری هم سینک نشود
            return (typeof val === 'string' && (isDataUrl(val) || val.length > MAX_SETTING_BYTES)) ? '' : val;
        }
        var clean = {}, k;
        for (k in val) {
            if (!Object.prototype.hasOwnProperty.call(val, k)) continue;
            if (HEAVY_SETTING_FIELDS.indexOf(k) !== -1) continue;   // فیلدِ لوگو → حذف از سینک
            var v = val[k];
            if (isDataUrl(v)) continue;                              // هر تصویرِ data: → حذف
            if (typeof v === 'string' && v.length > MAX_SETTING_BYTES) continue;
            clean[k] = v;
        }
        return clean;
    }
    // ساختِ دادهٔ تنظیماتِ امن؛ اگر باز هم از سقف بزرگ‌تر بود، null برمی‌گرداند تا اصلاً push نشود.
    function safeSettingData(k, val) {
        var data = { key: k, value: sanitizeSettingValue(k, val) };
        try { if (JSON.stringify(data).length > MAX_SETTING_BYTES) { warn('تنظیماتِ «' + k + '» بیش از حد بزرگ است — از سینک صرف‌نظر شد.'); return null; } } catch (e) { return null; }
        return data;
    }

    // هشِ سبک و پایدار برای تشخیصِ تغییرِ محتوای یک رکورد
    function hashStr(s) {
        var h = 5381, i = s.length;
        while (i) { h = (h * 33) ^ s.charCodeAt(--i); }
        return (h >>> 0).toString(36);
    }
    function recHash(rec) { try { return hashStr(JSON.stringify(rec)); } catch (e) { return '0'; } }

    // فقط موجودیت‌های مالیِ «قابلِ ویرایش» (State) می‌توانند تعارضِ Update-Update روی یک
    // record_idِ واحد داشته باشند — یعنی transactions و expenses (هر دو create+update دارند).
    // returns / cashbox_transactions / warehouse_transfers رویدادِ append-only هستند: دو دستگاه
    // دو رکوردِ مستقل با record_idِ متفاوت می‌سازند (preserve-both) و هرگز روی یک record_id
    // بازنویسی نمی‌شوند؛ پس winner/loser برایشان بی‌معناست و در این مجموعه نیستند.
    var EDITABLE_FINANCIAL_TABLES = { transactions: 1, expenses: 1 };
    var CONFLICT_LOG_KEY = 'jouya_sync_conflicts';
    var CONFLICT_LOG_MAX = 500;
    var CONFLICT_TABLE = 'sync_conflicts';
    // کلیدِ یکتاسازِ تعارض = record_id | نسخهٔ برندهٔ سرور | هَشِ بازنده. پایدار و idempotent:
    // همان تعارض دوباره تشخیص/دریافت شود، همین کلید تولید می‌شود → بدونِ Duplicate.
    function conflictKey(e) {
        return String(e.record_id) + '|' + String(e.winning_updated_at || '') + '|' + recHash(e.losing);
    }
    function readConflicts() { try { var a = JSON.parse(LS_get(CONFLICT_LOG_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function writeConflicts(arr) {
        try { if (arr.length > CONFLICT_LOG_MAX) arr = arr.slice(arr.length - CONFLICT_LOG_MAX); LS_set(CONFLICT_LOG_KEY, JSON.stringify(arr)); } catch (e) {}
    }
    // نگه‌داریِ محلیِ فوری (offline-safe) + push بهترین‌تلاش به ابر. اگر ابر در دسترس نبود،
    // رکوردِ محلی با synced:false می‌ماند و بعداً pushConflicts دوباره تلاش می‌کند.
    function logConflict(entry) {
        try {
            entry.workspace_id = workspaceId || null;
            entry.source_device = shortDevice();
            entry.conflict_type = entry.conflict_type || 'update-update';
            entry.status = 'open';
            entry.key = conflictKey(entry);
            var arr = readConflicts();
            if (arr.some(function (x) { return x.key === entry.key; })) return; // dedup محلی
            entry.synced = false;
            arr.push(entry);
            writeConflicts(arr);
            pushConflicts();   // بهترین‌تلاش؛ آفلاین باشد بعداً retry می‌شود
        } catch (e) {}
    }
    // push تعارض‌های همگام‌نشده به ابر (upsert idempotent روی workspace_id,conflict_key).
    var _pushingConflicts = false;
    function pushConflicts() {
        if (_pushingConflicts || !workspaceId || (typeof navigator !== 'undefined' && navigator && navigator.onLine === false)) return Promise.resolve();
        var arr = readConflicts();
        var pending = arr.filter(function (x) { return !x.synced; });
        if (!pending.length) return Promise.resolve();
        _pushingConflicts = true;
        var rows = pending.map(function (e) {
            return {
                workspace_id: workspaceId, conflict_key: e.key, entity: e.table, record_id: e.record_id,
                conflict_type: e.conflict_type, winning: e.winning_remote, losing: e.losing_local,
                winning_revision: e.remote_revision || null, winning_updated_at: e.winning_updated_at || null,
                losing_revision: e.local_revision || null, source_device: e.source_device, status: 'open'
            };
        });
        return ensureToken().then(function () {
            return Sb.req('/rest/v1/' + CONFLICT_TABLE + '?on_conflict=workspace_id,conflict_key',
                { method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: rows });
        }).then(function () {
            var cur = readConflicts();
            cur.forEach(function (x) { if (pending.some(function (p) { return p.key === x.key; })) x.synced = true; });
            writeConflicts(cur);
            _pushingConflicts = false;
        }).catch(function (e) { _pushingConflicts = false; warn('push تعارض‌ها ناموفق (بعداً retry):', e && e.message); });
    }
    // pull تعارض‌های ابری و ادغام در نمای محلی (dedup با conflict_key). Remote را دوباره
    // به‌عنوان تعارضِ جدید ثبت نمی‌کند و دوباره push نمی‌کند (synced:true) → بدونِ loop/Duplicate.
    function pullConflicts() {
        if (!workspaceId) return Promise.resolve(0);
        return ensureToken().then(function () {
            return Sb.req('/rest/v1/' + CONFLICT_TABLE + '?workspace_id=eq.' + encodeURIComponent(workspaceId) +
                '&select=conflict_key,entity,record_id,conflict_type,winning,losing,winning_revision,winning_updated_at,losing_revision,source_device,status,created_at&order=created_at.asc&limit=1000');
        }).then(function (rows) {
            if (!Array.isArray(rows) || !rows.length) return 0;
            var arr = readConflicts();
            var have = {}; arr.forEach(function (x) { have[x.key] = x; });
            var added = 0;
            rows.forEach(function (r) {
                if (have[r.conflict_key]) { have[r.conflict_key].synced = true; if (r.status) have[r.conflict_key].status = r.status; return; }
                arr.push({
                    key: r.conflict_key, table: r.entity, record_id: r.record_id, conflict_type: r.conflict_type,
                    winning_remote: r.winning, losing_local: r.losing, remote_revision: r.winning_revision,
                    winning_updated_at: r.winning_updated_at, local_revision: r.losing_revision,
                    source_device: r.source_device, status: r.status, at: r.created_at,
                    workspace_id: workspaceId, synced: true, fromCloud: true
                });
                added++;
            });
            writeConflicts(arr);
            return added;
        }).catch(function (e) { warn('pull تعارض‌ها ناموفق:', e && e.message); return 0; });
    }
    function deviceKey() {
        var k = LS_get('jouya_device_id');
        if (!k) { k = 'D-' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).toUpperCase(); LS_set('jouya_device_id', k); }
        return k;
    }
    function shortDevice() { return deviceKey().slice(0, 10); }

    // هویتِ رکورد به‌ازای هر مجموعه: بیشترِ مجموعه‌ها `id` دارند، اما ارزها با `code`
    // شناخته می‌شوند (id ندارند). بدونِ این، هر ارز هر بار شناسهٔ تصادفی می‌گرفت و
    // رکوردهای تکراریِ بی‌پایان می‌ساخت (و می‌توانست باعثِ خطای سرور شود).
    var ID_FIELD = { currencies: 'code', store_settings: 'key' };
    function idOf(rec, table) {
        var f = (table && ID_FIELD[table]) || 'id';
        var v = rec ? rec[f] : null;
        // برای جدول‌های شناسه‌سفارشی (ارزها با `code`) عمداً به `id` برنمی‌گردیم:
        // ارز بدونِ code یک رکوردِ خراب است و باید همه‌جا حذف/نادیده شود (نه اینکه با
        // فالبکِ id زنده بماند و به‌صورتِ ارزِ تست/[object Object] ظاهر شود).
        if (v == null && f === 'id') v = rec ? rec._id : null;   // فقط برای جدول‌های id-محور
        return v == null ? '' : String(v);
    }
    function recId(rec) { return idOf(rec, null); }   // سازگاریِ عقب‌رو (id/_id)
    function makeRecordId(rec, table) {
        var id = idOf(rec, table); if (!id) id = 'x' + Math.random().toString(36).slice(2);
        return shortDevice() + ':' + id;
    }

    // ===========================================================================
    //  پاکسازیِ خودکارِ محلی: حذفِ رکوردهای «بی‌شناسه» (مثلِ ارزِ بدونِ کد که به‌خاطرِ
    //  باگِ قبلی هر چند ثانیه یک نسخهٔ تازه از خودش می‌ساخت) و رکوردهای «تکراری» با
    //  شناسهٔ یکسان (آخرین نسخه نگه داشته می‌شود). غیرمخرب است: فقط رکوردی که هیچ
    //  شناسه‌ای (code/id/_id) ندارد حذف می‌شود؛ دادهٔ معتبر دست‌نخورده می‌ماند.
    // ===========================================================================
    function dedupeCollection(colKey, table) {
        var arr = readArray(colKey);
        var lastIdxById = {};
        arr.forEach(function (rec, idx) { var id = idOf(rec, table); if (id) lastIdxById[id] = idx; });
        var out = [];
        arr.forEach(function (rec, idx) {
            var id = idOf(rec, table);
            if (!id) return;                          // بی‌شناسه (مثلِ ارزِ بدونِ کد) → حذف
            if (lastIdxById[id] !== idx) return;       // نسخهٔ قدیمی‌ترِ همان شناسه → حذف
            out.push(rec);
        });
        if (out.length !== arr.length) writeArray(colKey, out);
        return { before: arr.length, after: out.length, removed: arr.length - out.length };
    }
    function cleanupIdentityIssues() {
        var report = {};
        COLLECTIONS.forEach(function (col) {
            if (!ID_FIELD[col.table]) return;   // فعلاً فقط جدول‌هایی با شناسهٔ سفارشی (ارزها)
            var r = dedupeCollection(col.key, col.table);
            if (r.removed) { report[col.table] = r; warn('پاکسازیِ خودکار: از «' + col.table + '» ', r.removed, 'رکوردِ بی‌شناسه/تکراری حذف شد (', r.before, '→', r.after, ').'); }
        });
        return report;
    }
    // همیشه هنگامِ بارگذاریِ اسکریپت اجرا می‌شود (حتی بدونِ سینکِ ابری)، چون منشأِ
    // خرابی محلی است؛ idempotent است — اگر چیزی خراب نباشد کاری نمی‌کند.
    try { cleanupIdentityIssues(); } catch (e) {}

    // ===========================================================================
    //  حالتِ سینک (snapshot + cursor + session)  — همه در localStorage
    // ===========================================================================
    var SNAP_KEY   = 'jouya_sync_snapshot';    // { table: { recordId: {h, rev, u} } }
    var CURSOR_KEY = 'jouya_sync_cursor';      // بیشینهٔ updated_at دریافت‌شده
    var SESS_KEY   = 'jouya_sync_session';     // { access_token, refresh_token, expires_at, workspaceId, email }
    var OUTBOX_KEY = 'jouya_sync_outbox';

    function snapRead()  { try { return JSON.parse(LS_get(SNAP_KEY) || '{}'); } catch (e) { return {}; } }
    function snapWrite(s){ LS_set(SNAP_KEY, JSON.stringify(s || {})); }
    function sessRead()  { try { return JSON.parse(LS_get(SESS_KEY) || 'null'); } catch (e) { return null; } }
    function sessWrite(s){ if (s) LS_set(SESS_KEY, JSON.stringify(s)); else try { localStorage.removeItem(SESS_KEY); } catch (e) {} }
    function outRead()   { try { return JSON.parse(LS_get(OUTBOX_KEY) || '[]'); } catch (e) { return []; } }
    function outWrite(q) { LS_set(OUTBOX_KEY, JSON.stringify(q || [])); }

    var SESSION = sessRead();
    var workspaceId = SESSION && SESSION.workspaceId || LS_get('jouya_sync_workspace') || null;

    // ===========================================================================
    //  کلاینتِ Supabase (fetch؛ بدونِ SDK)
    // ===========================================================================
    var Sb = {
        url: (CFG.url || '').replace(/\/+$/, ''),
        anon: CFG.anonKey || '',
        // فقط توکنِ نشستِ «نامنقضی» را برگردان؛ وگرنه anon. اگر توکنِ منقضی به هر درخواستی
        // (به‌ویژه REST/RPC) فرستاده شود، Supabase 401 می‌دهد. (برای auth endpoints هم
        // signIn/signUp/refresh صراحتاً anon می‌فرستند تا Bearerِ کاربرِ قبلی مانع ورود نشود.)
        token: function () {
            if (SESSION && SESSION.access_token && (!SESSION.expires_at || SESSION.expires_at > Date.now())) return SESSION.access_token;
            return this.anon;
        },
        hasLiveAuth: function () { return !!(SESSION && SESSION.access_token && (!SESSION.expires_at || SESSION.expires_at > Date.now())); },
        headers: function (extra) {
            var h = { 'apikey': this.anon, 'Authorization': 'Bearer ' + this.token(), 'Content-Type': 'application/json' };
            if (extra) for (var k in extra) h[k] = extra[k];
            return h;
        },
        req: function (path, opts) {
            opts = opts || {};
            return fetch(this.url + path, {
                method: opts.method || 'GET', headers: this.headers(opts.headers),
                body: opts.body ? JSON.stringify(opts.body) : undefined
            }).then(function (r) {
                return r.text().then(function (t) {
                    var data = null; try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
                    if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; e.data = data; throw e; }
                    return data;
                });
            });
        },
        upsert: function (table, rows) {
            if (!rows.length) return Promise.resolve([]);
            return this.req('/rest/v1/' + table + '?on_conflict=workspace_id,record_id',
                { method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' }, body: rows });
        },
        // واکشیِ رکوردهای تغییرکرده بعد از cursor (برای pull)
        pullSince: function (table, ws, sinceIso, limit) {
            // gte (نه gt): رکوردهای دقیقاً روی مرزِ cursor هم گرفته می‌شوند تا رکوردهای هم‌میلی‌ثانیه
            // با cursor از دست نروند؛ رکوردهای قبلاً‌اعمال‌شده با گاردِ تعارض (updated_at<=known.u) رد می‌شوند.
            var q = '/rest/v1/' + table + '?workspace_id=eq.' + encodeURIComponent(ws) +
                    '&updated_at=gte.' + encodeURIComponent(sinceIso) +
                    '&order=updated_at.asc&limit=' + (limit || 1000) +
                    '&select=record_id,data,revision,updated_at,deleted_at,device_key';
            return this.req(q);
        },
        count: function (table, ws) {
            return fetch(this.url + '/rest/v1/' + table + '?workspace_id=eq.' + encodeURIComponent(ws) +
                '&deleted_at=is.null&select=record_id',
                { method: 'HEAD', headers: this.headers({ 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' }) }
            ).then(function (r) { var cr = r.headers.get('content-range') || ''; var t = cr.split('/')[1]; return t === '*' ? 0 : (parseInt(t, 10) || 0); });
        },
        rpc: function (fn, args) { return this.req('/rest/v1/rpc/' + fn, { method: 'POST', body: args || {} }); },
        ping: function () { return fetch(this.url + '/rest/v1/', { headers: this.headers() }).then(function (r) { return r.ok || r.status === 404 || r.status === 400; }).catch(function () { return false; }); }
    };

    // ===========================================================================
    //  Auth (ورود/ثبت‌نام/تازه‌سازیِ توکن)
    // ===========================================================================
    function persistSession(res, extra) {
        SESSION = SESSION || {};
        if (res.access_token)  SESSION.access_token  = res.access_token;
        if (res.refresh_token) SESSION.refresh_token = res.refresh_token;
        if (res.expires_in)    SESSION.expires_at = Date.now() + (res.expires_in * 1000);
        if (res.user)          SESSION.email = res.user.email;
        if (extra) for (var k in extra) SESSION[k] = extra[k];
        sessWrite(SESSION);
    }
    function signIn(email, password) {
        // مهم: به endpointِ auth باید Bearer=anon فرستاده شود، نه توکنِ نشستِ قبلی/منقضی.
        // اگر Bearerِ کاربرِ قبلی فرستاده شود، GoTrue با 400 رد می‌کند و ورود/ساختِ کاربر شکست می‌خورد.
        return Sb.req('/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Authorization': 'Bearer ' + Sb.anon }, body: { email: email, password: password } })
            .then(function (res) {
                persistSession(res);
                return Sb.rpc('bootstrap_workspace', { p_name: 'فروشگاه من' }).then(function (wsId) {
                    workspaceId = wsId; SESSION.workspaceId = wsId; sessWrite(SESSION);
                    LS_set('jouya_sync_workspace', wsId);
                    log('ورود موفق + workspace', wsId);
                    return { user: res.user, workspaceId: wsId };
                });
            });
    }
    function signUp(email, password) {
        // مثلِ signIn: Bearer=anon تا ثبت‌نام با توکنِ نشستِ قبلی مسدود نشود (علتِ «کاربر ساخته نمی‌شود»).
        return Sb.req('/auth/v1/signup', { method: 'POST', headers: { 'Authorization': 'Bearer ' + Sb.anon }, body: { email: email, password: password } })
            .then(function (res) { if (res.access_token) persistSession(res); log('ثبت‌نام موفق'); return res; });
    }
    function refreshToken() {
        if (!SESSION || !SESSION.refresh_token) return Promise.resolve(false);
        return Sb.req('/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { 'Authorization': 'Bearer ' + Sb.anon }, body: { refresh_token: SESSION.refresh_token } })
            .then(function (res) { persistSession(res); log('توکن تازه شد'); return true; })
            .catch(function (e) {
                // اگر سرور refresh_token را رد کرد (400/401)، نشستِ مرده را پاک کن تا Bearerِ منقضی
                // دیگر جایی فرستاده نشود (خطای شبکه نشست را پاک نمی‌کند تا آفلاین‌ماندن ممکن بماند).
                var st = e && e.status;
                if (st === 400 || st === 401) { SESSION = null; sessWrite(null); }
                return false;
            });
    }
    function ensureToken() {
        // اگر تا کمتر از ۲ دقیقهٔ دیگر منقضی می‌شود، تازه کن
        if (SESSION && SESSION.expires_at && (SESSION.expires_at - Date.now() < 120000)) return refreshToken();
        return Promise.resolve(true);
    }

    // ===========================================================================
    //  ساختِ ردیفِ ابری از رکوردِ محلی
    // ===========================================================================
    // کلاینت زمان/revision نمی‌فرستد؛ سرور (trigger) آن‌ها را می‌گذارد و ما بازمی‌خوانیم.
    // نکته: همهٔ ردیف‌ها باید کلیدهای یکسان داشته باشند تا درخواستِ دسته‌ایِ PostgREST رد نشود
    // (خطای PGRST102 «All object keys must match»). پس ردیفِ عادی هم deleted_at: null دارد.
    function rowFor(rec, table) {
        return { workspace_id: workspaceId, record_id: makeRecordId(rec, table), data: rec, deleted_at: null, device_key: shortDevice() };
    }
    function delRowFor(recordId) {
        return { workspace_id: workspaceId, record_id: recordId, data: {}, deleted_at: nowIso(), device_key: shortDevice() };
    }

    // ===========================================================================
    //  PUSH — تشخیصِ تغییر با diff نسبت به snapshot، سپس آپلود
    // ===========================================================================
    var _applyingRemote = false;   // هنگام اعمالِ دادهٔ دریافتی true است تا حلقه نشود
    // snapshot به‌ازای هر جدول با «idِ محلیِ رکورد» کلید می‌خورد و record_idِ پایدارِ ابری را
    // نگه می‌دارد؛ پس رکوردی که دستگاهِ دیگر ساخته، هنگامِ ویرایش روی این دستگاه به همان
    // record_idِ اصلی push می‌شود (نه پیشوندِ این دستگاه) → نه حلقه، نه تکرار.
    function detectChanges() {
        var snap = snapRead();
        var out = [];
        COLLECTIONS.forEach(function (col) {
            var arr = readArray(col.key);
            var prev = snap[col.table] || {};
            var curIds = {};
            var rows = [], metaByRid = {};
            arr.forEach(function (rec) {
                var id = idOf(rec, col.table);
                // رفعِ باگِ «دو دانه‌شدنِ ارزها»: رکوردی که شناسهٔ معتبر ندارد (مثلاً ارزِ
                // تازه‌اضافه‌شده که هنوز کدش خالی است) را push نکن. وگرنه هر بار id
                // تصادفیِ جدید می‌گیرد (نگاه کن به makeRecordId) و به‌ازای هر چرخهٔ سینک
                // یک ردیفِ جدید در سرور ساخته می‌شود که در دستگاه‌های دیگر به‌عنوانِ
                // رکوردِ «جدید»ی جدا اعمال می‌شود → تکرارِ بی‌پایان.
                if (!id) return;
                curIds[id] = true;
                var p = prev[id];
                var rid = (p && p.rid) ? p.rid : makeRecordId(rec, col.table);   // record_idِ پایدار
                var h = recHash(rec);
                if (!p || p.h !== h) {
                    var row = rowFor(rec, col.table); row.record_id = rid;
                    rows.push(row); metaByRid[rid] = { id: id, h: h, deleted: false };
                }
            });
            Object.keys(prev).forEach(function (id) {
                if (!curIds[id] && !prev[id].deleted && prev[id].rid) {
                    var rid = prev[id].rid;
                    rows.push(delRowFor(rid)); metaByRid[rid] = { id: id, h: '_del', deleted: true };
                }
            });
            if (rows.length) out.push({ table: col.table, key: col.key, rows: rows, metaByRid: metaByRid });
        });
        return out;
    }

    // تنظیماتِ سطحِ فروشگاه (شاملِ jouya-reference-rates یعنی نرخ‌های مرجعِ ارز) قبلاً فقط
    // یک‌بار، در زمانِ مهاجرت، آپلود می‌شدند و هرگز pull نمی‌شدند — یعنی تغییرِ نرخ‌ها
    // بعد از آن هرگز به دستگاهِ دیگر نمی‌رسید. از این پس مثلِ بقیهٔ مجموعه‌ها با diff
    // نسبت به snapshot زنده push/pull می‌شوند.
    function detectSettingsChanges() {
        var snap = snapRead();
        var prev = snap[STORE_SETTINGS_TABLE] || {};
        var rows = [], metaByRid = {};
        STORE_SETTING_KEYS.forEach(function (k) {
            var raw = LS_get(k); if (raw == null) return;
            var val; try { val = JSON.parse(raw); } catch (e) { val = raw; }
            var data = safeSettingData(k, val);   // لوگو/تصاویرِ حجیم حذف می‌شوند
            if (!data) return;                    // بیش از حد بزرگ → اصلاً push نشود
            var h = recHash(data);
            var p = prev[k];
            var rid = (p && p.rid) ? p.rid : ('setting:' + k);
            if (!p || p.h !== h) {
                rows.push({ workspace_id: workspaceId, record_id: rid, data: data, deleted_at: null, device_key: shortDevice() });
                metaByRid[rid] = { id: k, h: h, deleted: false };
            }
        });
        if (!rows.length) return null;
        return { table: STORE_SETTINGS_TABLE, key: '__settings__', rows: rows, metaByRid: metaByRid };
    }

    // خطای RLS/دسترسی (۴۰۳/۴۲۵۰۱ یا «row-level security»)؟
    function isRlsError(e) {
        return !!(e && (e.status === 403 || (e.data && (e.data.code === '42501' ||
            (typeof e.data.message === 'string' && /row-level security|not_member|permission/i.test(e.data.message))))));
    }

    // خوددرمانیِ عضویت/‌workspace: bootstrap_workspace خنثی است — اگر عضویتِ کاربر در
    // workspace_members نبود آن را می‌سازد، و workspaceِ معتبرِ همین کاربر را برمی‌گرداند.
    // این ریشهٔ خطای ۴۲۵۰۱ هنگامِ نوشتن را برطرف می‌کند (عضویتِ گم‌شده یا workspaceِ کهنه).
    var _healingMembership = false;
    var _lastHealAt = 0;
    function ensureMembership() {
        return ensureToken().then(function () {
            return Sb.rpc('bootstrap_workspace', { p_name: 'فروشگاه من' });
        }).then(function (wsId) {
            if (wsId) {
                if (wsId !== workspaceId) log('workspace اصلاح شد:', workspaceId, '→', wsId);
                workspaceId = wsId;
                if (SESSION) { SESSION.workspaceId = wsId; sessWrite(SESSION); }
                LS_set('jouya_sync_workspace', wsId);
            }
            return wsId;
        });
    }

    // ===========================================================================
    //  Local-Only Wipe — پاک‌کردنِ داده‌های Localِ همین دستگاه، بدونِ ایجادِ Delete/Soft-Delete
    //  در Cloud. عملیاتِ atomic و یک‌بارمصرف (نه flagِ زمان‌دار).
    //
    //  چرا امن است (اثبات): detectChanges فقط وقتی tombstone می‌سازد که رکوردی در snapshot
    //  باشد ولی در local نباشد. اگر همراهِ پاک‌کردنِ local، ورودی‌های snapshotِ همان جدول‌ها را هم
    //  حذف کنیم، detectChanges «prev» ندارد → هیچ tombstone/Delete برای Cloud تولید نمی‌شود.
    //  علاوه بر آن، تایمرهای معلقِ push لغو و push در حینِ عملیات مسدود می‌شود.
    // ===========================================================================
    var TABLE_BY_KEY = {}; COLLECTIONS.forEach(function (c) { TABLE_BY_KEY[c.key] = c.table; });

    // شمارشِ تغییراتِ همگام‌نشدهٔ محلی برای کلیدهای داده‌شده (رکوردهای جدید یا ویرایش‌شده‌ای که
    // هنوز در snapshot ثبت نشده‌اند). برای هشدار پیش از Wipe (تا داده‌ی unsynced کورکورانه نرود).
    function countUnsyncedForKeys(keys) {
        var snap = snapRead(); var total = 0;
        (keys || []).forEach(function (k) {
            var table = TABLE_BY_KEY[k]; if (!table) return;     // فقط جدول‌های همگام‌شونده
            var arr = readArray(k); var prev = snap[table] || {};
            arr.forEach(function (rec) {
                var id = idOf(rec, table); if (id == null) return;
                var p = prev[id];
                if (!p || !p.rid) { total++; return; }            // هرگز sync نشده
                if (p.h !== recHash(rec)) total++;                // ویرایشِ همگام‌نشده
            });
        });
        return total;
    }

    var _wipeInProgress = false;
    // preview فقط شمارشِ unsynced را می‌دهد (بدونِ تغییر). UI پیش از Wipe هشدار می‌دهد.
    function previewLocalOnlyWipe(keys) { return { unsynced: countUnsyncedForKeys(keys || []) }; }

    // عملیاتِ اصلی. opts.flushFirst=true → ابتدا unsynced به Cloud push شود (Cloud تغییر می‌کند)،
    // سپس Wipe. پیش‌فرض false = Wipeِ خالص (Cloud دست‌نخورده؛ unsynced محلی از بین می‌رود — با هشدار).
    function localOnlyWipe(keys, opts) {
        opts = opts || {}; keys = keys || [];
        var pre = (opts.flushFirst && online && workspaceId) ? Promise.resolve(pushNow()) : Promise.resolve();
        return Promise.resolve(pre).catch(function () {}).then(function () {
            _wipeInProgress = true;
            try {
                var unsynced = countUnsyncedForKeys(keys);
                // ۱) تایمرهای معلقِ push را لغو کن تا detectChangesِ زمان‌بندی‌شده tombstone نسازد.
                try { if (typeof window !== 'undefined') { clearTimeout(window._syncPushDebounce); window._syncPushDebounce = null; } } catch (e) {}
                try { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } } catch (e) {}
                // ۲) کلیدهای Localِ مشخص‌شده را پاک کن (فقط همین دستگاه).
                keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
                // ۳) هستهٔ ایمنی: ورودی‌های snapshotِ همان جدول‌ها را حذف کن → detectChanges دیگر
                //    این رکوردها را «حذف‌شده» نمی‌بیند → هیچ deleted_at/Delete برای Cloud نمی‌سازد.
                var snap = snapRead();
                keys.forEach(function (k) { var t = TABLE_BY_KEY[k]; if (t && snap[t]) delete snap[t]; });
                snapWrite(snap);
                // ۴) outbox/pending را برای ایمنی خالی کن (در مسیرِ push استفاده نمی‌شود ولی محضِ احتیاط).
                try { outWrite([]); } catch (e) {}
                log('Local-Only Wipe:', keys.length, 'کلید پاک شد؛ Cloud دست‌نخورده. unsynced=', unsynced);
                return { ok: true, unsynced: unsynced, clearedKeys: keys.slice() };
            } finally {
                _wipeInProgress = false;   // پایانِ عملیاتِ atomic
            }
        });
    }

    function pushNow() {
        if (_wipeInProgress) return Promise.resolve();   // در حینِ Local-Only Wipe هیچ push/tombstone نساز
        if (!online || !workspaceId || _applyingRemote) return Promise.resolve();
        // بدونِ نشستِ معتبر push نکن: در گذارِ احراز هویت (قبل از ورود/بعد از انقضا) push با anon
        // به RLS می‌خورد (401/42501). داده محلی می‌ماند و پس از ورود/‌bootstrap push می‌شود.
        if (!Sb.hasLiveAuth()) return Promise.resolve();
        var changeSet = detectChanges();
        var settingsChange = detectSettingsChanges();
        if (settingsChange) changeSet.push(settingsChange);
        if (!changeSet.length) return Promise.resolve();
        return ensureToken().then(function () {
            var chain = Promise.resolve();
            var snap = snapRead();
            var failed = [];
            var rlsHit = false;
            changeSet.forEach(function (ch) {
                chain = chain.then(function () {
                    // هر جدول جدا؛ خطای یک جدول بقیه را متوقف نمی‌کند.
                    return uploadInBatches(ch.table, ch.rows, BATCH_UPLOAD).then(function (serverRows) {
                        // snapshot را از مقادیرِ «سرور» (updated_at/revision) می‌سازیم، نه حدسِ کلاینت.
                        snap[ch.table] = snap[ch.table] || {};
                        (serverRows || []).forEach(function (sr) {
                            var m = ch.metaByRid[sr.record_id]; if (!m) return;
                            snap[ch.table][m.id] = { rid: sr.record_id, h: m.h, rev: sr.revision, u: sr.updated_at, deleted: !!m.deleted, mine: true };
                        });
                    }).catch(function (e) {
                        // متنِ کاملِ خطای سرور را نشان بده تا علت روشن باشد (نه فقط «HTTP 500»).
                        failed.push(ch.table);
                        if (isRlsError(e)) rlsHit = true;
                        warn('push جدولِ «' + ch.table + '» ناموفق:', e.message, '| پاسخِ سرور:', (e.data ? JSON.stringify(e.data) : '(بدون متن)'));
                    });
                });
            });
            return chain.then(function () {
                snapWrite(snap);
                var n = changeSet.reduce(function (a, c) { return a + c.rows.length; }, 0);
                var okTables = changeSet.length - failed.length;
                log('push:', n, 'رکورد در', okTables, 'جدول' + (failed.length ? (' — ناموفق: ' + failed.join(', ')) : ''));
                // خوددرمانیِ ۴۲۵۰۱: اگر خطای RLS رخ داد و اخیراً درمان نکرده‌ایم، عضویت را
                // تضمین کن و یک‌بار دوباره push کن (با محدودیتِ زمانی تا حلقه نشود).
                if (rlsHit && !_healingMembership && (Date.now() - _lastHealAt > 20000)) {
                    _healingMembership = true; _lastHealAt = Date.now();
                    return ensureMembership().then(function () {
                        _healingMembership = false;
                        log('عضویت تضمین شد — تلاشِ دوبارهٔ push');
                        return pushNow();
                    }).catch(function (e2) {
                        _healingMembership = false;
                        warn('خوددرمانیِ عضویت ناموفق:', e2 && e2.message);
                        queueRetry();
                    });
                }
                if (failed.length) queueRetry();
            });
        }).catch(function (e) {
            warn('push ناموفق (به صف می‌رود، تلاشِ دوباره):', e.message, '| پاسخِ سرور:', (e.data ? JSON.stringify(e.data) : '(بدون متن)'));
            if (isRlsError(e) && !_healingMembership && (Date.now() - _lastHealAt > 20000)) {
                _healingMembership = true; _lastHealAt = Date.now();
                return ensureMembership().then(function () { _healingMembership = false; return pushNow(); })
                    .catch(function () { _healingMembership = false; queueRetry(); });
            }
            queueRetry();
        });
    }

    function uploadInBatches(table, rows, size) {
        var acc = [], i = 0;
        function next() {
            if (i >= rows.length) return Promise.resolve(acc);
            var s = rows.slice(i, i + size); i += size;
            return Sb.upsert(table, s).then(function (ret) { if (Array.isArray(ret)) acc = acc.concat(ret); return next(); });
        }
        return next();
    }

    // ===========================================================================
    //  PULL — واکشیِ تغییراتِ بعد از cursor و اعمالِ محلی با حلِ تعارض
    // ===========================================================================
    function stripDevice(recordId) { var i = recordId.indexOf(':'); return i >= 0 ? recordId.slice(i + 1) : recordId; }

    var _pullInFlight = false;
    function pullNow() {
        if (!online || !workspaceId) return Promise.resolve(0);
        if (_pullInFlight) return Promise.resolve(0);   // از هم‌پوشانیِ pullها جلوگیری کن
        _pullInFlight = true;
        var cursor = LS_get(CURSOR_KEY) || '1970-01-01T00:00:00Z';
        return ensureToken().then(function () {
            var incoming = {};   // table -> [records]
            var maxU = cursor;
            // همهٔ جدول‌ها را «موازی» واکشی کن (نه پشتِ‌سرهم) — تأخیرِ pull از ~۱۴×RTT به ~۱×RTT می‌رسد.
            var tables = COLLECTIONS.map(function (c) { return c.table; }).concat([STORE_SETTINGS_TABLE]);
            return Promise.all(tables.map(function (table) {
                return Sb.pullSince(table, workspaceId, cursor, 1000).then(function (recs) {
                    if (recs && recs.length) {
                        incoming[table] = recs;
                        recs.forEach(function (r) { if (r.updated_at > maxU) maxU = r.updated_at; });
                    }
                }).catch(function () { /* یک جدول خطا داد؛ بقیه ادامه دهند */ });
            })).then(function () {
                var applied = applyIncoming(incoming);
                if (maxU > cursor) LS_set(CURSOR_KEY, maxU);
                if (applied > 0) { refreshApp(); log('pull:', applied, 'رکورد اعمال شد'); }
                // تعارض‌ها را جدا و «بدونِ نگه‌داشتنِ pull» همگام کن: ابتدا محلی‌های همگام‌نشده را
                // push، سپس ابری‌ها را pull/merge (idempotent با conflict_key، بدونِ loop).
                pushConflicts().then(function () { return pullConflicts(); });
                return applied;
            });
        }).catch(function (e) { warn('pull ناموفق:', e.message); return 0; })
          .then(function (n) { _pullInFlight = false; return n; }, function (e) { _pullInFlight = false; throw e; });
    }

    function applyIncoming(incoming) {
        var myDev = shortDevice();
        var snap = snapRead();
        var appliedCount = 0;
        _applyingRemote = true;
        try {
            Object.keys(incoming).forEach(function (table) {
                if (table === STORE_SETTINGS_TABLE) {
                    appliedCount += applySettingsIncoming(incoming[table], snap, myDev);
                    return;
                }
                var key = KEY_BY_TABLE[table]; if (!key) return;
                var arr = readArray(key);
                var byId = {}; arr.forEach(function (rec, idx) { byId[idOf(rec, table)] = idx; });
                var changed = false;
                snap[table] = snap[table] || {};

                var hasCustomId = !!ID_FIELD[table];
                incoming[table].forEach(function (r) {
                    // برای جدول‌هایی با شناسهٔ سفارشی (مثلِ ارزها که با `code` شناخته می‌شوند):
                    // رکوردِ دریافتیِ بدونِ شناسهٔ معتبر را «اعمال نکن». این جلوی ورودِ دادهٔ
                    // خرابِ ابری (مثلِ ارزِ تستِ بدونِ code) به دستگاه را می‌گیرد — همان چیزی که
                    // در گزارش‌ها به‌صورتِ [object Object] یا «ارزِ تست» دیده می‌شد.
                    if (hasCustomId && !(r.data && idOf(r.data, table))) return;

                    var origId = idOf(r.data, table) || stripDevice(r.record_id);

                    // echo: تغییری که خودِ این دستگاه فرستاده. معمولاً فقط snapshot را هم‌تراز
                    // می‌کنیم چون رکورد از قبل به‌صورتِ محلی داریم. اما اگر رکورد در local نباشد
                    // (مثلاً پس از Local-Only Wipe یا پاک‌شدنِ داده)، این «restore» است نه echo →
                    // باید به local هم نوشته شود تا داده‌ی همان دستگاه از Cloud بازگردد.
                    if (r.device_key === myDev) {
                        if (r.deleted_at || byId[origId] != null) {
                            snap[table][origId] = { rid: r.record_id, h: r.deleted_at ? '_del' : recHash(r.data), rev: r.revision, u: r.updated_at, deleted: !!r.deleted_at, mine: true };
                            return;
                        }
                        // رکورد در local نیست → بازیابی کن (به local بنویس) و snapshot را ست کن.
                        arr.push(r.data); byId[origId] = arr.length - 1; changed = true;
                        snap[table][origId] = { rid: r.record_id, h: recHash(r.data), rev: r.revision, u: r.updated_at, deleted: false, mine: true };
                        return;
                    }
                    // حلِ تعارض: نسخهٔ دریافتی وقتی برنده است که از آخرین نسخهٔ شناخته‌شده جدیدتر باشد.
                    var known = snap[table][origId];
                    if (known && known.u && r.updated_at <= known.u) return;

                    // تشخیصِ تعارضِ مالی: اگر رکوردِ محلی «ویرایشِ همگام‌نشده» دارد (هَشِ فعلی‌اش با
                    // هَشِ snapshot فرق دارد) و نسخهٔ دریافتیِ برنده هم با محلی فرق دارد → این یک
                    // تعارضِ واقعی است. برندهٔ LWW (سرور، جدیدتر) اعمال می‌شود، ولی نسخهٔ بازندهٔ
                    // محلی در لاگِ تعارض نگه داشته می‌شود تا هیچ ویرایشِ مالی گم نشود.
                    if (EDITABLE_FINANCIAL_TABLES[table] && !r.deleted_at && known && byId[origId] != null && r.device_key !== myDev) {
                        var localRec = arr[byId[origId]];
                        var localH = recHash(localRec);
                        // تعارضِ واقعی: مقدارِ محلی با نسخهٔ برندهٔ دریافتی فرق دارد، و مقدارِ محلی یا
                        // «ویرایشِ خودِ این دستگاه» بوده (known.mine) یا هنوز همگام‌نشده است (localH≠known.h).
                        if (localH !== recHash(r.data) && (known.mine === true || localH !== known.h)) {
                            logConflict({
                                table: table, record_id: r.record_id, id: origId,
                                at: nowIso(), resolvedBy: 'server-updated_at (LWW)',
                                losing_local: localRec, winning_remote: r.data,
                                winning_updated_at: r.updated_at,
                                local_revision: (known && known.rev) || null, remote_revision: r.revision
                            });
                            warn('تعارضِ مالی روی', table, origId, '— نسخهٔ بازنده در لاگ نگه داشته شد (jouya_sync_conflicts).');
                        }
                    }

                    if (r.deleted_at) {
                        if (byId[origId] != null) { arr.splice(byId[origId], 1); byId = reindex(arr, table); changed = true; appliedCount++; }
                    } else {
                        if (byId[origId] != null) { arr[byId[origId]] = r.data || {}; }
                        else { arr.push(r.data || {}); byId = reindex(arr, table); }
                        changed = true; appliedCount++;
                    }
                    // record_idِ ابری را نگه دار تا ویرایش‌های بعدیِ این دستگاه به همان جا بروند.
                    snap[table][origId] = { rid: r.record_id, h: r.deleted_at ? '_del' : recHash(r.data), rev: r.revision, u: r.updated_at, deleted: !!r.deleted_at, mine: false };
                });

                if (changed) writeArray(key, arr);
            });
            snapWrite(snap);
        } finally {
            _applyingRemote = false;
        }
        return appliedCount;
    }
    function reindex(arr, table) { var b = {}; arr.forEach(function (rec, idx) { b[idOf(rec, table)] = idx; }); return b; }

    // اعمالِ تنظیماتِ سطحِ فروشگاه (store_settings، شاملِ jouya-reference-rates یعنی
    // نرخ‌های مرجعِ ارز) هنگامِ pull. برخلافِ نسخهٔ قبل (که این‌ها فقط یک‌بار در مهاجرت
    // آپلود می‌شدند و هرگز دانلود نمی‌شدند)، از این پس کاملاً دوطرفه و زنده سینک می‌شوند:
    // مقدارِ هر کلید مستقیماً در همان کلیدِ localStorage نوشته می‌شود (نه در یک آرایه).
    function applySettingsIncoming(recs, snap, myDev) {
        snap[STORE_SETTINGS_TABLE] = snap[STORE_SETTINGS_TABLE] || {};
        var applied = 0;
        recs.forEach(function (r) {
            var k = (r.data && r.data.key) || stripDevice(r.record_id);

            // echo: تغییری که خودِ این دستگاه فرستاده — فقط snapshot را هم‌تراز کن.
            if (r.device_key === myDev) {
                snap[STORE_SETTINGS_TABLE][k] = { rid: r.record_id, h: recHash(r.data), rev: r.revision, u: r.updated_at };
                return;
            }
            // حلِ تعارض: نسخهٔ دریافتی وقتی برنده است که از آخرین نسخهٔ شناخته‌شده جدیدتر باشد.
            var known = snap[STORE_SETTINGS_TABLE][k];
            if (known && known.u && r.updated_at <= known.u) return;

            if (!r.deleted_at && r.data && k) {
                var incomingVal = r.data.value;
                // ادغامِ امن: اگر تنظیماتِ دریافتی یک شیء است، فیلدهای «حجیمِ محلی» (لوگو و
                // تصاویرِ base64) را که عمداً سینک نمی‌شوند از نسخهٔ محلی نگه می‌داریم تا
                // دستگاهِ دوم لوگوی خودش را از دست ندهد.
                if (incomingVal && typeof incomingVal === 'object' && !Array.isArray(incomingVal)) {
                    var localVal = null; try { localVal = JSON.parse(LS_get(k) || 'null'); } catch (e) {}
                    if (localVal && typeof localVal === 'object') {
                        HEAVY_SETTING_FIELDS.forEach(function (f) {
                            if (localVal[f] != null && incomingVal[f] == null) incomingVal[f] = localVal[f];
                        });
                        // هر فیلدِ محلیِ data: (تصویر) که در نسخهٔ دریافتی نیست را هم حفظ کن
                        for (var lk in localVal) {
                            if (Object.prototype.hasOwnProperty.call(localVal, lk) && isDataUrl(localVal[lk]) && incomingVal[lk] == null) {
                                incomingVal[lk] = localVal[lk];
                            }
                        }
                    }
                }
                LS_set(k, JSON.stringify(incomingVal));
                applied++;
            }
            snap[STORE_SETTINGS_TABLE][k] = { rid: r.record_id, h: recHash(r.data), rev: r.revision, u: r.updated_at };
        });
        return applied;
    }

    // ===========================================================================
    //  اعمالِ نتیجه در برنامه: بازساختِ مشتق‌ها + رفرشِ UI
    // ===========================================================================
    function refreshApp() {
        try { if (typeof window.rebuildAllDerivedData === 'function') window.rebuildAllDerivedData(); } catch (e) {}
        // رابطِ ارز/نرخ را هم تازه کن تا نرخ‌ها و ارزهای دریافت‌شده روی دستگاهِ دوم فوری دیده شوند.
        try {
            if (typeof window.CurrencySystem !== 'undefined' && window.CurrencySystem) {
                if (typeof window.CurrencySystem._changed === 'function') window.CurrencySystem._changed();
                else if (typeof window.CurrencySystem.refresh === 'function') window.CurrencySystem.refresh();
            }
        } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('jouya-data-change', { detail: { reason: 'sync-pull', remote: true } })); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('jouya-currency-change', { detail: { remote: true } })); } catch (e) {}
    }

    // ===========================================================================
    //  حلقهٔ آنلاین/آفلاین + polling + صفِ تلاشِ دوباره
    // ===========================================================================
    var online = (typeof navigator === 'undefined') ? true : (navigator.onLine !== false);
    var pollTimer = null, retryTimer = null, wsAccel = null;

    function startLoops() {
        stopLoops();
        if (!CFG.liveSyncEnabled || !workspaceId) return;
        // یک pull اولیه، سپس Realtime (مسیرِ اصلیِ لحظه‌ای) + polling تطبیقیِ کم‌مصرف (fallback)
        pullNow();
        connectRealtime();   // مسیرِ اصلیِ به‌روزرسانیِ لحظه‌ای
        scheduleNextPoll();  // fallback با فاصلهٔ تطبیقی (نظر به وضعیتِ Realtime)
        log('حلقهٔ سینک شروع شد (poll تطبیقی: Realtime-on', POLL_SLOW_MS, 'ms / Realtime-off', POLL_FAST_MS, 'ms)');
    }
    // زمان‌بندِ تطبیقیِ polling: اگر WebSocketِ Realtime باز باشد با فاصلهٔ زیاد (کم‌مصرف)،
    // وگرنه با فاصلهٔ کم اجرا می‌شود. با setTimeoutِ بازگشتی تا فاصله در هر چرخه بازارزیابی شود.
    function scheduleNextPoll() {
        var wsOpen = !!(wsAccel && wsAccel.readyState === 1);   // 1 = WebSocket.OPEN
        var delay = wsOpen ? POLL_SLOW_MS : POLL_FAST_MS;
        pollTimer = setTimeout(function () {
            if (online) { pushNow(); pullNow(); }
            scheduleNextPoll();
        }, delay);
    }
    function stopLoops() {
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        if (wsAccel && wsAccel.close) { try { wsAccel.close(); } catch (e) {} wsAccel = null; }
    }
    function queueRetry() {
        if (retryTimer) return;
        retryTimer = setTimeout(function () { retryTimer = null; if (online) pushNow(); }, RETRY_MS);
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('online',  function () { online = true;  log('آنلاین شد — سینک از سر گرفته می‌شود'); pushNow(); pullNow(); });
        window.addEventListener('offline', function () { online = false; log('آفلاین شد — تغییرات محلی صف می‌شوند'); });
    }

    // شنوندهٔ رویدادِ موجودِ برنامه: هر تغییرِ محلی → push (مگر در حالِ اعمالِ دادهٔ دریافتی)
    window.addEventListener('jouya-data-change', function (e) {
        if (_applyingRemote) return;
        if (e && e.detail && e.detail.remote) return;   // این رویداد از خودِ pull آمده
        if (!CFG.liveSyncEnabled) return;
        // کمی تأخیر تا چند تغییرِ پشتِ‌سرهم یک‌جا push شوند (کوتاه، تا سینک تقریباً لحظه‌ای بماند)
        clearTimeout(window._syncPushDebounce);
        window._syncPushDebounce = setTimeout(function () { pushNow(); }, 120);
    });

    // ===========================================================================
    //  Realtime WebSocket (شتاب‌دهنده) — بهترین‌تلاش؛ اگر خطا کند polling کافی است
    //  پروتکلِ Phoenix سوپابیس: join روی topic، سپس هر رویداد → یک pull فوری.
    // ===========================================================================
    function connectRealtime() {
        if (typeof WebSocket === 'undefined' || !workspaceId) return;
        try {
            var ref = Sb.url.replace(/^https?:\/\//, '').split('.')[0];
            var wsUrl = Sb.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(Sb.anon) + '&vsn=1.0.0';
            var ws = new WebSocket(wsUrl);
            wsAccel = ws;
            var refN = 0;
            var hb = null;
            ws.onopen = function () {
                // join روی کانالِ postgres_changes برای این workspace
                var joinMsg = {
                    topic: 'realtime:public:sync:' + workspaceId,
                    event: 'phx_join',
                    payload: { config: { postgres_changes: COLLECTIONS.map(function (c) {
                        return { event: '*', schema: 'public', table: c.table, filter: 'workspace_id=eq.' + workspaceId };
                    }).concat([{ event: '*', schema: 'public', table: STORE_SETTINGS_TABLE, filter: 'workspace_id=eq.' + workspaceId }]) } },
                    ref: String(++refN)
                };
                // احراز هویتِ کانال با توکنِ کاربر (برای RLS)
                if (SESSION && SESSION.access_token) {
                    ws.send(JSON.stringify({ topic: joinMsg.topic, event: 'access_token', payload: { access_token: SESSION.access_token }, ref: String(++refN) }));
                }
                ws.send(JSON.stringify(joinMsg));
                hb = setInterval(function () {
                    try { ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++refN) })); } catch (e) {}
                }, 25000);
                log('Realtime وصل شد');
            };
            ws.onmessage = function (evt) {
                // هر پیامِ تغییرِ داده → یک pull فوری (near-instant)
                try {
                    var msg = JSON.parse(evt.data);
                    if (msg && (msg.event === 'postgres_changes' || msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE')) {
                        clearTimeout(window._syncPullDebounce);
                        window._syncPullDebounce = setTimeout(function () { pullNow(); }, 150);
                    }
                } catch (e) {}
            };
            ws.onclose = function () { if (hb) clearInterval(hb); if (wsAccel === ws) wsAccel = null; /* polling ادامه دارد */ };
            ws.onerror = function () { /* بی‌صدا؛ polling جای‌گزین است */ };
        } catch (e) { /* WebSocket نشد؛ polling کافی است */ }
    }

    // ===========================================================================
    //  مهاجرتِ سه‌مرحله‌ای (آپلود → تأیید شمارش → نهایی‌سازی) — از فاز ۲
    // ===========================================================================
    function buildRowsAll(col) {
        var arr = readArray(col.key), dk = shortDevice();
        // رکوردهای بی‌شناسه (مثلِ ارزِ بدونِ کد) در مهاجرت هم نادیده گرفته می‌شوند تا از
        // همان ابتدا دادهٔ خراب در ابر seed نشود.
        return arr.filter(function (rec) { return !!idOf(rec, col.table); })
            .map(function (rec) { return { workspace_id: workspaceId, record_id: makeRecordId(rec, col.table), data: rec, deleted_at: null, device_key: dk }; });
    }
    function buildStoreSettingsRows() {
        var dk = shortDevice(), rows = [];
        STORE_SETTING_KEYS.forEach(function (k) {
            var raw = LS_get(k); if (raw == null) return;
            var val; try { val = JSON.parse(raw); } catch (e) { val = raw; }
            var data = safeSettingData(k, val);   // لوگو/تصاویرِ حجیم حذف می‌شوند
            if (!data) return;
            rows.push({ workspace_id: workspaceId, record_id: 'setting:' + k, data: data, deleted_at: null, device_key: dk });
        });
        return rows;
    }
    function localCounts() { var c = {}; COLLECTIONS.forEach(function (col) { c[col.table] = readArray(col.key).filter(function (rec) { return !!idOf(rec, col.table); }).length; }); return c; }

    // ===========================================================================
    //  bootstrap — منطقِ درستِ راه‌اندازیِ سینک هنگامِ ورود/اتصال.
    //  «اول دانلود، بعد آپلود»: این تضمین می‌کند که اگر لوکال‌استوریج خالی باشد ولی ابر
    //  داده داشته باشد (دستگاهِ تازه یا کاربری که لوکالش را پاک کرده)، داده‌ها از ابر
    //  دانلود شوند — نه اینکه لوکالِ خالی مهاجرت شود و مهاجرت به‌خاطرِ نبودنِ برابریِ شمارش
    //  ناتمام بماند. برای همهٔ حالت‌ها امن است (هرگز داده‌ای حذف نمی‌شود، فقط اتحاد/union):
    //    • لوکال خالی + ابر پر  → دانلودِ کامل (باگِ گزارش‌شده حل می‌شود)
    //    • ابر خالی + لوکال پر  → آپلودِ کامل (مثلِ مهاجرتِ کاربرِ قدیمی)
    //    • هر دو پر             → union (دانلود + آپلودِ رکوردهای فقط‌محلی)
    // ===========================================================================
    function bootstrap(wsId) {
        wsId = wsId || workspaceId;
        if (!wsId) return Promise.reject(new Error('workspaceId لازم است'));
        workspaceId = wsId;
        LS_set('jouya_sync_workspace', wsId);
        log('bootstrap برای', wsId, '(اول دانلود، بعد آپلود)');
        // ۱) دانلودِ کاملِ ابر از ابتدا → داده‌های ابری وارد لوکال می‌شوند (فقط افزودن/به‌روزرسانی).
        LS_set(CURSOR_KEY, '1970-01-01T00:00:00Z');
        return pullNow().then(function (downloaded) {
            // ۲) آپلودِ رکوردهای فقط‌محلی (detectChanges در برابرِ snapshotِ ساخته‌شده از pull).
            return pushNow().then(function () {
                // ۳) نهایی‌سازی + شروعِ سینکِ زنده.
                LS_set('jouya_sync_migrated', 'true');
                LS_set('jouya_sync_workspace', wsId);
                try { start(); } catch (e) {}
                log('✅ bootstrap کامل شد — دانلودشده:', downloaded || 0);
                return { ok: true, downloaded: downloaded || 0 };
            });
        }).catch(function (e) { warn('bootstrap ناموفق:', e.message); return { ok: false, error: e.message }; });
    }

    function migrate(wsId) {
        wsId = wsId || workspaceId;
        if (!wsId) return Promise.reject(new Error('workspaceId لازم است'));
        workspaceId = wsId;
        log('شروع مهاجرت برای', wsId);
        var chain = Promise.resolve(), uploaded = {}, seedSnap = {};
        COLLECTIONS.forEach(function (col) {
            chain = chain.then(function () {
                var rows = buildRowsAll(col); uploaded[col.table] = rows.length;
                seedSnap[col.table] = {};
                if (!rows.length) return;
                // نگاشتِ record_id → {id, hash} تا snapshot را از پاسخِ «سرور» بسازیم.
                var metaByRid = {}; rows.forEach(function (r) { metaByRid[r.record_id] = { id: (idOf(r.data, col.table) || stripDevice(r.record_id)), h: recHash(r.data) }; });
                return uploadInBatches(col.table, rows, BATCH_UPLOAD).then(function (serverRows) {
                    (serverRows || []).forEach(function (sr) { var m = metaByRid[sr.record_id]; if (!m) return; seedSnap[col.table][m.id] = { rid: sr.record_id, h: m.h, rev: sr.revision, u: sr.updated_at }; });
                });
            });
        });
        chain = chain.then(function () {
            var rows = buildStoreSettingsRows(); if (!rows.length) return;
            var metaByRid = {}; rows.forEach(function (r) { metaByRid[r.record_id] = { id: r.data.key, h: recHash(r.data) }; });
            return Sb.upsert(STORE_SETTINGS_TABLE, rows).then(function (serverRows) {
                seedSnap[STORE_SETTINGS_TABLE] = seedSnap[STORE_SETTINGS_TABLE] || {};
                (serverRows || []).forEach(function (sr) { var m = metaByRid[sr.record_id]; if (!m) return; seedSnap[STORE_SETTINGS_TABLE][m.id] = { rid: sr.record_id, h: m.h, rev: sr.revision, u: sr.updated_at }; });
            });
        });

        var verify = {};
        chain = chain.then(function () {
            var v = Promise.resolve();
            COLLECTIONS.forEach(function (col) {
                v = v.then(function () { return Sb.count(col.table, wsId).then(function (n) { verify[col.table] = { local: localCounts()[col.table], cloud: n, ok: localCounts()[col.table] === n }; }); });
            });
            return v;
        });
        return chain.then(function () {
            var allOk = Object.keys(verify).every(function (t) { return verify[t].ok; });
            if (allOk) {
                snapWrite(seedSnap);                       // snapshot اولیه = وضعیتِ آپلودشده
                LS_set(CURSOR_KEY, '1970-01-01T00:00:00Z'); // اولین pull همهٔ دادهٔ ابری (شاملِ دستگاه‌های دیگر) را دانلود کند؛ رکوردهای خودی با echo رد می‌شوند
                LS_set('jouya_sync_migrated', 'true');
                LS_set('jouya_sync_workspace', wsId);
                log('✅ مهاجرت کامل و تأیید شد', verify);
            } else {
                warn('⛔ مهاجرت ناتمام — دادهٔ محلی دست‌نخورده ماند.', verify);
            }
            return { ok: allOk, uploaded: uploaded, verify: verify };
        });
    }

    // ===========================================================================
    //  API عمومی
    // ===========================================================================
    window.JouyaSync = {
        config: CFG,
        deviceKey: deviceKey,
        collections: COLLECTIONS,
        localCounts: localCounts,
        cleanup: cleanupIdentityIssues,

        // پاک‌سازیِ ارزهای «خراب» در ابر: رکوردهای currencies که code ندارند (مثلِ ارزِ تستِ
        // به‌جامانده). با توکنِ کاربر (عضوِ workspace) soft-delete می‌شوند تا از همهٔ دستگاه‌ها
        // حذف شوند. یک‌بار اجرا: await JouyaSync.purgeBadCurrencies()
        purgeBadCurrencies: function () {
            var ws = workspaceId; if (!ws) return Promise.resolve({ ok: false, reason: 'no-workspace' });
            return ensureToken().then(function () {
                return Sb.req('/rest/v1/currencies?workspace_id=eq.' + encodeURIComponent(ws) + '&deleted_at=is.null&select=record_id,data');
            }).then(function (rows) {
                if (!Array.isArray(rows)) return { ok: false };
                var bad = rows.filter(function (r) { return !(r.data && r.data.code); });
                var chain = Promise.resolve();
                bad.forEach(function (r) {
                    chain = chain.then(function () {
                        return Sb.req('/rest/v1/currencies?workspace_id=eq.' + encodeURIComponent(ws) + '&record_id=eq.' + encodeURIComponent(r.record_id),
                            { method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: { deleted_at: nowIso(), device_key: shortDevice() } });
                    });
                });
                return chain.then(function () {
                    // از snapshot محلی هم پاکشان کن تا دوباره تلاش نشود
                    try { var snap = snapRead(); if (snap.currencies) { bad.forEach(function (r) { var id = stripDevice(r.record_id); if (snap.currencies[id]) delete snap.currencies[id]; }); snapWrite(snap); } } catch (e) {}
                    log('purgeBadCurrencies: ' + bad.length + ' ارزِ خراب در ابر حذف شد');
                    return { ok: true, removed: bad.length };
                });
            }).catch(function (e) { warn('purgeBadCurrencies ناموفق:', e.message); return { ok: false, error: e.message }; });
        },

        session: function () { return SESSION; },
        isMigrated: function () { return LS_get('jouya_sync_migrated') === 'true'; },

        testConnection: function () { if (!Sb.url || !Sb.anon) { warn('sync-config.js تنظیم نشده'); return Promise.resolve(false); } return Sb.ping().then(function (ok) { log(ok ? '✅ اتصال برقرار است' : '⛔ اتصال ناموفق'); return ok; }); },
        signIn: signIn,
        signUp: signUp,
        signOut: function () { SESSION = null; sessWrite(null); stopLoops(); log('خروج'); },
        claimLicense: function (code, ws) { return Sb.rpc('claim_license', { p_code: code, p_workspace: ws || workspaceId }); },
        licenseStatus: function (ws) { return Sb.rpc('license_status', { p_workspace: ws || workspaceId }); },
        migrate: migrate,
        bootstrap: bootstrap,

        // لاگِ تعارض‌های مالیِ نگه‌داشته‌شده (نسخه‌های بازنده‌ای که با LWW بازنویسی شدند).
        conflicts: function () { try { var a = JSON.parse(LS_get(CONFLICT_LOG_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
        clearConflicts: function () { try { localStorage.removeItem(CONFLICT_LOG_KEY); } catch (e) {} return true; },
        pushConflicts: pushConflicts,
        pullConflicts: pullConflicts,

        // Local-Only Wipe (پاک‌کردنِ Localِ همین دستگاه، بدونِ Delete در Cloud)
        localOnlyWipe: localOnlyWipe,
        previewLocalOnlyWipe: previewLocalOnlyWipe,
        // مجموعه‌های آمادهٔ کلیدها (منبعِ واحدِ حقیقت برای دکمه‌های سایدبار):
        ALL_BUSINESS_KEYS: COLLECTIONS.map(function (c) { return c.key; }).concat(['jouya-reference-rates', 'dashboardStats', 'backupHistory', 'activeWarehouseId', 'cashboxTypes']),
        PERSONS_KEYS: ['persons'],

        // بررسیِ مهاجرت: هم شمارش و هم «هویتِ رکوردها» (record_id) را Verify می‌کند — نه فقط تعداد.
        // برای هر جدول: مجموعهٔ record_idهای موردانتظارِ محلی (از snapshot rid یا makeRecordId) با
        // مجموعهٔ record_idهای واقعیِ ابر مقایسه می‌شود. خروجی هر جدول: {local, cloud, matched,
        // missing, ok} که ok یعنی همهٔ رکوردهای محلی با همان record_id در ابر حاضرند (بدونِ گم‌شدن).
        migrationVerify: function () {
            var ws = workspaceId;
            if (!ws) return Promise.resolve({ ok: false, reason: 'no-workspace' });
            var snap = snapRead();
            return ensureToken().then(function () {
                var out = {};
                return Promise.all(COLLECTIONS.map(function (col) {
                    var arr = readArray(col.key);
                    // record_idِ موردانتظارِ هر رکوردِ محلی
                    var expected = {};
                    var p = snap[col.table] || {};
                    arr.forEach(function (rec) {
                        var id = idOf(rec, col.table); if (!id) return;
                        var rid = (p[id] && p[id].rid) ? p[id].rid : makeRecordId(rec, col.table);
                        expected[rid] = true;
                    });
                    var expectedIds = Object.keys(expected);
                    // record_idهای واقعیِ ابر
                    return Sb.req('/rest/v1/' + col.table + '?workspace_id=eq.' + encodeURIComponent(ws) +
                        '&deleted_at=is.null&select=record_id').then(function (rows) {
                        var cloudSet = {}; (rows || []).forEach(function (r) { cloudSet[r.record_id] = true; });
                        var missing = expectedIds.filter(function (rid) { return !cloudSet[rid]; });
                        out[col.table] = {
                            local: arr.length,
                            cloud: Object.keys(cloudSet).length,
                            matched: expectedIds.length - missing.length,
                            missing: missing.length,
                            ok: missing.length === 0
                        };
                    }).catch(function () { out[col.table] = { local: arr.length, cloud: -1, matched: 0, missing: expectedIds.length, ok: false }; });
                })).then(function () {
                    var ok = Object.keys(out).every(function (t) { return out[t].ok; });
                    return { ok: ok, tables: out };
                });
            });
        },

        // کنترلِ سینکِ زنده
        start: startLoops,
        stop: stopLoops,
        pushNow: pushNow,
        pullNow: pullNow,

        _sb: Sb,
        _detectChanges: detectChanges,
        _applyIncoming: applyIncoming
    };

    // ===========================================================================
    //  راه‌اندازیِ خودکار: اگر نشستِ ذخیره‌شده + مهاجرتِ کامل + liveSync داریم، شروع کن
    // ===========================================================================
    function autoStart() {
        if (!CFG.liveSyncEnabled) { log('لایهٔ سینک بارگذاری شد (liveSync خاموش)'); return; }
        if (SESSION && SESSION.access_token && workspaceId && LS_get('jouya_sync_migrated') === 'true') {
            ensureToken().then(startLoops);
        } else if (SESSION && SESSION.access_token && workspaceId) {
            // نشست و workspace داریم ولی هنوز مهاجرت/راه‌اندازی نشده (دستگاهِ تازه یا لوکالِ
            // پاک‌شده) → bootstrap: اول از ابر دانلود کن، بعد آپلود. این همان حالتی است که
            // قبلاً داده‌ها از ابر برنمی‌گشتند.
            log('نشستِ ابری بدونِ مهاجرت — bootstrap خودکار (دانلود از ابر)');
            ensureToken().then(function () { return bootstrap(workspaceId); });
        } else {
            log('لایهٔ سینک آماده است؛ برای شروع، ورود لازم است');
        }
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('load', function () { setTimeout(autoStart, 500); });
    }
    autoStart();

    log('sync-layer فاز ۳ بارگذاری شد. liveSync=', !!CFG.liveSyncEnabled);
})();

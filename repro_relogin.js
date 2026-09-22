/**
 * repro_relogin.js
 * بازتولیدِ دقیقِ سناریوی کاربر با بارگذاریِ فایل‌های واقعیِ sync-layer.js و auth-cloud.js
 * روی یک «ابرِ Supabase ماک». هدف: نشان‌دادنِ اینکه چرا پس از
 *   حذفِ کاملِ دیتابیس/افراد (Local-Only Wipe) → خروج → ورودِ مجدد با همان حساب،
 * اکثرِ داده‌ها از ابر بازیابی نمی‌شوند.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

// ---------- ابرِ ماک (شبیه‌سازِ trigger سرور: updated_at=now(), revision++) ----------
let serverClock = 0;
const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
function nextTs() { serverClock += 1; return new Date(BASE + serverClock * 1000).toISOString(); }
const cloud = new Map();                 // key: ws::record_id -> row
const WS_ID = 'ws-REAL-1';
function ckey(ws, rid) { return ws + '::' + rid; }

function cloudUpsert(table, rows) {
  const out = [];
  rows.forEach(r => {
    const k = ckey(r.workspace_id, r.record_id);
    const old = cloud.get(k);
    const row = {
      _table: table,
      workspace_id: r.workspace_id,
      record_id: r.record_id,
      data: r.data,
      deleted_at: (r.deleted_at !== undefined ? r.deleted_at : null),
      device_key: r.device_key || null,
      revision: (old && old.revision ? old.revision : 0) + 1,   // سرور: revision++
      updated_at: nextTs()                                       // سرور: now()
    };
    cloud.set(k, row);
    out.push({ record_id: row.record_id, revision: row.revision, updated_at: row.updated_at, deleted_at: row.deleted_at, device_key: row.device_key, data: row.data });
  });
  return out;
}
function cloudPull(table, ws, sinceIso, limit) {
  const rows = [];
  cloud.forEach(row => {
    if (row._table === table && row.workspace_id === ws && row.updated_at >= sinceIso) {
      rows.push({ record_id: row.record_id, data: row.data, revision: row.revision, updated_at: row.updated_at, deleted_at: row.deleted_at, device_key: row.device_key });
    }
  });
  rows.sort((a, b) => a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0);
  return rows.slice(0, limit || 1000);
}
function cloudCount(table, ws) {
  let n = 0; cloud.forEach(row => { if (row._table === table && row.workspace_id === ws && !row.deleted_at) n++; });
  return n;
}
function totalCloudActive() { let n = 0; cloud.forEach(r => { if (!r.deleted_at) n++; }); return n; }

// ---------- fetch ماک (endpointهایی که sync-layer واقعاً صدا می‌زند) ----------
function makeResp(status, bodyObj, headers) {
  const text = bodyObj == null ? '' : (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj));
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
    headers: { get: (h) => (headers && headers[h.toLowerCase()]) || null }
  });
}
function mockFetch(url, opts) {
  opts = opts || {};
  const method = (opts.method || 'GET').toUpperCase();
  const u = new URL(url);
  const path = u.pathname;
  let body = null; try { body = opts.body ? JSON.parse(opts.body) : null; } catch (e) {}

  // Auth
  if (path === '/auth/v1/token' || path === '/auth/v1/signup') {
    return makeResp(200, { access_token: 'tok-' + (++serverClock), refresh_token: 'ref-1', expires_in: 3600, user: { email: (body && body.email) || 'u@x.com', id: 'uid-1' } });
  }
  // RPC
  if (path === '/rest/v1/rpc/bootstrap_workspace') return makeResp(200, WS_ID);
  if (path === '/rest/v1/rpc/claim_license')       return makeResp(200, { ok: true });
  if (path === '/rest/v1/rpc/check_license')        return makeResp(200, { ok: true, valid: true });
  if (path === '/rest/v1/rpc/license_status')       return makeResp(200, { ok: true });

  // REST table ops:  /rest/v1/<table>
  const m = path.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (m) {
    const table = m[1];
    if (method === 'POST') {            // upsert
      const rows = Array.isArray(body) ? body : [body];
      const echoed = cloudUpsert(table, rows);
      return makeResp(201, echoed);     // return=representation
    }
    if (method === 'HEAD') {            // count
      const ws = (u.searchParams.get('workspace_id') || '').replace(/^eq\./, '');
      const n = cloudCount(table, ws);
      return makeResp(200, '', { 'content-range': '0-' + Math.max(0, n - 1) + '/' + n });
    }
    if (method === 'GET') {
      const ws = (u.searchParams.get('workspace_id') || '').replace(/^eq\./, '');
      const gte = u.searchParams.get('updated_at');
      const isNullDeleted = (u.searchParams.get('deleted_at') === 'is.null');
      if (gte) {                        // pullSince
        const sinceIso = decodeURIComponent(gte.replace(/^gte\./, ''));
        return makeResp(200, cloudPull(table, ws, sinceIso, 1000));
      }
      // migrationVerify / purge style: select record_id where deleted_at is null
      const rows = [];
      cloud.forEach(row => { if (row._table === table && row.workspace_id === ws && (!isNullDeleted || !row.deleted_at)) rows.push({ record_id: row.record_id, data: row.data }); });
      return makeResp(200, rows);
    }
    if (method === 'PATCH') { return makeResp(200, ''); }
  }
  // ping
  if (path === '/rest/v1/' || path === '/rest/v1') return makeResp(200, {});
  return makeResp(404, { message: 'not-found:' + path });
}

// ---------- localStorage ماک ----------
function makeLS() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    _dump: () => Object.assign({}, store)
  };
}

// ---------- window/context ماک ----------
function makeContext(ls) {
  const listeners = {};
  const win = {
    JOUYA_SYNC_CONFIG: {
      url: 'https://mock.supabase.co',
      anonKey: 'anon-key',
      syncProtocolVersion: 1,
      liveSyncEnabled: true
    },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatchEvent: () => true,
    removeEventListener: () => {},
    rebuildAllDerivedData: () => {},
    setTimeout: (fn) => 0,        // تایمرها را غیرفعال کن تا حلقهٔ زنده تستِ ما را شلوغ نکند
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: { onLine: true },
    console
  };
  win.window = win;
  const ctx = {
    window: win,
    localStorage: ls,
    navigator: { onLine: true },
    console,
    fetch: mockFetch,
    URL,
    setTimeout: (fn) => 0,         // بی‌اثر: حلقه/دیبونس اجرا نشود
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    Date,
    JSON,
    Promise,
    Math,
    CustomEvent: function (n, o) { return { type: n, detail: o && o.detail }; },
    WebSocket: function () { this.close = () => {}; },     // Realtime ماک (بی‌اثر)
    encodeURIComponent, decodeURIComponent, parseInt
  };
  ctx.global = ctx;
  return { ctx, win };
}

const SRC_SYNC  = fs.readFileSync(__dirname + '/sync-layer.js', 'utf8');
const SRC_CLOUD = fs.readFileSync(__dirname + '/auth-cloud.js', 'utf8');

function boot() {
  const ls = makeLS();
  const { ctx, win } = makeContext(ls);
  vm.createContext(ctx);
  vm.runInContext(SRC_SYNC, ctx, { filename: 'sync-layer.js' });
  vm.runInContext(SRC_CLOUD, ctx, { filename: 'auth-cloud.js' });
  return { ls, win, S: win.JouyaSync, A: win.JouyaAuth };
}

// ---------- ابزارِ سناریو ----------
const COLL_KEYS = ['products', 'persons', 'transactions', 'cashboxes', 'cashboxTransactions', 'jouya-currencies'];
function seedLocal(ls) {
  ls.setItem('products', JSON.stringify([
    { id: 101, name: 'کچالو', stock: 10 }, { id: 102, name: 'پیاز', stock: 5 },
    { id: 103, name: 'بادنجان', stock: 8 }, { id: 104, name: 'گوجه', stock: 20 }
  ]));
  ls.setItem('persons', JSON.stringify([{ id: 201, name: 'احمد' }, { id: 202, name: 'محمود' }]));
  ls.setItem('transactions', JSON.stringify([
    { id: 301, type: 'sale', total: 500 }, { id: 302, type: 'purchase', total: 300 }, { id: 303, type: 'sale', total: 900 }
  ]));
  ls.setItem('cashboxes', JSON.stringify([{ id: 401, name: 'صندوق اصلی' }]));
  ls.setItem('cashboxTransactions', JSON.stringify([{ id: 501, amount: 500 }, { id: 502, amount: -300 }]));
  ls.setItem('jouya-currencies', JSON.stringify([{ code: 'AFN', name: 'افغانی' }, { code: 'USD', name: 'دلار' }]));
}
function localCount(ls) {
  let n = 0; COLL_KEYS.forEach(k => { try { n += (JSON.parse(ls.getItem(k) || '[]') || []).length; } catch (e) {} });
  return n;
}
function localBreakdown(ls) {
  const o = {}; COLL_KEYS.forEach(k => { try { o[k] = (JSON.parse(ls.getItem(k) || '[]') || []).length; } catch (e) { o[k] = 0; } }); return o;
}
function setLocalAccount(ls, email, pass) {
  // شبیه‌سازِ اکانتِ محلی که auth-system می‌سازد (تا مسیرِ «سناریوی ۱»/onLoginSuccess فعال شود)
  ls.setItem('jouya_user_account', JSON.stringify({ email: email, passwordHash: 'H(' + pass + ')', fullName: 'کاربر' }));
  ls.setItem('jouya_license_info', JSON.stringify({ code: 'LIC-123' }));
  ls.setItem('jouya_remember_login', JSON.stringify({ email: email, password: pass }));
}

const wait = (p) => Promise.resolve(p);
function hr(t) { console.log('\n============ ' + t + ' ============'); }

// ===========================================================================
async function main() {
  const EMAIL = 'user@jouya.app', PASS = 'secret123';

  // ---------------- فاز A: راه‌اندازیِ اولیه (کاربر داده دارد و به ابر سینک می‌کند) ----------------
  hr('فاز A — کاربر داده دارد، وارد می‌شود و به ابر سینک می‌کند');
  const A0 = boot();
  seedLocal(A0.ls);
  setLocalAccount(A0.ls, EMAIL, PASS);
  await wait(A0.S.signIn(EMAIL, PASS));           // نشست + workspace
  await wait(A0.S.bootstrap(WS_ID));               // اول دانلود (ابر خالی) بعد آپلودِ همه‌چیز
  // شبیه‌سازِ «حلقهٔ زندهٔ poll» که در برنامهٔ واقعی cursor را جلو می‌برد: یک pull کامل کن.
  // (در برنامهٔ واقعی start() این را به‌صورت دوره‌ای انجام می‌دهد و cursor به آخرین updated_at می‌رسد.)
  await wait(A0.S.pullNow());
  const cloudAfter = totalCloudActive();
  console.log('محلی قبل از پاک‌سازی:', localCount(A0.ls), localBreakdown(A0.ls));
  console.log('ردیف‌های فعالِ ابر  :', cloudAfter);
  console.log('cursor بعد از سینک  :', A0.ls.getItem('jouya_sync_cursor'));
  console.log('migrated            :', A0.ls.getItem('jouya_sync_migrated'));

  // نشست/اکانت/ابر را برای فازهای بعد نگه می‌داریم؛ فقط localStorage همین دستگاه را دست‌کاری می‌کنیم.
  // ---------------- فاز B: Local-Only Wipe (حذف کاملِ دیتابیس + حذف افراد از داخلِ برنامه) --------
  hr('فاز B — حذفِ کاملِ دیتابیس و حذفِ همه افراد (Local-Only Wipe)');
  await wait(A0.S.localOnlyWipe(A0.S.ALL_BUSINESS_KEYS));   // دکمهٔ «حذف کامل دیتابیس»
  await wait(A0.S.localOnlyWipe(A0.S.PERSONS_KEYS));         // دکمهٔ «حذف همه افراد»
  console.log('محلی بعد از wipe     :', localCount(A0.ls), localBreakdown(A0.ls));
  console.log('ردیف‌های فعالِ ابر   :', totalCloudActive(), '(باید دست‌نخورده باشد)');
  console.log('cursor بعد از wipe   :', A0.ls.getItem('jouya_sync_cursor'), '  ← دست‌نخورده مانده');
  console.log('migrated بعد از wipe :', A0.ls.getItem('jouya_sync_migrated'), '   ← هنوز true');

  // ---------------- فاز C: خروج از حساب (Logout) ----------------
  hr('فاز C — خروج از حساب داخلِ برنامه');
  await wait(A0.A.logout());
  console.log('session بعد از logout:', A0.ls.getItem('jouya_sync_session'));
  console.log('cursor بعد از logout :', A0.ls.getItem('jouya_sync_cursor'), '  ← هنوز stale');
  console.log('migrated             :', A0.ls.getItem('jouya_sync_migrated'));
  console.log('linked               :', A0.ls.getItem('jouya_cloud_linked'));

  // ---------------- فاز D: ورودِ مجدد با همان حساب (مسیرِ واقعیِ برنامه = onLoginSuccess) ----------
  // در auth-system، handleLogin چون jouya_user_account هنوز موجود است و رمز می‌خورد،
  // «سناریوی ۱» را می‌گیرد و onLoginSuccess را صدا می‌زند (نه JouyaAuth.login/bootstrap).
  hr('فاز D — ورودِ مجدد با همان حساب (مسیرِ handleLogin سناریوی ۱ → onLoginSuccess)');
  console.log('cursor درست پیش از pullِ ورودِ مجدد:', A0.ls.getItem('jouya_sync_cursor'));
  console.log('ابر با updated_at >= cursor فعلی فقط این تعداد ردیف برمی‌گرداند:',
    cloudPull('products', WS_ID, A0.ls.getItem('jouya_sync_cursor'), 1000).length, '(products) — بقیه فیلتر می‌شوند');
  await wait(A0.A.onLoginSuccess(EMAIL, PASS, 'LIC-123'));
  // یک poll زنده هم دستی اجرا می‌کنیم (چون تایمرها در تست بی‌اثرند) تا معادلِ start() باشد:
  const appliedD = await wait(A0.S.pullNow());
  console.log('تعداد رکوردِ اعمال‌شده در pullِ ورودِ مجدد:', appliedD);
  const restored = localCount(A0.ls);
  console.log('محلی بعد از ورودِ مجدد:', restored, localBreakdown(A0.ls));
  console.log('ابر همچنان دارد      :', totalCloudActive());
  console.log('cursor فعلی          :', A0.ls.getItem('jouya_sync_cursor'));

  const bugReproduced = restored < cloudAfter;
  console.log('\n>>> نتیجهٔ مسیرِ واقعی (onLoginSuccess): بازیابی‌شده=' + restored + ' از ' + cloudAfter +
    (bugReproduced ? '  ❌ باگ بازتولید شد (اکثرِ داده‌ها برنگشت)' : '  ✅ کامل بازیابی شد'));

  // ---------------- کنترل: همان سناریو ولی از مسیرِ JouyaAuth.login (bootstrap) ----------------
  hr('کنترل — همان حساب، ولی ورود از مسیرِ JouyaAuth.login که bootstrap (ریست cursor) اجرا می‌کند');
  const C = boot();                 // دستگاهِ تازه، همان ابر (cloud سراسری است)
  // این‌بار اکانتِ محلی نمی‌گذاریم → handleLogin به «سناریوی ۲» می‌رود و JouyaAuth.login را صدا می‌زند
  const r = await wait(C.A.login(EMAIL, PASS));
  const restored2 = localCount(C.ls);
  console.log('محلی بعد از login    :', restored2, localBreakdown(C.ls));
  console.log('cursor بعد از login  :', C.ls.getItem('jouya_sync_cursor'));
  console.log('\n>>> نتیجهٔ مسیرِ کنترل (login→bootstrap): بازیابی‌شده=' + restored2 + ' از ' + cloudAfter +
    (restored2 >= cloudAfter ? '  ✅ کامل بازیابی شد' : '  ❌ ناقص'));

  // ---------------- جمع‌بندی ----------------
  hr('جمع‌بندیِ علتِ ریشه‌ای');
  console.log('مسیرِ واقعیِ کاربر (onLoginSuccess) بازیابی‌شده :', restored, '/', cloudAfter);
  console.log('مسیرِ کنترل     (login→bootstrap) بازیابی‌شده :', restored2, '/', cloudAfter);
  console.log('تفاوت فقط در این است که آیا cursor به epoch ریست می‌شود و full-download اجرا می‌شود یا نه.');

  process.exit(bugReproduced && restored2 >= cloudAfter ? 0 : 2);
}
main().catch(e => { console.error('EXC', e); process.exit(3); });

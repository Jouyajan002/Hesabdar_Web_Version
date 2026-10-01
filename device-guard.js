/**
 * device-guard.js — تأییدِ دستگاه «فقط برای نسخهٔ لینک/وب و آیفون» (قبل از ورود)
 * =============================================================================
 * لایهٔ کاملاً افزودنی و مستقل (مثلِ demo-mode.js / auth-cloud.js). هیچ فایلِ دیگری
 * را تغییر نمی‌دهد. هدف: کاربری که لینکِ وب را باز می‌کند (مرورگر یا آیفونِ PWA)
 * باید قبل از هر چیز یک‌بار از مدیر «کدِ تأیید» بگیرد و دستگاهش تأیید شود؛ تا آن
 * لحظه کلِ برنامه با یک پوششِ هماهنگ با طراحیِ اپ قفل است.
 *
 * ❗ مرزِ دقیق (طبقِ خواستهٔ شما):
 *   • نسخهٔ اندرویدِ اپلیکیشن (Capacitor) و نسخهٔ ویندوزِ Tauri → این منطق هیچ
 *     دخالتی ندارد و بی‌درنگ کنار می‌رود. (isAppRuntime پایین)
 *   • فقط نسخهٔ وب/لینک و آیفونِ PWA مشمولِ این دروازه‌اند.
 *
 * جریان:
 *   ۱) دستگاه با request_device_access ثبت می‌شود → وضعیت pending + کدِ ۶ رقمی.
 *   ۲) کاربر کد را به مدیر می‌گوید.
 *   ۳) مدیر در Supabase → Table Editor → device_requests ستونِ status را approved
 *      (یا blocked) می‌کند.
 *   ۴) این لایه خودکار (polling) تأیید را می‌بیند، فلگِ محلی را ست می‌کند و قفل باز
 *      می‌شود؛ سپس روندِ عادیِ ورود/لایسنس ادامه می‌یابد.
 *
 * تماس با سرور: مستقیم با fetch به REST RPC، با anonKeyِ window.JOUYA_SYNC_CONFIG
 * (نه از راهِ JouyaSync._sb که پیش از ورود ممکن است Authorization نامعتبر بفرستد).
 *
 * غیرمسدودکننده در خطا: اگر پیکربندیِ ابری نبود یا شبکه خطا داد، قفل نمی‌کنیم تا
 * کاربرِ واقعی بیرون نماند (این دروازه یک گیتِ کلاینتی است؛ محافظتِ اصلیِ داده همان
 * RLSِ سرور است). فقط وضعیت‌های صریحِ pending/blocked قفل می‌کنند.
 * =============================================================================
 */
(function () {
    'use strict';
    if (window._jouyaDeviceGuardInstalled) return;
    window._jouyaDeviceGuardInstalled = true;

    var APPROVED_FLAG = 'jouya_devreq_approved';   // فلگِ محلیِ «این دستگاه تأیید شده»
    var POLL_MS = 6000;

    var log = function () {
        try { console.log.apply(console, ['%c[device-guard]', 'color:#fff;background:#1e3a5f;padding:2px 6px;border-radius:3px'].concat([].slice.call(arguments))); } catch (e) {}
    };

    // ── آیا اصلاً باید اجرا شویم؟ (فقط وب/آیفون؛ نه اندرویدِ اپ، نه Tauri) ─────────
    function isAppRuntime() {
        try {
            if (window.__JOUYA_RUNTIME === 'tauri') return true;
            if (window.__TAURI__ || window.__TAURI_INTERNALS__) return true;
            if (window.Capacitor) {
                // Capacitor فقط وقتی «اپِ نیتیو» است که پلتفرمش android/ios باشد
                var p = (typeof window.Capacitor.getPlatform === 'function')
                    ? window.Capacitor.getPlatform() : (window.Capacitor.platform || '');
                if (p && p !== 'web') return true;
                if (window.Capacitor.isNativePlatform &&
                    window.Capacitor.isNativePlatform()) return true;
            }
        } catch (e) {}
        return false;
    }

    // ── پیکربندیِ ابری (url + anonKey) ───────────────────────────────────────────
    function cloudCfg() {
        var c = window.JOUYA_SYNC_CONFIG || null;
        if (c && c.url && c.anonKey) return { url: String(c.url).replace(/\/+$/, ''), key: c.anonKey };
        return null;
    }

    // ── شناسهٔ دستگاه (سازگار با drive-backup.js) ────────────────────────────────
    function deviceKey() {
        var id = null;
        try { id = localStorage.getItem('jouya_device_id'); } catch (e) {}
        if (!id) {
            id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
            try { localStorage.setItem('jouya_device_id', id); } catch (e) {}
        }
        return id;
    }

    function deviceLabel() {
        try {
            var ua = navigator.userAgent || '';
            var os = /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad'
                   : /Android/i.test(ua) ? 'Android-Web'
                   : /Windows/i.test(ua) ? 'Windows-Web'
                   : /Mac/i.test(ua) ? 'Mac-Web'
                   : /Linux/i.test(ua) ? 'Linux-Web' : 'Web';
            var standalone = (window.navigator.standalone === true) ||
                (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
            return os + (standalone ? ' · PWA' : ' · Browser');
        } catch (e) { return 'web-device'; }
    }

    // ── فراخوانیِ RPC با anon key (fetch مستقیم) ─────────────────────────────────
    function callRpc(fn, body) {
        var cfg = cloudCfg();
        if (!cfg) return Promise.reject(new Error('no-cloud-config'));
        return fetch(cfg.url + '/rest/v1/rpc/' + fn, {
            method: 'POST',
            headers: {
                'apikey': cfg.key,
                'Authorization': 'Bearer ' + cfg.key,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body || {})
        }).then(function (r) {
            if (!r.ok) throw new Error('rpc-http-' + r.status);
            return r.json();
        });
    }

    function markApproved() {
        try { localStorage.setItem(APPROVED_FLAG, '1'); } catch (e) {}
    }
    function isApprovedLocally() {
        try { return localStorage.getItem(APPROVED_FLAG) === '1'; } catch (e) { return false; }
    }

    // ── پوششِ قفل (هماهنگ با طراحیِ اپ: سرمه‌ایِ #1e3a5f، #0f172a/#1e293b، RTL) ────
    function removeOverlay() {
        var el = document.getElementById('jouya-devguard-lock');
        if (el) el.remove();
        try { document.documentElement.style.overflow = ''; document.body.style.overflow = ''; } catch (e) {}
    }
    function overlay(html) {
        var el = document.getElementById('jouya-devguard-lock');
        if (!el) {
            el = document.createElement('div');
            el.id = 'jouya-devguard-lock';
            el.setAttribute('dir', 'rtl');
            el.style.cssText = 'position:fixed;inset:0;z-index:2147483600;' +
                'background:radial-gradient(1200px 800px at 50% -10%, #1e3a5f 0%, #0f172a 60%, #0b1220 100%);' +
                'display:flex;align-items:center;justify-content:center;' +
                'font-family:Vazirmatn,inherit;color:#e2e8f0;padding:24px;';
            (document.body || document.documentElement).appendChild(el);
        }
        el.innerHTML =
            '<div style="max-width:460px;width:100%;text-align:center;background:#1e293b;' +
            'border:1px solid #334155;border-radius:20px;padding:34px 26px;' +
            'box-shadow:0 24px 70px rgba(0,0,0,.55);">' + html + '</div>';
        try { document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'; } catch (e) {}
    }

    function brandHeader() {
        return '' +
            '<div style="width:58px;height:58px;margin:0 auto 14px;border-radius:16px;' +
            'background:linear-gradient(135deg,#2dd4bf,#1e3a5f);display:flex;align-items:center;' +
            'justify-content:center;box-shadow:0 8px 24px rgba(45,212,191,.25);">' +
            '<i class="fas fa-shield-halved" style="font-size:26px;color:#fff;"></i></div>' +
            '<div style="font-size:19px;font-weight:800;color:#fff;margin-bottom:2px;">فروشگاه جویا</div>';
    }

    function showPending(code) {
        overlay(
            brandHeader() +
            '<h2 style="margin:12px 0 10px;font-size:18px;color:#fff;">در انتظارِ تأییدِ دستگاه</h2>' +
            '<p style="margin:0 0 18px;font-size:13.5px;line-height:2.05;color:#94a3b8;">' +
                'برای استفاده از نسخهٔ وب، این دستگاه باید یک‌بار تأیید شود. کدِ زیر را به ' +
                'مدیر بدهید؛ پس از تأیید، برنامه به‌طورِ خودکار باز می‌شود.</p>' +
            '<div id="jouya-devguard-code" style="font-size:34px;font-weight:800;letter-spacing:8px;' +
                'color:#2dd4bf;background:#0f172a;border:1px solid #334155;border-radius:14px;' +
                'padding:14px 0;margin-bottom:18px;direction:ltr;">' + (code ? String(code) : '••••••') + '</div>' +
            '<div style="font-size:12.5px;color:#64748b;display:flex;align-items:center;' +
                'justify-content:center;gap:7px;">' +
                '<i class="fas fa-spinner fa-spin"></i> در حالِ بررسیِ خودکار…</div>' +
            '<button id="jouya-devguard-retry" style="margin-top:20px;background:#1e3a5f;border:none;' +
                'color:#fff;border-radius:11px;padding:11px 22px;font-family:inherit;font-weight:700;' +
                'font-size:13px;cursor:pointer;">بررسیِ دوباره</button>'
        );
        var rb = document.getElementById('jouya-devguard-retry');
        if (rb) rb.onclick = function () { checkOnce(true); };
    }

    function showBlocked() {
        overlay(
            '<div style="width:58px;height:58px;margin:0 auto 14px;border-radius:16px;' +
            'background:linear-gradient(135deg,#ef4444,#7f1d1d);display:flex;align-items:center;' +
            'justify-content:center;"><i class="fas fa-ban" style="font-size:26px;color:#fff;"></i></div>' +
            '<div style="font-size:19px;font-weight:800;color:#fff;margin-bottom:2px;">فروشگاه جویا</div>' +
            '<h2 style="margin:12px 0 10px;font-size:18px;color:#fff;">این دستگاه مسدود شده است</h2>' +
            '<p style="margin:0 0 6px;font-size:13.5px;line-height:2.05;color:#94a3b8;">' +
                'دسترسیِ این دستگاه توسطِ مدیر غیرفعال شده است. برای اطلاعاتِ بیشتر با پشتیبانی تماس بگیرید.</p>'
        );
    }

    // ── هستهٔ تصمیم ───────────────────────────────────────────────────────────
    function applyResult(res) {
        if (!res) return 'unknown';
        var status = res.status || (res.ok ? 'approved' : '');
        if (res.ok === true || status === 'approved') { markApproved(); removeOverlay(); stopPoll(); return 'approved'; }
        if (status === 'blocked' || status === 'revoked') { showBlocked(); stopPoll(); return 'blocked'; }
        if (status === 'pending' || status === 'none') {
            // اگر کدِ تازه آمد، روی پوشش به‌روز کن
            var c = document.getElementById('jouya-devguard-code');
            if (c && res.code) c.textContent = String(res.code);
            else if (!document.getElementById('jouya-devguard-lock')) showPending(res.code);
            startPoll();
            return 'pending';
        }
        return 'unknown';
    }

    var _pollTimer = null;
    function startPoll() {
        if (_pollTimer) return;
        _pollTimer = setInterval(function () {
            callRpc('device_access_status', { p_device_key: deviceKey() })
                .then(applyResult)
                .catch(function () { /* شبکه: بی‌اثر، دوباره تلاش می‌کنیم */ });
        }, POLL_MS);
    }
    function stopPoll() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } }

    // درخواست/بررسیِ یک‌بار؛ force=true یعنی حتی اگر فلگِ محلی هست دوباره بپرس
    function checkOnce(force) {
        return callRpc('request_device_access', { p_device_key: deviceKey(), p_label: deviceLabel() })
            .then(applyResult)
            .catch(function (e) {
                log('سرور در دسترس نبود (بی‌اثر بر ورود):', e && e.message);
                // غیرمسدودکننده: قفل نمی‌کنیم
                return 'error';
            });
    }

    function boot() {
        // ۱) اپِ نیتیو (اندروید/Tauri) → هیچ دخالتی
        if (isAppRuntime()) { log('نسخهٔ اپ — دروازهٔ دستگاه غیرفعال.'); return; }
        // ۲) بدونِ پیکربندیِ ابری نمی‌توان تأیید گرفت → بی‌اثر (قفل نمی‌کنیم)
        if (!cloudCfg()) { log('پیکربندیِ ابری نیست — دروازه بی‌اثر.'); return; }
        // ۳) قبلاً تأیید شده؟ در پس‌زمینه یک‌بار راستی‌آزمایی کن، ولی قفل نکن
        if (isApprovedLocally()) {
            callRpc('device_access_status', { p_device_key: deviceKey() })
                .then(function (res) {
                    if (res && (res.status === 'blocked' || res.status === 'revoked')) {
                        try { localStorage.removeItem(APPROVED_FLAG); } catch (e) {}
                        showBlocked();
                    }
                })
                .catch(function () {});
            return;
        }
        // ۴) دستگاهِ تأییدنشده → قبل از ورود قفل کن و کد بگیر
        showPending(null);
        checkOnce(false);
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading')
            document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 300); });
        else setTimeout(boot, 300);
    }

    // API برای تست/اشکال‌زدایی
    window.JouyaDeviceGuard = {
        deviceKey: deviceKey,
        isAppRuntime: isAppRuntime,
        check: function () { return checkOnce(true); },
        _boot: boot,
        _reset: function () { try { localStorage.removeItem(APPROVED_FLAG); } catch (e) {} }
    };

    log('بارگذاری شد. app=', isAppRuntime(), 'cloud=', !!cloudCfg());
})();

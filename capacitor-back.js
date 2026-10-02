/**
 * capacitor-back.js — مدیریتِ دکمهٔ «برگشت»ِ سخت‌افزاریِ اندروید (فروشگاه جویا)
 * =============================================================================
 * لایهٔ کاملاً افزودنی و مستقل (مثلِ device-guard.js). هیچ فایلِ دیگری را تغییر نمی‌دهد.
 *
 * مشکل: در نسخهٔ اندروید (Capacitor)، چون برنامه تک‌صفحه‌ای است و تاریخچهٔ مرورگر ندارد،
 * دکمهٔ برگشتِ گوشی مستقیماً برنامه را می‌بندد — حتی وقتی کاربر در یک زیربخش است.
 *
 * راهِ حل (بدونِ تغییرِ منطق): همان «دکمهٔ برگشتِ داخلِ هر بخش» که از قبل در برنامه هست
 * را شبیه‌سازی می‌کنیم. هر بخش یک دکمهٔ .btn-back-header با onclickِ درستِ خودش دارد
 * (مثلاً personTxGoBack() یا showSection('persons-list'))، پس با «کلیک» روی همان، دقیقاً
 * همان مسیرِ برگشتِ موجود اجرا می‌شود.
 *
 * ترتیبِ کار هنگام فشردنِ دکمهٔ برگشت:
 *   ۱) اگر منوی سه‌نقطه باز است → بسته شود.
 *   ۲) اگر سایدبارِ تنظیمات باز است → بسته شود.
 *   ۳) اگر یک مودال/پوشش باز است → بسته شود.
 *   ۴) وگرنه اگر بخشِ فعال دکمهٔ برگشت دارد → همان کلیک شود (منطقِ موجود).
 *   ۵) وگرنه اگر روی داشبورد نیستیم → برو داشبورد.
 *   ۶) روی داشبورد → از برنامه خارج شو (رفتارِ استانداردِ اندروید).
 *
 * فقط روی «اندرویدِ نیتیو» فعال می‌شود؛ روی وب/آیفون/Tauri هیچ کاری نمی‌کند.
 * =============================================================================
 */
(function () {
    'use strict';
    if (window._jouyaBackHandlerInstalled) return;

    function isAndroidNative() {
        try {
            var C = window.Capacitor;
            if (!C) return false;
            var p = (typeof C.getPlatform === 'function') ? C.getPlatform() : (C.platform || '');
            if (p === 'android') return true;
            if (C.isNativePlatform && C.isNativePlatform() && p && p !== 'ios' && p !== 'web') return true;
        } catch (e) {}
        return false;
    }

    function appPlugin() {
        try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) || null; }
        catch (e) { return null; }
    }

    function isVisible(el) {
        try { return !!el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0)); }
        catch (e) { return false; }
    }

    // تلاش برای بستنِ «بالاترین چیزِ باز» — اگر چیزی بست، true برمی‌گرداند.
    function closeTopOverlay() {
        // ۱) منوهای سه‌نقطه
        try {
            if (typeof ndAnyMenuOpen === 'function' && ndAnyMenuOpen()) {
                if (typeof ndCloseAllMenus === 'function') ndCloseAllMenus();
                return true;
            }
        } catch (e) {}
        // ۲) سایدبارِ تنظیمات
        try {
            var sb = document.getElementById('settings-sidebar');
            if (sb && sb.classList.contains('open')) {
                if (typeof closeSidebar === 'function') closeSidebar();
                else { sb.classList.remove('open'); var ov0 = document.getElementById('settings-overlay'); if (ov0) ov0.classList.remove('open'); }
                return true;
            }
        } catch (e) {}
        // ۳) مودال‌ها/پوشش‌های متداول — آخرینِ مرئی بسته می‌شود
        try {
            var sels = [
                '.backup-modal-overlay', '#list-modal-overlay', '#update-modal-overlay',
                '#auth-screen-overlay', '.jlk-modal-overlay', '#service-picker-modal',
                '[id$="-modal-overlay"]', '[id$="-modal"]', '.modal-overlay'
            ];
            var nodes = [];
            sels.forEach(function (s) {
                try { var l = document.querySelectorAll(s); for (var i = 0; i < l.length; i++) nodes.push(l[i]); } catch (e) {}
            });
            var vis = nodes.filter(isVisible);
            if (vis.length) {
                var el = vis[vis.length - 1];   // آخرین در DOM ≈ بالاترین
                // اگر دکمهٔ بستن داخلش هست، همان را بزن؛ وگرنه حذفش کن
                var btn = el.querySelector('.backup-modal-close, .modal-close, [data-close], .close-btn, button i[class*="fa-times"], button i[class*="fa-xmark"]');
                if (btn) { (btn.closest('button') || btn).click(); }
                else { try { el.remove(); } catch (e2) {} }
                return true;
            }
        } catch (e) {}
        return false;
    }

    function handleBack() {
        // اگر چیزی برای بستن بود، همان کافی است
        if (closeTopOverlay()) return;

        // دکمهٔ برگشتِ همان بخشِ فعال (دقیقاً منطقِ موجودِ برنامه)
        try {
            var active = document.querySelector('.section.active');
            if (active) {
                var back = active.querySelector('.btn-back-header');
                if (back && isVisible(back)) { back.click(); return; }
                if (active.id && active.id !== 'dashboard' && typeof showSection === 'function') {
                    showSection('dashboard'); return;
                }
            }
        } catch (e) {}

        // روی داشبورد یا بدونِ مسیرِ برگشت → خروج از برنامه (رفتارِ استانداردِ اندروید)
        try { var A = appPlugin(); if (A && A.exitApp) { A.exitApp(); return; } } catch (e) {}
    }

    function install() {
        if (window._jouyaBackHandlerInstalled) return;
        if (!isAndroidNative()) return;              // فقط اندرویدِ نیتیو
        var A = appPlugin();
        if (!A || !A.addListener) { setTimeout(install, 500); return; }   // پلاگین هنوز آماده نیست
        window._jouyaBackHandlerInstalled = true;
        try { A.addListener('backButton', function () { try { handleBack(); } catch (e) {} }); } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(install, 300); });
    else setTimeout(install, 300);

    window.JouyaBack = { handleBack: handleBack, _install: install };
})();

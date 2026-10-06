/**
 * jouya-ux-fixes.js — بهبودهای رابطِ کاربری (افزودنی و غیرمخرب)
 * =============================================================================
 * این فایل «هیچ منطقِ موجودی را تغییر نمی‌دهد». فقط سه رفتارِ خواسته‌شده را به‌صورتِ
 * لایهٔ افزودنی و با رویدادهای capture روی document می‌نشاند، تا script.js و بقیهٔ
 * فایل‌ها «بایت‌به‌بایت» دست‌نخورده بمانند. بعد از همهٔ اسکریپت‌ها بارگذاری می‌شود.
 *
 *   (b) دیالوگِ تاییدِ «خروج از فرم» — هنگامِ زدنِ دکمهٔ بازگشت در فرم‌های
 *       فروش/خرید/دریافت/پرداختِ فوری، مصرفِ جدید و همهٔ فرم‌های دیگر، دقیقاً با
 *       همان دیالوگِ استایل‌دارِ برنامه (showStyledConfirm / #confirmModal) می‌پرسد.
 *
 *   (c) پاک‌شدنِ خودکارِ فیلدهای عددیِ «۰» در موبایل — در فرم‌ها، با نخستین کلیک/فوکوس
 *       روی یک فیلدِ عددی که مقدارش «۰» است، صفر پاک می‌شود تا کاربر مستقیم عدد را
 *       بنویسد. فیلدهایی که مقدارِ واقعیِ ذخیره‌شده دارند (غیرصفر) هرگز خودکار پاک
 *       نمی‌شوند؛ یعنی حالتِ ویرایش کاملاً دستی می‌ماند. اگر کاربر چیزی ننویسد و
 *       بیرون بزند، «۰» برمی‌گردد تا محاسبات نشکند.
 *
 *   (d) بروزرسانیِ زندهٔ گزارش‌ها هنگامِ تغییرِ نرخِ ارز — وقتی نرخی ثبت/ویرایش/حذف
 *       شود، رویدادِ 'jouya:rates-changed' شنیده می‌شود و داده‌های مشتق دوباره ساخته
 *       و گزارشِ باز/داشبورد تازه می‌شوند (سود دسته‌ها، ردیفِ سود و زیان، ضرر/سودِ
 *       تسعیرِ ارزی و… بر اساسِ نرخِ تازه).
 * =============================================================================
 */
(function () {
    'use strict';

    // ── نشانهٔ محیطِ اجرا برای CSS: روی اپِ اندروید (Capacitor) صفتِ data-jruntime=android
    //    روی <html> گذاشته می‌شود تا قواعدِ ظاهریِ مخصوصِ اندروید (مثلِ کوچک‌تر کردنِ محتوای
    //    پاپ‌آپِ مرتب‌سازی/فیلتر) فقط در اپِ اندروید اعمال شوند. هیچ منطقی تغییر نمی‌کند و اگر
    //    قبلاً «tauri» ست شده باشد دست نمی‌خورد. ───────────────────────────────────────────
    try {
        var _isAndroidApp = false;
        try {
            var _C = window.Capacitor;
            if (_C) {
                var _p = (typeof _C.getPlatform === 'function') ? _C.getPlatform() : (_C.platform || '');
                if (_p === 'android') _isAndroidApp = true;
            }
            if (window.__JOUYA_RUNTIME === 'android') _isAndroidApp = true;
        } catch (e) {}
        if (_isAndroidApp && document.documentElement && !document.documentElement.getAttribute('data-jruntime')) {
            document.documentElement.setAttribute('data-jruntime', 'android');
        }
    } catch (e) {}

    // ── بخش‌هایی که «فرمِ ورودِ داده» هستند؛ خروج از این‌ها تایید می‌خواهد ──────────
    var FORM_SECTIONS = {
        'sales-form': 1, 'purchase-form': 1, 'receipt-form': 1, 'payment-form': 1,
        'expense-form': 1, 'person-form': 1, 'product-form': 1, 'service-form': 1,
        'employee-form': 1, 'sale-return-form': 1, 'purchase-return-form': 1,
        'proforma-order-form': 1, 'cashbox-form': 1,
        'cashbox-transfer-form-section': 1, 'cashbox-deposit-form-section': 1,
        'cashbox-withdraw-form-section': 1, 'currency-convert-form': 1
    };

    function activeFormSectionId() {
        try {
            for (var id in FORM_SECTIONS) {
                if (!FORM_SECTIONS.hasOwnProperty(id)) continue;
                var el = document.getElementById(id);
                if (el && el.classList && el.classList.contains('active')) return id;
            }
        } catch (e) {}
        return null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  (b) تاییدِ خروج از فرم
    // ══════════════════════════════════════════════════════════════════════════
    function askLeave(onYes) {
        var title = 'خروج از فرم';
        var msg   = 'آیا از خروج از این فرم اطمینان دارید؟\nاطلاعاتی که ذخیره نکرده‌اید از بین می‌رود.';
        if (typeof window.showStyledConfirm === 'function') {
            window.showStyledConfirm(title, msg, onYes);
        } else if (window.confirm(msg.replace(/\n/g, ' '))) {
            onYes();
        }
    }

    // روی کلیکِ دکمهٔ بازگشت (و back سخت‌افزاریِ اندروید که همین دکمه را کلیک می‌کند)
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.btn-back-header') : null;
        if (!btn) return;
        // بارِ دوم (پس از تایید) بگذار عبور کند
        if (btn.getAttribute('data-jq-back-ok') === '1') { btn.removeAttribute('data-jq-back-ok'); return; }
        // فقط وقتی روی یک بخشِ «فرم» هستیم
        if (!activeFormSectionId()) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        askLeave(function () {
            try { btn.setAttribute('data-jq-back-ok', '1'); btn.click(); } catch (err) {}
        });
    }, true); // فازِ capture تا پیش از onclickِ درون‌خطیِ دکمه اجرا شود

    // ══════════════════════════════════════════════════════════════════════════
    //  (c) پاک‌شدنِ خودکارِ فیلدِ عددیِ «صفر» در موبایل
    // ══════════════════════════════════════════════════════════════════════════
    function isMobileLike() {
        try {
            if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
                && window.Capacitor.isNativePlatform()) return true;
        } catch (e) {}
        try { if ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) return true; } catch (e) {}
        try { if ((window.innerWidth || 0) <= 768) return true; } catch (e) {}
        return false;
    }

    // «صفر» به هر شکل (لاتین/فارسی/عربی، با یا بدون اعشار)
    function isZeroLike(v) {
        var s = String(v == null ? '' : v).trim();
        if (s === '') return false;                 // خالی را دست نمی‌زنیم
        // ارقامِ فارسی/عربی → لاتین
        s = s.replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
             .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
             .replace(/[,٬\s]/g, '').replace(/٫/g, '.');
        return /^0+(\.0+)?$/.test(s);
    }

    function isNumericField(el) {
        if (!el || el.tagName !== 'INPUT') return false;
        if (el.disabled || el.readOnly) return false;
        var t = (el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'number') return true;
        var im = (el.getAttribute('inputmode') || '').toLowerCase();
        if (im === 'numeric' || im === 'decimal') return true;
        // فیلدهای عددیِ شناخته‌شده‌ای که type=text دارند ولی مقدارشان عدد است
        if (el.classList && (el.classList.contains('num-input') || el.classList.contains('price-input'))) return true;
        return false;
    }

    document.addEventListener('focusin', function (e) {
        if (!isMobileLike()) return;
        var el = e.target;
        if (!isNumericField(el)) return;
        if (!activeFormSectionId()) return;             // فقط داخلِ فرم‌ها
        if (el.getAttribute('data-jq-touched') === '1') return; // قبلاً دست‌خورده
        if (isZeroLike(el.value)) {
            el.setAttribute('data-jq-cleared', '1');
            el.value = '';
            // برای اینکه جای‌نما درست بیفتد
            try { el.setSelectionRange(0, 0); } catch (err) {}
        }
    }, true);

    // وقتی کاربر عدد نوشت، دیگر «دست‌خورده» است و خودکار پاک نمی‌شود
    document.addEventListener('input', function (e) {
        var el = e.target;
        if (!isNumericField(el)) return;
        if (String(el.value || '').trim() !== '') {
            el.setAttribute('data-jq-touched', '1');
            el.removeAttribute('data-jq-cleared');
        }
    }, true);

    // اگر فیلدِ پاک‌شده را خالی رها کرد، «۰» برگردد تا محاسبات نشکند
    document.addEventListener('focusout', function (e) {
        var el = e.target;
        if (!isNumericField(el)) return;
        if (el.getAttribute('data-jq-cleared') === '1' && String(el.value || '').trim() === '') {
            el.value = '0';
            el.removeAttribute('data-jq-cleared');
            try {
                // تا هر شنوندهٔ محاسباتیِ موجود مقدارِ بازگشته را ببیند
                el.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (err) {}
        }
    }, true);

    // ══════════════════════════════════════════════════════════════════════════
    //  (d) بروزرسانیِ زندهٔ گزارش‌ها با تغییرِ نرخِ ارز
    // ══════════════════════════════════════════════════════════════════════════
    var _ratesT = null;
    function refreshAfterRates() {
        // کشِ FIFO/سود دوباره ساخته می‌شود (امضاء شاملِ نرخ‌هاست؛ rebuild کش را باطل می‌کند)
        try { if (typeof window.rebuildAllDerivedData === 'function') window.rebuildAllDerivedData(); } catch (e) {}
        // گزارشِ بازِ فعلی دوباره اجرا شود (سود دسته‌ها/سود و زیان/تسعیر ارزی)
        try { if (typeof window._rpRerunLast === 'function') window._rpRerunLast(); } catch (e) {}
        try { if (typeof window._rpInvalidateCashboxCache === 'function') window._rpInvalidateCashboxCache(); } catch (e) {}
        // داشبورد و کارت‌ها
        try { if (typeof window.loadDashboard === 'function') window.loadDashboard(); } catch (e) {}
        try { if (typeof window.updateDashboardCards === 'function') window.updateDashboardCards(); } catch (e) {}
    }
    window.addEventListener('jouya:rates-changed', function () {
        if (_ratesT) clearTimeout(_ratesT);
        _ratesT = setTimeout(refreshAfterRates, 160);
    });

    // اگر اپ هنگامِ بارگذاری این فایل آماده بود، چیزی لازم نیست؛ همه‌چیز رویدادمحور است.
})();

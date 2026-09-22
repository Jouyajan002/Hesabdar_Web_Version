/**
 * mobile-fit.js — لایهٔ کمکیِ نسخهٔ موبایل (فروشگاه جویا) — فاز ۵
 * ---------------------------------------------------------------------------
 *  این فایل کاملاً افزودنی و مستقل است و به هیچ منطق/معماریِ موجودِ برنامه دست
 *  نمی‌زند. فقط دو کارِ کوچکِ «سازگاریِ موبایل» را انجام می‌دهد:
 *
 *   ۱) پلِ لمسی برای منوی سه‌نقطهٔ «اجناس»:
 *      دکمهٔ سه‌نقطهٔ کارتِ اجناس در دسکتاپ با «hover» باز می‌شود
 *      (onmouseenter="showProductActionBar(event, ID)"). روی موبایلِ لمسی hover
 *      وجود ندارد، پس این منو از دسترس خارج می‌شود. اینجا با «لمس»، همان تابعِ
 *      سراسریِ موجودِ برنامه صدا زده می‌شود تا منو باز شود — بدونِ تغییرِ هیچ کدی.
 *      (منوهای اشخاص/فروش/صندوق از قبل click-محور بوده و روی موبایل کار می‌کنند.)
 *
 *   ۲) انتقالِ نشانِ «نسخهٔ آزمایشی» از روی نوارِ ناوبری به آخرین گزینهٔ سایدبار.
 *
 *  توجه: هیچ مقیاس‌گذاریِ کلی (zoom) انجام نمی‌شود؛ اندازه‌ها و چیدمانِ موبایل
 *  کاملاً از راهِ mobile-responsive.css (طراحیِ واقعیِ ریسپانسیو) کنترل می‌شوند تا
 *  مکان‌یابیِ منوها/تقویم و سایرِ محاسباتِ مختصاتیِ برنامه هیچ‌گاه به‌هم نریزد.
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.__jouyaMobileFitInstalled) return;
    window.__jouyaMobileFitInstalled = true;

    var MOBILE_MAX = 768;
    function isMobile() {
        return (window.innerWidth || document.documentElement.clientWidth || 0) <= MOBILE_MAX;
    }

    /* ───────────────────────────────────────────────────────────────────────
     * ۱) پلِ لمسی برای منوی سه‌نقطهٔ اجناس (hover → tap)
     * ─────────────────────────────────────────────────────────────────────── */
    function productKebabTapBridge(e) {
        try {
            if (!isMobile()) return;
            var kebab = (e.target && e.target.closest) ? e.target.closest('.product-card-kebab') : null;
            if (!kebab) return;
            // فقط کبابِ hover-محور (که onmouseenter دارد و onclick ندارد)
            var attr = kebab.getAttribute('onmouseenter') || '';
            var m = attr.match(/showProductActionBar\s*\(\s*event\s*,\s*(\d+)/);
            if (!m) return;
            if (typeof window.showProductActionBar !== 'function') return;

            e.preventDefault();
            e.stopPropagation();

            // باز کردنِ منو با فراخوانیِ همان تابعِ سراسریِ موجود (رویدادِ ساختگی با currentTarget)
            window.showProductActionBar({ currentTarget: kebab, target: kebab }, m[1]);

            // لغوِ تایمرِ بستنِ خودکار (منطقِ hoverِ برنامه) با فرستادنِ mouseenter به خودِ نوار
            var tb = document.querySelector('.floating-action-toolbar');
            if (tb) { try { tb.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); } catch (_) {} }

            // بستن با لمسِ بیرون از منو
            setTimeout(function () {
                function outside(ev) {
                    var t = document.querySelector('.floating-action-toolbar');
                    if (!t) { document.removeEventListener('click', outside, true); return; }
                    if (!t.contains(ev.target) && !kebab.contains(ev.target)) {
                        if (typeof window.closeProductActionBar === 'function') window.closeProductActionBar();
                        else if (t.parentNode) t.parentNode.removeChild(t);
                        document.removeEventListener('click', outside, true);
                    }
                }
                document.addEventListener('click', outside, true);
            }, 0);
        } catch (_) {}
    }
    // فازِ capture تا پیش از بستن‌کننده‌های داخلیِ برنامه اجرا شود
    document.addEventListener('click', productKebabTapBridge, true);

    /* ───────────────────────────────────────────────────────────────────────
     * ۱-الف۲) پلِ لمسی برای منوی سه‌نقطهٔ «صندوق‌ها» (hover → tap)
     *  مشکل: دکمهٔ سه‌نقطهٔ صندوق فقط onmouseenter دارد و تایمرِ بستنِ ۳۰۰ms مستقلِ
     *  خودش (closeCashboxToolbarTimer). روی لمس، بلافاصله بعدِ باز شدن، mouseleaveِ
     *  ساختگی تایمر را استارت می‌زند و منو پیش از دیده‌شدن بسته می‌شود؛ برای همین در
     *  موبایل «هیچ‌گاه» نمایش داده نمی‌شود. اینجا با «لمس» همان تابعِ موجود صدا زده و
     *  تایمرِ بستن با فرستادنِ mouseenter به خودِ نوار لغو می‌شود (بدونِ تغییرِ منطق).
     *  استایل/طراحیِ کاربری‌اش از قبل با CSSِ شیتِ پایین دقیقاً مثلِ «اشخاص» است.
     * ─────────────────────────────────────────────────────────────────────── */
    function cashboxKebabTapBridge(e) {
        try {
            if (!isMobile()) return;
            var kebab = (e.target && e.target.closest) ? e.target.closest('.fin-cb-kebab') : null;
            if (!kebab) return;
            var attr = kebab.getAttribute('onmouseenter') || '';
            var m = attr.match(/showCashboxActionBar\s*\(\s*event\s*,\s*(\d+)/);
            if (!m) return;
            if (typeof window.showCashboxActionBar !== 'function') return;

            e.preventDefault();
            e.stopPropagation();

            window.showCashboxActionBar({ currentTarget: kebab, target: kebab }, m[1]);

            // لغوِ تایمرِ بستنِ خودکار: mouseenter به نوار (listenerِ خودِ نوار تایمر را پاک می‌کند)
            var tb = document.querySelector('.floating-action-toolbar');
            if (tb) { try { tb.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); } catch (_) {} }
            // پشتیبان: اگر تابعِ لغوِ تایمرِ صندوق در دسترس بود، آن را هم صدا بزن
            try {
                if (window.closeCashboxToolbarTimer) { clearTimeout(window.closeCashboxToolbarTimer); }
            } catch (_) {}
        } catch (_) {}
    }
    document.addEventListener('click', cashboxKebabTapBridge, true);

    /* ───────────────────────────────────────────────────────────────────────
     * ۱-ب) بستنِ خودکارِ منوهای عملیات (سه‌نقطه: ویرایش/حذف/…) روی لمس
     *  مشکل: منوهای شناورِ برنامه با «hover» بسته می‌شوند (mouseleave/mouseover).
     *  روی موبایلِ لمسی این رویدادها fire نمی‌شوند، پس منوی ویرایش/حذف پس از
     *  انتخابِ یک گزینه یا لمسِ بیرون «گیر» می‌کند و روی صفحه می‌ماند.
     *  اینجا فقط روی دستگاه‌های لمسی/موبایل:
     *    • لمسِ یک گزینهٔ داخلِ منو → پس از اجرای همان گزینه، منو بسته می‌شود.
     *    • لمسِ بیرونِ منو (نه روی دکمهٔ سه‌نقطه) → همهٔ منوهای باز بسته می‌شوند.
     *  هیچ منطق/داده‌ای تغییر نمی‌کند؛ فقط بسته‌شدنِ نمایشیِ منوها تضمین می‌شود و از
     *  توابعِ بستنِ خودِ برنامه (در صورت وجود) استفاده می‌شود.
     * ─────────────────────────────────────────────────────────────────────── */
    var MENU_SELECTOR = '.floating-action-toolbar, .person-row-menu, .person-actions-menu, .clog-action-bar';
    // انتخابگرِ «دکمه‌هایی که منو را باز می‌کنند» تا با لمسِ آن‌ها منو بسته نشود.
    var TRIGGER_SELECTOR = '.action-trigger-btn, .product-card-kebab, .person-card-kebab, ' +
        '.sales-card-kebab, .cbtx-kebab, .exp-kebab, .emp-kebab, .ptx-kebab, .fin-cb-kebab, ' +
        '[onmouseenter*="ActionBar"], [onclick*="ActionBar"], [onclick*="ActionsMenu"], [onclick*="RowMenu"]';

    function touchLike() {
        try {
            if (isMobile()) return true;
            return !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
        } catch (_) { return false; }
    }

    function closeAllFloatingActionMenus() {
        try { if (typeof window.closeAllActionMenus === 'function') window.closeAllActionMenus(); } catch (_) {}
        try { if (typeof window.closeProductActionBar === 'function') window.closeProductActionBar(); } catch (_) {}
        // پشتیبان: حذف/پنهان‌سازیِ مستقیمِ هر منوی باقی‌مانده (اگر بستن‌کنندهٔ برنامه نبود)
        try {
            document.querySelectorAll('.floating-action-toolbar').forEach(function (el) { try { el.remove(); } catch (_) {} });
            document.querySelectorAll('.clog-action-bar').forEach(function (el) { try { el.remove(); } catch (_) {} });
            document.querySelectorAll('.person-row-menu.open').forEach(function (el) { el.classList.remove('open'); });
            document.querySelectorAll('.person-actions-menu').forEach(function (el) { el.style.display = 'none'; });
        } catch (_) {}
    }

    function anyMenuOpen() {
        try {
            if (document.querySelector('.floating-action-toolbar, .clog-action-bar, .person-row-menu.open')) return true;
            var pam = document.querySelectorAll('.person-actions-menu');
            for (var i = 0; i < pam.length; i++) {
                if (pam[i].style && pam[i].style.display === 'block') return true;
            }
            return false;
        } catch (_) { return false; }
    }

    function actionMenuTapCloser(e) {
        try {
            if (!touchLike()) return;
            var t = e.target;
            if (!t || !t.closest) return;
            // ۱) لمسِ داخلِ منو (انتخابِ گزینه) → بگذار گزینه اجرا شود، سپس منو را ببند.
            if (t.closest(MENU_SELECTOR)) {
                setTimeout(closeAllFloatingActionMenus, 0);
                return;
            }
            // ۲) لمسِ دکمهٔ بازکنندهٔ منو → دست نزن (منو تازه باز می‌شود).
            if (t.closest(TRIGGER_SELECTOR)) return;
            // ۳) لمسِ بیرون از هر منو → اگر منویی باز است، همه را ببند.
            if (anyMenuOpen()) closeAllFloatingActionMenus();
        } catch (_) {}
    }
    // فازِ capture تا مستقل از بستن‌کننده‌های داخلی، بسته‌شدن تضمین شود.
    document.addEventListener('click', actionMenuTapCloser, true);

    /* ───────────────────────────────────────────────────────────────────────
     * ۱-ج) ریسِتِ نوارِ جستجو هنگامِ خروج از هر بخش (سراسری: دسکتاپ + موبایل)
     *  خواسته: اگر در یک بخش (مثلاً «اجناس») چیزی جستجو شد و کاربر به بخشِ دیگری
     *  (مثلاً «اشخاص») رفت، نوارِ جستجو باید خالی شود و نتیجهٔ فیلترشده باقی نماند.
     *  با رویدادِ سراسریِ `sectionChanged` (که خودِ برنامه هنگامِ تعویضِ بخش می‌فرستد)
     *  همهٔ نوارهای جستجوی سراسری خالی و فیلترشان با اجرای هندلرِ خودِ همان input
     *  (onkeyup="globalSearch(...)") صفر می‌شود — بدونِ تغییر در منطقِ جستجو.
     * ─────────────────────────────────────────────────────────────────────── */
    function resetAllGlobalSearch() {
        try {
            var inputs = document.querySelectorAll('input[id^="global-search-"]');
            for (var i = 0; i < inputs.length; i++) {
                var inp = inputs[i];
                if (!inp || inp.value === '') continue;
                inp.value = '';
                // اجرای هندلرِ خودِ input تا لیستِ فیلترشده به حالتِ کامل برگردد
                try { inp.dispatchEvent(new Event('keyup', { bubbles: true })); } catch (_) {
                    try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (__) {}
                }
            }
        } catch (_) {}
    }
    document.addEventListener('sectionChanged', function () {
        // کمی تأخیر تا بخشِ جدید بارگذاری شود، سپس نوارهای جستجو پاک شوند
        setTimeout(resetAllGlobalSearch, 0);
    });

    /* ───────────────────────────────────────────────────────────────────────
     * ۱-د) دکمهٔ «برگشتِ» سخت‌افزاریِ موبایل (Android/APK) — مطابقِ منطقِ برنامه
     *  خواسته: دکمهٔ برگشتِ گوشی هم مثلِ دکمهٔ برگشتِ داخلِ برنامه کار کند و هم منوی
     *  سه‌نقطهٔ باز را ببندد.
     *  رفتار (فقط روی دستگاهِ لمسی/موبایل تا دسکتاپ دست‌نخورده بماند):
     *    ۱) اگر منوی عملیاتی باز است → فقط آن را ببند.
     *    ۲) اگر سایدبارِ تنظیمات باز است → آن را ببند.
     *    ۳) اگر بخشِ فعال دکمهٔ «برگشتِ هدر» دارد → همان را کلیک کن (منطقِ خودِ برنامه:
     *       personTxGoBack/productInoutGoBack/goBackFromForm/… بدونِ بازنویسی).
     *    ۴) در غیرِ این‌صورت اگر روی داشبورد نیستیم → به داشبورد برو.
     *  با نگه‌داشتنِ یک ورودیِ محافظ در history، برنامه هنگامِ برگشت ناگهانی بسته نمی‌شود.
     * ─────────────────────────────────────────────────────────────────────── */
    function closeOpenSettingsSidebar() {
        try {
            var sb = document.querySelector('.settings-sidebar.open');
            if (!sb) return false;
            var closeBtn = sb.querySelector('.ssb-close-btn, .sidebar-close, [onclick*="loseSettings"], [onclick*="loseSidebar"]');
            if (closeBtn) { closeBtn.click(); }
            else {
                sb.classList.remove('open');
                var mc = document.querySelector('.main-content.sidebar-blurred');
                if (mc) mc.classList.remove('sidebar-blurred');
            }
            return true;
        } catch (_) { return false; }
    }

    function handleMobileBack() {
        try {
            // ۰) پیش‌نمایشِ چاپ/گزارش/بلِ باز (اورلیِ درون‌برنامه‌ای) → اول همان بسته شود
            //    تا کاربر به همان صفحه‌ای که از آن گزارش/بل باز کرده برگردد (اشخاص/صندوق/…).
            if (document.getElementById('jouya-pp-overlay') && typeof window.__jouyaPreviewOverlayClose === 'function') {
                window.__jouyaPreviewOverlayClose();
                return true;
            }
            // ۱) منوی عملیاتِ باز
            if (anyMenuOpen()) { closeAllFloatingActionMenus(); return true; }
            // ۲) سایدبارِ تنظیمات
            if (closeOpenSettingsSidebar()) return true;
            // ۳) دکمهٔ برگشتِ هدرِ بخشِ فعال (منطقِ خودِ برنامه)
            var active = document.querySelector('.section.active');
            if (active) {
                var back = active.querySelector('.btn-back-header');
                if (back && back.offsetParent !== null) { back.click(); return true; }
                // ۴) اگر روی داشبورد نیستیم → داشبورد
                if (active.id && active.id !== 'dashboard' && typeof window.showSection === 'function') {
                    window.showSection('dashboard');
                    return true;
                }
            }
        } catch (_) {}
        return false;
    }

    (function installMobileBackButton() {
        if (!touchLike()) return;               // فقط دستگاه‌های لمسی/موبایل
        if (window.__jouyaBackInstalled) return;
        window.__jouyaBackInstalled = true;
        try {
            history.pushState({ jouya: 1 }, '');  // ورودیِ محافظ
            window.addEventListener('popstate', function () {
                try { handleMobileBack(); } catch (_) {}
                // دوباره ورودیِ محافظ بگذار تا برگشتِ بعدی هم درون‌برنامه‌ای بماند
                try { history.pushState({ jouya: 1 }, ''); } catch (_) {}
            });
        } catch (_) {}
    })();

    /* ───────────────────────────────────────────────────────────────────────
     * ۲) انتقالِ نشانِ «نسخهٔ آزمایشی» به آخرین گزینهٔ سایدبار
     *    (نشان را demo-mode.js با position:fixed می‌سازد و روی نوارِ ناوبری می‌افتد.
     *     چون همان المان را با id بازاستفاده می‌کند، انتقالِ یک‌باره پایدار می‌ماند.)
     * ─────────────────────────────────────────────────────────────────────── */
    function relocateDemoBadge() {
        try {
            var badge = document.getElementById('jouya-demo-badge');
            var list = document.getElementById('ssb-main-list');
            if (!badge || !list) return;
            if (badge.parentElement === list) return;
            var st = badge.style;
            st.setProperty('position', 'static', 'important');
            st.setProperty('inset', 'auto', 'important');
            st.setProperty('bottom', 'auto', 'important');
            st.setProperty('inset-inline-start', 'auto', 'important');
            st.setProperty('left', 'auto', 'important');
            st.setProperty('right', 'auto', 'important');
            st.setProperty('width', '100%', 'important');
            st.setProperty('margin', '14px 0 4px', 'important');
            st.setProperty('box-sizing', 'border-box', 'important');
            st.setProperty('justify-content', 'space-between', 'important');
            st.setProperty('flex-wrap', 'wrap', 'important');
            st.setProperty('gap', '8px', 'important');
            list.appendChild(badge);
        } catch (_) {}
    }

    /* ───────────────────────────────────────────────────────────────────────
     * ۳) گزینهٔ کشوییِ «لیست‌ها» در داشبوردِ موبایل
     *    زیرِ دکمه‌های سریع یک تاگل «لیست‌ها» اضافه می‌شود؛ لیست‌های سریعِ داشبورد
     *    (.quick-list-buttons) به‌صورتِ پیش‌فرض بسته‌اند و با کلیک باز/بسته می‌شوند
     *    تا داشبورد در یک نگاه و بدونِ اسکرول مرتب بماند. هیچ منطق/DOMِ اصلی تغییر
     *    نمی‌کند؛ فقط یک تاگلِ نمایشی اضافه و یک کلاسِ نمایشی جابه‌جا می‌شود.
     *    ایمنیِ دسکتاپ: تاگل روی دسکتاپ display:none است و قاعدهٔ بسته‌شدن فقط داخلِ
     *    @media موبایل/تبلت است، پس داشبوردِ دسکتاپ اصلاً تغییر نمی‌کند.
     * ─────────────────────────────────────────────────────────────────────── */
    function setupQuickListCollapse() {
        try {
            var list = document.querySelector('#dashboard .quick-list-buttons');
            if (!list) return;
            if (document.getElementById('jouya-ql-toggle')) return;
            var toggle = document.createElement('button');
            toggle.id = 'jouya-ql-toggle';
            toggle.type = 'button';
            toggle.className = 'jouya-ql-toggle';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML =
                '<span class="jql-label"><i class="fas fa-list-ul"></i> لیست‌ها</span>' +
                '<i class="fas fa-chevron-down jql-chevron"></i>';
            toggle.addEventListener('click', function () {
                var collapsed = list.classList.toggle('jouya-ql-collapsed');
                toggle.classList.toggle('open', !collapsed);
                toggle.setAttribute('aria-expanded', String(!collapsed));
            });
            list.parentNode.insertBefore(toggle, list);   // درست پیش از لیست‌ها
            list.classList.add('jouya-ql-collapsed');      // پیش‌فرض: بسته
        } catch (_) {}
    }

    /* ───────────────────────────────────────────────────────────────────────
     *  دکمهٔ کشوییِ کارت‌های اطلاعاتیِ داشبورد (نرخ ارز / حساب‌ها / مفاد خالص)
     *  دقیقاً مثلِ «لیست‌ها»: پیش‌فرض بسته، با کلیک باز/بسته می‌شود. فقط یک تاگلِ
     *  نمایشی اضافه و یک کلاسِ نمایشی جابه‌جا می‌شود؛ هیچ منطق/DOMِ اصلی تغییر
     *  نمی‌کند و روی دسکتاپ (تاگل display:none) بی‌اثر است.
     * ─────────────────────────────────────────────────────────────────────── */
    function setupInfoCardsCollapse() {
        try {
            var info = document.querySelector('#dashboard .dash-info-col');
            if (!info) return;
            if (document.getElementById('jouya-info-toggle')) return;
            var toggle = document.createElement('button');
            toggle.id = 'jouya-info-toggle';
            toggle.type = 'button';
            toggle.className = 'jouya-info-toggle';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML =
                '<span class="jql-label"><i class="fas fa-chart-pie"></i> نرخ ارز، حساب‌ها و مفاد خالص</span>' +
                '<i class="fas fa-chevron-down jql-chevron"></i>';
            toggle.addEventListener('click', function () {
                var collapsed = info.classList.toggle('jouya-info-collapsed');
                toggle.classList.toggle('open', !collapsed);
                toggle.setAttribute('aria-expanded', String(!collapsed));
            });
            info.parentNode.insertBefore(toggle, info);     // درست پیش از کارت‌های اطلاعاتی
            info.classList.add('jouya-info-collapsed');      // پیش‌فرض: بسته
        } catch (_) {}
    }

    /* هنگامِ رفتن به بخشِ دیگر، هر دو کارتِ کشوییِ داشبورد (لیست‌ها + کارت‌های
       اطلاعاتی) دوباره بسته و دکمه‌هایشان به حالتِ بسته برگردند تا نظمِ داشبورد
       در بازگشت حفظ شود. فقط کلاسِ نمایشی؛ بدونِ تغییرِ منطق. */
    function recollapseDashboardToggles() {
        try {
            var list = document.querySelector('#dashboard .quick-list-buttons');
            var lt = document.getElementById('jouya-ql-toggle');
            if (list && lt) {
                list.classList.add('jouya-ql-collapsed');
                lt.classList.remove('open');
                lt.setAttribute('aria-expanded', 'false');
            }
            var info = document.querySelector('#dashboard .dash-info-col');
            var it = document.getElementById('jouya-info-toggle');
            if (info && it) {
                info.classList.add('jouya-info-collapsed');
                it.classList.remove('open');
                it.setAttribute('aria-expanded', 'false');
            }
        } catch (_) {}
    }

    function boot() {
        relocateDemoBadge();
        setupQuickListCollapse();
        setupInfoCardsCollapse();
        setTimeout(function () { relocateDemoBadge(); setupQuickListCollapse(); setupInfoCardsCollapse(); }, 400);
        setTimeout(function () { relocateDemoBadge(); setupQuickListCollapse(); setupInfoCardsCollapse(); }, 1000);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
    window.addEventListener('load', function () { relocateDemoBadge(); setupQuickListCollapse(); setupInfoCardsCollapse(); });
    document.addEventListener('sectionChanged', function () { setTimeout(function () { setupQuickListCollapse(); setupInfoCardsCollapse(); recollapseDashboardToggles(); }, 60); });

    try {
        var mo = new MutationObserver(function () { relocateDemoBadge(); setupQuickListCollapse(); setupInfoCardsCollapse(); });
        mo.observe(document.body || document.documentElement, { childList: true });
    } catch (_) {}

    window.__jouyaMobileFit = {
        relocateDemoBadge: relocateDemoBadge,
        productKebabTapBridge: productKebabTapBridge,
        setupQuickListCollapse: setupQuickListCollapse,
        setupInfoCardsCollapse: setupInfoCardsCollapse,
        closeAllFloatingActionMenus: closeAllFloatingActionMenus,
        actionMenuTapCloser: actionMenuTapCloser
    };
})();

/**
 * instant-update-fix.js
 * =============================================================================
 * رفع بنیادین مشکل آپدیت آنی دیتابیس
 * (منطق اصلاح تاریخ به‌طور کامل حذف شد — تاریخ از فورم به‌صورت مستقیم در جدول‌ها نمایش داده می‌شود)
 *
 * قاعدهٔ عمومیِ همگام‌سازیِ آنی (Single Universal Update Rule):
 *   هر «تغییر، ویرایش، حذف، انتقال یا هر عملیاتی» که روی دادهٔ خام رخ می‌دهد، بلافاصله
 *   ۱) تمام مقادیرِ مشتق‌شده (موجودی، مانده صندوق، مفاد، انتقال میان گدام‌ها و…) را از روی
 *      دادهٔ خام و با آخرین منطقِ برنامه بازسازی می‌کند (rebuildAllDerivedData) — بنابراین
 *      همان منطقِ جدید روی دیتای قدیمیِ کاربران (از گوگل‌درایو، فایل جیسون، یا موجود از قبل)
 *      نیز به‌صورتِ خودکار تطبیق داده می‌شود و تناقضِ محاسباتی پیش نمی‌آید،
 *   ۲) سپس داشبورد، لیستِ فعال، بَج‌ها و شمارنده‌ها را در «لحظه» رفرش می‌کند — بدون نیاز به
 *      بستن و باز کردنِ دوبارهٔ برنامه.
 * =============================================================================
 */

(function() {
    if (window._jouyaInstantInstalled) return;
    window._jouyaInstantInstalled = true;

    // ----- ۱) کلیدهای دیتایی که باید watch شوند -----
    // شاملِ همهٔ مجموعه‌های خامِ مؤثر بر محاسبات تا هیچ عملیاتی از قاعدهٔ آنی جا نماند
    // (به‌ویژه warehouseTransfers/warehouses/cashboxTransactions/currencies که پیش‌تر watch نمی‌شدند
    //  و به همین دلیل انتقالِ اجناس/ویرایشِ صندوق در لحظه بازتاب نمی‌یافت).
    var DATA_KEYS = [
        'transactions', 'products', 'persons', 'expenses', 'cashboxes',
        'services', 'returns', 'changelog', 'settings', 'dashboardStats',
        'sales', 'purchases', 'receipts', 'payments',
        'warehouses', 'warehouseTransfers', 'activeWarehouseId',
        'cashboxTransactions',
        'jouya-currencies', 'jouya-exchange-rates', 'jouya-reference-rates'
    ];

    // پرچمِ «در حالِ به‌روزرسانی»: هنگام بازسازیِ داده‌های مشتق‌شده و رفرشِ نمایش، هر نوشتنِ
    // ناشی از خودِ این چرخه نباید چرخهٔ جدیدی بسازد (جلوگیری از حلقهٔ بی‌نهایت).
    var _updating = false;

    // ----- ۳) Override روی localStorage -----
    try {
        var _origSetItem = localStorage.setItem.bind(localStorage);
        var _origRemoveItem = localStorage.removeItem.bind(localStorage);
        var _origClear = localStorage.clear.bind(localStorage);

        localStorage.setItem = function(key, value) {
            var result = _origSetItem(key, value);
            try { if (DATA_KEYS.indexOf(key) >= 0) _scheduleUpdate('set:' + key); } catch (_) {}
            return result;
        };

        localStorage.removeItem = function(key) {
            var result = _origRemoveItem(key);
            try { if (DATA_KEYS.indexOf(key) >= 0) _scheduleUpdate('remove:' + key); } catch (_) {}
            return result;
        };

        localStorage.clear = function() {
            var result = _origClear();
            try { _scheduleUpdate('clear'); } catch (_) {}
            return result;
        };
    } catch (e) { console.error('[instant-fix] localStorage override failed:', e); }

    // ----- ۴) Throttle & Update Logic -----
    var _updateTimer = null;
    var _lastReason = '';
    var _pendingReasons = [];

    function _scheduleUpdate(reason) {
        // نوشتن‌هایی که خودِ چرخهٔ به‌روزرسانی ایجاد می‌کند نباید دوباره زمان‌بندی شوند
        if (_updating) return;
        _lastReason = reason;
        if (_pendingReasons.length < 20) _pendingReasons.push(reason);
        if (_updateTimer) return;
        _updateTimer = setTimeout(function() {
            _updateTimer = null;
            var reasons = _pendingReasons.slice();
            _pendingReasons.length = 0;
            _runFullUpdate(_lastReason, reasons);
        }, 40);
    }

    function _runFullUpdate(reason, allReasons) {
        // گاردِ ضدِحلقه: کلِ چرخه (بازسازی + رفرش) اتمیک است؛ نوشتن‌های داخلِ آن دوباره
        // زمان‌بندی نمی‌شوند چون _scheduleUpdate در حالتِ _updating فوراً بازمی‌گردد.
        if (_updating) return;
        _updating = true;
        try {
            // ── قاعدهٔ عمومی: نخست بازسازیِ کاملِ داده‌های مشتق‌شده از روی دادهٔ خام ──
            // این تضمین می‌کند هر تغییر/ویرایش/حذف/انتقال بلافاصله در «محاسباتِ عمومیِ»
            // سراسرِ برنامه اعمال شود و منطقِ جدید روی دیتای قدیمی نیز تطبیق یابد.
            try { if (typeof window.rebuildAllDerivedData === 'function') window.rebuildAllDerivedData(); } catch (e) {}

            // ── سپس رفرشِ لحظه‌ایِ نمایش‌ها ──
            _safeCall('loadDashboard');
            _safeCall('renderDashboardCharts');
            _safeCall('updateDashboardStats');
            _safeCall('refreshQuickLists');
            _safeCall('loadRecentActivity');
            _safeCall('updateSidebarBadges');

            try {
                var active = document.querySelector('.section.active');
                if (active) {
                    var sid = active.id;
                    // نگاشتِ «شناسهٔ بخشِ فعال → تابعِ بارگذارِ لیستِ آن» — با نام‌های واقعیِ توابع.
                    // (اصلاحِ کلیدِ صندوق: بخش «cash-boxes» با loadCashboxes رفرش می‌شود؛ پیش‌تر
                    //  کلیدِ نادرستِ cashbox-list/loadCashboxList باعث می‌شد لیستِ حساب‌ها در لحظه
                    //  به‌روز نشود — علتِ اصلیِ «ویرایشِ موجودیِ اولیهٔ صندوق در لحظه دیده نمی‌شد».)
                    var map = {
                        'sales-list': 'loadSalesList',
                        'purchases-list': 'loadPurchasesList',
                        'receipts-list': 'loadReceiptsList',
                        'payments-list': 'loadPaymentsList',
                        'transactions-list': 'loadTransactionsList',
                        'products-list': 'loadProductsList',
                        'persons-list': 'loadPersonsList',
                        'cash-boxes': 'loadCashboxes',
                        'expenses': 'loadExpensesList',
                        'services-list': 'loadServicesList',
                        'sales-returns-list': 'loadSalesReturnsList',
                        'purchase-returns-list': 'loadPurchaseReturnsList',
                        'changelog-list': 'loadChangelogList',
                        'return-transactions': 'loadReturns',
                        'employee-management': 'loadEmployeesList'
                    };
                    if (map[sid]) {
                        _safeCall(map[sid]);
                    }
                    // رفرشِ لحظه‌ایِ «مشخصات جنس» و «لیست ورودی و خروجی جنس».
                    // این دو بخش برای رندر به «شناسهٔ جنس» نیاز دارند، پس در نگاشتِ بالا (که توابعِ
                    // بدونِ‌آرگومان صدا می‌زند) نبودند؛ به همین علت ویرایش/حذفِ «موجودی اولیه» یا هر
                    // ردیفِ ورودی/خروجی، در همان لحظه روی «میانگینِ موزونِ قیمتِ خرید»، «موجودیِ فعلی»
                    // و «بلانسِ خالص»ِ همین دو نما بازتاب نمی‌یافت. حالا پس از «بازسازیِ کاملِ داده‌ها»
                    // (که در ابتدای همین چرخه انجام شد) با آخرین شناسه دوباره رندر می‌شوند تا محاسبات
                    // دقیقاً مطابقِ منطقِ فعلی و در لحظه به‌روز شوند. (شناسه‌ها متغیرهای سراسریِ زندهٔ
                    // script.js هستند: window._currentProductDetailId / window._currentInoutProductId.)
                    else if (sid === 'product-detail') {
                        var _pdId = window._currentProductDetailId;
                        if (_pdId != null && typeof window._renderProductDetail === 'function') {
                            _safeCallArg('_renderProductDetail', _pdId);
                        }
                    } else if (sid === 'product-inout-list') {
                        var _ioId = window._currentInoutProductId;
                        if (_ioId != null && typeof window.showProductInOutList === 'function') {
                            _safeCallArg('showProductInOutList', _ioId);
                        }
                    }
                }
            } catch (_) {}

            _safeCall('applyNumberSystemToDocument');
        } finally {
            _updating = false;
        }

        // اجرای دومِ سیستمِ اعدادِ فارسی پس از رندر (خارج از گارد، مثلِ نسخهٔ قبلی)
        setTimeout(function() { _safeCall('applyNumberSystemToDocument'); }, 80);

        try {
            window.dispatchEvent(new CustomEvent('jouya-data-change', {
                detail: { reason: reason, allReasons: allReasons || [reason] }
            }));
        } catch (_) {}
    }

    function _safeCall(fnName) {
        try { if (typeof window[fnName] === 'function') window[fnName](); } catch (e) {}
    }

    // نسخهٔ آرگومان‌دارِ _safeCall برای بخش‌هایی که برای رندر به «شناسهٔ جنس» نیاز دارند
    // (مشخصات جنس / لیست ورودی و خروجی جنس). با همان محافظتِ try/catch تا هرگز چرخهٔ رفرش را نشکند.
    function _safeCallArg(fnName, arg) {
        try { if (typeof window[fnName] === 'function') window[fnName](arg); } catch (e) {}
    }

    // ----- ۵) رفع نقص undoChange و انتقال صندوق (کد اصلی شما) -----
    setTimeout(function() {
        if (typeof window.undoChange === 'function' && !window.undoChange._jouyaInstantPatched) {
            var _origUndo = window.undoChange;
            window.undoChange = function(changeId) {
                try {
                    var logs = JSON.parse(localStorage.getItem('changelog') || '[]');
                    var log = logs.find(function(l) { return l.id == changeId; });
                    if (log && !log.undone && log.dataSnapshot && 
                        (log.action === 'انتقال' || log.type === 'انتقال')) {
                        if (_undoCashboxTransfer(log, logs)) {
                            _scheduleUpdate('undo-transfer');
                            return;
                        }
                    }
                } catch (e) {}
                
                var r = _origUndo.call(this, changeId);
                _scheduleUpdate('undo');
                return r;
            };
            window.undoChange._jouyaInstantPatched = true;
        }
    }, 100);

    function _undoCashboxTransfer(log, logs) {
        try {
            var data = log.dataSnapshot || {};
            var fromId = data.fromId, toId = data.toId;
            var amountFrom = parseFloat(data.amount || 0);
            var amountTo = parseFloat(data.finalAmount || data.amount || 0);

            var boxes = (typeof db.getCashboxes === 'function') ? db.getCashboxes() : [];
            var fromBox = boxes.find(function(b) { return b.id == fromId; });
            var toBox = boxes.find(function(b) { return b.id == toId; });

            if (!fromBox || !toBox || (parseFloat(toBox.balance) < amountTo)) return false;

            db.updateCashbox(toId, { balance: parseFloat(toBox.balance) - amountTo });
            db.updateCashbox(fromId, { balance: parseFloat(fromBox.balance) + amountFrom });

            log.undone = true;
            localStorage.setItem('changelog', JSON.stringify(logs));
            return true;
        } catch (e) { return false; }
    }

    // ----- ۶) منطق اصلاح/تبدیل تاریخ در جدول‌ها -----
    // این بخش به‌طور کامل حذف شد. هیچ پردازش، تبدیل، یا اصلاحی روی متن سلول‌های
    // جدول‌ها انجام نمی‌شود. تاریخ و ساعت دقیقاً همان‌طور که در فیلد فورم وارد شده
    // در جدول‌ها نمایش داده می‌شود.

    // ----- ۷) پچ متدهای db (شبکهٔ ایمنیِ حذف) -----
    // این متدها هم قاعدهٔ آنی را فعال می‌کنند. سایرِ عملیات (ذخیره/ویرایش/انتقال/ویرایشِ
    // موجودیِ صندوق) از طریقِ همان setItem-hook و کلیدهای گسترش‌یافتهٔ DATA_KEYS پوشش داده
    // می‌شوند، پس اینجا فقط متدهای «حذف» به‌عنوان تضمینِ اضافی پچ می‌شوند.
    setTimeout(function() {
        if (typeof window.db === 'object' && window.db) {
            [
                'deleteTransaction', 'deleteCashbox', 'deletePerson', 'deleteProduct',
                'deleteExpense', 'deleteWarehouse', 'deleteTransfer'
            ].forEach(function(m) {
                if (typeof window.db[m] === 'function' && !window.db[m]._jouyaInstantPatched) {
                    var orig = window.db[m].bind(window.db);
                    window.db[m] = function() {
                        var result = orig.apply(null, arguments);
                        _scheduleUpdate('db:' + m);
                        return result;
                    };
                    window.db[m]._jouyaInstantPatched = true;
                }
            });
        }
    }, 200);

    // ----- ۸) نمایش لوگو و نام فروشگاه هنگام بارگذاری اولیه صفحه -----
    // این بخش تضمین می‌کند که پس از بارگذاری کامل همه اسکریپت‌ها (از جمله auth-system.js)،
    // لوگو و نام فروشگاه در داشبورد به درستی نمایش داده شوند،
    // دقیقاً مثل زمانی که روی دکمه صفحه اصلی کلیک می‌شود.
    window.addEventListener('load', function() {
        // اجرای اول: کمی پس از بارگذاری کامل
        setTimeout(function() {
            _safeCall('_renderDashboardStoreInfo');
        }, 150);
        // اجرای دوم: تضمین اجرا در صورت تأخیر سایر اسکریپت‌ها
        setTimeout(function() {
            _safeCall('_renderDashboardStoreInfo');
        }, 600);
    });

    console.log('%c✅ سیستم هماهنگ‌ساز آپدیت آنی فعال شد', 'color:#fff; background:#10b981; padding:5px; border-radius:4px;');
})();

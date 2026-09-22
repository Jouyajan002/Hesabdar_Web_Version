/**
 * delivery-list.js — نسخه کامل (مرحله ۱ + مرحله ۲)
 * =============================================================================
 * سیستم لیست تسلیم‌دهی — UI، ذخیره‌سازی، فورم، جزئیات و گزارش چاپی
 *
 * این فایل به‌صورت کاملاً مستقل عمل می‌کند و هیچ فایل دیگر پروژه را تغییر
 * نمی‌دهد. تنها از طریق:
 *   • تزریق DOM (چک‌باکس، دکمه quick-list، سکشن لیست، سکشن فورم تسلیم‌دهی)
 *   • Monkey-patch روی توابع جهانی (db.saveTransaction، showSection،
 *     applyAdvancedFilter، globalSearch، applySort)
 *   • کلید جدید localStorage به نام «deliveries» (بدون دست زدن به سایر کلیدها)
 *
 * ساختار داده‌های یک رکورد تسلیم‌دهی در localStorage:
 *   {
 *     ...کپی کامل از فاکتور فروش (شماره بل، مشتری، اجناس، مبلغ، …)
 *     transactionId: <id فاکتور فروش>
 *     deliveryStatus: 'در انتظار تسلیم' یا 'تسلیم‌شده'
 *     deliveryCreatedAt: <زمان افزودن به لیست>
 *     history: [
 *       { id, datetime, amount, notes, signature, createdAt },
 *       ...
 *     ]
 *   }
 * =============================================================================
 */

(function () {
    if (window._jouyaDeliveryInstalled) return;
    window._jouyaDeliveryInstalled = true;

    var DELIVERIES_KEY = 'deliveries';

    // =========================================================================
    // بخش ۱) ابزارهای کمکی برای کار با localStorage.deliveries
    // =========================================================================
    function _getDeliveries() {
        try {
            return JSON.parse(localStorage.getItem(DELIVERIES_KEY) || '[]');
        } catch (e) {
            console.error('[delivery] خطا در خواندن لیست تسلیم‌دهی:', e);
            return [];
        }
    }

    function _saveDeliveries(arr) {
        try {
            localStorage.setItem(DELIVERIES_KEY, JSON.stringify(arr || []));
            return true;
        } catch (e) {
            console.error('[delivery] خطا در ذخیره لیست تسلیم‌دهی:', e);
            return false;
        }
    }

    function _findDelivery(id) {
        return _getDeliveries().find(function (d) { return d.id == id; });
    }

    function _addDeliveryFromTransaction(tx) {
        try {
            var arr = _getDeliveries();
            // snapshot کامل از معامله — تمام اطلاعات بل
            var d = JSON.parse(JSON.stringify(tx));
            d.transactionId = tx.id;
            d.deliveryStatus = 'در انتظار تسلیم';
            d.deliveryCreatedAt = new Date().toISOString();
            d.history = []; // مرحله ۲: تاریخچه تسلیم‌دهی‌ها
            arr.push(d);
            return _saveDeliveries(arr);
        } catch (e) {
            console.error('[delivery] خطا در افزودن به تسلیم‌دهی:', e);
            return false;
        }
    }

    function _deleteDelivery(deliveryId) {
        var arr = _getDeliveries();
        var idx = arr.findIndex(function (d) { return d.id == deliveryId; });
        if (idx === -1) return false;
        arr.splice(idx, 1);
        return _saveDeliveries(arr);
    }

    function _addHistoryRecord(deliveryId, record) {
        var arr = _getDeliveries();
        var idx = arr.findIndex(function (d) { return d.id == deliveryId; });
        if (idx === -1) return false;
        if (!Array.isArray(arr[idx].history)) arr[idx].history = [];
        arr[idx].history.push(record);
        // اگر مجموع تحویل‌ها معتبر بود و علامت‌گذاری «تسلیم‌شده» مدنظر نباشد،
        // وضعیت همچنان «در انتظار تسلیم» می‌ماند تا کاربر سفارش‌های چندمرحله‌ای را ردیابی کند
        return _saveDeliveries(arr);
    }

    // در دسترس قرار دادن API برای استفاده‌های آینده
    window._deliveryDB = {
        getAll: _getDeliveries,
        find: _findDelivery,
        save: _saveDeliveries,
        addFromTransaction: _addDeliveryFromTransaction,
        delete: _deleteDelivery,
        addHistory: _addHistoryRecord
    };

    // =========================================================================
    // بخش ۱-ب) محاسبه آمار تسلیم‌دهی بر اساس هر جنس
    //          برای پشتیبانی از حالت چند قلمی: هر جنس می‌تواند جداگانه تسلیم شود
    // =========================================================================
    function _itemKey(it) {
        if (!it) return '';
        if (it.productId !== undefined && it.productId !== null && String(it.productId) !== '') return 'pid:' + String(it.productId);
        return 'pn:' + String(it.productName || '');
    }

    function _computeItemDeliveryStats(d) {
        var items = [];
        var keyToIndex = {};
        if (Array.isArray(d && d.items)) {
            d.items.forEach(function (it) {
                var k = _itemKey(it);
                if (keyToIndex[k] === undefined) {
                    keyToIndex[k] = items.length;
                    items.push({
                        key: k,
                        productId: (it.productId !== undefined ? it.productId : null),
                        productName: it.productName || '-',
                        unit: it.unit || '',
                        totalQty: parseFloat(it.quantity) || 0,
                        deliveredQty: 0
                    });
                } else {
                    items[keyToIndex[k]].totalQty += parseFloat(it.quantity) || 0;
                }
            });
        }
        var unmatchedDelivered = 0; // برای سازگاری با رکوردهای قدیمی که فقط amount داشتند
        if (Array.isArray(d && d.history)) {
            d.history.forEach(function (h) {
                if (h && Array.isArray(h.items) && h.items.length > 0) {
                    h.items.forEach(function (hi) {
                        var k = _itemKey(hi);
                        var q = parseFloat(hi && hi.quantity) || 0;
                        if (keyToIndex[k] !== undefined) {
                            items[keyToIndex[k]].deliveredQty += q;
                        } else {
                            unmatchedDelivered += q;
                        }
                    });
                } else if (h && h.amount != null) {
                    var num = parseFloat(String(h.amount).replace(/,/g, '').replace(/[^\d.-]/g, ''));
                    if (!isNaN(num)) unmatchedDelivered += num;
                }
            });
        }
        var totalSumOriginal = 0, totalSumDelivered = unmatchedDelivered;
        items.forEach(function (it) {
            it.remainingQty = it.totalQty - it.deliveredQty;
            totalSumOriginal += it.totalQty;
            totalSumDelivered += it.deliveredQty;
        });
        var totalSumRemaining = totalSumOriginal - totalSumDelivered;
        return {
            items: items,
            unmatchedDelivered: unmatchedDelivered,
            totalSumOriginal: totalSumOriginal,
            totalSumDelivered: totalSumDelivered,
            totalSumRemaining: totalSumRemaining
        };
    }
    window._deliveryDB.computeStats = _computeItemDeliveryStats;

    // =========================================================================
    // بخش ۲) تزریق استایل — فقط استایل‌های جدید و هماهنگ با CSS موجود پروژه
    // =========================================================================
    function _injectStyle() {
        if (document.getElementById('delivery-list-styles')) return;
        var style = document.createElement('style');
        style.id = 'delivery-list-styles';
        style.textContent = [
            /* رنگ دکمه «لیست تسلیم‌دهی» در quick-lists */
            '.btn-ql-delivery {',
            '    background: linear-gradient(135deg, #f97316, #ea580c) !important;',
            '    color: #ffffff !important;',
            '    border: none !important;',
            '}',
            /* نوار جمع کل — کاملاً هماهنگ با #sales-list-total-bar */
            '#delivery-list-total-bar {',
            '    display: flex !important;',
            '    justify-content: flex-end;',
            '    align-items: center;',
            '    gap: 14px;',
            '    padding: 10px 18px;',
            '    background: #eef3ff;',
            '    border: 1px solid #c7d7f5;',
            '    border-top: 2.5px solid #2563eb;',
            '    border-radius: 0 0 8px 8px;',
            '    margin-top: -1px;',
            '    font-weight: 700;',
            '    font-size: 1rem;',
            '    color: #1e293b;',
            '}',
            '#delivery-list-total-bar span:last-child {',
            '    color: #2563eb !important;',
            '    font-size: 1.12rem !important;',
            '    font-weight: 800;',
            '}',
            'body.dark-mode #delivery-list-total-bar {',
            '    background: #1a2640 !important;',
            '    border: 1px solid #2d4a7a !important;',
            '    border-top: 2.5px solid #60a5fa !important;',
            '    color: #e2e8f0 !important;',
            '}',
            'body.dark-mode #delivery-list-total-bar span:last-child {',
            '    color: #93c5fd !important;',
            '}',
            /* استایل چک‌باکس «افزودن به تسلیم‌دهی» */
            '.add-to-delivery-wrap {',
            '    display: inline-flex;',
            '    align-items: center;',
            '    gap: 5px;',
            '    font-size: 0.78rem;',
            '    cursor: pointer;',
            '    user-select: none;',
            '    color: var(--text-muted, #64748b);',
            '    margin-right: 4px;',
            '}',
            '.add-to-delivery-wrap input[type="checkbox"] {',
            '    margin: 0;',
            '    cursor: pointer;',
            '    accent-color: #f97316;',
            '    width: 14px;',
            '    height: 14px;',
            '}',
            '.add-to-delivery-wrap input[type="checkbox"]:checked + span {',
            '    color: #f97316;',
            '    font-weight: 600;',
            '}',
            'body.dark-mode .add-to-delivery-wrap {',
            '    color: #cbd5e1;',
            '}',
            /* جدول جزئیات داخل modal */
            '.delivery-details-table {',
            '    width: 100%;',
            '    border-collapse: collapse;',
            '    margin-top: 10px;',
            '    font-size: 13px;',
            '}',
            '.delivery-details-table th, .delivery-details-table td {',
            '    border: 1px solid var(--border-color, #cbd5e1);',
            '    padding: 8px 10px;',
            '    text-align: right;',
            '}',
            '.delivery-details-table th {',
            '    background: var(--bg-alt, #f8f9fa);',
            '    font-weight: 700;',
            '    color: var(--text-main, #334155);',
            '}',
            'body.dark-mode .delivery-details-table th {',
            '    background: #1e293b;',
            '    color: #e2e8f0;',
            '    border-color: #334155;',
            '}',
            'body.dark-mode .delivery-details-table td {',
            '    border-color: #334155;',
            '    color: #e2e8f0;',
            '}',
            '.delivery-details-info {',
            '    background: var(--bg-alt, #f8f9fa);',
            '    border: 1px solid var(--border-color, #cbd5e1);',
            '    border-radius: 6px;',
            '    padding: 10px 12px;',
            '    margin-bottom: 10px;',
            '    font-size: 13px;',
            '    line-height: 1.9;',
            '}',
            'body.dark-mode .delivery-details-info {',
            '    background: #1e293b;',
            '    border-color: #334155;',
            '    color: #e2e8f0;',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // =========================================================================
    // بخش ۳) تزریق چک‌باکس «افزودن به تسلیم‌دهی» در فورم فروش
    // =========================================================================
    function _injectCheckbox() {
        var serviceAddBtn = document.querySelector('#salesForm .btn-service-add');
        if (!serviceAddBtn) return false;
        if (document.getElementById('add-to-delivery-checkbox')) return true;

        var wrap = document.createElement('label');
        wrap.id = 'add-to-delivery-wrap';
        wrap.className = 'add-to-delivery-wrap';
        wrap.title = 'افزودن این فاکتور به لیست تسلیم‌دهی';

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'add-to-delivery-checkbox';

        var txt = document.createElement('span');
        txt.textContent = 'افزودن به تسلیم‌دهی';

        wrap.appendChild(cb);
        wrap.appendChild(txt);
        serviceAddBtn.parentNode.insertBefore(wrap, serviceAddBtn);
        return true;
    }

    // =========================================================================
    // بخش ۴) تزریق دکمه «لیست تسلیم‌دهی» در quick-list-buttons داشبورد
    // =========================================================================
    function _injectQuickListButton() {
        var servicesBtn = document.querySelector('.quick-list-buttons .btn-ql-services');
        if (!servicesBtn) return false;
        if (document.querySelector('.quick-list-buttons .btn-ql-delivery')) return true;

        var btn = document.createElement('button');
        btn.className = 'btn-quick-list btn-ql-delivery';
        btn.setAttribute('onclick', "showSection('delivery-list')");
        btn.innerHTML = '<i class="fas fa-dolly"></i> لیست تسلیم‌دهی';

        servicesBtn.parentNode.insertBefore(btn, servicesBtn.nextSibling);
        return true;
    }

    // =========================================================================
    // بخش ۵) تزریق سکشن «لیست تسلیم‌دهی» — ساختار دقیقاً مشابه #sales-list
    // =========================================================================
    function _injectListSection() {
        if (document.getElementById('delivery-list')) return true;
        var salesListSec = document.getElementById('sales-list');
        if (!salesListSec || !salesListSec.parentNode) return false;

        var html =
            '<section id="delivery-list" class="section">' +
                '<div class="list-header-filter">' +
                    '<div class="filter-icons-left">' +
                        '<button class="filter-icon-btn" onclick="toggleSortMenu(\'delivery-list\')"><i class="fas fa-bars"></i></button>' +
                        '<button class="filter-icon-btn" onclick="toggleFilterMenu(\'delivery-list\')"><i class="fas fa-filter"></i></button>' +
                    '</div>' +
                    '<h3 class="section-title-in-filter">' +
                        '<button class="btn-back-header" onclick="showSection(\'dashboard\')" title="برگشت"><i class="fas fa-arrow-right"></i></button>' +
                        ' لیست تسلیم‌دهی' +
                    '</h3>' +
                    '<input type="text" id="global-search-delivery-list" placeholder="جستجو در لیست تسلیم‌دهی (شماره فاکتور، نام مشتری، کد کالا...)" onkeyup="globalSearch(\'delivery-list\')">' +
                '</div>' +
                '<div id="sort-menu-delivery-list" class="sort-menu">' +
                    '<h4>مرتب‌سازی</h4>' +
                    '<select onchange="applySort(\'delivery-list\', this.value)">' +
                        '<option value="date-desc">جدیدترین</option>' +
                        '<option value="date-asc">قدیمی‌ترین</option>' +
                        '<option value="amount-desc">مبلغ (بیشتر به کمتر)</option>' +
                        '<option value="amount-asc">مبلغ (کمتر به بیشتر)</option>' +
                    '</select>' +
                '</div>' +
                '<div id="filter-menu-delivery-list" class="filter-menu">' +
                    '<h4>فیلتر پیشرفته</h4>' +
                    '<div class="filter-row">' +
                        '<div class="filter-group">' +
                            '<label>از تاریخ:</label>' +
                            '<input type="text" class="jalali-date" id="filter-delivery-list-from">' +
                        '</div>' +
                        '<div class="filter-group">' +
                            '<label>تا تاریخ:</label>' +
                            '<input type="text" class="jalali-date" id="filter-delivery-list-to">' +
                        '</div>' +
                        '<div class="filter-group">' +
                            '<label>نوع فروش:</label>' +
                            '<select id="filter-delivery-list-type">' +
                                '<option value="all">همه</option>' +
                                '<option value="نقدی">نقدی</option>' +
                                '<option value="اعتباری">اعتباری</option>' +
                                '<option value="آنلاین">آنلاین</option>' +
                            '</select>' +
                        '</div>' +
                        '<div class="filter-group">' +
                            '<label>مشتری:</label>' +
                            '<input type="text" id="filter-delivery-list-customer" placeholder="نام مشتری...">' +
                        '</div>' +
                        '<div class="filter-group">' +
                            '<label>وضعیت:</label>' +
                            '<select id="filter-delivery-list-status">' +
                                '<option value="all">همه</option>' +
                                '<option value="پرداخت کامل">پرداخت کامل</option>' +
                                '<option value="پرداخت ناقص">پرداخت ناقص</option>' +
                                '<option value="لغو شده">لغو شده</option>' +
                            '</select>' +
                        '</div>' +
                        '<button class="btn-primary" onclick="applyAdvancedFilter(\'delivery-list\')">اعمال فیلتر</button>' +
                    '</div>' +
                '</div>' +
                '<div class="table-container">' +
                    '<table id="delivery-list-table">' +
                        '<thead>' +
                            '<tr>' +
                                '<th>تاریخ و ساعت</th>' +
                                '<th>شماره فاکتور</th>' +
                                '<th>مشتری</th>' +
                                '<th>مقدار</th>' +
                                '<th>مبلغ کل</th>' +
                                '<th>وضعیت</th>' +
                                '<th>عملیات</th>' +
                            '</tr>' +
                        '</thead>' +
                        '<tbody id="delivery-list-tbody"></tbody>' +
                    '</table>' +
                '</div>' +
            '</section>';

        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var newSec = tmp.firstChild;
        salesListSec.parentNode.insertBefore(newSec, salesListSec.nextSibling);
        return true;
    }

    // =========================================================================
    // بخش ۶) تزریق سکشن «فورم تسلیم‌دهی» — ساختار دقیقاً مشابه payment-form
    // =========================================================================
    function _injectFormSection() {
        if (document.getElementById('delivery-form')) return true;
        var deliveryListSec = document.getElementById('delivery-list');
        if (!deliveryListSec || !deliveryListSec.parentNode) return false;

        var html =
            '<section id="delivery-form" class="section">' +
                '<div class="section-header">' +
                    '<h2>' +
                        '<button class="btn-back-header" onclick="showSection(\'delivery-list\')" title="برگشت">' +
                            '<i class="fas fa-arrow-right"></i>' +
                        '</button>' +
                        ' فورم تسلیم‌دهی' +
                    '</h2>' +
                '</div>' +
                '<div class="form-container">' +
                    '<form id="deliveryForm" onsubmit="event.preventDefault(); saveDeliveryRecord();">' +
                        '<div class="form-row">' +
                            '<div class="form-group">' +
                                '<label for="delivery-bill-number">نمبر بل</label>' +
                                '<input type="text" id="delivery-bill-number" readonly>' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="delivery-datetime">تاریخ و ساعت</label>' +
                                '<input type="text" id="delivery-datetime" class="jalali-date" readonly>' +
                            '</div>' +
                        '</div>' +
                        '<div class="form-row">' +
                            '<div class="form-group full-width">' +
                                '<label>انتخاب جنس و مقدار تسلیم‌دهی *</label>' +
                                '<div id="delivery-items-container" style="border:1px solid #e2e8f0;border-radius:8px;padding:8px;overflow-x:auto;">' +
                                    '<table id="delivery-items-table" style="width:100%;border-collapse:collapse;font-size:13px;">' +
                                        '<thead>' +
                                            '<tr style="background:#f1f5f9;">' +
                                                '<th style="padding:6px;text-align:center;width:36px;"><input type="checkbox" id="delivery-items-select-all" title="انتخاب همه"></th>' +
                                                '<th style="padding:6px;text-align:right;">جنس</th>' +
                                                '<th style="padding:6px;text-align:center;">واحد</th>' +
                                                '<th style="padding:6px;text-align:center;">مقدار کل</th>' +
                                                '<th style="padding:6px;text-align:center;">تسلیم‌شده</th>' +
                                                '<th style="padding:6px;text-align:center;">باقی‌مانده</th>' +
                                                '<th style="padding:6px;text-align:center;width:130px;">مقدار تسلیم در این مرحله</th>' +
                                            '</tr>' +
                                        '</thead>' +
                                        '<tbody id="delivery-items-tbody"></tbody>' +
                                    '</table>' +
                                '</div>' +
                                '<div id="delivery-items-summary" style="margin-top:6px;font-size:12px;color:#64748b;font-weight:600;"></div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="form-row">' +
                            '<div class="form-group full-width">' +
                                '<label for="delivery-notes">اطلاعات بیشتر</label>' +
                                '<textarea id="delivery-notes" rows="3" placeholder="توضیحات..."></textarea>' +
                            '</div>' +
                        '</div>' +
                        '<div class="form-row">' +
                            '<div class="form-group full-width">' +
                                '<label for="delivery-signature">امضا و مهر</label>' +
                                '<textarea id="delivery-signature" rows="2" placeholder="امضا و مهر..."></textarea>' +
                            '</div>' +
                        '</div>' +
                        '<div class="form-actions">' +
                            '<button type="button" class="btn-primary" onclick="saveDeliveryRecord()">' +
                                '<i class="fas fa-check"></i> ذخیره' +
                            '</button>' +
                            '<button type="button" class="btn-secondary" onclick="showSection(\'delivery-list\')">' +
                                'لغو' +
                            '</button>' +
                        '</div>' +
                    '</form>' +
                '</div>' +
            '</section>';

        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var newSec = tmp.firstChild;
        deliveryListSec.parentNode.insertBefore(newSec, deliveryListSec.nextSibling);
        return true;
    }

    // =========================================================================
    // بخش ۷) Monkey-patch روی db.saveTransaction
    //         اگر چک‌باکس فعال بود و فروش جدیدی ثبت شد، در deliveries هم ذخیره شود
    // =========================================================================
    function _hookSaveTransaction() {
        // نکته مهم: در database.js نمونه دیتابیس با «const db = new Database()» در سطح
        // سراسری اسکریپت تعریف شده است. طبق مشخصات زبان جاوااسکریپت، شناسه‌های const/let
        // سطح سراسری در محیط واژگانی سراسری ثبت می‌شوند ولی به‌عنوان property روی
        // شیء window قرار نمی‌گیرند. بنابراین window.db همیشه undefined است و باید
        // مستقیماً از شناسه db (که از سایر اسکریپت‌های کلاسیک قابل دسترسی است) استفاده شود.
        if (typeof db === 'undefined' || !db || typeof db.saveTransaction !== 'function') return false;
        if (db.saveTransaction._jouyaDeliveryPatched) return true;

        var orig = db.saveTransaction.bind(db);

        db.saveTransaction = function (transaction) {
            var isNewSale = transaction && transaction.type === 'فروش' && !transaction.id;
            var cb = document.getElementById('add-to-delivery-checkbox');
            var shouldAdd = isNewSale && cb && cb.checked;

            var result = orig(transaction);

            if (result && result.success !== false && shouldAdd && result.data) {
                _addDeliveryFromTransaction(result.data);
                try {
                    var sec = document.getElementById('delivery-list');
                    if (sec && sec.classList.contains('active')) {
                        window.loadDeliveriesList();
                    }
                } catch (_) {}
            }
            return result;
        };

        db.saveTransaction._jouyaDeliveryPatched = true;
        return true;
    }

    // =========================================================================
    // بخش ۸) loadDeliveriesList — رندر جدول لیست تسلیم‌دهی
    //         منطق رندرینگ دقیقاً مشابه loadSalesList اما روی داده‌های deliveries
    // =========================================================================
    window.loadDeliveriesList = function () {
        try {
            var tbody = document.getElementById('delivery-list-tbody');
            if (!tbody) return;
            var deliveries = _getDeliveries();
            tbody.innerHTML = '';

            if (deliveries.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">هیچ مورد تسلیم‌دهی ثبت نشده است</td></tr>';
                var oldBar = document.getElementById('delivery-list-total-bar');
                if (oldBar) oldBar.remove();
                return;
            }

            var sorted = deliveries.slice().sort(function (a, b) {
                if (typeof window.sortNewestFirst === 'function') return window.sortNewestFirst(a, b);
                var ad = a.createdAt || a.date || '';
                var bd = b.createdAt || b.date || '';
                return String(bd).localeCompare(String(ad));
            });

            var totalAmountAFN = 0, totalAmountUSD = 0;

            sorted.forEach(function (d) {
                var txRemaining = (typeof window.calculateTxRemaining === 'function')
                    ? window.calculateTxRemaining(d)
                    : (parseFloat(d.remaining) || 0);
                var txTotal = parseFloat(d.totalAmount || d.amount || 0);
                var fmtNum = function (n) {
                    return (typeof window.formatNumber === 'function') ? window.formatNumber(n) : n;
                };

                var status = '', statusClass = 'badge-settled';
                if (txRemaining > 0) {
                    status = 'باقی‌دار: ' + fmtNum(txRemaining);
                    statusClass = 'badge-remaining';
                } else if (txRemaining < 0) {
                    status = 'اضافه: ' + fmtNum(Math.abs(txRemaining));
                    statusClass = 'badge-overpaid';
                } else if (txTotal > 0) {
                    status = 'تسویه‌شده';
                    statusClass = 'badge-settled';
                } else {
                    status = d.status || 'تسویه‌شده';
                }
                if (status === 'لغو شده') statusClass = 'badge-danger';

                // محاسبه «مقدار باقی‌مانده برای تسلیم‌دهی» با استفاده از helper مرکزی
                // که هم رکوردهای جدید (per-item) و هم رکوردهای قدیمی (amount عمومی) را پشتیبانی می‌کند
                var _stats = _computeItemDeliveryStats(d);
                var totalQty = _stats.totalSumOriginal;
                var remainingQty = _stats.totalSumRemaining;
                var qtyDisplay;
                if (totalQty <= 0) {
                    qtyDisplay = '-';
                } else if (remainingQty <= 0) {
                    // مقدار تمام شد — به خط سرخ نمایش داده شود که جریان تسلیم‌دهی تکمیل است
                    qtyDisplay = '<span style="color:#dc2626;font-weight:700;">تکمیل تسلیم‌دهی</span>';
                } else {
                    qtyDisplay = fmtNum(remainingQty);
                }
                var txAmount = parseFloat(d.totalAmount || d.amount || 0);
                var txCurrency = d.currency || 'AFN';
                var curFa = (txCurrency === 'USD') ? 'دالر' : 'افغانی';
                var amountDisplay = fmtNum(txAmount) + ' ' + curFa;
                if (txCurrency === 'USD') totalAmountUSD += txAmount;
                else totalAmountAFN += txAmount;

                var rowDate = (typeof window.formatAfghanDateTime === 'function')
                    ? window.formatAfghanDateTime(d.date, d.createdAt)
                    : (d.date || '-');

                var row = document.createElement('tr');
                row.dataset.date = rowDate;
                row.dataset.amount = txAmount;
                row.dataset.status = status;
                row.dataset.type = d.paymentType || 'نقد';
                row.dataset.person = (d.customerName || '').toLowerCase();
                row.innerHTML =
                    '<td>' + (rowDate || '-') + '</td>' +
                    '<td>' + (d.billNumber || '-') + '</td>' +
                    '<td>' + (d.customerName || '-') + '</td>' +
                    '<td>' + qtyDisplay + '</td>' +
                    '<td>' + amountDisplay + '</td>' +
                    '<td><span class="badge ' + statusClass + '">' + status + '</span></td>' +
                    '<td>' + _getDeliveryActionButtonHTML(d.id) + '</td>';
                tbody.appendChild(row);
            });

            var tableContainer = document.querySelector('#delivery-list .table-container');
            if (tableContainer) {
                var totalBar = document.getElementById('delivery-list-total-bar');
                if (!totalBar) {
                    totalBar = document.createElement('div');
                    totalBar.id = 'delivery-list-total-bar';
                    tableContainer.after(totalBar);
                }
                var fmtNum2 = function (n) {
                    return (typeof window.formatNumber === 'function') ? window.formatNumber(n) : n;
                };
                var parts = [];
                if (totalAmountAFN > 0) parts.push(fmtNum2(totalAmountAFN) + ' افغانی');
                if (totalAmountUSD > 0) parts.push(fmtNum2(totalAmountUSD) + ' دالر');
                var totalText = parts.length > 0 ? parts.join(' / ') : fmtNum2(0);
                totalBar.innerHTML = '<span>مجموع تسلیم‌دهی‌ها:</span><span>' + totalText + '</span>';
            }

            if (typeof window.applyNumberSystemToDocument === 'function') {
                try { window.applyNumberSystemToDocument(); } catch (_) {}
            }
        } catch (e) {
            console.error('[delivery] خطا در loadDeliveriesList:', e);
        }
    };

    // =========================================================================
    // بخش ۹) منوی سه‌نقطه‌ای — هماهنگ با showTransactionActionBar پروژه
    // =========================================================================
    function _getDeliveryActionButtonHTML(id) {
        return '<button class="btn-icon btn-secondary action-trigger-btn"' +
               ' onmouseenter="showDeliveryActionBar(event, ' + id + ')"' +
               ' onmouseleave="handleActionButtonMouseLeave(event)"' +
               ' style="margin:0;" title="عملیات">' +
               '<i class="fas fa-ellipsis-h"></i>' +
               '</button>';
    }

    window.showDeliveryActionBar = function (event, id) {
        if (typeof window.closeToolbarTimer !== 'undefined' && window.closeToolbarTimer) {
            clearTimeout(window.closeToolbarTimer);
            window.closeToolbarTimer = null;
        }
        if (typeof window.currentToolbar !== 'undefined' && window.currentToolbar) {
            window.currentToolbar.remove();
            window.currentToolbar = null;
        }

        var d = _findDelivery(id);
        if (!d) return;

        var toolbar = document.createElement('div');
        toolbar.className = 'floating-action-toolbar';
        toolbar.setAttribute('data-delivery-id', id);
        Object.assign(toolbar.style, {
            position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'stretch',
            gap: '4px', backgroundColor: '#ffffff', padding: '8px', borderRadius: '12px',
            boxShadow: '0 5px 20px rgba(0,0,0,0.2)', border: '1px solid #cbd5e1',
            zIndex: '9999', whiteSpace: 'nowrap', minWidth: '200px'
        });

        var actions = [
            { icon: 'fa-truck',       color: '#10b981', title: 'تسلیم‌دهی',         action: 'deliver' },
            { icon: 'fa-info-circle', color: '#3b82f6', title: 'جزئیات تسلیم‌دهی', action: 'details' },
            { icon: 'fa-file-alt',    color: '#7c3aed', title: 'گزارش تسلیم‌دهی',  action: 'report' },
            { icon: 'fa-trash',       color: '#dc2626', title: 'حذف',              action: 'delete' }
        ];

        actions.forEach(function (item) {
            var btn = document.createElement('button');
            btn.title = item.title;
            btn.innerHTML = '<i class="fas ' + item.icon + '" style="width:18px;text-align:center;color:' + item.color + ';"></i>' +
                            '<span style="margin-right:10px;font-size:13px;color:#1e293b;font-weight:500;">' + item.title + '</span>';
            Object.assign(btn.style, {
                background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 10px',
                transition: 'background 0.2s', display: 'flex', alignItems: 'center',
                justifyContent: 'flex-start', borderRadius: '6px', textAlign: 'right', fontFamily: 'inherit'
            });
            btn.onmouseenter = function () { btn.style.background = '#f1f5f9'; };
            btn.onmouseleave = function () { btn.style.background = 'transparent'; };
            btn.onclick = function (e) {
                e.stopPropagation();
                if (typeof window.closeAllActionMenus === 'function') window.closeAllActionMenus();
                _performDeliveryAction(id, item.action);
            };
            toolbar.appendChild(btn);
        });

        toolbar.addEventListener('mouseenter', function () {
            if (typeof window.closeToolbarTimer !== 'undefined' && window.closeToolbarTimer) {
                clearTimeout(window.closeToolbarTimer);
                window.closeToolbarTimer = null;
            }
        });
        toolbar.addEventListener('mouseleave', function () {
            if (typeof window.startCloseToolbarTimer === 'function') window.startCloseToolbarTimer();
        });

        document.body.appendChild(toolbar);
        window.currentToolbar = toolbar;

        var rect = event.currentTarget.getBoundingClientRect();
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        toolbar.style.top = (rect.top + scrollTop) + 'px';
        toolbar.style.left = (rect.right + scrollLeft + 10) + 'px';

        toolbar.animate([
            { opacity: 0, transform: 'scale(0.8)' },
            { opacity: 1, transform: 'scale(1)' }
        ], { duration: 200, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' });
    };

    function _performDeliveryAction(id, action) {
        switch (action) {
            case 'delete':
                _confirmAndDelete(id);
                break;
            case 'deliver':
                window.showDeliveryForm(id);
                break;
            case 'details':
                window.showDeliveryDetails(id);
                break;
            case 'report':
                window.printDeliveryReport(id);
                break;
        }
    }

    function _confirmAndDelete(id) {
        if (!confirm('آیا از حذف این مورد از لیست تسلیم‌دهی مطمئن هستید؟\n(فاکتور اصلی در لیست فروش‌ها حذف نمی‌شود)')) return;
        if (_deleteDelivery(id)) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('موفقیت', 'مورد تسلیم‌دهی با موفقیت حذف شد.');
            }
            window.loadDeliveriesList();
        } else {
            if (typeof window.showMessage === 'function') {
                window.showMessage('خطا', 'حذف انجام نشد.');
            }
        }
    }

    // =========================================================================
    // بخش ۱۰) فورم تسلیم‌دهی — باز کردن، پر کردن خودکار و ذخیره
    // =========================================================================
    window.showDeliveryForm = function (deliveryId) {
        var d = _findDelivery(deliveryId);
        if (!d) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('خطا', 'مورد تسلیم‌دهی یافت نشد.');
            }
            return;
        }

        // اطمینان از وجود سکشن فورم
        if (!document.getElementById('delivery-form')) _injectFormSection();

        // پر کردن خودکار فیلدها
        var billInput = document.getElementById('delivery-bill-number');
        if (billInput) billInput.value = d.billNumber || '-';

        var dtInput = document.getElementById('delivery-datetime');
        if (dtInput) {
            // استفاده از همان منطق تاریخ پروژه (getJalaliDateTime در persian-date-utils.js)
            var dt = '';
            if (typeof window.getJalaliDateTime === 'function') {
                try { dt = window.getJalaliDateTime(); } catch (_) {}
            }
            if (!dt && typeof window.formatAfghanDateTime === 'function') {
                try { dt = window.formatAfghanDateTime('', new Date().toISOString()); } catch (_) {}
            }
            if (!dt) dt = new Date().toLocaleString('fa-IR');
            dtInput.value = dt;
        }

        // پاک‌سازی فیلدهای کاربر
        var notesInput = document.getElementById('delivery-notes');
        var sigInput = document.getElementById('delivery-signature');
        if (notesInput) notesInput.value = '';
        if (sigInput) sigInput.value = '';

        // ذخیره id رکورد در dataset برای استفاده در ذخیره
        var form = document.getElementById('deliveryForm');
        if (form) form.dataset.deliveryId = String(deliveryId);

        // ===== پر کردن جدول اقلام (per-item) =====
        // برای هر جنس در بل، یک سطر با مقدار کل، تسلیم‌شده، باقی‌مانده و فیلد ورود مقدار تسلیم در این مرحله
        var _stats = _computeItemDeliveryStats(d);
        var fmtNumLocal = function (n) {
            return (typeof window.formatNumber === 'function') ? window.formatNumber(n) : n;
        };
        var esc = function (s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        };
        var tbody = document.getElementById('delivery-items-tbody');
        var summaryEl = document.getElementById('delivery-items-summary');
        if (tbody) {
            tbody.innerHTML = '';
            if (!_stats.items || _stats.items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:10px;color:#dc2626;">این بل هیچ قلم جنس قابل تسلیم ندارد.</td></tr>';
            } else {
                _stats.items.forEach(function (it, idx) {
                    var rem = it.remainingQty;
                    var disabled = (rem <= 0);
                    var rowBg = (idx % 2 === 0) ? '#ffffff' : '#f8fafc';
                    var remDisplay = (rem <= 0)
                        ? '<span style="color:#dc2626;font-weight:700;">تکمیل</span>'
                        : fmtNumLocal(rem);
                    var tr = document.createElement('tr');
                    tr.style.background = rowBg;
                    tr.dataset.itemKey = it.key;
                    tr.dataset.productId = (it.productId === null || it.productId === undefined) ? '' : String(it.productId);
                    tr.dataset.productName = it.productName || '';
                    tr.dataset.unit = it.unit || '';
                    tr.dataset.remainingQty = String(rem);
                    tr.innerHTML =
                        '<td style="padding:6px;text-align:center;border-top:1px solid #e2e8f0;">' +
                            '<input type="checkbox" class="delivery-item-check" ' + (disabled ? 'disabled' : '') + ' style="width:16px;height:16px;cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';">' +
                        '</td>' +
                        '<td style="padding:6px;border-top:1px solid #e2e8f0;">' + esc(it.productName) + '</td>' +
                        '<td style="padding:6px;text-align:center;border-top:1px solid #e2e8f0;">' + esc(it.unit || '-') + '</td>' +
                        '<td style="padding:6px;text-align:center;border-top:1px solid #e2e8f0;">' + fmtNumLocal(it.totalQty) + '</td>' +
                        '<td style="padding:6px;text-align:center;border-top:1px solid #e2e8f0;">' + fmtNumLocal(it.deliveredQty) + '</td>' +
                        '<td style="padding:6px;text-align:center;border-top:1px solid #e2e8f0;">' + remDisplay + '</td>' +
                        '<td style="padding:6px;text-align:center;border-top:1px solid #e2e8f0;">' +
                            '<input type="number" class="delivery-item-qty" step="0.01" min="0" ' +
                            (disabled ? 'disabled' : '') +
                            ' style="width:100%;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;" placeholder="0">' +
                            '<div class="delivery-item-err" style="display:none;color:#dc2626;font-size:11px;margin-top:3px;"></div>' +
                        '</td>';
                    tbody.appendChild(tr);
                });
            }
        }

        // listener ها: checkbox + qty
        var updateSummary = function () {
            if (!summaryEl) return;
            var rows = tbody ? tbody.querySelectorAll('tr[data-item-key]') : [];
            var anyChecked = false;
            var totalSelected = 0;
            var allValid = true;
            rows.forEach(function (r) {
                var chk = r.querySelector('.delivery-item-check');
                var qtyInp = r.querySelector('.delivery-item-qty');
                var errEl = r.querySelector('.delivery-item-err');
                if (chk && chk.checked) {
                    anyChecked = true;
                    var rem = parseFloat(r.dataset.remainingQty) || 0;
                    var v = parseFloat(qtyInp ? qtyInp.value : '');
                    if (isNaN(v) || v <= 0) {
                        allValid = false;
                        if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'مقدار را وارد کنید'; }
                    } else if (v > rem) {
                        allValid = false;
                        if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'حداکثر مجاز: ' + fmtNumLocal(rem); }
                    } else {
                        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
                        totalSelected += v;
                    }
                } else {
                    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
                    if (qtyInp) qtyInp.value = '';
                }
            });
            if (!anyChecked) {
                summaryEl.style.color = '#64748b';
                summaryEl.textContent = 'حداقل یک قلم جنس را انتخاب و مقدار تسلیم را وارد کنید.';
            } else if (!allValid) {
                summaryEl.style.color = '#dc2626';
                summaryEl.textContent = '⚠ مقادیر را اصلاح کنید — بعضی مقادیر نامعتبر یا بیش از باقی‌مانده‌اند.';
            } else {
                summaryEl.style.color = '#16a34a';
                summaryEl.textContent = '✓ مجموع مقدار تسلیم در این مرحله: ' + fmtNumLocal(totalSelected);
            }
        };

        if (tbody) {
            tbody.querySelectorAll('.delivery-item-check').forEach(function (chk) {
                chk.onchange = function () {
                    var tr = chk.closest('tr');
                    if (tr) {
                        var qtyInp = tr.querySelector('.delivery-item-qty');
                        if (qtyInp && chk.checked && (!qtyInp.value || parseFloat(qtyInp.value) <= 0)) {
                            // پیش‌پر کردن با باقی‌مانده
                            var rem = parseFloat(tr.dataset.remainingQty) || 0;
                            if (rem > 0) qtyInp.value = rem;
                        }
                        if (qtyInp && !chk.checked) qtyInp.value = '';
                    }
                    updateSummary();
                };
            });
            tbody.querySelectorAll('.delivery-item-qty').forEach(function (inp) {
                inp.oninput = function () {
                    var tr = inp.closest('tr');
                    if (tr) {
                        var chk = tr.querySelector('.delivery-item-check');
                        var v = parseFloat(inp.value);
                        if (!isNaN(v) && v > 0 && chk && !chk.checked) chk.checked = true;
                        if ((isNaN(v) || v <= 0) && chk && chk.checked) chk.checked = false;
                    }
                    updateSummary();
                };
            });
        }

        var selectAll = document.getElementById('delivery-items-select-all');
        if (selectAll) {
            selectAll.onchange = function () {
                if (!tbody) return;
                tbody.querySelectorAll('.delivery-item-check').forEach(function (chk) {
                    if (chk.disabled) return;
                    chk.checked = selectAll.checked;
                    var tr = chk.closest('tr');
                    if (tr) {
                        var qtyInp = tr.querySelector('.delivery-item-qty');
                        if (qtyInp) {
                            if (chk.checked) {
                                var rem = parseFloat(tr.dataset.remainingQty) || 0;
                                if (rem > 0) qtyInp.value = rem;
                            } else {
                                qtyInp.value = '';
                            }
                        }
                    }
                });
                updateSummary();
            };
        }

        updateSummary();

        // نمایش سکشن
        if (typeof window.showSection === 'function') {
            window.showSection('delivery-form');
        }

        // فوکوس روی اولین فیلد مقدار قابل تسلیم
        setTimeout(function () {
            try {
                var firstQty = tbody ? tbody.querySelector('.delivery-item-qty:not([disabled])') : null;
                if (firstQty) firstQty.focus();
            } catch (_) {}
        }, 100);
    };

    window.saveDeliveryRecord = function () {
        var form = document.getElementById('deliveryForm');
        if (!form) return;
        var deliveryId = form.dataset.deliveryId;
        if (!deliveryId) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('خطا', 'شناسه رکورد تسلیم‌دهی یافت نشد.');
            }
            return;
        }

        var datetime  = (document.getElementById('delivery-datetime')  || {}).value || '';
        var notes     = (document.getElementById('delivery-notes')     || {}).value || '';
        var signature = (document.getElementById('delivery-signature') || {}).value || '';

        // جمع‌آوری اقلام انتخاب‌شده با مقدار تسلیم
        var tbody = document.getElementById('delivery-items-tbody');
        if (!tbody) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('خطا', 'جدول اقلام یافت نشد.');
            }
            return;
        }
        var collected = [];
        var totalDeliveredNow = 0;
        var hasError = false;
        var errorMsg = '';
        var fmtNumChk = function (n) {
            return (typeof window.formatNumber === 'function') ? window.formatNumber(n) : n;
        };
        tbody.querySelectorAll('tr[data-item-key]').forEach(function (tr) {
            var chk = tr.querySelector('.delivery-item-check');
            if (!chk || !chk.checked) return;
            var qtyInp = tr.querySelector('.delivery-item-qty');
            var v = parseFloat(qtyInp ? qtyInp.value : '');
            var rem = parseFloat(tr.dataset.remainingQty) || 0;
            if (isNaN(v) || v <= 0) {
                hasError = true;
                if (!errorMsg) errorMsg = 'برای جنس «' + (tr.dataset.productName || '') + '» مقدار معتبر وارد کنید.';
                return;
            }
            if (v > rem) {
                hasError = true;
                if (!errorMsg) errorMsg = 'مقدار تسلیم برای جنس «' + (tr.dataset.productName || '') + '» نمی‌تواند بیشتر از باقی‌مانده (' + fmtNumChk(rem) + ') باشد.';
                return;
            }
            var pid = tr.dataset.productId;
            var pidVal = (pid === '' || pid === undefined) ? null : (isNaN(parseFloat(pid)) ? pid : parseFloat(pid));
            collected.push({
                productId: pidVal,
                productName: tr.dataset.productName || '',
                unit: tr.dataset.unit || '',
                quantity: v
            });
            totalDeliveredNow += v;
        });

        if (hasError) {
            if (typeof window.showMessage === 'function') window.showMessage('خطا', errorMsg);
            return;
        }
        if (collected.length === 0) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('خطا', 'حداقل یک قلم جنس را انتخاب و مقدار تسلیم را وارد کنید.');
            }
            return;
        }

        var record = {
            id: Date.now(),
            datetime: String(datetime).trim(),
            // amount به‌صورت جمع عددی تمام اقلام این مرحله — برای سازگاری با کد قدیمی نمایش
            amount: totalDeliveredNow,
            items: collected,
            notes: String(notes).trim(),
            signature: String(signature).trim(),
            createdAt: new Date().toISOString()
        };

        var ok = _addHistoryRecord(deliveryId, record);
        if (!ok) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('خطا', 'ذخیره تسلیم‌دهی با مشکل مواجه شد.');
            }
            return;
        }

        if (typeof window.showMessage === 'function') {
            window.showMessage('موفقیت', 'رکورد تسلیم‌دهی با موفقیت ذخیره شد.');
        }

        // برگشت به لیست
        if (typeof window.showSection === 'function') {
            window.showSection('delivery-list');
        }
    };

    // =========================================================================
    // بخش ۱۱) جزئیات تسلیم‌دهی — Modal با جدول تاریخچه
    // =========================================================================
    window.showDeliveryDetails = function (deliveryId) {
        var d = _findDelivery(deliveryId);
        if (!d) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('خطا', 'مورد تسلیم‌دهی یافت نشد.');
            }
            return;
        }

        var fmtNum = function (n) {
            return (typeof window.formatNumber === 'function') ? window.formatNumber(n) : n;
        };
        var esc = function (s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        };

        var billNumber   = d.billNumber || '-';
        var customerName = d.customerName || '-';
        var saleDate     = (typeof window.formatAfghanDateTime === 'function')
                            ? window.formatAfghanDateTime(d.date, d.createdAt)
                            : (d.date || '-');
        var currency     = d.currency || 'AFN';
        var curFa        = (currency === 'USD') ? 'دالر' : 'افغانی';
        var totalAmount  = parseFloat(d.totalAmount || d.amount || 0);

        var history = Array.isArray(d.history) ? d.history.slice() : [];
        // مرتب‌سازی از قدیمی به جدید برای نمایش history منطقی
        history.sort(function (a, b) {
            var ac = a.createdAt || '';
            var bc = b.createdAt || '';
            return String(ac).localeCompare(String(bc));
        });

        var infoHtml =
            '<div class="delivery-details-info">' +
                '<div><strong>شماره بل:</strong> ' + esc(billNumber) + '</div>' +
                '<div><strong>مشتری:</strong> ' + esc(customerName) + '</div>' +
                '<div><strong>تاریخ فاکتور:</strong> ' + esc(saleDate) + '</div>' +
                '<div><strong>مبلغ فاکتور:</strong> ' + fmtNum(totalAmount) + ' ' + curFa + '</div>' +
                '<div><strong>تعداد دفعات تسلیم:</strong> ' + history.length + '</div>' +
            '</div>';

        // ===== جدول جزئیات اقلام (per-item) =====
        var _statsDet = _computeItemDeliveryStats(d);
        var itemsBreakdownHtml = '';
        if (_statsDet.items && _statsDet.items.length > 0) {
            itemsBreakdownHtml =
                '<div style="margin-top:12px;font-weight:700;color:#1e293b;">جزئیات اقلام بل:</div>' +
                '<table class="delivery-details-table" style="margin-top:6px;">' +
                    '<thead>' +
                        '<tr>' +
                            '<th style="width:36px;">#</th>' +
                            '<th>جنس</th>' +
                            '<th style="width:70px;">واحد</th>' +
                            '<th style="width:90px;">مقدار کل</th>' +
                            '<th style="width:90px;">تسلیم‌شده</th>' +
                            '<th style="width:90px;">باقی‌مانده</th>' +
                            '<th style="width:110px;">وضعیت</th>' +
                        '</tr>' +
                    '</thead>' +
                    '<tbody>';
            _statsDet.items.forEach(function (it, idx) {
                var statusTxt, statusColor;
                if (it.remainingQty <= 0 && it.totalQty > 0) {
                    statusTxt = 'تکمیل تسلیم';
                    statusColor = '#16a34a';
                } else if (it.deliveredQty > 0) {
                    statusTxt = 'در حال تسلیم';
                    statusColor = '#f59e0b';
                } else {
                    statusTxt = 'تسلیم نشده';
                    statusColor = '#64748b';
                }
                itemsBreakdownHtml +=
                    '<tr>' +
                        '<td style="text-align:center;">' + (idx + 1) + '</td>' +
                        '<td>' + esc(it.productName) + '</td>' +
                        '<td style="text-align:center;">' + esc(it.unit || '-') + '</td>' +
                        '<td style="text-align:center;">' + fmtNum(it.totalQty) + '</td>' +
                        '<td style="text-align:center;">' + fmtNum(it.deliveredQty) + '</td>' +
                        '<td style="text-align:center;font-weight:700;color:' + (it.remainingQty <= 0 ? '#16a34a' : '#dc2626') + ';">' + fmtNum(it.remainingQty) + '</td>' +
                        '<td style="text-align:center;color:' + statusColor + ';font-weight:700;">' + statusTxt + '</td>' +
                    '</tr>';
            });
            if (_statsDet.unmatchedDelivered > 0) {
                itemsBreakdownHtml +=
                    '<tr style="background:#fef3c7;">' +
                        '<td colspan="4" style="text-align:right;font-weight:700;">تسلیم‌های قدیمی بدون تفکیک:</td>' +
                        '<td style="text-align:center;">' + fmtNum(_statsDet.unmatchedDelivered) + '</td>' +
                        '<td colspan="2"></td>' +
                    '</tr>';
            }
            itemsBreakdownHtml += '</tbody></table>';
        }

        var tableHtml;
        if (history.length === 0) {
            tableHtml = '<div style="text-align:center;padding:14px;color:var(--text-muted,#64748b);">هنوز هیچ تسلیم‌دهی برای این بل ثبت نشده است.</div>';
        } else {
            tableHtml =
                '<div style="margin-top:14px;font-weight:700;color:#1e293b;">تاریخچه تسلیم‌دهی:</div>' +
                '<table class="delivery-details-table" style="margin-top:6px;">' +
                    '<thead>' +
                        '<tr>' +
                            '<th style="width:36px;">#</th>' +
                            '<th>تاریخ و ساعت</th>' +
                            '<th>اقلام تسلیم‌شده در این مرحله</th>' +
                            '<th style="width:90px;">جمع مقدار</th>' +
                            '<th>اطلاعات بیشتر</th>' +
                            '<th>امضا و مهر</th>' +
                        '</tr>' +
                    '</thead>' +
                    '<tbody>';
            history.forEach(function (h, i) {
                var itemsCellHtml;
                if (Array.isArray(h.items) && h.items.length > 0) {
                    var parts = h.items.map(function (hi) {
                        return '• ' + esc(hi.productName || '-') +
                               ': <strong>' + fmtNum(parseFloat(hi.quantity) || 0) + '</strong>' +
                               (hi.unit ? ' ' + esc(hi.unit) : '');
                    });
                    itemsCellHtml = parts.join('<br>');
                } else {
                    itemsCellHtml = '<em style="color:#64748b;">(تسلیم بدون تفکیک)</em>';
                }
                var amtDisplay;
                if (h.amount != null && h.amount !== '') {
                    var an = parseFloat(String(h.amount).replace(/,/g, '').replace(/[^\d.-]/g, ''));
                    amtDisplay = isNaN(an) ? esc(h.amount) : fmtNum(an);
                } else {
                    amtDisplay = '-';
                }
                tableHtml +=
                    '<tr>' +
                        '<td style="text-align:center;">' + (i + 1) + '</td>' +
                        '<td>' + esc(h.datetime || '-') + '</td>' +
                        '<td>' + itemsCellHtml + '</td>' +
                        '<td style="text-align:center;font-weight:700;">' + amtDisplay + '</td>' +
                        '<td>' + esc(h.notes || '-') + '</td>' +
                        '<td>' + esc(h.signature || '-') + '</td>' +
                    '</tr>';
            });
            tableHtml += '</tbody></table>';
        }

        var fullHtml = '<div style="direction:rtl;text-align:right;">' + infoHtml + itemsBreakdownHtml + tableHtml + '</div>';

        if (typeof window.showMessage === 'function') {
            window.showMessage('جزئیات تسلیم‌دهی', fullHtml);
        }
    };

    // =========================================================================
    // بخش ۱۲) گزارش چاپی تسلیم‌دهی — ساختار مشابه _generateReceiptSlipHTML
    // =========================================================================
    window.printDeliveryReport = function (deliveryId) {
        var d = _findDelivery(deliveryId);
        if (!d) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('خطا', 'مورد تسلیم‌دهی یافت نشد.');
            }
            return;
        }

        var settings = (typeof db !== 'undefined' && db && typeof db.getSettings === 'function')
            ? (db.getSettings() || {})
            : {};

        var html = _generateDeliveryReportHTML(d, settings);
        var printWin = window.open('', '', 'width=900,height=720');
        if (!printWin) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('خطا', 'مرورگر مانع از باز شدن پنجره چاپ شد. لطفاً پاپ‌آپ‌ها را مجاز کنید.');
            }
            return;
        }
        printWin.document.write(html);
        printWin.document.close();
        printWin.focus();
        // اجازه می‌دهیم استایل‌ها بارگذاری شوند، سپس دیالوگ چاپ باز می‌شود
        setTimeout(function () {
            try { printWin.print(); } catch (_) {}
        }, 500);
    };

    function _generateDeliveryReportHTML(d, settings) {
        var fn = function (v) {
            var n = parseFloat(v) || 0;
            try {
                var sys = (typeof window.getNumberSystem === 'function' && window.getNumberSystem() === 'en') ? 'en-US' : 'fa-IR';
                return new Intl.NumberFormat(sys).format(n);
            } catch (e) {
                return n.toLocaleString();
            }
        };
        var esc = function (s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        };

        var headerColor = '#9a3412'; // نارنجی تیره — هماهنگ با btn-ql-delivery
        var accentColor = '#fde6d0';
        var storeName    = (settings && settings.storeName)    ? settings.storeName    : 'نام دوکان';
        var storePhone   = (settings && settings.storePhone)   ? settings.storePhone   : '';
        var storePhone2  = (settings && settings.storePhone2)  ? settings.storePhone2  : '';
        var storeAddress = (settings && settings.storeAddress) ? settings.storeAddress : '';
        var logoHtml = (settings && settings.storeLogo)
            ? '<img src="' + esc(settings.storeLogo) + '" alt="لوگو" style="max-height:60px;max-width:80px;object-fit:contain;border-radius:6px;background:#fff;padding:3px;">'
            : '<div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;">📦</div>';
        var footerText = (settings && settings.invoiceFooter) ? settings.invoiceFooter : 'با تشکر از همکاری شما';

        var billNumber   = d.billNumber || ('DLV-' + String(d.id || '').padStart(4, '0'));
        var customerName = d.customerName || '---';
        var saleDate     = (typeof window.formatAfghanDateTime === 'function')
                            ? window.formatAfghanDateTime(d.date, d.createdAt)
                            : (d.date || '---');
        var currency     = d.currency || 'AFN';
        var curFa        = (currency === 'USD') ? 'دالر' : 'افغانی';
        var totalAmount  = parseFloat(d.totalAmount || d.amount || 0);
        var notes        = d.notes || d.description || '';

        var history = Array.isArray(d.history) ? d.history.slice() : [];
        history.sort(function (a, b) {
            var ac = a.createdAt || '';
            var bc = b.createdAt || '';
            return String(ac).localeCompare(String(bc));
        });

        var historyRowsHtml = '';
        if (history.length === 0) {
            historyRowsHtml =
                '<tr><td colspan="6" style="text-align:center;padding:14px;color:#666;">هنوز هیچ تسلیم‌دهی ثبت نشده است</td></tr>';
        } else {
            history.forEach(function (h, i) {
                var itemsCellHtml;
                if (Array.isArray(h.items) && h.items.length > 0) {
                    var parts = h.items.map(function (hi) {
                        return '• ' + esc(hi.productName || '-') +
                               ': <strong>' + fn(parseFloat(hi.quantity) || 0) + '</strong>' +
                               (hi.unit ? ' ' + esc(hi.unit) : '');
                    });
                    itemsCellHtml = parts.join('<br>');
                } else {
                    itemsCellHtml = '<em style="color:#666;">(تسلیم بدون تفکیک)</em>';
                }
                var amtDisplay;
                if (h.amount != null && h.amount !== '') {
                    var an = parseFloat(String(h.amount).replace(/,/g, '').replace(/[^\d.-]/g, ''));
                    amtDisplay = isNaN(an) ? esc(h.amount) : fn(an);
                } else {
                    amtDisplay = '-';
                }
                historyRowsHtml +=
                    '<tr>' +
                        '<td style="text-align:center;">' + (i + 1) + '</td>' +
                        '<td>' + esc(h.datetime || '-') + '</td>' +
                        '<td>' + itemsCellHtml + '</td>' +
                        '<td style="text-align:center;font-weight:700;">' + amtDisplay + '</td>' +
                        '<td>' + esc(h.notes || '-') + '</td>' +
                        '<td>' + esc(h.signature || '-') + '</td>' +
                    '</tr>';
            });
        }

        // ===== جدول جزئیات اقلام (per-item breakdown) برای چاپ =====
        var _statsPrint = _computeItemDeliveryStats(d);
        var itemsBreakdownPrintHtml = '';
        if (_statsPrint.items && _statsPrint.items.length > 0) {
            itemsBreakdownPrintHtml =
                '<div class="rep-section-title">📦 جزئیات اقلام بل</div>' +
                '<table class="rep-table">' +
                    '<thead>' +
                        '<tr>' +
                            '<th style="width:36px;">#</th>' +
                            '<th>جنس</th>' +
                            '<th style="width:60px;">واحد</th>' +
                            '<th style="width:80px;">مقدار کل</th>' +
                            '<th style="width:80px;">تسلیم‌شده</th>' +
                            '<th style="width:80px;">باقی‌مانده</th>' +
                            '<th style="width:90px;">وضعیت</th>' +
                        '</tr>' +
                    '</thead>' +
                    '<tbody>';
            _statsPrint.items.forEach(function (it, idx) {
                var statusTxt;
                if (it.remainingQty <= 0 && it.totalQty > 0) statusTxt = 'تکمیل';
                else if (it.deliveredQty > 0) statusTxt = 'در حال تسلیم';
                else statusTxt = 'تسلیم نشده';
                itemsBreakdownPrintHtml +=
                    '<tr>' +
                        '<td style="text-align:center;">' + (idx + 1) + '</td>' +
                        '<td>' + esc(it.productName) + '</td>' +
                        '<td style="text-align:center;">' + esc(it.unit || '-') + '</td>' +
                        '<td style="text-align:center;">' + fn(it.totalQty) + '</td>' +
                        '<td style="text-align:center;">' + fn(it.deliveredQty) + '</td>' +
                        '<td style="text-align:center;font-weight:700;">' + fn(it.remainingQty) + '</td>' +
                        '<td style="text-align:center;">' + statusTxt + '</td>' +
                    '</tr>';
            });
            if (_statsPrint.unmatchedDelivered > 0) {
                itemsBreakdownPrintHtml +=
                    '<tr>' +
                        '<td colspan="4" style="text-align:right;font-weight:700;">تسلیم‌های قدیمی بدون تفکیک:</td>' +
                        '<td style="text-align:center;">' + fn(_statsPrint.unmatchedDelivered) + '</td>' +
                        '<td colspan="2"></td>' +
                    '</tr>';
            }
            itemsBreakdownPrintHtml += '</tbody></table>';
        }

        // ساخت رشته «مجموع مقادیر تسلیم‌شده» — چون مقدار می‌تواند متن یا عدد باشد،
        // ما هم تعداد دفعات و هم مجموع عددی (اگر همه عددی بودند) را نمایش می‌دهیم
        var numericTotal = 0;
        var allNumeric = history.length > 0;
        history.forEach(function (h) {
            var num = parseFloat(String(h.amount).replace(/,/g, '').replace(/[^\d.-]/g, ''));
            if (isNaN(num)) allNumeric = false;
            else numericTotal += num;
        });
        var totalDeliveredText = allNumeric
            ? ('<strong>' + fn(numericTotal) + '</strong>')
            : ('<strong>' + history.length + ' بار تسلیم‌دهی</strong>');

        return '<!DOCTYPE html>' +
'<html dir="rtl" lang="fa">' +
'<head>' +
'<meta charset="UTF-8">' +
'<title>گزارش تسلیم‌دهی ' + esc(billNumber) + '</title>' +
'<style>' +
'* { box-sizing: border-box; margin: 0; padding: 0; }' +
'@media print {' +
'    @page { size: A4 portrait; margin: 10mm; }' +
'    body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
'    .no-print { display: none !important; }' +
'}' +
'body { font-family: Tahoma, "Vazirmatn", Arial, sans-serif; font-size: 12px; color: #1a2533; background: #f0f4f8; direction: rtl; padding: 10mm; }' +
'.rep-wrap { background: #fff; border-radius: 8px; overflow: hidden; border: 2px solid ' + headerColor + '; max-width: 190mm; margin: 0 auto; }' +
'.rep-header { background: ' + headerColor + '; color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; gap: 8px; }' +
'.rep-store-name { font-size: 18px; font-weight: 900; }' +
'.rep-store-sub { font-size: 10px; opacity: 0.85; margin-top: 3px; }' +
'.rep-label-box { border: 2px solid rgba(255,255,255,0.4); border-radius: 6px; padding: 6px 12px; text-align: center; flex-shrink: 0; }' +
'.rep-label-box .lbl { font-size: 13px; font-weight: 900; color: #ffe08a; letter-spacing: 1px; }' +
'.rep-label-box .num { font-size: 20px; font-weight: 900; color: #ffe08a; }' +
'.rep-info { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-bottom: 1px solid #dee3ea; }' +
'.rep-info-cell { padding: 9px 14px; border-left: 1px dashed #dde3ea; }' +
'.rep-info-cell:nth-child(even) { border-left: none; }' +
'.rep-info-label { font-size: 11px; font-weight: 700; color: #4a5568; }' +
'.rep-info-value { font-size: 13px; color: #1a202c; font-weight: 700; margin-top: 2px; }' +
'.rep-section-title { background: ' + accentColor + '; color: ' + headerColor + '; font-size: 13px; font-weight: 800; padding: 8px 14px; border-bottom: 2px solid ' + headerColor + '; }' +
'.rep-table { width: 100%; border-collapse: collapse; font-size: 12px; }' +
'.rep-table th, .rep-table td { border: 1px solid #dde3ea; padding: 7px 8px; text-align: right; vertical-align: top; }' +
'.rep-table th { background: #f8f9fa; font-weight: 700; color: #4a5568; }' +
'.rep-total-box { background: ' + accentColor + '; border-top: 2px solid ' + headerColor + '; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }' +
'.rep-total-label { font-weight: 700; color: ' + headerColor + '; }' +
'.rep-total-value { font-size: 16px; font-weight: 900; color: ' + headerColor + '; }' +
'.rep-footer { background: ' + headerColor + '; color: #fff; text-align: center; padding: 8px; font-size: 11px; opacity: 0.95; }' +
'.print-btn { display: block; margin: 14px auto 0; background: ' + headerColor + '; color: #fff; border: none; border-radius: 20px; padding: 9px 30px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 700; }' +
'</style>' +
'</head>' +
'<body>' +
'<div class="rep-wrap">' +
    '<div class="rep-header">' +
        '<div>' + logoHtml + '</div>' +
        '<div style="flex:1;text-align:center;">' +
            '<div class="rep-store-name">' + esc(storeName) + '</div>' +
            '<div class="rep-store-sub">' + (storePhone ? '📞 ' + esc(storePhone) : '') + (storePhone2 ? ' | ' + esc(storePhone2) : '') + '</div>' +
            (storeAddress ? '<div class="rep-store-sub">📍 ' + esc(storeAddress) + '</div>' : '') +
        '</div>' +
        '<div class="rep-label-box">' +
            '<div class="lbl">گزارش تسلیم‌دهی</div>' +
            '<div class="num">' + esc(billNumber) + '</div>' +
        '</div>' +
    '</div>' +
    '<div class="rep-info">' +
        '<div class="rep-info-cell">' +
            '<div class="rep-info-label">شماره بل:</div>' +
            '<div class="rep-info-value">' + esc(billNumber) + '</div>' +
        '</div>' +
        '<div class="rep-info-cell">' +
            '<div class="rep-info-label">تاریخ فاکتور:</div>' +
            '<div class="rep-info-value">' + esc(saleDate) + '</div>' +
        '</div>' +
        '<div class="rep-info-cell">' +
            '<div class="rep-info-label">مشتری:</div>' +
            '<div class="rep-info-value">' + esc(customerName) + '</div>' +
        '</div>' +
        '<div class="rep-info-cell">' +
            '<div class="rep-info-label">مبلغ فاکتور:</div>' +
            '<div class="rep-info-value">' + fn(totalAmount) + ' ' + curFa + '</div>' +
        '</div>' +
        (notes ?
        '<div class="rep-info-cell" style="grid-column: span 2;border-left: none;">' +
            '<div class="rep-info-label">توضیحات فاکتور:</div>' +
            '<div class="rep-info-value" style="font-weight:500;font-size:12px;">' + esc(notes) + '</div>' +
        '</div>' : '') +
    '</div>' +
    itemsBreakdownPrintHtml +
    '<div class="rep-section-title">📋 تاریخچه تسلیم‌دهی</div>' +
    '<table class="rep-table">' +
        '<thead>' +
            '<tr>' +
                '<th style="width:36px;">#</th>' +
                '<th style="width:18%;">تاریخ و ساعت</th>' +
                '<th>اقلام تسلیم‌شده در این مرحله</th>' +
                '<th style="width:12%;">جمع مقدار</th>' +
                '<th style="width:20%;">اطلاعات بیشتر</th>' +
                '<th style="width:18%;">امضا و مهر</th>' +
            '</tr>' +
        '</thead>' +
        '<tbody>' + historyRowsHtml + '</tbody>' +
    '</table>' +
    '<div class="rep-total-box">' +
        '<span class="rep-total-label">مجموع مقادیر تسلیم‌شده:</span>' +
        '<span class="rep-total-value">' + totalDeliveredText + '</span>' +
    '</div>' +
    '<div class="rep-footer">' + esc(footerText) + '</div>' +
'</div>' +
'<button class="print-btn no-print" onclick="window.print()">🖨️ چاپ گزارش</button>' +
'</body></html>';
    }

    // =========================================================================
    // بخش ۱۳) Monkey-patch روی applyAdvancedFilter / globalSearch / applySort
    // =========================================================================
    function _hookFilterFunctions() {
        // ۱۳-۱) applyAdvancedFilter
        if (typeof window.applyAdvancedFilter === 'function' && !window.applyAdvancedFilter._jouyaDeliveryPatched) {
            var origAAF = window.applyAdvancedFilter;
            window.applyAdvancedFilter = function (section) {
                if (section === 'delivery-list') {
                    var rows = document.querySelectorAll('#delivery-list-table tbody tr');
                    var fromDate  = ((document.getElementById('filter-' + section + '-from') || {}).value || '').trim();
                    var toDate    = ((document.getElementById('filter-' + section + '-to')   || {}).value || '').trim();
                    var typeVal   = ((document.getElementById('filter-' + section + '-type') || {}).value || 'all');
                    var statusVal = ((document.getElementById('filter-' + section + '-status') || {}).value || 'all');
                    var personVal = (((document.getElementById('filter-' + section + '-customer') || {}).value) || '').toLowerCase().trim();
                    var searchEl  = document.getElementById('global-search-' + section);
                    var searchText = searchEl ? searchEl.value.toLowerCase().trim() : '';

                    rows.forEach(function (row) {
                        if (!row.cells || row.cells.length < 2) { row.style.display = ''; return; }
                        var rowDate   = (row.dataset.date   || '').trim();
                        var rowType   = (row.dataset.type   || '').trim();
                        var rowStatus = (row.dataset.status || '').trim();
                        var rowPerson = (row.dataset.person || '').toLowerCase().trim();
                        var rowText   = row.textContent.toLowerCase();

                        var show = true;
                        if (fromDate && rowDate && rowDate < fromDate) show = false;
                        if (toDate   && rowDate && rowDate > toDate)   show = false;
                        if (typeVal !== 'all' && typeVal !== '' && rowType !== typeVal) show = false;
                        if (statusVal !== 'all' && statusVal !== '' && rowStatus !== statusVal) show = false;
                        if (personVal && !rowPerson.includes(personVal) && !rowText.includes(personVal)) show = false;
                        if (searchText && !rowText.includes(searchText)) show = false;

                        row.style.display = show ? '' : 'none';
                    });

                    var menu = document.getElementById('filter-menu-' + section);
                    if (menu) menu.style.display = 'none';
                    return;
                }
                return origAAF.apply(this, arguments);
            };
            window.applyAdvancedFilter._jouyaDeliveryPatched = true;
        }

        // ۱۳-۲) globalSearch
        if (typeof window.globalSearch === 'function' && !window.globalSearch._jouyaDeliveryPatched) {
            var origGS = window.globalSearch;
            window.globalSearch = function (section) {
                if (section === 'delivery-list') {
                    var input = document.getElementById('global-search-' + section);
                    if (!input) return;
                    var query = input.value.toLowerCase();
                    var rows = document.querySelectorAll('#delivery-list-table tbody tr');
                    rows.forEach(function (row) {
                        if (!query) { row.style.display = ''; return; }
                        row.style.display = row.textContent.toLowerCase().includes(query) ? '' : 'none';
                    });
                    return;
                }
                return origGS.apply(this, arguments);
            };
            window.globalSearch._jouyaDeliveryPatched = true;
        }

        // ۱۳-۳) applySort
        if (typeof window.applySort === 'function' && !window.applySort._jouyaDeliveryPatched) {
            var origAS = window.applySort;
            window.applySort = function (section, criteria) {
                if (section === 'delivery-list') {
                    var table = document.getElementById('delivery-list-table');
                    if (!table) return;
                    var tbody = table.querySelector('tbody');
                    if (!tbody) return;
                    var rowsArr = Array.from(tbody.querySelectorAll('tr'));
                    if (rowsArr.length === 0) return;

                    var extractNum = function (text) {
                        if (!text) return 0;
                        var numStr = String(text).replace(/,/g, '').replace(/[^\d.-]/g, '');
                        var num = parseFloat(numStr);
                        return isNaN(num) ? 0 : num;
                    };
                    var amountCol = 4;

                    rowsArr.sort(function (a, b) {
                        var aDate = (a.dataset.date || ((a.cells[0] || {}).textContent || '').trim());
                        var bDate = (b.dataset.date || ((b.cells[0] || {}).textContent || '').trim());
                        var aAmount = parseFloat(a.dataset.amount) >= 0 ? parseFloat(a.dataset.amount) : extractNum((a.cells[amountCol] || {}).textContent);
                        var bAmount = parseFloat(b.dataset.amount) >= 0 ? parseFloat(b.dataset.amount) : extractNum((b.cells[amountCol] || {}).textContent);
                        switch (criteria) {
                            case 'date-desc':   return String(bDate).localeCompare(String(aDate));
                            case 'date-asc':    return String(aDate).localeCompare(String(bDate));
                            case 'amount-desc': return bAmount - aAmount;
                            case 'amount-asc':  return aAmount - bAmount;
                            default: return 0;
                        }
                    });
                    rowsArr.forEach(function (row) { tbody.appendChild(row); });

                    var sortMenu = document.getElementById('sort-menu-' + section);
                    if (sortMenu) sortMenu.style.display = 'none';
                    return;
                }
                return origAS.apply(this, arguments);
            };
            window.applySort._jouyaDeliveryPatched = true;
        }
    }

    // =========================================================================
    // بخش ۱۴) Monkey-patch روی showSection
    //          هنگام ورود به delivery-list یا delivery-form
    // =========================================================================
    function _hookShowSection() {
        if (typeof window.showSection !== 'function') return false;
        if (window.showSection._jouyaDeliveryPatched) return true;

        var orig = window.showSection;
        window.showSection = function (sectionId) {
            var result = orig.apply(this, arguments);

            if (sectionId === 'delivery-list') {
                try { window.loadDeliveriesList(); } catch (_) {}
                try {
                    var headerFilter = document.querySelector('#delivery-list .list-header-filter');
                    var titleH3 = headerFilter ? headerFilter.querySelector('.section-title-in-filter') : null;
                    if (titleH3) {
                        var backBtn = titleH3.querySelector('.btn-back-header');
                        Array.prototype.slice.call(titleH3.childNodes).forEach(function (n) {
                            if (n.nodeType === Node.TEXT_NODE) n.remove();
                        });
                        if (backBtn) backBtn.after(document.createTextNode(' لیست تسلیم‌دهی'));
                        else titleH3.appendChild(document.createTextNode('لیست تسلیم‌دهی'));
                    }
                    var pageTitle = document.getElementById('page-title');
                    if (pageTitle) pageTitle.textContent = 'لیست تسلیم‌دهی';
                } catch (_) {}
            } else if (sectionId === 'delivery-form') {
                try {
                    var pageTitle2 = document.getElementById('page-title');
                    if (pageTitle2) pageTitle2.textContent = 'فورم تسلیم‌دهی';
                } catch (_) {}
            }
            return result;
        };
        window.showSection._jouyaDeliveryPatched = true;
        return true;
    }

    // =========================================================================
    // بخش ۱۵) نصب کامل + retry logic
    // =========================================================================
    function _install() {
        _injectStyle();
        _injectListSection();
        _injectFormSection();
        _injectQuickListButton();
        _injectCheckbox();
        _hookSaveTransaction();
        _hookFilterFunctions();
        _hookShowSection();
    }

    function _onReady(fn) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(fn, 0);
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }

    _onReady(function () {
        _install();
        setTimeout(_install, 200);
        setTimeout(_install, 800);
        setTimeout(_install, 1800);
    });

    // اگر کاربر به sales-form رفت و چک‌باکس هنوز تزریق نشده بود (در صورت reset
    // پویای فورم یا تأخیر در DOM)، چک‌باکس را مجدداً تزریق کن
    document.addEventListener('sectionChanged', function (e) {
        try {
            var sid = e.detail && e.detail.sectionId;
            if (sid === 'sales-form') {
                setTimeout(_injectCheckbox, 50);
                setTimeout(_injectCheckbox, 300);
            }
        } catch (_) {}
    });

    console.log('%c✅ سیستم لیست تسلیم‌دهی فعال شد (مرحله ۱ + ۲: UI + فورم + جزئیات + گزارش)', 'color:#fff;background:#f97316;padding:5px;border-radius:4px;');
})();

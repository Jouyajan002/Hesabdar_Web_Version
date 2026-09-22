/* فایل دیتابیس اصلاح‌شده */
const DB_NAME = 'SalesInventorySystem';
const DB_VERSION = '2.0';

class Database {
    constructor() {
        this.init();
    }

// در کلاس Database، تابع init را اینگونه اصلاح کنید:
init() {
    try {
        this.createTables();

        // مهاجرت‌های ساختاریِ ارزی — همگی idempotent و غیرمخرب، پس اجرای مکرر
        // در هر بوت بی‌خطر است و داده‌های بازیابی‌شده از بکاپ را هم پوشش می‌دهد.
        try { this.migrateCashboxBalancesModel(); } catch (e) {}
        try { this.migrateProductCurrencyModel(); } catch (e) {}
        try { this.migrateTransactionRateModel(); } catch (e) {}

        // 👇 اضافه کردن این خط برای بازسازی و اصلاح خودکار موجودی دیتای قدیمی
        this.recalculateAllProductsStock(); 
        
        // this.initDefaultData(); // این خط را کامنت کنید یا حذف کنید
        this.updateDashboard();
        console.log('Database initialized successfully');
    } catch (e) {
        console.error('DB init error:', e);
    }
}

    createTables() {
        if (!localStorage.getItem('persons')) localStorage.setItem('persons', JSON.stringify([]));
        if (!localStorage.getItem('products')) localStorage.setItem('products', JSON.stringify([]));
        if (!localStorage.getItem('transactions')) localStorage.setItem('transactions', JSON.stringify([]));
        if (!localStorage.getItem('expenses')) localStorage.setItem('expenses', JSON.stringify([]));
        if (!localStorage.getItem('cashboxes')) {
            localStorage.setItem('cashboxes', JSON.stringify([]));
        }
        if (!localStorage.getItem('settings')) {
            const defaultSettings = {
                storeName: 'فروشگاه من',
                storePhone: '۰۷۸۰۰۰۰۰۰۰',
                storeAddress: 'کابل، افغانستان',
                storeOwner: 'مدیر سیستم',
                storeEmail: '',
                defaultCurrency: 'AFN',
                taxRate: 0,
                defaultCashboxId: null,
                lowStockAlert: 5,
                autoPrint: false,
                printCopies: 1,
                invoiceHeader: 'با تشکر از خرید شما',
                invoiceFooter: 'لطفاً کالاها را بررسی کنید\nگارانتی: ۷ روز',
                storeLogo: ''
            };
            localStorage.setItem('settings', JSON.stringify(defaultSettings));
        }
        if (!localStorage.getItem('backupHistory')) localStorage.setItem('backupHistory', JSON.stringify([]));
        if (!localStorage.getItem('dashboardStats')) localStorage.setItem('dashboardStats', JSON.stringify({}));
        // ===== گدام‌ها (انبارها) =====
        // گدام پیش‌فرض (گدام اصلی) — اجناس موجود بدون warehouseId به همین گدام تعلق دارند
        if (!localStorage.getItem('warehouses')) {
            localStorage.setItem('warehouses', JSON.stringify([
                { id: 'wh_main', name: 'گدام اصلی', createdAt: this.getCurrentDate() }
            ]));
        }
        if (!localStorage.getItem('activeWarehouseId')) {
            localStorage.setItem('activeWarehouseId', 'wh_main');
        }
        if (!localStorage.getItem('warehouseTransfers')) {
            localStorage.setItem('warehouseTransfers', JSON.stringify([]));
        }
    }

getCurrentDate() {
    try {
        const now = new Date();
        // فرمت دقیق افغانستان: ساعت ۱۲ ساعته + تاریخ شمسی/میلادی
        const hours = now.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const h12 = hours % 12 || 12;
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        
        // تاریخ میلادی
        const gYear = now.getFullYear();
        const gMonth = String(now.getMonth() + 1).padStart(2, '0');
        const gDay = String(now.getDate()).padStart(2, '0');
        const gregorian = `${gYear}/${gMonth}/${gDay} ${h12}:${mm}:${ss} ${ampm}`;
        
        // تاریخ شمسی (با fallback)
        if (typeof gregorianToJalali === 'function') {
            const j = gregorianToJalali(gYear, now.getMonth()+1, now.getDate());
            const jalali = `${j[0]}/${String(j[1]).padStart(2,'0')}/${String(j[2]).padStart(2,'0')} ${h12}:${mm}:${ss} ${ampm}`;
            return jalali; // اولویت شمسی
        }
        return gregorian;
    } catch (e) {
        return new Date().toISOString();
    }
}

    // ================ اشخاص ================
    // =========================================================================
    //  لایهٔ اتصال به موتورِ مرکزیِ ارز (CurrencySystem) — منبعِ واحدِ حقیقت
    //  -------------------------------------------------------------------------
    //  این چند متد «موتورِ جدید» نیستند؛ فقط پُلِ دفاعیِ database.js به موتورِ موجود
    //  در currency-system.js هستند تا اگر آن فایل هنوز بارگذاری نشده بود، رفتارِ
    //  قبلی دقیقاً حفظ شود و هیچ‌جا خطا ندهد.
    // =========================================================================

    // شناسهٔ یکتا و صعودی — جایگزینِ Date.now() خام.
    //  اصلاحِ باگِ داده: Date.now() در ثبتِ سریعِ دو سند در یک میلی‌ثانیه، idِ تکراری
    //  می‌ساخت؛ آنگاه نقشه‌های سود (saleMap) دو سند را با هم جمع می‌کردند و گزارش خراب
    //  می‌شد. این تابع تضمین می‌کند هر id از قبلی بزرگ‌تر و یکتاست، حتی در فراخوانیِ پیاپی.
    _nextId() {
        var now = Date.now();
        var last = this.__lastId || 0;
        var id = (now > last) ? now : (last + 1);
        this.__lastId = id;
        return id;
    }

    // ارزِ پایه — از تنظیمات (همان منبعی که CurrencySystem.getBaseCode می‌خواند).
    baseCurrency() {
        try {
            if (typeof window !== 'undefined' && window.CurrencySystem &&
                typeof CurrencySystem.getBaseCode === 'function') {
                var b = CurrencySystem.getBaseCode();
                if (b) return b;
            }
        } catch (e) {}
        try {
            var s = this.getSettings();
            if (s && s.defaultCurrency) return s.defaultCurrency;
        } catch (e) {}
        return 'AFN';
    }

    // گرد کردنِ استانداردِ مالی (مرحلهٔ ۸) — همیشه از موتورِ مرکزی؛ در نبودِ آن
    // همان فرمولِ epsilon تا اعدادِ ذخیره‌شده در هر دو حالت یکسان بمانند.
    _money(v, currencyCode) {
        var n = parseFloat(v);
        if (!isFinite(n)) return 0;
        try {
            if (typeof window !== 'undefined' && window.CurrencySystem &&
                typeof CurrencySystem.round === 'function') {
                var d = (typeof CurrencySystem.getDecimals === 'function')
                    ? CurrencySystem.getDecimals(currencyCode || this.baseCurrency()) : 2;
                return CurrencySystem.round(n, d);
            }
        } catch (e) {}
        var sign = (n < 0) ? -1 : 1, a = Math.abs(n) * 100;
        return sign * Math.round(a + (a * Number.EPSILON * 4) + Number.EPSILON) / 100;
    }

    // آیا این سند نرخِ ثبت‌شدهٔ معتبر برای ارزِ خودش دارد؟
    _hasValidRate(doc) {
        if (!doc) return false;
        var base = this.baseCurrency();
        var cur = doc.currency || base;
        if (cur === base) return true;
        try {
            if (typeof window !== 'undefined' && window.CurrencySystem &&
                typeof CurrencySystem.rateFromDoc === 'function') {
                var r = CurrencySystem.rateFromDoc(doc, cur);
                return (r != null && r > 0);
            }
        } catch (e) {}
        var snap = doc.exchangeRateSnapshot;
        if (snap && (parseFloat(snap.rate) || 0) > 0 && (snap.currency || cur) === cur) return true;
        if ((parseFloat(doc.rateUsed) || 0) > 0 && (doc.rateCurrency || doc.currency || base) === cur) return true;
        return false;
    }

    // ساختِ مُهرِ نرخِ لحظهٔ ثبت برای یک ارز. خروجیِ null یعنی برای این ارز نرخی
    // تعریف نشده؛ در آن حالت سند «بدونِ نرخ» ثبت و تخمینی علامت می‌خورد.
    _makeRateStamp(currency) {
        var base = this.baseCurrency();
        var cur = currency || base;
        if (cur === base) {
            return { base: base, currency: cur, rate: 1, mode: 'rate', capturedAt: this.getCurrentDate() };
        }
        try {
            if (typeof window !== 'undefined' && window.CurrencySystem &&
                typeof CurrencySystem.makeRateStamp === 'function') {
                return CurrencySystem.makeRateStamp(cur, 'rate', this.getCurrentDate());
            }
            if (typeof window !== 'undefined' && window.CurrencySystem &&
                typeof CurrencySystem.stampRate === 'function') {
                var r = CurrencySystem.stampRate(cur);
                if (r != null && r > 0) {
                    return { base: base, currency: cur, rate: r, mode: 'rate', capturedAt: this.getCurrentDate() };
                }
            }
        } catch (e) {}
        return null;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  قفلِ نرخِ تاریخیِ سند (Historical Rate Lock) — قلبِ «سودِ گذشته تکان نخورد»
    //  ----------------------------------------------------------------------
    //  تنها محلی که مُهرِ نرخ روی یک سند نوشته می‌شود. قواعد:
    //    • سندِ جدید            → مُهرِ نرخِ همین لحظه.
    //    • ویرایشِ سند با همان ارز → مُهرِ قبلی «حفظ» می‌شود؛ حتی اگر فورم نرخِ
    //      امروز را دوباره فرستاده باشد. (پیش‌تر یک ویرایشِ سادهٔ یادداشت روی بلِ
    //      دو ماه پیش، نرخِ آن سند را به نرخِ امروز پرش می‌داد و سودِ گذشته را
    //      تغییر می‌داد — همان چیزی که exchangeRateSnapshot قرار بود مانعش شود.)
    //    • تغییرِ ارزِ سند در ویرایش → مُهرِ قبلی بی‌اعتبار است، مُهرِ تازه زده می‌شود.
    //    • rateOverride === true → کاربر عمداً نرخ را اصلاح می‌کند، مُهرِ تازه.
    //    • نبودِ هر نرخِ معتبر    → rateEstimated = true (شفاف، نه فرضِ خاموشِ ۱).
    //  همچنین rateCurrency نوشته می‌شود تا rateUsed هرگز روی ارزِ دیگری اعمال نشود.
    // ══════════════════════════════════════════════════════════════════════
    _ensureTxRateStamp(doc, prevDoc) {
        try {
            if (!doc) return doc;
            var base = this.baseCurrency();
            var cur = doc.currency || base;
            doc.baseCurrency = base;

            var override = (doc.rateOverride === true);
            delete doc.rateOverride;

            // (۰) خواندنِ مُهرِ «معتبر» از یک سند. مُهری که ارزش با ارزِ فعلیِ سند
            //     نمی‌خواند بی‌اعتبار است — تا نرخِ دالر هرگز روی مبلغِ یورو ننشیند.
            var _stampOf = function (d) {
                if (!d) return null;
                var sn = d.exchangeRateSnapshot;
                if (sn && (parseFloat(sn.rate) || 0) > 0 && (sn.currency || d.currency || base) === cur) {
                    return {
                        base: sn.base || base, currency: cur, rate: parseFloat(sn.rate),
                        mode: sn.mode || 'rate', capturedAt: sn.capturedAt || null,
                        source: sn.source || undefined
                    };
                }
                var ru = parseFloat(d.rateUsed) || 0;
                if (ru > 0 && (d.rateCurrency || d.currency || base) === cur) {
                    return {
                        base: base, currency: cur, rate: ru, mode: 'rate',
                        capturedAt: d.createdAt || d.date || null
                    };
                }
                return null;
            };

            var prevStamp = override ? null : _stampOf(prevDoc);
            var ownStamp  = override ? null : _stampOf(doc);

            // (۱) نرخِ تاریخیِ سندِ قبلی همیشه مقدم است — قفلِ گذشته.
            var stamp = prevStamp || ownStamp;

            // (۲) نرخِ امروز فقط برای «سندِ جدید» یا «اصلاحِ عمدیِ کاربر» زده می‌شود.
            //     ویرایشِ یک سندِ قدیمیِ بی‌نرخ، نرخِ امروز را اختراع نمی‌کند.
            if (!stamp && (override || !prevDoc)) stamp = this._makeRateStamp(cur);

            // (۳) ارزِ پایه همیشه نرخِ قطعیِ ۱ دارد (واقعیت است، نه تخمین).
            if (!stamp && cur === base) stamp = this._makeRateStamp(base);

            if (stamp) {
                doc.exchangeRateSnapshot = stamp;
                doc.rateUsed = stamp.rate;
                doc.rateCurrency = cur;
                delete doc.rateEstimated;
            } else {
                // نه نرخِ تاریخی داریم و نه اجازهٔ اختراعِ نرخ — شفاف علامت می‌خورد.
                delete doc.exchangeRateSnapshot;
                delete doc.rateUsed;
                doc.rateCurrency = cur;
                doc.rateEstimated = true;
            }
            return doc;
        } catch (e) {
            console.error('خطا در مُهرِ نرخِ سند:', e);
            return doc;
        }
    }

    getPersons() {
        try {
            return JSON.parse(localStorage.getItem('persons') || '[]');
        } catch (e) {
            console.error('خطا در بارگذاری اشخاص:', e);
            return [];
        }
    }

    savePerson(personData) {
        try {
            const persons = this.getPersons();
            // اصلاح اسپرد: ...personData
            const person = { ...personData };

            // اعتبارسنجی
            if (!person.name || !person.category) {
                throw new Error('نام و کتگوری الزامی است');
            }

            if (person.id) {
                // ویرایش
                const index = persons.findIndex(p => p.id == person.id);
                if (index !== -1) {
                    persons[index] = { ...persons[index], ...person, updatedAt: this.getCurrentDate() };
                    localStorage.setItem('persons', JSON.stringify(persons));
                    console.log('شخص ویرایش شد:', persons[index]);
                    return { success: true, data: persons[index] };
                } else {
                    return { success: false, error: 'شخص یافت نشد' };
                }
            } else {
                // جدید
                person.id = this._nextId();
                person.createdAt = this.getCurrentDate();
                person.updatedAt = person.createdAt;
                persons.push(person);
                localStorage.setItem('persons', JSON.stringify(persons));
                console.log('شخص جدید ذخیره شد:', person);
                return { success: true, data: person };
            }
        } catch (error) {
            console.error('خطا در ذخیره شخص:', error);
            return { success: false, error: error.message };
        }
    }

    deletePerson(id) {
        try {
            const persons = this.getPersons();
            const filtered = persons.filter(p => p.id != id);
            localStorage.setItem('persons', JSON.stringify(filtered));
            return { success: true };
        } catch (error) {
            console.error('خطا در حذف شخص:', error);
            return { success: false, error: error.message };
        }
    }

    // ================ گدام‌ها (انبارها) ================
    // آرایهٔ کامل اجناس همهٔ گدام‌ها (بدون فیلتر) — برای عملیات موجودی و انتقال
    _getProductsRaw() {
        try {
            var arr = JSON.parse(localStorage.getItem('products') || '[]');
            if (!Array.isArray(arr)) return [];
            // یک‌بار در هر بارگذاری: رفعِ «شناسه‌های تکراریِ اجناس». علت: در ورودِ انبوهِ اکسل،
            // شناسه با Date.now() ساخته می‌شد و برای صدها جنس یکسان می‌گشت؛ در نتیجه هنگام ویرایش،
            // findById جنسِ اشتباه (اولین با همان id) را باز می‌کرد. اینجا تنها شناسه‌های تکراری/خالی
            // به شناسهٔ یکتا تغییر می‌کنند (اولین موردِ هر id دست‌نخورده می‌ماند).
            if (!this._prodDedupDone) {
                this._prodDedupDone = true;
                var seen = {}, dup = false, maxId = 0, i, n;
                for (i = 0; i < arr.length; i++) {
                    n = parseInt(arr[i] && arr[i].id, 10);
                    if (!isNaN(n) && n > maxId) maxId = n;
                }
                for (i = 0; i < arr.length; i++) {
                    if (!arr[i]) continue;
                    var idv = arr[i].id;
                    var key = String(idv);
                    if (idv === undefined || idv === null || idv === '' || seen[key]) {
                        maxId += 1; arr[i].id = maxId; seen[String(maxId)] = true; dup = true;
                    } else {
                        seen[key] = true;
                    }
                }
                if (dup) { try { localStorage.setItem('products', JSON.stringify(arr)); console.log('[jouya] شناسه‌های تکراریِ اجناس اصلاح شد'); } catch (e) {} }
            }
            return arr;
        } catch (e) {
            console.error('خطا در بارگذاری اجناس:', e);
            return [];
        }
    }
    // همهٔ اجناس همهٔ گدام‌ها
    getAllProducts() { return this._getProductsRaw(); }

    getActiveWarehouseId() {
        return localStorage.getItem('activeWarehouseId') || 'wh_main';
    }
    setActiveWarehouseId(id) {
        try {
            localStorage.setItem('activeWarehouseId', id || 'wh_main');
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    }
    getWarehouses() {
        try {
            var list = JSON.parse(localStorage.getItem('warehouses') || '[]');
            if (!Array.isArray(list) || list.length === 0) {
                list = [{ id: 'wh_main', name: 'گدام اصلی', createdAt: this.getCurrentDate() }];
                localStorage.setItem('warehouses', JSON.stringify(list));
            }
            return list;
        } catch (e) {
            return [{ id: 'wh_main', name: 'گدام اصلی', createdAt: this.getCurrentDate() }];
        }
    }
    saveWarehouses(list) {
        try {
            localStorage.setItem('warehouses', JSON.stringify(list || []));
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    }
    addWarehouse(name) {
        try {
            var list = this.getWarehouses();
            var wh = {
                id: 'wh_' + Date.now(),
                name: (name && String(name).trim()) || ('گدام ' + (list.length + 1)),
                createdAt: this.getCurrentDate()
            };
            list.push(wh);
            this.saveWarehouses(list);
            return { success: true, data: wh };
        } catch (e) { return { success: false, error: e.message }; }
    }
    renameWarehouse(id, name) {
        try {
            var list = this.getWarehouses();
            var idx = list.findIndex(function (w) { return w.id == id; });
            if (idx === -1) return { success: false, error: 'گدام یافت نشد' };
            list[idx].name = (name && String(name).trim()) || list[idx].name;
            list[idx].updatedAt = this.getCurrentDate();
            this.saveWarehouses(list);
            return { success: true, data: list[idx] };
        } catch (e) { return { success: false, error: e.message }; }
    }
    deleteWarehouse(id) {
        try {
            var list = this.getWarehouses();
            if (list.length <= 1) return { success: false, error: 'حداقل یک گدام باید باقی بماند' };
            // حذف کامل اجناس این گدام
            var prods = this._getProductsRaw().filter(function (p) { return (p.warehouseId || 'wh_main') != id; });
            localStorage.setItem('products', JSON.stringify(prods));
            // حذف انتقال‌های مرتبط با این گدام
            try {
                var trs = this.getTransfers().filter(function (t) { return t.fromId != id && t.toId != id; });
                localStorage.setItem('warehouseTransfers', JSON.stringify(trs));
            } catch (e) {}
            // حذف خود گدام
            var remaining = list.filter(function (w) { return w.id != id; });
            this.saveWarehouses(remaining);
            // اگر گدام فعال حذف شد، به اولین گدام موجود سویچ کن
            if (this.getActiveWarehouseId() == id) {
                this.setActiveWarehouseId(remaining[0].id);
            }
            this.updateLowStockCount();
            return { success: true, activeId: this.getActiveWarehouseId() };
        } catch (e) { return { success: false, error: e.message }; }
    }
    // ===== انتقال میان گدام‌ها =====
    getTransfers() {
        try { return JSON.parse(localStorage.getItem('warehouseTransfers') || '[]'); }
        catch (e) { return []; }
    }
    saveTransfer(rec) {
        try {
            var list = this.getTransfers();
            rec.id = rec.id || Date.now();
            rec.createdAt = rec.createdAt || this.getCurrentDate();
            list.push(rec);
            localStorage.setItem('warehouseTransfers', JSON.stringify(list));
            return { success: true, data: rec };
        } catch (e) { return { success: false, error: e.message }; }
    }
    // حذفِ یک انتقالِ میان‌گدامی از رکوردِ خام. موجودی توسطِ rebuildAllDerivedData (که
    // انتقال‌ها را از صفر بازپخش می‌کند) دقیق بازمحاسبه می‌شود؛ اینجا فقط رکورد حذف می‌شود.
    deleteTransfer(id) {
        try {
            var list = this.getTransfers().filter(function (t) { return t.id != id; });
            localStorage.setItem('warehouseTransfers', JSON.stringify(list));
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    }
    // جایگزینیِ یک انتقالِ موجود با همان id (برای ویرایش). اگر id پیدا نشد، چیزی تغییر نمی‌کند.
    updateTransfer(rec) {
        try {
            var list = this.getTransfers();
            var idx = list.findIndex(function (t) { return t.id == rec.id; });
            if (idx === -1) return { success: false, error: 'انتقال یافت نشد' };
            rec.createdAt = rec.createdAt || list[idx].createdAt || this.getCurrentDate();
            list[idx] = rec;
            localStorage.setItem('warehouseTransfers', JSON.stringify(list));
            return { success: true, data: rec };
        } catch (e) { return { success: false, error: e.message }; }
    }
    // افزودن جنس به گدام مشخص (برای انتقال) — بدون وابستگی به گدام فعال
    addProductToWarehouse(productData, warehouseId) {
        try {
            var products = this._getProductsRaw();
            var product = Object.assign({}, productData);
            product.id = Date.now() + Math.floor(Math.random() * 100000);
            product.warehouseId = warehouseId || 'wh_main';
            product.createdAt = this.getCurrentDate();
            product.updatedAt = product.createdAt;
            product.stock = parseFloat(product.stock) || 0;
            product.minStock = product.minStock || 5;
            product.maxStock = product.maxStock || 100;
            products.push(product);
            localStorage.setItem('products', JSON.stringify(products));
            this.updateLowStockCount();
            return { success: true, data: product };
        } catch (e) { return { success: false, error: e.message }; }
    }
    // تغییر موجودی یک جنس مشخص با شناسه (روی آرایهٔ کامل، با مقدار علامت‌دار) — برای انتقال
    adjustProductStockById(productId, deltaQty) {
        try {
            var products = this._getProductsRaw();
            var idx = products.findIndex(function (p) { return p.id == productId; });
            if (idx === -1) return { success: false, error: 'جنس یافت نشد' };
            products[idx].stock = (parseFloat(products[idx].stock) || 0) + (parseFloat(deltaQty) || 0);
            products[idx].updatedAt = this.getCurrentDate();
            localStorage.setItem('products', JSON.stringify(products));
            this.updateLowStockCount();
            return { success: true, data: products[idx] };
        } catch (e) { return { success: false, error: e.message }; }
    }

    // ================ اجناس ================
    // اجناس گدام فعال (سایر بخش‌ها، لیست، و انتخابگرها از همین استفاده می‌کنند)
    getProducts() {
        try {
            var wid = this.getActiveWarehouseId();
            return this._getProductsRaw().filter(function (p) { return (p.warehouseId || 'wh_main') === wid; });
        } catch (e) {
            console.error('خطا در بارگذاری اجناس:', e);
            return [];
        }
    }

    saveProduct(productData) {
        try {
            const products = this._getProductsRaw();
            const product = { ...productData };

            if (!product.name || !product.unit) {
                throw new Error('نام و واحد اجباری هستند');
            }

            if (product.id) {
                const index = products.findIndex(p => p.id == product.id);
                if (index !== -1) {
                    const oldStock = parseFloat(products[index].stock) || 0;
                    // مبنای خالصِ ورودی/خروجی: موجودی اولیهٔ قبلیِ همین جنس
                    // (اگر ثبت نشده باشد، از موجودی فعلی استفاده می‌شود تا خالص = صفر گردد)
                    const oldInitial = (products[index].initialStock !== undefined && products[index].initialStock !== null)
                        ? (parseFloat(products[index].initialStock) || 0)
                        : oldStock;
                    let newStock;
                    if (product.stock !== undefined && product.stock !== null) {
                        // موجودیِ صریح ارسال‌شده (مثلاً ادغام اکسل، یا حفظِ موجودی هنگام به‌روزرسانیِ
                        // سایر فیلدها مانند تاریخ انقضاء) — مستقیماً استفاده می‌شود.
                        newStock = parseFloat(product.stock) || 0;
                    } else if (product.initialStock !== undefined && product.initialStock !== null) {
                        // ویرایش موجودی اولیه: موجودی فعلی = موجودی اولیهٔ جدید + خالصِ ورودی/خروجی
                        // (خالصِ ورودی/خروجی = موجودی فعلیِ قبلی − موجودی اولیهٔ قبلی؛ دقیقاً همان مبنای
                        // کارت ورود/خروج جنس) تا با خرید/فروش/انتقال/برگشت هماهنگ و دقیق بماند.
                        newStock = (parseFloat(product.initialStock) || 0) + (oldStock - oldInitial);
                    } else {
                        newStock = oldStock;
                    }
                    products[index] = { ...products[index], ...product, stock: newStock, updatedAt: this.getCurrentDate() };
                    localStorage.setItem('products', JSON.stringify(products));
                    console.log('جنس ویرایش شد:', products[index]);
                    this.updateLowStockCount();
                    return { success: true, data: products[index] };
                } else {
                    return { success: false, error: 'جنس یافت نشد' };
                }
            } else {
                // شناسهٔ یکتا: بزرگ‌تر از هر شناسهٔ موجود. رفعِ تکرارِ ID هنگام ورودِ انبوهِ اکسل که
                // Date.now() برای چند صد جنس یکسان می‌شد و ویرایش، جنسِ اشتباه را باز می‌کرد.
                var _newId = Date.now();
                for (var _pi = 0; _pi < products.length; _pi++) {
                    var _eid = parseInt(products[_pi] && products[_pi].id, 10);
                    if (!isNaN(_eid) && _eid >= _newId) _newId = _eid + 1;
                }
                product.id = _newId;
                product.createdAt = this.getCurrentDate();
                product.updatedAt = product.createdAt;
                product.warehouseId = product.warehouseId || this.getActiveWarehouseId();
                product.stock = product.initialStock || 0;
                product.minStock = product.minStock || 5;
                product.maxStock = product.maxStock || 100;
                products.push(product);
                localStorage.setItem('products', JSON.stringify(products));
                console.log('جنس جدید ذخیره شد:', product);
                this.updateLowStockCount();
                return { success: true, data: product };
            }
        } catch (error) {
            console.error('خطا در ذخیره جنس:', error);
            return { success: false, error: error.message };
        }
    }

    updateProductStock(productId, quantity, type = 'out') {
        try {
            const products = this._getProductsRaw();
            const index = products.findIndex(p => p.id == productId);
            if (index !== -1) {
                if (type === 'in') products[index].stock += quantity;
                else products[index].stock -= quantity;
                // اجازه دادن موجودی منفی (به درخواست کاربر) — موجودی به‌صورت بدهی انبار نمایش داده می‌شود
                products[index].updatedAt = this.getCurrentDate();
                localStorage.setItem('products', JSON.stringify(products));
                this.updateLowStockCount();
                return { success: true, data: products[index] };
            }
            return { success: false, error: 'جنس یافت نشد' };
        } catch (error) {
            console.error('خطا در به‌روزرسانی موجودی:', error);
            return { success: false, error: error.message };
        }
    }

    // به‌روزرسانی قیمت خرید واقعی جنس از روی آیتم‌های یک فاکتور خرید.
    // - فقط آیتم‌هایی که قیمت بزرگ‌تر از صفر دارند اعمال می‌شوند (آخرین خرید معتبر است).
    // - فقط واحد ارزی همان فاکتور به‌روزرسانی می‌شود (AFN یا USD).
    // - برای آیتم‌های واحد فرعی، قیمت به واحد اصلی تبدیل می‌شود (قیمت × ضریب تبدیل).
    // هدف: محاسبهٔ سود و سرمایه همیشه بر مبنای «قیمت خرید واقعی» باشد و فروش کسری پس از خرید
    // به‌طور خودکار اصلاح شود، بدون دوباره‌شماری سود.
    _applyPurchasePriceFromItems(items, currency) {
        try {
            if (!Array.isArray(items) || items.length === 0) return;
            var products = this._getProductsRaw();
            var cur = currency || this.baseCurrency();
            var changed = false;
            var self = this;
            items.forEach(function(it) {
                if (!it || it.productId == null) return;
                var price = parseFloat(it.price) || 0;
                if (price <= 0) return;
                var unitPrice = price;
                if (it.unitType === 'secondary') {
                    var f = parseFloat(it.secondaryFactor) || 0;
                    if (f > 0) unitPrice = price * f;
                }
                var idx = products.findIndex(function(p) { return p.id == it.productId; });
                if (idx === -1) return;

                // ===== سازگاریِ کاملِ عقب‌رو با مدلِ دوتاییِ قبلی (AFN/USD) =====
                // نگه‌داشتن «قیمت خریدِ موجودی اولیه» پیش از نخستین بازنویسی توسط خرید — برای
                // محاسبهٔ مفاد به روش سری خرید (FIFO): سری اولِ موجودی باید قیمت خرید خودش را
                // حفظ کند و با قیمتِ خریدهای بعدی بازنویسی نشود. (بدون تغییر نسبت به قبل)
                if (products[idx]._batchInitialCostAFN === undefined || products[idx]._batchInitialCostAFN === null) {
                    products[idx]._batchInitialCostAFN = parseFloat(products[idx].purchasePriceAFN) || 0;
                    products[idx]._batchInitialCostUSD = parseFloat(products[idx].purchasePriceUSD) || 0;
                }

                // ===== مدلِ عمومیِ چند-ارزی (ارز پایه + ارزهای فرعی) =====
                // نقشهٔ قیمت خرید و قیمتِ موجودی اولیه، به تفکیکِ هر ارز. سازگار با هر تعداد ارز.
                self._ensureProductPriceModel(products[idx]);
                // «قیمت خریدِ موجودی اولیهٔ همین ارز» را پیش از نخستین بازنویسیِ همان ارز نگه دار.
                if (products[idx]._batchInitialCosts[cur] === undefined || products[idx]._batchInitialCosts[cur] === null) {
                    products[idx]._batchInitialCosts[cur] = self.getPurchasePrice(products[idx], cur);
                }
                // ثبتِ قیمت خرید واقعیِ همین ارز در نقشهٔ چند-ارزی.
                products[idx].purchasePrices[cur] = self._money(unitPrice, cur);
                unitPrice = products[idx].purchasePrices[cur];

                // آینه‌سازیِ جفت‌ارزِ پایهٔ قبلی برای سازگاری با کدِ موجود (FIFO/مفاد/نمایش فعلی).
                if (cur === 'USD') products[idx].purchasePriceUSD = unitPrice;
                else if (cur === 'AFN') products[idx].purchasePriceAFN = unitPrice;

                products[idx].updatedAt = self.getCurrentDate();
                changed = true;
            });
            if (changed) {
                localStorage.setItem('products', JSON.stringify(products));
                this.updateLowStockCount();
            }
        } catch (error) {
            console.error('خطا در به‌روزرسانی قیمت خرید جنس:', error);
        }
    }

    // =========================================================================
    // مرحلهٔ ۱ — مدلِ قیمت‌گذاریِ چند-ارزی (ارز پایه + ارزهای فرعی)
    // -------------------------------------------------------------------------
    // این بخش «منطقِ دیتابیس بر اساسِ ارز پایه و ارزهای فرعی» است. کاملاً غیرمخرب و
    // سازگارِ عقب‌رو: فیلدهای دوتاییِ قبلی (purchasePriceAFN/USD و _batchInitialCostAFN/USD)
    // همچنان به‌عنوان «آینه» نگه داشته می‌شوند تا کدِ فعلی بدونِ هیچ تغییری کار کند؛ در کنارِ
    // آن‌ها دو نقشهٔ عمومی افزوده می‌شود:
    //   • purchasePrices      : { AFN: x, USD: y, IRT: z, ... }  ← قیمت خریدِ واقعیِ هر ارز
    //   • _batchInitialCosts  : { AFN: x, USD: y, ... }          ← قیمت خریدِ موجودی اولیهٔ هر ارز
    // مرحله‌های بعد (موتور FIFO/مفاد، فورم‌ها، داشبورد، گزارش‌ها) از این نقشه‌ها می‌خوانند.
    // =========================================================================

    // اطمینان از وجودِ مدلِ چند-ارزی روی یک جنس (Backfill از فیلدهای دوتاییِ قدیمی).
    _ensureProductPriceModel(product) {
        if (!product) return product;
        if (!product.purchasePrices || typeof product.purchasePrices !== 'object' || Array.isArray(product.purchasePrices)) {
            product.purchasePrices = {};
            var a = parseFloat(product.purchasePriceAFN);
            var u = parseFloat(product.purchasePriceUSD);
            if (!isNaN(a)) product.purchasePrices.AFN = a;
            if (!isNaN(u)) product.purchasePrices.USD = u;
        }
        if (!product._batchInitialCosts || typeof product._batchInitialCosts !== 'object' || Array.isArray(product._batchInitialCosts)) {
            product._batchInitialCosts = {};
            var ba = parseFloat(product._batchInitialCostAFN);
            var bu = parseFloat(product._batchInitialCostUSD);
            if (!isNaN(ba)) product._batchInitialCosts.AFN = ba;
            if (!isNaN(bu)) product._batchInitialCosts.USD = bu;
        }
        // نقشهٔ قیمتِ فروشِ چند-ارزی (هم‌سبک با purchasePrices)
        if (!product.salePrices || typeof product.salePrices !== 'object' || Array.isArray(product.salePrices)) {
            product.salePrices = {};
            var sa = parseFloat(product.salePriceAFN);
            var su = parseFloat(product.salePriceUSD);
            if (!isNaN(sa)) product.salePrices.AFN = sa;
            if (!isNaN(su)) product.salePrices.USD = su;
        }
        // نقشه‌های واحدِ فرعی
        if (!product.secondaryPurchasePrices || typeof product.secondaryPurchasePrices !== 'object' || Array.isArray(product.secondaryPurchasePrices)) {
            product.secondaryPurchasePrices = {};
            var spa = parseFloat(product.secondaryPurchasePriceAFN);
            var spu = parseFloat(product.secondaryPurchasePriceUSD);
            if (!isNaN(spa)) product.secondaryPurchasePrices.AFN = spa;
            if (!isNaN(spu)) product.secondaryPurchasePrices.USD = spu;
        }
        if (!product.secondarySalePrices || typeof product.secondarySalePrices !== 'object' || Array.isArray(product.secondarySalePrices)) {
            product.secondarySalePrices = {};
            var ssa = parseFloat(product.secondarySalePriceAFN);
            var ssu = parseFloat(product.secondarySalePriceUSD);
            if (!isNaN(ssa)) product.secondarySalePrices.AFN = ssa;
            if (!isNaN(ssu)) product.secondarySalePrices.USD = ssu;
        }
        return product;
    }

    // خواندنِ قیمت فروشِ یک جنس برای یک ارزِ مشخص (Fallback به فیلدهای دوتاییِ قدیمی).
    getSalePrice(product, currencyCode) {
        if (!product) return 0;
        var code = currencyCode || this.baseCurrency();
        if (product.salePrices && product.salePrices[code] !== undefined && product.salePrices[code] !== null) {
            var _d = parseFloat(product.salePrices[code]);
            if (!isNaN(_d) && _d > 0) return _d;
        }
        if (code === 'AFN' && parseFloat(product.salePriceAFN) > 0) return parseFloat(product.salePriceAFN);
        if (code === 'USD' && parseFloat(product.salePriceUSD) > 0) return parseFloat(product.salePriceUSD);
        // تبدیل از هر ارزی که این جنس قیمتِ فروش دارد (به‌جای صفر)
        return this._convertProductPrice(product.salePrices, product.salePriceAFN, product.salePriceUSD, code);
    }

    // خواندنِ قیمتِ واحدِ فرعی (خرید/فروش) برای یک ارز.
    getSecondaryPrice(product, currencyCode, kind) {
        if (!product) return 0;
        var code = currencyCode || this.baseCurrency();
        var map = (kind === 'sale') ? product.secondarySalePrices : product.secondaryPurchasePrices;
        if (map && map[code] !== undefined && map[code] !== null) {
            var _d = parseFloat(map[code]);
            if (!isNaN(_d) && _d > 0) return _d;
        }
        var _lgAFN, _lgUSD;
        if (kind === 'sale') {
            _lgAFN = product.secondarySalePriceAFN; _lgUSD = product.secondarySalePriceUSD;
            if (code === 'AFN' && parseFloat(_lgAFN) > 0) return parseFloat(_lgAFN);
            if (code === 'USD' && parseFloat(_lgUSD) > 0) return parseFloat(_lgUSD);
        } else {
            _lgAFN = product.secondaryPurchasePriceAFN; _lgUSD = product.secondaryPurchasePriceUSD;
            if (code === 'AFN' && parseFloat(_lgAFN) > 0) return parseFloat(_lgAFN);
            if (code === 'USD' && parseFloat(_lgUSD) > 0) return parseFloat(_lgUSD);
        }
        // تبدیل از هر ارزی که این جنس قیمتِ فرعیِ همین نوع دارد (به‌جای صفر)
        return this._convertProductPrice(map, _lgAFN, _lgUSD, code);
    }

    // نوشتنِ قیمت یک جنس در یک ارز (نقشه + آینهٔ فیلدهای قدیمیِ AFN/USD).
    //   kind: 'purchase' | 'sale' ، unitType: 'primary' | 'secondary'
    setProductPrice(product, currencyCode, value, kind, unitType) {
        if (!product) return product;
        this._ensureProductPriceModel(product);
        var code = currencyCode || this.baseCurrency();
        var v = parseFloat(value);
        if (isNaN(v)) v = 0;
        var isSale = (kind === 'sale');
        var isSec  = (unitType === 'secondary');
        var map = isSec ? (isSale ? product.secondarySalePrices : product.secondaryPurchasePrices)
                        : (isSale ? product.salePrices : product.purchasePrices);
        map[code] = v;
        // آینهٔ سازگاریِ عقب‌رو برای AFN/USD
        if (code === 'AFN' || code === 'USD') {
            var sfx = code;
            if (isSec) {
                if (isSale) product['secondarySalePrice' + sfx] = v;
                else product['secondaryPurchasePrice' + sfx] = v;
            } else {
                if (isSale) product['salePrice' + sfx] = v;
                else product['purchasePrice' + sfx] = v;
            }
        }
        return product;
    }

    // خواندنِ قیمت خریدِ یک جنس برای یک ارزِ مشخص (با Fallback به فیلدهای دوتاییِ قدیمی).
    getPurchasePrice(product, currencyCode) {
        if (!product) return 0;
        var code = currencyCode || this.baseCurrency();
        // ۱) قیمتِ صریحِ همان ارز
        if (product.purchasePrices && product.purchasePrices[code] !== undefined && product.purchasePrices[code] !== null) {
            var _direct = parseFloat(product.purchasePrices[code]);
            if (!isNaN(_direct) && _direct > 0) return _direct;
        }
        if (code === 'AFN' && parseFloat(product.purchasePriceAFN) > 0) return parseFloat(product.purchasePriceAFN);
        if (code === 'USD' && parseFloat(product.purchasePriceUSD) > 0) return parseFloat(product.purchasePriceUSD);
        // ۲) اگر قیمتِ این ارز نبود: از «هر ارزی که این جنس در آن قیمت دارد» تبدیل کن
        //    (باگِ اصلیِ چند-ارزی: قبلاً ۰ برمی‌گشت و بهای تمام‌شده صفر می‌شد).
        return this._convertProductPrice(product.purchasePrices, product.purchasePriceAFN, product.purchasePriceUSD, code);
    }

    // تبدیلِ قیمتِ یک جنس از هر ارزِ موجود به ارزِ درخواستی، با نرخِ فعلیِ CurrencySystem.
    // اولویت: ارزِ پایه → سپس هر ارزِ دیگری که قیمتِ مثبت دارد. اگر تبدیل ممکن نبود، ۰.
    _convertProductPrice(priceMap, legacyAFN, legacyUSD, targetCode) {
        try {
            var _map = {};
            if (priceMap && typeof priceMap === 'object' && !Array.isArray(priceMap)) {
                Object.keys(priceMap).forEach(function (c) { var v = parseFloat(priceMap[c]); if (v > 0) _map[c] = v; });
            }
            if (!_map.AFN && parseFloat(legacyAFN) > 0) _map.AFN = parseFloat(legacyAFN);
            if (!_map.USD && parseFloat(legacyUSD) > 0) _map.USD = parseFloat(legacyUSD);
            var codes = Object.keys(_map);
            if (!codes.length) return 0;
            if (typeof CurrencySystem === 'undefined' || !CurrencySystem.convert) {
                // بدونِ موتورِ ارز نمی‌توان تبدیل کرد؛ همان اولین مقدار (بدونِ تبدیل) بهتر از صفر نیست،
                // اما برای جلوگیری از خطای بزرگ، ۰ برمی‌گردانیم تا محاسبه علامت‌دار بماند.
                return 0;
            }
            // اولویت با ارزِ پایه
            var base = this.baseCurrency();
            var order = [];
            if (_map[base] != null) order.push(base);
            codes.forEach(function (c) { if (c !== base) order.push(c); });
            for (var i = 0; i < order.length; i++) {
                var from = order[i];
                var conv = CurrencySystem.convert(_map[from], from, targetCode, 'rate');
                if (conv != null && !isNaN(conv)) return Math.round((conv + Number.EPSILON) * 100) / 100;
            }
            return 0;
        } catch (e) { return 0; }
    }

    // خواندنِ قیمت خریدِ «موجودی اولیه» برای یک ارز (برای موتور FIFO در مرحلهٔ بعد).
    getBatchInitialCost(product, currencyCode) {
        if (!product) return 0;
        var code = currencyCode || this.baseCurrency();
        if (product._batchInitialCosts && product._batchInitialCosts[code] !== undefined && product._batchInitialCosts[code] !== null) {
            return parseFloat(product._batchInitialCosts[code]) || 0;
        }
        if (code === 'AFN') return parseFloat(product._batchInitialCostAFN) || 0;
        if (code === 'USD') return parseFloat(product._batchInitialCostUSD) || 0;
        return 0;
    }

    // مهاجرتِ یک‌بارهٔ همهٔ اجناسِ موجود به مدلِ چند-ارزی (غیرمخرب و بی‌خطر برای اجرای مکرر).
    // این متد در بارگذاریِ برنامه فراخوانی می‌شود تا رکوردهای قدیمی نقشهٔ ارزی بگیرند.
    migrateProductCurrencyModel() {
        try {
            var products = this._getProductsRaw();
            if (!Array.isArray(products) || products.length === 0) return { success: true, migrated: false };
            var changed = false;
            var self = this;
            products.forEach(function(p) {
                var hadPP = !!(p.purchasePrices && typeof p.purchasePrices === 'object' && !Array.isArray(p.purchasePrices));
                var hadBI = !!(p._batchInitialCosts && typeof p._batchInitialCosts === 'object' && !Array.isArray(p._batchInitialCosts));
                var hadSP = !!(p.salePrices && typeof p.salePrices === 'object' && !Array.isArray(p.salePrices));
                if (!hadSP) changed = true;
                self._ensureProductPriceModel(p);
                if (!hadPP || !hadBI) changed = true;
                // تکمیلِ نگاشتِ «بهای موجودیِ اولیه» برای هر ارزی که قیمتِ خرید دارد ولی
                // بهای سریِ اول برایش ثبت نشده. بدونِ این، موتورِ FIFO برای ارزهای سوم به
                // بعد سریِ اول را بی‌بها می‌دید و کلِ مبلغِ فروش را «مفاد» حساب می‌کرد.
                // idempotent: فقط کلیدهای غایب پر می‌شوند و مقادیرِ موجود دست نمی‌خورند.
                try {
                    if (p.purchasePrices && typeof p.purchasePrices === 'object') {
                        Object.keys(p.purchasePrices).forEach(function (code) {
                            if (p._batchInitialCosts[code] === undefined || p._batchInitialCosts[code] === null) {
                                var v = parseFloat(p.purchasePrices[code]);
                                if (!isNaN(v)) { p._batchInitialCosts[code] = v; changed = true; }
                            }
                        });
                    }
                } catch (e) {}
            });
            if (changed) localStorage.setItem('products', JSON.stringify(products));
            return { success: true, migrated: changed };
        } catch (e) {
            console.error('خطا در مهاجرتِ مدلِ ارزیِ اجناس:', e);
            return { success: false, error: e.message };
        }
    }

    deleteProduct(id) {
        try {
            const products = this._getProductsRaw();
            const filtered = products.filter(p => p.id != id);
            localStorage.setItem('products', JSON.stringify(filtered));
            this.updateLowStockCount();
            return { success: true };
        } catch (error) {
            console.error('خطا در حذف جنس:', error);
            return { success: false, error: error.message };
        }
    }

    // ================ معاملات ================
    getTransactions() {
        try {
            return JSON.parse(localStorage.getItem('transactions') || '[]');
        } catch (e) {
            console.error('خطا در بارگذاری معاملات:', e);
            return [];
        }
    }

    saveTransaction(transaction) {
        try {
            const transactions = this.getTransactions();
            const tx = { ...transaction };
            if (!tx.type) throw new Error('نوع تراکنش مشخص نیست');
            var _self = this;

            // محاسبه اثر یک تراکنش روی موجودی صندوق:
            // - فروش/دریافت: ورودی (in)
            // - خرید/پرداخت: خروجی (out)
            // - برگشت فروش: خروجی، برگشت خرید: ورودی
            // مبلغ برای فروش/خرید فقط مبلغ نقدی واقعی (cashAfn/cashUsd یا paidAfn/paidUsd) است.
            // تشخیصِ مبلغِ نقدیِ یک تراکنش برای هر ارز — پویا (بدونِ هاردکدِ AFN/USD).
            //   منبعِ اول: نگاشتِ پویا (cashAmounts/paidAmounts = { [کد ارز]: مبلغ })
            //   منبعِ دومِ سازگارِ عقب‌رو: فیلدهای قدیمی cashAfn/cashUsd/cashForeign و
            //   paidAfn/paidUsd/paidForeign تا داده و فرم‌های موجود دقیقاً مثل قبل کار کنند.
            var _cashPaidFor = function(t, kind) {
                var cur = t.currency || _self.baseCurrency();
                var mapKey = (kind === 'paid') ? 'paidAmounts' : 'cashAmounts';
                if (t[mapKey] && typeof t[mapKey] === 'object' && t[mapKey][cur] != null) {
                    return parseFloat(t[mapKey][cur]) || 0;
                }
                // سازگارِ عقب‌رو (همان رفتارِ قبلی برای AFN/USD؛ و *Foreign برای بقیه)
                if (kind === 'paid') {
                    if (cur === 'USD') return parseFloat(t.paidUsd) || parseFloat(t.cashUsd) || 0;
                    if (cur === 'AFN') return parseFloat(t.paidAfn) || parseFloat(t.cashAfn) || 0;
                    return parseFloat(t.paidForeign) || 0;
                } else {
                    if (cur === 'USD') return parseFloat(t.cashUsd) || 0;
                    if (cur === 'AFN') return parseFloat(t.cashAfn) || 0;
                    return parseFloat(t.cashForeign) || 0;
                }
            };
            var _cashboxEffect = function(t) {
                if (!t) return { amount: 0, dir: null, cur: 'AFN' };
                var cur = t.currency || _self.baseCurrency();
                var amt = 0, dir = null;
                if (t.type === 'فروش') {
                    amt = _cashPaidFor(t, 'cash');
                    dir = 'in';
                } else if (t.type === 'خرید') {
                    amt = _cashPaidFor(t, 'paid');
                    dir = 'out';
                } else if (t.type === 'دریافت') {
                    amt = parseFloat(t.amount) || 0;
                    dir = 'in';
                } else if (t.type === 'پرداخت') {
                    amt = parseFloat(t.amount) || 0;
                    dir = 'out';
                } else if (t.type === 'برگشت') {
                    // فقط بخشِ نقدیِ برگشت روی صندوق اثر می‌گذارد (بخشِ نسیه فقط حسابِ شخص را
                    // اصلاح می‌کند). سازگارِ عقب‌رو: اگر cashAmounts نداشت، کلِ مبلغ (رفتارِ قدیم).
                    amt = (t.cashAmounts != null) ? _cashPaidFor(t, 'cash') : (parseFloat(t.totalAmount || t.amount) || 0);
                    if (t.returnType === 'فروش') dir = 'out';
                    else if (t.returnType === 'خرید') dir = 'in';
                }
                return { amount: amt, dir: dir, cur: cur };
            };

            // محاسبهٔ مقدار معادل واحد اصلی برای موجودی (آیتم‌های واحد فرعی تبدیل می‌شوند)
            var _qtyForStock = function(it) {
                var q = parseFloat(it && it.quantity) || 0;
                if (it && it.unitType === 'secondary') {
                    var f = parseFloat(it.secondaryFactor) || 0;
                    if (f > 0) return q / f;
                }
                return q;
            };

            if (tx.id) {
                const idx = transactions.findIndex(t => t.id == tx.id);
                if (idx !== -1) {
                    // در حالت ویرایش: اثر تراکنش قدیم از صندوق قدیم برداشته شود
                    // و اثر تراکنش جدید روی صندوق جدید اعمال شود.
                    var _oldTx = transactions[idx];
                    var _merged = { ...transactions[idx], ...tx, updatedAt: this.getCurrentDate() };
                    // قفلِ نرخِ تاریخی: ویرایشِ سند نباید نرخِ ثبت‌شده‌اش را به نرخِ
                    // امروز پرش دهد. (تنها استثنا: تغییرِ ارزِ سند یا rateOverride)
                    this._ensureTxRateStamp(_merged, _oldTx);

                    var _oldEff = _cashboxEffect(_oldTx);
                    var _newEff = _cashboxEffect(_merged);

                    // معکوس کردن اثر قدیم از صندوق قدیم
                    if (_oldTx.cashboxId && _oldEff.amount > 0 && _oldEff.dir) {
                        var _revDir = _oldEff.dir === 'in' ? 'out' : 'in';
                        this.updateCashboxBalance(_oldTx.cashboxId, _oldEff.amount, _revDir, _oldEff.cur);
                    }
                    // اعمال اثر جدید روی صندوق جدید
                    if (_merged.cashboxId && _newEff.amount > 0 && _newEff.dir) {
                        this.updateCashboxBalance(_merged.cashboxId, _newEff.amount, _newEff.dir, _newEff.cur);
                    }

                    // ===== هماهنگ‌سازی موجودی انبار هنگام ویرایش =====
                    // اثر قدیمِ آیتم‌ها روی موجودی برگردانده می‌شود و اثر آیتم‌های جدید اعمال
                    // می‌گردد تا موجودی انبار همیشه دقیق و هماهنگ بماند (تغییر تعداد، تغییر جنس و …).
                    if (_oldTx.type === 'فروش' && Array.isArray(_oldTx.items)) {
                        _oldTx.items.forEach(it => this.updateProductStock(it.productId, _qtyForStock(it), 'in'));
                    } else if (_oldTx.type === 'خرید' && Array.isArray(_oldTx.items)) {
                        _oldTx.items.forEach(it => this.updateProductStock(it.productId, _qtyForStock(it), 'out'));
                    } else if (_oldTx.type === 'برگشت' && Array.isArray(_oldTx.items)) {
                        // معکوسِ اثرِ قدیمِ برگشت روی موجودی
                        _oldTx.items.forEach(it => {
                            if (it && it.isService) return;
                            if (_oldTx.returnType === 'فروش') this.updateProductStock(it.productId, _qtyForStock(it), 'out');
                            else if (_oldTx.returnType === 'خرید') this.updateProductStock(it.productId, _qtyForStock(it), 'in');
                        });
                    }
                    if (_merged.type === 'فروش' && Array.isArray(_merged.items)) {
                        _merged.items.forEach(it => this.updateProductStock(it.productId, _qtyForStock(it), 'out'));
                    } else if (_merged.type === 'خرید' && Array.isArray(_merged.items)) {
                        _merged.items.forEach(it => this.updateProductStock(it.productId, _qtyForStock(it), 'in'));
                    } else if (_merged.type === 'برگشت' && Array.isArray(_merged.items)) {
                        // اعمالِ اثرِ جدیدِ برگشت روی موجودی
                        _merged.items.forEach(it => {
                            if (it && it.isService) return;
                            if (_merged.returnType === 'فروش') this.updateProductStock(it.productId, _qtyForStock(it), 'in');
                            else if (_merged.returnType === 'خرید') this.updateProductStock(it.productId, _qtyForStock(it), 'out');
                        });
                    }
                    // به‌روزرسانی قیمت خرید واقعی جنس هنگام ویرایش خرید
                    if (_merged.type === 'خرید' && Array.isArray(_merged.items)) {
                        this._applyPurchasePriceFromItems(_merged.items, _merged.currency);
                    }

                    transactions[idx] = _merged;
                    localStorage.setItem('transactions', JSON.stringify(transactions));
                    return { success: true, data: transactions[idx] };
                } else {
                    return { success: false, error: 'تراکنش یافت نشد' };
                }
            } else {
                tx.id = this._nextId();
                tx.createdAt = this.getCurrentDate();
                // مُهرِ نرخِ لحظهٔ ثبت روی رکورد — تا گزارش‌های گذشته با تغییرِ نرخِ روز
                // در آینده دستکاری نشوند (قفلِ نرخِ تاریخیِ تراکنش). اکنون از مسیرِ
                // واحدِ _ensureTxRateStamp عبور می‌کند تا سند/ویرایش/مصرف یک منطق
                // داشته باشند و ارزِ نرخ (rateCurrency) هم روی سند ثبت شود.
                this._ensureTxRateStamp(tx, null);
                transactions.push(tx);
                localStorage.setItem('transactions', JSON.stringify(transactions));

                // اگر تراکنش فروش یا خرید است، موجودی را بروزرسانی کن
                // (تابع _qtyForStock در ابتدای saveTransaction تعریف شده و واحد فرعی را به اصلی تبدیل می‌کند)
                if (tx.type === 'فروش' && Array.isArray(tx.items)) {
                    tx.items.forEach(i => this.updateProductStock(i.productId, _qtyForStock(i), 'out'));
                } else if (tx.type === 'خرید' && Array.isArray(tx.items)) {
                    tx.items.forEach(i => this.updateProductStock(i.productId, _qtyForStock(i), 'in'));
                    // به‌روزرسانی قیمت خرید واقعی جنس از روی همین فاکتور خرید
                    this._applyPurchasePriceFromItems(tx.items, tx.currency);
                } else if (tx.type === 'برگشت' && Array.isArray(tx.items)) {
                    // برگشت از فروش: کالا دوباره به انبار وارد می‌شود (in).
                    // برگشت از خرید: کالا از انبار خارج می‌شود (out).
                    tx.items.forEach(i => {
                        if (i && i.isService) return;
                        if (tx.returnType === 'فروش') this.updateProductStock(i.productId, _qtyForStock(i), 'in');
                        else if (tx.returnType === 'خرید') this.updateProductStock(i.productId, _qtyForStock(i), 'out');
                    });
                }

                // بروزرسانی موجودی صندوق
                // برای فروش: فقط مبلغ دریافتی واقعی (cashAfn یا cashUsd) نه کل بل
                // برای خرید: فقط مبلغ پرداختی واقعی (paidAfn یا paidUsd) نه کل بل
                // برای دریافت/پرداخت: مبلغ کامل (tx.amount)
                if (tx.cashboxId) {
                    var _cur = tx.currency || this.baseCurrency();
                    var _paidForCashbox = 0;
                    if (tx.type === 'فروش') {
                        // فقط مبلغ دریافتی در همان بل فروش (پویا برای هر ارز)
                        _paidForCashbox = _cashPaidFor(tx, 'cash');
                        if (_paidForCashbox > 0) {
                            this.updateCashboxBalance(tx.cashboxId, _paidForCashbox, 'in', _cur);
                        }
                    } else if (tx.type === 'خرید') {
                        // فقط مبلغ پرداختی در همان بل خرید (پویا برای هر ارز)
                        _paidForCashbox = _cashPaidFor(tx, 'paid');
                        if (_paidForCashbox > 0) {
                            this.updateCashboxBalance(tx.cashboxId, _paidForCashbox, 'out', _cur);
                        }
                    } else if (tx.type === 'دریافت') {
                        var _recvAmt = parseFloat(tx.amount || 0);
                        if (_recvAmt > 0) this.updateCashboxBalance(tx.cashboxId, _recvAmt, 'in', _cur);
                    } else if (tx.type === 'پرداخت') {
                        var _payAmt = parseFloat(tx.amount || 0);
                        if (_payAmt > 0) this.updateCashboxBalance(tx.cashboxId, _payAmt, 'out', _cur);
                    } else if (tx.type === 'برگشت') {
                        // فقط بخشِ نقدیِ برگشت روی صندوق اثر می‌گذارد (بخشِ نسیه فقط حسابِ شخص).
                        // سازگارِ عقب‌رو: بدونِ cashAmounts، کلِ مبلغ (رفتارِ قدیم).
                        var _retAmt = (tx.cashAmounts != null) ? _cashPaidFor(tx, 'cash') : parseFloat(tx.totalAmount || tx.amount || 0);
                        if (_retAmt > 0) {
                            if (tx.returnType === 'فروش') {
                                this.updateCashboxBalance(tx.cashboxId, _retAmt, 'out', _cur);
                            } else if (tx.returnType === 'خرید') {
                                this.updateCashboxBalance(tx.cashboxId, _retAmt, 'in', _cur);
                            }
                        }
                    } else if (tx.type === 'صرافی') {
                        // تبدیلِ واقعیِ ارز بین دو ارز در یک صندوق: خروج از یک ارز، ورود به ارزِ دیگر.
                        // فیلدها: fromCurrency, fromAmount, toCurrency, toAmount (، rateUsed اختیاری)
                        var _fromCur = tx.fromCurrency || _cur;
                        var _toCur   = tx.toCurrency   || _cur;
                        var _fromAmt = parseFloat(tx.fromAmount || 0);
                        var _toAmt   = parseFloat(tx.toAmount   || 0);
                        if (_fromAmt > 0) this.updateCashboxBalance(tx.cashboxId, _fromAmt, 'out', _fromCur);
                        if (_toAmt   > 0) this.updateCashboxBalance(tx.cashboxId, _toAmt,   'in',  _toCur);
                        // نرخِ واقعیِ تحقق‌یافتهٔ همین صرافی روی سند ثبت می‌شود
                        // (پایهٔ محاسبهٔ «سود/زیانِ تسعیرِ تحقق‌یافته» در گزارش‌ها).
                        if (_fromAmt > 0 && _toAmt > 0 && tx.realizedRate == null) {
                            // نرخ در همان قراردادِ سیستم ثبت می‌شود: «۱ واحدِ ارزِ
                            // غیرپایه = N واحدِ ارزِ پایه» — تا با baseRate یکسان باشد.
                            var _bcur = this.baseCurrency();
                            tx.realizedFrom = _fromCur;
                            tx.realizedTo   = _toCur;
                            if (_fromCur === _bcur && _toCur !== _bcur) {
                                tx.realizedRate = this._money(_fromAmt / _toAmt, _bcur);
                                tx.realizedCurrency = _toCur;
                                tx.realizedBase = _bcur;
                            } else if (_toCur === _bcur && _fromCur !== _bcur) {
                                tx.realizedRate = this._money(_toAmt / _fromAmt, _bcur);
                                tx.realizedCurrency = _fromCur;
                                tx.realizedBase = _bcur;
                            } else {
                                // هیچ‌کدام ارزِ پایه نیست: نرخِ جفتیِ خام ثبت می‌شود.
                                tx.realizedPairRate = this._money(_toAmt / _fromAmt, _toCur);
                                tx.realizedRate = tx.realizedPairRate;
                            }
                            var _txsNow = this.getTransactions();
                            var _ix = _txsNow.findIndex(function (t) { return t.id == tx.id; });
                            if (_ix !== -1) {
                                _txsNow[_ix] = tx;
                                localStorage.setItem('transactions', JSON.stringify(_txsNow));
                            }
                        }
                    }
                }

                return { success: true, data: tx };
            }
        } catch (error) {
            console.error('خطا در ذخیره تراکنش:', error);
            return { success: false, error: error.message };
        }
    }

    // ================ مصارف ================
    getExpenses() {
        try {
            return JSON.parse(localStorage.getItem('expenses') || '[]');
        } catch (e) {
            console.error('خطا در بارگذاری مصارف:', e);
            return [];
        }
    }

    saveExpense(expense) {
        try {
            const expenses = this.getExpenses();
            const e = { ...expense };
            if (!e.title || !e.amount) throw new Error('عنوان و مبلغ لازم است');

            if (e.id) {
                const idx = expenses.findIndex(x => x.id == e.id);
                if (idx !== -1) {
                    // در حالت ویرایش: اثر مصرف قدیم از صندوق قدیم برداشته شود و
                    // اثر مصرف جدید روی صندوق جدید اعمال شود تا موجودی صندوق دقیق بماند.
                    var _oldExp = expenses[idx];
                    var _mergedExp = { ...expenses[idx], ...e, updatedAt: this.getCurrentDate() };
                    // مصرف هم یک سندِ مالی است و در محاسبهٔ «فایدهٔ خالص» می‌آید؛
                    // پس دقیقاً همان قفلِ نرخِ تاریخیِ تراکنش را می‌گیرد.
                    this._ensureTxRateStamp(_mergedExp, _oldExp);
                    var _oldAmt = parseFloat(_oldExp.amount) || 0;
                    var _newAmt = parseFloat(_mergedExp.amount) || 0;
                    if (_oldExp.cashboxId && _oldAmt > 0) {
                        this.updateCashboxBalance(_oldExp.cashboxId, _oldAmt, 'in', _oldExp.currency || this.baseCurrency());
                    }
                    if (_mergedExp.cashboxId && _newAmt > 0) {
                        this.updateCashboxBalance(_mergedExp.cashboxId, _newAmt, 'out', _mergedExp.currency || this.baseCurrency());
                    }
                    expenses[idx] = _mergedExp;
                    localStorage.setItem('expenses', JSON.stringify(expenses));
                    return { success: true, data: expenses[idx] };
                }
                return { success: false, error: 'مصرف یافت نشد' };
            } else {
                e.id = this._nextId();
                e.createdAt = this.getCurrentDate();
                this._ensureTxRateStamp(e, null);
                expenses.push(e);
                localStorage.setItem('expenses', JSON.stringify(expenses));
                // بروزرسانی موجودی صندوق
                if (e.cashboxId) {
                    this.updateCashboxBalance(e.cashboxId, parseFloat(e.amount || 0), 'out', e.currency || this.baseCurrency());
                }
                return { success: true, data: e };
            }
        } catch (error) {
            console.error('خطا در ذخیره مصرف:', error);
            return { success: false, error: error.message };
        }
    }

    // ================ صندوق‌ها ================
    getCashboxes() {
        try {
            return JSON.parse(localStorage.getItem('cashboxes') || '[]');
        } catch (e) {
            console.error('خطا در بارگذاری صندوق‌ها:', e);
            return [];
        }
    }

    saveCashbox(cashboxData) {
        try {
            const cashboxes = this.getCashboxes();
            const c = { ...cashboxData };
            if (!c.name) throw new Error('نام صندوق لازم است');

            if (c.id) {
                const idx = cashboxes.findIndex(x => x.id == c.id);
                if (idx !== -1) {
                    cashboxes[idx] = { ...cashboxes[idx], ...c, updatedAt: this.getCurrentDate() };
                    localStorage.setItem('cashboxes', JSON.stringify(cashboxes));
                    return { success: true, data: cashboxes[idx] };
                }
                return { success: false, error: 'صندوق یافت نشد' };
            } else {
                c.id = this._nextId();
                c.createdAt = this.getCurrentDate();
                cashboxes.push(c);
                localStorage.setItem('cashboxes', JSON.stringify(cashboxes));
                return { success: true, data: c };
            }
        } catch (error) {
            console.error('خطا در ذخیره صندوق:', error);
            return { success: false, error: error.message };
        }
    }

    updateCashbox(id, updates) {
        try {
            const cashboxes = this.getCashboxes();
            const idx = cashboxes.findIndex(c => c.id == id);
            if (idx !== -1) {
                cashboxes[idx] = { ...cashboxes[idx], ...updates, updatedAt: this.getCurrentDate() };
                localStorage.setItem('cashboxes', JSON.stringify(cashboxes));
                return { success: true, data: cashboxes[idx] };
            }
            return { success: false, error: 'صندوق یافت نشد' };
        } catch (error) {
            console.error('خطا در بروزرسانی صندوق:', error);
            return { success: false, error: error.message };
        }
    }

    deleteCashbox(id) {
        try {
            // حذف صندوق
            const cashboxes = this.getCashboxes();
            const filtered = cashboxes.filter(c => c.id != id);
            localStorage.setItem('cashboxes', JSON.stringify(filtered));
            // حذف تراکنش‌های مرتبط با این صندوق
            const transactions = this.getTransactions();
            const filteredTx = transactions.filter(t => t.cashboxId != id);
            localStorage.setItem('transactions', JSON.stringify(filteredTx));
            // حذف مصارف مرتبط با این صندوق
            const expenses = this.getExpenses();
            const filteredExp = expenses.filter(e => e.cashboxId != id);
            localStorage.setItem('expenses', JSON.stringify(filteredExp));
            return { success: true };
        } catch (error) {
            console.error('خطا در حذف صندوق:', error);
            return { success: false, error: error.message };
        }
    }

    // مهاجرتِ غیرمخربِ مدلِ موجودیِ صندوق: از موجودیِ تک‌ارزیِ قدیمی (balance +
    // currency) به نگاشتِ پویا balances = { [کد ارز]: مبلغ }. بی‌خطر برای اجرای
    // مکرر؛ داده قدیمی حذف/خراب نمی‌شود و balance (مفرد) هم برای سازگاری می‌ماند.
    migrateCashboxBalancesModel() {
        try {
            const cashboxes = this.getCashboxes();
            let changed = false;
            var _self = this;
            cashboxes.forEach(function (c) {
                if (!c.balances || typeof c.balances !== 'object' || Array.isArray(c.balances)) {
                    var native = c.currency || _self.baseCurrency();
                    c.balances = {};
                    c.balances[native] = parseFloat(c.balance || 0) || 0;
                    changed = true;
                }
            });
            if (changed) localStorage.setItem('cashboxes', JSON.stringify(cashboxes));
            return { success: true };
        } catch (e) {
            console.error('خطا در مهاجرت موجودی صندوق‌ها:', e);
            return { success: false, error: e.message };
        }
    }

    // نگاشتِ کاملِ موجودیِ یک صندوق به تفکیکِ ارز — { [کد ارز]: مبلغ }.
    //  جایگزینِ پویای خواندنِ مستقیمِ cashbox.balance که فقط ارزِ بومیِ صندوق را
    //  می‌دید و موجودیِ ارزهای دیگرِ همان صندوق را نامرئی می‌کرد.
    getCashboxBalances(cashbox) {
        var out = {};
        if (!cashbox) return out;
        if (cashbox.balances && typeof cashbox.balances === 'object' && !Array.isArray(cashbox.balances)) {
            for (var k in cashbox.balances) {
                if (!Object.prototype.hasOwnProperty.call(cashbox.balances, k)) continue;
                var v = parseFloat(cashbox.balances[k]);
                if (!isNaN(v)) out[k] = v;
            }
            return out;
        }
        var native = cashbox.currency || this.baseCurrency();
        out[native] = parseFloat(cashbox.balance || 0) || 0;
        return out;
    }

    // جمعِ موجودیِ همهٔ صندوق‌ها به تفکیکِ ارز — { AFN: …, USD: …, EUR: … }.
    //  منبعِ واحدِ کارتِ داشبورد و گزارش‌های سرمایه؛ به تعداد یا نامِ ارزها وابسته نیست.
    getCashboxTotalsByCurrency(filterFn) {
        var totals = {};
        try {
            var boxes = this.getCashboxes() || [];
            var self = this;
            boxes.forEach(function (box) {
                if (!box) return;
                if (typeof filterFn === 'function' && !filterFn(box)) return;
                var m = self.getCashboxBalances(box);
                for (var code in m) {
                    if (!Object.prototype.hasOwnProperty.call(m, code)) continue;
                    totals[code] = self._money((totals[code] || 0) + m[code], code);
                }
            });
        } catch (e) { console.error('خطا در جمعِ موجودیِ صندوق‌ها:', e); }
        return totals;
    }

    // =========================================================================
    //  مهاجرتِ «نرخِ تاریخیِ اسناد» (غیرمخرب، idempotent، امن برای اجرای مکرر)
    //  -------------------------------------------------------------------------
    //  هم‌سبک با migrateProductCurrencyModel و migrateCashboxBalancesModel.
    //  دو کار می‌کند و بس:
    //    ۱) اسنادی که ارزشان همان ارزِ پایه است، مُهرِ قطعیِ rate=1 می‌گیرند
    //       (واقعیت است، تخمین نیست).
    //    ۲) اسنادِ ارزِ غیرپایه که هیچ نرخِ ثبت‌شده‌ای ندارند، فقط با
    //       rateEstimated = true «علامت» می‌خورند — و هیچ نرخی برایشان اختراع
    //       نمی‌شود. چون نوشتنِ نرخِ امروز روی سندِ پارسال، یک عددِ غلط را برای
    //       همیشه قفل می‌کند؛ در حالی که پرچمِ تخمین به کاربر می‌گوید کدام سودهای
    //       گذشته قطعی نیستند و بعداً می‌تواند نرخِ واقعیِ همان روز را وارد کند.
    //  اگر سندی بعداً نرخِ معتبر پیدا کند، پرچم خودبه‌خود برداشته می‌شود.
    // =========================================================================
    migrateTransactionRateModel() {
        try {
            var base = this.baseCurrency();
            var self = this;
            var stamped = 0, flagged = 0, cleared = 0;

            var _walk = function (list) {
                var changed = false;
                (list || []).forEach(function (doc) {
                    if (!doc) return;
                    var cur = doc.currency || base;
                    if (doc.baseCurrency !== base) { doc.baseCurrency = base; changed = true; }
                    if (cur === base) {
                        if (!doc.exchangeRateSnapshot || !(parseFloat(doc.exchangeRateSnapshot.rate) > 0)) {
                            doc.exchangeRateSnapshot = {
                                base: base, currency: cur, rate: 1, mode: 'rate',
                                capturedAt: doc.createdAt || doc.date || null, source: 'migration'
                            };
                            doc.rateUsed = 1;
                            doc.rateCurrency = cur;
                            stamped++; changed = true;
                        }
                        if (doc.rateEstimated) { delete doc.rateEstimated; cleared++; changed = true; }
                        return;
                    }
                    if (self._hasValidRate(doc)) {
                        if (!doc.rateCurrency) { doc.rateCurrency = cur; changed = true; }
                        if (doc.rateEstimated) { delete doc.rateEstimated; cleared++; changed = true; }
                        return;
                    }
                    if (!doc.rateEstimated) { doc.rateEstimated = true; flagged++; changed = true; }
                    if (!doc.rateCurrency) { doc.rateCurrency = cur; changed = true; }
                });
                return changed;
            };

            var txs = this.getTransactions();
            if (_walk(txs)) localStorage.setItem('transactions', JSON.stringify(txs));
            var exps = this.getExpenses();
            if (_walk(exps)) localStorage.setItem('expenses', JSON.stringify(exps));

            return { success: true, stamped: stamped, flagged: flagged, cleared: cleared };
        } catch (e) {
            console.error('خطا در مهاجرتِ نرخِ اسناد:', e);
            return { success: false, error: e.message };
        }
    }

    // فهرستِ اسنادی که نرخِ تاریخیِ قطعی ندارند — برای نمایشِ شفافِ «سودِ تخمینی»
    // به کاربر (هم‌خانوادهٔ شمارندهٔ missingRateDocs در گزارشِ تجمیعی).
    getMissingRateDocs() {
        var out = [];
        try {
            var base = this.baseCurrency();
            var self = this;
            var _scan = function (list, kind) {
                (list || []).forEach(function (doc) {
                    if (!doc) return;
                    var cur = doc.currency || base;
                    if (cur === base) return;
                    if (self._hasValidRate(doc)) return;
                    out.push({
                        kind: kind, id: doc.id, currency: cur,
                        date: doc.date || doc.createdAt || '',
                        type: doc.type || '', billNumber: doc.billNumber || '',
                        amount: parseFloat(doc.totalAmount || doc.amount || 0) || 0
                    });
                });
            };
            _scan(this.getTransactions(), 'transaction');
            _scan(this.getExpenses(), 'expense');
        } catch (e) { console.error('خطا در فهرستِ اسنادِ بدونِ نرخ:', e); }
        return out;
    }

    // ثبتِ نرخِ تاریخیِ واقعیِ یک سند توسط کاربر — پرچمِ تخمین برداشته می‌شود.
    //  بدونِ این، پرچمِ «تخمینی» یک بن‌بست بود؛ با آن، کاربر می‌تواند نرخِ همان
    //  روز را وارد کند و سودِ آن سند قطعی شود.
    setDocHistoricalRate(kind, id, rate) {
        try {
            var r = parseFloat(rate);
            if (!(r > 0)) return { success: false, error: 'نرخ نامعتبر است' };
            var key = (kind === 'expense') ? 'expenses' : 'transactions';
            var list = (kind === 'expense') ? this.getExpenses() : this.getTransactions();
            var idx = list.findIndex(function (d) { return d && d.id == id; });
            if (idx === -1) return { success: false, error: 'سند یافت نشد' };
            var doc = list[idx];
            var base = this.baseCurrency();
            var cur = doc.currency || base;
            doc.exchangeRateSnapshot = {
                base: base, currency: cur, rate: r, mode: 'rate',
                capturedAt: doc.createdAt || doc.date || null, source: 'manual'
            };
            doc.rateUsed = r;
            doc.rateCurrency = cur;
            delete doc.rateEstimated;
            doc.updatedAt = this.getCurrentDate();
            localStorage.setItem(key, JSON.stringify(list));
            return { success: true, data: doc };
        } catch (e) {
            console.error('خطا در ثبتِ نرخِ تاریخی:', e);
            return { success: false, error: e.message };
        }
    }

    // موجودیِ یک صندوق در یک ارزِ مشخص (از نگاشتِ balances؛ در نبودِ آن از balance/currency).
    getCashboxBalance(cashbox, currencyCode) {
        if (!cashbox) return 0;
        var code = currencyCode || cashbox.currency || this.baseCurrency();
        if (cashbox.balances && cashbox.balances[code] != null) return parseFloat(cashbox.balances[code]) || 0;
        if (code === (cashbox.currency || this.baseCurrency())) return parseFloat(cashbox.balance || 0) || 0;
        return 0;
    }

    updateCashboxBalance(cashboxId, amount, type, currencyCode) {
        // type: 'in' = افزایش موجودی, 'out' = کاهش موجودی
        // currencyCode (اختیاری): ارزِ این حرکت؛ اگر داده نشود از ارزِ خودِ صندوق
        // استفاده می‌شود تا رفتارِ قدیمی دقیقاً حفظ گردد.
        try {
            const cashboxes = this.getCashboxes();
            const idx = cashboxes.findIndex(c => c.id == cashboxId);
            if (idx !== -1) {
                var box = cashboxes[idx];
                var code = currencyCode || box.currency || this.baseCurrency();
                // اطمینان از وجودِ نگاشتِ balances (سازگارِ عقب‌رو)
                if (!box.balances || typeof box.balances !== 'object' || Array.isArray(box.balances)) {
                    box.balances = {};
                    box.balances[box.currency || this.baseCurrency()] = parseFloat(box.balance || 0) || 0;
                }
                var cur = parseFloat(box.balances[code] || 0) || 0;
                var amt = parseFloat(amount) || 0;
                // گرد کردنِ استاندارد در هر حرکت — جلوگیری از انباشتِ خطای اعشار
                // روی موجودیِ صندوق پس از صدها تراکنش (مرحلهٔ ۸).
                box.balances[code] = this._money((type === 'in') ? (cur + amt) : (cur - amt), code);
                // آینه‌کردنِ balance (مفرد) به ارزِ بومیِ صندوق تا ۶۰ نقطهٔ خواندنِ
                // c.balance در جاهای دیگر بدونِ تغییر درست کار کند.
                var native = box.currency || this.baseCurrency();
                box.balance = parseFloat(box.balances[native] || 0) || 0;
                box.updatedAt = this.getCurrentDate();
                localStorage.setItem('cashboxes', JSON.stringify(cashboxes));
                return { success: true, data: box };
            }
            return { success: false, error: 'صندوق یافت نشد' };
        } catch (error) {
            console.error('خطا در بروزرسانی موجودی صندوق:', error);
            return { success: false, error: error.message };
        }
    }

    // ================ تنظیمات و داشبورد ================
    getSettings() {
        try {
            return JSON.parse(localStorage.getItem('settings') || '{}');
        } catch (e) {
            return {};
        }
    }

    saveSettings(settings) {
        try {
            localStorage.setItem('settings', JSON.stringify(settings));
            return { success: true };
        } catch (e) {
            console.error('خطا در ذخیره تنظیمات:', e);
            return { success: false, error: e.message };
        }
    }

    updateDashboard() {
        try {
            const stats = JSON.parse(localStorage.getItem('dashboardStats') || '{}');
            // (در صورت نیاز می‌توان محاسبات دقیق اضافه کرد)
            localStorage.setItem('dashboardStats', JSON.stringify(stats));
            return stats;
        } catch (e) {
            console.error('خطا در بروزرسانی داشبورد:', e);
            return {};
        }
    }
    getDashboardStats() {
    try {
        return JSON.parse(localStorage.getItem('dashboardStats') || '{}');
    } catch(e){
        return {};
    }
}

recalculateAllProductsStock() {
    // ════════════════════════════════════════════════════════════════════
    //  این متد اکنون فقط یک «پل» به موتورِ واحدِ بازسازی (rebuildAllDerivedData)
    //  است تا منطقِ محاسبه در یک محل بماند (Single Source of Truth). موتورِ واحد
    //  در script.js تعریف شده و تمام مقادیرِ مشتق‌شده را بازسازی می‌کند.
    //
    //  نکتهٔ ترتیبِ بارگذاری: سازندهٔ این کلاس (init) ممکن است پیش از بارگذاریِ
    //  script.js اجرا شود؛ در آن لحظه rebuildAllDerivedData هنوز وجود ندارد. برای
    //  همین یک «بازگشتِ امن» (fallback) با همان فرمولِ دقیقِ موجودی نگه داشته شده
    //  است تا برنامه در همان ابتدای بوت هم موجودیِ درست داشته باشد. این fallback
    //  دقیقاً همان نتیجهٔ Rebuilderِ 'stock' را می‌دهد، پس هیچ ناهماهنگی‌ای ایجاد
    //  نمی‌شود؛ و بازسازیِ کاملِ نهایی (موجودی + قیمت + صندوق + مفاد) کمی بعد توسط
    //  initApp → runDatabaseMigrations → rebuildAllDerivedData انجام می‌شود.
    // ════════════════════════════════════════════════════════════════════
    try {
        if (typeof window !== 'undefined' && typeof window.rebuildAllDerivedData === 'function') {
            window.rebuildAllDerivedData();
            return;
        }
    } catch (e) { /* در صورت خطا به fallback می‌رویم */ }

    // ── Fallback (فقط هنگام بوتِ زودهنگام، پیش از بارگذاری موتورِ واحد) ──
    try {
        const products = this._getProductsRaw();
        const transactions = this.getTransactions();

        const _qtyForStock = function(it) {
            var q = parseFloat(it && it.quantity) || 0;
            if (it && it.unitType === 'secondary') {
                var f = parseFloat(it.secondaryFactor) || 0;
                if (f > 0) return q / f;
            }
            return q;
        };

        products.forEach(p => { p.stock = parseFloat(p.initialStock) || 0; });

        transactions.forEach(tx => {
            if (!tx || !Array.isArray(tx.items)) return;
            tx.items.forEach(it => {
                const productIndex = products.findIndex(p => p.id == it.productId);
                if (productIndex === -1) return;
                const qty = _qtyForStock(it);
                if (tx.type === 'فروش') products[productIndex].stock -= qty;
                else if (tx.type === 'خرید') products[productIndex].stock += qty;
            });
        });

        localStorage.setItem('products', JSON.stringify(products));
        this.updateLowStockCount();
        console.log('موجودی اجناس (fallback پیش از موتورِ واحد) هماهنگ شد.');
    } catch (e) {
        console.error('خطا در بازسازی موجودی داده‌های قدیمی:', e);
    }
}
    updateLowStockCount() {
        try {
            const products = this.getProducts();
            const lowCount = products.filter(p => p.stock <= (p.minStock || 5)).length;
            const stats = JSON.parse(localStorage.getItem('dashboardStats') || '{}');
            stats.lowStockCount = lowCount;
            localStorage.setItem('dashboardStats', JSON.stringify(stats));
        } catch (e) {
            console.error('خطا در محاسبه کمبود موجودی:', e);
        }
    }

    exportData() {
        try {
            const data = {
                version: DB_VERSION,
                dbSchemaVersion: (function () { try { return parseInt(localStorage.getItem('db_schema_version'), 10) || 0; } catch (e) { return 0; } })(),
                exportDate: this.getCurrentDate(),
                persons: this.getPersons(),
                products: this.getAllProducts(),
                warehouses: this.getWarehouses(),
                activeWarehouseId: this.getActiveWarehouseId(),
                warehouseTransfers: this.getTransfers(),
                transactions: this.getTransactions(),
                expenses: this.getExpenses(),
                cashboxes: this.getCashboxes(),
                settings: this.getSettings(),
                returns: this.getReturns(),
                cashboxTransactions: JSON.parse(localStorage.getItem('cashboxTransactions') || '[]'),
                // اقلامِ همگام‌شونده‌ای که قبلاً در backup جا افتاده بودند — برای مهاجرتِ کامل لازم‌اند
                services: JSON.parse(localStorage.getItem('services') || '[]'),
                currencies: JSON.parse(localStorage.getItem('jouya-currencies') || '[]'),
                exchangeRates: JSON.parse(localStorage.getItem('jouya-exchange-rates') || '[]'),
                referenceRates: JSON.parse(localStorage.getItem('jouya-reference-rates') || 'null'),
                backupHistory: JSON.parse(localStorage.getItem('backupHistory') || '[]'),
                dashboardStats: JSON.parse(localStorage.getItem('dashboardStats') || '{}')
            };
            return { success: true, data };
        } catch (error) {
            console.error('خطا در صادرات داده‌ها:', error);
            return { success: false, error: error.message };
        }
    }

    importData(file) {
        return new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const allData = JSON.parse(e.target.result);
                        if (!allData.version) throw new Error('فایل نامعتبر است');
                        localStorage.setItem('persons', JSON.stringify(allData.persons || []));
                        localStorage.setItem('products', JSON.stringify(allData.products || []));
                        if (allData.warehouses) localStorage.setItem('warehouses', JSON.stringify(allData.warehouses));
                        if (allData.activeWarehouseId) localStorage.setItem('activeWarehouseId', allData.activeWarehouseId);
                        if (allData.warehouseTransfers) localStorage.setItem('warehouseTransfers', JSON.stringify(allData.warehouseTransfers));
                        localStorage.setItem('transactions', JSON.stringify(allData.transactions || []));
                        localStorage.setItem('expenses', JSON.stringify(allData.expenses || []));
                        localStorage.setItem('cashboxes', JSON.stringify(allData.cashboxes || []));
                        localStorage.setItem('settings', JSON.stringify(allData.settings || {}));
                        localStorage.setItem('returns', JSON.stringify(allData.returns || []));
                        if (allData.cashboxTransactions) localStorage.setItem('cashboxTransactions', JSON.stringify(allData.cashboxTransactions));
                        // اقلامِ همگام‌شونده — فقط اگر در فایل باشند بازیابی می‌شوند (سازگار با
                        // backupهای قدیمی که این‌ها را ندارند). شناسه‌ها عیناً حفظ می‌شوند
                        // (setItem آرایه را همان‌طور می‌نویسد؛ هیچ id/record_id جدیدی ساخته نمی‌شود).
                        if (allData.services) localStorage.setItem('services', JSON.stringify(allData.services));
                        // ارزها: ادغامِ idempotent بر اساسِ «code» (شناسهٔ واقعیِ ارز در CurrencySystem).
                        // تعریفِ فایل برای کدهای مشترک اولویت دارد (برای Restore درست باشد)، ارزهای
                        // محلیِ دیگر حفظ می‌شوند، و هیچ کدی دوبار نمی‌آید — پس Import (حتی چندباره یا
                        // با وجودِ AFN در فایل) هرگز ارزِ تکراری نمی‌سازد. Generic برای هر ارز.
                        if (allData.currencies && allData.currencies.length) {
                            try {
                                var _existCur = JSON.parse(localStorage.getItem('jouya-currencies') || '[]');
                                if (!Array.isArray(_existCur)) _existCur = [];
                                var _mergedCur = [], _seenCode = {};
                                allData.currencies.concat(_existCur).forEach(function (c) {
                                    if (!c || typeof c !== 'object') return;
                                    var code = (typeof c.code === 'string') ? c.code.trim().toUpperCase() : '';
                                    if (!code || _seenCode[code]) return;
                                    _seenCode[code] = true;
                                    c.code = code;
                                    _mergedCur.push(c);
                                });
                                localStorage.setItem('jouya-currencies', JSON.stringify(_mergedCur));
                            } catch (curErr) {
                                localStorage.setItem('jouya-currencies', JSON.stringify(allData.currencies));
                            }
                        }
                        // نرخِ تبادل: ادغامِ idempotent بر اساسِ جفتِ (from,to) — تعریفِ فایل اولویت دارد،
                        // نرخ‌های محلیِ دیگر حفظ می‌شوند، و هر جفت فقط یک‌بار می‌ماند.
                        if (allData.exchangeRates && allData.exchangeRates.length) {
                            try {
                                var _existRt = JSON.parse(localStorage.getItem('jouya-exchange-rates') || '[]');
                                if (!Array.isArray(_existRt)) _existRt = [];
                                var _mergedRt = [], _seenPair = {};
                                allData.exchangeRates.concat(_existRt).forEach(function (r) {
                                    if (!r || typeof r !== 'object' || !r.from || !r.to) return;
                                    var key = String(r.from).trim().toUpperCase() + '|' + String(r.to).trim().toUpperCase();
                                    if (_seenPair[key]) return;
                                    _seenPair[key] = true;
                                    _mergedRt.push(r);
                                });
                                localStorage.setItem('jouya-exchange-rates', JSON.stringify(_mergedRt));
                            } catch (rtErr) {
                                localStorage.setItem('jouya-exchange-rates', JSON.stringify(allData.exchangeRates));
                            }
                        }
                        if (allData.referenceRates != null) localStorage.setItem('jouya-reference-rates', JSON.stringify(allData.referenceRates));
                        localStorage.setItem('dashboardStats', JSON.stringify(allData.dashboardStats || {}));
                        // --- سیستم Migration: نسخهٔ شِمای فایل را اعمال و Migrationها را اجرا کن
                        try {
                            if (allData.dbSchemaVersion != null) localStorage.setItem('db_schema_version', String(parseInt(allData.dbSchemaVersion, 10) || 0));
                            else localStorage.removeItem('db_schema_version');
                        } catch (mErr) {}
                        if (typeof window !== 'undefined' && typeof window.runDatabaseMigrations === 'function') {
                            try { window.runDatabaseMigrations(); } catch (mErr2) { console.error('migration after import:', mErr2); }
                        }
                        // ثبت در تاریخچه پشتیبان
                        const backupHistory = JSON.parse(localStorage.getItem('backupHistory') || '[]');
                        const backup = {
                            id: new Date().getTime(),
                            name: `import_${new Date().getTime()}`,
                            date: this.getCurrentDate(),
                            description: 'وارد شده از فایل',
                            data: e.target.result,
                            size: e.target.result.length
                        };
                        backupHistory.push(backup);
                        localStorage.setItem('backupHistory', JSON.stringify(backupHistory));
                        resolve({ success: true, data: allData });
                    } catch (parseError) {
                        reject({ success: false, error: 'خطا در خواندن فایل' });
                    }
                };
                reader.onerror = () => reject({ success: false, error: 'خطا در خواندن فایل' });
                reader.readAsText(file);
            } catch (error) {
                reject({ success: false, error: error.message });
            }
        });
    }

    // متدهای پشتیبان‌گیری
getBackups() {
    try {
        return JSON.parse(localStorage.getItem('backupHistory') || '[]');
    } catch (e) {
        console.error('خطا در دریافت لیست پشتیبان‌ها:', e);
        return [];
    }
}

createBackup() {
    try {
        const backupData = this.exportData();
        if (!backupData.success) {
            throw new Error(backupData.error);
        }
        
        const backupHistory = this.getBackups();
        const backup = {
            id: Date.now(),
            name: `پشتیبان_${new Date().getTime()}`,
            date: this.getCurrentDate(),
            description: 'پشتیبان‌گیری دستی',
            data: JSON.stringify(backupData.data),
            size: JSON.stringify(backupData.data).length
        };
        
        backupHistory.push(backup);
        localStorage.setItem('backupHistory', JSON.stringify(backupHistory));
        
        console.log('پشتیبان ایجاد شد:', backup);
        return { success: true, data: backup };
    } catch (error) {
        console.error('خطا در ایجاد پشتیبان:', error);
        return { success: false, error: error.message };
    }
}

// در کلاس Database، بعد از متد createBackup این متدها را اضافه کنید:

deleteBackup(backupId) {
    try {
        const backupHistory = this.getBackups();
        const filtered = backupHistory.filter(b => b.id != backupId);
        localStorage.setItem('backupHistory', JSON.stringify(filtered));
        return { success: true };
    } catch (error) {
        console.error('خطا در حذف پشتیبان:', error);
        return { success: false, error: error.message };
    }
}

restoreBackup(backupId) {
    try {
        const backupHistory = this.getBackups();
        const backup = backupHistory.find(b => b.id == backupId);
        
        if (!backup) {
            throw new Error('پشتیبان یافت نشد');
        }
        
        const allData = JSON.parse(backup.data);
        
        // ذخیره داده‌ها
        localStorage.setItem('persons', JSON.stringify(allData.persons || []));
        localStorage.setItem('products', JSON.stringify(allData.products || []));
        if (allData.warehouses) localStorage.setItem('warehouses', JSON.stringify(allData.warehouses));
        if (allData.activeWarehouseId) localStorage.setItem('activeWarehouseId', allData.activeWarehouseId);
        if (allData.warehouseTransfers) localStorage.setItem('warehouseTransfers', JSON.stringify(allData.warehouseTransfers));
        localStorage.setItem('transactions', JSON.stringify(allData.transactions || []));
        localStorage.setItem('expenses', JSON.stringify(allData.expenses || []));
        localStorage.setItem('cashboxes', JSON.stringify(allData.cashboxes || []));
        localStorage.setItem('settings', JSON.stringify(allData.settings || {}));
        localStorage.setItem('returns', JSON.stringify(allData.returns || []));
        if (allData.cashboxTransactions) localStorage.setItem('cashboxTransactions', JSON.stringify(allData.cashboxTransactions));
        localStorage.setItem('dashboardStats', JSON.stringify(allData.dashboardStats || {}));

        // --- سیستم Migration: نسخهٔ شِمای بکاپ را اعمال کن، سپس Migrationها را اجرا کن تا
        // داده‌های قدیمی به آخرین نسخه برسند. بکاپ‌های قدیمی dbSchemaVersion ندارند → کلید حذف
        // می‌شود تا از نسخهٔ 0 همهٔ Migrationها اجرا شوند. (مسیرهای بازیابی که reload ندارند هم
        // این‌طور پوشش داده می‌شوند.)
        try {
            if (allData.dbSchemaVersion != null) localStorage.setItem('db_schema_version', String(parseInt(allData.dbSchemaVersion, 10) || 0));
            else localStorage.removeItem('db_schema_version');
        } catch (e) {}
        if (typeof window !== 'undefined' && typeof window.runDatabaseMigrations === 'function') {
            try { window.runDatabaseMigrations(); } catch (e) { console.error('migration after restore:', e); }
        }

        return { success: true };
    } catch (error) {
        console.error('خطا در بازیابی پشتیبان:', error);
        return { success: false, error: error.message };
    }
}

// این متد را برای چاپ فاکتور اضافه کنید
printInvoice(transactionId) {
    try {
        const transactions = this.getTransactions();
        const transaction = transactions.find(t => t.id == transactionId);
        
        if (!transaction) {
            throw new Error('تراکنش یافت نشد');
        }
        
        return { success: true, data: transaction };
    } catch (error) {
        console.error('خطا در دریافت اطلاعات فاکتور:', error);
        return { success: false, error: error.message };
    }
}

// این متد را برای گرفتن تنظیمات چاپ اضافه کنید
getPrintSettings() {
    try {
        const settings = this.getSettings();
        const printSettings = {
            paperSize: localStorage.getItem('print-paper-size') || 'A4',
            orientation: localStorage.getItem('print-orientation') || 'portrait',
            margin: parseInt(localStorage.getItem('print-margin')) || 10,
            fontSize: localStorage.getItem('print-font-size') || 'medium',
            printStoreLogo: localStorage.getItem('print-store-logo') === 'true',
            printBarcode: localStorage.getItem('print-barcode') === 'true',
            printCurrencyConversion: localStorage.getItem('print-currency-conversion') === 'true'
        };
        return printSettings;
    } catch (error) {
        console.error('خطا در دریافت تنظیمات چاپ:', error);
        return {};
    }
}
// =================== برگشتی‌ها ===================

// دریافت لیست معاملات برگشتی
getReturns() {
    return JSON.parse(localStorage.getItem('returns')) || [];
}

// ثبت معامله برگشتی
addReturnTransaction(data) {
    const returns = this.getReturns();

    const newReturn = {
        id: Date.now(),
        type: data.type,
        billNumber: data.billNumber || '',
        person: data.person || '',
        amount: Number(data.amount),
        date: data.date,
        reason: data.reason || '',
        createdAt: new Date().toISOString()
    };

    returns.push(newReturn);
    localStorage.setItem('returns', JSON.stringify(returns));

    return newReturn;
}

    // متد برای تولید شماره بل — UI از db.generateBillNumber(...) استفاده می‌کند
    getNextBillNumber(type = 'فروش') {
        try {
            const transactions = this.getTransactions();
            const filtered = transactions.filter(t => t.type === type);
            let maxNumber = 0;
            filtered.forEach(t => {
                if (t.billNumber) {
                    const digits = t.billNumber.replace(/\D/g, '');
                    const n = parseInt(digits || '0', 10);
                    if (n > maxNumber) maxNumber = n;
                }
            });
            return (maxNumber + 1).toString().padStart(4, '0');
        } catch (e) {
            return '0001';
        }
    }

    generateBillNumber(type = 'فروش') {
        const next = this.getNextBillNumber(type);
        if (type === 'فروش') return `BL-${next}`;
        if (type === 'خرید') return `PUR-${next}`;
        // fallback
        return `BILL-${next}`;
    }
}

// ایجاد نمونه دیتابیس (از این نمونه در بقیه کدها استفاده می‌شود)
const db = new Database();
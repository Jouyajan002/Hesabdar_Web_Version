/**
 * currency-system.js
 * =============================================================================
 * سیستم مرکزی و ماژولار ارزها — «فروشگاه جویا»
 * -----------------------------------------------------------------------------
 * این ماژول کاملاً مستقل است و هیچ فایل هستهٔ دیگری را تغییر نمی‌دهد.
 *  ۱) یک کارت «نرخ ارز» بالای کارت «فایده خالص امروز» در داشبورد تزریق می‌کند
 *     (کشویی، دقیقاً با استایل کارت‌های داشبورد). کارت‌های پایین‌تر تا پایین
 *     پایین می‌آیند تا با دکمه‌های سریع هم‌تراز شوند.
 *  ۲) روی کارت یک آیکن قلم می‌گذارد که فورمی با استایل «فورم تراکنش گدام»
 *     (کلاس‌های wh-transfer-*) باز می‌کند؛ فورم دو بخش دارد: «ارز جدید» و
 *     «نرخ ارز جدید»، هرکدام با دکمهٔ ثبت.
 *  ۳) یک انبار مرکزی و ماژولار برای ارزها و نرخ‌های تبدیل نگه می‌دارد
 *     (localStorage) و هر ارز جدید را به‌صورت خودکار در همهٔ Dropdownهای ارز
 *     نمایش می‌دهد (بدون تغییر دستی).
 * =============================================================================
 */
(function () {
    'use strict';
    if (window._jouyaCurrencySystemInstalled) return;
    window._jouyaCurrencySystemInstalled = true;

    // ---------------------------------------------------------------------------
    // کلیدهای ذخیره‌سازی و انبار مرکزی
    // ---------------------------------------------------------------------------
    var LS_CURRENCIES = 'jouya-currencies';
    var LS_RATES      = 'jouya-exchange-rates';
    var LS_REFRATES   = 'jouya-reference-rates';   // نرخِ مرجع (بهای ورود) هر ارز نسبت به پایه
    var LS_ASSETKINDS = 'jouya-asset-kinds';       // طبقه‌بندی دارایی پولی/غیرپولی

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
    function _uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    // ---------------------------------------------------------------------------
    //  گرد کردنِ استانداردِ مالی — تنها مرجعِ گرد کردن در کلِ Pipeline.
    //  هدف: جلوگیری از انباشتِ خطای اعشارِ جاوااسکریپت در تبدیل‌های زنجیره‌ای
    //  (ارز A → ارز پایه → ارز B). اصلاحِ epsilon نسبی است تا مقادیرِ بزرگ هم درست
    //  گرد شوند (مثلاً 1.005 × 100 = 100.49999999999999 که باید 1.01 شود، نه 1.00).
    // ---------------------------------------------------------------------------
    var MONEY_DECIMALS = 2;
    function _round(v, d) {
        var n = parseFloat(v);
        if (!isFinite(n)) return 0;
        var p = (d == null) ? MONEY_DECIMALS : parseInt(d, 10);
        if (isNaN(p) || p < 0 || p > 8) p = MONEY_DECIMALS;
        var f = Math.pow(10, p);
        var sign = (n < 0) ? -1 : 1;
        var a = Math.abs(n) * f;
        var r = Math.round(a + (a * Number.EPSILON * 4) + Number.EPSILON);
        return sign * r / f;
    }

    function _read(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            if (!raw) return fallback;
            var v = JSON.parse(raw);
            return v || fallback;
        } catch (e) { return fallback; }
    }
    function _write(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); return true; }
        catch (e) { return false; }
    }

    // ارز پایه از تنظیمات (پیش‌فرض AFN)
    function _baseCode() {
        try {
            if (window.db && typeof db.getSettings === 'function') {
                var s = db.getSettings();
                if (s && s.defaultCurrency) return s.defaultCurrency;
            }
        } catch (e) {}
        return 'AFN';
    }

    // بذر اولیه: افغانی + دالر (مطابق ارزهای موجود اپلیکیشن) — هیچ نرخی اضافه نمی‌شود.
    function _seedCurrencies() {
        return [
            { code: 'AFN', nameEn: 'Afghani', nameLocal: 'افغانی', symbol: '؋', color: '' },
            { code: 'USD', nameEn: 'Dollar',  nameLocal: 'دالر',   symbol: '$', color: '' }
        ];
    }

    // ---------------------------------------------------------------------------
    // API مرکزی — کاملاً ماژولار (window.CurrencySystem)
    // ---------------------------------------------------------------------------
    var CS = {
        // --- ارزها ---
        getCurrencies: function () {
            var list = _read(LS_CURRENCIES, null);
            if (!list || !list.length) { list = _seedCurrencies(); _write(LS_CURRENCIES, list); }
            // فیلترِ دفاعی: هر ارزِ خراب/بی‌کد (مثلِ دادهٔ تستِ سینک) نادیده گرفته می‌شود تا
            // در Dropdownها و گزارش‌ها به‌صورتِ [object Object] یا ارزِ ناقص دیده نشود.
            if (Array.isArray(list)) {
                var clean = list.filter(function (c) { return c && typeof c === 'object' && typeof c.code === 'string' && c.code.trim(); });
                if (clean.length !== list.length) { try { _write(LS_CURRENCIES, clean); } catch (e) {} }
                return clean;
            }
            return list;
        },
        saveCurrencies: function (list) { _write(LS_CURRENCIES, list || []); },
        getCurrency: function (code) {
            var list = this.getCurrencies();
            for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
            return null;
        },
        addCurrency: function (cur) {
            if (!cur || !cur.code) return { ok: false, msg: 'کد ارز الزامی است' };
            cur.code = String(cur.code).trim().toUpperCase();
            var list = this.getCurrencies();
            for (var i = 0; i < list.length; i++) {
                if (list[i].code === cur.code) return { ok: false, msg: 'این کد ارز از قبل موجود است' };
            }
            list.push({
                code: cur.code,
                nameEn: (cur.nameEn || '').trim(),
                nameLocal: (cur.nameLocal || cur.code).trim(),
                symbol: (cur.symbol || '').trim(),
                color: (cur.color || '').trim()
            });
            this.saveCurrencies(list);
            this._changed();
            return { ok: true };
        },
        // ویرایش یک ارزِ موجود (کد به‌عنوان شناسه؛ نام محلی/انگلیسی/نماد/رنگ قابل ویرایش)
        updateCurrency: function (code, data) {
            data = data || {};
            var list = this.getCurrencies();
            var found = false;
            for (var i = 0; i < list.length; i++) {
                if (list[i].code === code) {
                    if (data.nameLocal !== undefined) list[i].nameLocal = (data.nameLocal || list[i].nameLocal || code).trim();
                    if (data.nameEn !== undefined)    list[i].nameEn    = (data.nameEn || '').trim();
                    if (data.symbol !== undefined)    list[i].symbol    = (data.symbol || '').trim();
                    if (data.color !== undefined)     list[i].color     = (data.color || '').trim();
                    found = true; break;
                }
            }
            if (!found) return { ok: false, msg: 'ارز یافت نشد' };
            this.saveCurrencies(list);
            this._changed();
            return { ok: true };
        },
        removeCurrency: function (code) {
            if (code === _baseCode()) return { ok: false, msg: 'حذف ارز پایه ممکن نیست' };
            var list = this.getCurrencies().filter(function (c) { return c.code !== code; });
            this.saveCurrencies(list);
            // نرخ‌های مربوط به این ارز نیز حذف شوند
            var rates = this.getRates().filter(function (r) { return r.from !== code && r.to !== code; });
            this.saveRates(rates);
            this._changed();
            return { ok: true };
        },

        // --- نرخ‌ها ---
        getRates: function () { return _read(LS_RATES, []); },
        saveRates: function (list) { _write(LS_RATES, list || []); },
        addRate: function (rate) {
            if (!rate || !rate.from || !rate.to) return { ok: false, msg: 'ارز مبدأ و مقصد الزامی است' };
            if (rate.from === rate.to) return { ok: false, msg: 'ارز مبدأ و مقصد نباید یکسان باشد' };
            var list = this.getRates();
            // اگر همین جفت ارز موجود بود، به‌روزرسانی شود
            var found = false;
            for (var i = 0; i < list.length; i++) {
                if (list[i].from === rate.from && list[i].to === rate.to) {
                    list[i].rate = _num(rate.rate);
                    list[i].buy  = _num(rate.buy);
                    list[i].sell = _num(rate.sell);
                    found = true; break;
                }
            }
            // ══ جلوگیری از «تداخلِ دو ارز» ══
            //  اگر همین جفت به‌صورتِ معکوس ثبت شده باشد (مثلاً AFN→USD در کنارِ
            //  USD→AFN)، دو رکوردِ مستقل ایجاد می‌شد و با به‌روزرسانیِ یکی، دیگری
            //  کهنه می‌ماند ⇒ تبدیل‌ها در دو جهت ناسازگار می‌شدند.
            //  حالا رکوردِ معکوس با مقدارِ وارون به‌روزرسانی می‌شود تا همیشه هم‌خوان بماند.
            if (!found) {
                for (var k = 0; k < list.length; k++) {
                    if (list[k].from === rate.to && list[k].to === rate.from) {
                        var _r = _num(rate.rate), _b = _num(rate.buy), _s = _num(rate.sell);
                        list[k].rate = _r ? (1 / _r) : 0;
                        // خرید/فروش در جهتِ معکوس جای‌به‌جا می‌شوند
                        list[k].buy  = _s ? (1 / _s) : 0;
                        list[k].sell = _b ? (1 / _b) : 0;
                        found = true; break;
                    }
                }
            }
            if (!found) {
                list.push({
                    id: _uid('rate'),
                    from: rate.from, to: rate.to,
                    rate: _num(rate.rate), buy: _num(rate.buy), sell: _num(rate.sell)
                });
            }
            this.saveRates(list);
            this._changed();
            return { ok: true };
        },
        // ویرایش یک نرخِ موجود (بر اساس id) — همهٔ فیلدها (از/به/نرخ/خرید/فروش) قابل ویرایش
        updateRate: function (id, data) {
            data = data || {};
            var from = data.from, to = data.to;
            if (from && to && from === to) return { ok: false, msg: 'ارز مبدأ و مقصد نباید یکسان باشد' };
            var list = this.getRates();
            var found = false;
            for (var i = 0; i < list.length; i++) {
                if (list[i].id === id) {
                    var nf = from || list[i].from;
                    var nt = to || list[i].to;
                    if (nf === nt) return { ok: false, msg: 'ارز مبدأ و مقصد نباید یکسان باشد' };
                    list[i].from = nf;
                    list[i].to = nt;
                    list[i].rate = _num(data.rate);
                    list[i].buy  = _num(data.buy);
                    list[i].sell = _num(data.sell);
                    found = true; break;
                }
            }
            if (!found) return { ok: false, msg: 'نرخ یافت نشد' };
            this.saveRates(list);
            this._changed();
            return { ok: true };
        },
        removeRate: function (id) {
            var list = this.getRates().filter(function (r) { return r.id !== id; });
            this.saveRates(list);
            this._changed();
            return { ok: true };
        },
        // یافتن نرخ برای تبدیل (برای استفادهٔ ماژول‌های آینده)
        getRate: function (from, to) {
            var list = this.getRates();
            for (var i = 0; i < list.length; i++) {
                if (list[i].from === from && list[i].to === to) return list[i];
            }
            // جفت معکوس
            for (var j = 0; j < list.length; j++) {
                if (list[j].from === to && list[j].to === from) {
                    var r = list[j];
                    return {
                        id: r.id, from: from, to: to,
                        rate: r.rate ? 1 / r.rate : 0,
                        buy:  r.sell ? 1 / r.sell : 0,
                        sell: r.buy  ? 1 / r.buy  : 0
                    };
                }
            }
            return null;
        },
        getBaseCode: _baseCode,

        // ══ پاک‌سازیِ نرخ‌های تکراری/متناقض (اجرا در بوت، بی‌خطر برای تکرار) ══
        //  اگر در داده‌های موجود هم «A→B» و هم «B→A» ثبت شده باشد، فقط یکی نگه
        //  داشته می‌شود (اولی، که کاربر زودتر ثبت کرده) تا تبدیل‌ها در هر دو جهت
        //  از یک منبعِ واحد بیایند و ناسازگاری حذف شود.
        dedupeRates: function () {
            var list = this.getRates();
            var kept = [], removed = 0;
            for (var i = 0; i < list.length; i++) {
                var r = list[i];
                if (!r || !r.from || !r.to) { removed++; continue; }
                var dup = false;
                for (var j = 0; j < kept.length; j++) {
                    var k = kept[j];
                    if ((k.from === r.from && k.to === r.to) ||
                        (k.from === r.to && k.to === r.from)) { dup = true; break; }
                }
                if (dup) { removed++; continue; }
                kept.push(r);
            }
            if (removed > 0) { this.saveRates(kept); this._changed(); }
            return { ok: true, removed: removed };
        },

        // بررسیِ سلامتِ نرخ‌ها — کدام ارزها نرخِ معتبر نسبت به پایه ندارند.
        //  خروجی برای هشدار به کاربر؛ هیچ داده‌ای را تغییر نمی‌دهد.
        auditRates: function () {
            var base = _baseCode();
            var missing = [], zero = [];
            this.getCurrencies().forEach(function (c) {
                if (!c || !c.code || c.code === base) return;
                var v = CS.rateValue(c.code, base, 'rate');
                if (v == null) missing.push(c.code);
                else if (!(v > 0)) zero.push(c.code);
            });
            return { base: base, missing: missing, invalid: zero, ok: (missing.length === 0 && zero.length === 0) };
        },

        // تعیینِ ارز پایه به‌صورتِ دستی توسط کاربر (در settings.defaultCurrency ذخیره می‌شود).
        //  نرخ‌ها بازتعریف نمی‌شوند؛ چون همه نسبت به پایه‌اند، صرفاً مبنای محاسبه/نمایش عوض می‌شود.
        setBaseCode: function (code) {
            code = (code || '').toString().trim().toUpperCase();
            if (!code) return { ok: false, msg: 'کد ارز نامعتبر است' };
            var exists = this.getCurrencies().some(function (c) { return c.code === code; });
            if (!exists) return { ok: false, msg: 'این ارز در فهرست تعریف نشده است' };
            try {
                if (window.db && typeof db.getSettings === 'function' && typeof db.saveSettings === 'function') {
                    var s = db.getSettings() || {};
                    s.defaultCurrency = code;
                    db.saveSettings(s);
                } else {
                    return { ok: false, msg: 'دسترسی به تنظیمات ممکن نیست' };
                }
            } catch (e) { return { ok: false, msg: 'خطا در ذخیرهٔ ارز پایه' }; }
            this._changed();   // رندر مجدد کارت‌ها، Dropdownها و لیست‌های وابسته
            return { ok: true };
        },

        // -----------------------------------------------------------------------
        // موتور تبدیل ارز (ماژولار) — برای استفادهٔ فورم‌ها و ماژول‌های آینده
        //   mode: 'rate' (نرخ متوسط) | 'buy' (نرخ خرید) | 'sell' (نرخ فروش)
        //   قرارداد نرخ: یک واحد ارز غیرپایه = «نرخ» واحد ارز پایه.
        // -----------------------------------------------------------------------
        rateValue: function (from, to, mode) {
            mode = mode || 'rate';
            if (from === to) return 1;
            var r = this.getRate(from, to);
            if (!r) return null;
            var v = (mode === 'buy') ? r.buy : (mode === 'sell') ? r.sell : r.rate;
            v = _num(v);
            // نرخِ مرجع (rate) اگر خالی/صفر باشد یا برابرِ ۱ در حالی که خرید/فروشِ واقعی
            // مقدارِ متفاوت دارند: از میانگینِ خرید/فروش مشتق می‌شود. این از باگِ «Snapshot=۱»
            // و کم‌شدنِ بهای تمام‌شده بدونِ تبدیل جلوگیری می‌کند (سناریوی مفادِ ۴۸۹۳).
            if (mode !== 'buy' && mode !== 'sell') {
                var _b = _num(r.buy), _s = _num(r.sell);
                var _avg = (_b > 0 && _s > 0) ? (_b + _s) / 2 : (_s > 0 ? _s : _b);
                if ((!v || v <= 0) && _avg > 0) v = _avg;
                else if (v === 1 && _avg > 0 && Math.abs(_avg - 1) > 0.0001) v = _avg;
            } else if ((!v || v <= 0)) {
                // اگر سمتِ خواسته‌شده (خرید/فروش) خالی بود، به نرخِ مرجع یا سمتِ دیگر برگرد
                var _alt = _num(r.rate) || _num(mode === 'buy' ? r.sell : r.buy);
                if (_alt > 0) v = _alt;
            }
            return v || null;
        },
        // تبدیل مبلغ از یک ارز به ارز دیگر (اگر نرخ نبود null برمی‌گرداند)
        convert: function (amount, from, to, mode) {
            amount = _num(amount);
            if (from === to) return amount;
            var base = _baseCode();
            // from → base
            var toBase;
            if (from === base) toBase = amount;
            else {
                var rf = this.rateValue(from, base, mode);
                if (rf == null) return null;
                toBase = amount * rf;
            }
            // base → to
            if (to === base) return toBase;
            var rt = this.rateValue(to, base, mode);
            if (rt == null || rt === 0) return null;
            return toBase / rt;
        },
        // تبدیل هر ارز به ارز پایه (مثلاً برای ذخیرهٔ قیمت خرید به ارز پایه)
        convertToBase: function (amount, from, mode) {
            return this.convert(amount, from, _baseCode(), mode);
        },
        // تبدیل ارز پایه به یک ارز دیگر (برای نمایش معادل هنگام فروش)
        convertFromBase: function (amount, to, mode) {
            return this.convert(amount, _baseCode(), to, mode);
        },

        // =====================================================================
        //  Pipeline واحدِ تبدیلِ ارز (Single Conversion Pipeline)
        //  ---------------------------------------------------------------------
        //  قراردادِ نرخ: «۱ واحدِ ارزِ غیرپایه = rate واحدِ ارزِ پایه».
        //      • به پایه : amount × rate
        //      • از پایه : amount ÷ rate
        //  همهٔ محاسباتِ مالی باید از این توابع عبور کنند، نه از نرخِ خامِ روز.
        //  هیچ‌کدام از این توابع «نرخِ روز» را پنهانی جایگزینِ نرخِ سند نمی‌کنند؛ هر
        //  جا ناچار به استفاده از نرخِ روز شوند، در خروجی estimated:true برمی‌گردانند
        //  تا گزارش بتواند آن سند را به‌عنوان «تخمینی» به کاربر نشان دهد.
        //
        //  نکته: خودِ convert/convertToBase/convertFromBase عمداً «خام» (بدونِ گرد
        //  کردن) باقی مانده‌اند تا رفتارِ فراخوان‌های فعلی ذره‌ای تغییر نکند؛ گرد
        //  کردن در همین لایهٔ Pipeline و در آخرین گام انجام می‌شود.
        // =====================================================================

        // گرد کردنِ استانداردِ مالی (مرحلهٔ ۸) — در کلِ برنامه فقط از همین استفاده شود.
        round: function (value, decimals) { return _round(value, decimals); },

        // تعدادِ رقمِ اعشارِ یک ارز (پیش‌فرض ۲؛ در صورت نیاز روی خودِ رکوردِ ارز
        // به‌صورتِ فیلدِ decimals قابلِ تعریف است — بدونِ هیچ تغییری در فورم‌ها).
        getDecimals: function (code) {
            var c = this.getCurrency(code);
            var d = parseInt(c && c.decimals, 10);
            return (isNaN(d) || d < 0 || d > 8) ? MONEY_DECIMALS : d;
        },

        isBase: function (code) { return (code || '') === _baseCode(); },

        // نسخهٔ گردشدهٔ convert (برای نمایش و ذخیره؛ خودِ convert خام می‌ماند)
        convertRounded: function (amount, from, to, mode) {
            var v = this.convert(amount, from, to, mode);
            return (v == null) ? null : _round(v, this.getDecimals(to));
        },

        // تبدیل با «یک نرخِ مشخصِ داده‌شده» — نه نرخِ روز.
        //   dir: 'toBase' (ضرب) | 'fromBase' (تقسیم)
        convertAtRate: function (amount, rate, dir, decimals) {
            var r = _num(rate);
            if (!(r > 0)) return null;
            var a = _num(amount);
            return _round((dir === 'fromBase') ? (a / r) : (a * r), decimals);
        },

        // زنجیرهٔ کاملِ «ارز A → پایه → ارز B» با دو نرخِ ثبت‌شده.
        //  گرد کردن فقط یک بار در انتها انجام می‌شود تا خطای اعشار انباشته نشود.
        convertAtRates: function (amount, fromRate, toRate, decimals) {
            var rf = _num(fromRate), rt = _num(toRate);
            if (!(rf > 0) || !(rt > 0)) return null;
            return _round((_num(amount) * rf) / rt, decimals);
        },

        // «مُهرِ نرخِ کامل» برای ذخیره روی سند در لحظهٔ ثبت.
        //  خروجیِ null یعنی برای این ارز نرخی تعریف نشده است؛ سند باید بدونِ نرخ
        //  ثبت شود و بعداً «تخمینی» علامت بخورد — نه اینکه بی‌صدا ۱ فرض شود.
        makeRateStamp: function (code, mode, capturedAt) {
            var base = _baseCode();
            var cur = code || base;
            var r = (cur === base) ? 1 : this.baseRate(cur, mode || 'rate');
            if (r == null || !(r > 0)) return null;
            return {
                base: base, currency: cur, rate: r,
                mode: mode || 'rate', capturedAt: capturedAt || null
            };
        },

        // خواندنِ «نرخِ زمانِ معامله» از یک سند — منبعِ واحدِ حقیقت.
        //  doc می‌تواند تراکنش، مصرف یا هر رکوردی با exchangeRateSnapshot/rateUsed باشد.
        //  نرخ فقط زمانی معتبر شمرده می‌شود که ارزِ مُهر با ارزِ موردِ تبدیل یکی باشد؛
        //  در غیرِ این صورت null برمی‌گردد (جلوگیری از اعمالِ نرخِ ارزِ دیگر).
        rateFromDoc: function (doc, currency) {
            if (!doc) return null;
            var base = _baseCode();
            var cur = currency || doc.currency || base;
            if (cur === base) return 1;
            var snap = doc.exchangeRateSnapshot;
            if (snap && _num(snap.rate) > 0) {
                var sc = snap.currency || doc.currency || cur;
                if (sc === cur) return _num(snap.rate);
            }
            var ru = _num(doc.rateUsed);
            if (ru > 0) {
                // rateUsed ارزِ خودش را حمل نمی‌کند؛ فقط وقتی معتبر است که ارزِ
                // موردِ تبدیل، همان ارزِ خودِ سند باشد.
                var dc = doc.rateCurrency || doc.currency || base;
                if (dc === cur) return ru;
            }
            return null;
        },

        // آیا این سند نرخِ ثبت‌شدهٔ معتبر دارد؟ (برای علامت‌گذاریِ شفافِ اسنادِ قدیمی)
        hasDocRate: function (doc, currency) {
            var r = this.rateFromDoc(doc, currency);
            return (r != null && r > 0);
        },

        // ── ورودیِ اصلیِ Pipeline: تبدیلِ مبلغِ یک سند به ارزِ پایه ──
        //  خروجی: { value, rate, estimated, source }
        //    source: 'base' | 'doc' (نرخِ ثبت‌شدهٔ سند) | 'live' (نرخِ روز، تخمینی) | 'none'
        //  estimated:true یعنی این رقم با نرخِ روز تخمین زده شده و باید در گزارش
        //  علامت بخورد (هم‌خانوادهٔ missingRateDocs در script.js).
        toBaseFromDoc: function (amount, currency, doc, opts) {
            opts = opts || {};
            var base = _baseCode();
            var cur = currency || (doc && doc.currency) || base;
            var a = _num(amount);
            var dec = (opts.decimals != null) ? opts.decimals : this.getDecimals(base);
            if (cur === base) return { value: _round(a, dec), rate: 1, estimated: false, source: 'base' };

            var r = this.rateFromDoc(doc, cur);
            if (r != null && r > 0) {
                return { value: _round(a * r, dec), rate: r, estimated: false, source: 'doc' };
            }
            if (opts.allowLive === false) {
                return { value: 0, rate: null, estimated: true, source: 'none' };
            }
            var live = this.baseRate(cur, opts.mode || 'rate');
            if (live != null && live > 0) {
                return { value: _round(a * live, dec), rate: live, estimated: true, source: 'live' };
            }
            // نه نرخِ سند و نه نرخِ روز — مبلغ دست‌نخورده برمی‌گردد و تخمینی علامت می‌خورد.
            return { value: _round(a, dec), rate: null, estimated: true, source: 'none' };
        },

        // معکوسِ toBaseFromDoc — از ارزِ پایه به ارزِ نمایش.
        fromBaseForDoc: function (amountInBase, currency, doc, opts) {
            opts = opts || {};
            var base = _baseCode();
            var cur = currency || base;
            var a = _num(amountInBase);
            var dec = (opts.decimals != null) ? opts.decimals : this.getDecimals(cur);
            if (cur === base) return { value: _round(a, dec), rate: 1, estimated: false, source: 'base' };
            var r = this.rateFromDoc(doc, cur);
            if (r != null && r > 0) return { value: _round(a / r, dec), rate: r, estimated: false, source: 'doc' };
            var live = this.baseRate(cur, opts.mode || 'rate');
            if (live != null && live > 0) return { value: _round(a / live, dec), rate: live, estimated: true, source: 'live' };
            return { value: _round(a, dec), rate: null, estimated: true, source: 'none' };
        },

        // ── فرمولِ استانداردِ سودِ عملیاتی (مرحلهٔ ۴) ──
        //  درآمد و بهای تمام‌شده هرکدام با «نرخِ سندِ خودشان» به ارزِ پایه می‌روند و
        //  سپس تفریق می‌شوند. هرگز دو مبلغِ خام از دو ارزِ مختلف مستقیماً کم نمی‌شوند.
        //    revenue = { amount, currency, doc }   ← بلِ فروش
        //    cost    = { amount, currency, doc }   ← سریِ خرید (FIFO)
        //  خروجی به ارزِ پایه است؛ تبدیل به ارزِ نمایش با fromBaseForDoc انجام می‌شود.
        operationalProfit: function (revenue, cost, opts) {
            opts = opts || {};
            var base = _baseCode();
            var dec = (opts.decimals != null) ? opts.decimals : this.getDecimals(base);
            var rv = this.toBaseFromDoc(revenue && revenue.amount, revenue && revenue.currency, revenue && revenue.doc, opts);
            var cs = this.toBaseFromDoc(cost && cost.amount, cost && cost.currency, cost && cost.doc, opts);
            return {
                base: base,
                revenueBase: rv.value,
                costBase: cs.value,
                profitBase: _round(rv.value - cs.value, dec),
                estimated: !!(rv.estimated || cs.estimated),
                revenueRate: rv.rate,
                costRate: cs.rate
            };
        },

        // =====================================================================
        //  موتورِ ارز پایه، دارایی پولی/غیرپولی و سود‌وزیانِ تسعیر ارز
        //  (افزودنیِ کاملاً ماژولار — هیچ فایل هسته‌ای را تغییر نمی‌دهد)
        //  قرارداد نرخ: «۱ واحد ارزِ غیرپایه = baseRate واحدِ ارزِ پایه».
        //    • تبدیل به پایه  : ضرب در baseRate      (۱۰۰ دالر × ۷۲ = ۷۲۰۰ افغانی)
        //    • تبدیل از پایه  : تقسیم بر baseRate     (۷۲۰۰ افغانی ÷ ۷۲ = ۱۰۰ دالر)
        //    • دو ارزِ غیرپایه: از مسیرِ پایه عبور می‌کند (بدون نرخِ جفتیِ جدا)
        // =====================================================================

        // «۱ واحد از این ارز = ؟ واحدِ ارز پایه» (ضریبِ ارز نسبت به پایه)
        baseRate: function (code, mode) {
            var base = _baseCode();
            if (code === base) return 1;
            var v = this.rateValue(code, base, mode || 'rate');
            return (v == null) ? null : v;
        },

        // ------------------------- طبقه‌بندی دارایی -------------------------
        //  پولی (monetary)    : با نرخِ روز تجدید ارزیابی می‌شود  → صندوق، طلب، بدهی
        //  غیرپولی (nonmonetary): به بهای تاریخی می‌ماند          → موجودی اجناس، دارایی ثابت
        _defaultAssetKinds: function () {
            return {
                cashbox:    'monetary',
                receivable: 'monetary',
                payable:    'monetary',
                inventory:  'nonmonetary',
                fixed:      'nonmonetary'
            };
        },
        getAssetKinds: function () {
            var k = _read(LS_ASSETKINDS, null);
            if (!k || typeof k !== 'object' || Array.isArray(k)) {
                k = this._defaultAssetKinds(); _write(LS_ASSETKINDS, k);
            }
            return k;
        },
        setAssetKind: function (key, kind) {
            var k = this.getAssetKinds();
            k[key] = (kind === 'nonmonetary') ? 'nonmonetary' : 'monetary';
            _write(LS_ASSETKINDS, k);
            this._changed();
            return { ok: true };
        },
        isMonetary: function (key) { return this.getAssetKinds()[key] !== 'nonmonetary'; },

        // ------------------- نرخِ مرجع (بهای ورود/تمام‌شده) -------------------
        //  مبنای محاسبهٔ تسعیر است؛ اگر برای ارزی ثبت نشده باشد، نرخِ خریدِ فعلی
        //  (و در نبودِ آن، نرخِ متوسط) مبنا قرار می‌گیرد.
        //  اصلاحِ معماری: پیش‌تر در نبودِ نرخِ مرجع عددِ «۰» برمی‌گشت؛ در آن حالت
        //  diff = curRate − 0 = curRate می‌شد و «کلِ ارزشِ موجودی» به‌عنوان سودِ تسعیر
        //  گزارش می‌گردید. اکنون null برمی‌گردد و آن ارز در fxRevaluation کنار گذاشته
        //  و در فهرستِ unknown اعلام می‌شود تا کاربر نرخِ مرجعش را ثبت کند.
        getReferenceRate: function (code) {
            var base = _baseCode();
            if ((code || base) === base) return 1;
            var m = _read(LS_REFRATES, {}) || {};
            if (m[code] != null && _num(m[code]) > 0) return _num(m[code]);
            var buy = this.baseRate(code, 'buy');
            var v = (buy == null || buy === 0) ? this.baseRate(code, 'rate') : buy;
            return (v == null || !(v > 0)) ? null : v;
        },
        setReferenceRate: function (code, rate) {
            var m = _read(LS_REFRATES, {}) || {};
            m[code] = _num(rate);
            _write(LS_REFRATES, m);
            this._changed();
            return { ok: true };
        },

        // «مُهرِ نرخ» برای ذخیره کنارِ هر تراکنش در لحظهٔ ثبت (rateAtEntry).
        //  فورم‌ها می‌توانند خروجی را در رکورد ذخیره کنند تا گزارش‌های گذشته با
        //  تغییرِ نرخِ روز دستکاری نشوند (پایهٔ تفکیکِ سودِ عملیاتی از سودِ تسعیر).
        //  اصلاحِ معماری: پیش‌تر در نبودِ نرخ عددِ «۱» برمی‌گشت؛ یعنی ۱ دالر = ۱ افغانی
        //  به‌صورتِ خاموش ثبت می‌شد و سودِ آن سند برای همیشه غلط می‌ماند. اکنون null
        //  برمی‌گردد تا سند «بدونِ نرخ» ثبت شود و در گزارش‌ها «تخمینی» علامت بخورد.
        stampRate: function (code, mode) {
            var base = _baseCode();
            if ((code || base) === base) return 1;
            var r = this.baseRate(code, mode || 'rate');
            return (r == null || !(r > 0)) ? null : r;
        },

        // ----------------------- موتورِ سود/زیانِ تسعیر -----------------------
        //  ورودی : نگاشتِ موجودیِ پولی به تفکیک ارز  { USD: 4000, EUR: -600, ... }
        //          (ارز پایه نادیده گرفته می‌شود چون تسعیر ندارد؛ موجودیِ منفی =
        //          بدهی، که خودبه‌خود علامتِ نتیجه را برعکس می‌کند.)
        //  opts  : { mode:'rate'|'buy'|'sell', referenceRates:{code:rate} }
        //  خروجی : { base, total, rows:[{code,balance,refRate,curRate,diff,gain}] }
        //          gain > 0  ⇒  سودِ تسعیر  (فایده از تفاوتِ نرخِ ارز)
        //          gain < 0  ⇒  زیانِ تسعیر (ضرر بابتِ نوسانِ ارز)
        fxRevaluation: function (balancesByCurrency, opts) {
            opts = opts || {};
            var mode = opts.mode || 'rate';
            var base = _baseCode();
            var dec = (opts.decimals != null) ? opts.decimals : this.getDecimals(base);
            var rows = [], total = 0, unknown = [];
            var b = balancesByCurrency || {};
            for (var code in b) {
                if (!Object.prototype.hasOwnProperty.call(b, code)) continue;
                if (code === base) continue;
                var bal = _num(b[code]);
                if (!bal) continue;
                var curRate = this.baseRate(code, mode);
                if (curRate == null || !(curRate > 0)) { unknown.push(code); continue; }
                var refRate = (opts.referenceRates && _num(opts.referenceRates[code]) > 0)
                    ? _num(opts.referenceRates[code]) : this.getReferenceRate(code);
                // بدونِ نرخِ مرجعِ معتبر، تسعیر معنا ندارد و نباید صفر فرض شود.
                if (refRate == null || !(refRate > 0)) { unknown.push(code); continue; }
                var diff = _round(curRate - refRate, 6);
                var gain = _round(diff * bal, dec);  // به ارز پایه
                total += gain;
                rows.push({ code: code, balance: bal, refRate: refRate, curRate: curRate, diff: diff, gain: gain });
            }
            return { base: base, total: _round(total, dec), rows: rows, unknown: unknown };
        },

        // گردآوریِ خودکارِ موجودیِ پولی از دیتابیس (صندوق‌ها) و محاسبهٔ تسعیر.
        //  کاملاً دفاعی: اگر db یا متدها نبودند، بی‌اثر است و چیزی را تغییر نمی‌دهد.
        //  باقیداری/بدهیِ اشخاص در script.js محاسبه می‌شود؛ آن را از راهِ
        //  opts.extraBalances = { USD: 900, ... } به این تابع بدهید تا لحاظ شود.
        revalueFromDb: function (opts) {
            opts = opts || {};
            var byCur = {};
            var _base = _baseCode();
            try {
                if (window.db && typeof db.getCashboxes === 'function' && this.isMonetary('cashbox')) {
                    (db.getCashboxes() || []).forEach(function (c) {
                        if (!c) return;
                        // اصلاحِ معماری: پیش‌تر فقط c.balance (ارزِ بومیِ صندوق) خوانده
                        // می‌شد و نگاشتِ چند-ارزیِ c.balances نادیده گرفته می‌شد؛ یعنی
                        // موجودیِ دالریِ یک صندوقِ افغانی اصلاً تسعیر نمی‌گردید.
                        if (c.balances && typeof c.balances === 'object' && !Array.isArray(c.balances)) {
                            for (var k in c.balances) {
                                if (!Object.prototype.hasOwnProperty.call(c.balances, k)) continue;
                                byCur[k] = _num(byCur[k]) + _num(c.balances[k]);
                            }
                            return;
                        }
                        var code = c.currency || _base;
                        byCur[code] = _num(byCur[code]) + _num(c.balance);
                    });
                }
            } catch (e) {}
            var extra = opts.extraBalances || null;
            if (extra) {
                for (var k in extra) {
                    if (Object.prototype.hasOwnProperty.call(extra, k)) {
                        byCur[k] = _num(byCur[k]) + _num(extra[k]);
                    }
                }
            }
            return this.fxRevaluation(byCur, opts);
        },

        // رویداد تغییر داده — رندر مجدد کارت و پر کردن Dropdownها
        _changed: function () {
            try { renderRateCard(); } catch (e) {}
            try { CS.populateDropdowns(); } catch (e) {}
            try { renderModalLists(); } catch (e) {}
        },

        // -----------------------------------------------------------------------
        // سیستم مرکزی Dropdownها — هر ارز جدید به‌صورت خودکار در همهٔ لیست‌های
        // انتخاب ارز نمایش داده می‌شود. (افزودنی و غیرمخرب: گزینه‌های موجود دست
        // نمی‌خورند؛ فقط ارزهای نبوده اضافه می‌شوند و مقدار انتخاب‌شده حفظ می‌شود.)
        // -----------------------------------------------------------------------
        pickerIds: [
            'person-currency', 'sales-currency', 'receipt-currency', 'payment-currency',
            'purchase-currency', 'proforma-currency', 'return-currency', 'expense-currency',
            'cashbox-currency', 'default-currency', 'filter-person-transaction-currency'
        ],
        populateDropdowns: function () {
            var currencies = this.getCurrencies();
            var selects = [];
            // شناسه‌های ثابت شناخته‌شده
            this.pickerIds.forEach(function (id) {
                var el = document.getElementById(id);
                if (el && el.tagName === 'SELECT') selects.push(el);
            });
            // قابلیت آینده‌نگر: هر <select data-currency-picker>
            try {
                var extra = document.querySelectorAll('select[data-currency-picker]');
                for (var k = 0; k < extra.length; k++) {
                    if (selects.indexOf(extra[k]) < 0) selects.push(extra[k]);
                }
            } catch (e) {}

            selects.forEach(function (sel) {
                var existing = {};
                for (var i = 0; i < sel.options.length; i++) existing[sel.options[i].value] = true;
                var prefix = /نوع ارز/.test((sel.options[0] && sel.options[0].text) || '') ? 'نوع ارز: ' : '';
                currencies.forEach(function (c) {
                    if (existing[c.code]) return;              // گزینهٔ موجود دست نمی‌خورد
                    var opt = document.createElement('option');
                    opt.value = c.code;
                    opt.textContent = prefix + (c.nameLocal || c.code);
                    sel.appendChild(opt);
                });
            });
        },

        // باز کردن فورم مدیریت ارزها
        openModal: function () { openCurrencyModal(); }
    };
    window.CurrencySystem = CS;

    // ---------------------------------------------------------------------------
    // تزریق استایل‌ها (بدون تغییر style.css)
    // ---------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('csx-styles')) return;
        var css = ''
        // چیدمان ستون کارت‌ها: کارت نرخ ارز بالا، بقیه پایین (هم‌تراز دکمه‌های سریع)
        + '#dashboard-info-cards { padding-top: 0 !important; }'
        + '.csx-info-spacer { flex: 1 1 auto; min-height: 8px; }'
        // جدول نرخ داخل کارت داشبورد
        + '.csx-rate-wrap { display:flex; flex-direction:column; gap:6px; }'
        + '.csx-rate-head, .csx-rate-row { display:grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; align-items:center; gap:4px; }'
        + '.csx-rate-head { font-size:.72rem; font-weight:800; color:#64748b; padding:0 4px 4px 4px; border-bottom:1px solid #eef2f7; direction:rtl; }'
        + '.csx-rate-head span { text-align:center; }'
        + '.csx-rate-head span:first-child { text-align:right; }'
        + '.csx-rate-row { background:#f8fafc; border:1px solid #eef2f7; border-radius:9px; padding:7px 9px; box-shadow:0 1px 3px rgba(15,23,42,.04); direction:rtl; }'
        + '.csx-rate-pair { display:flex; flex-direction:column; gap:1px; text-align:right; }'
        + '.csx-rate-pair .csx-pp { font-weight:800; font-size:.82rem; color:#1e293b; direction:ltr; text-align:right; unicode-bidi:embed; }'
        + '.csx-rate-pair .csx-ps { font-weight:600; font-size:.68rem; color:#64748b; }'
        + '.csx-rate-cell { text-align:center; font-weight:800; font-size:.9rem; direction:ltr; unicode-bidi:embed; }'
        + '.csx-rate-unit { color:#1e293b; }'
        + '.csx-rate-buy  { color:#dc2626; }'
        + '.csx-rate-sell { color:#10b981; }'
        + '.csx-rate-empty { text-align:center; color:#94a3b8; font-size:.85rem; padding:14px 6px; }'
        + '.csx-edit-btn { color:#1e3a5f; font-size:.9rem; cursor:pointer; width:28px; height:28px; border-radius:7px; display:inline-flex; align-items:center; justify-content:center; background:#eef2f7; transition:background .15s; }'
        + '.csx-edit-btn:hover { background:#e2e8f0; }'
        // بخش دو ستونی داخل مودال (ارز جدید | نرخ ارز جدید)
        + '.csx-two-col { display:grid; grid-template-columns:1fr 1fr; gap:18px; }'
        + '.csx-panel { border:1px solid #d8dee9; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; }'
        + '.csx-panel-title { background:#1e3a5f; color:#fff; padding:11px 16px; font-weight:800; font-size:1rem; display:flex; align-items:center; gap:8px; }'
        + '.csx-panel-body { padding:16px; display:flex; flex-direction:column; gap:14px; }'
        + '.csx-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }'
        + '.csx-submit { background:#1e3a5f; border:none; color:#fff; padding:11px 22px; border-radius:10px; font-weight:800; font-size:.95rem; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; width:100%; font-family:inherit; }'
        + '.csx-submit:hover { background:#16304f; }'
        // لیست موجودی‌ها داخل هر پنل
        + '.csx-list { border-top:1px dashed #e2e8f0; padding-top:12px; display:flex; flex-direction:column; gap:7px; max-height:210px; overflow-y:auto; }'
        + '.csx-list-empty { text-align:center; color:#94a3b8; font-size:.85rem; padding:8px; }'
        + '.csx-chip { display:flex; align-items:center; justify-content:space-between; gap:8px; background:#f8fafc; border:1px solid #eef2f7; border-radius:9px; padding:8px 11px; direction:rtl; }'
        + '.csx-chip-main { font-weight:700; font-size:.86rem; color:#1e293b; display:flex; flex-direction:column; gap:2px; text-align:right; }'
        + '.csx-chip-sub { font-weight:600; font-size:.72rem; color:#64748b; direction:ltr; text-align:right; unicode-bidi:embed; }'
        + '.csx-chip-del { background:#fef2f2; border:none; color:#dc2626; width:30px; height:30px; border-radius:8px; cursor:pointer; font-size:13px; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; }'
        + '.csx-chip-del:hover { background:#fee2e2; }'
        + '.csx-chip-actions { display:flex; align-items:center; gap:6px; flex:0 0 auto; }'
        + '.csx-chip-edit { background:#eef2f7; border:none; color:#1e3a5f; width:30px; height:30px; border-radius:8px; cursor:pointer; font-size:12px; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; }'
        + '.csx-chip-edit:hover { background:#e2e8f0; }'
        + '.csx-btn-row { display:flex; gap:8px; align-items:stretch; }'
        + '.csx-btn-row .csx-submit { width:auto; flex:1 1 auto; }'
        + '.csx-cancel-edit { background:#fff; border:1px solid #d8dee9; color:#475569; padding:11px 16px; border-radius:10px; font-weight:800; font-size:.9rem; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; font-family:inherit; flex:0 0 auto; }'
        + '.csx-cancel-edit:hover { background:#f1f5f9; }'
        + 'input.csx-readonly { background:#f1f5f9 !important; color:#94a3b8 !important; cursor:not-allowed; }'
        // حالت تیره
        + 'body.dark-mode .csx-rate-row, body.dark-mode .csx-chip { background:#0f172a; border-color:#334155; }'
        + 'body.dark-mode .csx-rate-pair .csx-pp, body.dark-mode .csx-rate-unit, body.dark-mode .csx-chip-main { color:#f1f5f9; }'
        + 'body.dark-mode .csx-edit-btn { background:#334155; color:#cbd5e1; }'
        // پنلِ ارز پایه
        + '.csx-base-panel { margin-bottom:16px; border:2px solid #f59e0b; }'
        + '.csx-base-panel .csx-panel-title { background:#b45309; }'
        + '.csx-base-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }'
        + '.csx-base-row select { flex:1 1 200px; min-width:160px; padding:10px 12px; border:1px solid #d1d5db; border-radius:10px; font-family:inherit; font-size:.95rem; }'
        + '.csx-base-row .csx-submit { width:auto; flex:0 0 auto; }'
        + '.csx-base-hint { margin-top:10px; font-size:.8rem; color:#6b7280; line-height:1.7; }'
        + '.csx-base-hint b { color:#b45309; }'
        + 'body.dark-mode .csx-base-row select { background:#0f172a; color:#e2e8f0; border-color:#334155; }'
        // واکنش‌گرا
        + '@media (max-width: 760px){ .csx-two-col { grid-template-columns:1fr; } }';
        var st = document.createElement('style');
        st.id = 'csx-styles';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // ---------------------------------------------------------------------------
    // کارت داشبورد «نرخ ارز» — تزریق در ابتدای ستون کارت‌ها + spacer برای پایین‌بردن بقیه
    // ---------------------------------------------------------------------------
    function injectDashboardCard() {
        var col = document.getElementById('dashboard-info-cards');
        if (!col) return false;
        if (document.getElementById('dash-card-fx')) return true; // قبلاً تزریق شده

        var card = document.createElement('div');
        card.className = 'dash-card dash-card-collapsible';
        card.id = 'dash-card-fx';
        card.innerHTML =
            '<div class="dash-card-head" onclick="toggleDashCard(\'dash-card-fx\')">' +
                '<span class="dash-card-title"><i class="fas fa-money-bill-wave"></i> نرخ ارز</span>' +
                '<span style="display:inline-flex;align-items:center;gap:10px;">' +
                    '<i class="fas fa-pen csx-edit-btn" title="مدیریت ارزها و نرخ‌ها" ' +
                        'onclick="event.stopPropagation(); CurrencySystem.openModal();"></i>' +
                    '<i class="fas fa-chevron-down dash-card-chevron"></i>' +
                '</span>' +
            '</div>' +
            '<div class="dash-card-body"><div id="csx-rate-body" class="csx-rate-wrap"></div></div>';

        var spacer = document.createElement('div');
        spacer.className = 'csx-info-spacer';

        // کارت در ابتدای ستون، سپس spacer تا کارت‌های موجود به پایین رانده شوند
        col.insertBefore(card, col.firstChild);
        col.insertBefore(spacer, card.nextSibling);

        renderRateCard();
        return true;
    }

    // رندر محتوای کارت نرخ ارز (مانند تصویر مرجع: ارزها | واحد | خرید | فروش)
    function renderRateCard() {
        var body = document.getElementById('csx-rate-body');
        if (!body) return;
        var rates = CS.getRates();
        if (!rates.length) {
            body.innerHTML = '<div class="csx-rate-empty">' +
                '<i class="fas fa-info-circle"></i> هنوز نرخی ثبت نشده است. برای افزودن روی <i class="fas fa-pen"></i> کلیک کنید.' +
                '</div>';
            return;
        }
        var html = '<div class="csx-rate-head">' +
                        '<span>ارزها</span><span>واحد</span><span>خرید</span><span>فروش</span>' +
                   '</div>';
        rates.forEach(function (r) {
            var cf = CS.getCurrency(r.from) || { code: r.from, nameLocal: r.from };
            var ct = CS.getCurrency(r.to)   || { code: r.to,   nameLocal: r.to };
            html += '<div class="csx-rate-row">' +
                        '<div class="csx-rate-pair">' +
                            '<span class="csx-pp">' + _esc(ct.code) + ' ⇄ ' + _esc(cf.code) + '</span>' +
                            '<span class="csx-ps">' + _esc(ct.nameLocal) + ' / ' + _esc(cf.nameLocal) + '</span>' +
                        '</div>' +
                        '<div class="csx-rate-cell csx-rate-unit">' + _fmt(r.rate) + '</div>' +
                        '<div class="csx-rate-cell csx-rate-buy">'  + _fmt(r.buy)  + '</div>' +
                        '<div class="csx-rate-cell csx-rate-sell">' + _fmt(r.sell) + '</div>' +
                    '</div>';
        });
        body.innerHTML = html;
        if (typeof applyNumberSystemToDocument === 'function') { try { applyNumberSystemToDocument(); } catch (e) {} }
    }

    function _fmt(n) {
        n = _num(n);
        if (n === 0) return '0';
        var s = (Math.round(n * 10000) / 10000).toString();
        return s;
    }

    // ---------------------------------------------------------------------------
    // فورم مدیریت (استایل «فورم تراکنش گدام» — کلاس‌های wh-transfer-*)
    // دو بخش: «ارز جدید» و «نرخ ارز جدید»
    // ---------------------------------------------------------------------------
    function _closeCurrencyModal() {
        var m = document.getElementById('csx-modal');
        if (m && m.parentNode) m.parentNode.removeChild(m);
    }
    window._closeCurrencyModal = _closeCurrencyModal;

    function _currencyOptions(selectedFrom, selectedTo) {
        var list = CS.getCurrencies();
        var from = list.map(function (c) {
            return '<option value="' + _esc(c.code) + '"' + (c.code === selectedFrom ? ' selected' : '') + '>' +
                _esc(c.code) + ' - ' + _esc(c.nameLocal) + '</option>';
        }).join('');
        var to = list.map(function (c) {
            return '<option value="' + _esc(c.code) + '"' + (c.code === selectedTo ? ' selected' : '') + '>' +
                _esc(c.code) + ' - ' + _esc(c.nameLocal) + '</option>';
        }).join('');
        return { from: from, to: to };
    }

    // گزینه‌های Dropdownِ ارز پایه (ارزِ فعلیِ پایه پیش‌فرض انتخاب می‌شود)
    function _baseOptions(selected) {
        return CS.getCurrencies().map(function (c) {
            return '<option value="' + _esc(c.code) + '"' + (c.code === selected ? ' selected' : '') + '>' +
                _esc(c.code) + ' - ' + _esc(c.nameLocal) + '</option>';
        }).join('');
    }

    function openCurrencyModal() {
        injectStyles();
        _closeCurrencyModal();

        var base = _baseCode();
        var list = CS.getCurrencies();
        var defFrom = base;
        var defTo = (list.find(function (c) { return c.code !== base; }) || list[0] || { code: base }).code;
        var opts = _currencyOptions(defFrom, defTo);

        var overlay = document.createElement('div');
        overlay.className = 'wh-transfer-overlay';
        overlay.id = 'csx-modal';
        overlay.innerHTML =
            '<div class="wh-transfer-box">' +
                '<div class="wh-transfer-head">' +
                    '<span class="wh-transfer-title"><i class="fas fa-money-bill-wave"></i> مدیریت ارزها و نرخ‌ها</span>' +
                    '<button type="button" class="wh-transfer-x" onclick="_closeCurrencyModal()" title="بستن"><i class="fas fa-times"></i></button>' +
                '</div>' +
                '<div class="wh-transfer-bodyc">' +
                    // ---------- انتخابِ ارز پایه ----------
                    '<div class="csx-panel csx-base-panel">' +
                        '<div class="csx-panel-title"><i class="fas fa-star"></i> ارز پایه (مبنای همهٔ محاسبات و گزارش‌ها)</div>' +
                        '<div class="csx-panel-body">' +
                            '<div class="csx-base-row">' +
                                '<select id="csx-base-select">' + _baseOptions(base) + '</select>' +
                                '<button type="button" class="csx-submit" id="csx-base-submit" onclick="_csxSetBase()"><i class="fas fa-check"></i> تعیین ارز پایه</button>' +
                            '</div>' +
                            '<div class="csx-base-hint">ارز فعلیِ پایه: <b id="csx-base-current">' + base + '</b> — با تغییرِ آن، همهٔ معادل‌سازی‌ها و ستونِ «ارز پایه» بر اساسِ ارزِ جدید محاسبه می‌شوند. نرخ‌های ثبت‌شده بازتعریف نمی‌شوند.</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="csx-two-col">' +

                        // ---------- بخش ۱: ارز جدید ----------
                        '<div class="csx-panel">' +
                            '<div class="csx-panel-title"><i class="fas fa-coins"></i> ارز جدید</div>' +
                            '<div class="csx-panel-body">' +
                                '<div class="csx-grid2">' +
                                    '<div class="wh-tr-field">' +
                                        '<label><i class="fas fa-font"></i> نام محلی *</label>' +
                                        '<input type="text" id="csx-cur-namelocal" placeholder="نام محلی">' +
                                    '</div>' +
                                    '<div class="wh-tr-field">' +
                                        '<label><i class="fas fa-language"></i> نام انگلیسی</label>' +
                                        '<input type="text" id="csx-cur-nameen" placeholder="English name">' +
                                    '</div>' +
                                    '<div class="wh-tr-field">' +
                                        '<label><i class="fas fa-hashtag"></i> کد *</label>' +
                                        '<input type="text" id="csx-cur-code" placeholder="مثلاً IRT" maxlength="6">' +
                                    '</div>' +
                                    '<div class="wh-tr-field">' +
                                        '<label><i class="fas fa-dollar-sign"></i> نماد</label>' +
                                        '<input type="text" id="csx-cur-symbol" placeholder="نماد" maxlength="4">' +
                                    '</div>' +
                                '</div>' +
                                '<div class="csx-btn-row">' +
                                    '<button type="button" class="csx-submit" id="csx-cur-submit" onclick="_csxSubmitCurrency()"><i class="fas fa-check"></i> ثبت ارز</button>' +
                                    '<button type="button" class="csx-cancel-edit" id="csx-cur-cancel" style="display:none;" onclick="_csxResetCurrencyForm()"><i class="fas fa-times"></i> لغو ویرایش</button>' +
                                '</div>' +
                                '<div id="csx-cur-list" class="csx-list"></div>' +
                            '</div>' +
                        '</div>' +

                        // ---------- بخش ۲: نرخ ارز جدید ----------
                        '<div class="csx-panel">' +
                            '<div class="csx-panel-title"><i class="fas fa-exchange-alt"></i> نرخ ارز جدید</div>' +
                            '<div class="csx-panel-body">' +
                                '<div class="csx-grid2">' +
                                    '<div class="wh-tr-field">' +
                                        '<label><i class="fas fa-arrow-right"></i> از ارز *</label>' +
                                        '<select id="csx-rate-from">' + opts.from + '</select>' +
                                    '</div>' +
                                    '<div class="wh-tr-field">' +
                                        '<label><i class="fas fa-arrow-left"></i> به ارز *</label>' +
                                        '<select id="csx-rate-to">' + opts.to + '</select>' +
                                    '</div>' +
                                    '<div class="wh-tr-field">' +
                                        '<label><i class="fas fa-balance-scale"></i> نرخ *</label>' +
                                        '<input type="number" id="csx-rate-rate" step="0.0001" placeholder="نرخ">' +
                                    '</div>' +
                                    '<div class="wh-tr-field">' +
                                        '<label><i class="fas fa-arrow-down" style="color:#dc2626;"></i> نرخ خرید</label>' +
                                        '<input type="number" id="csx-rate-buy" step="0.0001" placeholder="نرخ خرید">' +
                                    '</div>' +
                                    '<div class="wh-tr-field">' +
                                        '<label><i class="fas fa-arrow-up" style="color:#10b981;"></i> نرخ فروش</label>' +
                                        '<input type="number" id="csx-rate-sell" step="0.0001" placeholder="نرخ فروش">' +
                                    '</div>' +
                                '</div>' +
                                '<div class="csx-btn-row">' +
                                    '<button type="button" class="csx-submit" id="csx-rate-submit" onclick="_csxSubmitRate()"><i class="fas fa-check"></i> ثبت نرخ</button>' +
                                    '<button type="button" class="csx-cancel-edit" id="csx-rate-cancel" style="display:none;" onclick="_csxResetRateForm()"><i class="fas fa-times"></i> لغو ویرایش</button>' +
                                '</div>' +
                                '<div id="csx-rate-list" class="csx-list"></div>' +
                            '</div>' +
                        '</div>' +

                    '</div>' +
                '</div>' +
                '<div class="wh-transfer-foot">' +
                    '<button type="button" class="wh-tr-cancel" onclick="_closeCurrencyModal()"><i class="fas fa-times"></i> بستن</button>' +
                '</div>' +
            '</div>';
        overlay.addEventListener('click', function (e) { if (e.target === overlay) _closeCurrencyModal(); });
        document.body.appendChild(overlay);
        renderModalLists();
        if (typeof applyNumberSystemToDocument === 'function') { try { applyNumberSystemToDocument(); } catch (e) {} }
    }
    window.openCurrencyModal = openCurrencyModal;

    // رندر لیست ارزها و نرخ‌های موجود داخل مودال
    function renderModalLists() {
        var curBox = document.getElementById('csx-cur-list');
        if (curBox) {
            var currencies = CS.getCurrencies();
            var base = _baseCode();
            curBox.innerHTML = currencies.map(function (c) {
                var isBase = (c.code === base);
                return '<div class="csx-chip">' +
                        '<div class="csx-chip-main">' + _esc(c.nameLocal) +
                            (isBase ? ' <span style="color:#10b981;font-size:.7rem;">(پایه)</span>' : '') +
                            '<span class="csx-chip-sub">' + _esc(c.code) + (c.symbol ? ' · ' + _esc(c.symbol) : '') + '</span>' +
                        '</div>' +
                        '<div class="csx-chip-actions">' +
                            '<button type="button" class="csx-chip-edit" title="ویرایش" onclick="_csxStartEditCurrency(\'' + _esc(c.code) + '\')"><i class="fas fa-pen"></i></button>' +
                            (isBase
                                ? '<button type="button" class="csx-chip-del" title="برای حذف، ابتدا ارز پایه را تغییر دهید" onclick="_csxDelBaseHint()"><i class="fas fa-trash"></i></button>'
                                : '<button type="button" class="csx-chip-del" title="حذف" onclick="_csxDelCurrency(\'' + _esc(c.code) + '\')"><i class="fas fa-trash"></i></button>') +
                        '</div>' +
                    '</div>';
            }).join('');
        }
        var rateBox = document.getElementById('csx-rate-list');
        if (rateBox) {
            var rates = CS.getRates();
            if (!rates.length) {
                rateBox.innerHTML = '<div class="csx-list-empty">هنوز نرخی ثبت نشده است.</div>';
            } else {
                rateBox.innerHTML = rates.map(function (r) {
                    var cf = CS.getCurrency(r.from) || { code: r.from, nameLocal: r.from };
                    var ct = CS.getCurrency(r.to)   || { code: r.to,   nameLocal: r.to };
                    return '<div class="csx-chip">' +
                            '<div class="csx-chip-main">' + _esc(cf.nameLocal) + ' → ' + _esc(ct.nameLocal) +
                                '<span class="csx-chip-sub">نرخ ' + _fmt(r.rate) + ' · خرید ' + _fmt(r.buy) + ' · فروش ' + _fmt(r.sell) + '</span>' +
                            '</div>' +
                            '<div class="csx-chip-actions">' +
                                '<button type="button" class="csx-chip-edit" title="ویرایش" onclick="_csxStartEditRate(\'' + _esc(r.id) + '\')"><i class="fas fa-pen"></i></button>' +
                                '<button type="button" class="csx-chip-del" title="حذف" onclick="_csxDelRate(\'' + _esc(r.id) + '\')"><i class="fas fa-trash"></i></button>' +
                            '</div>' +
                        '</div>';
                }).join('');
            }
        }
        if (typeof applyNumberSystemToDocument === 'function') { try { applyNumberSystemToDocument(); } catch (e) {} }
    }
    window.renderModalLists = renderModalLists;

    function _toast(msg, type) {
        if (typeof showToast === 'function') { try { showToast(msg, type); return; } catch (e) {} }
        try { console.log(msg); } catch (e) {}
    }

    // ---------- وضعیت ویرایش ----------
    var _editCurrencyCode = null;   // اگر مقدار داشته باشد، فورمِ ارز در حالت ویرایش است
    var _editRateId = null;         // اگر مقدار داشته باشد، فورمِ نرخ در حالت ویرایش است

    function _valById(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    function _setById(id, v) { var el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); }
    function _showById(id, show) { var el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; }
    function _htmlById(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }

    // ---------- ثبت/ویرایشِ ارز ----------
    function _csxSubmitCurrency() {
        var nameLocal = _valById('csx-cur-namelocal');
        var nameEn    = _valById('csx-cur-nameen');
        var code      = _valById('csx-cur-code');
        var symbol    = _valById('csx-cur-symbol');
        if (!nameLocal.trim()) { _toast('نام محلی الزامی است', 'error'); return; }

        if (_editCurrencyCode) {
            // حالت ویرایش (کد به‌عنوان شناسه ثابت می‌ماند)
            var ru = CS.updateCurrency(_editCurrencyCode, { nameLocal: nameLocal, nameEn: nameEn, symbol: symbol });
            if (!ru.ok) { _toast(ru.msg || 'خطا در ویرایش ارز', 'error'); return; }
            _csxResetCurrencyForm();
            _refreshModalRateSelects();
            _toast('ارز ویرایش شد', 'success');
            return;
        }
        // حالت افزودن
        if (!code.trim()) { _toast('کد ارز الزامی است', 'error'); return; }
        var res = CS.addCurrency({ nameLocal: nameLocal, nameEn: nameEn, code: code, symbol: symbol });
        if (!res.ok) { _toast(res.msg || 'خطا در ثبت ارز', 'error'); return; }
        _csxResetCurrencyForm();
        _refreshModalRateSelects();
        _toast('ارز جدید ثبت شد', 'success');
    }
    window._csxSubmitCurrency = _csxSubmitCurrency;

    // تعیینِ ارز پایه از داخلِ مودال
    function _csxSetBase() {
        var code = _valById('csx-base-select');
        if (!code) { _toast('یک ارز را انتخاب کنید', 'error'); return; }
        if (code === _baseCode()) { _toast('همین ارز از قبل پایه است', 'info'); return; }
        var res = CS.setBaseCode(code);
        if (!res.ok) { _toast(res.msg || 'خطا در تعیین ارز پایه', 'error'); return; }
        // به‌روزرسانیِ نمایشِ مودال و انتخابگرهای نرخ (چون «از/به» به پایه وابسته‌اند)
        var cur = document.getElementById('csx-base-current');
        if (cur) cur.textContent = code;
        try { _refreshModalRateSelects(); } catch (e) {}
        try { renderModalLists(); } catch (e) {}
        // به‌روزرسانیِ گزارش‌ها/داشبورد اگر توابعشان موجود باشند
        try { if (typeof window.updateDashboardCards === 'function') updateDashboardCards(); } catch (e) {}
        try { if (typeof window.loadDashboard === 'function') loadDashboard(); } catch (e) {}
        _toast('ارز پایه به ' + code + ' تغییر کرد', 'success');
    }
    window._csxSetBase = _csxSetBase;

    function _csxStartEditCurrency(code) {
        var c = CS.getCurrency(code);
        if (!c) { _toast('ارز یافت نشد', 'error'); return; }
        _editCurrencyCode = code;
        _setById('csx-cur-namelocal', c.nameLocal || '');
        _setById('csx-cur-nameen', c.nameEn || '');
        _setById('csx-cur-code', c.code || '');
        _setById('csx-cur-symbol', c.symbol || '');
        var codeEl = document.getElementById('csx-cur-code');
        if (codeEl) { codeEl.readOnly = true; codeEl.classList.add('csx-readonly'); }  // کد شناسه است و در ویرایش تغییر نمی‌کند
        _htmlById('csx-cur-submit', '<i class="fas fa-save"></i> ذخیره ویرایش');
        _showById('csx-cur-cancel', true);
    }
    window._csxStartEditCurrency = _csxStartEditCurrency;

    function _csxResetCurrencyForm() {
        _editCurrencyCode = null;
        ['csx-cur-namelocal', 'csx-cur-nameen', 'csx-cur-code', 'csx-cur-symbol'].forEach(function (id) { _setById(id, ''); });
        var codeEl = document.getElementById('csx-cur-code');
        if (codeEl) { codeEl.readOnly = false; codeEl.classList.remove('csx-readonly'); }
        _htmlById('csx-cur-submit', '<i class="fas fa-check"></i> ثبت ارز');
        _showById('csx-cur-cancel', false);
    }
    window._csxResetCurrencyForm = _csxResetCurrencyForm;

    // ---------- ثبت/ویرایشِ نرخ ----------
    function _csxSubmitRate() {
        var from = _valById('csx-rate-from');
        var to   = _valById('csx-rate-to');
        var rate = _valById('csx-rate-rate');
        var buy  = _valById('csx-rate-buy');
        var sell = _valById('csx-rate-sell');
        if (!from || !to) { _toast('ارز مبدأ و مقصد الزامی است', 'error'); return; }
        if (from === to) { _toast('ارز مبدأ و مقصد نباید یکسان باشد', 'error'); return; }

        if (_editRateId) {
            var ru = CS.updateRate(_editRateId, { from: from, to: to, rate: rate, buy: buy, sell: sell });
            if (!ru.ok) { _toast(ru.msg || 'خطا در ویرایش نرخ', 'error'); return; }
            _csxResetRateForm();
            _toast('نرخ ویرایش شد', 'success');
            return;
        }
        var res = CS.addRate({ from: from, to: to, rate: rate, buy: buy, sell: sell });
        if (!res.ok) { _toast(res.msg || 'خطا در ثبت نرخ', 'error'); return; }
        _csxResetRateForm();
        _toast('نرخ ارز ثبت شد', 'success');
    }
    window._csxSubmitRate = _csxSubmitRate;

    function _csxStartEditRate(id) {
        var r = null, rates = CS.getRates();
        for (var i = 0; i < rates.length; i++) { if (rates[i].id === id) { r = rates[i]; break; } }
        if (!r) { _toast('نرخ یافت نشد', 'error'); return; }
        _editRateId = id;
        // اطمینان از وجودِ گزینه‌های درست در Dropdownها، سپس انتخابِ مقادیر
        var opts = _currencyOptions(r.from, r.to);
        _htmlById('csx-rate-from', opts.from);
        _htmlById('csx-rate-to', opts.to);
        _setById('csx-rate-from', r.from);
        _setById('csx-rate-to', r.to);
        _setById('csx-rate-rate', r.rate);
        _setById('csx-rate-buy', r.buy);
        _setById('csx-rate-sell', r.sell);
        _htmlById('csx-rate-submit', '<i class="fas fa-save"></i> ذخیره ویرایش');
        _showById('csx-rate-cancel', true);
        if (typeof applyNumberSystemToDocument === 'function') { try { applyNumberSystemToDocument(); } catch (e) {} }
    }
    window._csxStartEditRate = _csxStartEditRate;

    function _csxResetRateForm() {
        _editRateId = null;
        ['csx-rate-rate', 'csx-rate-buy', 'csx-rate-sell'].forEach(function (id) { _setById(id, ''); });
        _htmlById('csx-rate-submit', '<i class="fas fa-check"></i> ثبت نرخ');
        _showById('csx-rate-cancel', false);
    }
    window._csxResetRateForm = _csxResetRateForm;

    // ---------- حذف ----------
    function _csxDelCurrency(code) {
        if (_editCurrencyCode === code) _csxResetCurrencyForm();
        var res = CS.removeCurrency(code);
        if (!res.ok) { _toast(res.msg || 'حذف ممکن نیست', 'error'); return; }
        _refreshModalRateSelects();
        _toast('ارز حذف شد', 'success');
    }
    window._csxDelCurrency = _csxDelCurrency;

    // راهنما هنگام تلاش برای حذفِ ارزِ پایه: باید ابتدا ارزِ پایه به ارزِ دیگری تغییر کند.
    function _csxDelBaseHint() {
        try {
            var msg = 'این ارز در حال حاضر «ارز پایه» است و نمی‌توان مستقیماً حذفش کرد.\n\n' +
                      'برای حذف: ابتدا از بخش «ارز پایه» در همین کارت، ارزِ دیگری را به‌عنوان ارز پایه انتخاب و تعیین کنید، سپس این ارز قابل حذف خواهد بود.';
            if (typeof window.showMessage === 'function') window.showMessage('ارز پایه', msg);
            else alert(msg);
            // تلاش برای فوکوس روی انتخابگرِ ارز پایه
            var sel = document.getElementById('csx-base-select');
            if (sel && sel.focus) { try { sel.focus(); } catch (e) {} }
        } catch (e) {}
    }
    window._csxDelBaseHint = _csxDelBaseHint;

    function _csxDelRate(id) {
        if (_editRateId === id) _csxResetRateForm();
        CS.removeRate(id);
        _toast('نرخ حذف شد', 'success');
    }
    window._csxDelRate = _csxDelRate;

    // به‌روزرسانی Dropdownهای «از ارز/به ارز» داخل مودال پس از افزودن/حذف ارز
    function _refreshModalRateSelects() {
        var fromSel = document.getElementById('csx-rate-from');
        var toSel   = document.getElementById('csx-rate-to');
        if (!fromSel || !toSel) return;
        var curFrom = fromSel.value, curTo = toSel.value;
        var opts = _currencyOptions(curFrom, curTo);
        fromSel.innerHTML = opts.from;
        toSel.innerHTML = opts.to;
        if (typeof applyNumberSystemToDocument === 'function') { try { applyNumberSystemToDocument(); } catch (e) {} }
    }

    // ---------------------------------------------------------------------------
    // راه‌اندازی
    // ---------------------------------------------------------------------------
    // مهاجرتِ مدلِ چند-ارزیِ اجناس (مرحلهٔ ۱) — یک‌بار، غیرمخرب، بی‌خطر برای اجرای مکرر.
    function migrateProductModel() {
        try {
            if (window.db && typeof db.migrateProductCurrencyModel === 'function') {
                db.migrateProductCurrencyModel();
            }
        } catch (e) {}
    }

    // مهاجرتِ مدلِ موجودیِ صندوق به نگاشتِ چند-ارزی (balances) — غیرمخرب، بی‌خطر برای اجرای مکرر.
    function migrateCashboxModel() {
        try {
            if (window.db && typeof db.migrateCashboxBalancesModel === 'function') {
                db.migrateCashboxBalancesModel();
            }
        } catch (e) {}
    }

    function boot() {
        injectStyles();
        migrateProductModel();
        migrateCashboxModel();
        // پاک‌سازیِ نرخ‌های تکراری/معکوسِ متناقض (منشأِ تداخلِ محاسباتی میانِ ارزها)
        try { CS.dedupeRates(); } catch (e) {}
        var tries = 0;
        (function tryInject() {
            var ok = injectDashboardCard();
            CS.populateDropdowns();
            if (!ok && tries < 40) { tries++; setTimeout(tryInject, 150); }
        })();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
    window.addEventListener('load', function () {
        setTimeout(boot, 200);
    });

    // هنگام تغییر داده‌ها یا بازگشت به داشبورد، کارت و Dropdownها تازه شوند
    window.addEventListener('jouya-data-change', function () {
        injectDashboardCard();
        renderRateCard();
        CS.populateDropdowns();
    });

    console.log('%c✅ سیستم مرکزی ارزها فعال شد', 'color:#fff; background:#1e3a5f; padding:5px; border-radius:4px;');
})();

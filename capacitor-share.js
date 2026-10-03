/**
 * capacitor-share.js — اشتراکِ فایلِ PDF در اپلیکیشنِ اندروید (فروشگاه جویا)
 * =============================================================================
 * لایهٔ کاملاً افزودنی و مستقل (مثلِ capacitor-back.js). هیچ فایلِ دیگری را تغییر نمی‌دهد.
 *
 * مشکل: در نسخهٔ وب، دکمهٔ «ارسال به واتساپ» از navigator.share استفاده می‌کند و درست
 * کار می‌کند. ولی داخلِ WebViewِ Capacitor (اپلیکیشنِ اندروید)، navigator.share «وجود
 * دارد» اما اشتراکِ فایل را عملاً انجام نمی‌دهد؛ پس کار به فالبکِ «ذخیره در دانلودها»
 * می‌افتد و پنجرهٔ اشتراکِ واتساپ باز نمی‌شود.
 *
 * راهِ حل (همان کاری که نسخهٔ Tauri با پنلِ اشتراکِ ویندوز می‌کند، ولی برای اندروید):
 *   ۱) فایلِ PDF را روی حافظهٔ موقتِ دستگاه می‌نویسیم (@capacitor/filesystem)
 *   ۲) نشانیِ فایل (file URI) را می‌گیریم
 *   ۳) پنلِ اشتراکِ نیتیوِ اندروید را با همان فایل باز می‌کنیم (@capacitor/share)
 *      → واتساپ و بقیهٔ برنامه‌ها در همان پنل ظاهر می‌شوند.
 *
 * فقط روی «اندرویدِ نیتیو» فعال است؛ روی وب/آیفون/Tauri هیچ کاری نمی‌کند و مسیرهای
 * قبلیِ برنامه دست‌نخورده باقی می‌مانند.
 * =============================================================================
 */
(function () {
    'use strict';

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

    function plugins() {
        try { return (window.Capacitor && window.Capacitor.Plugins) || null; } catch (e) { return null; }
    }

    // آیا افزونه‌های لازم در این بیلد هستند؟
    function isReady() {
        var P = plugins();
        return !!(isAndroidNative() && P && P.Filesystem && P.Share);
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            try {
                var fr = new FileReader();
                fr.onload = function () {
                    var s = String(fr.result || '');
                    var i = s.indexOf(',');
                    resolve(i >= 0 ? s.slice(i + 1) : s);   // حذفِ پیشوندِ data:...;base64,
                };
                fr.onerror = function () { reject(new Error('خواندنِ فایل ناموفق بود')); };
                fr.readAsDataURL(blob);
            } catch (e) { reject(e); }
        });
    }

    // نامِ فایلِ امن برای سیستمِ فایلِ اندروید
    function safeName(name) {
        var n = String(name || 'document.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
        if (!n) n = 'document.pdf';
        if (!/\.pdf$/i.test(n)) n += '.pdf';
        return n;
    }

    /**
     * نوشتنِ PDF روی دستگاه و بازکردنِ پنلِ اشتراکِ اندروید.
     * @returns Promise — موفق: پنل باز شد | رد: پیامِ خطا (تماس‌گیرنده فالبک می‌کند)
     */
    function sharePdfBlob(blob, fileName, title) {
        var P = plugins();
        if (!isAndroidNative()) return Promise.reject(new Error('اندرویدِ نیتیو نیست'));
        if (!P || !P.Filesystem || !P.Share) return Promise.reject(new Error('افزونه‌های اشتراک در این بیلد نیستند'));
        if (!blob) return Promise.reject(new Error('فایلِ PDF خالی است'));

        var name = safeName(fileName);
        // چند پوشه را به ترتیب امتحان می‌کنیم: اگر FileProvider یکی را پوشش ندهد،
        // بعدی امتحان می‌شود. CACHE اول است چون به هیچ اجازه‌ای نیاز ندارد.
        var DIRS = ['CACHE', 'DOCUMENTS', 'EXTERNAL', 'DATA'];
        var errs = [];

        function tryDir(b64, i) {
            if (i >= DIRS.length) {
                return Promise.reject(new Error('نوشتنِ فایل در هیچ پوشه‌ای ممکن نشد — ' + errs.join(' | ')));
            }
            var dir = DIRS[i];
            return P.Filesystem.writeFile({ path: name, data: b64, directory: dir, recursive: true })
                .then(function () { return P.Filesystem.getUri({ path: name, directory: dir }); })
                .then(function (r) {
                    var uri = r && (r.uri || r.path);
                    if (!uri) throw new Error('بدونِ uri');
                    return uri;
                })
                .catch(function (e) {
                    errs.push(dir + ': ' + ((e && (e.message || e.errorMessage)) || e));
                    return tryDir(b64, i + 1);
                });
        }

        return blobToBase64(blob)
            .then(function (b64) { return tryDir(b64, 0); })
            .then(function (uri) {
                return P.Share.share({
                    title: String(title || 'گزارش'),
                    files: [uri]
                });
            });
    }

    // ── ذخیرهٔ یک فایلِ متنی روی دستگاه (برای گزارشِ تشخیصی) ─────────────────────
    //  در WebViewِ اندروید، دانلودِ مرورگری (<a download>) هیچ فایلی نمی‌سازد و بی‌صدا
    //  شکست می‌خورد؛ پس فایل باید با Filesystem نوشته شود. پوشه‌های «قابلِ دیدن برای
    //  کاربر» اول امتحان می‌شوند تا بتواند فایل را پیدا و ارسال کند.
    function saveText(fileName, text) {
        var P = plugins();
        if (!P || !P.Filesystem) return Promise.reject(new Error('افزونهٔ Filesystem در دسترس نیست'));
        var name = String(fileName || 'log.txt').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
        var DIRS = ['DOCUMENTS', 'EXTERNAL', 'CACHE', 'DATA'];
        var errs = [];
        function tryDir(i) {
            if (i >= DIRS.length) return Promise.reject(new Error('نوشتنِ فایل ممکن نشد — ' + errs.join(' | ')));
            var dir = DIRS[i];
            return P.Filesystem.writeFile({ path: name, data: String(text || ''), directory: dir, encoding: 'utf8', recursive: true })
                .then(function () { return P.Filesystem.getUri({ path: name, directory: dir }); })
                .then(function (r) { return { uri: (r && (r.uri || r.path)) || '', dir: dir, name: name }; })
                .catch(function (e) {
                    errs.push(dir + ': ' + ((e && (e.message || e.errorMessage)) || e));
                    return tryDir(i + 1);
                });
        }
        return tryDir(0);
    }

    // نوشتنِ فایلِ متنی و بازکردنِ پنلِ اشتراک (برای فرستادنِ گزارش به پشتیبانی)
    function shareText(fileName, text, title) {
        var P = plugins();
        if (!P || !P.Share) return Promise.reject(new Error('افزونهٔ Share در دسترس نیست'));
        return saveText(fileName, text).then(function (res) {
            if (!res || !res.uri) throw new Error('نشانیِ فایل به‌دست نیامد');
            return P.Share.share({ title: String(title || 'گزارشِ تشخیصی'), files: [res.uri] });
        });
    }

    window.JouyaCapShare = {
        isAndroidNative: isAndroidNative,
        isReady: isReady,
        sharePdfBlob: sharePdfBlob,
        hasFilesystem: function () { var P = plugins(); return !!(P && P.Filesystem); },
        hasShare: function () { var P = plugins(); return !!(P && P.Share); },
        saveText: saveText,
        shareText: shareText
    };
})();

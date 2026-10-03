/**
 * capacitor-share.js — اشتراکِ فایلِ PDF در اپلیکیشنِ اندروید (فروشگاه جویا)
 * =============================================================================
 * لایهٔ کاملاً افزودنی و مستقل. هیچ فایلِ دیگری را تغییر نمی‌دهد و فقط روی
 * «اندرویدِ نیتیو (Capacitor)» فعال است؛ وب/آیفون/Tauri دست‌نخورده می‌مانند.
 *
 * ── چرا لازم است؟ ───────────────────────────────────────────────────────────
 * در WebViewِ اندروید:
 *   • اشتراکِ «متن» کار می‌کند  → برای همین «ارسالِ بیلانسِ شخص» درست کار می‌کند.
 *   • اشتراکِ «فایل» (navigator.share با files) پشتیبانی نمی‌شود → ارسالِ PDF شکست
 *     می‌خورد و به فالبکِ «ذخیرهٔ فایل» می‌افتد که آن هم در WebView کار نمی‌کند.
 * پس برای فرستادنِ PDF باید از افزونه‌های نیتیوِ Capacitor استفاده شود.
 *
 * ── نکتهٔ کلیدیِ دسترسی به افزونه‌ها ─────────────────────────────────────────
 * این پروژه باندلر ندارد و بسته‌های JSِ افزونه‌ها import نمی‌شوند؛ بنابراین
 * window.Capacitor.Plugins.Share ممکن است «تعریف‌نشده» باشد حتی وقتی افزونهٔ نیتیو
 * درست نصب شده است. برای همین اینجا به یک راه تکیه نمی‌کنیم و سه راهِ دسترسی را
 * به‌ترتیب امتحان می‌کنیم:
 *   ۱) window.Capacitor.Plugins.<نام>        (راهِ استاندارد)
 *   ۲) window.Capacitor.registerPlugin(<نام>) (ثبتِ دستی بدونِ نیاز به بستهٔ JS)
 *   ۳) window.Capacitor.nativePromise(...)    (پلِ سطح‌پایینِ خودِ Capacitor)
 * با این کار، تا وقتی افزونهٔ نیتیو در بیلد باشد، حتماً یکی از این سه راه جواب می‌دهد.
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

    // ── فراخوانیِ یک متدِ افزونه با سه راهبردِ پشتِ‌سرِهم ──────────────────────────
    var _registered = {};
    function callPlugin(plugin, method, options) {
        var C = window.Capacitor;
        if (!C) return Promise.reject(new Error('Capacitor موجود نیست'));
        var errs = [];

        // ۱) راهِ استاندارد
        try {
            var P = C.Plugins && C.Plugins[plugin];
            if (P && typeof P[method] === 'function') return Promise.resolve(P[method](options));
        } catch (e) { errs.push('Plugins: ' + ((e && e.message) || e)); }

        // ۲) ثبتِ دستیِ افزونه (بدونِ نیاز به بستهٔ JS)
        try {
            if (typeof C.registerPlugin === 'function') {
                if (!_registered[plugin]) _registered[plugin] = C.registerPlugin(plugin);
                var P2 = _registered[plugin];
                if (P2 && typeof P2[method] === 'function') return Promise.resolve(P2[method](options));
            }
        } catch (e) { errs.push('registerPlugin: ' + ((e && e.message) || e)); }

        // ۳) پلِ سطح‌پایینِ Capacitor
        try {
            if (typeof C.nativePromise === 'function') return Promise.resolve(C.nativePromise(plugin, method, options || {}));
        } catch (e) { errs.push('nativePromise: ' + ((e && e.message) || e)); }

        return Promise.reject(new Error('افزونهٔ ' + plugin + '.' + method + ' در دسترس نیست' + (errs.length ? ' — ' + errs.join(' | ') : '')));
    }

    // کدام راه‌ها در این دستگاه موجودند (فقط برای گزارشِ تشخیصی)
    function pluginAccess(plugin) {
        var C = window.Capacitor, out = [];
        try { if (C && C.Plugins && C.Plugins[plugin]) out.push('Plugins'); } catch (e) {}
        try { if (C && typeof C.registerPlugin === 'function') out.push('registerPlugin'); } catch (e) {}
        try { if (C && typeof C.nativePromise === 'function') out.push('nativePromise'); } catch (e) {}
        return out.length ? out.join('+') : 'none';
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            try {
                var fr = new FileReader();
                fr.onload = function () {
                    var s = String(fr.result || '');
                    var i = s.indexOf(',');
                    resolve(i >= 0 ? s.slice(i + 1) : s);
                };
                fr.onerror = function () { reject(new Error('خواندنِ فایل ناموفق بود')); };
                fr.readAsDataURL(blob);
            } catch (e) { reject(e); }
        });
    }

    function safeName(name) {
        var n = String(name || 'document.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
        if (!n) n = 'document.pdf';
        if (!/\.pdf$/i.test(n)) n += '.pdf';
        return n;
    }

    // نوشتنِ فایل روی دستگاه و گرفتنِ نشانیِ آن (چند پوشه به‌ترتیب امتحان می‌شود)
    function writeAndGetUri(name, dataBase64, isText) {
        var DIRS = isText ? ['DOCUMENTS', 'EXTERNAL', 'CACHE', 'DATA']
                          : ['CACHE', 'DOCUMENTS', 'EXTERNAL', 'DATA'];
        var errs = [];
        function tryDir(i) {
            if (i >= DIRS.length) return Promise.reject(new Error('نوشتنِ فایل ممکن نشد — ' + errs.join(' | ')));
            var dir = DIRS[i];
            var opts = { path: name, data: dataBase64, directory: dir, recursive: true };
            if (isText) opts.encoding = 'utf8';
            return callPlugin('Filesystem', 'writeFile', opts)
                .then(function () { return callPlugin('Filesystem', 'getUri', { path: name, directory: dir }); })
                .then(function (r) {
                    var uri = r && (r.uri || r.path);
                    if (!uri) throw new Error('بدونِ uri');
                    return { uri: uri, dir: dir, name: name };
                })
                .catch(function (e) {
                    errs.push(dir + ': ' + ((e && (e.message || e.errorMessage)) || e));
                    return tryDir(i + 1);
                });
        }
        return tryDir(0);
    }

    /** نوشتنِ PDF روی دستگاه و بازکردنِ پنلِ اشتراکِ اندروید (لیستِ برنامه‌ها → واتساپ) */
    function sharePdfBlob(blob, fileName, title) {
        if (!isAndroidNative()) return Promise.reject(new Error('اندرویدِ نیتیو نیست'));
        if (!blob) return Promise.reject(new Error('فایلِ PDF خالی است'));
        var name = safeName(fileName);
        return blobToBase64(blob)
            .then(function (b64) { return writeAndGetUri(name, b64, false); })
            .then(function (res) {
                return callPlugin('Share', 'share', {
                    title: String(title || 'گزارش'),
                    files: [res.uri]
                });
            });
    }

    /** ذخیرهٔ یک فایلِ متنی (گزارشِ تشخیصی) */
    function saveText(fileName, text) {
        var name = String(fileName || 'log.txt').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
        return writeAndGetUri(name, String(text || ''), true);
    }

    /** ذخیره + اشتراکِ فایلِ متنی */
    function shareText(fileName, text, title) {
        return saveText(fileName, text).then(function (res) {
            return callPlugin('Share', 'share', { title: String(title || 'گزارش'), files: [res.uri] });
        });
    }

    /** اشتراکِ «متن» با پنلِ نیتیو (فالبک وقتی اشتراکِ فایل ممکن نشد) */
    function sharePlainText(text, title) {
        return callPlugin('Share', 'share', { title: String(title || 'حسابدار'), text: String(text || '') });
    }

    window.JouyaCapShare = {
        isAndroidNative: isAndroidNative,
        // isReady عمداً فقط «اندرویدِ نیتیو بودن» را می‌سنجد: چون دسترسی به افزونه از سه
        // راه امتحان می‌شود، نبودِ Plugins.X به‌تنهایی دلیلِ ناتوانی نیست. اگر هیچ راهی
        // جواب ندهد، خودِ فراخوان rejectمی‌شود و فالبکِ برنامه اجرا می‌گردد.
        isReady: isAndroidNative,
        hasFilesystem: function () { return isAndroidNative(); },
        hasShare: function () { return isAndroidNative(); },
        pluginAccess: pluginAccess,
        callPlugin: callPlugin,
        sharePdfBlob: sharePdfBlob,
        saveText: saveText,
        shareText: shareText,
        sharePlainText: sharePlainText
    };
})();

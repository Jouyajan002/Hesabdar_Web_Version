/* ============================================================================
 *  حسابدار — پلِ نسخهٔ دسکتاپِ Tauri
 *  ---------------------------------------------------------------------------
 *  هدف: نسخهٔ دسکتاپِ سبک (Tauri) دقیقاً همان قابلیت‌هایی را داشته باشد که نسخهٔ
 *  الکترون از طریقِ window.electronAPI می‌داد — بدونِ اینکه حتی یک خط از script.js
 *  یا منطقِ برنامه تغییر کند. این فایل همان نامِ آشنا (window.electronAPI) را با
 *  پیاده‌سازیِ Tauri می‌سازد، پس همهٔ کدهای موجود بی‌تغییر کار می‌کنند.
 *
 *  رفتار در محیط‌های دیگر:
 *   • نسخهٔ الکترون → window.electronAPI از قبل توسط preload ساخته شده؛ این فایل
 *     هیچ کاری نمی‌کند (بازنویسی نمی‌شود).
 *   • نسخهٔ وب / موبایل → Tauri وجود ندارد؛ این فایل کاملاً بی‌اثر است.
 *
 *  نکتهٔ مهم: این فایل باید پیش از script.js بارگذاری شود (در index.html همین‌طور است)،
 *  چون script.js در زمانِ بارگذاری به window.electronAPI سر می‌زند.
 * ========================================================================== */
(function () {
    'use strict';

    // ── ۰) فقط داخلِ Tauri فعال شود ─────────────────────────────────────────────
    var T = (typeof window !== 'undefined') ? window.__TAURI__ : null;
    if (!T || !T.core || typeof T.core.invoke !== 'function') return;
    if (window.electronAPI) return;  // الکترون یا پلِ دیگری از قبل موجود است

    var invoke = T.core.invoke;
    function call(cmd, args) {
        try { return Promise.resolve(invoke(cmd, args || {})); }
        catch (e) { return Promise.reject(e); }
    }

    // ── ۱) مسیرِ پوشهٔ دانلود ────────────────────────────────────────────────────
    //  در کدِ موجود این تابع «همگام» صدا زده می‌شود (var dp = electronAPI.getDownloadsPath()),
    //  پس مقدار را در بوت می‌گیریم و کش می‌کنیم تا همگام برگردد.
    var _downloadsPath = '';
    var _tempPath = '';
    call('hb_downloads_dir').then(function (p) { _downloadsPath = p || ''; }).catch(function () {});
    call('hb_temp_dir').then(function (p) { _tempPath = p || ''; }).catch(function () {});

    function getDownloadsPath() { return _downloadsPath; }

    // نامِ فایلِ خالی → مسیرِ کاملِ آن در پوشهٔ دانلود
    function resolveDownload(nameOrPath) {
        var s = String(nameOrPath || '');
        if (!s) return '';
        if (/^[a-zA-Z]:[\\/]/.test(s) || s.charAt(0) === '/' || s.charAt(0) === '\\') return s;  // از قبل مسیرِ کامل است
        if (!_downloadsPath) return s;
        var sep = (_downloadsPath.indexOf('\\') > -1) ? '\\' : '/';
        return _downloadsPath.replace(/[\\/]+$/, '') + sep + s;
    }

    // ── ۲) بازکردنِ فایل / مسیر ─────────────────────────────────────────────────
    function openPath(p) {
        var full = resolveDownload(p);
        return call('hb_open_path', { path: full }).catch(function () {
            // اگر فایل پیدا نشد، حداقل پوشه را نشان بده
            return call('hb_reveal_in_dir', { path: full }).catch(function () {});
        });
    }
    function openFile(p) { return openPath(p); }

    // ── ۳) پشتیبانِ خودکار — در برنامه غیرفعال است؛ فقط برای سازگاریِ امضا ──────
    //  (در script.js این callback عمداً بدونِ عملیات است؛ پس اینجا هم چیزی صدا نمی‌شود.)
    function onRequestAutoBackup(cb) { void cb; }

    // ── ۴) ارسال PDF به واتساپ ─────────────────────────────────────────────────
    //  الکترون: HTML را در پنجرهٔ مخفی به PDF تبدیل می‌کرد (printToPDF).
    //  Tauri: همان PDF را با موتورِ خودِ برنامه می‌سازیم — __jouyaHtmlToPdfBlob که از قبل
    //  برای نسخهٔ موبایل نوشته شده و آزموده است (jsPDF + html2canvas). بعد فایل روی دیسک
    //  نوشته می‌شود، در کلیپ‌بورد قرار می‌گیرد، واتساپِ دسکتاپ باز می‌شود و پوشهٔ فایل هم
    //  نشان داده می‌شود. خروجی، دقیقاً همان شکلِ الکترون است تا پیام‌های موجود بی‌تغییر
    //  بمانند: { ok, method, path, clip, opened }.
    var PFX = [
        [/بل\s*فروش/, 'SalesInvoice'],
        [/بل\s*خرید/, 'PurchaseInvoice'],
        [/پرداخت/, 'PaymentReceipt'],
        [/دریافت/, 'ReceiptVoucher'],
        [/رسید/, 'Receipt'],
        [/گزارش/, 'Report']
    ];
    // ترجمهٔ آوایی به لاتین — چون «واتساپِ دسکتاپ» نامِ UTF-8 را با Latin-1 می‌خواند و
    // نامِ فارسی را به‌هم‌ریخته (mojibake) نشان می‌دهد. این همان رفتارِ نسخهٔ الکترون است.
    var FA2LAT = {
        'ا':'a','آ':'a','أ':'a','إ':'a','ب':'b','پ':'p','ت':'t','ث':'s','ج':'j','چ':'ch','ح':'h','خ':'kh',
        'د':'d','ذ':'z','ر':'r','ز':'z','ژ':'zh','س':'s','ش':'sh','ص':'s','ض':'z','ط':'t','ظ':'z',
        'ع':'a','غ':'gh','ف':'f','ق':'q','ک':'k','ك':'k','گ':'g','ل':'l','م':'m','ن':'n','و':'v',
        'ه':'h','ة':'h','ی':'i','ي':'i','ئ':'y','ؤ':'o','ء':'','‌':'-',
        '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'
    };
    function persianToLatin(s) {
        var out = '';
        String(s || '').split('').forEach(function (ch) {
            if (FA2LAT.hasOwnProperty(ch)) out += FA2LAT[ch];
            else if (/[a-zA-Z0-9\-_.]/.test(ch)) out += ch;
            else if (/\s/.test(ch)) out += '-';
        });
        return out.replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    }
    function safePdfName(faName) {
        var fn = String(faName || '');
        var pfx = 'Jouya';
        for (var i = 0; i < PFX.length; i++) { if (PFX[i][0].test(fn)) { pfx = PFX[i][1]; break; } }
        var lat = persianToLatin(fn);
        if (lat && lat.toLowerCase().indexOf(pfx.toLowerCase() + '-') === 0) lat = lat.slice(pfx.length + 1);
        var name = (pfx + (lat ? '-' + lat : '')).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 110);
        if (!name) name = 'Report';
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        return name;
    }

    function blobToBytes(blob) {
        return new Promise(function (resolve, reject) {
            try {
                var fr = new FileReader();
                fr.onload = function () {
                    try { resolve(Array.from(new Uint8Array(fr.result))); }
                    catch (e) { reject(e); }
                };
                fr.onerror = function () { reject(fr.error || new Error('read-failed')); };
                fr.readAsArrayBuffer(blob);
            } catch (e) { reject(e); }
        });
    }

    // مسیرِ دوم (fallback): کپیِ فایل در کلیپ‌بورد + بازکردنِ واتساپ + نشان‌دادنِ پوشه.
    function shareViaClipboard(outPath) {
        return call('hb_set_clipboard_file', { path: outPath })
            .catch(function () { return false; })
            .then(function (clip) {
                return call('hb_open_uri', { uri: 'whatsapp://' })
                    .then(function () { return { clip: !!clip, opened: true }; })
                    .catch(function () { return { clip: !!clip, opened: false }; });
            })
            .then(function (r) {
                call('hb_reveal_in_dir', { path: outPath }).catch(function () {});
                return { ok: true, method: 'clipboard', path: outPath, clip: r.clip, opened: r.opened, shareDiag: 'tauri-clipboard' };
            });
    }

    function sharePdfToWhatsApp(html, fileName) {
        if (!html) return Promise.resolve({ ok: false, error: 'no-html' });
        if (typeof window.__jouyaHtmlToPdfBlob !== 'function') {
            return Promise.resolve({ ok: false, error: 'pdf-engine-missing' });
        }
        var outPath = '';
        var faTitle = String(fileName || 'گزارش');
        return window.__jouyaHtmlToPdfBlob(html)
            .then(function (blob) {
                if (!blob) throw new Error('empty-pdf');
                return blobToBytes(blob);
            })
            .then(function (bytes) {
                return call('hb_write_file', { dest: 'temp-unique', fileName: safePdfName(fileName), bytes: bytes });
            })
            .then(function (p) {
                outPath = p || '';
                // ── مسیرِ اول: پنلِ اشتراکِ ویندوز (WinRT) — فایل از پیش پیوست می‌شود، بدونِ Ctrl+V ──
                return call('hb_share_file_win', { filePath: outPath, title: faTitle })
                    .catch(function (e) { return { ok: false, diag: 'invoke-ex:' + ((e && e.message) ? e.message : String(e)) }; });
            })
            .then(function (sres) {
                if (sres && sres.ok) {
                    return { ok: true, method: 'share', clip: false, opened: true, path: outPath, shareDiag: (sres.diag || '') };
                }
                // ── مسیرِ دوم: اگر پنلِ اشتراک در این سیستم در دسترس نبود ──
                return shareViaClipboard(outPath).then(function (r) {
                    r.shareDiag = (sres && sres.diag) ? sres.diag : 'no-share-panel';
                    return r;
                });
            })
            .catch(function (e) {
                return { ok: false, error: (e && e.message) ? e.message : String(e) };
            });
    }

    // ── ۵) ذخیرهٔ یک فایلِ دلخواه در پوشهٔ دانلود (کمکی؛ برای استفادهٔ آینده) ────
    function saveToDownloads(fileName, bytesOrBlob) {
        var step = (bytesOrBlob && typeof bytesOrBlob.arrayBuffer === 'function')
            ? blobToBytes(bytesOrBlob)
            : Promise.resolve(Array.isArray(bytesOrBlob) ? bytesOrBlob : Array.from(new Uint8Array(bytesOrBlob || [])));
        return step.then(function (bytes) {
            return call('hb_write_file', { dest: 'downloads', fileName: String(fileName || 'file'), bytes: bytes });
        });
    }

    // ── نصبِ پل با همان نامِ آشنا ───────────────────────────────────────────────
    //
    //  ⚠ نکتهٔ مهم دربارهٔ «ارسال به واتساپ»:
    //  عمداً کلیدِ sharePdfToWhatsApp اینجا قرار داده **نمی‌شود**. دلیلش این است که کدِ
    //  اورلیِ پیش‌نمایش این شرط را دارد:
    //        if (window.electronAPI && window.electronAPI.sharePdfToWhatsApp) { ... }
    //        else { mobileShareFile(); }
    //  و mobileShareFile همان مسیرِ navigator.share است که در نسخهٔ وب «پنجرهٔ فهرستِ
    //  برنامه‌ها» (Windows Share) را درست باز می‌کند. WebView2 — موتورِ نمایشِ Tauri روی
    //  ویندوز — از navigator.share با فایل پشتیبانی می‌کند، پس با نگذاشتنِ این کلید،
    //  نسخهٔ نصبی دقیقاً همان رفتارِ نسخهٔ وب را می‌گیرد: همان پنل، همان فایلِ پیوست‌شده.
    //  مسیرِ PowerShell/WinRT به‌عنوان پشتیبان زیرِ نامِ دیگری در دسترس می‌ماند.
    window.electronAPI = {
        getDownloadsPath: getDownloadsPath,
        openPath: openPath,
        openFile: openFile,
        onRequestAutoBackup: onRequestAutoBackup,
        // افزودنی‌های Tauri (اختیاری، برنامه به آن‌ها وابسته نیست)
        saveToDownloads: saveToDownloads,
        revealInDir: function (p) { return call('hb_reveal_in_dir', { path: resolveDownload(p) }); },
        openExternal: function (u) { return call('hb_open_uri', { uri: String(u || '') }); },
        getAppVersion: function () { return call('hb_app_version'); },
        // مسیرِ پشتیبانِ «پنلِ اشتراکِ ویندوز» از راهِ PowerShell/WinRT — با نامی که اورلی
        // آن را برنمی‌دارد، تا مسیرِ اصلی همان navigator.share بماند.
        sharePdfViaWindowsPanel: sharePdfToWhatsApp,
        __runtime: 'tauri'
    };
    window.__JOUYA_RUNTIME = 'tauri';

    // ── فالبکِ دانلود در نسخهٔ نصبی ────────────────────────────────────────────
    // اگر اشتراکِ نیتیو به هر دلیلی اجرا نشود، کدِ برنامه به __jouyaDownloadBlob می‌رود که
    // با <a download> کار می‌کند و در WebView ممکن است بی‌صدا هیچ نکند. اینجا همان تابع را
    // با نسخه‌ای جایگزین می‌کنیم که فایل را واقعاً در پوشهٔ دانلود می‌نویسد و پوشه را نشان
    // می‌دهد. (script.js بعد از این فایل بارگذاری می‌شود، پس پچ در DOMContentLoaded می‌نشیند.)
    function patchDownloadFallback() {
        if (typeof window.__jouyaDownloadBlob !== 'function' || window.__jouyaDownloadBlob.__tauriPatched) return;
        var original = window.__jouyaDownloadBlob;
        var patched = function (blob, filename) {
            try {
                blobToBytes(blob).then(function (bytes) {
                    return call('hb_write_file', { dest: 'downloads', fileName: String(filename || 'file.pdf'), bytes: bytes });
                }).then(function (p) {
                    call('hb_reveal_in_dir', { path: p }).catch(function () {});
                    if (typeof window.showMessage === 'function') {
                        window.showMessage('ذخیرهٔ فایل', 'فایل در پوشهٔ دانلود ذخیره شد:\n' + p);
                    }
                }).catch(function () { try { original(blob, filename); } catch (e) {} });
                return true;
            } catch (e) { return original(blob, filename); }
        };
        patched.__tauriPatched = true;
        window.__jouyaDownloadBlob = patched;
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', patchDownloadFallback);
    } else {
        patchDownloadFallback();
    }
    setTimeout(patchDownloadFallback, 1500);

    // ── قفلِ ابزارهای توسعه‌دهنده و منویِ راست‌کلیک در نسخهٔ منتشرشده ───────────
    //  در بیلدِ release خودِ Tauri کنسول را غیرفعال می‌کند؛ این‌ها لایهٔ دومِ بازدارنده‌اند
    //  تا کاربر به‌صورتِ اتفاقی به کد یا کنسول نرسد.
    try {
        document.addEventListener('contextmenu', function (e) {
            var t = e.target;
            var editable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
            if (!editable) e.preventDefault();
        }, true);
        document.addEventListener('keydown', function (e) {
            var k = (e.key || '').toLowerCase();
            var blocked =
                k === 'f12' ||
                (e.ctrlKey && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) ||
                (e.ctrlKey && k === 'u');
            if (blocked) { e.preventDefault(); e.stopPropagation(); }
        }, true);
    } catch (e) {}

    try { console.log('[hesabdar] نسخهٔ دسکتاپِ Tauri آماده است.'); } catch (e) {}
})();

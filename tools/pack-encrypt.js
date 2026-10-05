#!/usr/bin/env node
/**
 * tools/pack-encrypt.js — لایهٔ ۲: بسته‌بندیِ رمزنگاری‌شدهٔ فایل‌های JS
 * =============================================================================
 * بعد از obfuscation اجرا می‌شود. هر فایلِ JSِ برنامه در پوشهٔ خروجی (www یا dist-web)
 * با AES-256-CTR رمز می‌شود و محتوایش به یک «استاب» تبدیل می‌شود:  __jouyaDec("...رمز...")
 * و یک فایلِ رمزگشا (__jouya_dec.js) ساخته می‌شود که اول از همه بارگذاری می‌شود و هنگام
 * اجرا، هر فایل را در حافظه رمزگشایی و با «حفظِ دقیقِ ترتیب و دامنهٔ سراسری» اجرا می‌کند.
 *
 * نتیجه: روی دیسک (APK/exe/وب) محتوای هر فایلِ .js فقط «بایتِ رمزشدهٔ به‌هم‌ریخته» است؛
 * هیچ ابزار یا رباتی از رویِ فایلِ ساکن کدِ قابل‌استفاده بیرون نمی‌کشد.
 *
 * محدودیتِ صادقانه: چون برنامه باید اجرا شود، کلید در __jouya_dec.js حضور دارد (قابلِ
 * استخراج). این لایه «استخراجِ ساکن» را بی‌اثر می‌کند؛ برای عبور از آن باید برنامه را
 * اجرا و حافظه را dump کرد که سدِّ بسیار بالاتری است.
 *
 * اجرا:  node tools/pack-encrypt.js <پوشهٔ خروجی>
 * خاموش‌کردنِ فوری:  JOUYA_ENCRYPT=0  → این مرحله هیچ کاری نمی‌کند (بیلد obfuscate-only می‌ماند).
 * =============================================================================
 */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var dir = process.argv[2];
if (!dir) { console.error('[pack] پوشهٔ هدف داده نشد؛ رد شد.'); process.exit(0); }
if (process.env.JOUYA_ENCRYPT === '0') { console.log('[pack] با JOUYA_ENCRYPT=0 غیرفعال شد (فقط obfuscate).'); process.exit(0); }

// AESِ مشترک (همان که در مرورگر هم اجرا می‌شود)
var AES;
try { AES = require(path.join(__dirname, 'aesctr.js')); }
catch (e) { console.log('::warning::[pack] tools/aesctr.js پیدا نشد؛ رمزنگاری اعمال نشد.'); process.exit(0); }

// فایل‌هایی که نباید رمز شوند (بوت‌استرپ و سرویس‌ورکر)
var SKIP = { '__jouya_dec.js': 1, 'service-worker.js': 1 };

var DEC_FILENAME = '__jouya_dec.js';

function b64(buf) { return Buffer.from(buf).toString('base64'); }

var files;
try { files = fs.readdirSync(dir); }
catch (e) { console.error('[pack] خواندنِ پوشه ممکن نشد: ' + dir); process.exit(0); }

// کلیدِ تصادفیِ هر بیلد (در __jouya_dec.js جاسازی می‌شود)
var KEY = crypto.randomBytes(32);

var packed = 0, skipped = 0;
files.forEach(function (name) {
    if (!/\.js$/i.test(name)) return;
    if (SKIP[name]) { skipped++; return; }
    var full = path.join(dir, name);
    var st;
    try { st = fs.statSync(full); } catch (e) { return; }
    if (!st.isFile()) return;

    var src;
    try { src = fs.readFileSync(full); } catch (e) { return; }           // Buffer (بایت‌های UTF-8)
    if (!src || !src.length) return;
    // اگر از قبل استاب شده، دوباره کار نکن
    if (/^__jouyaDec\(/.test(src.toString('utf8', 0, 20))) { skipped++; return; }

    var iv = crypto.randomBytes(16);
    var ct = Buffer.from(AES.aesCtr(new Uint8Array(KEY), new Uint8Array(iv), new Uint8Array(src)));
    var payload = b64(Buffer.concat([iv, ct]));     // iv(16) + ciphertext → base64
    var stub = '__jouyaDec("' + payload + '");\n';
    try { fs.writeFileSync(full, stub, 'utf8'); packed++; }
    catch (e) { console.log('::warning::[pack] نوشتنِ استاب ناموفق: ' + name); }
});

// ── ساختِ فایلِ رمزگشا (__jouya_dec.js) ───────────────────────────────────────
var aesSource = fs.readFileSync(path.join(__dirname, 'aesctr.js'), 'utf8');
var keyArr = '[' + Array.prototype.join.call(KEY, ',') + ']';
var decoder =
'(function(){\n' +
'  "use strict";\n' +
'  var K = new Uint8Array(' + keyArr + ');\n' +
'  function b64ToBytes(b64){\n' +
'    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);\n' +
'    for (var i=0;i<n;i++) out[i]=bin.charCodeAt(i);\n' +
'    return out;\n' +
'  }\n' +
'  function toStr(bytes){\n' +
'    try { return new TextDecoder("utf-8").decode(bytes); }\n' +
'    catch(e){ var s=""; for(var i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]); return s; }\n' +
'  }\n' +
'  // اجرا در «دامنهٔ سراسری با رفتارِ اسکریپتِ کلاسیک» تا توابعِ سراسری (برای onclickها) تعریف شوند\n' +
'  self.__jouyaDec = function(payloadB64){\n' +
'    try {\n' +
'      var all = b64ToBytes(payloadB64);\n' +
'      var iv = all.subarray(0,16), ct = all.subarray(16);\n' +
'      var plain = self.__JouyaAES.aesCtr(K, iv, ct);\n' +
'      var code = toStr(plain);\n' +
'      var s = document.createElement("script");\n' +
'      s.text = code;\n' +
'      (document.head || document.documentElement).appendChild(s);\n' +
'      if (s.parentNode) s.parentNode.removeChild(s);\n' +
'    } catch (e) { try { console.error("dec", e); } catch(_){} }\n' +
'  };\n' +
'})();\n';

var decContent = aesSource + '\n' + decoder;

// ── مورد امنیتی: خودِ رمزگشا (که کلید در آن است) را هم obfuscate می‌کنیم تا کلید و
//    منطقِ دیکریپت «در دسترسِ ساده» نباشد. اگر obfuscator نبود یا خروجی نامعتبر شد،
//    نسخهٔ سالم (غیر-obfuscate) نوشته می‌شود تا بوت هرگز نشکند.
try {
    var JS = require('javascript-obfuscator');
    var vm = require('vm');
    var obf = JS.obfuscate(decContent, {
        compact: true, target: 'browser',
        renameGlobals: false, renameProperties: false, transformObjectKeys: false,
        identifierNamesGenerator: 'hexadecimal',
        stringArray: true, stringArrayThreshold: 1,
        stringArrayEncoding: ['rc4'], stringArrayRotate: true, stringArrayShuffle: true,
        stringArrayIndexShift: true, stringArrayWrappersCount: 2, stringArrayWrappersType: 'function',
        numbersToExpressions: true, simplify: true, selfDefending: true,
        controlFlowFlattening: false, deadCodeInjection: false,
        debugProtection: false, disableConsoleOutput: false, comments: false
    }).getObfuscatedCode();
    // اعتبارسنجیِ واقعی: کدِ obfuscate‌شده را در یک sandbox اجرا کن و مطمئن شو که هنوز
    //   self.__jouyaDec و self.__JouyaAES را تعریف می‌کند (نامِ __jouyaDec ممکن است داخلِ
    //   آرایهٔ رشتهٔ رمزشده برود، پس جست‌وجوی متنی کافی نیست — باید اجرا و بررسی شود).
    var sandboxSelf = {};
    var ctx = { self: sandboxSelf, globalThis: sandboxSelf, module: { exports: {} },
                TextDecoder: (typeof TextDecoder !== 'undefined') ? TextDecoder : function () { this.decode = function () { return ''; }; },
                atob: (typeof atob !== 'undefined') ? atob : function (b) { return Buffer.from(b, 'base64').toString('binary'); },
                document: { createElement: function () { return {}; }, head: { appendChild: function () {} } },
                console: { error: function () {}, log: function () {} } };
    vm.createContext(ctx);
    new vm.Script(obf, { filename: 'dec-check.js' }).runInContext(ctx, { timeout: 5000 });
    if (typeof sandboxSelf.__jouyaDec === 'function' && sandboxSelf.__JouyaAES && typeof sandboxSelf.__JouyaAES.aesCtr === 'function') {
        decContent = obf;
        console.log('[pack] رمزگشا obfuscate شد و در sandbox تأیید شد (کلید پنهان‌تر شد).');
    } else {
        console.log('::warning::[pack] obfuscateِ رمزگشا در sandbox تأیید نشد → نسخهٔ ساده نوشته شد.');
    }
} catch (e) {
    console.log('::warning::[pack] obfuscateِ رمزگشا انجام نشد (نسخهٔ ساده): ' + ((e && e.message) || e));
}

try {
    fs.writeFileSync(path.join(dir, DEC_FILENAME), decContent, 'utf8');
} catch (e) {
    console.log('::error::[pack] نوشتنِ ' + DEC_FILENAME + ' ناموفق بود.');
    process.exit(1);
}

console.log('[pack] پایان — رمزشده: ' + packed + ' فایل | رد: ' + skipped + ' | کلید: تصادفیِ این بیلد | رمزگشا: ' + DEC_FILENAME);

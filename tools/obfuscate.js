#!/usr/bin/env node
/**
 * tools/obfuscate.js — محافظت از سورسِ خروجیِ نصبی (Tauri / Android)
 * =============================================================================
 * این ابزار «سورسِ مخزن را تغییر نمی‌دهد». فقط در زمانِ بیلد، فایل‌های JSِ خودِ
 * برنامه را در پوشهٔ خروجی (www یا dist-web) به‌صورتِ درهم‌ریخته (obfuscated) و
 * فشرده بازنویسی می‌کند تا هرکس فایلِ نصبی را باز کند، سورسِ قابل‌خواندن نبیند.
 *
 * نکتهٔ حیاتیِ سازگاری:
 *   برنامه پر از هندلرهای درون‌خطی مثل onclick="someFunc()" است، پس نامِ توابعِ
 *   «سراسری» و نامِ «ویژگی‌ها/پراپرتی‌ها» نباید تغییر کند؛ وگرنه دکمه‌ها کار نمی‌کنند.
 *   برای همین:  renameGlobals=false , transformObjectKeys=false , renameProperties=false.
 *   فقط متغیرهای محلی درهم می‌شوند، رشته‌ها رمز می‌شوند و توضیحات حذف می‌گردند.
 *
 * ایمنیِ خودکار:
 *   خروجیِ هر فایل پیش از جایگزینی با vm.Script اعتبارسنجی می‌شود؛ اگر فایلی درست
 *   کامپایل نشد، نسخهٔ اصلی دست‌نخورده می‌ماند (بیلد نمی‌شکند).
 *
 * اجرا:  node tools/obfuscate.js <پوشهٔ خروجی>
 * غیرفعال‌سازی:  متغیرِ محیطیِ  JOUYA_OBFUSCATE=0  → این ابزار کاری نمی‌کند.
 * =============================================================================
 */
'use strict';

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');

var targetDir = process.argv[2];
if (!targetDir) { console.error('[obfuscate] پوشهٔ هدف داده نشد؛ رد شد.'); process.exit(0); }
if (process.env.JOUYA_OBFUSCATE === '0') { console.log('[obfuscate] با JOUYA_OBFUSCATE=0 غیرفعال شد.'); process.exit(0); }

var JavaScriptObfuscator;
try {
    JavaScriptObfuscator = require('javascript-obfuscator');
} catch (e) {
    console.log('::warning::[obfuscate] بستهٔ javascript-obfuscator نصب نیست؛ محافظت اعمال نشد (بیلد ادامه می‌یابد).');
    process.exit(0);
}

// فقط فایل‌های JSِ خودِ برنامه در ریشهٔ پوشهٔ خروجی؛ کتابخانه‌های داخلِ assets/ دست‌نخورده
// می‌مانند (از قبل فشرده‌اند). service-worker.js هم اگر بود، چون باید در دامنه ثبت شود و
// مسیرها را کش می‌کند، درهم نمی‌شود تا رفتارش تضمینی بماند.
var SKIP = { 'service-worker.js': 1 };

// گزینه‌های محافظهٔ «سازگار با هندلرهای درون‌خطی» (نام‌های سراسری حفظ می‌شوند).
// سطحِ حفاظت بر اساسِ اندازهٔ فایل تنظیم می‌شود: فایل‌های کوچک حفاظتِ «حداکثری» (شاملِ
// درهم‌ریزیِ جریانِ کنترل، تزریقِ کدِ مرده، رمزِ RC4، شکستنِ رشته‌ها) می‌گیرند؛ فایلِ بزرگ
// (مثلِ script.js) حفاظتِ «سنگین ولی سریع» می‌گیرد تا در وب‌ویوِ ویندوز ۷ کند/سنگین نشود.
// JOUYA_OBFUSCATE_MAX=0 → debugProtection خاموش می‌ماند (پیش‌فرض: روشن).
function optionsFor(sizeBytes) {
    var big = sizeBytes > 300 * 1024;   // فایل‌های بزرگ: ترفندهای پرهزینه خاموش می‌مانند
    var maxMode = (process.env.JOUYA_OBFUSCATE_MAX !== '0');
    return {
        compact: true,
        target: 'browser',
        renameGlobals: false,            // ← حیاتی: نامِ توابعِ سراسری حفظ شود (onclickها)
        renameProperties: false,         // ← حیاتی: window.X و پراپرتی‌ها دست‌نخورده
        transformObjectKeys: false,      // ← حیاتی: کلیدهای شیء تغییر نکنند
        identifierNamesGenerator: 'hexadecimal',   // نام‌های محلیِ نامفهوم‌تر
        // ── آرایهٔ رشته‌ها: رمز + چرخش + درهم‌ریزی + پوشش‌دهنده ──
        stringArray: true,
        stringArrayThreshold: big ? 0.8 : 1,   // فایلِ بزرگ کمی کمتر تا حجم/سرعت در ویندوز ۷ معقول بماند
        stringArrayEncoding: big ? ['base64'] : ['rc4'],   // RC4 کندتر است → فقط فایلِ کوچک
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayIndexShift: true,
        stringArrayWrappersCount: big ? 1 : 2,
        stringArrayWrappersType: 'function',
        stringArrayWrappersChainedCalls: true,
        splitStrings: !big,              // شکستنِ رشته‌ها فقط برای فایلِ کوچک
        splitStringsChunkLength: 8,
        numbersToExpressions: !big,
        // ── درهم‌ریزیِ جریانِ کنترل و کدِ مرده: فقط فایلِ کوچک (برای فایلِ بزرگ فاجعهٔ سرعت) ──
        controlFlowFlattening: !big,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: !big,
        deadCodeInjectionThreshold: 0.2,
        // ── ضدِ دستکاری: اگر کسی کد را beautify/دیباگ کند، از کار می‌افتد ──
        selfDefending: true,
        debugProtection: maxMode,
        debugProtectionInterval: maxMode ? 2000 : 0,
        disableConsoleOutput: maxMode,   // کنسول را در نسخهٔ منتشرشده خاموش می‌کند
        unicodeEscapeSequence: false,
        simplify: true,
        comments: false
    };
}

function syntaxOk(code) {
    try { new vm.Script(code, { filename: 'check.js' }); return true; }
    catch (e) { console.log('   ↳ اعتبارسنجی شکست خورد: ' + ((e && e.message) || e)); return false; }
}

var files;
try { files = fs.readdirSync(targetDir); }
catch (e) { console.error('[obfuscate] خواندنِ پوشه ممکن نشد: ' + targetDir); process.exit(0); }

var done = 0, skipped = 0, failed = 0;
files.forEach(function (name) {
    if (!/\.js$/i.test(name)) return;
    if (SKIP[name]) { skipped++; return; }
    var full = path.join(targetDir, name);
    var stat;
    try { stat = fs.statSync(full); } catch (e) { return; }
    if (!stat.isFile()) return;

    var src;
    try { src = fs.readFileSync(full, 'utf8'); } catch (e) { return; }
    if (!src || !src.trim()) return;

    var t0 = Date.now();
    var out;
    try {
        out = JavaScriptObfuscator.obfuscate(src, optionsFor(stat.size)).getObfuscatedCode();
    } catch (e) {
        console.log('::warning::[obfuscate] ' + name + ' درهم نشد (اصلی ماند): ' + ((e && e.message) || e));
        failed++; return;
    }
    if (!out || !syntaxOk(out)) {
        console.log('::warning::[obfuscate] ' + name + ' خروجیِ نامعتبر داشت → نسخهٔ اصلی حفظ شد.');
        failed++; return;
    }
    try { fs.writeFileSync(full, out, 'utf8'); } catch (e) { failed++; return; }
    var kb = Math.round(stat.size / 1024), kb2 = Math.round(Buffer.byteLength(out) / 1024);
    console.log('  ✓ ' + name + '  ' + kb + 'KB → ' + kb2 + 'KB  (' + (Date.now() - t0) + 'ms)');
    done++;
});

console.log('[obfuscate] پایان — محافظت‌شده: ' + done + ' | ردشده: ' + skipped + ' | ناموفق(اصلی‌مانده): ' + failed);

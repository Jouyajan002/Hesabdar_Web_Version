/**
 * jouya-google-config.js — شناسهٔ کلاینتِ وبِ گوگل
 * ============================================================================
 * این فایل فقط برای نسخه‌هایی لازم است که ورودِ نیتیوِ گوگل ندارند:
 *    • نسخهٔ وب و وبِ موبایل
 *    • اپلیکیشنِ اندروید (Capacitor)
 *
 * نسخهٔ ویندوز (Tauri) به این فایل نیازی ندارد — ورودِ گوگل آن‌جا از راهِ
 * دستورِ نیتیوِ hb_google_signin انجام می‌شود (در tauri-bridge.js وصل شده).
 *
 * ── چطور شناسه را بگیرید ─────────────────────────────────────────────────────
 *  ۱) console.cloud.google.com → پروژه را انتخاب یا بسازید
 *  ۲) APIs & Services → Credentials → Create credentials → OAuth client ID
 *  ۳) Application type = Web application
 *  ۴) در Authorized JavaScript origins نشانیِ سایتِ خود را بیفزایید
 *     (برای اپلیکیشنِ اندرویدِ Capacitor معمولاً: https://localhost)
 *  ۵) شناسهٔ ساخته‌شده را این‌جا بگذارید — چیزی شبیهِ:
 *        123456789012-abcdefghijklmnop.apps.googleusercontent.com
 *
 * ⚠ این «Client ID» است، نه «Client Secret». گذاشتنِ Client ID در فایلِ سمتِ
 *   کلاینت عادی و بی‌خطر است؛ Client Secret هرگز نباید این‌جا بیاید.
 *
 * تا وقتی این مقدار خالی بماند، نسخهٔ وب و اندروید پیامِ راهنما نشان می‌دهند و
 * بقیهٔ برنامه کاملاً دست‌نخورده کار می‌کند.
 */
(function () {
    'use strict';
    var WEB_CLIENT_ID = '';   // ← شناسه را این‌جا بگذارید

    try {
        if (WEB_CLIENT_ID) {
            window.JOUYA_GOOGLE_WEB_CLIENT_ID = WEB_CLIENT_ID;
        } else {
            // اگر قبلاً از راهِ تنظیماتِ برنامه ذخیره شده باشد، همان استفاده می‌شود
            var saved = null;
            try { saved = localStorage.getItem('jouya_google_web_client_id'); } catch (e) {}
            if (saved) window.JOUYA_GOOGLE_WEB_CLIENT_ID = String(saved);
        }
    } catch (e) {}
})();

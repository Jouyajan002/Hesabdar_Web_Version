/**
 * sync-config.js — پیکربندیِ سینکِ ابری (فروشگاه جویا)
 * ---------------------------------------------------------------------------
 * فقط کلیدهای «عمومی» اینجا هستند (امن برای قرارگیری در برنامه/apk).
 * هرگز service_role key را اینجا نگذارید — امنیتِ واقعی با RLS در سرور است.
 * ---------------------------------------------------------------------------
 */
window.JOUYA_SYNC_CONFIG = {
    // آدرسِ پروژهٔ Supabase شما
    url: 'https://osddigmzfrxiryzerlro.supabase.co',

    // کلیدِ عمومی (anon/public) — امن است
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zZGRpZ216ZnJ4aXJ5emVybHJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NTcwNjcsImV4cCI6MjEwMzIzMzA2N30.d0UoGUufC1lWWNyIKX8NTLLJCrjiEKohq2semlfbRog',

    // نسخهٔ پروتکلِ سینک (برای سازگاریِ آینده بینِ دسکتاپ و موبایل)
    syncProtocolVersion: 1,

    // فاز ۳: سینکِ زنده روشن است.
    // پس از ورود + مهاجرتِ موفق، push/pull خودکار و Realtime فعال می‌شوند.
    liveSyncEnabled: true
};

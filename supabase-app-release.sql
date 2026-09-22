-- ═══════════════════════════════════════════════════════════════════════════
--  حسابدار / فروشگاه جویا — جدولِ «آخرین نسخهٔ منتشرشده» برای اعلانِ بروزرسانی
--  در نسخهٔ موبایل (APK). این جدول هیچ ربطی به دادهٔ کسب‌وکار/سینک ندارد؛ فقط
--  اپ آن را می‌خواند تا بفهمد نسخهٔ جدیدتری موجود است یا نه و لینکِ دانلود کجاست.
--  یک‌بار در SQL Editor سوپابیس اجرا کنید.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.app_release (
    platform      text primary key,               -- 'android'  (بعداً 'desktop' هم قابل‌افزودن)
    version_name  text        not null,            -- برای نمایش، مثل '1.2.0'
    version_code  integer     not null,            -- برای مقایسه (عدد صعودی) — همان versionCode ساختِ APK
    download_url  text        not null,            -- لینکِ دانلود/راهنما (تلگرام یا سایت)
    notes         text        default '',          -- توضیحِ کوتاهِ تغییرات (اختیاری)
    mandatory     boolean     default false,       -- اگر true، اعلان پررنگ‌تر نشان داده می‌شود
    updated_at    timestamptz not null default now()
);

-- خواندنِ عمومی (فقط SELECT) — تا هر اپ بدونِ ورود هم بتواند نسخهٔ جدید را ببیند.
-- نوشتن ممنوع است؛ فقط شما از داشبوردِ سوپابیس این ردیف را به‌روز می‌کنید.
alter table public.app_release enable row level security;

drop policy if exists app_release_read on public.app_release;
create policy app_release_read
    on public.app_release
    for select
    using ( true );

-- مقدارِ اولیه (این‌ها را پس از اولین انتشار با نسخهٔ واقعی به‌روز کنید).
insert into public.app_release (platform, version_name, version_code, download_url, notes, mandatory)
values ('android', '1.0.0', 1, 'https://t.me/+VDiMxHCT721hMjJl', 'نسخهٔ نخستِ موبایل', false)
on conflict (platform) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- روالِ هر انتشارِ جدید (بعد از اینکه GitHub Actions فایلِ APK را ساخت):
--   ۱) APK را در تلگرام/سایت بگذارید.
--   ۲) این ردیف را به‌روز کنید (version_code باید همان عددِ versionCodeِ همان بیلد باشد):
--
--   update public.app_release
--   set version_name = '1.1.0',
--       version_code = 7,                       -- = شمارهٔ run در GitHub Actions
--       download_url = 'https://t.me/...',
--       notes        = 'رفعِ چند باگ و بهبودِ موبایل',
--       mandatory    = false,
--       updated_at   = now()
--   where platform = 'android';
-- ─────────────────────────────────────────────────────────────────────────────

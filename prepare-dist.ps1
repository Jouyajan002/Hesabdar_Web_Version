# ============================================================================
#  حسابدار — آماده‌سازیِ فایل‌های وب برای بسته‌بندیِ نسخهٔ نصبیِ ویندوز
#  ---------------------------------------------------------------------------
#  این اسکریپت پیش از هر بیلد، توسطِ خودِ Tauri اجرا می‌شود (beforeBuildCommand در
#  tauri.conf.json). کارش یک چیز است: کپیِ همان فایل‌هایی که نسخهٔ وب واقعاً استفاده
#  می‌کند، در پوشهٔ تمیزِ  src-tauri\dist-web .
#
#  چرا لازم است؟ اگر frontendDist را روی ریشهٔ پروژه بگذاریم، Tauri کلِ پوشه را داخلِ
#  باینری embed می‌کند — از جمله خودِ src-tauri\target که چند گیگابایت محصولِ بیلد است،
#  به‌علاوهٔ .git و node_modules. نتیجه: شکستِ بیلد با «No space left on device».
#
#  چرا اینجا و نه در build.rs؟ چون CLIِ Tauri وجودِ frontendDist را **پیش از** اجرای
#  cargo بررسی می‌کند، و build.rs بعد از آن اجرا می‌شود. پس باید اینجا ساخته شود.
#
#  ▸ افزودنِ فایلِ وبِ جدید؟ نامش را به  $WebFiles  اضافه کنید.
#  ▸ فایلی که وجود نداشته باشد بی‌صدا رد می‌شود، پس فهرست می‌تواند سخاوتمند باشد.
#  ▸ service-worker.js عمداً کپی نمی‌شود: نسخهٔ نصبی Service Worker لازم ندارد و کشِ
#    نسخهٔ وب نباید با نسخهٔ نصبی قاطی شود.
# ============================================================================

$ErrorActionPreference = 'Stop'

# مسیرها از محلِ خودِ اسکریپت حساب می‌شوند، پس مهم نیست از کدام پوشه صدا زده شده باشد.
$Root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }
$Dist = Join-Path $Root 'src-tauri\dist-web'

# ── فایل‌های ریشهٔ برنامه (همان فهرستی که service-worker.js پیش‌ذخیره می‌کند) ──
$WebFiles = @(
    'index.html',
    # CSS
    'style.css',
    'auth-system.css',
    'dashboard-store-info-fix.css',
    'mobile-responsive.css',
    # JS برنامه
    'tauri-bridge.js',
    'database.js',
    'script.js',
    'persian-date-utils.js',
    'auth-system.js',
    'drive-backup.js',
    'instant-update-fix.js',
    'delivery-list.js',
    'currency-system.js',
    'sync-config.js',
    'sync-layer.js',
    'auth-cloud.js',
    'demo-mode.js',
    'mobile-fit.js',
    'jouya-selftest.js',
    'pwa-register.js',
    # متادیتا
    'manifest.webmanifest',
    'version.json'
)

# ── پوشه‌هایی که کامل کپی می‌شوند ──
$WebDirs = @('assets', 'build')

Write-Host "[hesabdar] ریشهٔ پروژه : $Root"
Write-Host "[hesabdar] مقصد        : $Dist"

# پوشه از صفر ساخته می‌شود تا فایلِ حذف‌شده در بیلدِ بعدی باقی نماند.
if (Test-Path $Dist) { Remove-Item -Recurse -Force $Dist }
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

$copied = 0
$missing = @()
foreach ($f in $WebFiles) {
    $src = Join-Path $Root $f
    if (Test-Path -LiteralPath $src -PathType Leaf) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $Dist $f) -Force
        $copied++
    } else {
        $missing += $f
    }
}

foreach ($d in $WebDirs) {
    $src = Join-Path $Root $d
    if (Test-Path -LiteralPath $src -PathType Container) {
        Copy-Item -LiteralPath $src -Destination $Dist -Recurse -Force
    } else {
        $missing += ($d + '\')
    }
}

# index.html نبودش یعنی اسکریپت در جای اشتباهی اجرا شده — با خطای روشن متوقف شو.
if (-not (Test-Path -LiteralPath (Join-Path $Dist 'index.html'))) {
    Write-Error "index.html در ریشهٔ پروژه پیدا نشد ($Root). prepare-dist.ps1 باید کنارِ index.html و پوشهٔ src-tauri باشد."
    exit 1
}

$sizeMb = [math]::Round(((Get-ChildItem -Recurse -File $Dist | Measure-Object -Property Length -Sum).Sum / 1MB), 2)
Write-Host "[hesabdar] کپی شد: $copied فایلِ ریشه + پوشه‌های $($WebDirs -join ', ')  →  $sizeMb مگابایت"
if ($missing.Count -gt 0) {
    Write-Host "[hesabdar] موجود نبود (رد شد): $($missing -join ', ')"
}
exit 0

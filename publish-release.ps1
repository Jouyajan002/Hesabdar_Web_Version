# ════════════════════════════════════════════════════════════════════════════
#  حسابدار — انتشارِ نسخهٔ جدید با یک فرمان (دسکتاپ Tauri + تگِ گیت‌هاب برای APK)
#  ----------------------------------------------------------------------------
#  این اسکریپت روی ویندوزِ خودتان همهٔ کارها را انجام می‌دهد:
#    ۱) شمارهٔ نسخه را در هر سه فایل بالا می‌برد:
#         • version.json
#         • src-tauri\tauri.conf.json
#         • src-tauri\Cargo.toml
#    ۲) نسخهٔ دسکتاپ (.exe و .msi) را می‌سازد.
#    ۳) تغییرات را commit و push می‌کند و تگِ نسخه (مثلاً v1.0.8) را می‌سازد و push می‌کند
#       → این تگ، ورک‌فلوی «اندروید» را در گیت‌هاب اجرا می‌کند تا APK هم ساخته و در همان
#         ریلیز منتشر شود.
#    ۴) ریلیزِ همان تگ را می‌سازد (اگر نبود) و فایل‌های نصبِ دسکتاپ را به آن می‌افزاید.
#  نتیجه: یک ریلیزِ واحد (مثلاً v1.0.8) که هم .exe/.msi دارد و هم .apk → کاربرانِ
#  دسکتاپ و اندروید هر دو از داخلِ برنامه «بروزرسانی» را می‌بینند.
#
#  پیش‌نیازها (یک‌بار نصب):
#    • Rust + Tauri CLI  (rustup، و:  cargo install tauri-cli --version "^2" --locked)
#    • Git
#    • GitHub CLI (gh)   →  https://cli.github.com   سپس یک‌بار:  gh auth login
#
#  روشِ اجرا (در پوشهٔ ریشهٔ پروژه، در PowerShell):
#    .\publish-release.ps1 -Version 1.0.8
#
#  برای سازگاری با «ویندوز ۷» (پین Rust 1.77.2 + حذفِ ICU):
#    .\publish-release.ps1 -Version 1.0.8 -Win7
#  (اگر بیلدِ ویندوز ۷ خطای MSRV داد، بدونِ -Win7 اجرا کنید تا با toolchainِ عادی بسازد.)
# ════════════════════════════════════════════════════════════════════════════

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,                                   # مثلاً 1.0.8  (بدون v)
    [string]$Repo = "Jouyajan002/Hesabdar_Web_Version", # USER/REPO
    [switch]$Win7,                                      # ساختِ سازگار با ویندوز ۷
    [switch]$NoPush                                     # فقط بساز، push/انتشار نکن (برای تست)
)

$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    ✓ $m" -ForegroundColor Green }
function Die($m)  { Write-Host "`n✗ $m" -ForegroundColor Red; exit 1 }
# نوشتنِ فایل با UTF-8 بدونِ BOM (مهم: BOM می‌تواند Cargo.toml/JSON را خراب کند)
function Write-Utf8NoBom($path, $content) {
    $enc = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Resolve-Path $path), $content, $enc)
}

# نسخه را تمیز کن (v اضافی را بردار)
$Version = $Version.TrimStart('v','V').Trim()
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Die "نسخه باید به شکلِ X.Y.Z باشد (مثلاً 1.0.8). دریافت شد: $Version" }
$Tag = "v$Version"

# باید در ریشهٔ پروژه باشیم
if (-not (Test-Path 'src-tauri\tauri.conf.json')) { Die "این اسکریپت باید در «ریشهٔ پروژه» اجرا شود (جایی که پوشهٔ src-tauri هست)." }
if (-not (Test-Path 'index.html'))                { Die "index.html در ریشه پیدا نشد. مطمئن شوید در پوشهٔ درست هستید." }

Step "بررسیِ ابزارها"
foreach ($t in @('cargo','git','gh')) {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Die "«$t» نصب نیست. راهنمای پیش‌نیازها را در بالای فایل ببینید." }
}
if (-not (Get-Command 'cargo-tauri' -ErrorAction SilentlyContinue)) {
    Write-Host "    Tauri CLI نصب نیست؛ در حال نصب…" -ForegroundColor Yellow
    cargo install tauri-cli --version "^2" --locked
}
Ok "ابزارها آماده‌اند"

# ── ۱) بالا بردنِ شمارهٔ نسخه در هر سه فایل ──────────────────────────────────
Step "تنظیمِ نسخه روی $Version در سه فایل"

# version.json
$vj = Get-Content 'version.json' -Raw
$vj = [regex]::Replace($vj, '"version"\s*:\s*"[^"]*"', '"version": "' + $Version + '"')
Write-Utf8NoBom 'version.json' $vj
Ok "version.json"

# src-tauri\tauri.conf.json  (فقط «version» سطحِ بالا؛ احتیاطاً اولین رخداد)
$tc = Get-Content 'src-tauri\tauri.conf.json' -Raw
$tc = [regex]::Replace($tc, '"version"\s*:\s*"\d+\.\d+\.\d+"', '"version": "' + $Version + '"', 1)
Write-Utf8NoBom 'src-tauri\tauri.conf.json' $tc
Ok "src-tauri\tauri.conf.json"

# src-tauri\Cargo.toml  (فقط version سطحِ [package] — اولین رخداد)
$cg = Get-Content 'src-tauri\Cargo.toml' -Raw
$cg = [regex]::Replace($cg, '(?m)^version\s*=\s*"\d+\.\d+\.\d+"', 'version      = "' + $Version + '"', 1)
Write-Utf8NoBom 'src-tauri\Cargo.toml' $cg
Ok "src-tauri\Cargo.toml"

# ── ۲) آماده‌سازیِ فایل‌های وب برای بسته‌بندی (dist-web) ──────────────────────
Step "آماده‌سازیِ dist-web"
$Root = (Get-Location).Path
$Dist = Join-Path $Root 'src-tauri\dist-web'
$WebFiles = @(
  'index.html',
  'style.css','auth-system.css','dashboard-store-info-fix.css','mobile-responsive.css',
  'tauri-bridge.js','database.js','script.js','persian-date-utils.js',
  'auth-system.js','drive-backup.js','instant-update-fix.js','delivery-list.js',
  'currency-system.js','sync-config.js','sync-layer.js','auth-cloud.js',
  'device-guard.js','demo-mode.js','mobile-fit.js','jouya-selftest.js',
  'manifest.webmanifest','version.json'
)
$WebDirs = @('assets','build')
if (Test-Path $Dist) { Remove-Item -Recurse -Force $Dist }
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
foreach ($f in $WebFiles) { if (Test-Path -LiteralPath $f -PathType Leaf) { Copy-Item -LiteralPath $f -Destination (Join-Path $Dist $f) -Force } }
foreach ($d in $WebDirs)  { if (Test-Path -LiteralPath $d -PathType Container) { Copy-Item -LiteralPath $d -Destination $Dist -Recurse -Force } }
if (-not (Test-Path (Join-Path $Dist 'index.html'))) { Die "کپیِ index.html به dist-web ناموفق بود." }
Ok "dist-web آماده شد"

# ── ۳) ساختِ نسخهٔ دسکتاپ ────────────────────────────────────────────────────
if ($Win7) {
    Step "ساختِ دسکتاپ (سازگار با ویندوز ۷ — Rust 1.77.2)"
    Write-Host "    نصبِ toolchainِ 1.77.2 (اگر نباشد)…" -ForegroundColor Yellow
    rustup toolchain install 1.77.2 --profile minimal 2>$null | Out-Null
    # حذفِ زنجیرهٔ ICU تا با Rust 1.77 کامپایل شود (دستورِ مستندِ idna)
    Push-Location 'src-tauri'
    cargo +1.77.2 update -p idna_adapter --precise 1.0.0 2>$null
    Pop-Location
    # با env، toolchain به بیلدِ داخلیِ Tauri هم منتقل می‌شود
    $env:RUSTUP_TOOLCHAIN = '1.77.2'
    try { cargo tauri build }
    catch { Die "بیلدِ ویندوز ۷ ناموفق بود. متنِ خطا را برای Claude بفرستید، یا بدونِ سوئیچِ -Win7 دوباره اجرا کنید تا با toolchainِ عادی ساخته شود." }
    finally { Remove-Item Env:\RUSTUP_TOOLCHAIN -ErrorAction SilentlyContinue }
} else {
    Step "ساختِ دسکتاپ (toolchainِ پیش‌فرض)"
    cargo tauri build
}
Ok "ساختِ دسکتاپ کامل شد"

# یافتنِ فایل‌های نصب
$BundleDir = 'src-tauri\target\release\bundle'
$exe = Get-ChildItem -Recurse -File "$BundleDir\nsis\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$msi = Get-ChildItem -Recurse -File "$BundleDir\msi\*.msi"  -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe -and -not $msi) { Die "فایلِ نصب (.exe/.msi) ساخته نشد. پوشهٔ $BundleDir را بررسی کنید." }
$assets = @(); if ($exe) { $assets += $exe.FullName }; if ($msi) { $assets += $msi.FullName }
Ok ("فایل‌های نصب: " + (($assets | Split-Path -Leaf) -join ', '))

if ($NoPush) { Step "حالتِ -NoPush: انتشار انجام نشد. فایل‌ها ساخته شدند."; exit 0 }

# ── ۴) commit و push و تگ ────────────────────────────────────────────────────
Step "ثبتِ تغییراتِ نسخه در گیت و ساختِ تگِ $Tag"
git add version.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock 2>$null
# اگر چیزی برای commit نبود، خطا ندهد
$pending = git status --porcelain
if ($pending) { git commit -m "نسخهٔ $Version" | Out-Null; Ok "commit ثبت شد" } else { Ok "تغییری برای commit نبود" }
git push
Ok "push شد"

# اگر تگ از قبل هست، خطا ندهد
if (git tag --list $Tag) {
    Write-Host "    تگِ $Tag از قبل وجود دارد؛ دوباره ساخته نمی‌شود." -ForegroundColor Yellow
} else {
    git tag $Tag
    git push origin $Tag
    Ok "تگِ $Tag ساخته و push شد (ورک‌فلوی اندروید حالا APK را می‌سازد)"
}

# ── ۵) ساختِ ریلیز و افزودنِ فایل‌های دسکتاپ ──────────────────────────────────
Step "انتشار در GitHub Releases ($Tag)"
$exists = $false
try { gh release view $Tag --repo $Repo *> $null; if ($LASTEXITCODE -eq 0) { $exists = $true } } catch {}
if (-not $exists) {
    gh release create $Tag --repo $Repo --title "حسابدار $Version" --notes "نسخهٔ $Version" @assets
    Ok "ریلیز ساخته شد و فایل‌های دسکتاپ آپلود شدند"
} else {
    gh release upload $Tag --repo $Repo @assets --clobber
    Ok "فایل‌های دسکتاپ به ریلیزِ موجود افزوده شدند"
}

Write-Host "`n🎉 انجام شد. ریلیزِ $Tag منتشر شد." -ForegroundColor Green
Write-Host "   • کاربرانِ دسکتاپ: فایل .exe/.msi در همین ریلیز است." -ForegroundColor Green
Write-Host "   • کاربرانِ اندروید: ورک‌فلوی گیت‌هاب تا چند دقیقهٔ دیگر APK را به همین ریلیز می‌افزاید." -ForegroundColor Green
Write-Host "   هر دو گروه از داخلِ برنامه → «بروزرسانی» نسخهٔ $Version را می‌بینند.`n" -ForegroundColor Green

// ============================================================================
//  آماده‌سازیِ فایل‌های وب برای بسته‌بندی، پیش از کمپایلِ برنامه
//  ---------------------------------------------------------------------------
//  چرا لازم است: اگر frontendDist را روی ریشهٔ پروژه ("../") بگذاریم، Tauri کلِ پوشه را
//  به‌عنوان دارایی داخلِ باینری embed می‌کند — از جمله خودِ src-tauri/target (چندین گیگابایت
//  محصولِ بیلد)، .git، node_modules و… . نتیجه: بیلد با «No space left on device» شکست
//  می‌خورد یا باینریِ غول‌آسا می‌سازد.
//
//  راه‌حل: همان فایل‌هایی که نسخهٔ وب واقعاً استفاده می‌کند در پوشهٔ تمیزِ src-tauri/dist-web
//  کپی می‌شوند و frontendDist روی همان تنظیم است. این کار در build.rs انجام می‌شود، پس
//  هیچ ابزارِ جانبی (Node، PowerShell، bash) لازم نیست و روی ویندوز/مک/لینوکس یکسان است.
//  build.rs پیش از کمپایلِ main.rs اجرا می‌شود و generate_context!() موقعِ کمپایل، پوشهٔ
//  آماده را می‌بیند.
//
//  افزودنِ فایلِ جدید به نسخهٔ وب؟ نامش را به WEB_FILES (یا WEB_DIRS) اضافه کنید.
//  فایلی که وجود نداشته باشد بی‌صدا رد می‌شود، پس این فهرست می‌تواند سخاوتمند باشد.
// ============================================================================

use std::fs;
use std::path::{Path, PathBuf};

// فایل‌های ریشهٔ برنامه (همان فهرستی که service-worker.js هم پیش‌ذخیره می‌کند)
const WEB_FILES: &[&str] = &[
    "index.html",
    // CSS
    "style.css",
    "auth-system.css",
    "dashboard-store-info-fix.css",
    "mobile-responsive.css",
    // JS برنامه
    "tauri-bridge.js",
    "database.js",
    "script.js",
    "persian-date-utils.js",
    "auth-system.js",
    "drive-backup.js",
    "instant-update-fix.js",
    "delivery-list.js",
    "currency-system.js",
    "sync-config.js",
    "sync-layer.js",
    "auth-cloud.js",
    "demo-mode.js",
    "mobile-fit.js",
    "jouya-selftest.js",
    "pwa-register.js",
    // متادیتا
    "manifest.webmanifest",
    "version.json",
];

// پوشه‌هایی که کامل کپی می‌شوند
const WEB_DIRS: &[&str] = &["assets", "build"];

// عمداً کپی نمی‌شود: service-worker.js — نسخهٔ نصبی Service Worker لازم ندارد و نباید
// کشِ نسخهٔ وب با نسخهٔ نصبی قاطی شود. (pwa-register.js کپی می‌شود ولی در Tauri خودش
// زود بازمی‌گردد، چون پل window.electronAPI را می‌سازد.)

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let from = entry.path();
        let to = dst.join(&name);
        if entry.file_type()?.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn main() {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = here.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| here.clone());
    let dist = here.join("dist-web");

    // پوشه را از صفر بساز تا فایلِ حذف‌شده در بیلدِ بعدی باقی نماند.
    let _ = fs::remove_dir_all(&dist);
    if let Err(e) = fs::create_dir_all(&dist) {
        panic!("نمی‌توان dist-web را ساخت: {}", e);
    }

    let mut copied = 0usize;
    for f in WEB_FILES {
        let from = root.join(f);
        if from.is_file() {
            if let Err(e) = fs::copy(&from, dist.join(f)) {
                panic!("کپیِ {} ناموفق: {}", f, e);
            }
            copied += 1;
        }
        println!("cargo:rerun-if-changed=../{}", f);
    }
    for d in WEB_DIRS {
        let from = root.join(d);
        if from.is_dir() {
            if let Err(e) = copy_dir_all(&from, &dist.join(d)) {
                panic!("کپیِ پوشهٔ {} ناموفق: {}", d, e);
            }
        }
        println!("cargo:rerun-if-changed=../{}", d);
    }

    if !dist.join("index.html").is_file() {
        panic!("index.html در ریشهٔ پروژه پیدا نشد؛ src-tauri باید کنارِ فایل‌های وب باشد.");
    }
    println!("cargo:warning=dist-web آماده شد ({} فایلِ ریشه + {:?})", copied, WEB_DIRS);

    tauri_build::build()
}

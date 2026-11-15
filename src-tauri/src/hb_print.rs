//! hb_print.rs — «پنجرهٔ چاپِ ویندوز» برای چاپِ لیبلِ بارکد (APEX Store Manager)
//!
//! فرمانِ `hb_print_system` روی همان پنجره‌ای که صدایش می‌زند (پنجرهٔ چاپ: print-window.html)
//! پنجرهٔ چاپِ سیستمیِ ویندوز را باز می‌کند — همان پنجرهٔ ورد: انتخابِ پرنتر و دکمهٔ
//! «Preferences / Printer Properties» که تنظیماتِ خودِ درایورِ پرنترِ حرارتی (Stock/اندازهٔ لیبل،
//! جهت، تیرگی، فاصلهٔ لیبل‌ها …) را نشان می‌دهد.
//!
//! خروجی: true اگر پنجره باز شد؛ false اگر نشد (مثلاً WebView2 خیلی قدیمی روی ویندوز ۷) — در
//! این صورت print-window.html خودش به پیش‌نمایشِ چاپِ قبلی برمی‌گردد. پس هیچ حالتی نمی‌شکند.
//!
//! نکتهٔ سازگاری: اینترفیسِ کنترلر از طریقِ «اشاره‌گرِ خامِ COM» به نسخهٔ webview2-com همین فایل
//! منتقل می‌شود؛ پس نسخهٔ webview2-com این فایل لازم نیست با نسخه‌ای که Tauri استفاده می‌کند یکی باشد.
//!
//! ویندوز ۱۱: پنجرهٔ چاپِ «قدیمی» (همان پنجرهٔ ویندوز ۱۰ با دکمهٔ Preferences) با تنظیمِ کاربریِ
//! HKCU\Software\Microsoft\Print\UnifiedPrintDialog → PreferLegacyPrintDialog=1 برمی‌گردد.
//! این تنظیم «فقط هنگامِ چاپِ APEX» روشن و چند ثانیه بعد به مقدارِ قبلیِ خودش برگردانده می‌شود تا
//! برنامه‌های دیگرِ ویندوز تغییری نبینند. در ویندوز ۱۰ این کلید اثری ندارد و بی‌خطر است.

#[tauri::command]
pub async fn hb_print_system(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        // ویندوز ۱۱: پنجرهٔ قدیمیِ چاپ فقط برای همین چاپ (مقدارِ قبلی چند ثانیه بعد برمی‌گردد)
        legacy::prefer_legacy_for_a_moment();
        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        window
            .with_webview(move |wv| {
                // این بسته روی رشتهٔ اصلیِ رابط اجرا می‌شود (ShowPrintUI همین را می‌خواهد)
                let ok = unsafe { imp::show_system_print(imp::into_raw_any(wv.controller())) };
                let _ = tx.send(ok);
            })
            .map_err(|e| e.to_string())?;
        Ok(rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap_or(false))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Ok(false)
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::ffi::c_void;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM,
    };
    use windows_core::Interface;

    /// اینترفیسِ COM (از هر نسخهٔ webview2-com) → اشاره‌گرِ خام؛ مالکیتِ ارجاع منتقل می‌شود.
    pub unsafe fn into_raw_any<T>(iface: T) -> *mut c_void {
        assert_eq!(std::mem::size_of::<T>(), std::mem::size_of::<*mut c_void>());
        let p: *mut c_void = std::mem::transmute_copy(&iface);
        std::mem::forget(iface);
        p
    }

    /// پنجرهٔ چاپِ سیستمیِ ویندوز را برای سندِ اصلیِ همین WebView نشان می‌دهد.
    pub unsafe fn show_system_print(raw_controller: *mut c_void) -> bool {
        if raw_controller.is_null() {
            return false;
        }
        // from_raw مالکیت را می‌گیرد و با Drop آزاد می‌کند (ارجاع متوازن می‌ماند)
        let ctrl = ICoreWebView2Controller::from_raw(raw_controller);
        match ctrl.CoreWebView2() {
            Ok(core) => match core.cast::<ICoreWebView2_16>() {
                Ok(c16) => c16
                    .ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM)
                    .is_ok(),
                Err(_) => false, // WebView2 Runtime قدیمی (پیش از 1.0.2210)
            },
            Err(_) => false,
        }
    }
}

/// پنجرهٔ چاپِ قدیمیِ ویندوز ۱۱ — فقط هنگامِ چاپِ APEX (بدونِ وابستگیِ تازه؛ با reg.exe و بدونِ پنجرهٔ کنسول)
#[cfg(target_os = "windows")]
mod legacy {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const KEY: &str = r"HKCU\Software\Microsoft\Print\UnifiedPrintDialog";
    const VAL: &str = "PreferLegacyPrintDialog";
    /// مدتِ روشن‌ماندنِ تنظیم: پنجرهٔ چاپ در همین فاصله ساخته می‌شود و تنظیم را می‌خواند
    const RESTORE_AFTER_SECS: u64 = 8;

    fn reg(args: &[&str]) -> Option<std::process::Output> {
        Command::new("reg").args(args).creation_flags(CREATE_NO_WINDOW).output().ok()
    }

    /// مقدارِ فعلیِ PreferLegacyPrintDialog (None یعنی این مقدار وجود ندارد)
    fn read() -> Option<u32> {
        let out = reg(&["query", KEY, "/v", VAL])?;
        if !out.status.success() {
            return None;
        }
        super::parse_reg_dword(&String::from_utf8_lossy(&out.stdout), VAL)
    }

    fn write(v: u32) {
        let d = v.to_string();
        let _ = reg(&["add", KEY, "/v", VAL, "/t", "REG_DWORD", "/d", &d, "/f"]);
    }

    pub fn prefer_legacy_for_a_moment() {
        let prev = read();
        if prev == Some(1) {
            return; // از قبل روشن است (توسطِ کاربر یا چاپِ قبلیِ APEX) → دست نمی‌زنیم
        }
        write(1);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(RESTORE_AFTER_SECS));
            match prev {
                None => {
                    let _ = reg(&["delete", KEY, "/v", VAL, "/f"]);
                }
                Some(v) => write(v),
            }
        });
    }
}

/// خواندنِ مقدارِ REG_DWORD از خروجیِ «reg query» (مثلاً «    PreferLegacyPrintDialog    REG_DWORD    0x1»)
#[allow(dead_code)]
fn parse_reg_dword(text: &str, name: &str) -> Option<u32> {
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        if parts.next() != Some(name) {
            continue;
        }
        if parts.next() != Some("REG_DWORD") {
            continue;
        }
        let raw = parts.next()?;
        let hex = raw.trim_start_matches("0x").trim_start_matches("0X");
        return u32::from_str_radix(hex, 16).ok();
    }
    None
}

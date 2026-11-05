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

#[tauri::command]
pub async fn hb_print_system(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
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

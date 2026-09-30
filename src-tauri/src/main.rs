// ============================================================================
//  حسابدار — میزبانِ دسکتاپ (Tauri v2)
//  جایگزینِ سبکِ الکترون: از WebViewِ خودِ سیستم استفاده می‌کند، پس Chromium و Node
//  همراهِ نصب نمی‌شوند و حجمِ نصب از ~۱۸۰MB به چند مگابایت می‌رسد.
//
//  اصلِ طراحی: «هیچ منطقی از برنامه اینجا نیست». تمامِ محاسبات، دیتابیس و رابطِ کاربری
//  همان فایل‌های وبِ موجود (index.html / script.js / database.js / …) است. این فایل فقط
//  همان پنج قابلیتِ سیستمی را می‌دهد که نسخهٔ الکترون از طریقِ window.electronAPI می‌داد:
//    ۱) مسیرِ پوشهٔ دانلود      ۲) نوشتنِ فایل روی دیسک
//    ۳) بازکردنِ فایل/پوشه     ۴) کپیِ فایل در کلیپ‌بورد (ویندوز)
//    ۵) بازکردنِ لینک/پروتکل (مثلِ whatsapp://)
//  هیچ پلاگینِ جانبی لازم نیست؛ همه با کتابخانهٔ استانداردِ Rust انجام می‌شود تا باینری
//  کوچک و رفتار قابلِ پیش‌بینی بماند.
// ============================================================================

// روی ویندوز، در بیلدِ release پنجرهٔ کنسول باز نشود.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

// ── ابزارِ کوچک: پاک‌سازیِ نامِ فایل (هیچ مسیری از بیرون تزریق نشود) ─────────────
fn sanitize_file_name(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c if (c as u32) < 32 => '_',
            c => c,
        })
        .collect();
    out = out.trim().trim_matches('.').to_string();
    if out.is_empty() {
        out = "file".to_string();
    }
    if out.chars().count() > 150 {
        out = out.chars().take(150).collect();
    }
    out
}

fn downloads_dir() -> Option<PathBuf> {
    // ترتیبِ تلاش: متغیرهای محیطیِ ویندوز → خانهٔ کاربر/Downloads → پوشهٔ موقت
    #[cfg(target_os = "windows")]
    {
        if let Ok(up) = std::env::var("USERPROFILE") {
            let p = PathBuf::from(up).join("Downloads");
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(&home).join("Downloads");
        if p.is_dir() {
            return Some(p);
        }
        let p2 = PathBuf::from(&home).join("بارگیری‌ها");
        if p2.is_dir() {
            return Some(p2);
        }
    }
    Some(std::env::temp_dir())
}

// ── ۱) مسیرِ پوشهٔ دانلود ──────────────────────────────────────────────────────
#[tauri::command]
fn hb_downloads_dir() -> String {
    downloads_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn hb_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

// ── ۲) نوشتنِ فایل ────────────────────────────────────────────────────────────
//  where: "downloads" | "temp" | "temp-unique"  (پوشهٔ یکتا برای هر اشتراک‌گذاری)
#[tauri::command]
fn hb_write_file(dest: String, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let name = sanitize_file_name(&file_name);
    let dir: PathBuf = match dest.as_str() {
        "downloads" => downloads_dir().ok_or_else(|| "downloads-dir-not-found".to_string())?,
        "temp-unique" => {
            let uniq = format!(
                "hesabdar-share-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            );
            let p = std::env::temp_dir().join(uniq);
            fs::create_dir_all(&p).map_err(|e| e.to_string())?;
            p
        }
        _ => std::env::temp_dir(),
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let full = dir.join(&name);
    fs::write(&full, &bytes).map_err(|e| e.to_string())?;
    Ok(full.to_string_lossy().to_string())
}

// ── ۳) بازکردنِ فایل / نمایشِ فایل در پوشه ────────────────────────────────────
fn spawn_detached(program: &str, args: &[&str]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn hb_open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("not-found".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        return spawn_detached("cmd", &["/C", "start", "", &path]);
    }
    #[cfg(target_os = "macos")]
    {
        return spawn_detached("open", &[&path]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return spawn_detached("xdg-open", &[&path]);
    }
}

#[tauri::command]
fn hb_reveal_in_dir(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let arg = format!("/select,{}", path);
        return spawn_detached("explorer", &[&arg]);
    }
    #[cfg(target_os = "macos")]
    {
        return spawn_detached("open", &["-R", &path]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());
        return spawn_detached("xdg-open", &[&parent]);
    }
}

// ── ۴) کپیِ «خودِ فایل» در کلیپ‌بورد (ویندوز) ─────────────────────────────────
//  همان روشی که نسخهٔ الکترون به‌عنوان مسیرِ مطمئن استفاده می‌کرد: Set-Clipboard -LiteralPath
//  تا کاربر در چتِ واتساپ فقط Ctrl+V بزند و فایل پیوست شود.
#[tauri::command]
fn hb_set_clipboard_file(path: String) -> bool {
    #[cfg(target_os = "windows")]
    {
        if !Path::new(&path).exists() {
            return false;
        }
        let cmd = format!("Set-Clipboard -LiteralPath \"{}\"", path.replace('"', "`\""));
        return Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &cmd,
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        false
    }
}

// ── ۵) بازکردنِ لینک/پروتکل (مثلِ whatsapp:// یا https://) ────────────────────
#[tauri::command]
fn hb_open_uri(uri: String) -> Result<(), String> {
    // فقط طرح‌های بی‌خطر؛ جلوگیری از اجرای فرمانِ دلخواه
    let low = uri.to_lowercase();
    let ok = low.starts_with("https://")
        || low.starts_with("http://")
        || low.starts_with("mailto:")
        || low.starts_with("tel:")
        || low.starts_with("whatsapp:");
    if !ok {
        return Err("scheme-not-allowed".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        return spawn_detached("cmd", &["/C", "start", "", &uri]);
    }
    #[cfg(target_os = "macos")]
    {
        return spawn_detached("open", &[&uri]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return spawn_detached("xdg-open", &[&uri]);
    }
}

// ── نسخهٔ برنامه (برای گزینهٔ «بروزرسانی» در آینده، اگر لازم شد) ──────────────
#[tauri::command]
fn hb_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ════════════════════════════════════════════════════════════════════════════
//  «پنلِ اشتراکِ ویندوز» (WinRT DataTransferManager) — مسیرِ اول و درستِ ارسال
//  ---------------------------------------------------------------------------
//  فایلِ PDF از پیش به هدف (واتساپ) پیوست می‌شود؛ کاربر نه Ctrl+V می‌زند و نه فایل را
//  دستی می‌کشد. این همان اسکریپتی است که در نسخهٔ الکترون آزموده شده و عیناً (بایت‌به‌بایت)
//  در share_win.ps1 نگه داشته شده است؛ اینجا فقط سه جای‌نگهدار پر می‌شود:
//    __FILE_B64__   مسیرِ فایل، Base64 (تا نامِ فارسی مستقل از encodingِ اسکریپت دیکد شود)
//    __TITLE_B64__  عنوانِ اشتراک، Base64
//    __LOG_PATH__   مسیرِ فایلِ لاگ که مارکرها (SHARE_OK / SHARE_ERR) در آن نوشته می‌شوند
//
//  چرا اسکریپت خودش پنجرهٔ «لنگر» می‌سازد: GetForWindow تنها HWNDِ همان پراسسِ فراخوان را
//  می‌پذیرد؛ پس HWNDِ پنجرهٔ برنامه (چه الکترون، چه Tauri) از یک پراسسِ PowerShellِ جدا
//  کار نمی‌کند. به همین دلیل این اسکریپت کاملاً خودبسنده است و هیچ چیزی از میزبان نمی‌خواهد.
//
//  چرا با WScript اجرا می‌شود: پنلِ اشتراک تنها وقتی برنامه‌های هدف را برمی‌شمارد که
//  پراسس یک کنسولِ واقعیِ بدونِ ریدایرکت داشته باشد. پس خروجی pipe نمی‌شود و مارکرها از
//  فایلِ لاگ خوانده می‌شوند.
// ════════════════════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
// ════════════════════════════════════════════════════════════════════════════
//  مسیرِ اصلی: «پنلِ اشتراکِ ویندوز» به‌صورتِ نیتیو در خودِ Rust
//  ---------------------------------------------------------------------------
//  چرا این روش از روشِ PowerShell بهتر و مطمئن‌تر است:
//  IDataTransferManagerInterop::GetForWindow فقط HWNDی را می‌پذیرد که متعلق به
//  «همان پراسسِ فراخوان» باشد. در الکترون این شدنی نبود (Node نمی‌توانست WinRT را با
//  HWNDِ خودش صدا بزند)، برای همین آنجا مجبور بودیم یک پراسسِ PowerShell جدا اجرا کنیم
//  که پنجرهٔ «لنگر»ِ خودش را بسازد. در Tauri، خودِ Rust مالکِ پنجره است، پس HWNDِ واقعیِ
//  پنجرهٔ برنامه را مستقیم می‌دهیم — همان چیزی که API انتظار دارد. نه پراسسِ اضافه،
//  نه پنجرهٔ جعلی، نه wscript، نه فایلِ موقتِ اسکریپت.
//
//  همهٔ امضاهای زیر از روی سورسِ واقعیِ windows 0.62.2 بررسی شده‌اند:
//    Win32::UI::Shell::IDataTransferManagerInterop::{GetForWindow, ShowShareUIForWindow}
//    DataPackage::SetStorageItems(value, readonly)  ← دو آرگومان
//    TypedEventHandler::new(|Ref<TSender>, Ref<TResult>| -> Result<()>)  + Send + 'static
//    IIterable<T>: From<Vec<T::Default>>  و برای اینترفیس‌ها T::Default = Option<T>
// ════════════════════════════════════════════════════════════════════════════
#[cfg(target_os = "windows")]
mod win_share {
    use std::cell::RefCell;
    use windows::core::{factory, Interface, HSTRING};
    use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::{IStorageItem, StorageFile};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::IDataTransferManagerInterop;
    use windows_collections::IIterable;

    // DataTransferManager باید تا لحظه‌ای که کاربر مخاطب را انتخاب می‌کند زنده بماند؛
    // اگر drop شود، پنل بسته یا فایل تحویل نمی‌شود. این نوع Send نیست و فقط روی نخِ UI
    // ساخته و استفاده می‌شود، پس thread_local دقیقاً ابزارِ درست است (بدونِ نیاز به Send).
    thread_local! {
        static KEEP_ALIVE: RefCell<Option<DataTransferManager>> = RefCell::new(None);
    }

    // انتظارِ همگام برای IAsyncOperation. عملیاتِ StorageFile روی thread-poolِ سیستم کامل
    // می‌شود (نه روی نخِ UI)، پس این نظرسنجیِ کوتاه بن‌بست ایجاد نمی‌کند.
    // AsyncStatus::Started == 0 — با .0 مقایسه می‌شود تا یک import کمتر لازم باشد.
    fn resolve_storage_file(path: &str) -> windows::core::Result<StorageFile> {
        let op = StorageFile::GetFileFromPathAsync(&HSTRING::from(path))?;
        for _ in 0..600 {
            if op.Status()?.0 != 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        op.GetResults()
    }

    /// باید روی «نخِ اصلیِ برنامه» صدا زده شود (همان نخی که مالکِ پنجره است).
    pub fn show_share_panel(hwnd_raw: isize, file_path: String, title: String) -> Result<(), String> {
        let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);

        let interop: IDataTransferManagerInterop =
            factory::<DataTransferManager, IDataTransferManagerInterop>()
                .map_err(|e| format!("factory: {}", e))?;

        let dtm: DataTransferManager = unsafe { interop.GetForWindow(hwnd) }
            .map_err(|e| format!("GetForWindow: {}", e))?;

        // کلوژر باید Send + 'static باشد؛ پس فقط String می‌گیرد و خودِ StorageFile را
        // همان لحظه‌ای که ویندوز داده را می‌خواهد می‌سازد (StorageFile نوعِ Send نیست).
        let path_for_handler = file_path.clone();
        let title_for_handler = title;
        let handler = TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(
            move |_sender, args| {
                let args = args.ok()?;
                let request = args.Request()?;
                // Deferral: تحویلِ فایل ممکن است چند لحظه طول بکشد؛ تا Complete، بستهٔ داده
                // برای هدف (واتساپ) باز می‌ماند.
                let deferral = request.GetDeferral()?;
                let filled = (|| -> windows::core::Result<()> {
                    let data = request.Data()?;
                    data.Properties()?
                        .SetTitle(&HSTRING::from(title_for_handler.as_str()))?;
                    let file = resolve_storage_file(&path_for_handler)?;
                    let item: IStorageItem = file.cast()?;
                    let items: IIterable<IStorageItem> = vec![Some(item)].into();
                    data.SetStorageItems(&items, true)?;
                    Ok(())
                })();
                let _ = deferral.Complete();
                filled
            },
        );

        dtm.DataRequested(&handler)
            .map_err(|e| format!("DataRequested: {}", e))?;

        KEEP_ALIVE.with(|k| {
            *k.borrow_mut() = Some(dtm);
        });

        unsafe { interop.ShowShareUIForWindow(hwnd) }
            .map_err(|e| format!("ShowShareUIForWindow: {}", e))?;

        Ok(())
    }

    /// همان پنلِ اشتراک، ولی برای «متن» (پیامِ بیلانسِ شخص) — تا این گزینه هم مثلِ بقیه
    /// لیستِ برنامه‌ها را بیاورد و کاربر واتساپِ ویندوز را از همان پنل انتخاب کند،
    /// نه اینکه مرورگر باز شود. باید روی «نخِ اصلیِ برنامه» صدا زده شود.
    pub fn show_share_panel_text(hwnd_raw: isize, text: String, title: String) -> Result<(), String> {
        let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);

        let interop: IDataTransferManagerInterop =
            factory::<DataTransferManager, IDataTransferManagerInterop>()
                .map_err(|e| format!("factory: {}", e))?;

        let dtm: DataTransferManager = unsafe { interop.GetForWindow(hwnd) }
            .map_err(|e| format!("GetForWindow: {}", e))?;

        let text_for_handler = text;
        let title_for_handler = title;
        let handler = TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(
            move |_sender, args| {
                let args = args.ok()?;
                let request = args.Request()?;
                let data = request.Data()?;
                data.Properties()?
                    .SetTitle(&HSTRING::from(title_for_handler.as_str()))?;
                data.SetText(&HSTRING::from(text_for_handler.as_str()))?;
                Ok(())
            },
        );

        dtm.DataRequested(&handler)
            .map_err(|e| format!("DataRequested: {}", e))?;

        KEEP_ALIVE.with(|k| {
            *k.borrow_mut() = Some(dtm);
        });

        unsafe { interop.ShowShareUIForWindow(hwnd) }
            .map_err(|e| format!("ShowShareUIForWindow: {}", e))?;

        Ok(())
    }
}

#[cfg(target_os = "windows")]
const SHARE_PS1: &str = include_str!("share_win.ps1");

#[derive(serde::Serialize, Clone)]
struct ShareResult {
    ok: bool,
    diag: String,
}

// Base64 استاندارد — بدونِ افزودنِ هیچ وابستگیِ جانبی. (فقط مسیرِ ویندوز از آن استفاده می‌کند)
#[cfg(target_os = "windows")]
fn b64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[cfg(target_os = "windows")]
fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn share_file_win_blocking(file_path: String, title: String) -> ShareResult {
    use std::thread;
    use std::time::{Duration, Instant};

    if !Path::new(&file_path).exists() {
        return ShareResult { ok: false, diag: "file-not-found".into() };
    }

    let tmp = std::env::temp_dir();
    let stamp = now_millis();
    let log_path = tmp.join(format!("hesabdar-share-log-{}.txt", stamp));
    let ps_path = tmp.join(format!("hesabdar-share-{}.ps1", stamp));
    let vbs_path = tmp.join(format!("hesabdar-share-{}.vbs", stamp));

    // جای‌نگهدارها. مسیرِ لاگ داخلِ رشتهٔ تک‌کوتیشنِ PowerShell می‌نشیند، پس ' دوبل می‌شود.
    let log_for_ps = log_path.to_string_lossy().replace('\'', "''");
    let script = SHARE_PS1
        .replace("__FILE_B64__", &b64_encode(file_path.as_bytes()))
        .replace("__TITLE_B64__", &b64_encode(title.as_bytes()))
        .replace("__LOG_PATH__", &log_for_ps);

    // UTF-8 با BOM و پایان‌خطِ CRLF — همان چیزی که نسخهٔ الکترون می‌نوشت.
    let mut bytes: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(script.as_bytes());
    if let Err(e) = fs::write(&ps_path, &bytes) {
        return ShareResult { ok: false, diag: format!("ps-write-err:{}", e) };
    }

    let ps_cmd = format!(
        "powershell -NoProfile -STA -ExecutionPolicy Bypass -File \"\"{}\"\"",
        ps_path.to_string_lossy()
    );
    let vbs = format!("CreateObject(\"WScript.Shell\").Run \"{}\", 0, False", ps_cmd);
    if let Err(e) = fs::write(&vbs_path, vbs.as_bytes()) {
        return ShareResult { ok: false, diag: format!("vbs-write-err:{}", e) };
    }

    if let Err(e) = Command::new("wscript.exe").arg(&vbs_path).spawn() {
        return ShareResult { ok: false, diag: format!("wscript-err:{}", e) };
    }

    // پاک‌سازیِ فایل‌های موقت، ۱۵ ثانیه بعد (اسکریپت تا آن موقع خوانده شده است).
    {
        let a = ps_path.clone();
        let b = vbs_path.clone();
        let c = log_path.clone();
        thread::spawn(move || {
            // بیش از سقفِ ۳۰ ثانیه‌ایِ حلقهٔ انتظار، تا پاک‌سازی با خواندنِ مارکرها تداخل نکند.
            thread::sleep(Duration::from_secs(40));
            let _ = fs::remove_file(a);
            let _ = fs::remove_file(b);
            let _ = fs::remove_file(c);
        });
    }

    // نگه‌داشتنِ یک کپیِ خوانا از لاگِ مرحله‌ای کنارِ خودِ فایلِ PDF.
    // چرا: اگر پنلِ اشتراک باز نشد، مارکرهای STEP1_OK … STEP7_OK / SHARE_ERR دقیقاً می‌گویند
    // کدام مرحله شکست خورده است. فایلِ موقتِ لاگ پاک می‌شود، ولی این کپی می‌ماند و در همان
    // پوشه‌ای است که به کاربر نشان داده می‌شود.
    let keep_log = Path::new(&file_path)
        .parent()
        .map(|p| p.join("share-log.txt"))
        .unwrap_or_else(|| tmp.join("hesabdar-share-log.txt"));
    let finish = |ok: bool, content: &str, note: &str| -> ShareResult {
        let body = if note.is_empty() {
            content.to_string()
        } else {
            format!("{}\n{}", note, content)
        };
        let _ = fs::write(&keep_log, body.as_bytes());
        ShareResult { ok, diag: trim_diag(&body) }
    };

    // خواندنِ مارکرها از فایلِ لاگ — به‌محضِ SHARE_OK موفق، SHARE_ERR ناموفق، و ۳۰ ثانیه سقف.
    let started = Instant::now();
    loop {
        let content = fs::read_to_string(&log_path).unwrap_or_default();
        if content.contains("SHARE_OK") {
            return finish(true, &content, "");
        }
        if content.contains("SHARE_ERR") {
            return finish(false, &content, "");
        }
        if started.elapsed() >= Duration::from_secs(30) {
            return finish(false, &content, "timeout-no-share");
        }
        thread::sleep(Duration::from_millis(300));
    }
}

#[cfg(target_os = "windows")]
fn trim_diag(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() > 1500 {
        t.chars().take(1500).collect()
    } else {
        t.to_string()
    }
}

#[cfg(not(target_os = "windows"))]
fn share_file_win_blocking(_file_path: String, _title: String) -> ShareResult {
    ShareResult { ok: false, diag: "not-win32".into() }
}

// ── مسیرِ اصلی: پنلِ اشتراکِ نیتیو، روی نخِ اصلیِ برنامه ──────────────────────────
//  ShowShareUIForWindow باید روی همان نخی اجرا شود که مالکِ پنجره است، وگرنه پنل
//  نمایش داده نمی‌شود. پس کار با run_on_main_thread به نخِ اصلی سپرده و نتیجه از راهِ
//  یک کانال برگردانده می‌شود (با سقفِ زمانی، تا هیچ‌وقت معلق نماند).
#[cfg(target_os = "windows")]
fn try_native_share_panel(
    app: &tauri::AppHandle,
    hwnd_raw: isize,
    file_path: &str,
    title: &str,
) -> Result<(), String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let p = file_path.to_string();
    let t = title.to_string();
    app.run_on_main_thread(move || {
        let _ = tx.send(win_share::show_share_panel(hwnd_raw, p, t));
    })
    .map_err(|e| format!("run_on_main_thread: {}", e))?;

    match rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(r) => r,
        Err(e) => Err(format!("main-thread-timeout: {}", e)),
    }
}

#[cfg(target_os = "windows")]
fn try_native_share_panel_text(
    app: &tauri::AppHandle,
    hwnd_raw: isize,
    text: &str,
    title: &str,
) -> Result<(), String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let s = text.to_string();
    let t = title.to_string();
    app.run_on_main_thread(move || {
        let _ = tx.send(win_share::show_share_panel_text(hwnd_raw, s, t));
    })
    .map_err(|e| format!("run_on_main_thread: {}", e))?;

    match rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(r) => r,
        Err(e) => Err(format!("main-thread-timeout: {}", e)),
    }
}

// ── پنلِ اشتراکِ سیستم برای «متن» ────────────────────────────────────────────────
//  گزینهٔ «ارسال پیام» در بخشِ اشخاص از این دستور استفاده می‌کند تا رفتارش دقیقاً مثلِ
//  بقیهٔ گزینه‌های اشتراک باشد: لیستِ برنامه‌ها می‌آید و انتخابِ واتساپ، واتساپِ ویندوز را
//  با همان متن باز می‌کند. اگر پنل باز نشود، سمتِ جاوااسکریپت به whatsapp:// و سپس
//  کلیپ‌بورد برمی‌گردد؛ پس هیچ‌وقت «هیچ اتفاقی نیفتاد» رخ نمی‌دهد.
#[tauri::command]
async fn hb_share_text_win(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    text: String,
    title: String,
) -> ShareResult {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    std::thread::sleep(std::time::Duration::from_millis(120));

    #[cfg(target_os = "windows")]
    {
        let hwnd_raw = match window.hwnd() {
            Ok(h) => h.0 as isize,
            Err(e) => return ShareResult { ok: false, diag: format!("hwnd: {}", e) },
        };
        return match try_native_share_panel_text(&app, hwnd_raw, &text, &title) {
            Ok(()) => ShareResult { ok: true, diag: "native-share-panel-text".into() },
            Err(e) => ShareResult { ok: false, diag: e },
        };
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&app, &text, &title);
        ShareResult { ok: false, diag: "not-win32".into() }
    }
}

// دستور به‌صورتِ async اعلام شده و کارِ مسدودکننده در یک نخِ جداگانه انجام می‌شود، تا
// انتظارها هیچ‌وقت رابطِ کاربری را قفل نکنند.
#[tauri::command]
async fn hb_share_file_win(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    file_path: String,
    title: String,
) -> ShareResult {
    // ── پیش‌شرطی که در نسخهٔ الکترون بود و در نسخهٔ اول Tauri جا افتاده بود ──
    //  پنلِ اشتراکِ ویندوز فقط برای پنجره‌ای که «فورگراند» است نمایش داده می‌شود. اسکریپت
    //  خودش پنجرهٔ لنگر را فورگراند می‌کند، ولی این کار با AttachThreadInput به نخِ
    //  «پنجرهٔ فورگراندِ فعلی» چنگ می‌زند؛ اگر در آن لحظه پنجرهٔ برنامه فورگراند نباشد،
    //  SetForegroundWindow بی‌صدا شکست می‌خورد و پنل دیده نمی‌شود.
    //  الکترون پیش از فراخوانی این کار را می‌کرد: shareWin.show(); shareWin.focus();
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    std::thread::sleep(std::time::Duration::from_millis(120));

    // ── تلاشِ اول: پنلِ نیتیو با HWNDِ واقعیِ پنجرهٔ برنامه ──
    #[cfg(target_os = "windows")]
    {
        let hwnd_raw = match window.hwnd() {
            Ok(h) => h.0 as isize,
            Err(e) => {
                return ShareResult { ok: false, diag: format!("hwnd: {}", e) };
            }
        };
        match try_native_share_panel(&app, hwnd_raw, &file_path, &title) {
            Ok(()) => {
                return ShareResult { ok: true, diag: "native-share-panel".into() };
            }
            Err(native_err) => {
                // ── تلاشِ دوم: مسیرِ PowerShell/WinRT (همان اسکریپتِ آزموده‌شدهٔ الکترون) ──
                //  اگر این هم نشد، سمتِ جاوااسکریپت به «کلیپ‌بورد + بازکردنِ واتساپ» می‌رود؛
                //  پس کاربر هیچ‌وقت با «هیچ اتفاقی نیفتاد» روبه‌رو نمی‌شود.
                let ps = tauri::async_runtime::spawn_blocking(move || {
                    share_file_win_blocking(file_path, title)
                })
                .await;
                return match ps {
                    Ok(mut r) => {
                        r.diag = format!("native failed → {}\n---- powershell ----\n{}", native_err, r.diag);
                        r
                    }
                    Err(e) => ShareResult {
                        ok: false,
                        diag: format!("native failed → {} | join-err: {}", native_err, e),
                    },
                };
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = &app;   // روی غیرِویندوز استفاده نمی‌شود
        match tauri::async_runtime::spawn_blocking(move || share_file_win_blocking(file_path, title)).await {
            Ok(r) => r,
            Err(e) => ShareResult { ok: false, diag: format!("join-err:{}", e) },
        }
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            hb_downloads_dir,
            hb_temp_dir,
            hb_write_file,
            hb_open_path,
            hb_reveal_in_dir,
            hb_set_clipboard_file,
            hb_open_uri,
            hb_app_version,
            hb_share_file_win,
            hb_share_text_win
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hesabdar");
}

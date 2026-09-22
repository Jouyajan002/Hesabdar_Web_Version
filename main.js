/**
 * Electron Main Process — نسخه نهایی
 * شامل:
 *   - بک‌آپ خودکار محلی
 *   - OAuth گوگل با روش Desktop (Loopback IP) — این روش قطعاً کار می‌کند
 *   - فچ کردن لیسانس از GitHub (دور زدن CORS)
 *   - سیستم آپدیت خودکار با electron-updater
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

// تلاش برای لود autoUpdater (اگر نصب نشده باشد، خطا نمی‌دهیم)
let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
} catch (e) {
    console.log('electron-updater نصب نیست. اجرا: npm install electron-updater');
}

// مسیر ذخیره داده‌ها در کنار اپلیکیشن (نه AppData)
const USER_DATA_PATH = path.join(path.dirname(app.getPath('exe')), 'data');
const BACKUP_PATH    = path.join(path.dirname(app.getPath('exe')), 'backups');

const isDev = !app.isPackaged;
const DATA_PATH = isDev ? path.join(__dirname, 'data')    : USER_DATA_PATH;
const BK_PATH   = isDev ? path.join(__dirname, 'backups') : BACKUP_PATH;

[DATA_PATH, BK_PATH].forEach(p => fs.mkdirSync(p, { recursive: true }));

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'سیستم مدیریت فروشگاه',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        autoHideMenuBar: true,
        frame: true,
        backgroundColor: '#f1f5f9',
    });

    mainWindow.loadFile('index.html');

    if (isDev) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
    createWindow();
    setupAutoBackup();

    // بررسی آپدیت بعد از ۵ ثانیه
    setTimeout(() => {
        if (autoUpdater && !isDev) {
            autoUpdater.checkForUpdates().catch(err => {
                console.log('بررسی آپدیت:', err.message);
            });
        }
    }, 5000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// =========================================================
// بک‌آپ خودکار محلی
// =========================================================
function setupAutoBackup() {
    doAutoBackupIfNeeded();
    setInterval(doAutoBackupIfNeeded, 3 * 60 * 60 * 1000);
}

function getTodayStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function doAutoBackupIfNeeded() {
    const today = getTodayStr();
    const backupFile = path.join(BK_PATH, `backup_${today}.json`);
    if (!fs.existsSync(backupFile)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('request-auto-backup', { date: today });
        }
    }
}

// =========================================================
// IPC: ذخیره/بازیابی بک‌آپ محلی
// =========================================================
ipcMain.on('save-auto-backup', (event, { date, data }) => {
    try {
        const backupFile = path.join(BK_PATH, `backup_${date}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf8');
        cleanOldBackups(30);
    } catch (e) {
        console.error('خطا در بک‌آپ خودکار:', e);
    }
});

ipcMain.handle('manual-backup', async (event, data) => {
    try {
        const dateStr = getTodayStr();
        const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        const backupFile = path.join(BK_PATH, `manual_${dateStr}_${timeStr}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf8');
        return { success: true, path: backupFile };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('open-backup-folder', async () => {
    shell.openPath(BK_PATH);
    return { success: true };
});

ipcMain.handle('list-backups', async () => {
    try {
        const files = fs.readdirSync(BK_PATH)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const stat = fs.statSync(path.join(BK_PATH, f));
                return { name: f, size: stat.size, mtime: stat.mtime };
            })
            .sort((a, b) => b.mtime - a.mtime);
        return { success: true, files };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('restore-backup', async (event, fileName) => {
    try {
        const backupFile = path.join(BK_PATH, fileName);
        const data = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('select-import-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'انتخاب فایل بک‌آپ',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile']
    });
    if (result.canceled) return { canceled: true };
    try {
        const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
        return { success: true, data };
    } catch (e) {
        return { success: false, error: 'فایل نامعتبر' };
    }
});

function cleanOldBackups(days) {
    try {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        fs.readdirSync(BK_PATH).forEach(f => {
            const fp = path.join(BK_PATH, f);
            if (fs.statSync(fp).mtime.getTime() < cutoff) {
                fs.unlinkSync(fp);
            }
        });
    } catch (e) {}
}

// =========================================================
// IPC: فچ HTTP بدون محدودیت CORS (برای لیسانس از GitHub)
// =========================================================
// ========================================================================
//  ارسال گزارش/فرم به واتساپِ دسکتاپ به‌صورتِ «فایلِ واقعیِ PDF»
//  ۱) HTML گزارش را در یک پنجرهٔ مخفی به PDF واقعی تبدیل می‌کنیم (printToPDF).
//  ۲) فایل را با نامِ گزارش ذخیره می‌کنیم.
//  ۳) خودِ فایل را در Clipboard قرار می‌دهیم (Set-Clipboard -Path) تا در واتساپ با Ctrl+V
//     به‌صورتِ «پیوستِ فایل» جای‌گذاری شود — نه نام و نه آدرس، بلکه خودِ فایل.
//  ۴) واتساپِ دسکتاپ را باز می‌کنیم تا کاربر مخاطب را انتخاب و ارسال کند.
// ========================================================================
// ------------------------------------------------------------------------
//  «پنلِ اشتراکِ ویندوز» برای ارسالِ فایلِ PDF بدونِ کلیپ‌بورد.
//  ‑ HWNDِ پنجرهٔ برنامه را می‌خواند و پنلِ نیتیوِ Share ویندوز را برای همان پنجره باز
//    می‌کند؛ کاربر واتساپ و سپس مخاطب را انتخاب می‌کند و خودِ فایل ارسال می‌شود.
//  ‑ کاملاً امن: اگر به هر دلیل (نسخهٔ ویندوز/دسترسی) کار نکرد، false برمی‌گرداند و
//    فراخواننده به روشِ قبلیِ کلیپ‌بورد بازمی‌گردد؛ پس هیچ چیزِ کارکننده نمی‌شکند.
//  ‑ ناهمگام و بدونِ بلاک‌کردنِ پراسسِ اصلی (execFile).
// ------------------------------------------------------------------------
function _readHwndString(win) {
    try {
        if (!win || typeof win.getNativeWindowHandle !== 'function') return null;
        const buf = win.getNativeWindowHandle();
        if (!buf || !buf.length) return null;
        if (buf.length >= 8) {
            try { return buf.readBigUInt64LE(0).toString(); } catch (e) { return String(buf.readUInt32LE(0)); }
        }
        return String(buf.readUInt32LE(0));
    } catch (e) { return null; }
}

function shareFileViaWindowsShareUI(filePath, title, win) {
    return new Promise((resolve) => {
        try {
            if (process.platform !== 'win32') return resolve({ ok: false, diag: 'not-win32' });
            // نکتهٔ کلیدی: GetForWindow فقط HWNDِ «همان پراسسِ فراخوان» را می‌پذیرد؛ HWNDِ پنجرهٔ
            // Electron از یک پراسسِ PowerShellِ جدا → E_ACCESSDENIED. پس پنجرهٔ لنگر را داخلِ خودِ
            // PowerShell می‌سازیم و پنل را روی همان باز می‌کنیم (همان روشی که در تست جواب داد).

            const esc = function (s) { return String(s == null ? '' : s).replace(/'/g, "''"); };
            const logPath = path.join(app.getPath('temp'), 'jouya-share-log-' + Date.now() + '.txt');
            // نشانگرهای مرحله‌ای (STEPn_OK) تا اگر جایی خطا داد، دقیقاً بدانیم کدام مرحله بود.
            // Emit: مارکرها را هم به کنسول (غیرریدایرکت) و هم به فایلِ لاگ می‌نویسد تا Node آن‌ها را
            // از فایل بخواند (خروجیِ اصلی ریدایرکت نمی‌شود تا پراسس «کنسولیِ واقعی/تعاملی» بماند و
            // پنلِ اشتراک برنامه‌ها را برشمارد). Emit عمداً از Write-Output استفاده نمی‌کند.
            // مسیر و عنوان را Base64 می‌کنیم تا نامِ فارسیِ فایل مستقل از encodingِ اسکریپت دقیق
            // دیکد شود (رفعِ نامِ فایلِ به‌هم‌ریخته). LogPath اَسکی است و نیاز ندارد.
            const b64 = function (s) { return Buffer.from(String(s == null ? '' : s), 'utf8').toString('base64'); };
            // ابعادِ پنجرهٔ برنامه: پنجرهٔ لنگر را دقیقاً روی همان می‌سازیم تا مثلِ اپِ مرجع، لنگر
            // «خودِ پنجرهٔ برنامه» به‌نظر برسد (نه یک پنجرهٔ اضافه) و پنل هم کامل باز شود.
            var _wb = {};
            try { _wb = (win && typeof win.getBounds === 'function') ? win.getBounds() : {}; } catch (e) { _wb = {}; }
            var _wx = Math.round(_wb.x != null ? _wb.x : 120), _wy = Math.round(_wb.y != null ? _wb.y : 80);
            var _ww = Math.round(_wb.width != null && _wb.width > 400 ? _wb.width : 1100);
            var _wh = Math.round(_wb.height != null && _wb.height > 300 ? _wb.height : 740);
            const lines = [
                "$FilePath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" + b64(filePath) + "'))",
                "$script:shareTitle = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" + b64(title) + "'))",
                "$LogPath = '" + esc(logPath) + "'",
                "$WinX = " + _wx, "$WinY = " + _wy, "$WinW = " + _ww, "$WinH = " + _wh,
                "function Emit($m){ try { [Console]::Out.WriteLine([string]$m) } catch {} ; try { [System.IO.File]::AppendAllText($LogPath, ([string]$m) + [Environment]::NewLine, [System.Text.Encoding]::UTF8) } catch {} }",
                "$ErrorActionPreference = 'Stop'",
                "try {",
                "    Add-Type -AssemblyName System.Windows.Forms | Out-Null",
                "    Add-Type -AssemblyName System.Drawing | Out-Null",
                "    Write-Output 'STEP1_OK winforms'",
                "    $iface = @'",
                "using System;",
                "using System.Text;",
                "using System.Diagnostics;",
                "using System.Security.Principal;",
                "using System.Runtime.InteropServices;",
                '[ComImport, Guid("3A3DCD6C-3EAB-43DC-BCDE-45671CE800C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
                "public interface IDTMInterop {",
                "    [return: MarshalAs(UnmanagedType.IInspectable)] object GetForWindow(IntPtr hwnd, [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid);",
                "    void ShowShareUIForWindow(IntPtr hwnd);",
                "}",
                // کلاسِ کمکی: کستِ RCW به اینترفیسِ COM و صدا زدنِ متدها را داخلِ C# (کامپایل‌شده)
                // انجام می‌دهد. علتِ خطای قبلی این بود که PowerShell به‌صورتِ دینامیک (IDispatch) نمی‌تواند
                // متدهای اینترفیسِ IUnknown-only (مثل GetForWindow) را روی __ComObject پیدا کند؛ اما کستِ
                // (IDTMInterop)factory در C# یک QueryInterfaceِ واقعی می‌زند و از vtable صدا می‌زند.
                "public static class JouyaDtm {",
                "    [return: MarshalAs(UnmanagedType.IInspectable)]",
                "    public static object GetForWindow(object factory, IntPtr hwnd, Guid iid) {",
                "        return ((IDTMInterop)factory).GetForWindow(hwnd, iid);",
                "    }",
                "    public static void ShowUI(object factory, IntPtr hwnd) {",
                "        ((IDTMInterop)factory).ShowShareUIForWindow(hwnd);",
                "    }",
                "}",
                // کمک‌کارِ user32 برای فورگراند کردنِ پنجرهٔ برنامه (Electron) پیش از نمایشِ پنلِ اشتراک؛
                // پنلِ اشتراک فقط برای پنجرهٔ فعالِ فورگراند نمایش داده می‌شود.
                "public static class Win32 {",
                "    [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);",
                "    [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n);",
                "    [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr h);",
                "    [DllImport(\"user32.dll\")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);",
                "    [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
                "    [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);",
                "    [DllImport(\"kernel32.dll\")] public static extern uint GetCurrentThreadId();",
                "    [DllImport(\"user32.dll\")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);",
                "    [DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);",
                "    [DllImport(\"shell32.dll\")] public static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string appID);",
                "    [DllImport(\"shell32.dll\")] public static extern int GetCurrentProcessExplicitAppUserModelID(out IntPtr AppID);",
                "    [DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow();",
                "    [DllImport(\"kernel32.dll\")] public static extern bool AllocConsole();",
                "    [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h);",
                "    [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);",
                "    [DllImport(\"user32.dll\")] public static extern IntPtr GetProcessWindowStation();",
                "    [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lenNeeded);",
                // گزارشِ زمینهٔ اجراییِ پراسس برای تشخیصِ فرقِ «اجرای اپ» با «تستِ مستقل».
                "    public static string ProcContext() {",
                "        StringBuilder sb = new StringBuilder();",
                "        try { IntPtr a; int hr = GetCurrentProcessExplicitAppUserModelID(out a); string s = (hr == 0 && a != IntPtr.Zero) ? Marshal.PtrToStringUni(a) : (\"(none hr=0x\" + hr.ToString(\"X\") + \")\"); sb.Append(\"AUMID=\").Append(s); } catch (Exception e) { sb.Append(\"AUMID_ERR=\").Append(e.Message); }",
                "        try { IntPtr ws = GetProcessWindowStation(); StringBuilder n = new StringBuilder(256); int need; GetUserObjectInformation(ws, 2, n, 256, out need); sb.Append(\" | WINSTA=\").Append(n.ToString()); } catch (Exception e) { sb.Append(\" | WINSTA_ERR=\").Append(e.Message); }",
                "        try { sb.Append(\" | CONSOLE=\").Append(GetConsoleWindow() != IntPtr.Zero ? \"yes\" : \"no\"); } catch {}",
                "        try { sb.Append(\" | SESSION=\").Append(Process.GetCurrentProcess().SessionId); } catch {}",
                "        try { sb.Append(\" | INTERACTIVE=\").Append(Environment.UserInteractive); } catch {}",
                "        try { WindowsPrincipal wp = new WindowsPrincipal(WindowsIdentity.GetCurrent()); sb.Append(\" | ELEVATED=\").Append(wp.IsInRole(WindowsBuiltInRole.Administrator)); } catch (Exception e) { sb.Append(\" | ELEVATED_ERR=\").Append(e.Message); }",
                "        return sb.ToString();",
                "    }",
                // فورگراندِ واقعی از یک پراسسِ پس‌زمینه: ترکیبِ ترفندِ Alt (دور زدنِ قفلِ فورگراندِ
                // ویندوز) + AttachThreadInput (چسباندنِ نخِ ورودی به نخِ پنجرهٔ فورگراندِ فعلی) +
                // SetForegroundWindow. بدونِ این، ShowShareUIForWindow بی‌خطا برمی‌گردد ولی پنل دیده نمی‌شود.
                "    public static bool ForceForeground(IntPtr hwnd) {",
                "        IntPtr fg = GetForegroundWindow();",
                "        uint pid; uint fgt = GetWindowThreadProcessId(fg, out pid);",
                "        uint mine = GetCurrentThreadId();",
                "        bool attached = false;",
                "        if (fgt != 0 && fgt != mine) { attached = AttachThreadInput(mine, fgt, true); }",
                "        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);",
                "        ShowWindow(hwnd, 5); BringWindowToTop(hwnd); bool ok = SetForegroundWindow(hwnd);",
                "        if (attached) { AttachThreadInput(mine, fgt, false); }",
                "        return ok;",
                "    }",
                "    public static bool IsForeground(IntPtr hwnd) { return GetForegroundWindow() == hwnd; }",
                "}",
                "'@",
                "    Add-Type -TypeDefinition $iface -Language CSharp | Out-Null",
                "    Write-Output 'STEP2_OK interop-type'",
                "    try { Write-Output ('CTX: ' + [Win32]::ProcContext()) } catch { Write-Output ('CTX_ERR: ' + $_.Exception.Message) }",
                "    try { $pp = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId; $ppn = (Get-Process -Id $pp -ErrorAction SilentlyContinue).ProcessName; $cv = [Win32]::IsWindowVisible([Win32]::GetConsoleWindow()); Write-Output ('CTX2: PARENT=' + $ppn + '(' + $pp + ') | CONSOLE_VISIBLE=' + $cv) } catch { Write-Output ('CTX2_ERR: ' + $_.Exception.Message) }",
                // کلیدِ حلِ مشکل: پنلِ اشتراک وقتی برنامه‌ها را برمی‌شمارد که پراسس یک کنسولِ «مرئی»
                // داشته باشد. کنسول را به بیرونِ صفحه می‌بریم و مرئی می‌کنیم تا IsWindowVisible=True شود
                // ولی کاربر آن را نبیند (SWP_NOACTIVATE|SWP_NOZORDER = 0x14 ، SW_SHOWNOACTIVATE = 4).
                "    try { $cw2 = [Win32]::GetConsoleWindow(); if ($cw2 -ne [IntPtr]::Zero) { [Win32]::SetWindowPos($cw2, [IntPtr]::Zero, -32000, -32000, 100, 100, 0x14) | Out-Null; [Win32]::ShowWindow($cw2, 4) | Out-Null }; Write-Output ('CONSOLE_VISIBLE_NOW=' + [Win32]::IsWindowVisible([Win32]::GetConsoleWindow())) } catch { Write-Output ('CONVIS_ERR: ' + $_.Exception.Message) }",
                "    [void][Windows.ApplicationModel.DataTransfer.DataTransferManager, Windows.ApplicationModel.DataTransfer, ContentType=WindowsRuntime]",
                // نکته: DataTransferManagerInterop یک نوعِ WinRTِ قابل‌پروجکت نیست (اینترفیسِ COM است
                // که خودمان با IDTMInterop در C# تعریف کرده‌ایم)؛ پس نباید به‌عنوان WinRT type بار شود،
                // وگرنه «Unable to find type» می‌دهد و کلِ اشتراک به کلیپ‌بورد برمی‌گردد. این خط حذف شد.
                "    [void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]",
                "    [void][Windows.Foundation.AsyncStatus, Windows.Foundation, ContentType=WindowsRuntime]",
                "    Write-Output 'STEP3_OK winrt-projections'",
                // در Windows PowerShell 5.1 نمی‌توان WinRT IAsyncOperation را با .Status/.GetResults
                // مستقیم خواند؛ باید با AsTask() به Taskِ دات‌نت تبدیل و await شود (روشِ استاندارد).
                "    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null",
                "    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
                "    function Await($op, $t) { $m = $asTaskGeneric.MakeGenericMethod($t); $task = $m.Invoke($null, @($op)); $task.Wait(-1) | Out-Null; return $task.Result }",
                // پنجرهٔ لنگرِ هم‌پراسس (لازمهٔ GetForWindow). کوچک، وسطِ صفحه، همیشه‌رو تا فورگراند باشد.
                // فرمِ لنگرِ مرئی (لازمهٔ نمایشِ پنلِ اشتراک): پنجرهٔ عادیِ کوچک که پنل روی آن لنگر
                // می‌اندازد. نامرئی/۱×۱ باعث می‌شود پنل اصلاً باز نشود، پس مرئی و کوچک نگهش می‌داریم؛
                // پس از انتخابِ مخاطب هم خودکار بسته می‌شود.
                // پنجرهٔ لنگر: «بزرگ» (تا پنلِ اشتراک کامل و بازشده باز شود) ولی «نامرئی» با Opacity=0
                // و بدونِ نمایش در تسک‌بار. سبکِ کادر پیش‌فرض می‌ماند (تغییرِ سبک پنل را می‌شکند). چون
                // Opacity روی IsWindowVisible و اندازه/مکان اثری ندارد، پنجره همچنان «مرئی و فورگراند و
                // بزرگ» محسوب می‌شود و پنل کامل باز می‌شود، ولی کاربر هیچ پنجره‌ای نمی‌بیند.
                // ساختارِ کارکردی (کادرِ پیش‌فرض، بزرگ، مرئی) که پنل را کامل باز می‌کند؛ فقط رنگش را
                // مثلِ پنلِ اشتراک (خاکستریِ تیره) می‌کنیم تا یکدست به نظر برسد. با کلیک روی سطحِ آن
                // (یعنی «کلیک روی جای دیگرِ صفحه» بیرونِ پنل) هر دو بسته می‌شوند.
                "    $script:form = New-Object System.Windows.Forms.Form",
                "    $script:form.Text = ' '",
                "    $script:form.StartPosition = 'CenterScreen'; $script:form.TopMost = $true",
                "    $script:form.Width = 560; $script:form.Height = 760",
                "    $script:form.BackColor = [System.Drawing.Color]::FromArgb(32,32,32)",
                "    $lbl = New-Object System.Windows.Forms.Label; $lbl.Dock = 'Fill'; $lbl.BackColor = [System.Drawing.Color]::FromArgb(32,32,32); $script:form.Controls.Add($lbl)",
                "    $script:form.Show(); $script:form.Activate(); [System.Windows.Forms.Application]::DoEvents()",
                "    $hwnd = $script:form.Handle",
                "    try { [Win32]::ForceForeground($hwnd) | Out-Null } catch {}",
                "    $factory = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal]::GetActivationFactory([Windows.ApplicationModel.DataTransfer.DataTransferManager])",
                "    Write-Output 'STEP4_OK factory'",
                "    $iid = [Guid]'a5caee9b-8708-49d1-8d36-67d25a8da00c'",
                // کستِ اینترفیس داخلِ C# (نه PowerShell) → GetForWindow واقعاً از vtable صدا می‌شود و
                // خروجی (IInspectable) به‌طورِ خودکار به DataTransferManagerِ پروجکت‌شده تبدیل می‌شود،
                // پس $dtm.add_DataRequested بدونِ مشکل کار می‌کند.
                "    $dtm = [JouyaDtm]::GetForWindow($factory, $hwnd, $iid)",
                "    Write-Output 'STEP5_OK dtm-for-window'",
                "    $script:shareFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($FilePath)) ([Windows.Storage.StorageFile])",
                "    if (-not $script:shareFile) { throw 'storagefile-null' }",
                "    try { Write-Output ('FILE_NAME: ' + $script:shareFile.Name) } catch {}",
                "    Write-Output 'STEP6_OK storagefile'",
                // هندلرِ رویداد: PowerShell این scriptblock را خودش به دلیگیتِ TypedEventHandlerِ رویداد",
                // تبدیل می‌کند. از متغیرهای script-scope استفاده می‌شود تا closure روی فایل/عنوان مطمئن باشد.",
                // هندلرِ رویداد با Deferral: تحویلِ فایل به هدف (واتساپ) ممکن است چند لحظه پس از
                // انتخابِ کاربر طول بکشد؛ با GetDeferral تا لحظهٔ Complete، بستهٔ داده باز و فایل
                // برای هدف در دسترس می‌ماند — پس واتساپ خودِ فایل را می‌گیرد (بدونِ Ctrl+V).
                "    $null = $dtm.add_DataRequested({",
                "        param($s, $e)",
                "        $def = $null",
                "        try {",
                "            $req = $e.Request",
                "            $def = $req.GetDeferral()",
                "            $req.Data.Properties.Title = $script:shareTitle",
                "            $lst = New-Object 'System.Collections.Generic.List[Windows.Storage.IStorageItem]'",
                "            $lst.Add($script:shareFile)",
                "            $req.Data.SetStorageItems($lst)",
                "        } catch { }",
                "        finally { if ($def) { try { $def.Complete() } catch {} } }",
                "    })",
                // وقتی کاربر هدف (واتساپ) را انتخاب کرد، علامت می‌گذاریم تا کمی بعد پنجرهٔ لنگر بسته شود.
                "    $script:chosen = $false",
                "    try { $null = $dtm.add_TargetApplicationChosen({ param($s, $e) $script:chosen = $true; try { Write-Output ('TARGET_CHOSEN: ' + $e.ApplicationName) } catch {} }) } catch {}",
                "    Write-Output 'STEP7_OK handler'",
                // پنجرهٔ لنگر را واقعاً فورگراند کن و وضعیت را گزارش بده تا در لاگ ببینیم موفق بوده یا نه.
                "    $fgok = $false",
                "    try { $fgok = [Win32]::ForceForeground($hwnd) } catch {}",
                "    Start-Sleep -Milliseconds 150",
                "    [System.Windows.Forms.Application]::DoEvents()",
                "    $fgmatch = $false; try { $fgmatch = [Win32]::IsForeground($hwnd) } catch {}",
                "    Write-Output ('FG_OK: ' + $fgok + ' | FG_MATCH: ' + $fgmatch)",
                "    Start-Sleep -Milliseconds 150",
                "    [JouyaDtm]::ShowUI($factory, $hwnd)",
                "    Write-Output 'SHARE_OK'",
                // هَندلِ پنجرهٔ خودِ پنلِ اشتراک را می‌گیریم تا وقتی بسته شد (چه با انتخابِ مخاطب، چه با
                // کلیک روی جای دیگرِ صفحه)، پنجرهٔ لنگر هم بسته شود.
                "    Start-Sleep -Milliseconds 500; [System.Windows.Forms.Application]::DoEvents()",
                "    $panelHwnd = [Win32]::GetForegroundWindow(); if ($panelHwnd -eq $hwnd) { $panelHwnd = [IntPtr]::Zero }",
                // پراسس باید تا زمانی که کاربر واتساپ و سپس مخاطب را انتخاب و ارسال کند زنده و در
                // حالِ پمپِ پیام بماند؛ وگرنه شیءِ StorageFile از بین می‌رود و انتقالِ فایل شکست
                // می‌خورد. تا ۱۸۰ ثانیه پمپ می‌کنیم (Node به‌محضِ SHARE_OK بی‌درنگ پاسخ می‌دهد و
                // این پراسس را در پس‌زمینه زنده می‌گذارد).
                "    $sw = [System.Diagnostics.Stopwatch]::StartNew()",
                "    $chosenAt = $null",
                "    $panelWasUp = $false; $panelGoneAt = $null",
                "    while ($sw.Elapsed.TotalSeconds -lt 90.0) {",
                "        [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50",
                "        if ($script:form.IsDisposed) { break }",   // کلیک روی سطحِ لنگر → لغو → بستنِ فوری
                // پنل که بسته شد (انتخابِ مخاطب یا کلیکِ بیرون)، «مهلتِ انتقالِ فایل» می‌دهیم و بعد
                // پنجرهٔ لنگر را می‌بندیم؛ وگرنه اگر فوری ببندیم، شیءِ فایل پیش از خواندنِ واتساپ از بین
                // می‌رود و واتساپ هنگ می‌کند/فایل نمی‌گیرد.
                "        if ($panelHwnd -ne [IntPtr]::Zero) {",
                "            if ([Win32]::IsWindowVisible($panelHwnd)) { $panelWasUp = $true; $panelGoneAt = $null }",
                "            elseif ($panelWasUp) {",
                // پنل بسته شد → فوراً پنجرهٔ لنگر را نامرئی و پشتِ صفحه کن تا جلوی واتساپ (انتخابِ مخاطب)
                // را نگیرد؛ ولی پراسس چند ثانیه زنده بماند تا انتقالِ فایل به واتساپ کامل شود، سپس بستن.
                "                if (-not $panelGoneAt) { $panelGoneAt = [DateTime]::UtcNow; try { $script:form.TopMost = $false } catch {}; try { $script:form.Opacity = 0 } catch {}; try { [Win32]::ShowWindow($hwnd, 0) | Out-Null } catch {} }",
                "                elseif ((([DateTime]::UtcNow - $panelGoneAt)).TotalSeconds -gt 5) { break }",
                "            }",
                "        }",
                "    }",
                "    try { $script:form.Close(); $script:form.Dispose() } catch {}",
                "} catch {",
                "    Write-Output ('SHARE_ERR: ' + $_.Exception.GetType().Name + ' | ' + $_.Exception.Message)",
                "    try { if ($script:form) { $script:form.Close(); $script:form.Dispose() } } catch {}",
                "}"
            ];
            // همهٔ مارکرهای Write-Output را به Emit تبدیل کن تا هم به کنسول (غیرریدایرکت) و هم
            // به فایلِ لاگ نوشته شوند. (خطِ تعریفِ Emit خودش Write-Output ندارد، پس بازگشتی نمی‌شود.)
            var psLines = lines.map(function (l) { return l.replace(/Write-Output /g, 'Emit '); });

            const psPath = path.join(app.getPath('temp'), 'jouya-share-' + Date.now() + '.ps1');
            fs.writeFileSync(psPath, '﻿' + psLines.join('\r\n'), 'utf8');

            // اجرا از طریقِ WScript با پنجرهٔ پنهان (0): PowerShell یک «کنسولِ واقعیِ پنهان و بدونِ
            // ریدایرکتِ خروجی» می‌گیرد — دقیقاً مثلِ وقتی کاربر خودش اجرا می‌کند — پس ویندوز پراسس را
            // «کنسولیِ تعاملیِ واقعی» می‌بیند و پنلِ اشتراک برنامه‌های هدف را برمی‌شمارد. Node خروجی را
            // از فایلِ لاگ می‌خواند (نه pipe) تا هیچ ریدایرکتی روی پراسس نباشد.
            const vbsPath = path.join(app.getPath('temp'), 'jouya-share-' + Date.now() + '.vbs');
            const psCmd = 'powershell -NoProfile -STA -ExecutionPolicy Bypass -File ""' + psPath + '""';
            const vbs = 'CreateObject("WScript.Shell").Run "' + psCmd + '", 0, False';
            fs.writeFileSync(vbsPath, vbs, 'utf8');

            const { spawn } = require('child_process');
            let settled = false;
            const finish = function (ok, diag) {
                if (settled) return; settled = true;
                resolve({ ok: ok, diag: String(diag || '').slice(0, 1500) });
            };
            const cleanupTmp = function () {
                setTimeout(function () {
                    try { fs.unlinkSync(psPath); } catch (e) {}
                    try { fs.unlinkSync(vbsPath); } catch (e) {}
                }, 5000);
            };

            try {
                var launcher = spawn('wscript.exe', [vbsPath], { windowsHide: true });
                launcher.on('error', function (e) {
                    if (!settled) { finish(false, 'wscript-err:' + (e && e.message ? e.message : String(e))); cleanupTmp(); }
                });
            } catch (spawnErr) {
                return resolve({ ok: false, diag: 'spawn-ex:' + (spawnErr && spawnErr.message ? spawnErr.message : String(spawnErr)) });
            }

            // خواندنِ مارکرها از فایلِ لاگ (polling). به‌محضِ SHARE_OK → موفق؛ SHARE_ERR → ناموفق.
            var started = Date.now();
            var poll = setInterval(function () {
                var content = '';
                try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) {}
                if (!settled && content.indexOf('SHARE_OK') !== -1) {
                    clearInterval(poll); finish(true, content.trim()); cleanupTmp();
                } else if (!settled && /SHARE_ERR/.test(content)) {
                    clearInterval(poll); finish(false, content.trim()); cleanupTmp();
                } else if (!settled && (Date.now() - started) > 30000) {
                    clearInterval(poll); finish(false, 'timeout-no-share\n' + content.trim()); cleanupTmp();
                }
            }, 300);
        } catch (e) { resolve({ ok: false, diag: 'ex:' + (e && e.message ? e.message : String(e)) }); }
    });
}

// ══════════════════════════════════════════════════════════════════════════
// ترجمه‌آواییِ فارسی → لاتینِ خوانا برای نامِ فایلِ اشتراک‌گذاری.
// چرا؟ واتساپ‌دسکتاپ نامِ فایلِ غیرلاتین را که از «پنلِ اشتراکِ ویندوز» می‌آید
// به‌صورتِ خراب (mojibake؛ مثلِ Ú¯Ø²Ø§Ø±Ø´) نشان می‌دهد؛ چون بایت‌های UTF-8 را
// اشتباهی با CP1252/Latin-1 می‌خواند و در آن جدول اصلاً حرفِ فارسی وجود ندارد.
// پس هیچ نام‌گذاریِ فارسی از این مسیر برای گیرنده خوانا نمی‌شود. راهِ تضمینی و
// همه‌جا-خوانا، نوشتنِ همان محتوا با حروفِ لاتین است (مثلِ Gozaresh-Moamelat-Ahmadullah).
function _persianToLatin(str) {
    if (!str) return '';
    str = String(str);
    // ۱) واژه‌های پرکاربردِ برنامه → معادلِ خوانا (کیفیتِ خواناییِ بهتر از تک‌حرف)
    var words = {
        'گزارش': 'Gozaresh', 'معاملات': 'Moamelat', 'معامله': 'Moamele',
        'پرداختی': 'Pardakhti', 'پرداخت': 'Pardakht', 'دریافتی': 'Daryafti', 'دریافت': 'Daryaft',
        'رسید': 'Resid', 'بل': 'Bill', 'فروش': 'Forosh', 'خرید': 'Kharid',
        'فاکتور': 'Factor', 'پیش‌فاکتور': 'PishFactor', 'صورتحساب': 'Surathesab',
        'صورت': 'Surat', 'حساب': 'Hesab', 'اجناس': 'Ajnas', 'جنس': 'Jens',
        'انبار': 'Anbar', 'گدام': 'Godam', 'انتقال': 'Enteqal', 'شخص': 'Shakhs',
        'اشخاص': 'Ashkhas', 'مصرف': 'Masraf', 'مصارف': 'Masaref', 'مصارفات': 'Masarefat',
        'کمیشن': 'Commission', 'حواله': 'Hawala', 'برگشتی': 'Bargashti', 'برگشت': 'Bargasht',
        'مشتری': 'Moshtari', 'قیمت': 'Qeymat', 'روزانه': 'Roozane', 'کارمند': 'Karmand',
        'کارمندان': 'Karmandan', 'صندوق': 'Sandoq', 'بانک': 'Bank', 'میان': 'Mian',
        // نام‌های پرکاربرد (اشخاص) — چون مصوتِ کوتاه در فارسی نوشته نمی‌شود، این معادل‌ها
        // خواناییِ نامِ گیرنده را به‌مراتب بهتر می‌کنند. ترتیب: طولانی‌تر/خاص‌تر ابتدا.
        'عبدالله': 'Abdullah', 'عبدال': 'Abdul', 'احمد': 'Ahmad', 'محمدی': 'Mohammadi',
        'محمود': 'Mahmood', 'محمد': 'Mohammad', 'الله': 'Ullah', 'کریمی': 'Karimi',
        'کریم': 'Karim', 'رحیمی': 'Rahimi', 'رحیم': 'Rahim', 'حسینی': 'Hoseini',
        'حسین': 'Hosein', 'حسن': 'Hasan', 'زلمی': 'Zalmai', 'خان': 'Khan',
        'الدین': 'uddin', 'نور': 'Noor', 'گل': 'Gul', 'شاه': 'Shah'
    };
    Object.keys(words).forEach(function (w) {
        if (str.indexOf(w) !== -1) str = str.split(w).join(' ' + words[w] + ' ');
    });
    // ۲) نگاشتِ تک‌حرفی برای بقیه (به‌ویژه نامِ اشخاص)
    var map = {
        'آ': 'a', 'ا': 'a', 'أ': 'a', 'إ': 'e', 'ء': '', 'ئ': 'y', 'ؤ': 'o',
        'ب': 'b', 'پ': 'p', 'ت': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh',
        'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's',
        'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
        'ک': 'k', 'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'و': 'o',
        'ه': 'h', 'ة': 'h', 'ی': 'i', 'ي': 'i', 'ى': 'a',
        'ً': '', 'ٌ': '', 'ٍ': '', 'َ': 'a', 'ُ': 'o', 'ِ': 'e', 'ّ': '', 'ْ': '', 'ٰ': 'a', 'ٓ': '',
        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
        '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
    };
    var out = '';
    for (var i = 0; i < str.length; i++) {
        var ch = str[i];
        if (Object.prototype.hasOwnProperty.call(map, ch)) out += map[ch];
        else if (/[A-Za-z0-9]/.test(ch)) out += ch;
        else out += ' ';
    }
    out = out.replace(/\s+/g, ' ').trim().replace(/\s/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    out = out.split('-').map(function (p) { return p ? p.charAt(0).toUpperCase() + p.slice(1) : p; }).join('-');
    return out;
}

ipcMain.handle('share-pdf-whatsapp', async (event, payload) => {
    const { html, fileName } = payload || {};
    let pdfWin = null;
    try {
        if (!html) return { ok: false, error: 'no-html' };

        // ۱) رندرِ HTML → PDF در پنجرهٔ مخفی
        pdfWin = new BrowserWindow({
            show: false,
            webPreferences: { offscreen: false, javascript: true, sandbox: true }
        });
        const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
        await pdfWin.loadURL(dataUrl);
        // فرصت برای بارگذاریِ فونت/آیکن‌های تزریق‌شده
        await new Promise((r) => setTimeout(r, 500));
        const pdfBuffer = await pdfWin.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            margins: { marginType: 'default' }
        });
        try { pdfWin.destroy(); } catch (e) {}
        pdfWin = null;

        // ۲) ذخیرهٔ فایل با نامِ امن در پوشهٔ temp (NFC تا کاراکترهای فارسیِ ترکیبی درست ذخیره شوند)
        // نوعِ سند (پیشوندِ انگلیسیِ ثابت) از روی متنِ فارسیِ نام
        var _fn = String(fileName || '');
        var _pfx = 'Report';
        if (/بل\s*فروش/.test(_fn)) _pfx = 'SalesInvoice';
        else if (/بل\s*خرید/.test(_fn)) _pfx = 'PurchaseInvoice';
        else if (/پرداخت/.test(_fn)) _pfx = 'PaymentReceipt';
        else if (/دریافت/.test(_fn)) _pfx = 'ReceiptVoucher';
        else if (/رسید/.test(_fn)) _pfx = 'Receipt';
        else if (/گزارش/.test(_fn)) _pfx = 'Report';
        else _pfx = 'Jouya';
        // نامِ فایلِ دسکتاپ = «لاتینِ خوانا» (ترجمه‌آوایی + پیشوندِ نوعِ سند).
        // چرا فارسی نمی‌گذاریم؟ «واتساپِ دسکتاپ» بایت‌های UTF-8 نام را با Latin-1 می‌خواند و نام
        // فارسی را خراب (mojibake مثلِ Ú¯Ø²Ø§Ø±Ø´) نشان می‌دهد؛ این باگِ خودِ واتساپِ دسکتاپ است و
        // با هیچ کدگذاری‌ای قابلِ رفع نیست. پس روی دسکتاپ نام را لاتینِ خوانا می‌کنیم تا اصلاً
        // mojibake دیده نشود. راهِ نامِ کاملاً فارسیِ سالم، ارسال از «نسخهٔ موبایل» است (پیاده شده).
        var _latin = '';
        try { _latin = _persianToLatin(_fn); } catch (e) { _latin = ''; }
        if (_latin && _latin.toLowerCase().indexOf(_pfx.toLowerCase() + '-') === 0) _latin = _latin.slice(_pfx.length + 1);
        let safeName = (_pfx + (_latin ? '-' + _latin : ''))
            .replace(/[\\/:*?"<>|]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 110);
        try { safeName = safeName.normalize('NFC'); } catch (e) {}
        if (!safeName) safeName = 'Report';
        if (!/\.pdf$/i.test(safeName)) safeName += '.pdf';
        // هر اشتراک در یک «پوشهٔ یکتا» تا: (۱) نامِ فارسیِ فایل تمیز و بدونِ timestamp بماند،
        // (۲) اشتراکِ دوبارهٔ همان گزارش با فایلِ قبلی (که هنوز باز است) تداخل/قفل نکند و خطا ندهد.
        const shareDir = path.join(app.getPath('temp'), 'jouya-share-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
        try { fs.mkdirSync(shareDir, { recursive: true }); } catch (e) {}
        const outPath = path.join(shareDir, safeName);
        fs.writeFileSync(outPath, pdfBuffer);

        // ۳) روشِ درست و «بدونِ کلیپ‌بورد»: پنلِ اشتراکِ ویندوز را با HWNDِ پنجرهٔ برنامه باز
        //    می‌کنیم؛ کاربر واتساپ و سپس مخاطب را انتخاب می‌کند و همین فایلِ PDF پیوست/ارسال می‌شود.
        let sharedViaPanel = false;
        let shareDiag = '';
        try {
            // پنجره‌ای که کاربر می‌بیند (پیش‌نمایش) را مرجع بگیر تا پنلِ اشتراک جلوی همان باز شود.
            const shareWin = BrowserWindow.getFocusedWindow() || BrowserWindow.fromWebContents(event.sender) || mainWindow;
            try { shareWin.show(); shareWin.focus(); } catch (e) {}
            const sres = await shareFileViaWindowsShareUI(outPath, String(fileName || 'گزارش'), shareWin);
            sharedViaPanel = !!(sres && sres.ok);
            shareDiag = (sres && sres.diag) || '';
        } catch (e) { sharedViaPanel = false; shareDiag = 'call-ex:' + (e && e.message ? e.message : String(e)); }
        if (sharedViaPanel) {
            return { ok: true, method: 'share', clip: false, opened: true, path: outPath, shareDiag: shareDiag };
        }

        // ۴) fallbackِ امن — فقط اگر پنلِ اشتراک در دسترس نبود: همان روشِ قبلیِ کلیپ‌بورد + بازکردنِ
        //    واتساپ، تا واتساپ هرگز از کار نیفتد (بدونِ هیچ تغییرِ رفتاری نسبت به قبل).
        let clip = false;
        try {
            const { execFileSync } = require('child_process');
            execFileSync(
                'powershell',
                ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -LiteralPath "' + outPath + '"'],
                { windowsHide: true, timeout: 8000 }
            );
            clip = true;
        } catch (e) { clip = false; }

        let opened = false;
        try { await shell.openExternal('whatsapp://'); opened = true; } catch (e) { opened = false; }

        return { ok: true, method: 'clipboard', path: outPath, clip: clip, opened: opened, shareDiag: shareDiag };
    } catch (e) {
        try { if (pdfWin) pdfWin.destroy(); } catch (e2) {}
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
});

ipcMain.handle('http-fetch-json', async (event, url) => {
    return new Promise((resolve) => {
        try {
            const u = new URL(url);
            const client = u.protocol === 'https:' ? https : http;
            client.get(url, { headers: { 'User-Agent': 'JouyaStore/1.0' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    // Follow redirect once
                    return ipcMain.emit('http-fetch-json', event, res.headers.location);
                }
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        resolve({ success: false, error: `HTTP ${res.statusCode}` });
                        return;
                    }
                    try {
                        resolve({ success: true, data: JSON.parse(data) });
                    } catch (e) {
                        resolve({ success: false, error: 'JSON نامعتبر' });
                    }
                });
            }).on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        } catch (e) {
            resolve({ success: false, error: e.message });
        }
    });
});

// =========================================================
// IPC: OAuth گوگل با روش Desktop (Loopback IP)
// این روش قطعاً کار می‌کند چون google رسماً برای Desktop apps پشتیبانی می‌کند
// =========================================================
const OAUTH_CONFIG = {
    // ⚠️ این Client ID باید از نوع "Desktop app" باشد
    // برای ساخت: https://console.cloud.google.com/apis/credentials
    // → CREATE CREDENTIALS → OAuth client ID → Application type: Desktop app
    CLIENT_ID: '67794969596-73upe74lq9dehlb8bc109ec0o220idbu.apps.googleusercontent.com',
    // ⚠️ Client Secret برای Desktop app:
    // بعد از ساخت Client ID از نوع Desktop، Google یک Client Secret هم به شما می‌دهد.
    // آن را اینجا کپی کنید (مثال: GOCSPX-xxxxxxxxxxxxxxxxxxxx)
    // اگر خالی بگذارید و Google خطای client_secret بدهد، حتماً این فیلد را پر کنید.
    CLIENT_SECRET: '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', // ← Client Secret خود را اینجا وارد کنید
    SCOPES: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
};

// PKCE helper
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

ipcMain.handle('google-oauth-signin', async () => {
    return new Promise((resolve) => {
        try {
            // ساخت سرور موقت روی پورت تصادفی
            const server = http.createServer();
            const codeVerifier = generateCodeVerifier();
            const codeChallenge = generateCodeChallenge(codeVerifier);
            const state = crypto.randomBytes(16).toString('hex');

            // باز کردن لینک OAuth بعد از listen شدن سرور
            server.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                const redirectUri = `http://127.0.0.1:${port}/callback`;

                const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
                authUrl.searchParams.set('client_id', OAUTH_CONFIG.CLIENT_ID);
                authUrl.searchParams.set('redirect_uri', redirectUri);
                authUrl.searchParams.set('response_type', 'code');
                authUrl.searchParams.set('scope', OAUTH_CONFIG.SCOPES);
                authUrl.searchParams.set('state', state);
                authUrl.searchParams.set('code_challenge', codeChallenge);
                authUrl.searchParams.set('code_challenge_method', 'S256');
                authUrl.searchParams.set('access_type', 'offline');
                authUrl.searchParams.set('prompt', 'consent');

                // باز کردن مرورگر سیستم (نه WebView)
                shell.openExternal(authUrl.toString());

                // تایم‌اوت ۵ دقیقه
                const timeout = setTimeout(() => {
                    server.close();
                    resolve({ success: false, error: 'زمان ورود به پایان رسید (۵ دقیقه).' });
                }, 5 * 60 * 1000);

                server.on('request', async (req, res) => {
                    try {
                        const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);

                        if (reqUrl.pathname !== '/callback') {
                            res.writeHead(404);
                            res.end();
                            return;
                        }

                        const code = reqUrl.searchParams.get('code');
                        const returnedState = reqUrl.searchParams.get('state');
                        const error = reqUrl.searchParams.get('error');

                        // پاسخ HTML قشنگ به مرورگر
                        const successHtml = `
                            <!DOCTYPE html>
                            <html lang="fa" dir="rtl">
                            <head>
                                <meta charset="UTF-8">
                                <title>اتصال موفق</title>
                                <style>
                                    body { font-family: system-ui, -apple-system, sans-serif; background: linear-gradient(135deg, #f8fafc 0%, #e0e7ff 100%); margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
                                    .box { background: white; padding: 40px 60px; border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.1); text-align: center; max-width: 480px; }
                                    .icon { width: 80px; height: 80px; margin: 0 auto 20px; background: linear-gradient(135deg, #10b981, #059669); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 40px; }
                                    h1 { color: #1e293b; margin: 0 0 12px; font-size: 24px; }
                                    p { color: #64748b; line-height: 1.7; margin: 0; }
                                </style>
                            </head>
                            <body>
                                <div class="box">
                                    <div class="icon">✓</div>
                                    <h1>اتصال با موفقیت برقرار شد</h1>
                                    <p>می‌توانید این پنجره را ببندید و به اپلیکیشن بازگردید.</p>
                                </div>
                                <script>setTimeout(() => window.close(), 2500);</script>
                            </body>
                            </html>
                        `;

                        const errorHtml = `
                            <!DOCTYPE html>
                            <html lang="fa" dir="rtl">
                            <head>
                                <meta charset="UTF-8">
                                <title>خطا در ورود</title>
                                <style>
                                    body { font-family: system-ui, sans-serif; background: #fef2f2; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
                                    .box { background: white; padding: 40px 60px; border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.1); text-align: center; max-width: 480px; }
                                    .icon { width: 80px; height: 80px; margin: 0 auto 20px; background: #fee2e2; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #dc2626; font-size: 40px; }
                                    h1 { color: #991b1b; margin: 0 0 12px; }
                                </style>
                            </head>
                            <body>
                                <div class="box">
                                    <div class="icon">!</div>
                                    <h1>خطا در ورود</h1>
                                    <p>${error || 'ورود ناموفق بود'}</p>
                                </div>
                            </body>
                            </html>
                        `;

                        if (error) {
                            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end(errorHtml);
                            clearTimeout(timeout);
                            server.close();
                            resolve({ success: false, error: error });
                            return;
                        }

                        if (!code || returnedState !== state) {
                            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end(errorHtml);
                            clearTimeout(timeout);
                            server.close();
                            resolve({ success: false, error: 'پاسخ نامعتبر از Google' });
                            return;
                        }

                        // پاسخ موفق به مرورگر
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(successHtml);

                        // بستن سرور بعد از ارسال پاسخ
                        clearTimeout(timeout);
                        setTimeout(() => server.close(), 100);

                        // تبادل code با token
                        const tokenResult = await exchangeCodeForToken(code, redirectUri, codeVerifier);
                        if (!tokenResult.success) {
                            resolve(tokenResult);
                            return;
                        }

                        // دریافت اطلاعات کاربر
                        const userInfo = await fetchUserInfo(tokenResult.token.access_token);

                        resolve({
                            success: true,
                            token: tokenResult.token,
                            userInfo: userInfo
                        });

                    } catch (e) {
                        res.writeHead(500);
                        res.end('Internal error');
                        clearTimeout(timeout);
                        server.close();
                        resolve({ success: false, error: e.message });
                    }
                });
            });

            server.on('error', (err) => {
                resolve({ success: false, error: 'سرور: ' + err.message });
            });
        } catch (e) {
            resolve({ success: false, error: e.message });
        }
    });
});

function exchangeCodeForToken(code, redirectUri, codeVerifier) {
    return new Promise((resolve) => {
        const params = new URLSearchParams();
        params.append('code', code);
        params.append('client_id', OAUTH_CONFIG.CLIENT_ID);
        if (OAUTH_CONFIG.CLIENT_SECRET) {
            params.append('client_secret', OAUTH_CONFIG.CLIENT_SECRET);
        }
        params.append('redirect_uri', redirectUri);
        params.append('grant_type', 'authorization_code');
        params.append('code_verifier', codeVerifier);

        const body = params.toString();
        const options = {
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        let errMsg = parsed.error_description || parsed.error;
                        // خطای رایج: Client Secret پر نشده
                        if (parsed.error === 'invalid_client' || (errMsg && errMsg.toLowerCase().includes('client_secret'))) {
                            errMsg = 'خطا: client_secret لازم است.\n\nراه‌حل:\n1. به console.cloud.google.com/apis/credentials بروید\n2. روی Client ID خود کلیک کنید\n3. Client Secret را کپی کنید\n4. در فایل main.js فیلد CLIENT_SECRET را پر کنید';
                        }
                        resolve({ success: false, error: errMsg });
                        return;
                    }
                    resolve({
                        success: true,
                        token: {
                            access_token: parsed.access_token,
                            refresh_token: parsed.refresh_token || null,
                            expires_in: parsed.expires_in || 3600,
                            token_type: parsed.token_type || 'Bearer',
                            scope: parsed.scope,
                            savedAt: Date.now()
                        }
                    });
                } catch (e) {
                    resolve({ success: false, error: 'پاسخ نامعتبر از Google' });
                }
            });
        });

        req.on('error', (err) => {
            resolve({ success: false, error: 'خطای شبکه: ' + err.message });
        });

        req.write(body);
        req.end();
    });
}

function fetchUserInfo(accessToken) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'www.googleapis.com',
            path: '/oauth2/v2/userinfo',
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + accessToken }
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve({}); }
            });
        }).on('error', () => resolve({}));
    });
}

// رفرش توکن
ipcMain.handle('google-refresh-token', async (event, refreshToken) => {
    return new Promise((resolve) => {
        const params = new URLSearchParams();
        params.append('client_id', OAUTH_CONFIG.CLIENT_ID);
        if (OAUTH_CONFIG.CLIENT_SECRET) {
            params.append('client_secret', OAUTH_CONFIG.CLIENT_SECRET);
        }
        params.append('refresh_token', refreshToken);
        params.append('grant_type', 'refresh_token');

        const body = params.toString();
        const options = {
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        resolve({ success: false, error: parsed.error });
                        return;
                    }
                    resolve({
                        success: true,
                        token: {
                            access_token: parsed.access_token,
                            refresh_token: refreshToken, // refresh_token معمولاً برنمی‌گردد
                            expires_in: parsed.expires_in || 3600,
                            token_type: parsed.token_type || 'Bearer',
                            savedAt: Date.now()
                        }
                    });
                } catch (e) {
                    resolve({ success: false, error: 'خطا در رفرش توکن' });
                }
            });
        });

        req.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });

        req.write(body);
        req.end();
    });
});

// =========================================================
// IPC: سیستم آپدیت
// =========================================================
ipcMain.handle('check-for-updates', async () => {
    if (!autoUpdater) {
        return { success: false, error: 'electron-updater نصب نشده است.' };
    }
    if (isDev) {
        return { success: false, error: 'بررسی آپدیت در محیط توسعه غیرفعال است.' };
    }
    try {
        const result = await autoUpdater.checkForUpdates();
        if (result && result.updateInfo) {
            const current = app.getVersion();
            const latest = result.updateInfo.version;
            if (latest === current) {
                return { success: true, hasUpdate: false, currentVersion: current };
            }
            return {
                success: true,
                hasUpdate: true,
                currentVersion: current,
                latestVersion: latest,
                releaseNotes: result.updateInfo.releaseNotes || '',
                releaseDate: result.updateInfo.releaseDate || ''
            };
        }
        return { success: true, hasUpdate: false };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('download-update', async () => {
    if (!autoUpdater) {
        return { success: false, error: 'electron-updater نصب نشده است.' };
    }
    try {
        await autoUpdater.downloadUpdate();
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('install-update', async () => {
    if (!autoUpdater) {
        return { success: false, error: 'electron-updater نصب نشده است.' };
    }
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
});

ipcMain.handle('get-app-version', async () => {
    return { version: app.getVersion() };
});

// رویدادهای autoUpdater
if (autoUpdater) {
    autoUpdater.on('download-progress', (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-download-progress', {
                percent: Math.round(progress.percent),
                bytesPerSecond: progress.bytesPerSecond,
                transferred: progress.transferred,
                total: progress.total
            });
        }
    });
    autoUpdater.on('update-downloaded', (info) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-downloaded', info);
        }
    });
    autoUpdater.on('error', (err) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-error', err.message);
        }
    });
}

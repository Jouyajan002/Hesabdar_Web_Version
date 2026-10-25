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
        title: 'APEX Store Manager',
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
            const hwnd = _readHwndString(win);
            if (!hwnd) return resolve({ ok: false, diag: 'no-hwnd' });

            const esc = function (s) { return String(s == null ? '' : s).replace(/'/g, "''"); };
            // نشانگرهای مرحله‌ای (STEPn_OK) تا اگر جایی خطا داد، دقیقاً بدانیم کدام مرحله بود.
            const lines = [
                "$FilePath = '" + esc(filePath) + "'",
                "$HwndStr = '" + esc(hwnd) + "'",
                "$script:shareTitle = '" + esc(title) + "'",
                "$ErrorActionPreference = 'Stop'",
                "try {",
                "    Add-Type -AssemblyName System.Windows.Forms | Out-Null",
                "    Write-Output 'STEP1_OK winforms'",
                "    $iface = @'",
                "using System;",
                "using System.Runtime.InteropServices;",
                '[ComImport, Guid("3A3DCD6C-3EAB-43DC-BCDE-45671CE800C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
                "public interface IDTMInterop {",
                "    [return: MarshalAs(UnmanagedType.IInspectable)] object GetForWindow(IntPtr hwnd, [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid);",
                "    void ShowShareUIForWindow(IntPtr hwnd);",
                "}",
                "'@",
                "    Add-Type -TypeDefinition $iface -Language CSharp | Out-Null",
                "    Write-Output 'STEP2_OK interop-type'",
                "    [void][Windows.ApplicationModel.DataTransfer.DataTransferManager, Windows.ApplicationModel.DataTransfer, ContentType=WindowsRuntime]",
                "    [void][Windows.ApplicationModel.DataTransfer.DataTransferManagerInterop, Windows.ApplicationModel.DataTransfer, ContentType=WindowsRuntime]",
                "    [void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]",
                "    [void][Windows.Foundation.AsyncStatus, Windows.Foundation, ContentType=WindowsRuntime]",
                "    Write-Output 'STEP3_OK winrt-projections'",
                "    $hwnd = [IntPtr][int64]$HwndStr",
                "    $factory = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal]::GetActivationFactory([Windows.ApplicationModel.DataTransfer.DataTransferManager])",
                "    $pUnk = [System.Runtime.InteropServices.Marshal]::GetIUnknownForObject($factory)",
                "    $interop = [System.Runtime.InteropServices.Marshal]::GetTypedObjectForIUnknown($pUnk, [IDTMInterop])",
                "    [void][System.Runtime.InteropServices.Marshal]::Release($pUnk)",
                "    Write-Output 'STEP4_OK interop-qi'",
                "    $iid = [Guid]'a5caee9b-8708-49d1-8d36-67d25a8da00c'",
                "    $dtm = $interop.GetForWindow($hwnd, $iid)",
                "    Write-Output 'STEP5_OK dtm-for-window'",
                "    $op = [Windows.Storage.StorageFile]::GetFileFromPathAsync($FilePath)",
                "    $deadline = [DateTime]::UtcNow.AddSeconds(6)",
                "    while (($op.Status -eq [Windows.Foundation.AsyncStatus]::Started) -and ([DateTime]::UtcNow -lt $deadline)) { Start-Sleep -Milliseconds 20 }",
                "    if ($op.Status -ne [Windows.Foundation.AsyncStatus]::Completed) { throw ('file-async-' + $op.Status) }",
                "    $script:shareFile = $op.GetResults()",
                "    Write-Output 'STEP6_OK storagefile'",
                // هندلرِ رویداد: PowerShell این scriptblock را خودش به دلیگیتِ TypedEventHandlerِ رویداد",
                // تبدیل می‌کند. از متغیرهای script-scope استفاده می‌شود تا closure روی فایل/عنوان مطمئن باشد.",
                "    $dtm.add_DataRequested({",
                "        param($s, $e)",
                "        try {",
                "            $req = $e.Request",
                "            $req.Data.Properties.Title = $script:shareTitle",
                "            $lst = New-Object 'System.Collections.Generic.List[Windows.Storage.IStorageItem]'",
                "            $lst.Add($script:shareFile)",
                "            $req.Data.SetStorageItems($lst)",
                "        } catch { }",
                "    })",
                "    Write-Output 'STEP7_OK handler'",
                "    $interop.ShowShareUIForWindow($hwnd)",
                "    Write-Output 'SHARE_OK'",
                "    $sw = [System.Diagnostics.Stopwatch]::StartNew()",
                "    while ($sw.Elapsed.TotalSeconds -lt 3.0) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 40 }",
                "} catch {",
                "    Write-Output ('SHARE_ERR: ' + $_.Exception.GetType().Name + ' | ' + $_.Exception.Message)",
                "}"
            ];
            const psPath = path.join(app.getPath('temp'), 'jouya-share-' + Date.now() + '.ps1');
            fs.writeFileSync(psPath, '\uFEFF' + lines.join('\r\n'), 'utf8');

            const { execFile } = require('child_process');
            let settled = false;
            const finish = function (ok, diag) {
                if (settled) return; settled = true;
                try { fs.unlinkSync(psPath); } catch (e) {}
                resolve({ ok: ok, diag: String(diag || '').slice(0, 900) });
            };
            execFile(
                'powershell',
                ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', psPath],
                { windowsHide: true, timeout: 12000 },
                function (err, stdout, stderr) {
                    var out = String(stdout || '');
                    var diag = out.trim()
                        + (stderr ? ('\n[stderr] ' + String(stderr).trim()) : '')
                        + (err ? ('\n[err] ' + (err.message || err)) : '');
                    finish(out.indexOf('SHARE_OK') !== -1, diag);
                }
            );
        } catch (e) { resolve({ ok: false, diag: 'ex:' + (e && e.message ? e.message : String(e)) }); }
    });
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

        // ۲) ذخیرهٔ فایل با نامِ امن در پوشهٔ temp
        let safeName = String(fileName || 'report')
            .replace(/[\\/:*?"<>|]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 90);
        if (!safeName) safeName = 'report';
        if (!/\.pdf$/i.test(safeName)) safeName += '.pdf';
        const outPath = path.join(app.getPath('temp'), safeName);
        fs.writeFileSync(outPath, pdfBuffer);

        // ۳) روشِ درست و «بدونِ کلیپ‌بورد»: پنلِ اشتراکِ ویندوز را با HWNDِ پنجرهٔ برنامه باز
        //    می‌کنیم؛ کاربر واتساپ و سپس مخاطب را انتخاب می‌کند و همین فایلِ PDF پیوست/ارسال می‌شود.
        let sharedViaPanel = false;
        let shareDiag = '';
        try {
            const shareWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
            const sres = await shareFileViaWindowsShareUI(outPath, String(fileName || 'گزارش'), shareWin);
            sharedViaPanel = !!(sres && sres.ok);
            shareDiag = (sres && sres.diag) || '';
        } catch (e) { sharedViaPanel = false; shareDiag = 'call-ex:' + (e && e.message ? e.message : String(e)); }
        if (sharedViaPanel) {
            return { ok: true, method: 'share', clip: false, opened: true, path: outPath };
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

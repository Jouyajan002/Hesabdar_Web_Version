/* =============================================================================
 * drive-backup.js — نسخه نهایی
 * ----------------------------------------------------------------------------
 * تغییرات کلیدی نسبت به نسخه قبلی:
 *  - استفاده از OAuth Desktop (Loopback IP) از طریق main.js — بدون خطای 400
 *  - ذخیره اکانت کاربر در Google Drive (appDataFolder) برای ورود از هر کامپیوتر
 *  - ثبت لیسانس در Drive به‌عنوان «استفاده‌شده»
 *  - فالبک به مرورگر در صورت نبود electronAPI (فقط برای توسعه وب)
 * ============================================================================= */

(function () {
    'use strict';

    const DRIVE_CONFIG = {
        BACKUP_FILENAME: 'jouya-store-backup.json',
        ACCOUNT_FILENAME: 'jouya-account.json',
        LICENSE_REGISTRY: 'jouya-license-registry.json',
        FOLDER: 'appDataFolder',
        TOKEN_KEY: 'jouya_gdrive_token',
        LAST_GD_BACKUP: 'jouya_last_gdrive_backup',
        AUTO_BACKUP_HOURS: 6,
    };

    const isElectron = !!(window.electronAPI && typeof window.electronAPI.googleSignIn === 'function');

    // =========================================================================
    // مدیریت توکن
    // =========================================================================
    const TokenStore = {
        get() {
            try { return JSON.parse(localStorage.getItem(DRIVE_CONFIG.TOKEN_KEY) || 'null'); }
            catch (e) { return null; }
        },
        save(token) {
            const data = { ...token, savedAt: token.savedAt || Date.now() };
            localStorage.setItem(DRIVE_CONFIG.TOKEN_KEY, JSON.stringify(data));
        },
        clear() {
            localStorage.removeItem(DRIVE_CONFIG.TOKEN_KEY);
        },
        isValid() {
            const t = this.get();
            if (!t || !t.access_token) return false;
            const elapsed = (Date.now() - (t.savedAt || 0)) / 1000;
            return elapsed < (t.expires_in || 3600) - 60;
        },
        hasRefresh() {
            const t = this.get();
            return !!(t && t.refresh_token);
        }
    };

    // =========================================================================
    // ورود — از طریق main process (Desktop OAuth) یا fallback مرورگر
    // =========================================================================
    async function googleSignIn() {
        if (isElectron) {
            const result = await window.electronAPI.googleSignIn();
            if (!result.success) {
                throw new Error(result.error || 'ورود ناموفق');
            }
            // ذخیره توکن
            TokenStore.save(result.token);
            // ذخیره ایمیل و نام
            if (result.userInfo && result.userInfo.email) {
                localStorage.setItem('jouya_gdrive_email', result.userInfo.email);
                localStorage.setItem('jouya_gdrive_name', result.userInfo.name || '');
            }
            // رویداد برای اطلاع‌رسانی به بخش‌های دیگر اپ
            window.dispatchEvent(new CustomEvent('gdrive-signed-in', {
                detail: { email: result.userInfo && result.userInfo.email, token: result.token }
            }));
            return result.token;
        }
        throw new Error('این روش فقط در Electron پشتیبانی می‌شود.');
    }

    async function getValidToken() {
        if (TokenStore.isValid()) {
            return TokenStore.get();
        }
        // تلاش برای رفرش
        const token = TokenStore.get();
        if (token && token.refresh_token && isElectron) {
            try {
                const result = await window.electronAPI.googleRefreshToken(token.refresh_token);
                if (result.success) {
                    // refresh_token را حفظ کن
                    result.token.refresh_token = token.refresh_token;
                    TokenStore.save(result.token);
                    return result.token;
                }
            } catch (e) {
                console.warn('رفرش توکن:', e);
            }
        }
        // ورود جدید
        return await googleSignIn();
    }

    // =========================================================================
    // جمع‌آوری همه‌ی داده‌ها
    // ✅ اصلاح‌شده: قبلاً فقط شیء {success, data} را به‌اشتباه ذخیره می‌کرد
    //    و کلیدهای proformas, employees, changelog از قلم می‌افتاد.
    //    اکنون همه کلیدهای localStorage مرتبط با اپ ذخیره می‌شوند.
    // =========================================================================
    
    // لیست کامل کلیدهای localStorage که باید پشتیبان‌گیری شوند
    const APP_KEYS = [
        'persons', 'products', 'transactions', 'expenses', 'cashboxes',
        'employees', 'changelog', 'settings', 'returns', 'proformas',
        'backupHistory', 'dashboardStats',
        'jouya_user_account', 'jouya_license_info'
    ];

    function collectAllData() {
        const backupData = {
            backupVersion: '2.2',
            backupSource: 'google-drive',
            backupDate: new Date().toISOString(),
            appName: 'JouyaStore',
            data: {}
        };

        // ✅ ابتدا تلاش می‌کنیم از db.exportData() داده‌ها را بگیریم
        // اما خروجی آن {success: true, data: {...}} است، نه خود data
        if (window.db && typeof window.db.exportData === 'function') {
            try {
                const exportResult = window.db.exportData();
                // exportResult ممکن است یا {success, data} باشد یا مستقیماً data
                let exported = null;
                if (exportResult && typeof exportResult === 'object') {
                    if (exportResult.success === true && exportResult.data) {
                        exported = exportResult.data; // ✅ ساختار صحیح
                    } else if (!('success' in exportResult)) {
                        exported = exportResult; // ساختار قدیمی
                    }
                }
                if (exported && typeof exported === 'object') {
                    // کپی کلیدهای داده در backupData.data
                    Object.keys(exported).forEach(k => {
                        // فیلدهای metadata (version, exportDate) را skip می‌کنیم
                        if (k === 'version' || k === 'exportDate') return;
                        backupData.data[k] = exported[k];
                    });
                }
            } catch (e) {
                console.warn('db.exportData خطا داد:', e);
            }
        }

        // ✅ دوم: همه کلیدهای localStorage را هم بخوان (تا اگر db.exportData() کلیدی را
        //    از قلم انداخت، از localStorage مستقیم بیاید)
        APP_KEYS.forEach(key => {
            // اگر قبلاً از exportData گرفته شده و مقدار غیر‌خالی است، رد کن
            if (backupData.data[key] !== undefined && backupData.data[key] !== null) {
                return;
            }
            try {
                const val = localStorage.getItem(key);
                if (val !== null) {
                    try { backupData.data[key] = JSON.parse(val); }
                    catch (e) { backupData.data[key] = val; }
                }
            } catch (e) {}
        });

        return backupData;
    }

    // =========================================================================
    // عملیات Drive (آپلود/دانلود/جستجو)
    // =========================================================================
    async function uploadFileToDrive(token, filename, jsonContent) {
        const boundary = '-------314159265358979323846';
        const existingId = await findFileId(token, filename);

        const metadata = { name: filename, mimeType: 'application/json' };
        if (!existingId) {
            metadata.parents = [DRIVE_CONFIG.FOLDER];
        }

        const multipart =
            '--' + boundary + '\r\n' +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) + '\r\n' +
            '--' + boundary + '\r\n' +
            'Content-Type: application/json\r\n\r\n' +
            jsonContent + '\r\n' +
            '--' + boundary + '--';

        const url = existingId
            ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        const method = existingId ? 'PATCH' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': 'Bearer ' + token.access_token,
                'Content-Type': `multipart/related; boundary="${boundary}"`,
            },
            body: multipart,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `خطای آپلود: ${response.status}`);
        }
        return await response.json();
    }

    async function findFileId(token, filename) {
        try {
            const query = encodeURIComponent(`name='${filename}' and trashed=false`);
            const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=${DRIVE_CONFIG.FOLDER}&fields=files(id,name,modifiedTime)`;
            const response = await fetch(url, {
                headers: { 'Authorization': 'Bearer ' + token.access_token }
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data.files && data.files.length > 0 ? data.files[0].id : null;
        } catch (e) {
            return null;
        }
    }

    async function downloadFileFromDrive(token, filename) {
        const fileId = await findFileId(token, filename);
        if (!fileId) return null;

        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            { headers: { 'Authorization': 'Bearer ' + token.access_token } }
        );
        if (!response.ok) return null;
        const text = await response.text();
        try { return JSON.parse(text); } catch (e) { return null; }
    }

    function restoreToLocalStorage(backupData) {
        if (!backupData || !backupData.data) {
            throw new Error('فایل پشتیبان معتبر نیست.');
        }
        let data = backupData.data;

        // ✅ سازگاری با پشتیبان‌های قدیمی که اشتباه ذخیره شده بودند:
        // اگر data شامل {success: true, data: {...}} است، عمیق‌تر برو
        if (data && typeof data === 'object' && data.success === true && data.data) {
            console.log('⚠️ پشتیبان قدیمی با ساختار اشتباه - استخراج عمیق‌تر');
            data = data.data;
        }

        let count = 0;
        Object.keys(data).forEach(key => {
            try {
                // فیلدهای metadata را skip کن
                if (key === 'version' || key === 'exportDate' || key === 'success') return;
                const val = data[key];
                if (val !== null && val !== undefined) {
                    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
                    count++;
                }
            } catch (e) {}
        });
        return count;
    }

    // =========================================================================
    // ذخیره/بازیابی اکانت در Drive — برای ورود از هر دستگاه
    // =========================================================================
    async function saveAccountToDrive(token, accountData) {
        const json = JSON.stringify(accountData, null, 2);
        return await uploadFileToDrive(token, DRIVE_CONFIG.ACCOUNT_FILENAME, json);
    }

    async function loadAccountFromDrive(token) {
        return await downloadFileFromDrive(token, DRIVE_CONFIG.ACCOUNT_FILENAME);
    }

    async function registerLicenseUsage(token, licenseCode, email) {
        // ذخیره ثبت استفاده از لیسانس در Drive
        let registry = await downloadFileFromDrive(token, DRIVE_CONFIG.LICENSE_REGISTRY);
        if (!registry || typeof registry !== 'object') {
            registry = { licenses: {} };
        }
        if (!registry.licenses) registry.licenses = {};
        registry.licenses[licenseCode] = {
            usedBy: email,
            activatedAt: new Date().toISOString(),
            deviceId: getDeviceId()
        };
        const json = JSON.stringify(registry, null, 2);
        await uploadFileToDrive(token, DRIVE_CONFIG.LICENSE_REGISTRY, json);
    }

    function getDeviceId() {
        let id = localStorage.getItem('jouya_device_id');
        if (!id) {
            id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem('jouya_device_id', id);
        }
        return id;
    }

    // در دسترس قرار دادن برای auth-system.js
    window.DriveAccount = {
        saveAccount: saveAccountToDrive,
        loadAccount: loadAccountFromDrive,
        registerLicense: registerLicenseUsage,
        getLicenseRegistry: async function(token) {
            return await downloadFileFromDrive(token, DRIVE_CONFIG.LICENSE_REGISTRY);
        },
        getValidToken: getValidToken,
        getDeviceId: getDeviceId,
        signIn: googleSignIn,
    };

    // =========================================================================
    // بک‌آپ خودکار
    // =========================================================================
    function setupAutoBackup() {
        if (!DRIVE_CONFIG.AUTO_BACKUP_HOURS || DRIVE_CONFIG.AUTO_BACKUP_HOURS <= 0) return;
        const intervalMs = DRIVE_CONFIG.AUTO_BACKUP_HOURS * 60 * 60 * 1000;

        setInterval(async () => {
            const token = TokenStore.get();
            if (!token || !TokenStore.isValid()) return;
            try {
                const data = collectAllData();
                const json = JSON.stringify(data, null, 2);
                await uploadFileToDrive(token, DRIVE_CONFIG.BACKUP_FILENAME, json);
                localStorage.setItem(DRIVE_CONFIG.LAST_GD_BACKUP, new Date().toISOString());
                console.log('✅ پشتیبان خودکار Google Drive انجام شد');
                updateLastBackupDisplay();
            } catch (e) {
                console.warn('پشتیبان خودکار:', e.message);
            }
        }, intervalMs);
    }

    function updateLastBackupDisplay() {
        const el = document.getElementById('dui-last-gdrive-backup');
        if (!el) return;
        const last = localStorage.getItem(DRIVE_CONFIG.LAST_GD_BACKUP);
        el.textContent = last
            ? formatAfghanDateTime(last)
            : 'هنوز پشتیبانی گرفته نشده';
    }

    // =========================================================================
    // ✅ توابع تاریخ افغانستان (هجری شمسی با نام ماه‌های دری)
    // =========================================================================
    // از persian-date-utils.js استفاده می‌کند که گلوبال load می‌شود
    // (gregorianToJalali و dariMonthNames آنجا تعریف شده‌اند)
    
    function _toFaDigit(s) {
        return String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
    }

    // فرمت تاریخ کامل افغانستان: مثل "۱۴ ثور ۱۴۰۵ - ۱۴:۳۲"
    function formatAfghanDateTime(isoOrDate) {
        try {
            const d = (isoOrDate instanceof Date) ? isoOrDate : new Date(isoOrDate);
            if (isNaN(d.getTime())) return '';

            // تبدیل میلادی به شمسی با تابع گلوبال
            if (typeof window.gregorianToJalali !== 'function') {
                // اگر تابع گلوبال در دسترس نیست، fallback به ISO ساده
                return d.toLocaleDateString('en-CA') + ' ' + 
                    String(d.getHours()).padStart(2, '0') + ':' +
                    String(d.getMinutes()).padStart(2, '0');
            }
            const j = window.gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
            const monthNames = window.dariMonthNames || 
                ['حمل','ثور','جوزا','سرطان','اسد','سنبله','میزان','عقرب','قوس','جدی','دلو','حوت'];
            const monthName = monthNames[j[1] - 1] || '';
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return _toFaDigit(j[2]) + ' ' + monthName + ' ' + _toFaDigit(j[0]) + 
                   ' - ' + _toFaDigit(hh) + ':' + _toFaDigit(mm);
        } catch (e) {
            return '';
        }
    }

    // فرمت کوتاه (فقط تاریخ): مثل "۱۴ ثور ۱۴۰۵"
    function formatAfghanDate(isoOrDate) {
        try {
            const d = (isoOrDate instanceof Date) ? isoOrDate : new Date(isoOrDate);
            if (isNaN(d.getTime())) return '';
            if (typeof window.gregorianToJalali !== 'function') {
                return d.toLocaleDateString('en-CA');
            }
            const j = window.gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
            const monthNames = window.dariMonthNames || 
                ['حمل','ثور','جوزا','سرطان','اسد','سنبله','میزان','عقرب','قوس','جدی','دلو','حوت'];
            const monthName = monthNames[j[1] - 1] || '';
            return _toFaDigit(j[2]) + ' ' + monthName + ' ' + _toFaDigit(j[0]);
        } catch (e) {
            return '';
        }
    }

    // در دسترس قرار دادن برای auth-system.js
    // ─────────────────────────────────────────────────────────────────────
    // مهم: assignment به `window.formatAfghanDateTime` و `window.formatAfghanDate`
    // حذف شد چون این توابع تاریخ ISO را به فرمت با نام ماه‌های دری تبدیل می‌کنند
    // و وقتی روی window نشسته بودند، تابع pass-through که در script.js تعریف شده
    // (و در جدول‌ها استفاده می‌شود) را override می‌کردند → نتیجه: "7 دلو 783"
    // در سطون تاریخ جدول‌ها. این تبدیل کاملاً حذف شد. توابع داخلی برای استفاده
    // داخلی این فایل (مودال پشتیبان‌گیری Drive) به‌صورت local باقی می‌مانند.
    // window.formatAfghanDateTime = formatAfghanDateTime; // حذف شد
    // window.formatAfghanDate = formatAfghanDate; // حذف شد

    // =========================================================================
    // مودال Google Drive
    // =========================================================================
    function openDriveModal() {
        const old = document.getElementById('gdrive-modal-overlay');
        if (old) old.remove();

        const isConnected = TokenStore.isValid();
        const lastBackup = localStorage.getItem(DRIVE_CONFIG.LAST_GD_BACKUP);
        const lastBackupStr = lastBackup
            ? formatAfghanDateTime(lastBackup)
            : 'هنوز پشتیبانی گرفته نشده';
        const userEmail = localStorage.getItem('jouya_gdrive_email') || '';

        const modal = document.createElement('div');
        modal.id = 'gdrive-modal-overlay';
        modal.className = 'backup-modal-overlay';
        modal.innerHTML = `
            <div class="backup-modal gdrive-modal">
                <button class="backup-modal-close" onclick="document.getElementById('gdrive-modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>

                <div class="gdrive-modal-icon">
                    <svg width="42" height="42" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                        <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                        <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                        <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                        <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                        <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                        <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                    </svg>
                </div>
                <h2 class="backup-modal-title">Google Drive</h2>
                <p class="backup-modal-desc">
                    ${isConnected
                        ? `<span class="gdrive-connected-badge"><i class="fas fa-check-circle"></i> متصل: ${userEmail}</span>`
                        : 'برای پشتیبان‌گیری ابری، ابتدا وارد حساب Google خود شوید.'
                    }
                </p>

                <div class="gdrive-info-row">
                    <div class="gdrive-info-box">
                        <i class="fas fa-clock"></i>
                        <span class="gdrive-info-label">آخرین پشتیبان</span>
                        <span class="gdrive-info-val" id="gdrive-last-backup-text">${lastBackupStr}</span>
                    </div>
                    <div class="gdrive-info-box">
                        <i class="fas fa-hdd"></i>
                        <span class="gdrive-info-label">ذخیره‌سازی</span>
                        <span class="gdrive-info-val">Google Drive</span>
                    </div>
                </div>

                <div class="backup-progress-wrap" id="gdrive-progress-wrap" style="display:none;">
                    <div class="backup-progress-bar">
                        <div class="backup-progress-fill" id="gdrive-progress-fill" style="width:0%;"></div>
                    </div>
                    <div class="backup-progress-percent" id="gdrive-progress-pct">۰٪</div>
                    <div class="backup-progress-msg" id="gdrive-progress-msg">آماده‌سازی...</div>
                </div>

                <div class="gdrive-action-btns" id="gdrive-action-btns">
                    ${!isConnected ? `
                    <button class="gdrive-btn gdrive-btn-signin" onclick="window.DriveBackup.signIn()">
                        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>
                        ورود با Google
                    </button>
                    ` : `
                    <button class="gdrive-btn gdrive-btn-backup" onclick="window.DriveBackup.backup()">
                        <i class="fas fa-cloud-upload-alt"></i>
                        پشتیبان‌گیری
                    </button>
                    <button class="gdrive-btn gdrive-btn-restore" onclick="window.DriveBackup.restore()">
                        <i class="fas fa-cloud-download-alt"></i>
                        بازیابی
                    </button>
                    <button class="gdrive-btn gdrive-btn-signout" onclick="window.DriveBackup.signOut()">
                        <i class="fas fa-sign-out-alt"></i>
                        خروج از Google
                    </button>
                    `}
                </div>

                <div class="backup-success-box" id="gdrive-result-box" style="display:none;"></div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // =========================================================================
    // window.DriveBackup
    // =========================================================================
    const DriveBackup = {
        openModal() { openDriveModal(); },

        async signIn() {
            try {
                showGDriveProgress(10, 'باز کردن مرورگر برای ورود به Google...');
                showGDriveAlert('success', 'لطفاً در پنجره مرورگر، حساب گوگل خود را انتخاب کنید.');
                const token = await googleSignIn();
                showGDriveProgress(100, 'متصل شد!');
                await sleep(800);
                // بستن مودال قدیمی و باز کردن مجدد با وضعیت متصل
                const oldModal = document.getElementById('gdrive-modal-overlay');
                if (oldModal) oldModal.remove();
                openDriveModal();
                showGDriveAlert('success', '✓ با موفقیت به Google Drive متصل شدید.');
                return token;
            } catch (e) {
                hideGDriveProgress();
                showGDriveAlert('error', e.message || 'خطا در ورود به Google');
                return null;
            }
        },

        async backup() {
            try {
                showGDriveProgress(5, 'دریافت توکن معتبر...');
                const token = await getValidToken();

                showGDriveProgress(20, 'در حال جمع‌آوری اطلاعات...');
                await sleep(200);
                const data = collectAllData();
                const json = JSON.stringify(data, null, 2);
                const sizeKB = (new Blob([json]).size / 1024).toFixed(1);

                showGDriveProgress(50, 'در حال آپلود به Google Drive...');
                await sleep(300);
                await uploadFileToDrive(token, DRIVE_CONFIG.BACKUP_FILENAME, json);

                showGDriveProgress(90, 'ذخیره اطلاعات...');
                localStorage.setItem(DRIVE_CONFIG.LAST_GD_BACKUP, new Date().toISOString());
                updateLastBackupDisplay();

                showGDriveProgress(100, 'پشتیبان‌گیری کامل شد!');
                await sleep(400);

                const resultBox = document.getElementById('gdrive-result-box');
                const progressWrap = document.getElementById('gdrive-progress-wrap');
                const actionBtns = document.getElementById('gdrive-action-btns');
                if (progressWrap) progressWrap.style.display = 'none';
                if (actionBtns) actionBtns.style.display = 'none';
                if (resultBox) {
                    resultBox.style.display = 'block';
                    resultBox.innerHTML = `
                        <i class="fas fa-check-circle" style="font-size:52px;color:#10b981;margin-bottom:12px;"></i>
                        <h3 style="color:#059669;margin:0 0 10px;">پشتیبان‌گیری با موفقیت انجام شد!</h3>
                        <p style="color:#64748b;font-size:13px;line-height:1.8;margin:0 0 18px;">
                            حجم: <strong>${sizeKB} کیلوبایت</strong><br>
                            ذخیره در: <strong>Google Drive</strong>
                        </p>
                        <button class="backup-close-btn" onclick="document.getElementById('gdrive-modal-overlay').remove()" style="width:100%;">بستن</button>
                    `;
                }

                const lastEl = document.getElementById('gdrive-last-backup-text');
                if (lastEl) lastEl.textContent = formatAfghanDateTime(new Date());

            } catch (e) {
                hideGDriveProgress();
                if (e.message && (e.message.includes('401') || e.message.includes('invalid'))) {
                    TokenStore.clear();
                    openDriveModal();
                }
                showGDriveAlert('error', 'خطا در پشتیبان‌گیری: ' + (e.message || 'نامشخص'));
            }
        },

        async restore() {
            if (!confirm('آیا مطمئن هستید؟ داده‌های فعلی با اطلاعات پشتیبان جایگزین می‌شوند.')) return;
            try {
                showGDriveProgress(5, 'دریافت توکن معتبر...');
                const token = await getValidToken();

                showGDriveProgress(30, 'در حال دانلود از Google Drive...');
                const backupData = await downloadFileFromDrive(token, DRIVE_CONFIG.BACKUP_FILENAME);
                if (!backupData) {
                    throw new Error('هیچ فایل پشتیبانی در Google Drive پیدا نشد.');
                }

                showGDriveProgress(70, 'در حال بازیابی اطلاعات...');
                await sleep(300);
                const count = restoreToLocalStorage(backupData);

                showGDriveProgress(100, 'بازیابی کامل شد!');
                await sleep(400);

                const resultBox = document.getElementById('gdrive-result-box');
                const progressWrap = document.getElementById('gdrive-progress-wrap');
                const actionBtns = document.getElementById('gdrive-action-btns');
                if (progressWrap) progressWrap.style.display = 'none';
                if (actionBtns) actionBtns.style.display = 'none';
                if (resultBox) {
                    resultBox.style.display = 'block';
                    resultBox.innerHTML = `
                        <i class="fas fa-check-circle" style="font-size:52px;color:#10b981;margin-bottom:12px;"></i>
                        <h3 style="color:#059669;margin:0 0 10px;">بازیابی با موفقیت انجام شد!</h3>
                        <p style="color:#64748b;font-size:13px;line-height:1.8;margin:0 0 18px;">
                            تاریخ پشتیبان: <strong>${formatAfghanDateTime(backupData.backupDate)}</strong><br>
                            تعداد بخش‌های بازیابی‌شده: <strong>${count}</strong>
                        </p>
                        <button class="backup-close-btn" onclick="location.reload()" style="width:100%;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;border-radius:11px;padding:12px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;">بارگذاری مجدد صفحه</button>
                    `;
                }
            } catch (e) {
                hideGDriveProgress();
                if (e.message && (e.message.includes('401') || e.message.includes('invalid'))) {
                    TokenStore.clear();
                    openDriveModal();
                }
                showGDriveAlert('error', 'خطا در بازیابی: ' + (e.message || 'نامشخص'));
            }
        },

        signOut() {
            TokenStore.clear();
            localStorage.removeItem('jouya_gdrive_email');
            localStorage.removeItem('jouya_gdrive_name');
            openDriveModal();
            showGDriveAlert('success', 'از حساب Google خارج شدید.');
        },

        isConnected() { return TokenStore.isValid(); },
    };

    function showGDriveProgress(pct, msg) {
        const wrap = document.getElementById('gdrive-progress-wrap');
        const fill = document.getElementById('gdrive-progress-fill');
        const pctEl = document.getElementById('gdrive-progress-pct');
        const msgEl = document.getElementById('gdrive-progress-msg');
        if (wrap) wrap.style.display = 'block';
        if (fill) fill.style.width = pct + '%';
        if (pctEl) pctEl.textContent = toFaNum(pct) + '٪';
        if (msgEl) msgEl.textContent = msg;
    }

    function hideGDriveProgress() {
        const wrap = document.getElementById('gdrive-progress-wrap');
        if (wrap) wrap.style.display = 'none';
    }

    function showGDriveAlert(type, msg) {
        if (window.AuthUI && typeof window.AuthUI.showAlert === 'function') {
            window.AuthUI.showAlert(type, msg);
            return;
        }
        alert(msg);
    }

    function toFaNum(n) {
        return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function bootstrap() {
        window.DriveBackup = DriveBackup;
        setupAutoBackup();
        console.log('✅ DriveBackup module loaded (Desktop OAuth)');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }

})();

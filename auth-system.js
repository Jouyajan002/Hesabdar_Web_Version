/* =============================================================================
 * auth-system.js — نسخه نهایی
 * تغییرات کلیدی نسبت به نسخه قبلی:
 *  - فچ لیسانس از GitHub از طریق IPC main.js (دور زدن CORS در فایل .exe)
 *  - بعد از ساخت اکانت → انتقال خودکار به فرم لاگین با فیلدهای پر شده
 *  - ✅ ذخیره دایمی اکانت در GitHub (jouya-auth/users.json) — بدون نیاز به Google
 *  - ✅ ورود از هر کامپیوتر فقط با ایمیل و رمز عبور (بدون OAuth)
 *  - ✅ ثبت لیسانس به‌عنوان «استفاده‌شده» در همان فایل users.json (یکبار مصرف)
 *  - گزینه «بروزرسانی» در سایدبار
 *  - چیدمان بهتر بخش اطلاعات فروشگاه
 *  - منطق logout اصلاح شده — اطلاعات اکانت حفظ می‌شود تا ورود مجدد ممکن باشد
 * ============================================================================= */

(function() {
    'use strict';

    // =========================================================================
    // ۱. تنظیمات
    // =========================================================================
    const AUTH_CONFIG = {
        LICENSE_URL: 'https://raw.githubusercontent.com/Jouyajan002/rep-system/main/licenses.json',
        FALLBACK_CODES: [
            'JOUYA-DEMO-2026-TEST',
            'JOUYA-FREE-TRIAL-001'
        ],
        AUTO_BACKUP_INTERVAL: 3 * 60 * 60 * 1000,
        KEYS: {
            ACCOUNT: 'jouya_user_account',
            LICENSE: 'jouya_license_info',
            LAST_BACKUP: 'jouya_last_email_backup',
            BACKUP_HISTORY: 'jouya_email_backup_history',
            DEVICE_ID: 'jouya_device_id',
            REMEMBER_LOGIN: 'jouya_remember_login',
            SESSION_LOGGED_OUT: 'jouya_session_logged_out'
        }
    };

    // =========================================================================
    // ✅ تنظیمات GitHub Auth (دیتابیس کاربران)
    // ----------------------------------------------------------------------- 
    // قبل از انتشار، یک Personal Access Token در GitHub بسازید با این مشخصات:
    //   - https://github.com/settings/tokens?type=beta  (Fine-grained token)
    //   - Repository access: فقط همین repo (Jouyajan002/jouya-auth)
    //   - Permissions: Contents → Read and write
    // سپس Token را در فیلد TOKEN زیر کپی کنید.
    //
    // ⚠️ مهم: Token را به دو بخش تقسیم کنید (TOKEN_PART_1 + TOKEN_PART_2)
    // تا در فایل اجرایی .exe به‌سادگی با grep پیدا نشود.
    // =========================================================================
    const GH_AUTH = {
        OWNER: 'Jouyajan002',
        REPO: 'jouya-auth',
        BRANCH: 'main',
        FILE_PATH: 'users.json',
        // ⚠️ توکنِ گیت‌هاب حذف شد (خطرِ امنیتی). هویت/لایسنس اکنون از طریقِ Supabase
        // (auth-cloud.js) مدیریت می‌شود. این فیلدها خالی‌اند و دیگر استفاده نمی‌شوند.
        TOKEN_PART_1: '',
        TOKEN_PART_2: ''
    };
    function getGhToken() {
        return GH_AUTH.TOKEN_PART_1 + GH_AUTH.TOKEN_PART_2;
    }
    function ghContentsUrl() {
        return `https://api.github.com/repos/${GH_AUTH.OWNER}/${GH_AUTH.REPO}/contents/${GH_AUTH.FILE_PATH}`;
    }
    function ghRawUrl() {
        return `https://raw.githubusercontent.com/${GH_AUTH.OWNER}/${GH_AUTH.REPO}/${GH_AUTH.BRANCH}/${GH_AUTH.FILE_PATH}`;
    }

    // =========================================================================
    // ✅ تنظیمات EmailJS — برای ارسال کد بازیابی رمز عبور به ایمیل کاربر
    // -------------------------------------------------------------------------
    // ۱) در https://www.emailjs.com یک حساب رایگان بسازید (روزانه ۲۰۰ ایمیل رایگان)
    // ۲) یک Email Service متصل کنید (Gmail/Outlook/...) → Service ID را کپی کنید
    // ۳) یک Email Template بسازید با متغیرهای: {{to_email}}, {{verification_code}}
    //    → Template ID را کپی کنید
    // ۴) از قسمت Account → API Keys → Public Key را کپی کنید
    // ۵) سه مقدار زیر را با مقادیر خودتان جایگزین کنید:
    // =========================================================================
    const EMAILJS_CONFIG = {
        PUBLIC_KEY: 'EcawbfgOrAf01NhIp',
        SERVICE_ID: 'service_a5nd26p',
        TEMPLATE_ID: 'template_7bssixt'
    };
    function isEmailJSConfigured() {
        return EMAILJS_CONFIG.PUBLIC_KEY &&
               EMAILJS_CONFIG.PUBLIC_KEY !== 'YOUR_EMAILJS_PUBLIC_KEY' &&
               EMAILJS_CONFIG.SERVICE_ID &&
               EMAILJS_CONFIG.SERVICE_ID !== 'YOUR_EMAILJS_SERVICE_ID' &&
               EMAILJS_CONFIG.TEMPLATE_ID &&
               EMAILJS_CONFIG.TEMPLATE_ID !== 'YOUR_EMAILJS_TEMPLATE_ID';
    }
    // بارگذاری SDK رسمی EmailJS از CDN (اگر هنوز بارگذاری نشده)
    function loadEmailJSSDK() {
        return new Promise((resolve, reject) => {
            if (window.emailjs && typeof window.emailjs.send === 'function') {
                resolve(window.emailjs);
                return;
            }
            const existing = document.getElementById('emailjs-sdk-script');
            if (existing) {
                existing.addEventListener('load', () => resolve(window.emailjs));
                existing.addEventListener('error', () => reject(new Error('بارگذاری EmailJS SDK ناموفق بود')));
                return;
            }
            const s = document.createElement('script');
            s.id = 'emailjs-sdk-script';
            s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
            s.onload = () => {
                try {
                    if (window.emailjs && typeof window.emailjs.init === 'function') {
                        window.emailjs.init({ publicKey: EMAILJS_CONFIG.PUBLIC_KEY });
                    }
                    resolve(window.emailjs);
                } catch (e) {
                    reject(e);
                }
            };
            s.onerror = () => reject(new Error('بارگذاری EmailJS SDK ناموفق بود — اتصال اینترنت را بررسی کنید.'));
            document.head.appendChild(s);
        });
    }
    async function sendVerificationEmailViaEmailJS(toEmail, code) {
        if (!isEmailJSConfigured()) {
            throw new Error('سیستم ارسال ایمیل تنظیم نشده است. لطفاً با پشتیبانی تماس بگیرید.');
        }
        const ejs = await loadEmailJSSDK();
        if (!ejs || typeof ejs.send !== 'function') {
            throw new Error('EmailJS SDK در دسترس نیست.');
        }
        return await ejs.send(
            EMAILJS_CONFIG.SERVICE_ID,
            EMAILJS_CONFIG.TEMPLATE_ID,
            {
                to_email: toEmail,
                verification_code: code,
                email: toEmail,
                code: code
            },
            { publicKey: EMAILJS_CONFIG.PUBLIC_KEY }
        );
    }
    function generateVerificationCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }
    // وضعیت موقت بازیابی رمز (فقط در حافظه — با خروج از صفحه پاک می‌شود)
    const _forgotState = {
        step: 1,        // 1 = ایمیل، 2 = کد، 3 = رمز جدید
        email: '',
        code: '',
        codeSentAt: 0,
        attempts: 0
    };

    const isElectron = !!(window.electronAPI);

    // =========================================================================
    // ✅ ۱.۵. ماژول GitHubAuthDB — مدیریت کاربران در GitHub Repository
    // ----------------------------------------------------------------------- 
    // این ماژول فایل users.json را در یک repository خصوصی مدیریت می‌کند:
    //   - readUsers()        → خواندن لیست کاربران (همراه با sha فایل)
    //   - findUser(email)    → جستجوی کاربر بر اساس ایمیل
    //   - addUser(user)      → افزودن کاربر جدید + commit به GitHub
    //   - updateUser(email, patch) → بروزرسانی کاربر موجود + commit
    //
    // ساختار فایل users.json در GitHub:
    //   {
    //     "users": [
    //       { "email":"a@b.com", "passwordHash":"...", "fullName":"...",
    //         "storeName":"...", "phone":"...", "address":"...", 
    //         "license":"ABC123", "logo":null, "createdAt":"2026-..." }
    //     ]
    //   }
    // =========================================================================
    const GitHubAuthDB = {
        async _ghFetch(url, options = {}) {
            const headers = {
                'Authorization': 'Bearer ' + getGhToken(),
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                ...(options.headers || {})
            };
            return fetch(url, { ...options, headers });
        },

        // خواندن کل فایل users.json به‌همراه sha (برای آپدیت بعدی)
        // ✅ همیشه از API contents استفاده می‌کنیم (با Authorization Header)
        //    چون repository خصوصی است و raw URL برای آن 404/403 می‌دهد
        // ✅ اگر فایل بزرگتر از 1MB باشد، GitHub `content` خالی برمی‌گرداند
        //    و باید از Git Blobs API استفاده کرد (محدودیت 100MB)
        async readUsers(forUpdate = false) {
            // ✅ از API contents استفاده کن — هم data می‌دهد هم sha تازه
            // (برای repo خصوصی هم کار می‌کند چون Authorization Header می‌فرستد)
            try {
                const r = await this._ghFetch(
                    ghContentsUrl() + '?ref=' + encodeURIComponent(GH_AUTH.BRANCH) + '&t=' + Date.now()
                );
                if (r.status === 404) {
                    // فایل هنوز ساخته نشده
                    return { users: [], sha: null, ok: true, fileMissing: true };
                }
                if (!r.ok) {
                    let errText = 'GitHub API ' + r.status;
                    try {
                        const j = await r.json();
                        if (j && j.message) errText += ' — ' + j.message;
                    } catch (e) {}
                    return { ok: false, error: errText };
                }
                const meta = await r.json();
                const sha = meta.sha || null;
                let content = '';

                // ✅ تشخیص فایل‌های بزرگ (>1MB): GitHub در این حالت content را خالی می‌فرستد
                //    و encoding را "none" قرار می‌دهد — باید از Git Blobs API استفاده کنیم
                const isLargeFile = (meta.encoding === 'none') || (!meta.content && meta.size > 0);

                if (isLargeFile && sha) {
                    // استفاده از Git Blobs API برای فایل‌های بزرگ
                    const blobUrl = `https://api.github.com/repos/${GH_AUTH.OWNER}/${GH_AUTH.REPO}/git/blobs/${sha}`;
                    const blobRes = await this._ghFetch(blobUrl);
                    if (!blobRes.ok) {
                        let errText = 'GitHub Blobs API ' + blobRes.status;
                        try {
                            const j = await blobRes.json();
                            if (j && j.message) errText += ' — ' + j.message;
                        } catch (e) {}
                        return { ok: false, error: errText };
                    }
                    const blob = await blobRes.json();
                    if (blob.encoding === 'base64' && blob.content) {
                        try { content = decodeURIComponent(escape(atob(blob.content.replace(/\n/g, '')))); }
                        catch (e) {
                            try { content = atob(blob.content.replace(/\n/g, '')); }
                            catch (e2) { return { ok: false, error: 'فایل نامعتبر است (blob)' }; }
                        }
                    } else {
                        return { ok: false, error: 'پاسخ Blobs API نامعتبر است' };
                    }
                } else {
                    // فایل کوچک (<1MB) — content مستقیم در پاسخ contents API است
                    try { content = decodeURIComponent(escape(atob((meta.content || '').replace(/\n/g, '')))); }
                    catch (e) {
                        // fallback: بدون UTF-8 decode
                        try { content = atob((meta.content || '').replace(/\n/g, '')); }
                        catch (e2) { return { ok: false, error: 'فایل نامعتبر است' }; }
                    }
                }

                let parsed;
                try { parsed = JSON.parse(content); }
                catch (e) { parsed = { users: [] }; }
                return {
                    users: Array.isArray(parsed.users) ? parsed.users : [],
                    sha: sha,
                    ok: true
                };
            } catch (e) {
                return { ok: false, error: e.message || 'خطای شبکه' };
            }
        },

        // پیدا کردن کاربر بر اساس ایمیل (بدون حساسیت به حروف بزرگ/کوچک)
        async findUser(email) {
            const e = (email || '').trim().toLowerCase();

            // خواندن لیست کاربران از GitHub (با پشتیبانی از فایل‌های بزرگ)
            const res = await this.readUsers();
            if (!res.ok) return { ok: false, error: res.error };
            const user = res.users.find(u => (u.email || '').trim().toLowerCase() === e) || null;

            return { ok: true, user, sha: res.sha, allUsers: res.users };
        },

        // نوشتن کل لیست کاربران در GitHub (با sha برای avoid conflict)
        async _writeUsers(users, sha, commitMsg) {
            const json = JSON.stringify({ users }, null, 2);
            // utf-8 → base64 (پشتیبانی از کاراکترهای فارسی)
            const b64 = btoa(unescape(encodeURIComponent(json)));
            const body = {
                message: commitMsg || ('update users.json — ' + new Date().toISOString()),
                content: b64,
                branch: GH_AUTH.BRANCH
            };
            if (sha) body.sha = sha;

            const r = await this._ghFetch(ghContentsUrl(), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!r.ok) {
                let errText = 'GitHub API ' + r.status;
                try {
                    const j = await r.json();
                    if (j && j.message) errText += ' — ' + j.message;
                } catch (e) {}
                return { ok: false, error: errText };
            }
            const j = await r.json().catch(() => ({}));
            return { ok: true, newSha: j.content && j.content.sha };
        },

        // افزودن کاربر جدید — با retry در صورت conflict (sha قدیمی)
        async addUser(userObj) {
            // مکانیزمِ گیت‌هاب حذف شد؛ هویت با Supabase Auth (auth-cloud.js) مدیریت می‌شود.
            // موفقیتِ محلی برمی‌گردانیم تا ثبت‌نام پیش برود؛ یکتاییِ ایمیل/لایسنس سمتِ سرور
            // (Supabase Auth + جدولِ licenses) کنترل می‌شود.
            return { ok: true, cloud: 'supabase' };
            /* eslint-disable no-unreachable */
            const newEmail = (userObj.email || '').trim().toLowerCase();
            const lic = (userObj.license || '').trim().toUpperCase();
            const cleaned = { ...userObj, email: newEmail };

            // تا ۳ بار تلاش می‌کنیم — هر بار با sha تازه
            for (let attempt = 1; attempt <= 3; attempt++) {
                // ✅ همیشه sha تازه از API contents بگیر
                const res = await this.readUsers(true);
                if (!res.ok) return { ok: false, error: res.error };

                // اگر ایمیل قبلاً وجود دارد، خطا
                if (res.users.some(u => (u.email || '').trim().toLowerCase() === newEmail)) {
                    return { ok: false, error: 'این ایمیل قبلاً ثبت شده است.', alreadyExists: true };
                }
                // اگر لیسانس قبلاً استفاده شده، خطا
                if (lic) {
                    const usedBy = res.users.find(u => (u.license || '').trim().toUpperCase() === lic);
                    if (usedBy) {
                        return {
                            ok: false,
                            error: 'لطفا کد معتبر را وارد کنید.',
                            licenseUsed: true
                        };
                    }
                }

                const newUsers = res.users.concat([cleaned]);
                const w = await this._writeUsers(newUsers, res.sha, 'register: ' + newEmail);
                if (w.ok) return { ok: true };

                // اگر خطای conflict (409 یا 422) بود، یکبار دیگر با sha تازه تلاش کن
                const isConflict = w.error && (w.error.includes('409') || w.error.includes('422') ||
                    w.error.toLowerCase().includes('sha') || w.error.toLowerCase().includes('conflict'));
                if (!isConflict || attempt === 3) {
                    return { ok: false, error: w.error };
                }
                // در غیر این صورت، تلاش بعدی با sha تازه‌تر
                await new Promise(r => setTimeout(r, 500));
            }
            return { ok: false, error: 'خطای ناشناخته در ثبت کاربر' };
        },

        // بروزرسانی کاربر موجود — دیگر روی گیت‌هاب نوشته نمی‌شود (no-op موفق).
        async updateUser(email, patch) {
            return { ok: true };
            /* eslint-disable no-unreachable */
            const e = (email || '').trim().toLowerCase();

            for (let attempt = 1; attempt <= 3; attempt++) {
                const res = await this.readUsers(true);
                if (!res.ok) return { ok: false, error: res.error };
                const idx = res.users.findIndex(u => (u.email || '').trim().toLowerCase() === e);
                if (idx === -1) return { ok: false, error: 'کاربر یافت نشد' };
                res.users[idx] = { ...res.users[idx], ...patch, email: e };
                const w = await this._writeUsers(res.users, res.sha, 'update: ' + e);
                if (w.ok) return { ok: true, user: res.users[idx] };

                const isConflict = w.error && (w.error.includes('409') || w.error.includes('422') ||
                    w.error.toLowerCase().includes('sha') || w.error.toLowerCase().includes('conflict'));
                if (!isConflict || attempt === 3) {
                    return { ok: false, error: w.error };
                }
                await new Promise(r => setTimeout(r, 500));
            }
            return { ok: false, error: 'خطای ناشناخته در بروزرسانی' };
        },

        // بررسی پیکربندی صحیح Token (آیا Token پر شده؟)
        isConfigured() {
            const t = getGhToken();
            return t && !t.includes('PLACEHOLDER');
        }
    };
    window.GitHubAuthDB = GitHubAuthDB;

    // =========================================================================
    // ۲. مدیریت اکانت کاربر
    // =========================================================================
    const AuthDB = {
        getAccount() {
            try { return JSON.parse(localStorage.getItem(AUTH_CONFIG.KEYS.ACCOUNT) || 'null'); }
            catch(e) { return null; }
        },
        saveAccount(acc) {
            localStorage.setItem(AUTH_CONFIG.KEYS.ACCOUNT, JSON.stringify(acc));
        },
        deleteAccount() {
            localStorage.removeItem(AUTH_CONFIG.KEYS.ACCOUNT);
            localStorage.removeItem(AUTH_CONFIG.KEYS.LICENSE);
        },
        // خروج از نشست (logout) — اطلاعات اکانت و لیسانس حفظ می‌شوند
        // تا کاربر بتواند دوباره با همان ایمیل و رمز عبور وارد شود.
        // فقط فلگ «نشست فعال» و رمز ذخیره‌شده در فرم پاک می‌شود.
        logoutSession() {
            localStorage.removeItem(AUTH_CONFIG.KEYS.REMEMBER_LOGIN);
            localStorage.setItem(AUTH_CONFIG.KEYS.SESSION_LOGGED_OUT, '1');
        },
        isLoggedOut() {
            return localStorage.getItem(AUTH_CONFIG.KEYS.SESSION_LOGGED_OUT) === '1';
        },
        clearLogoutFlag() {
            localStorage.removeItem(AUTH_CONFIG.KEYS.SESSION_LOGGED_OUT);
        },
        getLicense() {
            try { return JSON.parse(localStorage.getItem(AUTH_CONFIG.KEYS.LICENSE) || 'null'); }
            catch(e) { return null; }
        },
        saveLicense(lic) {
            localStorage.setItem(AUTH_CONFIG.KEYS.LICENSE, JSON.stringify(lic));
        },
        getRememberedLogin() {
            try { return JSON.parse(localStorage.getItem(AUTH_CONFIG.KEYS.REMEMBER_LOGIN) || 'null'); }
            catch(e) { return null; }
        },
        saveRememberedLogin(email, password) {
            // فقط ایمیل را ذخیره می‌کنیم؛ رمز برای راحتی پر می‌شود ولی hash هم ذخیره می‌گردد
            localStorage.setItem(AUTH_CONFIG.KEYS.REMEMBER_LOGIN, JSON.stringify({ email, password }));
        }
    };
    window.AuthDB = AuthDB;

    // =========================================================================
    // ۳. اعتبارسنجی کد فعال‌سازی
    //    - بررسی محلی (jouya_used_license_codes) برای یکبار مصرف
    //    - فچ از GitHub از طریق IPC (دور زدن CORS)
    //    - بررسی usedBy در GitHub
    // =========================================================================
    async function validateLicenseCode(code) {
        const trimmed = (code || '').trim().toUpperCase();
        if (!trimmed) return { valid: false, error: 'کد فعال‌سازی وارد نشده است.' };

        // ۱. بررسی محلی — آیا این کد روی این دستگاه قبلاً استفاده شده؟
        const usedCodes = JSON.parse(localStorage.getItem('jouya_used_license_codes') || '[]');
        if (usedCodes.includes(trimmed)) {
            return { valid: false, error: 'لطفا کد معتبر را وارد کنید.' };
        }

        // ۲-الف. اعتبارسنجی از طریقِ Supabase (auth-cloud.js) — جای‌گزینِ گیت‌هاب.
        //   اگر پاسخِ قطعی داد (معتبر/نامعتبر)، همان را برمی‌گردانیم. اگر در دسترس نبود
        //   (null)، به مسیرهای بعدی (گیت‌هاب/فالبک) می‌افتد تا چیزی مختل نشود.
        if (window.JouyaAuth && typeof window.JouyaAuth.checkLicense === 'function') {
            try {
                const cloud = await window.JouyaAuth.checkLicense(trimmed);
                if (cloud && cloud.valid === true) {
                    return { valid: true, source: 'supabase', code: trimmed, expires: cloud.expires_at || null };
                }
                if (cloud && cloud.valid === false) {
                    const map = { not_found: 'کد فعال‌سازی معتبر نیست یا اشتباه است.', inactive: 'این کد فعال‌سازی غیرفعال است.', expired: 'این کد فعال‌سازی منقضی شده است.', already_used: 'لطفا کد معتبر را وارد کنید.' };
                    return { valid: false, error: map[cloud.error] || 'کد فعال‌سازی معتبر نیست.' };
                }
            } catch (e) { /* در دسترس نبود → مسیرهای بعدی */ }
        }

        let licenseData = null;

        // ۲. دریافت از GitHub از طریق IPC (در Electron)
        if (isElectron && window.electronAPI && window.electronAPI.httpFetchJson) {
            try {
                const url = AUTH_CONFIG.LICENSE_URL + '?t=' + Date.now();
                const res = await window.electronAPI.httpFetchJson(url);
                if (res.success && res.data) licenseData = res.data;
            } catch (e) { console.warn('IPC license fetch:', e); }
        }

        // ۳. اگر IPC کار نکرد، fetch مستقیم
        if (!licenseData) {
            try {
                const url = AUTH_CONFIG.LICENSE_URL + '?t=' + Date.now();
                const response = await fetch(url, { cache: 'no-store' });
                if (response.ok) licenseData = await response.json();
            } catch (err) { console.warn('Browser license fetch:', err.message); }
        }

        if (licenseData && Array.isArray(licenseData.codes)) {
            const found = licenseData.codes.find(c =>
                (c.code || '').toUpperCase() === trimmed && c.active !== false
            );
            if (!found) {
                return { valid: false, error: 'کد فعال‌سازی معتبر نیست یا اشتباه است.' };
            }
            if (found.expires && new Date(found.expires) < new Date()) {
                return { valid: false, error: 'این کد فعال‌سازی منقضی شده است.' };
            }
            if (found.usedBy && found.usedBy.trim()) {
                return { valid: false, error: 'لطفا کد معتبر را وارد کنید.' };
            }
            return { valid: true, source: 'github', code: trimmed, expires: found.expires || null };
        }

        // فالبک محلی
        if (AUTH_CONFIG.FALLBACK_CODES.map(c => c.toUpperCase()).includes(trimmed)) {
            return { valid: true, source: 'fallback', code: trimmed, expires: null };
        }

        return { valid: false, error: 'کد فعال‌سازی معتبر نیست یا اتصال اینترنت برقرار نیست.' };
    }

    // =========================================================================
    // ۴. بک‌آپ ایمیل (همان منطق قبلی)
    // =========================================================================
    async function performEmailBackup(onProgress) {
        const account = AuthDB.getAccount();
        if (!account || !account.email) {
            return { success: false, error: 'ایمیل کاربر تنظیم نشده است.' };
        }
        const update = (pct, msg) => { if (typeof onProgress === 'function') onProgress(pct, msg); };

        update(5, 'در حال جمع‌آوری اطلاعات...');
        await sleep(200);

        const backupData = {
            backupVersion: '1.0',
            backupDate: new Date().toISOString(),
            account: { email: account.email, fullName: account.fullName, storeName: account.storeName },
            data: {}
        };

        update(20, 'استخراج داده‌های دیتابیس...');
        await sleep(150);
        try {
            if (window.db && typeof window.db.exportData === 'function') {
                backupData.data = window.db.exportData();
            } else {
                const keys = ['persons', 'products', 'transactions', 'expenses', 'cashboxes',
                              'employees', 'changelog', 'settings', 'returns', 'proformas'];
                keys.forEach(k => {
                    try { backupData.data[k] = JSON.parse(localStorage.getItem(k) || 'null'); }
                    catch(e) { backupData.data[k] = null; }
                });
            }
        } catch(e) {
            return { success: false, error: 'خطا در استخراج داده‌ها: ' + e.message };
        }

        update(50, 'فشرده‌سازی فایل پشتیبان...');
        await sleep(200);
        const jsonStr = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const sizeKB = (blob.size / 1024).toFixed(1);

        update(70, 'آماده‌سازی برای ارسال به ایمیل...');
        await sleep(200);

        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const dateStr = new Date().toISOString().split('T')[0];
            a.href = url;
            a.download = `backup-${dateStr}-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch(e) {}

        update(85, 'ارسال به ایمیل ' + account.email + ' ...');
        await sleep(300);

        let emailSent = false;
        try {
            const subject = encodeURIComponent('پشتیبان دیتابیس فروشگاه');
            const body = encodeURIComponent(
                'پشتیبان شما در تاریخ ' + _fmtAfg(new Date()) + ' آماده شد.\n' +
                'حجم فایل: ' + sizeKB + ' KB\n' +
                'فایل ذخیره‌شده در کامپیوتر شما را به این ایمیل پیوست کنید.'
            );
            window.open(`mailto:${account.email}?subject=${subject}&body=${body}`, '_blank');
            emailSent = true;
        } catch(e) {}

        update(95, 'ثبت در تاریخچه...');
        await sleep(150);
        try {
            const history = JSON.parse(localStorage.getItem(AUTH_CONFIG.KEYS.BACKUP_HISTORY) || '[]');
            history.unshift({
                date: new Date().toISOString(),
                size: sizeKB + ' KB',
                email: account.email,
                emailSent: emailSent
            });
            localStorage.setItem(AUTH_CONFIG.KEYS.BACKUP_HISTORY, JSON.stringify(history.slice(0, 20)));
            localStorage.setItem(AUTH_CONFIG.KEYS.LAST_BACKUP, new Date().toISOString());
        } catch(e) {}

        update(100, 'پشتیبان‌گیری با موفقیت تکمیل شد ✓');
        await sleep(400);
        return { success: true, size: sizeKB + ' KB', email: account.email, emailSent: emailSent };
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // =========================================================================
    // ۵. بک‌آپ خودکار
    // =========================================================================
    function setupAutoBackup() {
        const account = AuthDB.getAccount();
        if (!account || !account.email) return;
        const lastBackup = localStorage.getItem(AUTH_CONFIG.KEYS.LAST_BACKUP);
        const now = Date.now();
        const lastTime = lastBackup ? new Date(lastBackup).getTime() : 0;
        if (now - lastTime > AUTH_CONFIG.AUTO_BACKUP_INTERVAL) {
            performEmailBackup(() => {}).catch(e => console.warn('بک‌آپ خودکار:', e));
        }
        setInterval(() => {
            performEmailBackup(() => {}).catch(e => console.warn('بک‌آپ خودکار:', e));
        }, AUTH_CONFIG.AUTO_BACKUP_INTERVAL);
    }

    // =========================================================================
    // ۶. صفحه ساخت اکانت / ورود
    // =========================================================================
    function buildAuthScreen() {
        const remembered = AuthDB.getRememberedLogin();
        const html = `
        <div id="auth-screen-overlay" class="auth-overlay">
            <style>
                .auth-forgot-link {
                    color: #6366f1;
                    font-size: 12.5px;
                    font-weight: 600;
                    cursor: pointer;
                    text-decoration: none;
                    transition: color 0.2s;
                }
                .auth-forgot-link:hover {
                    color: #4f46e5;
                    text-decoration: underline;
                }
                @keyframes authErrShake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-4px); }
                    75% { transform: translateX(4px); }
                }
            </style>
            <div class="auth-card">
                <div class="auth-header">
                    <div class="auth-logo"><i class="fas fa-store-alt"></i></div>
                    <h1 class="auth-title">سیستم مدیریت فروشگاه</h1>
                </div>

                <div class="auth-tabs">
                    <button class="auth-tab active" data-tab="login" type="button">
                        <i class="fas fa-sign-in-alt"></i> ورود
                    </button>
                    <button class="auth-tab" data-tab="register" type="button">
                        <i class="fas fa-user-plus"></i> ساخت اکانت جدید
                    </button>
                </div>

                <div class="auth-form-panel" id="auth-panel-login">
                    <div class="auth-form-group">
                        <label><i class="fas fa-envelope"></i> ایمیل / نام کاربری</label>
                        <input type="text" id="auth-login-email" placeholder="ایمیل خود را وارد کنید" autocomplete="email" value="${remembered ? escapeAttr(remembered.email) : ''}">
                    </div>
                    <div class="auth-form-group">
                        <label><i class="fas fa-lock"></i> رمز عبور</label>
                        <div class="auth-password-wrap">
                            <input type="password" id="auth-login-password" placeholder="رمز عبور" autocomplete="current-password" value="${remembered ? escapeAttr(remembered.password) : ''}">
                            <button type="button" class="auth-eye-btn" onclick="window.AuthUI.togglePassword('auth-login-password')"><i class="fas fa-eye"></i></button>
                        </div>
                    </div>
                    <div style="text-align:left;margin:-4px 0 12px 0;">
                        <a class="auth-forgot-link" onclick="window.AuthUI.openForgotPassword()">
                            <i class="fas fa-key"></i> رمز عبور خود را فراموش کرده‌اید؟
                        </a>
                    </div>
                    <button class="auth-submit-btn" onclick="window.AuthUI.handleLogin()">
                        <i class="fas fa-arrow-left"></i>
                        ورود به حساب کاربری
                    </button>
                    <div style="text-align:center;margin-top:14px;">
                        <small style="color:#64748b;cursor:pointer;" onclick="window.AuthUI.openDriveRestoreFlow()">
                            <i class="fas fa-info-circle"></i> از کامپیوتر دیگری وارد می‌شوید؟
                        </small>
                    </div>
                </div>

                <div class="auth-form-panel" id="auth-panel-register" style="display:none;">
                    <div class="auth-form-row">
                        <div class="auth-form-group">
                            <label><i class="fas fa-user"></i> نام و تخلص *</label>
                            <input type="text" id="auth-reg-fullname" placeholder="نام کامل خود را وارد کنید">
                        </div>
                        <div class="auth-form-group">
                            <label><i class="fas fa-store"></i> نام فروشگاه / شرکت *</label>
                            <input type="text" id="auth-reg-store" placeholder="نام تجاری">
                        </div>
                    </div>

                    <div class="auth-form-row">
                        <div class="auth-form-group">
                            <label><i class="fas fa-phone"></i> شماره تماس</label>
                            <input type="tel" id="auth-reg-phone" placeholder="07xxxxxxxx">
                        </div>
                        <div class="auth-form-group">
                            <label><i class="fas fa-map-marker-alt"></i> آدرس</label>
                            <input type="text" id="auth-reg-address" placeholder="شهر، ولایت">
                        </div>
                    </div>

                    <div class="auth-form-group">
                        <label><i class="fas fa-envelope"></i> ایمیل (برای پشتیبان‌گیری آنلاین) *</label>
                        <input type="email" id="auth-reg-email" placeholder="example@gmail.com" autocomplete="email">
                        <small class="auth-hint">از این ایمیل برای ذخیره خودکار اطلاعات شما استفاده می‌شود.</small>
                    </div>

                    <div class="auth-form-row">
                        <div class="auth-form-group">
                            <label><i class="fas fa-lock"></i> رمز عبور *</label>
                            <div class="auth-password-wrap">
                                <input type="password" id="auth-reg-password" placeholder="حداقل ۶ کاراکتر">
                                <button type="button" class="auth-eye-btn" onclick="window.AuthUI.togglePassword('auth-reg-password')"><i class="fas fa-eye"></i></button>
                            </div>
                        </div>
                        <div class="auth-form-group">
                            <label><i class="fas fa-lock"></i> تکرار رمز عبور *</label>
                            <input type="password" id="auth-reg-password2" placeholder="تکرار رمز">
                        </div>
                    </div>

                    <div class="auth-form-group">
                        <label><i class="fas fa-image"></i> لوگوی فروشگاه (اختیاری)</label>
                        <div class="auth-logo-upload">
                            <input type="file" id="auth-reg-logo" accept="image/*" onchange="window.AuthUI.previewLogo(event)" style="display:none;">
                            <button type="button" class="auth-logo-btn" onclick="document.getElementById('auth-reg-logo').click()">
                                <i class="fas fa-upload"></i> انتخاب لوگو
                            </button>
                            <div class="auth-logo-preview" id="auth-logo-preview">
                                <i class="fas fa-image" style="opacity:0.3;"></i>
                            </div>
                        </div>
                    </div>

                    <div class="auth-form-group auth-license-group">
                        <label><i class="fas fa-key"></i> کد فعال‌سازی *</label>
                        <input type="text" id="auth-reg-license" placeholder="JOUYA-XXXX-XXXX-XXXX" style="font-family:monospace;letter-spacing:1px;text-transform:uppercase;">
                        <small class="auth-hint">کد فعال‌سازی را از فروشنده دریافت کرده و اینجا وارد کنید.</small>
                    </div>

                    <button class="auth-submit-btn" onclick="window.AuthUI.handleRegister()">
                        <i class="fas fa-check-circle"></i>
                        ساخت اکانت و فعال‌سازی
                    </button>
                </div>

                <div class="auth-form-panel" id="auth-panel-forgot" style="display:none;">
                    <div style="text-align:center;margin-bottom:18px;">
                        <div style="width:58px;height:58px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
                            <i class="fas fa-key" style="font-size:24px;color:#d97706;"></i>
                        </div>
                        <h3 style="margin:0 0 6px;color:#1e293b;font-size:16px;font-weight:700;">بازیابی رمز عبور</h3>
                        <p id="auth-forgot-subtitle" style="margin:0;color:#64748b;font-size:12px;line-height:1.8;">
                            ایمیل اکانت خود را وارد کنید تا کد تأیید برای شما ارسال شود.
                        </p>
                    </div>

                    <!-- مرحله ۱: ایمیل -->
                    <div id="auth-forgot-step1">
                        <div class="auth-form-group">
                            <label><i class="fas fa-envelope"></i> ایمیل اکانت</label>
                            <input type="email" id="auth-forgot-email" placeholder="example@gmail.com" autocomplete="email" style="direction:ltr;text-align:left;">
                        </div>
                        <button class="auth-submit-btn" onclick="window.AuthUI.handleForgotSendCode()">
                            <i class="fas fa-paper-plane"></i>
                            ارسال کد تأیید به ایمیل
                        </button>
                    </div>

                    <!-- مرحله ۲: کد تأیید -->
                    <div id="auth-forgot-step2" style="display:none;">
                        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:11px 14px;margin-bottom:14px;display:flex;align-items:flex-start;gap:9px;">
                            <i class="fas fa-info-circle" style="color:#3b82f6;font-size:14px;margin-top:2px;flex-shrink:0;"></i>
                            <div style="font-size:11.5px;color:#1e40af;line-height:1.7;">
                                کد ۶ رقمی به ایمیل <strong id="auth-forgot-email-display"></strong> ارسال شد.
                                لطفاً صندوق ورودی و پوشه اسپم را بررسی کنید.
                            </div>
                        </div>
                        <div class="auth-form-group">
                            <label><i class="fas fa-shield-alt"></i> کد ۶ رقمی تأیید</label>
                            <input type="text" id="auth-forgot-code" placeholder="123456" maxlength="6" inputmode="numeric" autocomplete="one-time-code" style="direction:ltr;text-align:center;letter-spacing:8px;font-family:monospace;font-size:20px;font-weight:700;">
                        </div>
                        <button class="auth-submit-btn" onclick="window.AuthUI.handleForgotVerifyCode()">
                            <i class="fas fa-check-circle"></i>
                            تأیید کد
                        </button>
                        <div style="text-align:center;margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                            <small style="color:#64748b;cursor:pointer;font-size:11.5px;" onclick="window.AuthUI.handleForgotSendCode(true)">
                                <i class="fas fa-redo"></i> ارسال مجدد کد
                            </small>
                            <small style="color:#64748b;cursor:pointer;font-size:11.5px;" onclick="window.AuthUI.handleForgotChangeEmail()">
                                <i class="fas fa-arrow-right"></i> تغییر ایمیل
                            </small>
                        </div>
                    </div>

                    <!-- مرحله ۳: رمز جدید -->
                    <div id="auth-forgot-step3" style="display:none;">
                        <div class="auth-form-group">
                            <label><i class="fas fa-lock"></i> رمز عبور جدید</label>
                            <div class="auth-password-wrap">
                                <input type="password" id="auth-forgot-newpwd" placeholder="حداقل ۶ کاراکتر" autocomplete="new-password">
                                <button type="button" class="auth-eye-btn" onclick="window.AuthUI.togglePassword('auth-forgot-newpwd')"><i class="fas fa-eye"></i></button>
                            </div>
                        </div>
                        <div class="auth-form-group">
                            <label><i class="fas fa-lock"></i> تکرار رمز عبور جدید</label>
                            <div class="auth-password-wrap">
                                <input type="password" id="auth-forgot-newpwd2" placeholder="تکرار رمز جدید" autocomplete="new-password">
                                <button type="button" class="auth-eye-btn" onclick="window.AuthUI.togglePassword('auth-forgot-newpwd2')"><i class="fas fa-eye"></i></button>
                            </div>
                        </div>
                        <button class="auth-submit-btn" onclick="window.AuthUI.handleForgotResetPassword()">
                            <i class="fas fa-save"></i>
                            تنظیم رمز جدید و ورود
                        </button>
                    </div>

                    <div style="text-align:center;margin-top:14px;">
                        <small style="color:#64748b;cursor:pointer;font-size:12px;" onclick="window.AuthUI.closeForgotPanel()">
                            <i class="fas fa-arrow-right"></i> بازگشت به فرم ورود
                        </small>
                    </div>
                </div>

                <div class="auth-footer">
                    <p>© ۲۰۲۶ سیستم مدیریت فروشگاه — نسخه حرفه‌ای</p>
                </div>
            </div>

            <div id="auth-loading" class="auth-loading-overlay" style="display:none;">
                <div class="auth-loading-box">
                    <div class="auth-spinner"></div>
                    <p id="auth-loading-text">در حال بررسی کد فعال‌سازی...</p>
                </div>
            </div>
        </div>`;

        const div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);

        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                AuthUI.switchTab(tab.dataset.tab);
            });
        });

        // پاک کردن خطای فیلد هنگام شروع تایپ
        div.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('input', function() {
                this.style.borderColor = '';
                this.style.background = '';
                const parent = this.parentElement;
                const wrap = (parent && parent.classList.contains('auth-password-wrap')) ? parent : this;
                const nextErr = wrap.nextElementSibling;
                if (nextErr && nextErr.classList.contains('auth-field-error-inline')) {
                    nextErr.remove();
                }
                // هم بعد از input و هم بعد از wrap بررسی کن
                const directNext = this.nextElementSibling;
                if (directNext && directNext.classList.contains('auth-field-error-inline')) {
                    directNext.remove();
                }
            });
        });
    }

    function escapeAttr(s) {
        return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    // =========================================================================
    // ۷. UI Handlers
    // =========================================================================
    const AuthUI = {
        _logoData: null,
        // ✅ slot موقت برای اطلاعات کاربر تازه ثبت‌شده (در همان session)
        // این به ما اجازه می‌دهد بدون اتکا به cache GitHub، اولین لاگین را
        // به‌سرعت و قطعی انجام دهیم.
        _justRegistered: null,

        switchTab(tabName) {
            document.querySelectorAll('.auth-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === tabName);
            });
            const card = document.querySelector('.auth-card');
            const forgotPanel = document.getElementById('auth-panel-forgot');
            if (forgotPanel) forgotPanel.style.display = 'none';
            if (tabName === 'register') {
                document.getElementById('auth-panel-login').style.display = 'none';
                document.getElementById('auth-panel-register').style.display = 'block';
                if (card) card.classList.add('auth-card-landscape');
            } else {
                document.getElementById('auth-panel-login').style.display = 'block';
                document.getElementById('auth-panel-register').style.display = 'none';
                if (card) card.classList.remove('auth-card-landscape');
            }
        },

        togglePassword(id) {
            const inp = document.getElementById(id);
            if (!inp) return;
            inp.type = inp.type === 'password' ? 'text' : 'password';
        },

        previewLogo(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                AuthUI._logoData = ev.target.result;
                const preview = document.getElementById('auth-logo-preview');
                if (preview) preview.innerHTML = `<img src="${ev.target.result}" alt="logo">`;
            };
            reader.readAsDataURL(file);
        },

        showLoading(text) {
            const ov = document.getElementById('auth-loading');
            const tx = document.getElementById('auth-loading-text');
            if (ov) ov.style.display = 'flex';
            if (tx) tx.textContent = text || 'لطفاً صبر کنید...';
        },

        hideLoading() {
            const ov = document.getElementById('auth-loading');
            if (ov) ov.style.display = 'none';
        },

        showAlert(type, msg) {
            const existing = document.getElementById('auth-alert-toast');
            if (existing) existing.remove();
            const colors = {
                error: { bg: '#fee2e2', color: '#991b1b', icon: 'fa-exclamation-circle' },
                success: { bg: '#d1fae5', color: '#065f46', icon: 'fa-check-circle' },
                warning: { bg: '#fef3c7', color: '#92400e', icon: 'fa-exclamation-triangle' }
            };
            const c = colors[type] || colors.error;
            const toast = document.createElement('div');
            toast.id = 'auth-alert-toast';
            toast.style.cssText = `position:fixed;top:24px;left:50%;transform:translateX(-50%);background:${c.bg};color:${c.color};padding:14px 22px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,0.15);z-index:99999;font-size:14px;font-weight:600;display:flex;align-items:center;gap:10px;font-family:'Vazirmatn',sans-serif;direction:rtl;`;
            toast.innerHTML = `<i class="fas ${c.icon}" style="font-size:18px;"></i><span>${msg}</span>`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4500);
        },

        async handleLogin() {
            const email = (document.getElementById('auth-login-email').value || '').trim().toLowerCase();
            const password = (document.getElementById('auth-login-password').value || '').trim();

            // پاک کردن خطاهای قبلی
            document.querySelectorAll('.auth-field-error-inline').forEach(el => el.remove());
            document.querySelectorAll('#auth-panel-login input').forEach(inp => {
                inp.style.borderColor = '';
                inp.style.background = '';
            });

            const showFieldErr = (id, msg) => {
                const inp = document.getElementById(id);
                if (!inp) return;
                inp.style.borderColor = '#dc2626';
                inp.style.background = '#fef2f2';
                // اگر داخل wrap باشد، بعد از wrap نمایش بده
                const parent = inp.parentElement;
                const insertAfter = (parent && parent.classList.contains('auth-password-wrap')) ? parent : inp;
                const err = document.createElement('div');
                err.className = 'auth-field-error-inline';
                err.style.cssText = 'display:flex;align-items:center;gap:5px;color:#dc2626;font-size:11.5px;font-weight:600;margin-top:5px;line-height:1.6;animation:authErrShake 0.35s;';
                err.innerHTML = '<i class="fas fa-exclamation-circle" style="font-size:12px;flex-shrink:0;"></i><span>' + msg + '</span>';
                insertAfter.parentNode.insertBefore(err, insertAfter.nextSibling);
            };

            let hasError = false;
            if (!email) { showFieldErr('auth-login-email', 'لطفاً ایمیل خود را وارد کنید.'); hasError = true; }
            else if (!email.includes('@')) { showFieldErr('auth-login-email', 'فرمت ایمیل نامعتبر است.'); hasError = true; }
            if (!password) { showFieldErr('auth-login-password', 'لطفاً رمز عبور را وارد کنید.'); hasError = true; }
            if (hasError) return;

            const hashedInput = simpleHash(password);
            let account = AuthDB.getAccount();
            let license = AuthDB.getLicense();

            // ✅ سناریوی ۱: اکانت محلی موجود است و ایمیل + رمز عبور با آن مطابقت دارد
            //   → ورود سریع و آفلاین (بدون نیاز به GitHub)
            if (account &&
                (account.email || '').toLowerCase() === email &&
                account.passwordHash === hashedInput) {

                if (!license || !license.code) {
                    // اطلاعات لیسانس محلی نیست — تلاش بازیابی از GitHub
                    // (در ادامه به مسیر GitHub می‌افتد)
                } else {
                    AuthDB.saveRememberedLogin(email, password);
                    AuthDB.clearLogoutFlag();
                    // ✅ اتصال/سینکِ ابری — غیرمسدودکننده
                    try { if (window.JouyaAuth) window.JouyaAuth.onLoginSuccess(email, password, license && license.code); } catch (e) {}
                    AuthUI.showAlert('success', 'ورود با موفقیت انجام شد. خوش آمدید ' + (account.fullName || '') + '!');
                    setTimeout(() => closeAuthAndStart(), 800);
                    return;
                }
            }

            // ✅ سناریوی ۲: اکانت محلی نیست، یا ایمیل/رمز با اکانت محلی مطابقت ندارد
            //   (مثلاً کاربر اکانت دیگری ساخته بود و حالا می‌خواهد با اکانت اول وارد شود،
            //    یا کاربر در دستگاه جدیدی است، یا در همین دستگاه اکانت چندگانه دارد)
            //   → از GitHub چک کن آیا این ایمیل ثبت شده و رمز درست است؟

            // ✅ مسیر سریع: اگر کاربر همین الان (در همین session) اکانت ساخته،
            // اطلاعاتش در حافظه موجود است → از GitHub چیزی نخوان (دور زدن cache).
            if (AuthUI._justRegistered &&
                AuthUI._justRegistered.email === email &&
                AuthUI._justRegistered.passwordHash === hashedInput) {

                AuthUI.showLoading('در حال ورود...');
                const jr = AuthUI._justRegistered;
                account = {
                    fullName: jr.fullName || '',
                    storeName: jr.storeName || '',
                    phone: jr.phone || '',
                    address: jr.address || '',
                    email: jr.email,
                    passwordHash: jr.passwordHash,
                    logo: jr.logo || null,
                    createdAt: jr.createdAt || new Date().toISOString()
                };
                license = {
                    code: jr.license || '',
                    source: jr.source || 'github-auth',
                    activatedAt: jr.activatedAt || jr.createdAt || new Date().toISOString(),
                    expires: jr.expires || null
                };
                AuthDB.saveAccount(account);
                AuthDB.saveLicense(license);

                // ذخیره در تنظیمات (برای داشبورد)
                try {
                    if (window.db && typeof window.db.getSettings === 'function') {
                        const s = window.db.getSettings() || {};
                        s.storeName = account.storeName; s.storeOwner = account.fullName;
                        s.storePhone = account.phone; s.storeAddress = account.address;
                        s.storeEmail = account.email;
                        if (account.logo) s.storeLogo = account.logo;
                        window.db.saveSettings(s);
                    }
                } catch (e) {}

                AuthDB.saveRememberedLogin(email, password);
                AuthDB.clearLogoutFlag();
                // پاک کردن slot موقت چون دیگر نیازی نیست
                AuthUI._justRegistered = null;
                // ✅ اتصال/سینکِ ابری — غیرمسدودکننده
                try { if (window.JouyaAuth) window.JouyaAuth.onLoginSuccess(email, password, license && license.code); } catch (e) {}

                AuthUI.hideLoading();
                AuthUI.showAlert('success', 'ورود با موفقیت انجام شد. خوش آمدید ' + (account.fullName || '') + '!');
                setTimeout(() => closeAuthAndStart(), 800);
                return;
            }

            // ✅ مسیرِ گیت‌هابِ قدیمی حذف شد (توکن باطل). به‌جایش: ورودِ مستقیم به
            // Supabase از طریقِ auth-cloud.js — برای کاربرانی که localStorageِ این
            // دستگاه خالی است (دستگاهِ جدید، یا کاربرِ قدیمیِ گیت‌هابی که یک‌بار قبلاً
            // مسیرِ ابری برایش کامل شده و اکنون فقط باید دوباره وارد شود).
            if (!window.JouyaAuth || typeof window.JouyaAuth.login !== 'function') {
                AuthUI.showAlert('warning', 'هیچ اکانتی روی این دستگاه ساخته نشده. لطفاً ابتدا ثبت‌نام کنید.');
                return;
            }

            AuthUI.showLoading('در حال جستجوی اکانت در سرور ابری...');
            const cloudFind = await window.JouyaAuth.login(email, password);
            AuthUI.hideLoading();

            if (!cloudFind.ok) {
                if (cloudFind.reason === 'network') {
                    showFieldErr('auth-login-email', 'خطا در اتصال به سرور. لطفاً اتصال اینترنت خود را بررسی کنید.');
                } else if (cloudFind.reason === 'invalid-credentials') {
                    showFieldErr('auth-login-password', 'ایمیل یا رمز عبور اشتباه است، یا این اکانت هنوز به سیستمِ ابری منتقل نشده. برای بازیابیِ اکانتِ قدیمی با کدِ لایسنس، با پشتیبانی تماس بگیرید.');
                } else {
                    AuthUI.showAlert('warning', 'هیچ اکانتی روی این دستگاه ساخته نشده. لطفاً ابتدا ثبت‌نام کنید.');
                }
                return;
            }

            // ✅ اطلاعات کاربر از Supabase/ابر آمد → بازیابی به این دستگاه
            AuthUI.showLoading('در حال بازیابی اکانت...');
            account = {
                fullName: cloudFind.account.fullName || '',
                storeName: cloudFind.account.storeName || '',
                phone: cloudFind.account.phone || '',
                address: cloudFind.account.address || '',
                email: cloudFind.account.email,
                passwordHash: hashedInput,
                logo: cloudFind.account.logo || null,
                createdAt: cloudFind.account.createdAt || new Date().toISOString()
            };
            license = {
                code: (cloudFind.license && cloudFind.license.code) || '',
                source: 'supabase-auth',
                activatedAt: (cloudFind.license && cloudFind.license.activatedAt) || new Date().toISOString(),
                expires: (cloudFind.license && cloudFind.license.expires) || null
            };
            AuthDB.saveAccount(account);
            AuthDB.saveLicense(license);

            // ذخیره در تنظیمات (برای داشبورد) — احتیاطی؛ چون login() از قبل از
            // طریقِ pull این‌ها را در window.db نوشته، اینجا فقط هم‌گام‌سازیِ نهایی است.
            try {
                if (window.db && typeof window.db.getSettings === 'function') {
                    const s = window.db.getSettings() || {};
                    s.storeName = account.storeName; s.storeOwner = account.fullName;
                    s.storePhone = account.phone; s.storeAddress = account.address;
                    s.storeEmail = account.email;
                    if (account.logo) s.storeLogo = account.logo;
                    window.db.saveSettings(s);
                }
            } catch (e) {}

            AuthDB.saveRememberedLogin(email, password);
            AuthDB.clearLogoutFlag();

            AuthUI.hideLoading();
            AuthUI.showAlert('success', '✓ اکانت بازیابی شد. خوش آمدید ' + (account.fullName || '') + '!');
            setTimeout(() => closeAuthAndStart(), 1000);
        },

        async handleRegister() {
            const fullName = (document.getElementById('auth-reg-fullname').value || '').trim();
            const storeName = (document.getElementById('auth-reg-store').value || '').trim();
            const phone = (document.getElementById('auth-reg-phone').value || '').trim();
            const address = (document.getElementById('auth-reg-address').value || '').trim();
            const email = (document.getElementById('auth-reg-email').value || '').trim().toLowerCase();
            const password = (document.getElementById('auth-reg-password').value || '').trim();
            const password2 = (document.getElementById('auth-reg-password2').value || '').trim();
            const license = (document.getElementById('auth-reg-license').value || '').trim().toUpperCase();

            // پاک کردن خطاهای قبلی
            document.querySelectorAll('.auth-field-error-inline').forEach(el => el.remove());
            document.querySelectorAll('#auth-panel-register input').forEach(inp => {
                inp.style.borderColor = '';
                inp.style.background = '';
            });

            const showRegFieldErr = (id, msg) => {
                const inp = document.getElementById(id);
                if (!inp) return;
                inp.style.borderColor = '#dc2626';
                inp.style.background = '#fef2f2';
                const parent = inp.parentElement;
                const insertAfter = (parent && parent.classList.contains('auth-password-wrap')) ? parent : inp;
                const err = document.createElement('div');
                err.className = 'auth-field-error-inline';
                err.style.cssText = 'display:flex;align-items:center;gap:5px;color:#dc2626;font-size:11.5px;font-weight:600;margin-top:5px;line-height:1.6;animation:authErrShake 0.35s;';
                err.innerHTML = '<i class="fas fa-exclamation-circle" style="font-size:12px;flex-shrink:0;"></i><span>' + msg + '</span>';
                insertAfter.parentNode.insertBefore(err, insertAfter.nextSibling);
                // اولین خطا را فوکوس بده
                if (!document.querySelector('.auth-field-error-inline ~ .auth-field-error-inline')) {
                    try { inp.focus(); } catch(e) {}
                }
            };

            let regHasError = false;
            if (!fullName) { showRegFieldErr('auth-reg-fullname', 'نام و تخلص اجباری است.'); regHasError = true; }
            if (!storeName) { showRegFieldErr('auth-reg-store', 'نام فروشگاه اجباری است.'); regHasError = true; }
            if (!email) { showRegFieldErr('auth-reg-email', 'ایمیل اجباری است.'); regHasError = true; }
            else if (!email.includes('@') || !email.includes('.')) { showRegFieldErr('auth-reg-email', 'فرمت ایمیل نامعتبر است. مثال: example@gmail.com'); regHasError = true; }
            if (!password) { showRegFieldErr('auth-reg-password', 'رمز عبور اجباری است.'); regHasError = true; }
            else if (password.length < 6) { showRegFieldErr('auth-reg-password', 'رمز عبور باید حداقل ۶ کاراکتر باشد.'); regHasError = true; }
            if (!password2) { showRegFieldErr('auth-reg-password2', 'تکرار رمز عبور اجباری است.'); regHasError = true; }
            else if (password && password !== password2) { showRegFieldErr('auth-reg-password2', 'تکرار رمز عبور با رمز عبور مطابقت ندارد.'); regHasError = true; }
            if (!license) { showRegFieldErr('auth-reg-license', 'کد فعال‌سازی اجباری است.'); regHasError = true; }
            if (regHasError) return;

            // بررسی اکانت موجود محلی
// بررسی اکانت موجود محلی
            const existingAccount = AuthDB.getAccount();
            if (existingAccount) {
                if ((existingAccount.email || '').toLowerCase() === email) {
                    AuthUI.showAlert('error', 'این ایمیل قبلاً یک اکانت ساخته است. برای ورود از تب «ورود» استفاده کنید.');
                    setTimeout(() => AuthUI.switchTab('login'), 1500);
                    return;
                }
                // اکانت محلی موجود حفظ می‌شود — کاربر جدید فقط در GitHub ثبت می‌شود
            }

            // ✅ مرحله ۱: اعتبارسنجی کد در GitHub (licenses.json)
            AuthUI.showLoading('در حال بررسی کد فعال‌سازی از سرور...');
            const result = await validateLicenseCode(license);

            if (!result.valid) {
                AuthUI.hideLoading();
                showRegFieldErr('auth-reg-license', result.error || 'کد فعال‌سازی معتبر نیست یا اشتباه است.');
                AuthUI.showAlert('error', result.error || 'کد فعال‌سازی معتبر نیست یا اشتباه است.');
                return;
            }

            // ✅ مرحله ۲ (اصلاح‌شده فاز ۴): بررسی تکراری‌بودنِ ایمیل/لیسانس روی GitHub حذف شد
            //   — این ریپو خصوصی است و بدونِ توکن (که عمداً حذف شده) همیشه ۴۰۱ می‌داد و
            //   ثبت‌نام را قطع می‌کرد. یکتاییِ ایمیل/لیسانس اکنون سمتِ Supabase
            //   (RPC چک‌لایسنس + جدولِ licenses/کاربران) کنترل می‌شود.
            const emailLow = email;
            const licUp = result.code;

            // ✅ مرحله ۳: ثبت کاربر (GitHub دیگر درگیر نیست — addUser یک no-op امن است)
            const passwordHash = simpleHash(password);
            const remoteUser = {
                email: emailLow,
                passwordHash,
                fullName,
                storeName,
                phone,
                address,
                logo: AuthUI._logoData || null,
                license: licUp,
                source: result.source,
                expires: result.expires || null,
                activatedAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            };

            AuthUI.showLoading('در حال ثبت اکانت در سرور...');
            const addRes = await GitHubAuthDB.addUser(remoteUser);
            if (!addRes.ok) {
                AuthUI.hideLoading();
                // ✅ اگر addUser پیام licenseUsed یا alreadyExists برگرداند، پیام مناسب نمایش بده
                if (addRes.licenseUsed) {
                    showRegFieldErr('auth-reg-license', 'لطفا کد معتبر را وارد کنید.');
                    AuthUI.showAlert('error', 'لطفا کد معتبر را وارد کنید.');
                    return;
                }
                if (addRes.alreadyExists) {
                    AuthUI.showAlert('error', 'این ایمیل قبلاً ثبت شده است. لطفاً وارد شوید یا از ایمیل دیگری استفاده کنید.');
                    setTimeout(() => AuthUI.switchTab('login'), 1500);
                    return;
                }
                AuthUI.showAlert('error', 'خطا در ثبت‌نام: ' + (addRes.error || 'نامشخص') + '. لطفاً دوباره تلاش کنید.');
                return;
            }
            AuthUI.hideLoading();

            // ✅ مرحله ۴: ساخت اکانت محلی — فقط اگر قبلاً اکانتی روی این دستگاه نبود
            if (!existingAccount) {
                // ✅ راه حل قطعی برای مشکل لاگین:
                // ۱) اکانت محلی را همین الان ذخیره می‌کنیم (تا سناریوی ۱ در handleLogin
                //    که یک مقایسه ساده در حافظه است، قطعاً کار کند).
                // ۲) license را هم ذخیره می‌کنیم.
                // ۳) سپس کاربر را به فرم لاگین هدایت می‌کنیم با فیلدهای پر.
                // ۴) وقتی کاربر دکمه «ورود» می‌زند، handleLogin سناریوی ۱ را اجرا می‌کند:
                //    اکانت محلی موجود است → فقط ایمیل و رمز چک می‌شود → closeAuthAndStart()

                const localAccount = {
                    fullName,
                    storeName,
                    phone,
                    address,
                    email: emailLow,
                    passwordHash,
                    logo: AuthUI._logoData || null,
                    createdAt: remoteUser.createdAt
                };
                const localLicense = {
                    code: result.code,
                    source: result.source,
                    activatedAt: remoteUser.activatedAt,
                    expires: result.expires || null
                };
                AuthDB.saveAccount(localAccount);
                AuthDB.saveLicense(localLicense);

                // پاک کردن فلگ logout — مهم برای اینکه bootstrap بعدی کاربر را وارد داشبورد کند
                AuthDB.clearLogoutFlag();

                // ذخیره در تنظیمات (برای داشبورد)
                try {
                    if (window.db && typeof window.db.getSettings === 'function') {
                        const s = window.db.getSettings() || {};
                        s.storeName = storeName; s.storeOwner = fullName;
                        s.storePhone = phone; s.storeAddress = address;
                        s.storeEmail = emailLow;
                        if (AuthUI._logoData) s.storeLogo = AuthUI._logoData;
                        window.db.saveSettings(s);
                    }
                } catch(e) {}

                // ذخیره کد به‌عنوان «استفاده‌شده» در localStorage محلی (دفاع لایه‌ای)
                const usedCodes = JSON.parse(localStorage.getItem('jouya_used_license_codes') || '[]');
                if (!usedCodes.includes(result.code)) {
                    usedCodes.push(result.code);
                    localStorage.setItem('jouya_used_license_codes', JSON.stringify(usedCodes));
                }

                // ذخیره ایمیل و پسورد برای فرم لاگین (پر شدن خودکار فیلدها در رفرش بعدی)
                AuthDB.saveRememberedLogin(emailLow, password);

                // ✅ فعال‌سازیِ ابری (Supabase) — غیرمسدودکننده. اگر ابر خطا کند، فعال‌سازیِ محلی
                //    دست‌نخورده است و کاربر مختل نمی‌شود.
                try { if (window.JouyaAuth) window.JouyaAuth.onRegisterSuccess(emailLow, password, result.code); } catch (e) {}

                AuthUI.showAlert('success', '✓ اکانت با موفقیت ساخته و فعال‌سازی شد! اکنون وارد شوید.');

                // انتقال به فرم لاگین با فیلدهای پر شده + ورود اتوماتیک
                const _regEmail = emailLow;
                const _regPass = password;
                setTimeout(() => {
                    AuthUI.switchTab('login');
                    setTimeout(() => {
                        const emailField = document.getElementById('auth-login-email');
                        const passField = document.getElementById('auth-login-password');
                        if (emailField) {
                            emailField.value = _regEmail;
                            emailField.style.borderColor = '';
                            emailField.style.background = '';
                        }
                        if (passField) {
                            passField.value = _regPass;
                            passField.style.borderColor = '';
                            passField.style.background = '';
                        }
                        // پاک کردن خطاهای احتمالی قبلی در فرم لاگین
                        document.querySelectorAll('#auth-panel-login .auth-field-error-inline').forEach(el => el.remove());
                        // ✅ ورود اتوماتیک پس از پر شدن فیلدها
                        // (سناریوی ۱ در handleLogin اجرا می‌شود چون اکانت محلی الان ذخیره شده است)
                        setTimeout(() => {
                            try {
                                AuthUI.handleLogin();
                            } catch(e) {
                                // در صورت خطای ناشناخته، فقط روی دکمه فوکوس بده
                                try {
                                    const submitBtn = document.querySelector('#auth-panel-login .auth-submit-btn');
                                    if (submitBtn) submitBtn.focus();
                                } catch(_) {}
                            }
                        }, 300);
                    }, 50);
                }, 1200);

            } else {
                // ⚠️ اکانت محلی قبلاً موجود است (با ایمیلی متفاوت).
                // اکانت جدید با موفقیت در GitHub ثبت شد، اما برای جلوگیری از overwrite
                // ناخواسته اکانت محلی، از کاربر تأیید شفاف می‌گیریم.
                AuthUI._showAccountConflictDialog({
                    existingEmail: (existingAccount.email || ''),
                    existingFullName: (existingAccount.fullName || ''),
                    existingStoreName: (existingAccount.storeName || ''),
                    newEmail: emailLow,
                    newFullName: fullName,
                    newStoreName: storeName,
                    onReplace: () => {
                        // کاربر تأیید کرد → اکانت محلی را با اکانت جدید جایگزین کن
                        const localAccount = {
                            fullName,
                            storeName,
                            phone,
                            address,
                            email: emailLow,
                            passwordHash,
                            logo: AuthUI._logoData || null,
                            createdAt: remoteUser.createdAt
                        };
                        const localLicense = {
                            code: result.code,
                            source: result.source,
                            activatedAt: remoteUser.activatedAt,
                            expires: result.expires || null
                        };
                        AuthDB.saveAccount(localAccount);
                        AuthDB.saveLicense(localLicense);
                        AuthDB.clearLogoutFlag();

                        // ذخیره در تنظیمات (برای داشبورد)
                        try {
                            if (window.db && typeof window.db.getSettings === 'function') {
                                const s = window.db.getSettings() || {};
                                s.storeName = storeName; s.storeOwner = fullName;
                                s.storePhone = phone; s.storeAddress = address;
                                s.storeEmail = emailLow;
                                if (AuthUI._logoData) s.storeLogo = AuthUI._logoData;
                                window.db.saveSettings(s);
                            }
                        } catch(e) {}

                        // ذخیره کد به‌عنوان «استفاده‌شده»
                        const usedCodes = JSON.parse(localStorage.getItem('jouya_used_license_codes') || '[]');
                        if (!usedCodes.includes(result.code)) {
                            usedCodes.push(result.code);
                            localStorage.setItem('jouya_used_license_codes', JSON.stringify(usedCodes));
                        }

                        AuthDB.saveRememberedLogin(emailLow, password);

                        // پاک کردن فرم ثبت‌نام
                        ['auth-reg-fullname','auth-reg-store','auth-reg-phone','auth-reg-address',
                         'auth-reg-email','auth-reg-password','auth-reg-password2','auth-reg-license'].forEach(function(id) {
                            const el = document.getElementById(id);
                            if (el) el.value = '';
                        });
                        AuthUI._logoData = null;
                        const preview = document.getElementById('auth-logo-preview');
                        if (preview) preview.innerHTML = '<i class="fas fa-image" style="opacity:0.3;"></i>';

                        AuthUI.showAlert('success', '✓ اکانت با موفقیت جایگزین شد. اکنون می‌توانید وارد شوید.');

                        // ✅ انتقال به فرم لاگین با فیلدهای پر شده — بدون auto-login (manual login)
                        // این جلوگیری از confusion می‌کند: کاربر آگاهانه دکمه «ورود» را می‌زند.
                        const _regEmail2 = emailLow;
                        const _regPass2 = password;
                        setTimeout(() => {
                            AuthUI.switchTab('login');
                            setTimeout(() => {
                                const emailField = document.getElementById('auth-login-email');
                                const passField = document.getElementById('auth-login-password');
                                if (emailField) {
                                    emailField.value = _regEmail2;
                                    emailField.style.borderColor = '';
                                    emailField.style.background = '';
                                }
                                if (passField) {
                                    passField.value = _regPass2;
                                    passField.style.borderColor = '';
                                    passField.style.background = '';
                                }
                                document.querySelectorAll('#auth-panel-login .auth-field-error-inline').forEach(el => el.remove());
                                // فوکوس روی دکمه ورود تا کاربر فقط Enter بزند
                                try {
                                    const submitBtn = document.querySelector('#auth-panel-login .auth-submit-btn');
                                    if (submitBtn) submitBtn.focus();
                                } catch(e) {}
                            }, 50);
                        }, 600);
                    },
                    onKeep: () => {
                        // کاربر انصراف داد → اکانت محلی دست نخورد
                        // اکانت جدید فقط در GitHub ثبت شد و کاربر می‌تواند در دستگاه دیگر با آن وارد شود
                        AuthUI.showAlert('success', '✓ اکانت جدید در سرور ثبت شد. اکانت فعلی این دستگاه دست‌نخورده باقی ماند.');
                        // پاک کردن فرم ثبت‌نام
                        setTimeout(() => {
                            ['auth-reg-fullname','auth-reg-store','auth-reg-phone','auth-reg-address',
                             'auth-reg-email','auth-reg-password','auth-reg-password2','auth-reg-license'].forEach(function(id) {
                                const el = document.getElementById(id);
                                if (el) el.value = '';
                            });
                            AuthUI._logoData = null;
                            const preview = document.getElementById('auth-logo-preview');
                            if (preview) preview.innerHTML = '<i class="fas fa-image" style="opacity:0.3;"></i>';
                        }, 600);
                    }
                });
            }
        },

        // ✅ مودال هشدار تعارض اکانت — هنگامی که اکانت محلی موجود است و کاربر اکانت جدیدی می‌سازد
        // این مودال جلوی silent overwrite را می‌گیرد و به کاربر اطلاعات شفاف می‌دهد
        _showAccountConflictDialog(opts) {
            const old = document.getElementById('account-conflict-dialog');
            if (old) old.remove();

            const escHtml = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

            const modal = document.createElement('div');
            modal.id = 'account-conflict-dialog';
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:"Vazirmatn",sans-serif;direction:rtl;padding:14px;overflow-y:auto;';
            modal.innerHTML = `
                <div style="background:#fff;border-radius:18px;padding:28px 26px;max-width:480px;width:100%;box-shadow:0 25px 60px rgba(0,0,0,0.3);">
                    <div style="text-align:center;margin-bottom:18px;">
                        <div style="width:64px;height:64px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
                            <i class="fas fa-exclamation-triangle" style="font-size:28px;color:#d97706;"></i>
                        </div>
                        <h3 style="margin:0 0 8px;color:#1e293b;font-size:17px;font-weight:700;">⚠️ هشدار: اکانت قبلی روی این دستگاه</h3>
                        <p style="margin:0;color:#64748b;font-size:12.5px;line-height:1.8;">
                            اکانت جدید با موفقیت در سرور ثبت شد. اما توجه داشته باشید:
                        </p>
                    </div>

                    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:11px;padding:13px 14px;margin-bottom:12px;">
                        <div style="font-size:12px;color:#991b1b;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                            <i class="fas fa-user-clock"></i> اکانت فعلی این دستگاه:
                        </div>
                        <div style="font-size:13px;color:#7f1d1d;line-height:1.9;">
                            <div><strong>ایمیل:</strong> <span style="direction:ltr;display:inline-block;">${escHtml(opts.existingEmail)}</span></div>
                            ${opts.existingFullName ? `<div><strong>نام:</strong> ${escHtml(opts.existingFullName)}</div>` : ''}
                            ${opts.existingStoreName ? `<div><strong>فروشگاه:</strong> ${escHtml(opts.existingStoreName)}</div>` : ''}
                        </div>
                    </div>

                    <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:11px;padding:13px 14px;margin-bottom:14px;">
                        <div style="font-size:12px;color:#065f46;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                            <i class="fas fa-user-plus"></i> اکانت جدیدی که ساختید:
                        </div>
                        <div style="font-size:13px;color:#064e3b;line-height:1.9;">
                            <div><strong>ایمیل:</strong> <span style="direction:ltr;display:inline-block;">${escHtml(opts.newEmail)}</span></div>
                            ${opts.newFullName ? `<div><strong>نام:</strong> ${escHtml(opts.newFullName)}</div>` : ''}
                            ${opts.newStoreName ? `<div><strong>فروشگاه:</strong> ${escHtml(opts.newStoreName)}</div>` : ''}
                        </div>
                    </div>

                    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:11px 13px;margin-bottom:16px;font-size:11.5px;color:#78350f;line-height:1.8;">
                        <i class="fas fa-info-circle" style="color:#d97706;"></i>
                        اگر «جایگزین کن» را انتخاب کنید، اطلاعات اکانت قبلی روی این دستگاه پاک می‌شود (داده‌ها در سرور حفظ می‌مانند و می‌توانید بعداً با آن ایمیل و رمز عبور وارد شوید).
                    </div>

                    <div style="display:flex;gap:10px;flex-direction:column;">
                        <button id="ac-conflict-replace" style="width:100%;padding:13px;border:none;border-radius:11px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
                            <i class="fas fa-exchange-alt"></i>
                            جایگزین کن و به فرم ورود برو
                        </button>
                        <button id="ac-conflict-keep" style="width:100%;padding:13px;border:1.5px solid #cbd5e1;border-radius:11px;background:#fff;color:#475569;font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
                            <i class="fas fa-shield-alt"></i>
                            اکانت قبلی را نگه دار
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            modal.querySelector('#ac-conflict-replace').onclick = () => {
                modal.remove();
                if (typeof opts.onReplace === 'function') opts.onReplace();
            };
            modal.querySelector('#ac-conflict-keep').onclick = () => {
                modal.remove();
                if (typeof opts.onKeep === 'function') opts.onKeep();
            };
        },

        // ✅ راهنمای ورود از دستگاه جدید — فقط یک پیام آموزشی نمایش می‌دهد
        // چون با مدل GitHub Auth، کافی است کاربر همان ایمیل و رمز را در فرم بزند
        // و سیستم به‌صورت خودکار از سرور بازیابی می‌کند.
        async openDriveRestoreFlow() {
            const old = document.getElementById('restore-info-dialog');
            if (old) old.remove();
            const modal = document.createElement('div');
            modal.id = 'restore-info-dialog';
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:"Vazirmatn",sans-serif;direction:rtl;';
            modal.innerHTML = `
                <div style="background:#fff;border-radius:18px;padding:32px 28px;max-width:440px;width:92%;box-shadow:0 25px 60px rgba(0,0,0,0.25);text-align:center;">
                    <div style="width:64px;height:64px;background:linear-gradient(135deg,#dbeafe,#e0e7ff);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
                        <i class="fas fa-info-circle" style="font-size:30px;color:#3b82f6;"></i>
                    </div>
                    <h3 style="margin:0 0 12px;color:#1e293b;font-size:18px;font-weight:700;">ورود از دستگاه جدید</h3>
                    <p style="margin:0 0 14px;color:#475569;font-size:13.5px;line-height:1.9;">
                        برای ورود از کامپیوتر دیگر، نیازی به مرحله اضافه نیست!<br>
                        کافی است در همین فرم ورود، <strong>همان ایمیل و رمز عبوری</strong> که هنگام ثبت‌نام انتخاب کرده بودید را وارد کنید.
                    </p>
                    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px;margin:14px 0;text-align:right;font-size:12.5px;color:#166534;line-height:1.9;">
                        <i class="fas fa-check-circle" style="color:#10b981;width:18px;"></i>
                        اپلیکیشن به‌صورت خودکار اطلاعات شما را از سرور بازیابی می‌کند.
                    </div>
                    <button id="restore-info-ok" style="width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;">
                        متوجه شدم
                    </button>
                </div>
            `;
            document.body.appendChild(modal);
            modal.querySelector('#restore-info-ok').onclick = () => modal.remove();
        },

        // ✅ فرم فراموشی رمز عبور — درون همان صفحه لاگین (بدون modal)
        // سه مرحله: ۱) دریافت ایمیل ۲) دریافت کد تأیید ۳) تنظیم رمز جدید
        // کد تأیید از طریق EmailJS به ایمیل کاربر ارسال می‌شود.
        openForgotPassword() {
            const card = document.querySelector('.auth-card');
            const loginPanel = document.getElementById('auth-panel-login');
            const registerPanel = document.getElementById('auth-panel-register');
            const forgotPanel = document.getElementById('auth-panel-forgot');
            if (!forgotPanel) return;

            // پنهان کردن tab های بالا (forgot یک حالت موقت است)
            if (loginPanel) loginPanel.style.display = 'none';
            if (registerPanel) registerPanel.style.display = 'none';
            forgotPanel.style.display = 'block';
            if (card) card.classList.remove('auth-card-landscape');

            // ریست وضعیت
            _forgotState.step = 1;
            _forgotState.email = '';
            _forgotState.code = '';
            _forgotState.codeSentAt = 0;
            _forgotState.attempts = 0;

            // نمایش مرحله ۱
            const s1 = document.getElementById('auth-forgot-step1');
            const s2 = document.getElementById('auth-forgot-step2');
            const s3 = document.getElementById('auth-forgot-step3');
            if (s1) s1.style.display = 'block';
            if (s2) s2.style.display = 'none';
            if (s3) s3.style.display = 'none';

            // پاک کردن فیلدها و خطاها
            ['auth-forgot-email','auth-forgot-code','auth-forgot-newpwd','auth-forgot-newpwd2'].forEach(function(id) {
                const el = document.getElementById(id);
                if (el) {
                    el.value = '';
                    el.style.borderColor = '';
                    el.style.background = '';
                }
            });
            forgotPanel.querySelectorAll('.auth-field-error-inline').forEach(el => el.remove());

            // پر کردن خودکار ایمیل اگر در فرم لاگین نوشته شده
            const loginEmail = document.getElementById('auth-login-email');
            const forgotEmail = document.getElementById('auth-forgot-email');
            if (loginEmail && loginEmail.value && forgotEmail) {
                forgotEmail.value = loginEmail.value;
            }

            // به‌روزرسانی subtitle
            const subtitle = document.getElementById('auth-forgot-subtitle');
            if (subtitle) {
                subtitle.innerHTML = 'ایمیل اکانت خود را وارد کنید تا کد تأیید برای شما ارسال شود.';
            }

            // فوکوس روی فیلد ایمیل
            setTimeout(() => {
                if (forgotEmail) {
                    try { forgotEmail.focus(); } catch(e) {}
                }
            }, 100);
        },

        // بستن پنل forgot و بازگشت به فرم لاگین
        closeForgotPanel() {
            const forgotPanel = document.getElementById('auth-panel-forgot');
            const loginPanel = document.getElementById('auth-panel-login');
            const registerPanel = document.getElementById('auth-panel-register');
            const card = document.querySelector('.auth-card');
            if (forgotPanel) forgotPanel.style.display = 'none';
            if (loginPanel) loginPanel.style.display = 'block';
            if (registerPanel) registerPanel.style.display = 'none';
            if (card) card.classList.remove('auth-card-landscape');
            // فعال کردن tab «ورود»
            document.querySelectorAll('.auth-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === 'login');
            });
        },

        // نمایش خطا روی یک فیلد در پنل forgot
        _showForgotFieldError(fieldId, msg) {
            const inp = document.getElementById(fieldId);
            if (!inp) return;
            inp.style.borderColor = '#dc2626';
            inp.style.background = '#fef2f2';
            // پاک کردن خطای قبلی همان فیلد
            const parent = inp.parentElement;
            const wrap = (parent && parent.classList.contains('auth-password-wrap')) ? parent : inp;
            const nextErr = wrap.nextElementSibling;
            if (nextErr && nextErr.classList.contains('auth-field-error-inline')) {
                nextErr.remove();
            }
            const err = document.createElement('div');
            err.className = 'auth-field-error-inline';
            err.style.cssText = 'display:flex;align-items:center;gap:6px;color:#dc2626;font-size:11.5px;font-weight:600;margin-top:5px;line-height:1.6;animation:authErrShake 0.35s;';
            err.innerHTML = '<i class="fas fa-exclamation-circle" style="font-size:12px;"></i><span>' + msg + '</span>';
            wrap.parentNode.insertBefore(err, wrap.nextSibling);
            try { inp.focus(); } catch(e) {}
        },

        _clearForgotErrors() {
            const forgotPanel = document.getElementById('auth-panel-forgot');
            if (!forgotPanel) return;
            forgotPanel.querySelectorAll('.auth-field-error-inline').forEach(el => el.remove());
            forgotPanel.querySelectorAll('input').forEach(el => {
                el.style.borderColor = '';
                el.style.background = '';
            });
        },

        // مرحله ۱: ارسال کد تأیید به ایمیل
        async handleForgotSendCode(isResend) {
            this._clearForgotErrors();
            const emailField = document.getElementById('auth-forgot-email');
            if (!emailField) return;
            const email = (emailField.value || '').trim().toLowerCase();

            // اعتبارسنجی ایمیل
            if (!email) {
                this._showForgotFieldError('auth-forgot-email', 'لطفاً ایمیل اکانت را وارد کنید.');
                return;
            }
            if (!email.includes('@') || !email.includes('.')) {
                this._showForgotFieldError('auth-forgot-email', 'فرمت ایمیل نامعتبر است.');
                return;
            }

            // بررسی تنظیم EmailJS
            if (!isEmailJSConfigured()) {
                this._showForgotFieldError('auth-forgot-email', 'سیستم ارسال ایمیل تنظیم نشده است. لطفاً با پشتیبانی تماس بگیرید.');
                return;
            }
            if (!GitHubAuthDB.isConfigured()) {
                this._showForgotFieldError('auth-forgot-email', 'سیستم بازیابی رمز تنظیم نشده است. با پشتیبانی تماس بگیرید.');
                return;
            }

            // پیدا کردن دکمه فعلی برای نمایش loading
            const btnSelector = isResend
                ? '#auth-forgot-step2 small[onclick*="handleForgotSendCode"]'
                : '#auth-forgot-step1 .auth-submit-btn';
            const sendBtn = document.querySelector('#auth-forgot-step1 .auth-submit-btn');
            const oldBtnHtml = sendBtn ? sendBtn.innerHTML : '';
            if (sendBtn && !isResend) {
                sendBtn.disabled = true;
                sendBtn.style.opacity = '0.6';
                sendBtn.style.cursor = 'not-allowed';
                sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> در حال بررسی ایمیل...';
            }

            try {
                // ۱) چک کن ایمیل در سرور وجود دارد
                const find = await GitHubAuthDB.findUser(email);
                if (!find.ok) {
                    if (sendBtn && !isResend) {
                        sendBtn.disabled = false;
                        sendBtn.style.opacity = '1';
                        sendBtn.style.cursor = 'pointer';
                        sendBtn.innerHTML = oldBtnHtml;
                    }
                    this._showForgotFieldError('auth-forgot-email', 'خطا در اتصال به سرور: ' + (find.error || 'نامشخص'));
                    return;
                }
                if (!find.user) {
                    if (sendBtn && !isResend) {
                        sendBtn.disabled = false;
                        sendBtn.style.opacity = '1';
                        sendBtn.style.cursor = 'pointer';
                        sendBtn.innerHTML = oldBtnHtml;
                    }
                    this._showForgotFieldError('auth-forgot-email', 'هیچ اکانتی با این ایمیل یافت نشد.');
                    return;
                }

                // ۲) تولید کد و ارسال ایمیل
                const code = generateVerificationCode();
                if (sendBtn && !isResend) {
                    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> در حال ارسال کد به ایمیل...';
                }
                await sendVerificationEmailViaEmailJS(email, code);

                // ۳) ذخیره کد در حافظه و رفتن به مرحله ۲
                _forgotState.step = 2;
                _forgotState.email = email;
                _forgotState.code = code;
                _forgotState.codeSentAt = Date.now();
                _forgotState.attempts = 0;

                if (sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.style.opacity = '1';
                    sendBtn.style.cursor = 'pointer';
                    sendBtn.innerHTML = oldBtnHtml;
                }

                // نمایش مرحله ۲
                document.getElementById('auth-forgot-step1').style.display = 'none';
                document.getElementById('auth-forgot-step2').style.display = 'block';
                document.getElementById('auth-forgot-step3').style.display = 'none';
                const emailDisplay = document.getElementById('auth-forgot-email-display');
                if (emailDisplay) emailDisplay.textContent = email;
                const subtitle = document.getElementById('auth-forgot-subtitle');
                if (subtitle) {
                    subtitle.innerHTML = 'کد ۶ رقمی به ایمیل شما ارسال شد. کد را وارد کنید.';
                }
                // پاک کردن فیلد کد و فوکوس
                const codeField = document.getElementById('auth-forgot-code');
                if (codeField) {
                    codeField.value = '';
                    setTimeout(() => { try { codeField.focus(); } catch(e) {} }, 100);
                }

                if (isResend) {
                    AuthUI.showAlert('success', 'کد تأیید مجدداً به ایمیل شما ارسال شد.');
                }

            } catch (e) {
                if (sendBtn && !isResend) {
                    sendBtn.disabled = false;
                    sendBtn.style.opacity = '1';
                    sendBtn.style.cursor = 'pointer';
                    sendBtn.innerHTML = oldBtnHtml;
                }
                const errMsg = (e && e.text) ? e.text : (e && e.message) ? e.message : 'خطا در ارسال ایمیل';
                this._showForgotFieldError('auth-forgot-email', 'خطا در ارسال کد: ' + errMsg);
            }
        },

        // مرحله ۲: تأیید کد
        handleForgotVerifyCode() {
            this._clearForgotErrors();
            const codeField = document.getElementById('auth-forgot-code');
            if (!codeField) return;
            const code = (codeField.value || '').trim();

            if (!code) {
                this._showForgotFieldError('auth-forgot-code', 'لطفاً کد تأیید را وارد کنید.');
                return;
            }
            if (code.length !== 6 || !/^\d{6}$/.test(code)) {
                this._showForgotFieldError('auth-forgot-code', 'کد تأیید باید ۶ رقم عددی باشد.');
                return;
            }

            // بررسی تعداد تلاش‌های ناموفق
            if (_forgotState.attempts >= 5) {
                this._showForgotFieldError('auth-forgot-code', 'تعداد تلاش بیش از حد. لطفاً کد جدید درخواست کنید.');
                return;
            }

            // بررسی انقضای کد (۱۵ دقیقه)
            const elapsed = Date.now() - _forgotState.codeSentAt;
            if (elapsed > 15 * 60 * 1000) {
                this._showForgotFieldError('auth-forgot-code', 'کد تأیید منقضی شده است. لطفاً کد جدید درخواست کنید.');
                return;
            }

            // مقایسه کد
            if (code !== _forgotState.code) {
                _forgotState.attempts++;
                const remaining = 5 - _forgotState.attempts;
                this._showForgotFieldError('auth-forgot-code', 'کد تأیید نادرست است.' + (remaining > 0 ? ' (' + remaining + ' تلاش باقی مانده)' : ''));
                return;
            }

            // کد درست — رفتن به مرحله ۳
            _forgotState.step = 3;
            document.getElementById('auth-forgot-step1').style.display = 'none';
            document.getElementById('auth-forgot-step2').style.display = 'none';
            document.getElementById('auth-forgot-step3').style.display = 'block';
            const subtitle = document.getElementById('auth-forgot-subtitle');
            if (subtitle) {
                subtitle.innerHTML = 'رمز عبور جدید خود را تنظیم کنید.';
            }
            // فوکوس روی فیلد رمز جدید
            const newPwdField = document.getElementById('auth-forgot-newpwd');
            if (newPwdField) {
                setTimeout(() => { try { newPwdField.focus(); } catch(e) {} }, 100);
            }
        },

        // برگشت از مرحله ۲ به مرحله ۱ (تغییر ایمیل)
        handleForgotChangeEmail() {
            this._clearForgotErrors();
            _forgotState.step = 1;
            _forgotState.code = '';
            _forgotState.codeSentAt = 0;
            _forgotState.attempts = 0;
            document.getElementById('auth-forgot-step1').style.display = 'block';
            document.getElementById('auth-forgot-step2').style.display = 'none';
            document.getElementById('auth-forgot-step3').style.display = 'none';
            const subtitle = document.getElementById('auth-forgot-subtitle');
            if (subtitle) {
                subtitle.innerHTML = 'ایمیل اکانت خود را وارد کنید تا کد تأیید برای شما ارسال شود.';
            }
            const emailField = document.getElementById('auth-forgot-email');
            if (emailField) {
                setTimeout(() => { try { emailField.focus(); } catch(e) {} }, 100);
            }
        },

        // مرحله ۳: تنظیم رمز جدید + ورود اتوماتیک
        async handleForgotResetPassword() {
            this._clearForgotErrors();
            const newPwdField = document.getElementById('auth-forgot-newpwd');
            const newPwd2Field = document.getElementById('auth-forgot-newpwd2');
            if (!newPwdField || !newPwd2Field) return;

            const newPwd = (newPwdField.value || '').trim();
            const newPwd2 = (newPwd2Field.value || '').trim();

            // اعتبارسنجی
            let hasError = false;
            if (!newPwd) {
                this._showForgotFieldError('auth-forgot-newpwd', 'لطفاً رمز جدید را وارد کنید.');
                hasError = true;
            } else if (newPwd.length < 6) {
                this._showForgotFieldError('auth-forgot-newpwd', 'رمز جدید باید حداقل ۶ کاراکتر باشد.');
                hasError = true;
            }
            if (!newPwd2) {
                this._showForgotFieldError('auth-forgot-newpwd2', 'لطفاً رمز جدید را تکرار کنید.');
                hasError = true;
            } else if (newPwd && newPwd !== newPwd2) {
                this._showForgotFieldError('auth-forgot-newpwd2', 'تکرار رمز با رمز جدید مطابقت ندارد.');
                hasError = true;
            }
            if (hasError) return;

            // تأیید نهایی: کد و ایمیل باید معتبر باشند
            if (_forgotState.step !== 3 || !_forgotState.email) {
                this._showForgotFieldError('auth-forgot-newpwd', 'وضعیت بازیابی نامعتبر است. لطفاً از ابتدا شروع کنید.');
                return;
            }

            const email = _forgotState.email;
            const submitBtn = document.querySelector('#auth-forgot-step3 .auth-submit-btn');
            const oldBtnHtml = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.6';
                submitBtn.style.cursor = 'not-allowed';
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> در حال بروزرسانی...';
            }

            try {
                // ۱. آپدیت رمز در سرور
                const newHash = simpleHash(newPwd);
                const upd = await GitHubAuthDB.updateUser(email, { passwordHash: newHash });
                if (!upd.ok) {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.style.opacity = '1';
                        submitBtn.style.cursor = 'pointer';
                        submitBtn.innerHTML = oldBtnHtml;
                    }
                    this._showForgotFieldError('auth-forgot-newpwd', 'خطا در بروزرسانی رمز: ' + (upd.error || 'نامشخص') + '. لطفاً دوباره تلاش کنید.');
                    return;
                }

                // ۲. اگر اکانت محلی هم با همین ایمیل است، رمز محلی را هم آپدیت کن
                const localAcc = AuthDB.getAccount();
                if (localAcc && (localAcc.email || '').toLowerCase() === email) {
                    localAcc.passwordHash = newHash;
                    AuthDB.saveAccount(localAcc);
                }
                AuthDB.saveRememberedLogin(email, newPwd);

                // ۳. پاک کردن وضعیت forgot
                _forgotState.step = 1;
                _forgotState.email = '';
                _forgotState.code = '';
                _forgotState.codeSentAt = 0;
                _forgotState.attempts = 0;

                AuthUI.showAlert('success', '✓ رمز عبور با موفقیت تغییر کرد. در حال ورود به حساب کاربری...');

                // ۴. بازگشت به فرم لاگین + پر کردن فیلدها + ورود اتوماتیک
                setTimeout(() => {
                    AuthUI.closeForgotPanel();
                    setTimeout(() => {
                        const eFld = document.getElementById('auth-login-email');
                        const pFld = document.getElementById('auth-login-password');
                        if (eFld) {
                            eFld.value = email;
                            eFld.style.borderColor = '';
                            eFld.style.background = '';
                        }
                        if (pFld) {
                            pFld.value = newPwd;
                            pFld.style.borderColor = '';
                            pFld.style.background = '';
                        }
                        document.querySelectorAll('#auth-panel-login .auth-field-error-inline').forEach(el => el.remove());
                        // ورود اتوماتیک
                        setTimeout(() => {
                            try {
                                AuthUI.handleLogin();
                            } catch(e) {
                                try {
                                    const submitBtnL = document.querySelector('#auth-panel-login .auth-submit-btn');
                                    if (submitBtnL) submitBtnL.focus();
                                } catch(_) {}
                            }
                        }, 300);
                    }, 100);
                }, 800);

            } catch (e) {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                    submitBtn.innerHTML = oldBtnHtml;
                }
                this._showForgotFieldError('auth-forgot-newpwd', 'خطا: ' + (e.message || 'نامشخص'));
            }
        }
    };

    window.AuthUI = AuthUI;

    function simpleHash(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h) + s.charCodeAt(i);
            h |= 0;
        }
        return 'h_' + Math.abs(h).toString(36) + '_' + s.length;
    }

    // =========================================================================
    // ۸. بستن صفحه auth و شروع اپ
    // =========================================================================
    function closeAuthAndStart() {
        // ✅ اطمینان از پاک شدن فلگ logout (در صورت ورود از مسیرهای مختلف)
        AuthDB.clearLogoutFlag();

        const ov = document.getElementById('auth-screen-overlay');
        if (ov) {
            ov.style.transition = 'opacity 0.4s';
            ov.style.opacity = '0';
            setTimeout(() => ov.remove(), 400);
        }
        document.body.style.overflow = '';
        setTimeout(() => populateDashboardUserInfo(), 100);
        setTimeout(() => populateDashboardUserInfo(), 600);
        setTimeout(() => populateDashboardUserInfo(), 1500);
        setTimeout(setupSidebarBackupHook, 1500);
        setTimeout(setupSidebarUpdateHook, 1500);
        // بک‌آپ خودکار به‌طور کامل غیرفعال شد (طبق درخواست کاربر)
        // setTimeout(setupAutoBackup, 3000);
        // ذخیره اکانت در Drive در پس‌زمینه (اگر متصل)
        setTimeout(syncAccountToDriveIfConnected, 5000);
    }

    async function syncAccountToDriveIfConnected() {
        if (!isElectron || !window.DriveAccount) return;
        const account = AuthDB.getAccount();
        const license = AuthDB.getLicense();
        if (!account) return;

        try {
            // فقط اگر توکن معتبر داریم، آپلود کن (بدون باز کردن popup)
            const tokenStr = localStorage.getItem('jouya_gdrive_token');
            if (!tokenStr) return;
            const token = JSON.parse(tokenStr);
            const elapsed = (Date.now() - (token.savedAt || 0)) / 1000;
            if (elapsed > (token.expires_in || 3600) - 60) return;

            await window.DriveAccount.saveAccount(token, { account, license });
            console.log('✅ اکانت در Google Drive همگام شد');
        } catch (e) {
            console.warn('همگام‌سازی اکانت با Drive:', e.message);
        }
    }

    // =========================================================================
    // ۹. پر کردن کارت «اطلاعات فروشگاه»
    // =========================================================================
    function populateDashboardUserInfo() {
        const account = AuthDB.getAccount();
        if (!account) return;

        const card = document.querySelector('.dashboard-user-info');
        if (!card) return;

        if (card.classList.contains('auth-populated')) return;
        card.classList.add('auth-populated');

        const license = AuthDB.getLicense();

        const logoHTML = account.logo
            ? `<img src="${account.logo}" alt="logo" class="dui-logo-clean">`
            : `<div class="dui-logo-clean dui-logo-default"><i class="fas fa-store"></i></div>`;

        card.innerHTML = `
            <div class="dui-clean">
                <div class="dui-clean-head">
                    ${logoHTML}
                    <div class="dui-clean-titles">
                        <div class="dui-clean-store">${escapeHtml(account.storeName || 'فروشگاه من')}</div>
                        <div class="dui-clean-owner">${escapeHtml(account.fullName || '')}</div>
                    </div>
                </div>

                <ul class="dui-clean-lines">
                    ${account.phone ? `
                    <li>
                        <i class="fas fa-phone-alt"></i>
                        <span>${escapeHtml(account.phone)}</span>
                    </li>` : ''}

                    ${account.email ? `
                    <li>
                        <i class="fas fa-envelope"></i>
                        <span class="dui-ltr">${escapeHtml(account.email)}</span>
                    </li>` : ''}

                    ${account.address ? `
                    <li>
                        <i class="fas fa-map-marker-alt"></i>
                        <span>${escapeHtml(account.address)}</span>
                    </li>` : ''}

                    <li>
                        <i class="fas fa-shield-alt" style="color:#10b981;"></i>
                        <span>لایسنس فعال${license && license.expires ? ' — تا ' + license.expires : ''}</span>
                    </li>
                </ul>
            </div>
        `;
    }

    window.populateDashboardUserInfo = populateDashboardUserInfo;

    // =========================================================================
    // ۱۰. مودال پشتیبان دستی
    // =========================================================================
    AuthUI.openBackupModal = function() {
        const account = AuthDB.getAccount();
        if (!account || !account.email) {
            AuthUI.showAlert('warning', 'ایمیلی برای کاربر تنظیم نشده است.');
            return;
        }
        const old = document.getElementById('backup-modal-overlay');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'backup-modal-overlay';
        modal.className = 'backup-modal-overlay';
        modal.innerHTML = `
            <div class="backup-modal">
                <button class="backup-modal-close" onclick="document.getElementById('backup-modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
                <div class="backup-modal-icon"><i class="fas fa-cloud-upload-alt"></i></div>
                <h2 class="backup-modal-title">پشتیبان‌گیری ایمیل</h2>
                <p class="backup-modal-desc">
                    اطلاعات شما در ایمیل
                    <strong>${escapeHtml(account.email)}</strong>
                    ذخیره خواهد شد.
                </p>

                <div class="backup-progress-wrap" id="backup-progress-wrap" style="display:none;">
                    <div class="backup-progress-bar">
                        <div class="backup-progress-fill" id="backup-progress-fill" style="width:0%;"></div>
                    </div>
                    <div class="backup-progress-percent" id="backup-progress-percent">۰٪</div>
                    <div class="backup-progress-msg" id="backup-progress-msg">آماده‌سازی...</div>
                </div>

                <div class="backup-modal-actions" id="backup-modal-actions">
                    <button class="backup-start-btn" onclick="window.AuthUI.startBackup()">
                        <i class="fas fa-paper-plane"></i>
                        شروع پشتیبان‌گیری
                    </button>
                    <button class="backup-cancel-btn" onclick="document.getElementById('backup-modal-overlay').remove()">
                        انصراف
                    </button>
                </div>

                <div class="backup-success-box" id="backup-success-box" style="display:none;">
                    <i class="fas fa-check-circle"></i>
                    <h3>پشتیبان‌گیری با موفقیت تکمیل شد!</h3>
                    <p id="backup-success-detail"></p>
                    <button class="backup-close-btn" onclick="document.getElementById('backup-modal-overlay').remove()">بستن</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    };

    AuthUI.startBackup = async function() {
        const wrap = document.getElementById('backup-progress-wrap');
        const actions = document.getElementById('backup-modal-actions');
        const fill = document.getElementById('backup-progress-fill');
        const pct = document.getElementById('backup-progress-percent');
        const msg = document.getElementById('backup-progress-msg');
        if (wrap) wrap.style.display = 'block';
        if (actions) actions.style.display = 'none';

        const result = await performEmailBackup((p, m) => {
            if (fill) fill.style.width = p + '%';
            if (pct) pct.textContent = toFaNum(p) + '٪';
            if (msg) msg.textContent = m;
        });

        if (result.success) {
            const successBox = document.getElementById('backup-success-box');
            const detail = document.getElementById('backup-success-detail');
            if (wrap) wrap.style.display = 'none';
            if (successBox) successBox.style.display = 'block';
            if (detail) detail.innerHTML =
                'حجم: <strong>' + result.size + '</strong><br>' +
                'ایمیل: <strong>' + escapeHtml(result.email) + '</strong><br>' +
                'فایل پشتیبان در کامپیوتر شما هم ذخیره شد.';
            const lastEl = document.getElementById('dui-last-backup');
            if (lastEl) lastEl.textContent = _fmtAfg(new Date());
        } else {
            if (msg) msg.textContent = '✗ خطا: ' + (result.error || 'نامشخص');
            if (msg) msg.style.color = '#dc2626';
        }
    };

    function toFaNum(n) {
        return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
    }

    // ✅ تابع کمکی فرمت تاریخ به هجری شمسی افغانستان (نام‌های دری)
    // از window.formatAfghanDateTime که در drive-backup.js تعریف شده استفاده می‌کند
    // و اگر در دسترس نبود، با persian-date-utils.js به‌صورت محلی محاسبه می‌کند
    function _fmtAfg(dateInput) {
        if (!dateInput) return '';
        try {
            // اولویت ۱: استفاده از تابع گلوبال drive-backup
            if (typeof window.formatAfghanDateTime === 'function') {
                return window.formatAfghanDateTime(dateInput);
            }
            // اولویت ۲: محاسبه محلی با persian-date-utils
            const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
            if (isNaN(d.getTime())) return '';
            if (typeof window.gregorianToJalali === 'function') {
                const j = window.gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
                const monthNames = window.dariMonthNames ||
                    ['حمل','ثور','جوزا','سرطان','اسد','سنبله','میزان','عقرب','قوس','جدی','دلو','حوت'];
                const m = monthNames[j[1] - 1] || '';
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                return toFaNum(j[2]) + ' ' + m + ' ' + toFaNum(j[0]) +
                       ' - ' + toFaNum(hh) + ':' + toFaNum(mm);
            }
            // fallback نهایی: ISO ساده
            return d.toLocaleDateString('en-CA') + ' ' +
                String(d.getHours()).padStart(2, '0') + ':' +
                String(d.getMinutes()).padStart(2, '0');
        } catch (e) {
            return '';
        }
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    window.openManualBackupModal = function() { AuthUI.openBackupModal(); };

    window.AuthLogout = function() {
        if (!confirm('آیا مطمئن هستید که می‌خواهید از حساب خارج شوید؟ اطلاعات حساب شما حفظ می‌شود.')) return;
        // پاک کردن توکن Drive
        localStorage.removeItem('jouya_gdrive_token');
        localStorage.removeItem('jouya_gdrive_email');
        localStorage.removeItem('jouya_gdrive_name');
        // فقط نشست را پاک کن — اطلاعات اکانت برای ورود مجدد حفظ می‌شود
        AuthDB.logoutSession();
        try {
            if (window.JouyaAuth && typeof window.JouyaAuth.logout === 'function') window.JouyaAuth.logout();
            else if (window.JouyaSync && typeof window.JouyaSync.signOut === 'function') window.JouyaSync.signOut();
        } catch (e) {}
        location.reload();
    };

    // =========================================================================
    // ۱۱. Hook سایدبار پشتیبان
    // =========================================================================
    function setupSidebarBackupHook() {
        const items = document.querySelectorAll('[onclick*="ssbOpenSub"][onclick*="backup"]');
        items.forEach(item => {
            item.addEventListener('click', function() {
                const account = AuthDB.getAccount();
                if (!account || !account.email) return;
                setTimeout(() => {
                    const subCont = document.getElementById('ssb-sub-content');
                    if (!subCont || subCont.style.display === 'none') return;
                    if (subCont.querySelector('.auth-unified-backup-card')) return;

                    const lastEmail = localStorage.getItem(AUTH_CONFIG.KEYS.LAST_BACKUP);
                    const lastEmailStr = lastEmail
                        ? _fmtAfg(lastEmail)
                        : 'هنوز پشتیبانی نشده';
                    const lastDrive = localStorage.getItem('jouya_last_gdrive_backup');
                    const lastDriveStr = lastDrive
                        ? _fmtAfg(lastDrive)
                        : 'هنوز پشتیبانی نشده';

                    const card = document.createElement('div');
                    card.className = 'auth-unified-backup-card';
                    card.innerHTML = `
                        <div class="aubc-header">
                            <div class="aubc-icon"><i class="fas fa-cloud-upload-alt"></i></div>
                            <div class="aubc-titles">
                                <div class="aubc-title">پشتیبان‌گیری</div>
                                <div class="aubc-subtitle"><i class="fas fa-envelope"></i> ${escapeHtml(account.email)}</div>
                            </div>
                        </div>

                        <div class="aubc-options">
                            <button class="aubc-option-btn" onclick="window.AuthUI.openBackupModal()">
                                <div class="aubc-opt-icon aubc-icon-email"><i class="fas fa-envelope"></i></div>
                                <div class="aubc-opt-texts">
                                    <div class="aubc-opt-title">پشتیبان ایمیل</div>
                                    <div class="aubc-opt-meta">آخرین: ${lastEmailStr}</div>
                                </div>
                                <i class="fas fa-chevron-left aubc-arrow"></i>
                            </button>

                            <button class="aubc-option-btn" onclick="window.DriveBackup && window.DriveBackup.openModal()">
                                <div class="aubc-opt-icon aubc-icon-drive">
                                    <svg width="20" height="20" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                                        <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                                        <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                                        <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                                        <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                                        <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                                        <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                                    </svg>
                                </div>
                                <div class="aubc-opt-texts">
                                    <div class="aubc-opt-title">Google Drive</div>
                                    <div class="aubc-opt-meta">آخرین: ${lastDriveStr}</div>
                                </div>
                                <i class="fas fa-chevron-left aubc-arrow"></i>
                            </button>
                        </div>

                        <div class="aubc-note">
                            <i class="fas fa-info-circle"></i>
                            هر دو نوع پشتیبان به ایمیل شما متصل است
                        </div>
                    `;
                    subCont.insertBefore(card, subCont.firstChild);
                }, 80);
            });
        });
    }

    // =========================================================================
    // ۱۲. Hook سایدبار آپدیت + خروج + درباره ما
    // =========================================================================
    function setupSidebarUpdateHook() {
        const list = document.getElementById('ssb-main-list');
        if (!list) return;

        // گزینه بروزرسانی
        if (!list.querySelector('[data-update-item]')) {
            const li = document.createElement('li');
            li.setAttribute('data-update-item', '1');
            li.style.cursor = 'pointer';
            li.onclick = () => window.AuthUI.openUpdateModal();
            li.innerHTML = `
                <span class="ssb-item-icon"><i class="fas fa-sync-alt"></i></span>
                <span class="ssb-item-label">بروزرسانی</span>
                <i class="fas fa-chevron-left ssb-arrow"></i>
            `;
            list.appendChild(li);
        }

        // گزینه درباره ما
        if (!list.querySelector('[data-about-item]')) {
            const liAbout = document.createElement('li');
            liAbout.setAttribute('data-about-item', '1');
            liAbout.style.cursor = 'pointer';
            liAbout.onclick = () => window.AuthUI.openAboutModal();
            liAbout.innerHTML = `
                <span class="ssb-item-icon"><i class="fas fa-info-circle"></i></span>
                <span class="ssb-item-label">درباره ما</span>
                <i class="fas fa-chevron-left ssb-arrow"></i>
            `;
            list.appendChild(liAbout);
        }

        // گزینه خروج از حساب
        if (!list.querySelector('[data-logout-item]')) {
            const liLogout = document.createElement('li');
            liLogout.setAttribute('data-logout-item', '1');
            liLogout.style.cursor = 'pointer';
            liLogout.style.marginTop = '8px';
            liLogout.style.borderTop = '1px solid var(--border-color, #e2e8f0)';
            liLogout.style.paddingTop = '8px';
            liLogout.onclick = () => window.AuthUI.handleLogout();
            liLogout.innerHTML = `
                <span class="ssb-item-icon" style="color:#ef4444;"><i class="fas fa-sign-out-alt"></i></span>
                <span class="ssb-item-label" style="color:#ef4444;">خروج از حساب</span>
                <i class="fas fa-chevron-left ssb-arrow"></i>
            `;
            list.appendChild(liLogout);
        }
    }

    // =========================================================================
    // ۱۲b. مودال درباره ما
    // =========================================================================
    AuthUI.openAboutModal = function() {
        const old = document.getElementById('about-modal-overlay');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'about-modal-overlay';
        modal.className = 'backup-modal-overlay';
        modal.innerHTML = `
            <div class="backup-modal" style="max-width:480px;">
                <button class="backup-modal-close" onclick="document.getElementById('about-modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
                <div class="backup-modal-icon" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);">
                    <i class="fas fa-store-alt"></i>
                </div>
                <h2 class="backup-modal-title">درباره ما</h2>
                <div id="about-content" style="text-align:right;line-height:2;color:var(--text-main,#334155);font-size:14px;padding:0 4px 8px;">
                    <!--                     <p>سیستم حسابداری «حسابدار» یک دیتابیس حرفه‌ای و هوشمند برای مدیریت کامل فروش، حسابات، صندوق، انبار و ثبت معاملات روزانه می‌باشد که با هدف ساده‌سازی امور مالی و افزایش سرعت مدیریت طراحی شده است.</p>
-->
                    <p> این سیستم امکانات متنوعی مانند فروش فوری، مدیریت مشتریان و طلبات، ثبت هزینه‌ها، مدیریت صندوق، گزارش‌گیری دقیق، کنترل موجودی انبار، ثبت ورود و خروج اجناس و ذخیره‌سازی امن اطلاعات را در اختیار کاربران قرار می‌دهد.</p>
                    <p>هدف ما ارائه یک سیستم قابل اعتماد، سریع و کاربردی برای مدیریت بهتر امور مالی و تجاری شما است.</p>
                </div>
                <button class="backup-close-btn" onclick="document.getElementById('about-modal-overlay').remove()" style="width:100%;margin-top:8px;">بستن</button>
            </div>
        `;
        document.body.appendChild(modal);
    };

    // خروج از حساب — منطق کامل
    AuthUI.handleLogout = function() {
        const modal = document.createElement('div');
        modal.id = 'logout-confirm-overlay';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = `
            <div style="background:#fff;border-radius:18px;padding:36px 32px;max-width:380px;width:90%;box-shadow:0 25px 60px rgba(0,0,0,0.25);text-align:center;font-family:'Vazirmatn',sans-serif;direction:rtl;">
                <div style="width:64px;height:64px;background:#fee2e2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
                    <i class="fas fa-sign-out-alt" style="font-size:28px;color:#ef4444;"></i>
                </div>
                <h3 style="margin:0 0 10px;color:#1e293b;font-size:18px;">خروج از حساب</h3>
                <p style="margin:0 0 24px;color:#64748b;font-size:13px;line-height:1.7;">با خروج، همهٔ اطلاعاتِ حساب و داده‌های این دستگاه پاک می‌شود (فضای ابری دست‌نخورده می‌ماند). دفعهٔ بعد که وارد شوید، اطلاعات‌تان از فضای ابری بازیابی می‌شود. برای اینکه چیزی از دست نرود، پیش از خروج مطمئن شوید آنلاین هستید تا تغییراتِ همگام‌نشده ذخیره شوند.</p>
                <div style="display:flex;gap:12px;">
                    <button onclick="document.getElementById('logout-confirm-overlay').remove()" style="flex:1;padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;color:#334155;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;">انصراف</button>
                    <button onclick="window.AuthUI._confirmLogout()" style="flex:1;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;">بله، خارج شو</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    };

    AuthUI._confirmLogout = function() {
        // بستن مودال تأیید
        const m = document.getElementById('logout-confirm-overlay');
        if (m) m.remove();

        // پاک کردن توکن Drive (نشست گوگل)
        localStorage.removeItem('jouya_gdrive_token');
        localStorage.removeItem('jouya_gdrive_email');
        localStorage.removeItem('jouya_gdrive_name');

        // ✅ «خروج از حساب» = پایانِ نشست، اما دادهٔ محلی/اکانت «حفظ» می‌شود تا ورودِ مجددِ همان
        //    کاربر آفلاین و ماندگار باشد (رفعِ نیازِ اجباری به اینترنت در Login بعدی و ماندگاریِ
        //    Session در Restart). flagِ خروج ست می‌شود تا صفحهٔ ورود نشان داده شود؛ سپس
        //    JouyaAuth.logout() تغییراتِ همگام‌نشده را به ابر flush و نشستِ سینک را می‌بندد بدونِ
        //    پاک‌کردنِ اکانت/داده. نشتِ بین‌کاربری هنگامِ ورودِ کاربرِ «متفاوت» در login()
        //    (resetPrevUserKeepSession) مدیریت می‌شود؛ پس این نگه‌داری امن است.
        AuthDB.logoutSession();

        // نمایش پیام کوتاه
        const msg = document.createElement('div');
        msg.style.cssText = 'position:fixed;inset:0;background:#f1f5f9;z-index:999999;display:flex;align-items:center;justify-content:center;font-family:"Vazirmatn",sans-serif;direction:rtl;';
        msg.innerHTML = '<div style="text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin" style="font-size:32px;margin-bottom:16px;"></i><br>در حال خروج...</div>';
        document.body.appendChild(msg);

        // ✅ خروجِ «کاملِ» امن: ابتدا تغییراتِ همگام‌نشده به ابر flush می‌شود (تا داده گم نشود)،
        //   سپس نشستِ سینک بسته و «همهٔ دادهٔ محلیِ این دستگاه» (اکانت + داده) پاک می‌شود؛ فضای
        //   ابری دست‌نخورده می‌ماند. ورودِ بعدی از فضای ابری Restore می‌کند و اکانتِ جدید هم بدونِ
        //   تداخل با بازمانده‌ها ساخته می‌شود. device_id و ترجیحاتِ دستگاه حفظ می‌شوند.
        var _reloaded = false;
        var _doReload = function () { if (_reloaded) return; _reloaded = true; try { location.reload(); } catch (e) {} };
        try {
            if (window.JouyaAuth && typeof window.JouyaAuth.logout === 'function') {
                Promise.resolve(window.JouyaAuth.logout()).catch(function () {}).then(_doReload);
                setTimeout(_doReload, 8000);   // گاردِ زمان: اگر flush کند بود، بی‌نهایت منتظر نماند
                return;
            }
            // فالبک (اگر auth-cloud نبود): فقط نشستِ سینک را ببند (اکانت/داده حفظ می‌شود)
            if (window.JouyaSync && typeof window.JouyaSync.signOut === 'function') window.JouyaSync.signOut();
        } catch (e) {}
        setTimeout(_doReload, 1000);
    };

    // =========================================================================
    // ۱۳. مودال آپدیت
    // =========================================================================
    AuthUI.openUpdateModal = async function() {
        const old = document.getElementById('update-modal-overlay');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'update-modal-overlay';
        modal.className = 'backup-modal-overlay';
        modal.innerHTML = `
            <div class="backup-modal update-modal">
                <button class="backup-modal-close" onclick="document.getElementById('update-modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
                <div class="backup-modal-icon" style="background:linear-gradient(135deg,#3b82f6,#6366f1);">
                    <i class="fas fa-sync-alt"></i>
                </div>
                <h2 class="backup-modal-title">بروزرسانی برنامه</h2>
                <div id="update-content">
                    <p class="backup-modal-desc">در حال بررسی نسخه جدید...</p>
                    <div class="auth-spinner" style="margin: 20px auto;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        if (!isElectron || !window.electronAPI.checkForUpdates) {
            document.getElementById('update-content').innerHTML = `
                <p class="backup-modal-desc" style="color:#dc2626;">سیستم آپدیت در این نسخه فعال نیست.</p>
                <p style="font-size:12px;color:#64748b;line-height:1.8;">
                    برای فعال‌سازی آپدیت خودکار:<br>
                    ۱. اجرا: <code>npm install electron-updater</code><br>
                    ۲. در فایل package.json تنظیمات publish را وارد کنید<br>
                    ۳. اپلیکیشن را دوباره بیلد کنید
                </p>
            `;
            return;
        }

        try {
            const versionInfo = await window.electronAPI.getAppVersion();
            const result = await window.electronAPI.checkForUpdates();

            if (!result.success) {
                document.getElementById('update-content').innerHTML = `
                    <p class="backup-modal-desc" style="color:#dc2626;">
                        <i class="fas fa-exclamation-triangle"></i>
                        ${escapeHtml(result.error || 'خطا در بررسی آپدیت')}
                    </p>
                    <p style="font-size:12px;color:#64748b;">
                        نسخه فعلی: <strong>${escapeHtml(versionInfo.version)}</strong>
                    </p>
                    <button class="backup-close-btn" onclick="document.getElementById('update-modal-overlay').remove()" style="width:100%;margin-top:16px;">بستن</button>
                `;
                return;
            }

            if (!result.hasUpdate) {
                document.getElementById('update-content').innerHTML = `
                    <div style="text-align:center;padding:20px 0;">
                        <i class="fas fa-check-circle" style="font-size:52px;color:#10b981;margin-bottom:14px;"></i>
                        <h3 style="color:#059669;margin:0 0 10px;">برنامه به‌روز است</h3>
                        <p style="color:#64748b;font-size:13px;margin:0 0 18px;">
                            نسخه فعلی: <strong>${escapeHtml(result.currentVersion || versionInfo.version)}</strong>
                        </p>
                        <button class="backup-close-btn" onclick="document.getElementById('update-modal-overlay').remove()" style="width:100%;">بستن</button>
                    </div>
                `;
                return;
            }

            // نسخه جدید موجود است
            document.getElementById('update-content').innerHTML = `
                <div style="text-align:center;padding:8px 0;">
                    <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;padding:14px;margin:0 0 18px;">
                        <i class="fas fa-bell" style="color:#f59e0b;font-size:24px;margin-bottom:8px;"></i>
                        <h3 style="color:#92400e;margin:0 0 6px;">نسخه جدید موجود است!</h3>
                        <p style="color:#78350f;font-size:13px;margin:0;">
                            نسخه فعلی: <strong>${escapeHtml(result.currentVersion)}</strong><br>
                            نسخه جدید: <strong>${escapeHtml(result.latestVersion)}</strong>
                        </p>
                    </div>

                    <div id="update-progress-wrap" style="display:none;">
                        <div class="backup-progress-bar">
                            <div class="backup-progress-fill" id="update-progress-fill" style="width:0%;"></div>
                        </div>
                        <div class="backup-progress-percent" id="update-progress-pct">۰٪</div>
                        <div class="backup-progress-msg" id="update-progress-msg">در حال دانلود...</div>
                    </div>

                    <div id="update-actions">
                        <button class="backup-start-btn" onclick="window.AuthUI.startUpdateDownload()" style="width:100%;margin-bottom:8px;">
                            <i class="fas fa-download"></i>
                            دانلود و نصب آپدیت
                        </button>
                        <button class="backup-cancel-btn" onclick="document.getElementById('update-modal-overlay').remove()" style="width:100%;">
                            بعداً
                        </button>
                    </div>
                </div>
            `;
        } catch (e) {
            document.getElementById('update-content').innerHTML = `
                <p class="backup-modal-desc" style="color:#dc2626;">خطا: ${escapeHtml(e.message)}</p>
                <button class="backup-close-btn" onclick="document.getElementById('update-modal-overlay').remove()" style="width:100%;">بستن</button>
            `;
        }
    };

    AuthUI.startUpdateDownload = async function() {
        const actions = document.getElementById('update-actions');
        const wrap = document.getElementById('update-progress-wrap');
        if (actions) actions.style.display = 'none';
        if (wrap) wrap.style.display = 'block';

        // listener پیشرفت
        if (window.electronAPI && window.electronAPI.onUpdateDownloadProgress) {
            window.electronAPI.onUpdateDownloadProgress((data) => {
                const fill = document.getElementById('update-progress-fill');
                const pct = document.getElementById('update-progress-pct');
                const msg = document.getElementById('update-progress-msg');
                if (fill) fill.style.width = data.percent + '%';
                if (pct) pct.textContent = toFaNum(data.percent) + '٪';
                if (msg) msg.textContent = `در حال دانلود... ${(data.transferred / 1024 / 1024).toFixed(1)} از ${(data.total / 1024 / 1024).toFixed(1)} مگابایت`;
            });
            window.electronAPI.onUpdateDownloaded(() => {
                const content = document.getElementById('update-content');
                if (content) content.innerHTML = `
                    <div style="text-align:center;padding:14px 0;">
                        <i class="fas fa-check-circle" style="font-size:52px;color:#10b981;margin-bottom:14px;"></i>
                        <h3 style="color:#059669;margin:0 0 10px;">دانلود کامل شد!</h3>
                        <p style="color:#64748b;font-size:13px;margin:0 0 18px;">
                            برای نصب آپدیت، برنامه بازنشانی می‌شود.<br>
                            داده‌های شما حفظ خواهند شد.
                        </p>
                        <button class="backup-start-btn" onclick="window.electronAPI.installUpdate()" style="width:100%;background:linear-gradient(135deg,#059669,#10b981);">
                            <i class="fas fa-redo"></i>
                            نصب و راه‌اندازی مجدد
                        </button>
                    </div>
                `;
            });
            window.electronAPI.onUpdateError((errMsg) => {
                const content = document.getElementById('update-content');
                if (content) content.innerHTML = `
                    <p class="backup-modal-desc" style="color:#dc2626;">
                        <i class="fas fa-exclamation-triangle"></i>
                        خطا در دانلود: ${escapeHtml(errMsg)}
                    </p>
                    <button class="backup-close-btn" onclick="document.getElementById('update-modal-overlay').remove()" style="width:100%;">بستن</button>
                `;
            });
        }

        try {
            await window.electronAPI.downloadUpdate();
        } catch (e) {
            const msg = document.getElementById('update-progress-msg');
            if (msg) { msg.textContent = '✗ خطا: ' + e.message; msg.style.color = '#dc2626'; }
        }
    };

    // =========================================================================
    // ۱۴. Bootstrap
    // =========================================================================
    function bootstrap() {
        const account = AuthDB.getAccount();
        const license = AuthDB.getLicense();
        const loggedOut = AuthDB.isLoggedOut();

        // «متصل به ابر» = کاربری که با Supabase وارد شده و workspace دارد. برای ماندگاریِ Session
        // کافی است حتی اگر license.code محلی موجود نباشد. کاملاً از localStorage خوانده می‌شود
        // (jouya_cloud_linked / jouya_sync_workspace) → آفلاین کار می‌کند و اکانت را دوباره از
        // ابر Load نمی‌کند. logout این نشانه‌ها را پاک و flagِ خروج را ست می‌کند، پس Logout واقعی
        // همچنان صفحهٔ ورود را نشان می‌دهد؛ و تفکیکِ کاربرها هنگامِ ورودِ کاربرِ متفاوت در login()
        // انجام می‌شود (بدونِ تغییرِ آن معماری).
        var cloudLinked = false;
        try { cloudLinked = !!(window.JouyaAuth && typeof window.JouyaAuth.isLinked === 'function' && window.JouyaAuth.isLinked()); } catch (e) {}
        if (!cloudLinked) { try { cloudLinked = !!localStorage.getItem('jouya_cloud_linked') || !!localStorage.getItem('jouya_sync_workspace'); } catch (e) {} }

        // اگر اکانت موجود است، کاربر خارج نشده، و (لیسانسِ معتبر «یا» متصل به ابر) → ورود مستقیم به داشبورد
        if (account && !loggedOut && ((license && license.code) || cloudLinked)) {
            console.log('✅ کاربر فعال:', account.fullName);
            const tryFill = (tries) => {
                populateDashboardUserInfo();
                if (tries > 0) setTimeout(() => tryFill(tries - 1), 500);
            };
            setTimeout(() => tryFill(5), 200);
            setTimeout(setupSidebarBackupHook, 1000);
            setTimeout(setupSidebarUpdateHook, 1000);
            // بک‌آپ خودکار به‌طور کامل غیرفعال شد (طبق درخواست کاربر)
            // setTimeout(setupAutoBackup, 5000);
            return;
        }

        document.body.style.overflow = 'hidden';
        buildAuthScreen();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }

})();

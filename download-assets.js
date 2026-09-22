/**
 * دانلود تمام فایل‌های مورد نیاز برای حالت آفلاین
 * اجرا: node download-assets.js
 * 
 * این اسکریپت تمام کتابخانه‌ها، فونت‌ها و آیکن‌ها را دانلود می‌کند
 * تا اپلیکیشن بدون اینترنت کار کند
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ===== تنظیمات دانلود =====
const assets = [
    // --- jQuery ---
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js',
        dest: 'assets/js/jquery-3.6.0.min.js'
    },

    // --- Chart.js ---
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
        dest: 'assets/js/chart.min.js'
    },

    // --- Persian Date ---
    {
        url: 'https://cdn.jsdelivr.net/npm/persian-date@1.1.0/dist/persian-date.min.js',
        dest: 'assets/js/persian-date.min.js'
    },

    // --- Persian Datepicker ---
    {
        url: 'https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/js/persian-datepicker.min.js',
        dest: 'assets/js/persian-datepicker.min.js'
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/css/persian-datepicker.min.css',
        dest: 'assets/css/persian-datepicker.min.css'
    },

    // --- SheetJS (xlsx) — برای ورود اجناس از اکسل ---
    {
        url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
        dest: 'assets/js/xlsx.full.min.js'
    },

    // --- Font Awesome 6 (Free) ---
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
        dest: 'assets/css/all.min.css'
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2',
        dest: 'assets/webfonts/fa-solid-900.woff2'
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.ttf',
        dest: 'assets/webfonts/fa-solid-900.ttf'
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-regular-400.woff2',
        dest: 'assets/webfonts/fa-regular-400.woff2'
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-regular-400.ttf',
        dest: 'assets/webfonts/fa-regular-400.ttf'
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-brands-400.woff2',
        dest: 'assets/webfonts/fa-brands-400.woff2'
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-brands-400.ttf',
        dest: 'assets/webfonts/fa-brands-400.ttf'
    },

    // --- فونت Vazirmatn ---
    {
        url: 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2',
        dest: 'assets/fonts/Vazirmatn-Regular.woff2'
    },
    {
        url: 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2',
        dest: 'assets/fonts/Vazirmatn-Bold.woff2'
    },
    {
        url: 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2',
        dest: 'assets/fonts/Vazirmatn-Medium.woff2'
    },
    {
        url: 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Light.woff2',
        dest: 'assets/fonts/Vazirmatn-Light.woff2'
    },
    {
        url: 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-SemiBold.woff2',
        dest: 'assets/fonts/Vazirmatn-SemiBold.woff2'
    },
];

// ===== تابع دانلود =====
function download(url, dest) {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(dest);
        fs.mkdirSync(dir, { recursive: true });

        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);

        protocol.get(url, (response) => {
            // ریدایرکت
            if (response.statusCode === 301 || response.statusCode === 302) {
                download(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

// ===== ساخت فایل CSS فونت Vazirmatn =====
function createVazirmatnCSS() {
    const css = `/* Vazirmatn Font - Offline */
@font-face {
    font-family: 'Vazirmatn';
    src: url('Vazirmatn-Light.woff2') format('woff2');
    font-weight: 300;
    font-style: normal;
    font-display: swap;
}
@font-face {
    font-family: 'Vazirmatn';
    src: url('Vazirmatn-Regular.woff2') format('woff2');
    font-weight: 400;
    font-style: normal;
    font-display: swap;
}
@font-face {
    font-family: 'Vazirmatn';
    src: url('Vazirmatn-Medium.woff2') format('woff2');
    font-weight: 500;
    font-style: normal;
    font-display: swap;
}
@font-face {
    font-family: 'Vazirmatn';
    src: url('Vazirmatn-SemiBold.woff2') format('woff2');
    font-weight: 600;
    font-style: normal;
    font-display: swap;
}
@font-face {
    font-family: 'Vazirmatn';
    src: url('Vazirmatn-Bold.woff2') format('woff2');
    font-weight: 700;
    font-style: normal;
    font-display: swap;
}
`;
    fs.mkdirSync('assets/fonts', { recursive: true });
    fs.writeFileSync('assets/fonts/vazirmatn.css', css, 'utf8');
    console.log('  ✅ assets/fonts/vazirmatn.css ساخته شد');
}

// ===== اصلاح مسیر webfonts در Font Awesome CSS =====
function fixFontAwesomePaths() {
    const cssPath = 'assets/css/all.min.css';
    if (!fs.existsSync(cssPath)) return;
    let css = fs.readFileSync(cssPath, 'utf8');
    // مسیر پیش‌فرض Font Awesome: ../webfonts/ → ما هم همین ساختار را داریم
    // اگر مسیر متفاوت باشد اصلاح می‌کنیم
    css = css.replace(/\.\.\/webfonts\//g, '../webfonts/');
    fs.writeFileSync(cssPath, css, 'utf8');
    console.log('  ✅ مسیر فونت‌ها در all.min.css بررسی شد');
}

// ===== ساخت پوشه build و آیکن پیش‌فرض =====
function createBuildFolder() {
    fs.mkdirSync('build', { recursive: true });
    if (!fs.existsSync('build/icon.ico')) {
        console.log('  ⚠️  فایل build/icon.ico وجود ندارد');
        console.log('      لطفاً یک فایل آیکن ico (حداقل 256x256) در پوشه build قرار دهید');
        console.log('      می‌توانید از سایت https://convertico.com استفاده کنید');
    }
    if (!fs.existsSync('assets/icon.png')) {
        console.log('  ⚠️  فایل assets/icon.png وجود ندارد');
        console.log('      لطفاً آیکن برنامه را در assets/icon.png قرار دهید');
    }
}

// ===== اجرای اصلی =====
async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   دانلود فایل‌های آفلاین فروشگاه جویا   ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // ساخت پوشه‌ها
    ['assets/js', 'assets/css', 'assets/fonts', 'assets/webfonts', 'build'].forEach(dir => {
        fs.mkdirSync(dir, { recursive: true });
    });

    let success = 0;
    let failed = 0;

    for (const asset of assets) {
        // اگر فایل از قبل وجود دارد، رد شو
        if (fs.existsSync(asset.dest)) {
            const stat = fs.statSync(asset.dest);
            if (stat.size > 100) {
                console.log(`  ⏭️  ${asset.dest} (از قبل وجود دارد)`);
                success++;
                continue;
            }
        }

        try {
            process.stdout.write(`  ⬇️  ${asset.dest} ... `);
            await download(asset.url, asset.dest);
            console.log('✅');
            success++;
        } catch (err) {
            console.log('❌ ' + err.message);
            failed++;
        }
    }

    // ساخت فایل CSS فونت
    createVazirmatnCSS();

    // اصلاح مسیرها
    fixFontAwesomePaths();

    // بررسی پوشه build
    createBuildFolder();

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log(`  نتیجه: ${success} موفق | ${failed} ناموفق`);
    console.log('═══════════════════════════════════════════');

    if (failed === 0) {
        console.log('');
        console.log('  ✅ همه فایل‌ها دانلود شدند!');
        console.log('');
        console.log('  مراحل بعدی:');
        console.log('  1. npm install');
        console.log('  2. npm start       (تست)');
        console.log('  3. npm run build-win  (ساخت فایل نصبی)');
        console.log('');
    } else {
        console.log('');
        console.log('  ⚠️  برخی فایل‌ها دانلود نشدند.');
        console.log('  دوباره اجرا کنید: node download-assets.js');
        console.log('');
    }
}

main().catch(err => {
    console.error('خطای کلی:', err);
    process.exit(1);
});

/**
 * download-libs.js
 * اسکریپت خودکار برای دانلود کتابخانه‌های آفلاین
 * 
 * اجرا: node download-libs.js
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const LIBS_DIR = path.join(__dirname, 'libs');
const FA_CSS   = path.join(LIBS_DIR, 'fontawesome', 'css');
const FA_WF    = path.join(LIBS_DIR, 'fontawesome', 'webfonts');

// پوشه‌ها را بساز
[LIBS_DIR, FA_CSS, FA_WF].forEach(d => fs.mkdirSync(d, { recursive: true }));

const FILES = [
    {
        url:  'https://code.jquery.com/jquery-3.6.0.min.js',
        dest: path.join(LIBS_DIR, 'jquery.min.js')
    },
    {
        url:  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
        dest: path.join(LIBS_DIR, 'chart.min.js')
    },
    {
        url:  'https://cdn.jsdelivr.net/npm/persian-date@1.1.0/dist/persian-date.min.js',
        dest: path.join(LIBS_DIR, 'persian-date.min.js')
    },
    {
        url:  'https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/js/persian-datepicker.min.js',
        dest: path.join(LIBS_DIR, 'persian-datepicker.min.js')
    },
    {
        url:  'https://cdn.jsdelivr.net/npm/persian-datepicker@1.2.0/dist/css/persian-datepicker.min.css',
        dest: path.join(LIBS_DIR, 'persian-datepicker.min.css')
    },
];

function download(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) {
            console.log(`⏭️  موجود: ${path.basename(dest)}`);
            return resolve();
        }
        const file = fs.createWriteStream(dest);
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            // دنبال redirect برو
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close();
                fs.unlink(dest, () => {});
                return download(res.headers.location, dest).then(resolve).catch(reject);
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`✅ دانلود شد: ${path.basename(dest)}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            console.error(`❌ خطا در دانلود: ${path.basename(dest)} — ${err.message}`);
            reject(err);
        });
    });
}

async function main() {
    console.log('📥 دانلود کتابخانه‌های آفلاین...\n');

    for (const f of FILES) {
        try {
            await download(f.url, f.dest);
        } catch {}
    }

    // Font Awesome را از node_modules کپی کن (اگر نصب شده)
    const faSource = path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free');
    if (fs.existsSync(faSource)) {
        console.log('\n📋 کپی Font Awesome از node_modules...');
        const faCssSrc = path.join(faSource, 'css', 'all.min.css');
        const faWfSrc  = path.join(faSource, 'webfonts');
        if (fs.existsSync(faCssSrc)) {
            fs.copyFileSync(faCssSrc, path.join(FA_CSS, 'all.min.css'));
            console.log('✅ FontAwesome CSS کپی شد');
        }
        if (fs.existsSync(faWfSrc)) {
            fs.readdirSync(faWfSrc).forEach(f => {
                fs.copyFileSync(path.join(faWfSrc, f), path.join(FA_WF, f));
            });
            console.log('✅ FontAwesome webfonts کپی شد');
        }
    } else {
        console.log('\n⚠️  Font Awesome در node_modules نیست.');
        console.log('   دستور زیر را اجرا کنید:');
        console.log('   npm install @fortawesome/fontawesome-free');
        console.log('   سپس دوباره این اسکریپت را اجرا کنید.');
    }

    console.log('\n🎉 تمام! حالا npm start را اجرا کنید.');
}

main();

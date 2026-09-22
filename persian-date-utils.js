/**
 * نسخه ساده شده ابزارهای تاریخ
 * منطق: هر تاریخی که در فورم ثبت می‌شود، باید عیناً در جدول‌ها نمایش داده شود.
 * هیچ تبدیل، پارس، بازیابی، یا اصلاحی روی تاریخ انجام نمی‌شود.
 */

// تبدیل میلادی به شمسی — فقط برای استفاده‌های داخلی (datepicker، پر کردن تاریخ امروز)
function gregorianToJalali(gy, gm, gd) {
    var g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    var gy2 = (gm > 2) ? (gy + 1) : gy;
    var days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
    var jy = -1595 + (33 * Math.floor(days / 12053));
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    var jm, jd;
    if (days < 186) { jm = 1 + Math.floor(days / 31); jd = 1 + (days % 31); }
    else { jm = 7 + Math.floor((days - 186) / 30); jd = 1 + ((days - 186) % 30); }
    return [jy, jm, jd];
}

// تبدیل شمسی به میلادی — فقط برای استفاده‌های داخلی
function jalaliToGregorian(jy, jm, jd) {
    jy += 1595;
    var days = -355668 + (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
    var gy = 400 * Math.floor(days / 146097);
    days %= 146097;
    if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
    gy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    var gd = days + 1;
    var sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    var gm;
    for (gm = 0; gm < 13 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
    return [gy, gm, gd];
}

/**
 * یک Date برمی‌گرداند که getFullYear/Month/Date/Hours/Minutes/Seconds آن
 * معادل ساعت محلی افغانستان/ایران (UTC+4:30) است — بدون نیاز به اینترنت
 */
function _getLocalNow() {
    var n = new Date();
    var localOffset = n.getTimezoneOffset(); // دقیقه (منفی برای شرق UTC)
    // UTC+4:30 = 270 دقیقه — هم‌زمان با افغانستان و ایران تابستان
    return new Date(n.getTime() + (270 + localOffset) * 60 * 1000);
}

// تاریخ شمسی امروز به فرمت YYYY/MM/DD — برای پر کردن خودکار فیلدها
function getTodayJalali() {
    var d = _getLocalNow();
    var j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return j[0] + '/' + String(j[1]).padStart(2, '0') + '/' + String(j[2]).padStart(2, '0');
}

// تاریخ و ساعت شمسی کامل — برای پر کردن خودکار فیلدهای تاریخ‌و‌ساعت
function getJalaliDateTime() {
    var d = _getLocalNow();
    var j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    var h24 = d.getHours();
    var ampm = h24 >= 12 ? 'PM' : 'AM';
    var h12 = h24 % 12; if (h12 === 0) h12 = 12;
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    var dateStr = j[0] + '/' + String(j[1]).padStart(2, '0') + '/' + String(j[2]).padStart(2, '0');
    return dateStr + ' ' + h12 + ':' + mm + ':' + ss + ' ' + ampm;
}

// ===== توابع نمایش تاریخ — pass-through =====
// مقدار را عیناً برمی‌گرداند. هیچ پردازشی انجام نمی‌شود.

function getFullJalaliDateTime(date) {
    if (date === null || date === undefined || String(date).trim() === '') return '-';
    return String(date);
}

function formatJalaliReadable(dateStr) {
    if (dateStr === null || dateStr === undefined || String(dateStr).trim() === '') return '-';
    return String(dateStr);
}

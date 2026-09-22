/* ===========================================================================
 * diagnose-auth.js — تشخیصِ دقیقِ Register/Login روی Supabase واقعی
 * ---------------------------------------------------------------------------
 * این را در Console برنامه (DevTools) کپی/پیست و اجرا کنید. رمز/توکن چاپ نمی‌شود؛
 * فقط status و serverCode. هدف: بفهمیم مشکل «ساختِ کاربر» است یا «تأییدِ ایمیل» یا
 * «رمز/کاربرِ ناموجود».
 *
 * پیش از اجرا، دو مقدار پایین را با ایمیل/رمزی که واقعاً در فرمِ ورود می‌زنید پر کنید.
 * =========================================================================== */
(async function () {
  // 👇 همان ایمیل/رمزی که در برنامه امتحان می‌کنید:
  const REAL_EMAIL = 'jo@gmail.com';
  const REAL_PASS  = 'Afghan@2025';

  const CFG = window.JOUYA_SYNC_CONFIG || {};
  const URL = (CFG.url || '').replace(/\/+$/, '');
  const ANON = CFG.anonKey || '';
  if (!URL || !ANON) { console.error('❌ JOUYA_SYNC_CONFIG پیدا نشد.'); return; }

  // نشستِ به‌جامانده را پاک کن تا در تشخیص دخالت نکند.
  try { localStorage.removeItem('jouya_sync_session'); } catch (e) {}

  // دقیقاً مثلِ تستِ مرورگرِ موفقِ شما: فقط apikey، بدون Authorization.
  async function call(label, path, body) {
    let status = 0, code = '', msg = '', hasToken = false, confirmedAt = 'n/a', extra = '';
    try {
      const res = await fetch(URL + path, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      status = res.status;
      let j = null; try { j = await res.json(); } catch (e) {}
      if (j) {
        code = j.error_code || j.code || j.error || '';
        msg  = j.msg || j.error_description || j.message || '';
        hasToken = !!j.access_token;
        if ('email_confirmed_at' in j) confirmedAt = j.email_confirmed_at ? 'present' : 'null';
        if (j.user && 'email_confirmed_at' in j.user) confirmedAt = j.user.email_confirmed_at ? 'present' : 'null';
        if (Array.isArray(j.identities)) extra = 'identities=' + j.identities.length;
      }
    } catch (e) { msg = 'network: ' + (e && e.message); }
    console.log(
      `%c${label}`, 'font-weight:bold',
      '\n   status:', status,
      '\n   serverCode:', code || '(none)',
      '\n   msg:', msg || '(none)',
      '\n   access_token:', hasToken ? 'YES' : 'no',
      '\n   email_confirmed_at:', confirmedAt,
      extra ? '\n   ' + extra : ''
    );
    return { status, code, hasToken, confirmedAt };
  }

  console.log('%c=== تشخیصِ Auth — Supabase: ' + URL + ' ===', 'color:#2563eb;font-weight:bold');

  // A) ثبت‌نامِ ایمیلِ کاملاً تازه → باید 200 + access_token بدهد. اگر نه، ساختِ کاربر خراب است.
  const fresh = 'diag-' + Date.now() + '@example.com';
  const a = await call('A) signUp ایمیلِ تازه (' + fresh + ')', '/auth/v1/signup', { email: fresh, password: 'test123456' });

  // B) ورود با همان ایمیلِ تازه → اگر 400 با email_not_confirmed بدهد یعنی «تأییدِ ایمیل روشن است».
  const b = await call('B) signIn همان ایمیلِ تازه', '/auth/v1/token?grant_type=password', { email: fresh, password: 'test123456' });

  // C) ورود با ایمیل/رمزِ واقعیِ خودتان → کدِ دقیقِ خطا را نشان می‌دهد.
  const c = await call('C) signIn ایمیل/رمزِ واقعیِ شما (' + REAL_EMAIL + ')', '/auth/v1/token?grant_type=password', { email: REAL_EMAIL, password: REAL_PASS });

  // D) آیا ایمیلِ واقعیِ شما اصلاً در Auth هست؟ signUp دوباره با همان → اگر «already registered» یعنی هست.
  const d = await call('D) signUp دوبارهٔ ایمیلِ واقعیِ شما', '/auth/v1/signup', { email: REAL_EMAIL, password: REAL_PASS });

  // ===== نتیجه‌گیریِ خودکار =====
  console.log('%c=== نتیجه ===', 'color:#16a34a;font-weight:bold');
  if (a.status === 200 && a.hasToken) {
    console.log('✅ ساختِ کاربر سالم است (signUp تازه → 200 + توکن). Confirm-email خاموش است.');
  } else if (a.status === 200 && !a.hasToken && a.confirmedAt === 'null') {
    console.log('⚠️ «Confirm email» در Supabase روشن است → signUp کاربر را می‌سازد ولی توکن/ورود تا تأیید نمی‌دهد. آن را خاموش کنید: Authentication → Providers → Email → Confirm email = OFF.');
  } else if (a.status === 422 || a.code === 'signup_disabled') {
    console.log('⛔ ثبت‌نام در Supabase غیرفعال است: Authentication → Sign In / Providers → Allow new users to sign up = ON.');
  } else {
    console.log('⛔ signUp تازه هم شکست خورد → مشکل سطحِ پروژهٔ Supabase است (status/serverCode بالا را ببینید).');
  }
  if (c.status === 400 && c.code && /not_confirmed/i.test(c.code)) {
    console.log('⚠️ ایمیلِ واقعیِ شما در Auth هست ولی «تأیید نشده» → Confirm email را خاموش کنید و کاربر را در Users تأیید/بازبسازید.');
  } else if (c.status === 400 && d.status !== 200 && /registered|exists/i.test(String(d.code) + String(d.status))) {
    console.log('ℹ️ ایمیلِ واقعیِ شما در Auth «هست» ولی رمزی که می‌زنید با آن نمی‌خواند (400 invalid_credentials). رمز اشتباه است یا قبلاً با رمزِ دیگری ساخته شده.');
  } else if (c.status === 400) {
    console.log('ℹ️ ایمیلِ واقعیِ شما در Auth نیست (یا رمز غلط) → به همین دلیل Login در برنامه 400 می‌دهد. باید از فرمِ «ساخت اکانت جدید» با همین ایمیل ثبت‌نام شود و در Authentication → Users ظاهر گردد.');
  } else if (c.status === 200) {
    console.log('✅ ایمیل/رمزِ واقعیِ شما مستقیماً کار می‌کند → پس مشکل در «مسیرِ Login برنامه» است، نه Supabase. خروجی را بفرستید.');
  }
})();

// ============================================================================
//  حسابدار — ورودِ گوگل با OAuth «Desktop / Loopback» (Tauri / Rust)
//  ---------------------------------------------------------------------------
//  این ماژول عیناً همان منطقی است که در نسخهٔ الکترون (main.js، بخشِ
//  «IPC: OAuth گوگل با روش Desktop») کار می‌کرد:
//    • سرورِ موقت روی 127.0.0.1 با پورتِ تصادفی  → redirect_uri = http://127.0.0.1:<port>/callback
//    • PKCE با S256 + پارامترِ state
//    • access_type=offline و prompt=consent  → Refresh Token بلندمدت
//    • مرورگرِ سیستم (نه WebView) برای صفحهٔ ورود
//    • مهلتِ ۵ دقیقه
//    • تبادلِ code با token، گرفتنِ userinfo، و دستورِ جداگانهٔ refresh
//  خروجی هم دقیقاً همان شکلِ قبلی است: { success, token:{…}, userInfo } تا
//  drive-backup.js بدونِ تغییرِ رفتاری کار کند.
//
//  تفاوتِ امنیتی (الزامِ پروژه): Client Secret هیچ‌وقت به جاوااسکریپت نمی‌رسد.
//  تبادلِ code و رفرش در همین‌جا (Rust) انجام می‌شود. Secret داخلِ سورس نوشته
//  نمی‌شود؛ هنگامِ بیلد از متغیرِ محیطیِ HESABDAR_GOOGLE_CLIENT_SECRET خوانده و
//  داخلِ باینری قرار می‌گیرد (برای توسعه، همین متغیر در زمانِ اجرا هم خوانده می‌شود).
// ============================================================================

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::mpsc;
use std::time::{Duration, Instant};

// ── تنظیمات ───────────────────────────────────────────────────────────────────
// Client ID محرمانه نیست (در آدرسِ ورود هم دیده می‌شود). باید از نوعِ «Desktop app» باشد.
const DEFAULT_CLIENT_ID: &str =
    "67794969596-73upe74lq9dehlb8bc109ec0o220idbu.apps.googleusercontent.com";

const SCOPES: &str = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";

struct Config {
    client_id: String,
    client_secret: String, // ممکن است خالی باشد (مثل الکترون: در این حالت ارسال نمی‌شود)
    scopes: String,
    auth_url: String,
    token_url: String,
    userinfo_url: String,
    timeout: Duration,
}

impl Config {
    fn google() -> Config {
        // اولویت: متغیرِ محیطیِ زمانِ اجرا (برای توسعه) ← مقدارِ زمانِ بیلد ← پیش‌فرض
        let client_id = std::env::var("HESABDAR_GOOGLE_CLIENT_ID")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                option_env!("HESABDAR_GOOGLE_CLIENT_ID")
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or(DEFAULT_CLIENT_ID)
                    .to_string()
            });
        let client_secret = std::env::var("HESABDAR_GOOGLE_CLIENT_SECRET")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                option_env!("HESABDAR_GOOGLE_CLIENT_SECRET")
                    .unwrap_or("")
                    .trim()
                    .to_string()
            });
        Config {
            client_id,
            client_secret,
            scopes: SCOPES.to_string(),
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
            token_url: "https://oauth2.googleapis.com/token".to_string(),
            userinfo_url: "https://www.googleapis.com/oauth2/v2/userinfo".to_string(),
            timeout: Duration::from_secs(5 * 60),
        }
    }
}

// ── شکلِ خروجی (همان شکلِ الکترون) ─────────────────────────────────────────────
#[derive(serde::Serialize, Clone, Debug)]
pub struct TokenInfo {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(rename = "savedAt")]
    pub saved_at: u64,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct AuthResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<TokenInfo>,
    #[serde(rename = "userInfo", skip_serializing_if = "Option::is_none")]
    pub user_info: Option<Value>,
}

impl AuthResult {
    pub fn fail<S: Into<String>>(msg: S) -> AuthResult {
        AuthResult { success: false, error: Some(msg.into()), token: None, user_info: None }
    }
    fn ok(token: TokenInfo, user_info: Option<Value>) -> AuthResult {
        AuthResult { success: true, error: None, token: Some(token), user_info }
    }
}

// ── ابزارهای کوچک: تصادفی، Base64url، PKCE ─────────────────────────────────────
fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).map_err(|e| format!("random: {}", e))?;
    Ok(b)
}

// Base64 «URL-safe» بدونِ padding (همان base64url در Node)
fn b64url(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(T[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(T[(n & 63) as usize] as char);
        }
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn code_challenge(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// ── بازکردنِ مرورگرِ سیستم (معادلِ shell.openExternal) ─────────────────────────
//  روی ویندوز عمداً از «cmd /C start» استفاده نمی‌شود: نویسهٔ & در آدرسِ OAuth برای cmd
//  جداکنندهٔ فرمان است و آدرس را می‌شکند. rundll32 آدرس را مستقیم به ShellExecute می‌دهد.
fn open_system_browser(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("scheme-not-allowed".to_string());
    }
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(url).spawn();
    r.map(|_| ()).map_err(|e| format!("open-browser: {}", e))
}

// ── صفحه‌های HTML که به مرورگر نشان داده می‌شود (همان طرحِ الکترون) ─────────────
const SUCCESS_HTML: &str = r#"<!DOCTYPE html>
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
</html>"#;

const ERROR_HTML: &str = r#"<!DOCTYPE html>
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
<p>__ERROR__</p>
</div>
</body>
</html>"#;

fn write_response(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        status,
        reason,
        body.as_bytes().len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Write);
}

// ── سرورِ موقت: هر اتصال در نخِ خودش (مرورگرها گاهی اتصالِ خالیِ پیش‌گشایی می‌زنند) ──
enum Callback {
    Code(String),
    Error(String),
    Invalid,
}

fn handle_connection(mut stream: TcpStream, state: String, tx: mpsc::Sender<Callback>) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 1024];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16 * 1024 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    if buf.is_empty() {
        return; // اتصالِ خالی
    }

    let text = String::from_utf8_lossy(&buf).to_string();
    let first = text.lines().next().unwrap_or("");
    let target = first.split_whitespace().nth(1).unwrap_or("");
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };

    // مسیرهای دیگر (مثلِ /favicon.ico) → ۴۰۴ و ادامهٔ انتظار (مثلِ الکترون)
    if path != "/callback" {
        write_response(&mut stream, 404, "");
        return;
    }

    let mut code: Option<String> = None;
    let mut returned_state: Option<String> = None;
    let mut error: Option<String> = None;
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => returned_state = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            _ => {}
        }
    }

    if let Some(err) = error {
        let page = ERROR_HTML.replace("__ERROR__", &html_escape(&err));
        write_response(&mut stream, 200, &page);
        let _ = tx.send(Callback::Error(err));
        return;
    }

    match (code, returned_state) {
        (Some(c), Some(s)) if !c.is_empty() && s == state => {
            // پاسخِ موفق به مرورگر، «پیش از» تبادلِ token (همان ترتیبِ الکترون)
            write_response(&mut stream, 200, SUCCESS_HTML);
            let _ = tx.send(Callback::Code(c));
        }
        _ => {
            let page = ERROR_HTML.replace("__ERROR__", "ورود ناموفق بود");
            write_response(&mut stream, 400, &page);
            let _ = tx.send(Callback::Invalid);
        }
    }
}

// ── درخواست‌های HTTPS به گوگل ──────────────────────────────────────────────────
enum PostError {
    Network(String),
    BadResponse,
}

fn post_form(url: &str, fields: &[(&str, &str)]) -> Result<Value, PostError> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .build();
    // گوگل خطاهای OAuth را با کدِ ۴۰۰ و بدنهٔ JSON برمی‌گرداند؛ پس بدنه را در هر دو حالت می‌خوانیم.
    let body = match agent.post(url).send_form(fields) {
        Ok(resp) => resp.into_string().map_err(|e| PostError::Network(e.to_string()))?,
        Err(ureq::Error::Status(_, resp)) => {
            resp.into_string().map_err(|e| PostError::Network(e.to_string()))?
        }
        Err(e) => return Err(PostError::Network(e.to_string())),
    };
    serde_json::from_str::<Value>(&body).map_err(|_| PostError::BadResponse)
}

fn token_from_json(v: &Value, refresh_token: Option<String>, with_scope: bool) -> Option<TokenInfo> {
    let access_token = v.get("access_token")?.as_str()?.to_string();
    Some(TokenInfo {
        access_token,
        refresh_token,
        expires_in: v.get("expires_in").and_then(|x| x.as_u64()).filter(|x| *x > 0).unwrap_or(3600),
        token_type: v
            .get("token_type")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("Bearer")
            .to_string(),
        scope: if with_scope { v.get("scope").and_then(|x| x.as_str()).map(|s| s.to_string()) } else { None },
        saved_at: now_millis(),
    })
}

fn exchange_code(cfg: &Config, code: &str, redirect_uri: &str, verifier: &str) -> AuthResult {
    let mut fields: Vec<(&str, &str)> = vec![("code", code), ("client_id", &cfg.client_id)];
    if !cfg.client_secret.is_empty() {
        fields.push(("client_secret", &cfg.client_secret));
    }
    fields.push(("redirect_uri", redirect_uri));
    fields.push(("grant_type", "authorization_code"));
    fields.push(("code_verifier", verifier));

    let parsed = match post_form(&cfg.token_url, &fields) {
        Ok(v) => v,
        Err(PostError::Network(m)) => return AuthResult::fail(format!("خطای شبکه: {}", m)),
        Err(PostError::BadResponse) => return AuthResult::fail("پاسخ نامعتبر از Google"),
    };

    if let Some(err) = parsed.get("error").and_then(|e| e.as_str()) {
        let mut msg = parsed
            .get("error_description")
            .and_then(|e| e.as_str())
            .unwrap_or(err)
            .to_string();
        // خطای رایج: Client Secret پر نشده / نادرست است
        if err == "invalid_client" || msg.to_lowercase().contains("client_secret") {
            msg = "خطا: client_secret لازم است یا نادرست است.\n\nراه‌حل:\n1. در console.cloud.google.com/apis/credentials روی Client ID (نوعِ Desktop app) بروید\n2. Client Secret را کپی کنید\n3. هنگامِ بیلد آن را در متغیرِ محیطیِ HESABDAR_GOOGLE_CLIENT_SECRET بدهید (نه در کدِ جاوااسکریپت)".to_string();
        }
        return AuthResult::fail(msg);
    }

    let refresh = parsed
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    match token_from_json(&parsed, refresh, true) {
        Some(t) => AuthResult::ok(t, None),
        None => AuthResult::fail("پاسخ نامعتبر از Google"),
    }
}

fn fetch_user_info(cfg: &Config, access_token: &str) -> Value {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .build();
    let r = agent
        .get(&cfg.userinfo_url)
        .set("Authorization", &format!("Bearer {}", access_token))
        .call();
    let body = match r {
        Ok(resp) => resp.into_string().unwrap_or_default(),
        Err(ureq::Error::Status(_, resp)) => resp.into_string().unwrap_or_default(),
        Err(_) => String::new(),
    };
    serde_json::from_str::<Value>(&body).unwrap_or_else(|_| serde_json::json!({}))
}

// ── ورودِ کامل (قابلِ تست: مرورگر از بیرون تزریق می‌شود) ─────────────────────────
fn sign_in_with(cfg: &Config, open_browser: &dyn Fn(&str) -> Result<(), String>) -> AuthResult {
    // سرور روی پورتِ تصادفیِ loopback
    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(l) => l,
        Err(e) => return AuthResult::fail(format!("سرور: {}", e)),
    };
    let port = match listener.local_addr() {
        Ok(a) => a.port(),
        Err(e) => return AuthResult::fail(format!("سرور: {}", e)),
    };
    if let Err(e) = listener.set_nonblocking(true) {
        return AuthResult::fail(format!("سرور: {}", e));
    }
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    let (verifier, state) = match (random_bytes::<32>(), random_bytes::<16>()) {
        (Ok(v), Ok(s)) => (b64url(&v), hex(&s)),
        (Err(e), _) | (_, Err(e)) => return AuthResult::fail(e),
    };
    let challenge = code_challenge(&verifier);

    let auth_url = match url::Url::parse_with_params(
        &cfg.auth_url,
        &[
            ("client_id", cfg.client_id.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", cfg.scopes.as_str()),
            ("state", state.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    ) {
        Ok(u) => u.to_string(),
        Err(e) => return AuthResult::fail(e.to_string()),
    };

    // باز کردنِ مرورگر «بعد از» listen شدنِ سرور
    if let Err(e) = open_browser(&auth_url) {
        return AuthResult::fail(e);
    }

    // انتظار برای callback با مهلت
    let (tx, rx) = mpsc::channel::<Callback>();
    let deadline = Instant::now() + cfg.timeout;
    let cb = loop {
        if Instant::now() >= deadline {
            return AuthResult::fail("زمان ورود به پایان رسید (۵ دقیقه).");
        }
        match listener.accept() {
            Ok((stream, _)) => {
                let st = state.clone();
                let txc = tx.clone();
                std::thread::spawn(move || handle_connection(stream, st, txc));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(e) => return AuthResult::fail(format!("سرور: {}", e)),
        }
        match rx.try_recv() {
            Ok(c) => break c,
            Err(mpsc::TryRecvError::Empty) => std::thread::sleep(Duration::from_millis(50)),
            Err(mpsc::TryRecvError::Disconnected) => {
                return AuthResult::fail("سرور: connection closed");
            }
        }
    };
    drop(listener); // سرور بسته می‌شود

    let code = match cb {
        Callback::Error(e) => return AuthResult::fail(e),
        Callback::Invalid => return AuthResult::fail("پاسخ نامعتبر از Google"),
        Callback::Code(c) => c,
    };

    // تبادلِ code با token (Client Secret فقط اینجا و فقط در Rust)
    let mut result = exchange_code(cfg, &code, &redirect_uri, &verifier);
    if !result.success {
        return result;
    }
    if let Some(t) = result.token.as_ref() {
        result.user_info = Some(fetch_user_info(cfg, &t.access_token));
    }
    result
}

fn refresh_with(cfg: &Config, refresh_token: &str) -> AuthResult {
    let mut fields: Vec<(&str, &str)> = vec![("client_id", &cfg.client_id)];
    if !cfg.client_secret.is_empty() {
        fields.push(("client_secret", &cfg.client_secret));
    }
    fields.push(("refresh_token", refresh_token));
    fields.push(("grant_type", "refresh_token"));

    let parsed = match post_form(&cfg.token_url, &fields) {
        Ok(v) => v,
        Err(PostError::Network(m)) => return AuthResult::fail(m),
        Err(PostError::BadResponse) => return AuthResult::fail("خطا در رفرش توکن"),
    };
    if let Some(err) = parsed.get("error").and_then(|e| e.as_str()) {
        return AuthResult::fail(err);
    }
    // گوگل معمولاً refresh_token جدید نمی‌دهد → همان قبلی حفظ می‌شود (Refresh Token بلندمدت)
    match token_from_json(&parsed, Some(refresh_token.to_string()), false) {
        Some(t) => AuthResult::ok(t, None),
        None => AuthResult::fail("خطا در رفرش توکن"),
    }
}

// ── API عمومیِ ماژول (دستورهای Tauri در main.rs این‌ها را صدا می‌زنند) ──────────
pub fn sign_in() -> AuthResult {
    sign_in_with(&Config::google(), &open_system_browser)
}

pub fn refresh_token(refresh_token: &str) -> AuthResult {
    if refresh_token.trim().is_empty() {
        return AuthResult::fail("refresh_token خالی است");
    }
    refresh_with(&Config::google(), refresh_token)
}

// ════════════════════════════════════════════════════════════════════════════
//  تست‌ها: گوگلِ جعلی (HTTP محلی) + «مرورگرِ» جعلی که به redirect_uri درخواست می‌زند
// ════════════════════════════════════════════════════════════════════════════
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    type Log = Arc<Mutex<Vec<(String, String)>>>; // (خطِ درخواست, بدنه)

    // سرورِ جعلی: handler(method_path, body) → (status, json)
    fn spawn_mock(handler: Arc<dyn Fn(&str, &str) -> (u16, String) + Send + Sync>) -> (u16, Log) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let log: Log = Arc::new(Mutex::new(Vec::new()));
        let log2 = log.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut s = match stream { Ok(s) => s, Err(_) => continue };
                let h = handler.clone();
                let lg = log2.clone();
                std::thread::spawn(move || {
                    let mut data = Vec::new();
                    let mut tmp = [0u8; 4096];
                    let (head_end, content_len) = loop {
                        let n = s.read(&mut tmp).unwrap_or(0);
                        if n == 0 { return; }
                        data.extend_from_slice(&tmp[..n]);
                        if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                            let head = String::from_utf8_lossy(&data[..pos]).to_lowercase();
                            let cl = head.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                            break (pos + 4, cl);
                        }
                    };
                    while data.len() < head_end + content_len {
                        let n = s.read(&mut tmp).unwrap_or(0);
                        if n == 0 { break; }
                        data.extend_from_slice(&tmp[..n]);
                    }
                    let head = String::from_utf8_lossy(&data[..head_end]).to_string();
                    let line = head.lines().next().unwrap_or("").to_string();
                    let body = String::from_utf8_lossy(&data[head_end..]).to_string();
                    lg.lock().unwrap().push((line.clone(), body.clone()));
                    let mp = line.split(" HTTP").next().unwrap_or("").to_string();
                    let (status, resp) = h(&mp, &body);
                    let out = format!("HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", status, resp.len(), resp);
                    let _ = s.write_all(out.as_bytes());
                });
            }
        });
        (port, log)
    }

    fn http_get(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(format!("GET {} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n", path).as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    fn query_of(url_str: &str) -> std::collections::HashMap<String, String> {
        url::Url::parse(url_str).unwrap().query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect()
    }

    fn test_cfg(mock_port: u16, secret: &str, timeout: Duration) -> Config {
        Config {
            client_id: "test-client.apps.googleusercontent.com".into(),
            client_secret: secret.into(),
            scopes: SCOPES.into(),
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: format!("http://127.0.0.1:{}/token", mock_port),
            userinfo_url: format!("http://127.0.0.1:{}/userinfo", mock_port),
            timeout,
        }
    }

    fn google_like() -> Arc<dyn Fn(&str, &str) -> (u16, String) + Send + Sync> {
        Arc::new(|mp, body| {
            if mp.starts_with("POST /token") {
                if body.contains("grant_type=refresh_token") {
                    if body.contains("refresh_token=revoked") {
                        return (400, r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#.into());
                    }
                    return (200, r#"{"access_token":"ya29.REFRESHED","expires_in":3599,"scope":"x","token_type":"Bearer"}"#.into());
                }
                (200, r#"{"access_token":"ya29.ACCESS","expires_in":3599,"refresh_token":"1//LONGLIVED","scope":"s1 s2","token_type":"Bearer"}"#.into())
            } else if mp.starts_with("GET /userinfo") {
                (200, r#"{"email":"a@b.com","name":"Ali"}"#.into())
            } else {
                (404, "{}".into())
            }
        })
    }

    #[test]
    fn pkce_rfc7636_vector() {
        // نمونهٔ رسمیِ ضمیمهٔ B در RFC 7636
        assert_eq!(code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert_eq!(b64url(b""), "");
        assert_eq!(b64url(b"f"), "Zg");
        assert_eq!(b64url(b"fo"), "Zm8");
        assert_eq!(b64url(&[0xfb, 0xff]), "-_8");
        assert_eq!(b64url(&random_bytes::<32>().unwrap()).len(), 43);
    }

    #[test]
    fn full_signin_flow_matches_electron() {
        let (mp, log) = spawn_mock(google_like());
        let cfg = test_cfg(mp, "SECRET-XYZ", Duration::from_secs(20));
        let seen_auth: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let seen2 = seen_auth.clone();
        let browser = move |auth: &str| -> Result<(), String> {
            *seen2.lock().unwrap() = auth.to_string();
            let q = query_of(auth);
            let redirect = url::Url::parse(&q["redirect_uri"]).unwrap();
            let port = redirect.port().unwrap();
            let state = q["state"].clone();
            std::thread::spawn(move || {
                // درخواست‌های اضافه (favicon) نباید جریان را قطع کنند
                let r404 = http_get(port, "/favicon.ico");
                assert!(r404.starts_with("HTTP/1.1 404"));
                let ok = http_get(port, &format!("/callback?code=4%2FABC&state={}", state));
                assert!(ok.starts_with("HTTP/1.1 200"));
                assert!(ok.contains("اتصال با موفقیت برقرار شد"));
            });
            Ok(())
        };
        let res = sign_in_with(&cfg, &browser);
        assert!(res.success, "{:?}", res.error);
        let t = res.token.clone().unwrap();
        assert_eq!(t.access_token, "ya29.ACCESS");
        assert_eq!(t.refresh_token.as_deref(), Some("1//LONGLIVED"));
        assert_eq!(t.expires_in, 3599);
        assert_eq!(t.token_type, "Bearer");
        assert_eq!(t.scope.as_deref(), Some("s1 s2"));
        assert!(t.saved_at > 1_600_000_000_000);
        assert_eq!(res.user_info.as_ref().unwrap()["email"], "a@b.com");

        // پارامترهای آدرسِ ورود دقیقاً مثلِ الکترون
        let auth = seen_auth.lock().unwrap().clone();
        let q = query_of(&auth);
        assert!(auth.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["access_type"], "offline");
        assert_eq!(q["prompt"], "consent");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["scope"], SCOPES);
        assert!(q["redirect_uri"].starts_with("http://127.0.0.1:") && q["redirect_uri"].ends_with("/callback"));
        assert_eq!(q["state"].len(), 32);

        // درخواستِ تبادلِ token
        let entries = log.lock().unwrap().clone();
        let tok = entries.iter().find(|(l, _)| l.starts_with("POST /token")).expect("token req");
        let form: std::collections::HashMap<String, String> = url::form_urlencoded::parse(tok.1.as_bytes()).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        assert_eq!(form["code"], "4/ABC");
        assert_eq!(form["grant_type"], "authorization_code");
        assert_eq!(form["client_secret"], "SECRET-XYZ");
        assert_eq!(form["redirect_uri"], q["redirect_uri"]);
        assert_eq!(code_challenge(&form["code_verifier"]), q["code_challenge"]); // PKCE سازگار
        let ui = entries.iter().find(|(l, _)| l.starts_with("GET /userinfo")).expect("userinfo req");
        assert!(ui.0.contains("/userinfo"));

        // شکلِ JSON که به جاوااسکریپت می‌رسد
        let j = serde_json::to_value(&res).unwrap();
        assert_eq!(j["success"], true);
        assert!(j.get("error").is_none());
        assert_eq!(j["token"]["access_token"], "ya29.ACCESS");
        assert_eq!(j["token"]["refresh_token"], "1//LONGLIVED");
        assert!(j["token"]["savedAt"].is_u64());
        assert_eq!(j["userInfo"]["name"], "Ali");
    }

    #[test]
    fn secret_omitted_when_empty() {
        let (mp, log) = spawn_mock(google_like());
        let cfg = test_cfg(mp, "", Duration::from_secs(20));
        let browser = |auth: &str| -> Result<(), String> {
            let q = query_of(auth);
            let port = url::Url::parse(&q["redirect_uri"]).unwrap().port().unwrap();
            let state = q["state"].clone();
            std::thread::spawn(move || { http_get(port, &format!("/callback?code=c&state={}", state)); });
            Ok(())
        };
        let res = sign_in_with(&cfg, &browser);
        assert!(res.success);
        let entries = log.lock().unwrap().clone();
        let tok = entries.iter().find(|(l, _)| l.starts_with("POST /token")).unwrap();
        assert!(!tok.1.contains("client_secret"));
    }

    #[test]
    fn wrong_state_is_rejected() {
        let (mp, log) = spawn_mock(google_like());
        let cfg = test_cfg(mp, "S", Duration::from_secs(20));
        let browser = |auth: &str| -> Result<(), String> {
            let q = query_of(auth);
            let port = url::Url::parse(&q["redirect_uri"]).unwrap().port().unwrap();
            std::thread::spawn(move || {
                let r = http_get(port, "/callback?code=c&state=EVIL");
                assert!(r.starts_with("HTTP/1.1 400"));
            });
            Ok(())
        };
        let res = sign_in_with(&cfg, &browser);
        assert!(!res.success);
        assert_eq!(res.error.as_deref(), Some("پاسخ نامعتبر از Google"));
        assert!(log.lock().unwrap().iter().all(|(l, _)| !l.starts_with("POST /token"))); // هرگز تبادل نشد
    }

    #[test]
    fn user_denied_and_html_escaped() {
        let (mp, _log) = spawn_mock(google_like());
        let cfg = test_cfg(mp, "S", Duration::from_secs(20));
        let page: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let page2 = page.clone();
        let browser = move |auth: &str| -> Result<(), String> {
            let q = query_of(auth);
            let port = url::Url::parse(&q["redirect_uri"]).unwrap().port().unwrap();
            let page3 = page2.clone();
            std::thread::spawn(move || {
                *page3.lock().unwrap() = http_get(port, "/callback?error=%3Cb%3Eaccess_denied%3C%2Fb%3E");
            });
            Ok(())
        };
        let res = sign_in_with(&cfg, &browser);
        assert!(!res.success);
        assert_eq!(res.error.as_deref(), Some("<b>access_denied</b>"));
        std::thread::sleep(Duration::from_millis(300));
        let p = page.lock().unwrap().clone();
        assert!(p.contains("&lt;b&gt;access_denied&lt;/b&gt;"));
        assert!(!p.contains("<b>access_denied"));
    }

    #[test]
    fn timeout_works() {
        let (mp, _l) = spawn_mock(google_like());
        let cfg = test_cfg(mp, "S", Duration::from_millis(700));
        let t0 = Instant::now();
        let res = sign_in_with(&cfg, &|_u: &str| Ok(()));
        assert!(!res.success);
        assert_eq!(res.error.as_deref(), Some("زمان ورود به پایان رسید (۵ دقیقه)."));
        assert!(t0.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn browser_open_failure_is_reported() {
        let (mp, _l) = spawn_mock(google_like());
        let cfg = test_cfg(mp, "S", Duration::from_secs(5));
        let res = sign_in_with(&cfg, &|_u: &str| Err("open-browser: boom".to_string()));
        assert!(!res.success);
        assert_eq!(res.error.as_deref(), Some("open-browser: boom"));
    }

    #[test]
    fn invalid_client_gives_helpful_message() {
        let (mp, _l) = spawn_mock(Arc::new(|mp, _| {
            if mp.starts_with("POST /token") { (401, r#"{"error":"invalid_client","error_description":"Unauthorized"}"#.into()) } else { (200, "{}".into()) }
        }));
        let cfg = test_cfg(mp, "", Duration::from_secs(20));
        let browser = |auth: &str| -> Result<(), String> {
            let q = query_of(auth);
            let port = url::Url::parse(&q["redirect_uri"]).unwrap().port().unwrap();
            let state = q["state"].clone();
            std::thread::spawn(move || { http_get(port, &format!("/callback?code=c&state={}", state)); });
            Ok(())
        };
        let res = sign_in_with(&cfg, &browser);
        assert!(!res.success);
        assert!(res.error.unwrap().contains("HESABDAR_GOOGLE_CLIENT_SECRET"));
    }

    #[test]
    fn refresh_keeps_long_lived_refresh_token() {
        let (mp, log) = spawn_mock(google_like());
        let cfg = test_cfg(mp, "SECRET-XYZ", Duration::from_secs(5));
        let res = refresh_with(&cfg, "1//LONGLIVED");
        assert!(res.success, "{:?}", res.error);
        let t = res.token.unwrap();
        assert_eq!(t.access_token, "ya29.REFRESHED");
        assert_eq!(t.refresh_token.as_deref(), Some("1//LONGLIVED"));
        assert_eq!(t.expires_in, 3599);
        let body = log.lock().unwrap()[0].1.clone();
        assert!(body.contains("grant_type=refresh_token") && body.contains("client_secret=SECRET-XYZ"));
    }

    #[test]
    fn refresh_revoked_returns_error_code() {
        let (mp, _l) = spawn_mock(google_like());
        let cfg = test_cfg(mp, "S", Duration::from_secs(5));
        let res = refresh_with(&cfg, "revoked");
        assert!(!res.success);
        assert_eq!(res.error.as_deref(), Some("invalid_grant"));
        assert!(refresh_token("  ").error.is_some());
    }
}

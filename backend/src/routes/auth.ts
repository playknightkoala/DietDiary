import { Router } from 'express';
import type { Request } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import svgCaptcha from 'svg-captcha';
import { db, promoteAdminIfConfigured } from '../db.js';
import { JWT_SECRET, PHOTO_COOKIE, PHOTO_COOKIE_OPTS, requireAuth, type Role } from '../middleware/auth.js';
import { authSchema, changePasswordSchema, forgotResetSchema, nicknameSchema, registerSchema, sendCodeSchema, verifyCaptchaSchema, verifyCodeSchema } from '../validation.js';
import { mailerConfigured, sendResetCode, sendVerifyCode } from '../mailer.js';

export const authRouter = Router();

function sign(uid: number, expiresIn: '30d' | '1d' = '30d') {
  return jwt.sign({ uid }, JWT_SECRET, { expiresIn });
}

const CODE_TTL_MS = 10 * 60 * 1000; // 認證碼 10 分鐘有效
const CODE_RESEND_MS = 60 * 1000; // 重寄間隔 60 秒
const CODE_MAX_ATTEMPTS = 5;
const CAPTCHA_TTL_MS = 5 * 60 * 1000; // 圖形驗證碼 5 分鐘有效

// 登入失敗節流：以「帳號＋來源 IP」為鍵，連續失敗達上限即短暫鎖定（記憶體，單機部署足夠；搭配 nginx per-IP 限流）。
// 用 IP 一併當鍵，避免攻擊者對某帳號連打錯誤密碼就把「本人（不同 IP）」也鎖在外（account-lockout DoS）。
const LOGIN_MAX_FAILS = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginFails = new Map<string, { count: number; until: number }>();

// 正式環境經 nginx 反向代理，X-Real-IP 由 nginx 以實際來源覆寫（外部無法偽造）；本機開發退回 socket 位址
function clientIp(req: Request): string {
  const xr = req.headers['x-real-ip'];
  if (typeof xr === 'string' && xr) return xr;
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// 清掉已過期的鎖定紀錄，避免 Map 在長時間運行下無限增長
function pruneLoginFails(now: number) {
  if (loginFails.size < 2000) return;
  for (const [k, v] of loginFails) if (now >= v.until) loginFails.delete(k);
}

authRouter.get('/captcha', (_req, res) => {
  db.prepare('DELETE FROM captchas WHERE expires_at < ?').run(Date.now());
  const cap = svgCaptcha.create({
    size: 4,
    noise: 4,
    width: 150,
    height: 48,
    fontSize: 46,
    ignoreChars: '0Oo1IliQq', // 排除易混淆字元
    color: false,
  });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO captchas (id, text, expires_at) VALUES (?, ?, ?)').run(
    id,
    cap.text.toLowerCase(),
    Date.now() + CAPTCHA_TTL_MS
  );
  return res.json({ id, svg: cap.data });
});

// 確認圖形驗證碼：答錯即作廢（需重新取圖），答對標記 verified 並延長效期供後續寄認證碼使用
authRouter.post('/verify-captcha', (req, res) => {
  const parsed = verifyCaptchaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入圖形驗證碼' });
  const { captchaId, captchaAnswer } = parsed.data;

  const cap = db.prepare('SELECT text, expires_at FROM captchas WHERE id = ?').get(captchaId) as
    | { text: string; expires_at: number }
    | undefined;
  if (!cap || Date.now() > cap.expires_at || cap.text !== captchaAnswer.trim().toLowerCase()) {
    db.prepare('DELETE FROM captchas WHERE id = ?').run(captchaId);
    return res.status(400).json({ error: '圖形驗證碼錯誤或已過期，請重新輸入' });
  }
  db.prepare('UPDATE captchas SET verified = 1, expires_at = ? WHERE id = ?').run(
    Date.now() + CAPTCHA_TTL_MS,
    captchaId
  );
  return res.json({ ok: true });
});

authRouter.post('/send-code', async (req, res) => {
  const parsed = sendCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入正確的 Email 與圖形驗證碼' });
  const { email, captchaId } = parsed.data;

  if (!mailerConfigured()) {
    return res.status(503).json({ error: '系統尚未設定寄信服務，請聯絡管理員' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(email);
  if (exists) return res.status(409).json({ error: '此 Email 已註冊過' });

  // 原子地把驗證碼「認領」給這個 Email：必須已驗證、未過期，且尚未綁定或已綁定同一個 Email。
  // 這是單一 UPDATE（同步、原子），在 await 寄信之前執行，因此並行請求無法用同一張驗證碼寄給不同 Email。
  const claim = db
    .prepare('UPDATE captchas SET email = ? WHERE id = ? AND verified = 1 AND expires_at >= ? AND (email IS NULL OR email = ?)')
    .run(email, captchaId, Date.now(), email);
  if (claim.changes !== 1) {
    return res.status(400).json({ error: '圖形驗證碼已失效或已用於其他 Email，請重新驗證' });
  }

  const issue = await issueEmailCode(email, sendVerifyCode);
  if (issue) return res.status(issue.status).json({ error: issue.error });
  return res.json({ ok: true });
});

// 產生認證碼、原子寫入 email_codes（同一句強制 60 秒節流：寫在 await 之前 → 並行的「同 Email」請求
// 只有第一個成功，其餘 changes=0 直接擋下），再寄信。避免同一地址被並行濫發、或收到多組只有最後一組有效的碼。
// 回傳 null＝成功；否則回傳該回應的 status 與錯誤訊息。註冊與忘記密碼共用（信件內容不同）。
async function issueEmailCode(
  email: string,
  mail: (to: string, code: string) => Promise<void>
): Promise<{ status: number; error: string } | null> {
  const now = Date.now();
  const prev = db.prepare('SELECT sent_at FROM email_codes WHERE email = ?').get(email) as
    | { sent_at: number }
    | undefined;
  if (prev && now - prev.sent_at < CODE_RESEND_MS) {
    const wait = Math.ceil((CODE_RESEND_MS - (now - prev.sent_at)) / 1000);
    return { status: 429, error: `請稍候 ${wait} 秒後再重新寄送` };
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const upsert = db
    .prepare(
      `INSERT INTO email_codes (email, code, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, sent_at = excluded.sent_at, attempts = 0
         WHERE email_codes.sent_at <= ?`
    )
    .run(email, code, now + CODE_TTL_MS, now, now - CODE_RESEND_MS);
  if (upsert.changes !== 1) {
    return { status: 429, error: '寄送太頻繁，請稍候再試' };
  }
  try {
    await mail(email, code);
  } catch (e) {
    console.error('send email code failed:', e);
    // 補償：只在 DB 的碼仍等於這次產生的碼時才刪除，避免清掉另一個較新請求寫入的認證碼
    db.prepare('DELETE FROM email_codes WHERE email = ? AND code = ?').run(email, code);
    return { status: 502, error: '認證信寄送失敗，請確認 Email 是否正確或稍後再試' };
  }
  return null;
}

// ---- 忘記密碼：圖形驗證碼 → 寄重設認證碼 → 驗證後重設密碼 ----
// 寄送重設認證碼。帳號不存在或尚未開通時「靜默回成功」且不寄信、不寫碼——
// 不讓此端點被當成帳號探測工具，也不寄信打擾非會員信箱。
authRouter.post('/forgot/send-code', async (req, res) => {
  const parsed = sendCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入正確的 Email 與圖形驗證碼' });
  const { email, captchaId } = parsed.data;

  if (!mailerConfigured()) {
    return res.status(503).json({ error: '系統尚未設定寄信服務，請聯絡管理員' });
  }

  // 圖形驗證碼認領（與註冊相同的原子規則）；無論帳號是否存在都先消耗，回應行為才一致
  const claim = db
    .prepare('UPDATE captchas SET email = ? WHERE id = ? AND verified = 1 AND expires_at >= ? AND (email IS NULL OR email = ?)')
    .run(email, captchaId, Date.now(), email);
  if (claim.changes !== 1) {
    return res.status(400).json({ error: '圖形驗證碼已失效或已用於其他 Email，請重新驗證' });
  }

  // 只有「已開通」帳號才真的寄（舊帳號可能非小寫，故不分大小寫比對；email 為 ASCII，NOCASE 足夠）
  const user = db.prepare('SELECT id, status FROM users WHERE username = ? COLLATE NOCASE').get(email) as
    | { id: number; status: string }
    | undefined;
  if (!user || user.status !== 'active') return res.json({ ok: true });

  const issue = await issueEmailCode(email, sendResetCode);
  if (issue) return res.status(issue.status).json({ error: issue.error });
  return res.json({ ok: true });
});

// 驗證認證碼並重設密碼（成功即消耗認證碼；認證碼本身只會寄給「已開通帳號」的信箱本人）
authRouter.post('/forgot/reset', async (req, res) => {
  const parsed = forgotResetSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    return res.status(400).json({
      error: msg === '兩次輸入的密碼不一致' ? msg : 'Email、認證碼或新密碼（至少 6 碼）格式不正確',
    });
  }
  const { email, code, newPassword } = parsed.data;

  const row = db
    .prepare('SELECT code, expires_at, attempts FROM email_codes WHERE email = ?')
    .get(email) as { code: string; expires_at: number; attempts: number } | undefined;
  if (!row || Date.now() > row.expires_at) {
    return res.status(400).json({ error: '認證碼已過期或尚未寄送，請重新取得認證碼' });
  }
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
    return res.status(400).json({ error: '認證碼錯誤次數過多，請重新取得認證碼' });
  }
  if (row.code !== code) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
    return res.status(400).json({ error: '認證碼錯誤' });
  }

  const user = db.prepare('SELECT id, status FROM users WHERE username = ? COLLATE NOCASE').get(email) as
    | { id: number; status: string }
    | undefined;
  // 理論上不會發生（未開通／不存在的帳號根本不會寄出認證碼），保險再擋一次
  if (!user || user.status !== 'active') {
    return res.status(400).json({ error: '認證碼已過期或尚未寄送，請重新取得認證碼' });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
  return res.json({ ok: true });
});

// 確認 Email 認證碼是否正確（不消耗、不建立帳號）；供註冊前先驗證，正確後才開放「完成註冊」
authRouter.post('/verify-code', (req, res) => {
  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入正確的 Email 與 6 位數認證碼' });
  const { email, code } = parsed.data;

  const row = db
    .prepare('SELECT code, expires_at, attempts FROM email_codes WHERE email = ?')
    .get(email) as { code: string; expires_at: number; attempts: number } | undefined;
  if (!row || Date.now() > row.expires_at) {
    return res.status(400).json({ error: '認證碼已過期或尚未寄送，請重新取得認證碼' });
  }
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
    return res.status(400).json({ error: '認證碼錯誤次數過多，請重新取得認證碼' });
  }
  if (row.code !== code) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
    return res.status(400).json({ error: '認證碼錯誤' });
  }
  return res.json({ ok: true });
});

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    return res.status(400).json({
      error: msg === '兩次輸入的密碼不一致' ? msg : 'Email、密碼（至少 6 碼）或認證碼格式不正確',
    });
  }
  const { username, password, code } = parsed.data;

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: '此 Email 已註冊過' });

  const row = db
    .prepare('SELECT code, expires_at, attempts FROM email_codes WHERE email = ?')
    .get(username) as { code: string; expires_at: number; attempts: number } | undefined;
  if (!row || Date.now() > row.expires_at) {
    return res.status(400).json({ error: '認證碼已過期或尚未寄送，請重新取得認證碼' });
  }
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM email_codes WHERE email = ?').run(username);
    return res.status(400).json({ error: '認證碼錯誤次數過多，請重新取得認證碼' });
  }
  if (row.code !== code) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?').run(username);
    return res.status(400).json({ error: '認證碼錯誤' });
  }

  const hash = await bcrypt.hash(password, 10);
  // 開通改由管理者後台操作，不再寄送開通連結信
  db.prepare(`INSERT INTO users (username, password_hash, status) VALUES (?, ?, 'pending')`).run(username, hash);
  db.prepare('DELETE FROM email_codes WHERE email = ?').run(username);
  promoteAdminIfConfigured(username);

  return res.status(201).json({
    pending: true,
    message: '註冊成功！已通知管理員審核，帳號開通後即可登入。',
  });
});

authRouter.post('/login', async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '帳號或密碼格式不正確' });
  const { username, password, remember } = parsed.data;
  const throttleKey = `${username.trim().toLowerCase()}|${clientIp(req)}`;
  const now = Date.now();
  const fail = loginFails.get(throttleKey);
  if (fail && fail.count >= LOGIN_MAX_FAILS && now < fail.until) {
    const wait = Math.ceil((fail.until - now) / 60000);
    return res.status(429).json({ error: `登入失敗次數過多，請於約 ${wait} 分鐘後再試` });
  }
  const findUser = db.prepare('SELECT id, username, password_hash, status, role FROM users WHERE username = ?');
  type UserRow = { id: number; username: string; password_hash: string; status: string; role: Role };
  // 新帳號以小寫 email 儲存；舊帳號維持原樣，先精確比對再退回小寫
  let user = (findUser.get(username) ?? findUser.get(username.toLowerCase())) as UserRow | undefined;
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    const count = (fail && now < fail.until ? fail.count : 0) + 1;
    loginFails.set(throttleKey, { count, until: now + LOGIN_LOCK_MS });
    pruneLoginFails(now);
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  loginFails.delete(throttleKey); // 登入成功即清除失敗計數
  // ADMIN_EMAIL 對應帳號登入時自動升為管理者（環境變數事後設定也生效）
  promoteAdminIfConfigured(user.username);
  user = findUser.get(user.username) as UserRow;
  if (user.status !== 'active') {
    return res.status(403).json({ error: '帳號尚未開通，請等待管理員審核' });
  }
  const token = sign(user.id, remember ? '30d' : '1d');
  // 照片存取 cookie（/uploads 需驗證，<img> 無法帶 header）：內容即同一顆 JWT，實際效期由 JWT 本身決定
  res.cookie(PHOTO_COOKIE, token, { ...PHOTO_COOKIE_OPTS, maxAge: (remember ? 30 : 1) * 24 * 60 * 60 * 1000 });
  return res.json({ token, username: user.username, role: user.role });
});

// 補發照片存取 cookie：升級前已登入的 session 沒有 cookie（照片會 401），前端啟動時呼叫一次補上。
// 直接沿用 header 帶來的 token 當 cookie 值，不另簽新 token（不延長既有登入的效期）
authRouter.post('/photo-cookie', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  res.cookie(PHOTO_COOKIE, token, { ...PHOTO_COOKIE_OPTS, maxAge: 30 * 24 * 60 * 60 * 1000 });
  return res.status(204).end();
});

// 登出：清掉照片存取 cookie（token 本身無狀態、由前端丟棄）
authRouter.post('/logout', (_req, res) => {
  res.clearCookie(PHOTO_COOKIE, PHOTO_COOKIE_OPTS);
  return res.status(204).end();
});

// 會員中心：目前登入者資訊
authRouter.get('/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT username, role, status, nickname, ai_enabled, ui_layout, created_at FROM users WHERE id = ?')
    .get(req.userId) as
    | { username: string; role: Role; status: string; nickname: string; ai_enabled: number; ui_layout: string; created_at: string }
    | undefined;
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'unauthorized' });
  return res.json({
    username: user.username,
    role: user.role,
    nickname: user.nickname,
    aiEnabled: !!user.ai_enabled,
    // 介面自定義（JSON 字串，''＝未設定）：前端解析並清洗
    uiLayout: user.ui_layout,
    createdAt: user.created_at,
  });
});

// 設定／變更自己的暱稱（1～20 字）
authRouter.post('/nickname', requireAuth, (req, res) => {
  const parsed = nicknameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入 1～20 字的暱稱' });
  db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(parsed.data.nickname, req.userId);
  return res.json({ ok: true, nickname: parsed.data.nickname });
});

// 會員中心：變更密碼
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    return res.status(400).json({
      error: msg === '兩次輸入的密碼不一致' ? msg : '請輸入目前密碼與至少 6 碼的新密碼',
    });
  }
  const { oldPassword, newPassword } = parsed.data;
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.userId) as
    | { password_hash: string }
    | undefined;
  if (!user || !(await bcrypt.compare(oldPassword, user.password_hash))) {
    return res.status(400).json({ error: '目前密碼不正確' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.userId);
  return res.json({ ok: true });
});

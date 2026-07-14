import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import svgCaptcha from 'svg-captcha';
import { db, promoteAdminIfConfigured } from '../db.js';
import { JWT_SECRET, requireAuth, type Role } from '../middleware/auth.js';
import { authSchema, changePasswordSchema, nicknameSchema, registerSchema, sendCodeSchema, verifyCaptchaSchema } from '../validation.js';
import { mailerConfigured, sendVerifyCode } from '../mailer.js';

export const authRouter = Router();

function sign(uid: number, expiresIn: '30d' | '1d' = '30d') {
  return jwt.sign({ uid }, JWT_SECRET, { expiresIn });
}

const CODE_TTL_MS = 10 * 60 * 1000; // 認證碼 10 分鐘有效
const CODE_RESEND_MS = 60 * 1000; // 重寄間隔 60 秒
const CODE_MAX_ATTEMPTS = 5;
const CAPTCHA_TTL_MS = 5 * 60 * 1000; // 圖形驗證碼 5 分鐘有效

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

  const cap = db
    .prepare('SELECT expires_at, verified FROM captchas WHERE id = ?')
    .get(captchaId) as { expires_at: number; verified: number } | undefined;
  if (!cap || !cap.verified || Date.now() > cap.expires_at) {
    db.prepare('DELETE FROM captchas WHERE id = ?').run(captchaId);
    return res.status(400).json({ error: '圖形驗證碼已失效，請重新驗證' });
  }

  if (!mailerConfigured()) {
    return res.status(503).json({ error: '系統尚未設定寄信服務，請聯絡管理員' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(email);
  if (exists) return res.status(409).json({ error: '此 Email 已註冊過' });

  const prev = db.prepare('SELECT sent_at FROM email_codes WHERE email = ?').get(email) as
    | { sent_at: number }
    | undefined;
  const now = Date.now();
  if (prev && now - prev.sent_at < CODE_RESEND_MS) {
    const wait = Math.ceil((CODE_RESEND_MS - (now - prev.sent_at)) / 1000);
    return res.status(429).json({ error: `請稍候 ${wait} 秒後再重新寄送` });
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  try {
    await sendVerifyCode(email, code);
  } catch (e) {
    console.error('send-code mail failed:', e);
    return res.status(502).json({ error: '認證信寄送失敗，請確認 Email 是否正確或稍後再試' });
  }
  db.prepare(
    `INSERT INTO email_codes (email, code, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, sent_at = excluded.sent_at, attempts = 0`
  ).run(email, code, now + CODE_TTL_MS, now);
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
  const findUser = db.prepare('SELECT id, username, password_hash, status, role FROM users WHERE username = ?');
  type UserRow = { id: number; username: string; password_hash: string; status: string; role: Role };
  // 新帳號以小寫 email 儲存；舊帳號維持原樣，先精確比對再退回小寫
  let user = (findUser.get(username) ?? findUser.get(username.toLowerCase())) as UserRow | undefined;
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  // ADMIN_EMAIL 對應帳號登入時自動升為管理者（環境變數事後設定也生效）
  promoteAdminIfConfigured(user.username);
  user = findUser.get(user.username) as UserRow;
  if (user.status !== 'active') {
    return res.status(403).json({ error: '帳號尚未開通，請等待管理員審核' });
  }
  return res.json({ token: sign(user.id, remember ? '30d' : '1d'), username: user.username, role: user.role });
});

// 會員中心：目前登入者資訊
authRouter.get('/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT username, role, status, nickname, created_at FROM users WHERE id = ?')
    .get(req.userId) as { username: string; role: Role; status: string; nickname: string; created_at: string } | undefined;
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'unauthorized' });
  return res.json({ username: user.username, role: user.role, nickname: user.nickname, createdAt: user.created_at });
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

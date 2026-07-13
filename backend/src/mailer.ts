import nodemailer from 'nodemailer';

// Gmail SMTP：SMTP_USER 填 Gmail 帳號，SMTP_PASS 填「應用程式密碼」（Google 帳戶 → 安全性 → 兩步驟驗證 → 應用程式密碼）
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
// 產生管理員開通連結時使用的對外網址（例如 http://your-host:8080）
export const APP_URL = (process.env.APP_URL || 'http://localhost:8080').replace(/\/+$/, '');

export function mailerConfigured() {
  return Boolean(SMTP_USER && SMTP_PASS);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

export async function sendMail(to: string, subject: string, html: string) {
  if (!mailerConfigured()) {
    throw new Error('SMTP 尚未設定（SMTP_USER / SMTP_PASS）');
  }
  await transporter.sendMail({ from: `均衡日記 <${SMTP_FROM}>`, to, subject, html });
}

export function sendVerifyCode(to: string, code: string) {
  return sendMail(
    to,
    '【均衡日記】註冊認證碼',
    `<div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#4A7C59">均衡日記 註冊認證碼</h2>
      <p>您的認證碼為：</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#2D3B2D">${code}</div>
      <p style="color:#6B7565">認證碼 10 分鐘內有效。若非您本人操作，請忽略此信。</p>
    </div>`
  );
}

export function sendAdminApprovalRequest(newUser: string, token: string) {
  const link = `${APP_URL}/api/auth/approve/${token}`;
  return sendMail(
    ADMIN_EMAIL,
    `【均衡日記】新帳號待審核：${newUser}`,
    `<div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#4A7C59">新帳號註冊申請</h2>
      <p>使用者 <b>${newUser}</b> 已完成註冊，等待您開通。</p>
      <p><a href="${link}" style="display:inline-block;background:#4A7C59;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">點此開通帳號</a></p>
      <p style="color:#6B7565">或複製連結：${link}</p>
    </div>`
  );
}

export function sendAccountApproved(to: string) {
  return sendMail(
    to,
    '【均衡日記】帳號已開通',
    `<div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#4A7C59">帳號已開通</h2>
      <p>您的均衡日記帳號已由管理員開通，現在可以登入使用了。</p>
      <p><a href="${APP_URL}" style="color:#4A7C59;font-weight:700">前往登入</a></p>
    </div>`
  );
}

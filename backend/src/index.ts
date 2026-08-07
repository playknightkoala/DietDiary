// 必須是第一個 import：db.ts / auth.ts 在模組載入時就讀環境變數（DB_PATH、JWT_SECRET…），
// 本機開發（tsx 不會自動載 .env）靠這行讀 backend/.env；Docker 由 compose 注入、檔案不存在時靜默略過
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { daysRouter } from './routes/days.js';
import { entriesRouter, UPLOAD_DIR } from './routes/entries.js';
import { goalsRouter } from './routes/goals.js';
import { trendRouter } from './routes/trend.js';
import { adminRouter } from './routes/admin.js';
import { proRouter } from './routes/pro.js';
import { commentsRouter } from './routes/comments.js';
import { notificationsRouter } from './routes/notifications.js';
import { aiRouter } from './routes/ai.js';
import { profileRouter } from './routes/profile.js';
import { photoAuth } from './middleware/auth.js';
import { APP_VERSION } from './version.js';

const app = express();
// 正常運作時前端與 API 同源（prod 經 nginx、dev 經 Vite proxy），本不觸發 CORS；
// 這裡收斂允許來源，避免其他網站直接以瀏覽器跨源呼叫 API。APP_URL 為對外網址，另放行本機開發埠。
const ALLOWED_ORIGINS = [
  process.env.APP_URL || 'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:8080',
];
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// 目前部署的版號；前端輪詢比對，較舊者會被要求更新
app.get('/api/version', (_req, res) => res.json({ version: APP_VERSION }));
app.use('/api/auth', authRouter);
app.use('/api/days', daysRouter);
app.use('/api/entries', entriesRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/body-trend', trendRouter);
app.use('/api/admin', adminRouter);
app.use('/api/pro', proRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/profile', profileRouter);
// 照片需登入才能看（cookie 驗證＋擁有者檢查，見 middleware/auth.photoAuth）；
// Cache-Control 改 private：允許瀏覽器快取、禁止中間代理快取已驗證的內容
app.use(
  '/uploads',
  photoAuth,
  express.static(UPLOAD_DIR, {
    maxAge: '30d',
    immutable: true,
    setHeaders: (res) => res.setHeader('Cache-Control', 'private, max-age=2592000, immutable'),
  })
);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => console.log(`dietdiary backend listening on :${PORT}`));

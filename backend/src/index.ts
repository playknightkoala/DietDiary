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
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => console.log(`dietdiary backend listening on :${PORT}`));

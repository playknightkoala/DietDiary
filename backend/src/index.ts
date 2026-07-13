import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { daysRouter } from './routes/days.js';
import { entriesRouter, UPLOAD_DIR } from './routes/entries.js';
import { goalsRouter } from './routes/goals.js';
import { trendRouter } from './routes/trend.js';
import { adminRouter } from './routes/admin.js';
import { proRouter } from './routes/pro.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/days', daysRouter);
app.use('/api/entries', entriesRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/body-trend', trendRouter);
app.use('/api/admin', adminRouter);
app.use('/api/pro', proRouter);
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => console.log(`dietdiary backend listening on :${PORT}`));

// AI 評價（讚／倒讚）與知識庫種庫。拆自原 routes/ai.ts；掛在 requireAI 之前（見 routes/ai.ts）。
import { Router } from 'express';
import { db } from '../../db.js';
import { aiFeedbackSchema } from '../../validation.js';
import { currentAiBody, emptyFood, parseFood, parseItems, parsePhotoFoods, parsePhotos, setAiFeedback } from '../../helpers.js';
import { kbUpsert, kbVote } from '../../kb.js';
import { kbActive } from '../../llm.js';

export const feedbackRouter = Router();

// ---- AI 評價（讚／倒讚）----
// 只需登入即可記錄（不經 requireAI，gateway 暫時故障也能投票）；投票以本人身分儲存。
feedbackRouter.post('/feedback', (req, res) => {
  const parsed = aiFeedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { kind, ref, vote, body: clientBody, dishId } = parsed.data;
  // comment/daily：後端擷取當下內容快照；ocr_*：OCR 結果未持久化，用前端帶來的快照
  const isOcr = kind === 'ocr_caption' || kind === 'ocr_food';
  const body = vote === 0 ? '' : isOcr ? (clientBody ?? '').slice(0, 500) : currentAiBody(req.userId, kind, ref);
  setAiFeedback(req.userId, kind, ref, vote, body);
  // 份數評價若對應到知識庫某道菜，累計該菜的全體讚/倒讚。
  // kbVote 以（user, dish）為單位記票並按差額調整，重送／改票／取消都不會灌票
  if (kind === 'ocr_food' && dishId) kbVote(req.userId, dishId, vote);
  return res.json({ vote });
});

// ---- 知識庫種庫（管理者）：把既有「已存檔且有敘述＋照片」的紀錄灌進共用知識庫 ----
feedbackRouter.post('/kb/seed', async (req, res) => {
  const u = db.prepare('SELECT role, status FROM users WHERE id = ?').get(req.userId) as { role: string; status: string } | undefined;
  if (!u || u.status !== 'active' || u.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  if (!kbActive()) return res.status(400).json({ error: '知識庫未啟用（需設定 AI_KB_ENABLED 與 AI_EMBED_URL）' });
  const limit = Math.min(3000, Math.max(1, Number(req.body?.limit) || 500));
  const rows = db
    .prepare("SELECT desc, photos, food, photo_foods, items FROM entries WHERE desc != '' AND photos != '[]' ORDER BY id DESC LIMIT ?")
    .all(limit) as { desc: string; photos: string; food: string; photo_foods: string; items: string }[];
  let seeded = 0, skipped = 0;
  for (const r of rows) {
    const photos = parsePhotos(r.photos);
    if (!photos.length || !r.desc.trim()) { skipped++; continue; }
    // 只餵第一張照片「自己的」份數（與存檔路徑同規則）：整筆 food 是所有照片＋無照片項目的總和，
    // 直接掛到首圖會污染該道菜的社群共識。legacy 紀錄（無逐張份數、無 items）整筆份數視為記在第一張。
    const pf = parsePhotoFoods(r.photo_foods);
    const anyPerPhoto = photos.some((u) => Object.values(pf[u] ?? {}).some((v) => v > 0));
    const own = pf[photos[0]];
    const firstFood =
      own && Object.values(own).some((v) => v > 0)
        ? own
        : !anyPerPhoto && !parseItems(r.items ?? '[]').length
          ? parseFood(r.food)
          : null;
    if (!firstFood || !Object.values(firstFood).some((v) => v > 0)) { skipped++; continue; }
    try {
      await kbUpsert(r.desc, { ...emptyFood(), ...firstFood }, photos[0]);
      seeded++;
    } catch {
      skipped++;
    }
  }
  return res.json({ seeded, skipped, scanned: rows.length });
});

import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { MAX_PHOTOS, copyPhotoSchema, entryPatchSchema } from '../validation.js';
import { UPLOAD_DIR, deletePhotoRatings, entryHasData, entryToJson, entryToJsonWithRatings, getEntryHistory, notifyFollowers, parseFood, parsePhotoFoods, parsePhotos, stripJpegExif, sumFoods, unlinkPhoto, type EntryRow } from '../helpers.js';
import { kbActive } from '../llm.js';
import { kbUpsert } from '../kb.js';

export { UPLOAD_DIR };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: MAX_PHOTOS },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === 'image/jpeg');
  },
});

export const entriesRouter = Router();
entriesRouter.use(requireAuth);

function getOwnedEntry(userId: number, id: string | number) {
  return db
    .prepare('SELECT id, meal, desc, photos, eat_time, food, photo_foods, food_edited_at FROM entries WHERE id = ? AND user_id = ?')
    .get(id, userId) as EntryRow | undefined;
}

// 最近記過份數的照片（新→舊），供「從歷史加入」；exclude 排除目前編輯中的紀錄
entriesRouter.get('/history', (req, res) => {
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 30));
  const exclude = req.query.exclude ? Number(req.query.exclude) : undefined;
  return res.json(getEntryHistory(req.userId, limit, exclude));
});

// 從歷史加入：把自己既有的一張照片複製成新檔案，加進目前這筆紀錄（份數由前端於完成時寫入）
entriesRouter.post('/:id/photos/copy', (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  const parsed = copyPhotoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const src = parsed.data.photo;
  if (!src.startsWith('/uploads/')) return res.status(400).json({ error: 'invalid photo' });
  // 只能複製屬於自己的照片
  const owns = db
    .prepare('SELECT 1 FROM entries e, json_each(e.photos) je WHERE e.user_id = ? AND je.value = ? LIMIT 1')
    .get(req.userId, src);
  if (!owns) return res.status(404).json({ error: 'photo not found' });

  const current = parsePhotos(entry.photos);
  if (current.length >= MAX_PHOTOS) return res.status(400).json({ error: `每筆紀錄最多 ${MAX_PHOTOS} 張照片` });
  const srcPath = path.join(UPLOAD_DIR, path.basename(src));
  if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'photo file missing' });

  const filename = `e${entry.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}-copy.jpg`;
  fs.copyFileSync(srcPath, path.join(UPLOAD_DIR, filename));
  const newUrl = `/uploads/${filename}`;
  const photos = [...current, newUrl];
  db.prepare('UPDATE entries SET photos = ? WHERE id = ?').run(JSON.stringify(photos), entry.id);
  // 空白紀錄因加入照片而有內容＝發布新貼文
  if (!entryHasData(entryToJson(entry))) notifyFollowers(req.userId, `entry:${entry.id}`);
  return res.json({ photos, photo: newUrl });
});

entriesRouter.patch('/:id', (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  const parsed = entryPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { desc, food, photoFoods, photos, date, eatTime } = parsed.data;

  const sets: string[] = [];
  const args: string[] = [];
  if (desc !== undefined) { sets.push('desc = ?'); args.push(desc); }
  if (date !== undefined) { sets.push('date = ?'); args.push(date); } // 改用餐日期＝把這筆紀錄移到該天
  if (eatTime !== undefined) { sets.push('eat_time = ?'); args.push(eatTime); }

  // 照片保留清單（PATCH 只能刪除，新增走 /photos 上傳）
  let finalPhotos = parsePhotos(entry.photos);
  let removedPhotos: string[] = [];
  if (photos !== undefined) {
    const keep = finalPhotos.filter((p) => photos.includes(p));
    removedPhotos = finalPhotos.filter((p) => !keep.includes(p));
    sets.push('photos = ?');
    args.push(JSON.stringify(keep));
    finalPhotos = keep;
  }

  if (photoFoods !== undefined) {
    // 逐張照片份數：只保留現有照片的項目，food 欄位改存總和
    const filtered = Object.fromEntries(Object.entries(photoFoods).filter(([url]) => finalPhotos.includes(url)));
    const total = sumFoods(Object.values(filtered));
    sets.push('photo_foods = ?', 'food = ?');
    args.push(JSON.stringify(filtered), JSON.stringify(total));
    // 會員自行改動份數後，「營養師調整」標記即不再成立（份數沒變則保留）
    if (JSON.stringify(parsePhotoFoods(entry.photo_foods)) !== JSON.stringify(filtered)) {
      sets.push('food_edited_at = 0');
    }
  } else if (food !== undefined) {
    sets.push('food = ?');
    args.push(JSON.stringify(food));
    if (JSON.stringify(parseFood(entry.food)) !== JSON.stringify(food)) {
      sets.push('food_edited_at = 0');
    }
  } else if (photos !== undefined) {
    // 只刪照片：一併清掉該照片的份數並重算總和（原本就有逐張份數才需要）
    const stored = parsePhotoFoods(entry.photo_foods);
    if (Object.keys(stored).length) {
      const pruned = Object.fromEntries(Object.entries(stored).filter(([url]) => finalPhotos.includes(url)));
      sets.push('photo_foods = ?', 'food = ?');
      args.push(JSON.stringify(pruned), JSON.stringify(sumFoods(Object.values(pruned))));
    }
  }

  if (sets.length) {
    db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).run(...args, entry.id);
  }
  // DB 更新成功後才刪實體檔案與評分：避免更新失敗卻已把檔案刪掉、留下指向不存在照片的紀錄
  if (removedPhotos.length) {
    deletePhotoRatings(entry.id, removedPhotos);
    removedPhotos.forEach(unlinkPhoto);
  }
  const updated = getOwnedEntry(req.userId, req.params.id)!;
  // 紀錄第一次從空白變成有內容＝發布新貼文，通知追蹤這位會員的營養師
  if (!entryHasData(entryToJson(entry)) && entryHasData(entryToJson(updated))) {
    notifyFollowers(req.userId, `entry:${entry.id}`);
  }
  // 學進共用知識庫（開關開啟時）：有敘述＋照片＋份數的已確認紀錄。fire-and-forget，不影響存檔回應。
  if (kbActive()) {
    const u = entryToJson(updated);
    if (u.desc.trim() && u.photos.length && Object.values(u.food).some((v) => v > 0)) {
      void kbUpsert(u.desc, u.food, u.photos[0]).catch(() => {});
    }
  }
  return res.json(entryToJsonWithRatings(updated, req.userId));
});

entriesRouter.delete('/:id', (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  const photos = parsePhotos(entry.photos);
  // 一次交易刪除評分／留言／紀錄：避免中途失敗留下孤兒 metadata
  db.transaction(() => {
    deletePhotoRatings(entry.id);
    db.prepare('DELETE FROM entry_comments WHERE user_id = ? AND target = ?').run(req.userId, `entry:${entry.id}`);
    db.prepare('DELETE FROM entries WHERE id = ?').run(entry.id);
  })();
  // DB 已刪除後才刪實體檔案：即使 unlink 失敗也只是留下孤兒檔，不會有指向已刪紀錄的照片
  photos.forEach(unlinkPhoto);
  return res.status(204).end();
});

// 一次可上傳多張（合計上限 MAX_PHOTOS 張／筆）
entriesRouter.post('/:id/photos', upload.array('photos', MAX_PHOTOS), (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ error: 'photo files required (jpeg)' });

  const current = parsePhotos(entry.photos);
  if (current.length + files.length > MAX_PHOTOS) {
    return res.status(400).json({ error: `每筆紀錄最多 ${MAX_PHOTOS} 張照片` });
  }
  const urls = files.map((file, i) => {
    // 加隨機後綴：避免同一毫秒的並行上傳產生相同檔名而互相覆蓋
    const filename = `e${entry.id}-${Date.now()}-${i}-${crypto.randomBytes(3).toString('hex')}.jpg`;
    // 存檔前去除 EXIF（部分手機瀏覽器壓縮後仍保留；會讓 LLM gateway 解析 500，也可能夾帶 GPS 隱私）
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), stripJpegExif(file.buffer));
    return `/uploads/${filename}`;
  });
  const photos = [...current, ...urls];
  db.prepare('UPDATE entries SET photos = ? WHERE id = ?').run(JSON.stringify(photos), entry.id);
  // 空白紀錄因上傳照片而有內容＝發布新貼文
  if (!entryHasData(entryToJson(entry))) {
    notifyFollowers(req.userId, `entry:${entry.id}`);
  }
  return res.json({ photos });
});

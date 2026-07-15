import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { MAX_PHOTOS, copyPhotoSchema, entryPatchSchema } from '../validation.js';
import { UPLOAD_DIR, deletePhotoRatings, entryHasData, entryToJson, entryToJsonWithRatings, getEntryHistory, notifyFollowers, parseFood, parsePhotoFoods, parsePhotos, sumFoods, unlinkPhoto, type EntryRow } from '../helpers.js';

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

  const filename = `e${entry.id}-${Date.now()}-copy.jpg`;
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
  if (photos !== undefined) {
    const keep = finalPhotos.filter((p) => photos.includes(p));
    const removed = finalPhotos.filter((p) => !keep.includes(p));
    removed.forEach(unlinkPhoto);
    deletePhotoRatings(entry.id, removed);
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
  const updated = getOwnedEntry(req.userId, req.params.id)!;
  // 紀錄第一次從空白變成有內容＝發布新貼文，通知追蹤這位會員的營養師
  if (!entryHasData(entryToJson(entry)) && entryHasData(entryToJson(updated))) {
    notifyFollowers(req.userId, `entry:${entry.id}`);
  }
  return res.json(entryToJsonWithRatings(updated));
});

entriesRouter.delete('/:id', (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  parsePhotos(entry.photos).forEach(unlinkPhoto);
  deletePhotoRatings(entry.id);
  db.prepare('DELETE FROM entry_comments WHERE target = ?').run(`entry:${entry.id}`);
  db.prepare('DELETE FROM entries WHERE id = ?').run(entry.id);
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
    const filename = `e${entry.id}-${Date.now()}-${i}.jpg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
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

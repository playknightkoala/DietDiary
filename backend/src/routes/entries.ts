import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { MAX_PHOTOS, entryPatchSchema } from '../validation.js';
import { UPLOAD_DIR, entryToJson, parsePhotos, unlinkPhoto, type EntryRow } from '../helpers.js';

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
    .prepare('SELECT id, meal, desc, photos, food FROM entries WHERE id = ? AND user_id = ?')
    .get(id, userId) as EntryRow | undefined;
}

entriesRouter.patch('/:id', (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  const parsed = entryPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { desc, food, photos } = parsed.data;

  const sets: string[] = [];
  const args: string[] = [];
  if (desc !== undefined) { sets.push('desc = ?'); args.push(desc); }
  if (food !== undefined) { sets.push('food = ?'); args.push(JSON.stringify(food)); }
  if (photos !== undefined) {
    // 只允許保留既有照片的子集合（= 刪除部分照片），被移除的檔案順手清掉
    const current = parsePhotos(entry.photos);
    const keep = current.filter((p) => photos.includes(p));
    current.filter((p) => !keep.includes(p)).forEach(unlinkPhoto);
    sets.push('photos = ?');
    args.push(JSON.stringify(keep));
  }
  if (sets.length) {
    db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).run(...args, entry.id);
  }
  return res.json(entryToJson(getOwnedEntry(req.userId, req.params.id)!));
});

entriesRouter.delete('/:id', (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  parsePhotos(entry.photos).forEach(unlinkPhoto);
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
  return res.json({ photos });
});

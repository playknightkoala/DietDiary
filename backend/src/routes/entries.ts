import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { entryPatchSchema } from '../validation.js';
import { entryToJson, type EntryRow } from '../helpers.js';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === 'image/jpeg');
  },
});

export const entriesRouter = Router();
entriesRouter.use(requireAuth);

function getOwnedEntry(userId: number, id: string) {
  return db
    .prepare('SELECT id, meal, desc, photo, food FROM entries WHERE id = ? AND user_id = ?')
    .get(id, userId) as EntryRow | undefined;
}

function unlinkPhoto(photoUrl: string) {
  if (!photoUrl.startsWith('/uploads/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(photoUrl));
  fs.unlink(file, () => {});
}

entriesRouter.patch('/:id', (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  const parsed = entryPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { desc, food, photo } = parsed.data;

  const sets: string[] = [];
  const args: string[] = [];
  if (desc !== undefined) { sets.push('desc = ?'); args.push(desc); }
  if (food !== undefined) { sets.push('food = ?'); args.push(JSON.stringify(food)); }
  if (photo !== undefined) {
    if (entry.photo) unlinkPhoto(entry.photo);
    sets.push('photo = ?');
    args.push('');
  }
  if (sets.length) {
    db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).run(...args, entry.id);
  }
  return res.json(entryToJson(getOwnedEntry(req.userId, req.params.id)!));
});

entriesRouter.delete('/:id', (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  if (entry.photo) unlinkPhoto(entry.photo);
  db.prepare('DELETE FROM entries WHERE id = ?').run(entry.id);
  return res.status(204).end();
});

entriesRouter.post('/:id/photo', upload.single('photo'), (req, res) => {
  const entry = getOwnedEntry(req.userId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  if (!req.file) return res.status(400).json({ error: 'photo file required (jpeg)' });

  if (entry.photo) unlinkPhoto(entry.photo);
  const filename = `e${entry.id}-${Date.now()}.jpg`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer);
  const url = `/uploads/${filename}`;
  db.prepare('UPDATE entries SET photo = ? WHERE id = ?').run(url, entry.id);
  return res.json({ photo: url });
});

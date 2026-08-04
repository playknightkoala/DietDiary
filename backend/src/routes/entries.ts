import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { FOOD_KEYS, MAX_PHOTOS, copyPhotoSchema, entryPatchSchema } from '../validation.js';
import { ENTRY_COLS, UPLOAD_DIR, computeEntryFood, deletePhotoRatings, entryHasData, entryToJson, entryToJsonWithRatings, getEntryHistory, normalizeCustomItems, normalizeItems, notifyFollowers, parseFood, parseItems, parsePhotoCustoms, parsePhotoFoods, parsePhotos, stripJpegExif, unlinkPhoto, type CustomItem, type EntryItem, type EntryRow } from '../helpers.js';
import type { Food } from '../helpers.js';
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
    .prepare(`SELECT ${ENTRY_COLS} FROM entries WHERE id = ? AND user_id = ?`)
    .get(id, userId) as EntryRow | undefined;
}

// 最近記過份數的照片（新→舊），供「從歷史加入」；limit 為每餐別上限；exclude 排除目前編輯中的紀錄
entriesRouter.get('/history', (req, res) => {
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 30));
  const exclude = req.query.exclude ? Number(req.query.exclude) : undefined;
  return res.json(getEntryHistory(req.userId, limit, exclude));
});

// 最近記過的「自訂名稱＋大卡」自定義項目（新→舊、以名稱＋大卡去重），供快速再次加入。
// 只回傳 type=custom（糖/酒精/蛋白質輸入重量即可，不需要歷史）
entriesRouter.get('/custom-history', (req, res) => {
  const rows = db
    .prepare(
      `SELECT photo_customs, items FROM entries
       WHERE user_id = ? AND (photo_customs != '{}' OR items != '[]')
       ORDER BY date DESC, id DESC LIMIT 500`
    )
    .all(req.userId) as { photo_customs: string; items: string }[];
  const seen = new Set<string>();
  const out: { name: string; kcal: number }[] = [];
  for (const row of rows) {
    const customs = [
      ...Object.values(parsePhotoCustoms(row.photo_customs)).flat(),
      ...parseItems(row.items).flatMap((it) => it.customItems),
    ];
    for (const it of customs) {
      if (it.type !== 'custom' || !it.name) continue;
      const key = `${it.name}|${it.kcal}`; // 同名不同大卡視為不同項（大杯/小杯）
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: it.name, kcal: it.kcal });
      if (out.length >= 10) return res.json(out);
    }
  }
  return res.json(out);
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
  const { desc, food, photoFoods, photoCustoms, items, photos, date, eatTime } = parsed.data;

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

  // ---- 份量更新（統一維持不變量：food = 照片份數 + items 份數）----
  const storedPf = parsePhotoFoods(entry.photo_foods);
  const storedPc = parsePhotoCustoms(entry.photo_customs ?? '{}');
  const storedItems = parseItems(entry.items ?? '[]');
  const prunePf = (pf: Record<string, Food>) =>
    Object.fromEntries(Object.entries(pf).filter(([url]) => finalPhotos.includes(url)));
  const prunePc = (pc: Record<string, CustomItem[]>) =>
    Object.fromEntries(
      Object.entries(pc)
        .map(([url, list]) => [url, normalizeCustomItems(list)] as const)
        .filter(([url, list]) => finalPhotos.includes(url) && list.length)
    );
  // 「營養師調整」標記比對用：只看六大類份數的有效分佈（自定義項目不算份數變動）。
  // legacy 無照片列（items 空、photo_foods 空、food>0）視為隱含單一項目，
  // 新 client 原樣送回 items=[{food}] 時不會誤清標記
  const effFoods = (pf: Record<string, Food>, its: EntryItem[], legacy: Food | null) => {
    const itemFoods = its.length
      ? its.map((it) => it.food)
      : legacy && !Object.keys(pf).length && Object.values(legacy).some((v) => v > 0)
        ? [legacy]
        : [];
    return JSON.stringify({
      pf: Object.keys(pf).sort().map((url) => [url, FOOD_KEYS.map((k) => pf[url][k] || 0)]),
      it: itemFoods.map((f) => FOOD_KEYS.map((k) => f[k] || 0)),
    });
  };
  const storedEff = effFoods(storedPf, storedItems, parsePhotos(entry.photos).length ? null : parseFood(entry.food));

  const portionProvided = photoFoods !== undefined || photoCustoms !== undefined || items !== undefined;
  if (portionProvided || food !== undefined) {
    let nextPf: Record<string, Food>;
    let nextPc: Record<string, CustomItem[]>;
    let nextItems: EntryItem[];
    if (portionProvided) {
      // 新 client：整組替換（未提供的部分保留原值，容忍部分更新）
      nextPf = prunePf(photoFoods !== undefined ? (photoFoods as Record<string, Food>) : storedPf);
      nextPc = prunePc(photoCustoms !== undefined ? (photoCustoms as Record<string, CustomItem[]>) : storedPc);
      // 未帶 items 且無既有 items 的 legacy 無照片紀錄：整筆 food 視為隱含單一項目帶入，
      // 避免部分更新（只送 photoCustoms 等）把 food 重算成 0
      const fallbackItems =
        !storedItems.length && !parsePhotos(entry.photos).length && Object.values(parseFood(entry.food)).some((v) => v > 0)
          ? [{ food: parseFood(entry.food), customItems: [] }]
          : storedItems;
      nextItems = normalizeItems(items !== undefined ? items : fallbackItems);
    } else {
      // 舊 client（只送 food）：整筆份數改寫為單一 items 項；既有 items 的自定義項目併入避免遺失
      nextPf = prunePf(storedPf);
      nextPc = prunePc(storedPc);
      nextItems = normalizeItems([{ food: food as Food, customItems: storedItems.flatMap((it) => it.customItems) }]);
    }
    sets.push('photo_foods = ?', 'photo_customs = ?', 'items = ?', 'food = ?');
    args.push(
      JSON.stringify(nextPf),
      JSON.stringify(nextPc),
      JSON.stringify(nextItems),
      JSON.stringify(computeEntryFood(nextPf, nextItems))
    );
    // 會員自行改動份數後，「營養師調整」標記即不再成立（份數沒變則保留；只改自定義項目不清除）。
    // 原始資料快照一併清除：目前內容已是會員自己的，「調整前 vs 調整後」的對照不再成立
    if (storedEff !== effFoods(nextPf, nextItems, null)) {
      sets.push('food_edited_at = 0', `orig_data = ''`);
    }
  } else if (photos !== undefined) {
    // 只刪照片：一併修剪該照片的份數與自定義項目，food 重算仍須包含 items 的份數。
    // 三者皆空（legacy 整筆 food 的紀錄）則不動 food，維持舊行為
    if (Object.keys(storedPf).length || Object.keys(storedPc).length || storedItems.length) {
      const prunedPf = prunePf(storedPf);
      sets.push('photo_foods = ?', 'photo_customs = ?', 'food = ?');
      args.push(
        JSON.stringify(prunedPf),
        JSON.stringify(prunePc(storedPc)),
        JSON.stringify(computeEntryFood(prunedPf, storedItems))
      );
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
  // 只餵第一張照片「自己的」份數：整筆總和可能含其他照片與無照片項目，會污染該道菜的社群共識
  if (kbActive()) {
    const u = entryToJson(updated);
    const firstFood = u.photos.length ? u.photoFoods[u.photos[0]] : undefined;
    if (u.desc.trim() && firstFood && Object.values(firstFood).some((v) => v > 0)) {
      void kbUpsert(u.desc, firstFood, u.photos[0]).catch(() => {});
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

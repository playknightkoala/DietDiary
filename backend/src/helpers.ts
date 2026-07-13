import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { FOOD_KEYS } from './validation.js';

export type Food = Record<(typeof FOOD_KEYS)[number], number>;

export const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export interface EntryRow {
  id: number;
  meal: string;
  desc: string;
  photos: string;
  eat_time: string;
  food: string;
}

export interface DayRow {
  water: number;
  ex_min: string;
  ex_desc: string;
  body_weight: string;
  body_fat: string;
  body_waist: string;
  body_muscle: string;
  body_fatkg: string;
}

export function emptyFood(): Food {
  return Object.fromEntries(FOOD_KEYS.map((k) => [k, 0])) as Food;
}

export function parseFood(json: string): Food {
  try {
    return { ...emptyFood(), ...JSON.parse(json) };
  } catch {
    return emptyFood();
  }
}

export function parsePhotos(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function unlinkPhoto(photoUrl: string) {
  if (!photoUrl.startsWith('/uploads/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(photoUrl));
  fs.unlink(file, () => {});
}

export function entryToJson(e: EntryRow) {
  return { id: e.id, meal: e.meal, desc: e.desc, photos: parsePhotos(e.photos), eatTime: e.eat_time ?? '', food: parseFood(e.food) };
}

export type PhotoRating = 'green' | 'yellow' | 'red';

export function getPhotoRatings(entryId: number): Record<string, PhotoRating> {
  const rows = db
    .prepare('SELECT photo, rating FROM photo_ratings WHERE entry_id = ?')
    .all(entryId) as { photo: string; rating: PhotoRating }[];
  return Object.fromEntries(rows.map((r) => [r.photo, r.rating]));
}

// 對外回傳的 entry 一律附上營養師的照片評分（無評分＝空物件）與留言數
export function entryToJsonWithRatings(e: EntryRow) {
  return { ...entryToJson(e), ratings: getPhotoRatings(e.id), commentCount: countComments(`entry:${e.id}`) };
}

// ---- 留言（target：entry:<id> / water:<date> / ex:<date>，owner 為紀錄擁有者）----

export interface CommentJson {
  id: number;
  body: string;
  createdAt: number;
  author: string;
  role: string;
  mine: boolean;
}

// entry:<id> 全域唯一；water:/ex: 需連 owner 一起查
export function countComments(target: string, ownerId?: number): number {
  const row = target.startsWith('entry:')
    ? db.prepare('SELECT COUNT(*) AS c FROM entry_comments WHERE target = ?').get(target)
    : db.prepare('SELECT COUNT(*) AS c FROM entry_comments WHERE target = ? AND user_id = ?').get(target, ownerId ?? -1);
  return (row as { c: number }).c;
}

export function listComments(ownerId: number, target: string, viewerId: number): CommentJson[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.author_id, u.username, u.role
       FROM entry_comments c JOIN users u ON u.id = c.author_id
       WHERE c.user_id = ? AND c.target = ? ORDER BY c.id`
    )
    .all(ownerId, target) as { id: number; body: string; created_at: number; author_id: number; username: string; role: string }[];
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    author: r.username,
    role: r.role,
    mine: r.author_id === viewerId,
  }));
}

export function createComment(ownerId: number, target: string, authorId: number, body: string) {
  db.prepare('INSERT INTO entry_comments (user_id, target, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
    ownerId,
    target,
    authorId,
    body,
    Date.now()
  );
}

// 確認留言對象屬於該會員：entry 需為其所有；water/ex 為其當日紀錄（日期格式已由 schema 驗證）
export function commentTargetOwned(ownerId: number, target: string): boolean {
  if (target.startsWith('entry:')) {
    const id = Number(target.slice(6));
    return !!db.prepare('SELECT id FROM entries WHERE id = ? AND user_id = ?').get(id, ownerId);
  }
  return true;
}

export function deletePhotoRatings(entryId: number, photos?: string[]) {
  if (photos === undefined) {
    db.prepare('DELETE FROM photo_ratings WHERE entry_id = ?').run(entryId);
    return;
  }
  const del = db.prepare('DELETE FROM photo_ratings WHERE entry_id = ? AND photo = ?');
  for (const p of photos) del.run(entryId, p);
}

export function getDayJson(userId: number, date: string) {
  const row = db
    .prepare('SELECT * FROM days WHERE user_id = ? AND date = ?')
    .get(userId, date) as DayRow | undefined;
  const entries = (
    db
      .prepare('SELECT id, meal, desc, photos, eat_time, food FROM entries WHERE user_id = ? AND date = ? ORDER BY id')
      .all(userId, date) as EntryRow[]
  ).map(entryToJsonWithRatings);
  return {
    commentCounts: {
      water: countComments(`water:${date}`, userId),
      ex: countComments(`ex:${date}`, userId),
    },
    water: row?.water ?? 0,
    ex: { min: row?.ex_min ?? '', desc: row?.ex_desc ?? '' },
    body: {
      weight: row?.body_weight ?? '',
      fat: row?.body_fat ?? '',
      waist: row?.body_waist ?? '',
      muscle: row?.body_muscle ?? '',
      fatkg: row?.body_fatkg ?? '',
    },
    entries,
  };
}

export function entryHasData(e: { desc: string; photos: string[]; food: Food }) {
  return !!(e.desc || e.photos.length || Object.values(e.food).some((v) => v > 0));
}

export function ensureDayRow(userId: number, date: string) {
  db.prepare('INSERT OR IGNORE INTO days (user_id, date) VALUES (?, ?)').run(userId, date);
}

// 有紀錄的日期集合（週曆／月曆亮燈），供本人與營養師檢視共用
export function getMarkedDates(userId: number, from: string, to: string): string[] {
  const dates = new Set<string>();
  const dayRows = db
    .prepare('SELECT * FROM days WHERE user_id = ? AND date >= ? AND date <= ?')
    .all(userId, from, to) as (DayRow & { date: string })[];
  for (const r of dayRows) {
    const hasBody = [r.body_weight, r.body_fat, r.body_waist, r.body_muscle, r.body_fatkg].some((v) => v !== '');
    const hasEx = (r.ex_min && +r.ex_min > 0) || !!r.ex_desc;
    if (r.water > 0 || hasEx || hasBody) dates.add(r.date);
  }
  const entryRows = db
    .prepare('SELECT date, desc, photos, food FROM entries WHERE user_id = ? AND date >= ? AND date <= ?')
    .all(userId, from, to) as (EntryRow & { date: string })[];
  for (const r of entryRows) {
    if (!dates.has(r.date) && entryHasData(entryToJson(r))) dates.add(r.date);
  }
  return [...dates].sort();
}

// 刪除會員時清掉其所有資料與照片檔
export function deleteUserData(userId: number) {
  const photoRows = db.prepare('SELECT photos FROM entries WHERE user_id = ?').all(userId) as { photos: string }[];
  for (const r of photoRows) parsePhotos(r.photos).forEach(unlinkPhoto);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM photo_ratings WHERE entry_id IN (SELECT id FROM entries WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM entry_comments WHERE user_id = ? OR author_id = ?').run(userId, userId);
    db.prepare('DELETE FROM entries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM days WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM goal_periods WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
}

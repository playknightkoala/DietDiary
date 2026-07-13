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
  return { id: e.id, meal: e.meal, desc: e.desc, photos: parsePhotos(e.photos), food: parseFood(e.food) };
}

export function getDayJson(userId: number, date: string) {
  const row = db
    .prepare('SELECT * FROM days WHERE user_id = ? AND date = ?')
    .get(userId, date) as DayRow | undefined;
  const entries = (
    db
      .prepare('SELECT id, meal, desc, photos, food FROM entries WHERE user_id = ? AND date = ? ORDER BY id')
      .all(userId, date) as EntryRow[]
  ).map(entryToJson);
  return {
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
    db.prepare('DELETE FROM entries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM days WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM goal_periods WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
}

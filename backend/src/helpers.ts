import { db } from './db.js';
import { FOOD_KEYS } from './validation.js';

export type Food = Record<(typeof FOOD_KEYS)[number], number>;

export interface EntryRow {
  id: number;
  meal: string;
  desc: string;
  photo: string;
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

export function entryToJson(e: EntryRow) {
  return { id: e.id, meal: e.meal, desc: e.desc, photo: e.photo, food: parseFood(e.food) };
}

export function getDayJson(userId: number, date: string) {
  const row = db
    .prepare('SELECT * FROM days WHERE user_id = ? AND date = ?')
    .get(userId, date) as DayRow | undefined;
  const entries = (
    db
      .prepare('SELECT id, meal, desc, photo, food FROM entries WHERE user_id = ? AND date = ? ORDER BY id')
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

export function entryHasData(e: { desc: string; photo: string; food: Food }) {
  return !!(e.desc || e.photo || Object.values(e.food).some((v) => v > 0));
}

export function ensureDayRow(userId: number, date: string) {
  db.prepare('INSERT OR IGNORE INTO days (user_id, date) VALUES (?, ?)').run(userId, date);
}

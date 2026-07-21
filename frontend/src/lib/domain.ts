import type { BodyKey, DayData, Entry, Food, FoodKey, Goal, GoalKey, MealKey } from '../types';

// 每份熱量（kcal/份）— 與原型 Component.KCAL 一致
export const KCAL: Record<FoodKey, number> = {
  meatLow: 55, meatMed: 75, meatHigh: 120, meatXHigh: 135,
  veg: 25, grain: 70, oil: 45, fruit: 60,
  milkSkim: 80, milkLow: 120, milkFull: 150,
};

export const DEFAULT_GOALS: Record<GoalKey, number> = {
  meat: 7, veg: 3, grain: 10, oil: 3, fruit: 2, milk: 2,
};

export const DEFAULT_WATER = 2000;

export interface MealDef {
  k: MealKey;
  name: string;
  glyph: string;
  tint: string;
  color: string;
}

export const MEALS: MealDef[] = [
  { k: 'breakfast', name: '早餐', glyph: '早', tint: '#F1E8D2', color: '#A8842E' },
  { k: 'lunch', name: '午餐', glyph: '午', tint: '#E3EBD9', color: '#4A7C59' },
  { k: 'dinner', name: '晚餐', glyph: '晚', tint: '#E5EBF1', color: '#5B8DB8' },
  { k: 'night', name: '宵夜', glyph: '宵', tint: '#F5E3DB', color: '#C0564A' },
  { k: 'snack', name: '點心', glyph: '點', tint: '#F6E5E9', color: '#B5537A' },
];

export const BODY_DEFS: { k: BodyKey; name: string; unit: string }[] = [
  { k: 'weight', name: '體重', unit: 'kg' },
  { k: 'fat', name: '體脂率', unit: '%' },
  { k: 'waist', name: '腰圍', unit: 'cm' },
  { k: 'muscle', name: '肌肉重', unit: 'kg' },
  { k: 'fatkg', name: '體脂重', unit: 'kg' },
];

export const FOOD_KEYS = Object.keys(KCAL) as FoodKey[];

export function emptyFood(): Food {
  return {
    meatLow: 0, meatMed: 0, meatHigh: 0, meatXHigh: 0,
    veg: 0, grain: 0, oil: 0, fruit: 0,
    milkSkim: 0, milkLow: 0, milkFull: 0,
  };
}

export function emptyDay(): DayData {
  return {
    water: 0,
    waterTime: '',
    waterLogs: [],
    exLogs: [],
    body: { weight: '', fat: '', waist: '', muscle: '', fatkg: '' },
    bodyTime: '',
    entries: [],
    aiSummary: null,
  };
}

// 目前時刻 HH:MM（新增飲食紀錄的預設用餐時間）
export function nowHM(): string {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// 留言時間顯示：M/D HH:MM
export function fmtCommentTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 動態牆排序：新→舊（有時間的在前、依時間倒序；沒填時間的墊後、依建立順序倒序）
export function sortEntriesNewestFirst(entries: Entry[]): Entry[] {
  return entries.slice().sort((a, b) => {
    if (a.eatTime && b.eatTime) return b.eatTime.localeCompare(a.eatTime) || b.id - a.id;
    if (a.eatTime !== b.eatTime) return a.eatTime ? -1 : 1;
    return b.id - a.id;
  });
}

export function entryHasData(e: { desc: string; photos: string[]; food: Food }): boolean {
  return !!(e.desc || e.photos.length || Object.values(e.food).some((v) => v > 0));
}

// 月曆亮燈判斷，規則必須與後端 getMarkedDates 一致：
// 喝水>0、任一筆運動有分鐘或敘述、任一身體欄位非空、任一 entry 有內容；
// 空白 entry（剛新增未填）與 AI 總評不亮燈。
export function dayHasData(day: DayData): boolean {
  const hasBody = Object.values(day.body).some((v) => v !== '');
  const hasEx = day.exLogs.some((l) => (Number(l.min) || 0) > 0 || l.desc !== '');
  return day.water > 0 || hasEx || hasBody || day.entries.some(entryHasData);
}

export function dayFoodTotals(entries: Entry[]): Food {
  const tot = emptyFood();
  entries.forEach((e) => {
    FOOD_KEYS.forEach((k) => (tot[k] += e.food[k] || 0));
  });
  return tot;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 份數 clamp：<0→0、>99→99、四捨五入到小數 1 位
export function clampPortion(v: string | number | null): number {
  if (v === '' || v === null) return 0;
  let n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n) || n < 0) n = 0;
  if (n > 99) n = 99;
  return round1(n);
}

export function kcalOfFood(f: Food): number {
  return Math.round(FOOD_KEYS.reduce((a, k) => a + (f[k] || 0) * KCAL[k], 0));
}

// 多張照片份數加總（一位小數，避免浮點誤差；與後端邏輯一致）
export function sumFoods(foods: Food[]): Food {
  const total = emptyFood();
  for (const f of foods) {
    for (const k of FOOD_KEYS) total[k] = Math.round((total[k] + (f[k] || 0)) * 10) / 10;
  }
  return total;
}

// 各份數欄位的顯示名稱（照片份數摘要用）
export const FOOD_KEY_NAMES: Record<FoodKey, string> = {
  meatLow: '蛋豆魚肉（低脂）', meatMed: '蛋豆魚肉（中脂）', meatHigh: '蛋豆魚肉（高脂）', meatXHigh: '蛋豆魚肉（超高脂）',
  veg: '蔬菜', grain: '全穀雜糧', oil: '油脂堅果', fruit: '水果',
  milkSkim: '乳品（脫脂）', milkLow: '乳品（低脂）', milkFull: '乳品（全脂）',
};

// 一張照片份數的文字摘要：「蔬菜 1、全穀雜糧 2」；全為 0 回傳空字串
export function foodSummary(f: Food): string {
  return FOOD_KEYS.filter((k) => (f[k] || 0) > 0)
    .map((k) => `${FOOD_KEY_NAMES[k]} ${f[k]}`)
    .join('、');
}

// 一張照片實際歸屬的份數：優先用逐張份數；
// 舊資料（僅整筆 food、無任何逐張份數）視為記在第一張——與記錄視窗的相容邏輯一致
export function photoFoodOf(
  entry: Pick<Entry, 'photos' | 'photoFoods' | 'food'>,
  url: string
): Food | null {
  const own = entry.photoFoods[url];
  if (own && FOOD_KEYS.some((k) => (own[k] || 0) > 0)) return own;
  const anyPerPhoto = entry.photos.some((u) => FOOD_KEYS.some((k) => (entry.photoFoods[u]?.[k] ?? 0) > 0));
  if (!anyPerPhoto && entry.photos[0] === url && FOOD_KEYS.some((k) => (entry.food[k] || 0) > 0)) {
    return entry.food;
  }
  return null;
}

// 日期 key 落在某組目標區間內用該組值（多組重疊時取最新建立的一組），否則用預設
export function goalsFor(
  key: string,
  goals: Goal[] | null
): { vals: Record<GoalKey, number>; water: number; custom: boolean; setBy: 'self' | 'dietitian' | null } {
  const hit = (goals ?? [])
    .filter((g) => g.start && g.end && key >= g.start && key <= g.end)
    .sort((a, b) => b.id - a.id)[0];
  if (hit) {
    // 目標喝水 0 須保留（?? 而非 ||，否則 0 會被塌回預設 2000）
    return { vals: hit.vals, water: hit.water ?? DEFAULT_WATER, custom: true, setBy: hit.setBy };
  }
  return { vals: DEFAULT_GOALS, water: DEFAULT_WATER, custom: false, setBy: null };
}

export function dstr(d: Date): string {
  return (
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  );
}

export function dparse(s: string): Date {
  const p = s.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

export function addDays(s: string, n: number): string {
  const d = dparse(s);
  d.setDate(d.getDate() + n);
  return dstr(d);
}

// 週一為一週起始，回傳該週 7 天的 key
export function weekOf(anchor: string): string[] {
  const a = dparse(anchor);
  const monday = new Date(a);
  monday.setDate(a.getDate() - ((a.getDay() + 6) % 7));
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    days.push(dstr(dd));
  }
  return days;
}

export const WD_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

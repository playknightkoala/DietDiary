// NG 加工食品分類／關鍵字與每日精緻糖門檻（全域設定），以及當月「糖超標／NG 食品」統計。
// 分類是資料不是 enum（管理員可自行增刪改，ng_categories 表）；等級 level 與前端
// lib/ng.ts 的 NG_LEVEL_LABELS 是同步契約。統計為即時計算不落地；超標判定
// （sugar > limit）只在前端 lib/ng.ts 做，這裡只回每日原始糖量與當前門檻，避免雙判定漂移。
import { db } from './db.js';
import { entryAllCustoms, parseItems, parsePhotoCustoms } from './helpers.js';
import { round1 } from './routes/ai/nutrition.js';
import { NG_LEVELS } from './validation.js';

export type NgLevel = (typeof NG_LEVELS)[number];

// 等級排序（極高→高→中），列表與前端顯示共用
const LEVEL_RANK: Record<NgLevel, number> = { extreme: 0, high: 1, medium: 2 };

export interface NgCategoryJson {
  id: number;
  name: string;
  level: NgLevel;
  note: string;
}

export interface NgKeywordJson {
  id: number;
  keyword: string;
  // 排除詞不屬於任何分類（null）
  categoryId: number | null;
  isExclusion: boolean;
  createdAt: string;
}

// 未設定門檻時的程式預設（WHO 建議每日游離糖上限 25 公克）；預設值不落 DB
export const DEFAULT_SUGAR_LIMIT = 25;

const SUGAR_LIMIT_KEY = 'sugar_limit_g';

// 關鍵字儲存與掃描 haystack 共用同一個正規化（比對兩端同一 canonical 形）：
// NFKC 把全形英數折成半形（ＣＯＬＡ→COLA），再小寫＋trim；中文不受影響
export function normalizeNgText(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim();
}

export function getSugarLimit(): number {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SUGAR_LIMIT_KEY) as
    | { value: string }
    | undefined;
  if (!row) return DEFAULT_SUGAR_LIMIT;
  const n = Number(row.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SUGAR_LIMIT;
}

export function setSugarLimit(grams: number): void {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SUGAR_LIMIT_KEY, String(grams));
}

// ---- 分類 CRUD ----

interface CategoryRow { id: number; name: string; level: NgLevel; note: string }

export function listNgCategories(): NgCategoryJson[] {
  const rows = db.prepare('SELECT id, name, level, note FROM ng_categories').all() as CategoryRow[];
  return rows.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.id - b.id);
}

// UNIQUE 衝突原樣往上拋，由路由層轉 409
export function createNgCategory(name: string, level: NgLevel, note: string): NgCategoryJson {
  const info = db.prepare('INSERT INTO ng_categories (name, level, note) VALUES (?, ?, ?)').run(name, level, note);
  return db.prepare('SELECT id, name, level, note FROM ng_categories WHERE id = ?').get(Number(info.lastInsertRowid)) as CategoryRow;
}

// 以 changes 判定存在與否（不先 SELECT，避免 check-then-act）；不存在回 null
export function updateNgCategory(id: number, name: string, level: NgLevel, note: string): NgCategoryJson | null {
  const info = db.prepare('UPDATE ng_categories SET name = ?, level = ?, note = ? WHERE id = ?').run(name, level, note, id);
  if (info.changes !== 1) return null;
  return db.prepare('SELECT id, name, level, note FROM ng_categories WHERE id = ?').get(id) as CategoryRow;
}

// 連同底下的關鍵字一併刪除（同一交易：先刪子表再刪分類，中途失敗整筆回滾）；
// 危險操作的確認（輸入「確定刪除」）在前端把關。分類不存在回 false
export function deleteNgCategory(id: number): boolean {
  return db.transaction(() => {
    db.prepare('DELETE FROM ng_keywords WHERE category_id = ?').run(id);
    return db.prepare('DELETE FROM ng_categories WHERE id = ?').run(id).changes === 1;
  })();
}

// ---- 關鍵字 CRUD ----

interface KeywordRow { id: number; keyword: string; category_id: number | null; is_exclusion: number; created_at: string }

const KEYWORD_COLS = 'id, keyword, category_id, is_exclusion, created_at';

function keywordToJson(row: KeywordRow): NgKeywordJson {
  return { id: row.id, keyword: row.keyword, categoryId: row.category_id, isExclusion: !!row.is_exclusion, createdAt: row.created_at };
}

export function listNgKeywords(): NgKeywordJson[] {
  const rows = db.prepare(`SELECT ${KEYWORD_COLS} FROM ng_keywords ORDER BY is_exclusion, keyword`).all() as KeywordRow[];
  return rows.map(keywordToJson);
}

// 正規化後為空字串（例如全空白）由呼叫端先擋；UNIQUE／FK 衝突原樣往上拋，由路由層轉 409／400
export function createNgKeyword(keyword: string, categoryId: number | null, isExclusion = false): NgKeywordJson {
  const normalized = normalizeNgText(keyword);
  const info = db
    .prepare('INSERT INTO ng_keywords (keyword, category_id, is_exclusion) VALUES (?, ?, ?)')
    .run(normalized, isExclusion ? null : categoryId, isExclusion ? 1 : 0);
  const row = db.prepare(`SELECT ${KEYWORD_COLS} FROM ng_keywords WHERE id = ?`).get(Number(info.lastInsertRowid)) as KeywordRow;
  return keywordToJson(row);
}

// 以 changes 判定存在與否；不存在回 null
export function updateNgKeyword(id: number, keyword: string, categoryId: number | null, isExclusion = false): NgKeywordJson | null {
  const normalized = normalizeNgText(keyword);
  const info = db
    .prepare('UPDATE ng_keywords SET keyword = ?, category_id = ?, is_exclusion = ? WHERE id = ?')
    .run(normalized, isExclusion ? null : categoryId, isExclusion ? 1 : 0, id);
  if (info.changes !== 1) return null;
  const row = db.prepare(`SELECT ${KEYWORD_COLS} FROM ng_keywords WHERE id = ?`).get(id) as KeywordRow;
  return keywordToJson(row);
}

export function deleteNgKeyword(id: number): boolean {
  return db.prepare('DELETE FROM ng_keywords WHERE id = ?').run(id).changes === 1;
}

// ---- 月統計 ----

export interface MonthStatDay {
  date: string;
  sugar: number;
  ngHits: { keyword: string; category: string; level: NgLevel }[];
}

// 當月逐日統計：每日精緻糖公克數（custom items 中 type==='sugar' 的 amount 累計）＋
// NG 關鍵字命中（掃 desc 與所有自定義項目名稱，附分類名與等級）。
// 糖量契約：與前端 domain.dayMacros(entries).sugar 一致——逐筆累計原始 amount ?? 0，
// 當日總和才 round1 一次（回歸測試 scripts/sugar-ng.ts 守著）。
// 同一天同一關鍵字跨多筆 entry 去重；只回 sugar > 0 或有命中的天。
export function monthSugarNgStats(userId: number, ym: string): MonthStatDay[] {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const to = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  const all = db
    .prepare(`SELECT k.id, k.keyword, k.is_exclusion, c.name AS category, c.level
                FROM ng_keywords k LEFT JOIN ng_categories c ON c.id = k.category_id`)
    .all() as { id: number; keyword: string; is_exclusion: number; category: string | null; level: NgLevel | null }[];
  const keywords = all.filter((k) => !k.is_exclusion);
  // 排除詞長的先剔除（「70%黑巧克力」要先吃掉「黑巧克力」才輪不到「巧克力」）
  const exclusions = all.filter((k) => k.is_exclusion).sort((a, b) => b.keyword.length - a.keyword.length);
  const rows = db
    .prepare('SELECT date, desc, photo_customs, items FROM entries WHERE user_id = ? AND date >= ? AND date <= ?')
    .all(userId, from, to) as { date: string; desc: string; photo_customs: string; items: string }[];

  const sugarByDate = new Map<string, number>();
  const hitsByDate = new Map<string, Map<number, { keyword: string; category: string; level: NgLevel }>>();

  for (const r of rows) {
    const customs = entryAllCustoms({ photoCustoms: parsePhotoCustoms(r.photo_customs), items: parseItems(r.items) });
    let sugarRaw = sugarByDate.get(r.date) ?? 0;
    for (const it of customs) {
      if (it.type === 'sugar') sugarRaw += it.amount ?? 0;
    }
    sugarByDate.set(r.date, sugarRaw);

    if (keywords.length) {
      let haystack = normalizeNgText([r.desc, ...customs.map((c) => c.name)].join('\n'));
      // 先剔除排除詞命中的字段（以換行取代，避免拼出新詞），再比對 NG 關鍵字
      for (const ex of exclusions) haystack = haystack.split(ex.keyword).join('\n');
      if (haystack) {
        let hits = hitsByDate.get(r.date);
        for (const kw of keywords) {
          if (!haystack.includes(kw.keyword)) continue;
          if (!hits) {
            hits = new Map();
            hitsByDate.set(r.date, hits);
          }
          if (!hits.has(kw.id)) hits.set(kw.id, { keyword: kw.keyword, category: kw.category ?? '未分類', level: kw.level ?? 'medium' });
        }
      }
    }
  }

  const dates = new Set([...sugarByDate.keys(), ...hitsByDate.keys()]);
  const out: MonthStatDay[] = [];
  for (const date of [...dates].sort()) {
    const sugar = round1(sugarByDate.get(date) ?? 0);
    const ngHits = [...(hitsByDate.get(date)?.values() ?? [])];
    if (sugar > 0 || ngHits.length) out.push({ date, sugar, ngHits });
  }
  return out;
}

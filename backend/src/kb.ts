// 共用菜色知識庫（B：一道菜一列）。所有函式在 kbActive() 為 false 時安全空轉，
// 且 embedding 服務異常一律吞掉（回 null/skip），絕不讓 OCR 主流程失敗。
import { db } from './db.js';
import { EMBED_URL, kbActive, photoBufferForLlm, bufferDataUri, MAX_IMAGES_TOTAL_BYTES } from './llm.js';
import { type Food } from './helpers.js';

// 相似度門檻（可用環境變數微調）：查詢命中、合併同一道菜
const LOOKUP_MIN_SIM = Number(process.env.KB_LOOKUP_MIN_SIM) || 0.82;
const MERGE_MIN_SIM = Number(process.env.KB_MERGE_MIN_SIM) || 0.9;
const EMBED_TIMEOUT_MS = Math.max(3_000, Number(process.env.KB_EMBED_TIMEOUT_MS) || 15_000);

export interface SixCat {
  protein: number; veg: number; grain: number; oil: number; fruit: number; milk: number;
}

function r1(n: number): number {
  return Math.round((n || 0) * 10) / 10;
}

// 應用內細分份數（11 欄）→ 六大類
export function toSixCat(f: Food): SixCat {
  return {
    protein: r1(f.meatLow + f.meatMed + f.meatHigh + f.meatXHigh),
    veg: r1(f.veg), grain: r1(f.grain), oil: r1(f.oil), fruit: r1(f.fruit),
    milk: r1(f.milkSkim + f.milkLow + f.milkFull),
  };
}

export function sixCatZh(s: SixCat): string {
  const parts: string[] = [];
  if (s.protein) parts.push(`蛋豆魚肉 ${s.protein} 份`);
  if (s.veg) parts.push(`蔬菜 ${s.veg} 份`);
  if (s.grain) parts.push(`全穀雜糧 ${s.grain} 份`);
  if (s.oil) parts.push(`油脂堅果 ${s.oil} 份`);
  if (s.fruit) parts.push(`水果 ${s.fruit} 份`);
  if (s.milk) parts.push(`乳品 ${s.milk} 份`);
  return parts.join('、') || '份數皆為 0';
}

// ---- 向量 BLOB 與相似度 ----
function vecToBlob(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}
function blobToVec(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}
function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// ---- 呼叫外部 embedding 服務（失敗回 null，不丟出）----
async function embed(path: '/embed/text' | '/embed/image', payload: object): Promise<number[][] | null> {
  if (!kbActive()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${EMBED_URL}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { vectors?: number[][] };
    return Array.isArray(data.vectors) ? data.vectors : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function embedText(text: string): Promise<number[] | null> {
  const v = await embed('/embed/text', { texts: [text] });
  return v?.[0] ?? null;
}
async function embedImageUrl(photoUrl: string): Promise<number[] | null> {
  const buf = await photoBufferForLlm(photoUrl, MAX_IMAGES_TOTAL_BYTES);
  if (!buf) return null;
  const b64 = bufferDataUri(buf).split(',')[1];
  const v = await embed('/embed/image', { images: [b64] });
  return v?.[0] ?? null;
}

interface DishRow {
  id: number; caption: string; food: string; n: number;
  text_vec: Buffer | null; image_vec: Buffer | null; up: number; down: number;
}

function parseSixCat(json: string): SixCat {
  try {
    const o = JSON.parse(json);
    return { protein: +o.protein || 0, veg: +o.veg || 0, grain: +o.grain || 0, oil: +o.oil || 0, fruit: +o.fruit || 0, milk: +o.milk || 0 };
  } catch {
    return { protein: 0, veg: 0, grain: 0, oil: 0, fruit: 0, milk: 0 };
  }
}

export interface KbMatch {
  id: number; caption: string; food: SixCat; up: number; down: number; sim: number;
}

// 找與這張照片最相似的一道菜（OCR 時只有圖、還沒敘述，故以圖片向量為主）。
export async function kbLookupByImage(photoUrl: string): Promise<KbMatch | null> {
  if (!kbActive()) return null;
  const iv = await embedImageUrl(photoUrl);
  if (!iv) return null;
  const q = new Float32Array(iv);
  const rows = db.prepare('SELECT id, caption, food, n, text_vec, image_vec, up, down FROM dish_kb WHERE image_vec IS NOT NULL').all() as DishRow[];
  let best: KbMatch | null = null;
  for (const r of rows) {
    if (!r.image_vec) continue;
    const sim = cosine(q, blobToVec(r.image_vec));
    if (sim >= LOOKUP_MIN_SIM && (!best || sim > best.sim)) {
      best = { id: r.id, caption: r.caption, food: parseSixCat(r.food), up: r.up, down: r.down, sim };
    }
  }
  return best;
}

// 把一筆「已確認」的餐點（敘述＋份數＋照片）併入知識庫：夠像就更新共識平均，否則新增一列。
export async function kbUpsert(caption: string, food: Food, photoUrl: string | null): Promise<void> {
  if (!kbActive() || !caption.trim()) return;
  const sc = toSixCat(food);
  const tv = await embedText(caption);
  const iv = photoUrl ? await embedImageUrl(photoUrl) : null;
  if (!tv && !iv) return; // 服務不可用，放棄（不影響存檔）
  const tq = tv ? new Float32Array(tv) : null;
  const iq = iv ? new Float32Array(iv) : null;

  const rows = db.prepare('SELECT id, caption, food, n, text_vec, image_vec, up, down FROM dish_kb').all() as DishRow[];
  let best: { row: DishRow; sim: number } | null = null;
  for (const r of rows) {
    const ts = tq && r.text_vec ? cosine(tq, blobToVec(r.text_vec)) : 0;
    const is = iq && r.image_vec ? cosine(iq, blobToVec(r.image_vec)) : 0;
    // 兩者都有取加權；只有一種就用那一種
    const sim = tq && iq && r.text_vec && r.image_vec ? 0.6 * ts + 0.4 * is : Math.max(ts, is);
    if (!best || sim > best.sim) best = { row: r, sim };
  }

  const now = Date.now();
  if (best && best.sim >= MERGE_MIN_SIM) {
    // 併入：共識份數取移動平均
    const prev = parseSixCat(best.row.food);
    const n = best.row.n;
    const merged: SixCat = {
      protein: r1((prev.protein * n + sc.protein) / (n + 1)),
      veg: r1((prev.veg * n + sc.veg) / (n + 1)),
      grain: r1((prev.grain * n + sc.grain) / (n + 1)),
      oil: r1((prev.oil * n + sc.oil) / (n + 1)),
      fruit: r1((prev.fruit * n + sc.fruit) / (n + 1)),
      milk: r1((prev.milk * n + sc.milk) / (n + 1)),
    };
    db.prepare('UPDATE dish_kb SET food = ?, n = n + 1, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), now, best.row.id);
  } else {
    db.prepare('INSERT INTO dish_kb (caption, food, n, text_vec, image_vec, updated_at) VALUES (?, ?, 1, ?, ?, ?)')
      .run(caption.slice(0, 200), JSON.stringify(sc), tv ? vecToBlob(tv) : null, iv ? vecToBlob(iv) : null, now);
  }
}

// 使用者對某道菜的份數估計投票（讚 +1 / 倒讚 -1），累積成全體信任訊號
export function kbVote(dishId: number, delta: 1 | -1) {
  const col = delta === 1 ? 'up' : 'down';
  db.prepare(`UPDATE dish_kb SET ${col} = ${col} + 1, updated_at = ? WHERE id = ?`).run(Date.now(), dishId);
}

// 給 OCR 提示用：把知識庫命中的共識份數組成參考句（含信任提醒）
export function kbHint(match: KbMatch): string {
  const trust = match.down > match.up + 1
    ? '（提醒：AI 過去對這道菜的份數估計常被使用者倒讚，請格外謹慎、以你實際看到的為準）'
    : match.up > 0 ? '（此份數多次獲使用者確認，可信度較高）' : '';
  return (
    `參考：類似菜色過去由社群確認的份數約為「${sixCatZh(match.food)}」。` +
    `若這張照片內容一致可據此校準，但仍以你實際看到的份量為準。${trust}\n`
  );
}

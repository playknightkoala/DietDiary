// Tavily 網路搜尋（AI 查證／外食營養標示用）。整個模組在 TAVILY_API_KEY 未設定時安全空轉，
// 且任何失敗（額度用完、逾時、服務異常）一律回 null 靜默降級，絕不讓 OCR／評語主流程失敗。
//
// 額度防線（免費方案 1,000 credits/月，超過 Tavily 回 432 擋掉、不會計費；本地閘門讓行為可預期）：
//   1) 本地計數：search_usage 表按月累計，呼叫前以「單條原子 UPDATE」先扣後打——
//      檢查與累加合而為一，多請求並發也不可能用同一份餘額通過（better-sqlite3 同步執行）。
//      先扣再打的失誤方向是「多扣」（安全方向），由每日對帳修正。
//   2) 收到 432（Plan Limit Exceeded）視為硬停損：當月直接標記額度耗盡，不再重試。
//   3) 對帳：每天最多一次以官方 GET /usage 校正本地計數（取兩者較大值，只會更保守）。
// 搜尋結果快取 90 天：同一查詢（如同一道連鎖店品項）只花一次額度，全社群共用。
import { db } from './db.js';

const TAVILY_API_KEY = (process.env.TAVILY_API_KEY || '').trim();
const TAVILY_URL = 'https://api.tavily.com';
// 本地閘門上限（預設 950，留 50 緩衝給計數漂移；免費方案實際上限 1,000）
const MONTHLY_BUDGET = Math.max(0, Number(process.env.TAVILY_MONTHLY_BUDGET) || 950);
const TIMEOUT_MS = Math.max(3_000, Number(process.env.TAVILY_TIMEOUT_MS) || 12_000);
const CACHE_TTL_MS = 90 * 86400_000;
const RECONCILE_INTERVAL_MS = 24 * 3600_000;

export function searchActive(): boolean {
  return !!TAVILY_API_KEY && MONTHLY_BUDGET > 0;
}

export interface WebSearchResult {
  query: string;
  answer: string; // Tavily 的摘要式回答（可能為空字串）
  results: { title: string; url: string; content: string }[];
  fromCache: boolean;
}

function monthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 先扣後打：單條原子 UPDATE 完成「檢查餘額＋累加」，changes=0 即額度不足
function chargeCredits(cost: number): boolean {
  const month = monthKey();
  db.prepare('INSERT OR IGNORE INTO search_usage (month, used) VALUES (?, 0)').run(month);
  const info = db
    .prepare('UPDATE search_usage SET used = used + ? WHERE month = ? AND used + ? <= ?')
    .run(cost, month, cost, MONTHLY_BUDGET);
  return info.changes > 0;
}

// 432 硬停損：Tavily 端已判定額度用完，本地直接標記當月耗盡
function markExhausted() {
  const month = monthKey();
  db.prepare('INSERT OR IGNORE INTO search_usage (month, used) VALUES (?, 0)').run(month);
  db.prepare('UPDATE search_usage SET used = ? WHERE month = ?').run(MONTHLY_BUDGET, month);
}

// 每日對帳：以官方 /usage 校正本地計數（取較大值＝只會更保守，不放大額度）。
// 失敗就算了，下次再試；fire-and-forget，不阻塞搜尋主流程。
async function reconcileUsage(): Promise<void> {
  const month = monthKey();
  const row = db.prepare('SELECT reconciled_at FROM search_usage WHERE month = ?').get(month) as
    | { reconciled_at: number }
    | undefined;
  if (row && Date.now() - row.reconciled_at < RECONCILE_INTERVAL_MS) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TAVILY_URL}/usage`, {
      headers: { Authorization: `Bearer ${TAVILY_API_KEY}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      account?: { plan_usage?: number; usage?: number };
      key?: { usage?: number };
    };
    const remote = data.account?.plan_usage ?? data.account?.usage ?? data.key?.usage;
    if (typeof remote !== 'number' || !isFinite(remote) || remote < 0) return;
    db.prepare('UPDATE search_usage SET used = MAX(used, ?), reconciled_at = ? WHERE month = ?')
      .run(Math.round(remote), Date.now(), month);
  } catch {
    /* 對帳失敗不影響功能 */
  } finally {
    clearTimeout(timer);
  }
}

// 執行一次網路搜尋（basic depth＝1 credit）。快取命中不扣額度。
// 回 null 的情況：未設定 key、額度用完、逾時、Tavily 異常——呼叫端一律當「沒有網路資料」降級。
export async function webSearch(rawQuery: string): Promise<WebSearchResult | null> {
  if (!searchActive()) return null;
  const query = rawQuery.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!query) return null;

  const cached = db
    .prepare('SELECT result, created_at FROM search_cache WHERE query = ?')
    .get(query) as { result: string; created_at: number } | undefined;
  if (cached && Date.now() - cached.created_at < CACHE_TTL_MS) {
    try {
      const parsed = JSON.parse(cached.result) as Omit<WebSearchResult, 'fromCache'>;
      return { ...parsed, fromCache: true };
    } catch {
      /* 快取壞了就當沒有，往下重搜 */
    }
  }

  if (!chargeCredits(1)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TAVILY_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        include_answer: true,
        max_results: 5,
      }),
      signal: ctrl.signal,
    });
    if (res.status === 432) {
      markExhausted();
      console.error('tavily: plan limit exceeded (432), search disabled for this month');
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as {
      answer?: string;
      results?: { title?: string; url?: string; content?: string }[];
    };
    const results = (data.results ?? [])
      .filter((r) => r.url && (r.content || r.title))
      .slice(0, 5)
      .map((r) => ({
        title: (r.title || '').slice(0, 200),
        url: (r.url || '').slice(0, 500),
        content: (r.content || '').slice(0, 1500),
      }));
    if (!results.length && !data.answer) return null;
    const out = { query, answer: (data.answer || '').slice(0, 1500), results };
    db.prepare(
      `INSERT INTO search_cache (query, result, created_at) VALUES (?, ?, ?)
       ON CONFLICT(query) DO UPDATE SET result = excluded.result, created_at = excluded.created_at`
    ).run(query, JSON.stringify(out), Date.now());
    void reconcileUsage();
    return { ...out, fromCache: false };
  } catch (e) {
    console.error('tavily search failed:', e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 把搜尋結果組成給 LLM 的提示區塊（含來源，讓模型能引用）
export function webResultForPrompt(r: WebSearchResult): string {
  const lines: string[] = [];
  if (r.answer) lines.push(`摘要：${r.answer}`);
  r.results.forEach((s, i) => {
    lines.push(`來源${i + 1}【${s.title}】（${s.url}）：${s.content}`);
  });
  return lines.join('\n');
}

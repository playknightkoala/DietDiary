// 版本更新紀錄（單一來源）：資料放在 public/changelog.json，
// 由 nginx 靜態提供（永遠是最新部署的版本）。此檔同時被打包進 bundle 供
// 底部「版本紀錄」使用；強制更新視窗則會即時抓取 /changelog.json，
// 這樣舊 bundle 的使用者也能看到「新版」的更新內容。
// 每次改版時，只需在 changelog.json 最前面新增一筆（newest first）。
import changelogData from '../../public/changelog.json';

export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  notes: string[];
}

export const CHANGELOG: ChangelogEntry[] = changelogData as ChangelogEntry[];

// 取得某版本的更新內容（找不到回傳 null）
export function changelogFor(version: string | null): ChangelogEntry | null {
  if (!version) return null;
  return CHANGELOG.find((c) => c.version === version) ?? null;
}

// 即時抓取伺服器上最新的 changelog（供強制更新視窗使用）。
// 帶版號當快取破壞參數，避免拿到 nginx 快取的舊檔；失敗時回傳打包進 bundle 的版本。
export async function fetchChangelogFor(version: string | null): Promise<ChangelogEntry | null> {
  if (!version) return null;
  try {
    const res = await fetch(`/changelog.json?v=${encodeURIComponent(version)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as ChangelogEntry[];
    const entry = list.find((c) => c.version === version);
    if (entry) return entry;
  } catch {
    /* 抓取失敗時退回打包版本 */
  }
  return changelogFor(version);
}

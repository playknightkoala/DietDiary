// 版本更新紀錄（單一來源）：強制更新視窗與底部「版本紀錄」共用。
// 每次改版（bump 版號）時，在最前面新增一筆；newest first。
export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  notes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.2',
    date: '2026-07-15',
    notes: [
      '強制更新視窗會列出「這次更新內容」，直接看到新版更新了什麼',
      '頁面底部新增「版本紀錄」，可查看歷來各版本的更新內容',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-07-15',
    notes: [
      '「從歷史加入」改成餐別分頁切換（早餐／午餐／晚餐／宵夜／點心）',
      '歷史紀錄一次顯示筆數提高到 30 筆',
      '記錄餐點視窗的照片可點擊放大檢視',
      '營養師「編輯份數」視窗的照片也可點擊放大',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-07-15',
    notes: [
      '導入版號與「改版後強制更新」機制',
      '頁面底部顯示目前版號',
      '「從歷史加入」：可快速帶入記過的照片與六大類份數',
    ],
  },
];

// 取得某版本的更新內容（找不到回傳 null）
export function changelogFor(version: string | null): ChangelogEntry | null {
  if (!version) return null;
  return CHANGELOG.find((c) => c.version === version) ?? null;
}

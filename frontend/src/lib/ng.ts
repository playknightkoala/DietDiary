// NG 分類等級顯示名稱與配色。level 與後端 validation.ts 的 NG_LEVELS 是同步契約，
// 改任一邊要同步改另一邊（分類本身是資料，由後端 ng_categories 表提供，前端不再硬編碼）。
import type { MonthStatDay, MonthStats, NgLevel } from '../types';

export const NG_LEVELS: NgLevel[] = ['extreme', 'high', 'medium'];

export const NG_LEVEL_LABELS: Record<NgLevel, string> = {
  extreme: '極高',
  high: '高',
  medium: '中',
};

// 等級配色（沿用六大類列的色票：紅／橘／土黃）
export const NG_LEVEL_COLORS: Record<NgLevel, { fg: string; bg: string }> = {
  extreme: { fg: '#A8433A', bg: '#F5E3DB' },
  high: { fg: '#C77B4A', bg: '#F3E7D8' },
  medium: { fg: '#A8842E', bg: '#F1E8D2' },
};

// 超標／NG 判定的唯一實作（主頁統計文字與明細視窗共用，兩處各算一遍必然漂移）
export const isOverSugar = (d: MonthStatDay, stats: MonthStats) => d.sugar > stats.sugarLimit;
export const overSugarDays = (stats: MonthStats) => stats.days.filter((d) => isOverSugar(d, stats));
export const ngDays = (stats: MonthStats) => stats.days.filter((d) => d.ngHits.length > 0);

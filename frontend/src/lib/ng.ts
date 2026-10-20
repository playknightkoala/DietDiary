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

// 單日「飲食警示」判定：糖超標或有任一 NG 命中（週列／月曆紅燈共用；stats 未載入或月份不符＝不亮）
export const dayWarn = (stats: MonthStats | null | undefined, date: string): boolean => {
  if (!stats || stats.month !== date.slice(0, 7)) return false;
  const d = stats.days.find((x) => x.date === date);
  return !!d && (isOverSugar(d, stats) || d.ngHits.length > 0);
};

// 紅燈色票（週列、月曆、營養師月曆共用）
export const WARN_COLORS = {
  dot: '#C0564A',
  glow: 'rgba(192,86,74,.85)',
  bg: '#F8E6E2',
  border: '#E8B4A8',
  selDot: '#F5A79A', // 選取中（綠底）的紅燈圓點
  selGlow: 'rgba(245,167,154,.9)',
};

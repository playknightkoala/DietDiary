import { GUIDE_DATA } from '../lib/guideData';
import { useStore } from '../store';
import type { Food, FoodKey } from '../types';

export interface FoodInputGroup {
  name: string;
  glyph: string;
  tint: string;
  color: string;
  note: string;
  fields: { key: FoodKey; label: string }[];
}

export const FOOD_INPUT_GROUPS: FoodInputGroup[] = [
  { name: '蛋豆魚肉', glyph: '蛋', tint: '#F5E3DB', color: '#C0564A', note: '55–135 卡/份',
    fields: [
      { key: 'meatLow', label: '低脂（55卡）' },
      { key: 'meatMed', label: '中脂（75卡）' },
      { key: 'meatHigh', label: '高脂（120卡）' },
      { key: 'meatXHigh', label: '超高脂（135卡）' },
    ] },
  { name: '蔬菜', glyph: '蔬', tint: '#E3EBD9', color: '#4A7C59', note: '25 卡/份', fields: [{ key: 'veg', label: '份數' }] },
  { name: '全穀雜糧', glyph: '穀', tint: '#F1E8D2', color: '#A8842E', note: '70 卡/份', fields: [{ key: 'grain', label: '份數' }] },
  { name: '油脂堅果', glyph: '油', tint: '#F3E7D8', color: '#C77B4A', note: '45 卡/份', fields: [{ key: 'oil', label: '份數' }] },
  { name: '水果', glyph: '果', tint: '#F6E5E9', color: '#B5537A', note: '60 卡/份', fields: [{ key: 'fruit', label: '份數' }] },
  { name: '乳品', glyph: '乳', tint: '#E5EBF1', color: '#5B8DB8', note: '80–150 卡/份',
    fields: [
      { key: 'milkSkim', label: '脫脂（80卡）' },
      { key: 'milkLow', label: '低脂（120卡）' },
      { key: 'milkFull', label: '全脂（150卡）' },
    ] },
];

// 版面順序（三欄）：水果 蔬菜 全穀雜糧／蛋豆魚肉 乳品 油脂堅果
const LAYOUT_ORDER = ['水果', '蔬菜', '全穀雜糧', '蛋豆魚肉', '乳品', '油脂堅果'];
const ORDERED_GROUPS = LAYOUT_ORDER.map((n) => FOOD_INPUT_GROUPS.find((g) => g.name === n)!);

// 佔位文字用短欄位名（去掉卡數註記）
const shortLabel = (label: string) => label.split('（')[0];

interface FoodFieldsProps {
  foodStr: Record<FoodKey, string>;
  onChange: (key: FoodKey, raw: string) => void;
  onBlur: (key: FoodKey) => void;
}

// 六大類份數輸入表單（記錄飲食視窗與營養師編輯份數共用）
// 緊湊三欄版型：圓形圖示＋名稱＋直排輸入框；點圖示或名稱開啟該分類的份數指南
export function FoodFields({ foodStr, onChange, onBlur }: FoodFieldsProps) {
  const openGuide = useStore((s) => s.openGuide);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px 10px', borderTop: '1px solid #F0EDE3', paddingTop: 14 }}>
      {ORDERED_GROUPS.map((g) => (
        <div key={g.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <button
            onClick={() => openGuide(Math.max(0, GUIDE_DATA.findIndex((c) => c.name === g.name)))}
            title={`${g.note}・點我看「一份是多少？」`}
            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
          >
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: g.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, color: g.color, fontWeight: 900 }}>{g.glyph}</div>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: '#2D3B2D' }}>{g.name}</span>
          </button>
          {g.fields.map((f) => (
            <input
              key={f.key}
              type="number"
              min={0}
              max={99}
              step={0.1}
              placeholder={shortLabel(f.label)}
              title={f.label}
              value={foodStr[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
              onBlur={() => onBlur(f.key)}
              style={{ height: 38, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 8px', fontSize: 14.5, outline: 'none', background: '#FBFAF6', width: '100%', textAlign: 'center' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// 唯讀版份數列：動態牆貼文用，只顯示「分類圖示＋份數」（多欄位分類顯示合計；滑過看細項）
export function FoodSummaryGrid({ food }: { food: Food }) {
  const groups = ORDERED_GROUPS
    .map((g) => {
      const filled = g.fields.filter((f) => (food[f.key] || 0) > 0);
      const total = Math.round(filled.reduce((a, f) => a + (food[f.key] || 0), 0) * 10) / 10;
      return { g, filled, total };
    })
    .filter((x) => x.total > 0);
  if (!groups.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', borderTop: '1px solid #F0EDE3', paddingTop: 10 }}>
      {groups.map(({ g, filled, total }) => (
        <div
          key={g.name}
          title={`${g.name}：${filled.map((f) => `${shortLabel(f.label)} ${food[f.key]} 份`).join('、')}`}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <div style={{ width: 30, height: 30, flex: 'none', borderRadius: '50%', background: g.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13.5, color: g.color, fontWeight: 900 }}>{g.glyph}</div>
          <span style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 800, color: '#2D3B2D' }}>{total}</span>
        </div>
      ))}
    </div>
  );
}

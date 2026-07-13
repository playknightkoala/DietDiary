import type { FoodKey } from '../types';

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

interface FoodFieldsProps {
  foodStr: Record<FoodKey, string>;
  onChange: (key: FoodKey, raw: string) => void;
  onBlur: (key: FoodKey) => void;
}

// 六大類份數輸入表單（記錄飲食視窗與營養師編輯份數共用）
export function FoodFields({ foodStr, onChange, onBlur }: FoodFieldsProps) {
  return (
    <>
      {FOOD_INPUT_GROUPS.map((g) => (
        <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #F0EDE3', paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 30, height: 30, flex: 'none', borderRadius: 9, background: g.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: g.color, fontWeight: 900 }}>{g.glyph}</div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{g.name}</span>
            <span style={{ fontSize: 12, color: '#8A9284' }}>{g.note}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))', gap: 8 }}>
            {g.fields.map((f) => (
              <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, color: '#8A9284' }}>{f.label}</label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  step={0.1}
                  placeholder="0"
                  value={foodStr[f.key]}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  onBlur={() => onBlur(f.key)}
                  style={{ height: 42, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px', fontSize: 15, outline: 'none', background: '#FBFAF6', width: '100%', textAlign: 'center' }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

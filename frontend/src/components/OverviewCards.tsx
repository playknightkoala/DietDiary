import { useStore } from '../store';
import { KCAL, dayCustomKcal, dayFoodTotals, dayMacros, goalsFor, kcalOfFood, round1 } from '../lib/domain';
import type { Entry, FoodKey } from '../types';

// 熱量卡＋喝水卡（左欄上方 2 欄 grid）
export function KcalWaterRow() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const goals = useStore((s) => s.goals);

  // 六大類份數熱量＋自定義熱量項目（含糖飲料、酒精等）
  const totalKcal = kcalOfFood(dayFoodTotals(day.entries)) + dayCustomKcal(day.entries);
  const { water: waterGoal } = goalsFor(selected, goals);
  const waterOver = day.water > waterGoal * 1.2;
  const waterPct = Math.min(100, (day.water / waterGoal) * 100) + '%';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={{ background: '#4A7C59', color: '#F4F1EA', borderRadius: 20, padding: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>今日攝取熱量</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ fontFamily: 'Outfit', fontSize: 34, fontWeight: 800 }}>{totalKcal}</span>
          <span style={{ fontSize: 14, opacity: 0.8 }}>kcal</span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>依各餐份數自動累計</div>
      </div>
      <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 18, display: 'flex', flexDirection: 'column', gap: 8, border: '1.5px solid #E4DFD2' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, color: '#6B7565' }}>喝水</div>
          <div style={{ fontSize: 12, color: waterOver ? '#C0564A' : '#5B8DB8', fontWeight: 700 }}>{day.water} / {waterGoal} ml</div>
        </div>
        <div style={{ height: 10, borderRadius: 99, background: '#E9EFF4', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 99, background: '#5B8DB8', width: waterPct, transition: 'width .3s' }} />
        </div>
        <div style={{ fontSize: 12, color: '#8A9284' }}>目標 {waterGoal} ml</div>
      </div>
    </div>
  );
}

// 熱量及三大營養素卡：六大類份數換算醣類／蛋白質／脂質公克數（每份營養素見 domain.MACROS），
// 甜甜圈與百分比＝各營養素熱量（醣4／蛋白4／脂9 大卡每克）占總熱量的比例；
// 酒精與自訂項目只計熱量無法歸類，故三者百分比加總可能小於 100%
export function MacroCard() {
  const day = useStore((s) => s.day);
  return <MacroPanel entries={day.entries} />;
}

// 卡片本體（本人主頁與營養師檢視共用）
export function MacroPanel({ entries }: { entries: Entry[] }) {
  const m = dayMacros(entries);
  const totalKcal = kcalOfFood(dayFoodTotals(entries)) + dayCustomKcal(entries);
  const rows = [
    { name: '醣類', grams: m.carb, kcal: m.carb * 4, color: '#C0564A', tint: '#F5E3DB' },
    { name: '蛋白質', grams: m.protein, kcal: m.protein * 4, color: '#5B8DB8', tint: '#E5EBF1' },
    { name: '脂質', grams: m.fat, kcal: m.fat * 9, color: '#C77B4A', tint: '#F3E7D8' },
  ];
  const pctOf = (kcal: number) => (totalKcal > 0 ? Math.round((kcal / totalKcal) * 100) : 0);

  // 甜甜圈：三段弧依熱量占比排列，剩餘（酒精／自訂/四捨五入）留灰底
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = rows.map((r) => {
    const frac = totalKcal > 0 ? Math.min(1, r.kcal / totalKcal) : 0;
    const seg = { color: r.color, len: frac * C, offset: acc };
    acc += frac * C;
    return seg;
  });

  return (
    <div style={{ background: '#FFFFFF', borderRadius: 20, border: '1.5px solid #E4DFD2', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 900 }}>熱量及三大營養素</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* 左：三大營養素長條與公克數 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((r) => (
            <div key={r.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.color, flex: 'none' }} />
                <span style={{ fontSize: 13.5, fontWeight: 800, color: '#2D3B2D' }}>{r.name}</span>
              </div>
              <div style={{ height: 7, borderRadius: 99, background: r.tint, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 99, background: r.color, width: `${pctOf(r.kcal)}%`, transition: 'width .3s' }} />
              </div>
              <div style={{ fontSize: 12, color: '#8A9284' }}>
                已攝取 <span style={{ fontSize: 14, fontWeight: 800, color: r.color, fontFamily: 'Outfit' }}>{r.grams}</span> 公克
              </div>
            </div>
          ))}
        </div>
        {/* 右：熱量甜甜圈＋占比 */}
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', width: 110, height: 110 }}>
            <svg width="110" height="110" viewBox="0 0 110 110" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="55" cy="55" r={R} fill="none" stroke="#F0EDE3" strokeWidth="13" />
              {arcs.map((a, i) =>
                a.len > 0 ? (
                  <circle
                    key={i}
                    cx="55" cy="55" r={R} fill="none"
                    stroke={a.color} strokeWidth="13" strokeLinecap="butt"
                    strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.offset}
                  />
                ) : null
              )}
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 800, color: '#2D3B2D', lineHeight: 1.1 }}>{totalKcal}</span>
              <span style={{ fontSize: 11, color: '#8A9284' }}>大卡</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {rows.map((r) => (
              <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flex: 'none' }} />
                <span style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 800, color: r.color }}>{pctOf(r.kcal)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 精緻糖：自定義「糖」項目的克數累計 */}
      <div style={{ background: '#F7F5EF', borderRadius: 12, padding: '9px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#A8433A', flex: 'none' }} />
        <span style={{ fontSize: 13, fontWeight: 800, color: '#4A5A4A' }}>精緻糖</span>
        <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 800, color: '#A8433A' }}>{m.sugar}</span>
        <span style={{ fontSize: 12.5, color: '#6B7565' }}>公克</span>
      </div>
      <div style={{ fontSize: 11.5, color: '#8A9284', lineHeight: 1.6 }}>
        依六大類份數與自定義項目換算（每份營養素見份數指南）；酒精與自訂項目僅計入熱量，不計入三大營養素。
      </div>
    </div>
  );
}

interface RowCfg {
  name: string;
  glyph: string;
  tint: string;
  color: string;
  gkey: 'meat' | 'veg' | 'grain' | 'oil' | 'fruit' | 'milk';
  keys: FoodKey[];
}

const ROW_CFGS: RowCfg[] = [
  { name: '蛋豆魚肉', glyph: '蛋', tint: '#F5E3DB', color: '#C0564A', gkey: 'meat', keys: ['meatLow', 'meatMed', 'meatHigh', 'meatXHigh'] },
  { name: '蔬菜', glyph: '蔬', tint: '#E3EBD9', color: '#4A7C59', gkey: 'veg', keys: ['veg'] },
  { name: '全穀雜糧', glyph: '穀', tint: '#F1E8D2', color: '#A8842E', gkey: 'grain', keys: ['grain'] },
  { name: '油脂堅果', glyph: '油', tint: '#F3E7D8', color: '#C77B4A', gkey: 'oil', keys: ['oil'] },
  { name: '水果', glyph: '果', tint: '#F6E5E9', color: '#B5537A', gkey: 'fruit', keys: ['fruit'] },
  { name: '乳品', glyph: '乳', tint: '#E5EBF1', color: '#5B8DB8', gkey: 'milk', keys: ['milkSkim', 'milkLow', 'milkFull'] },
];

// 六大類總覽卡
export function FoodGroupsCard() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const goals = useStore((s) => s.goals);
  const openGuide = useStore((s) => s.openGuide);

  const dayTot = dayFoodTotals(day.entries);
  const gInfo = goalsFor(selected, goals);

  return (
    <div style={{ background: '#FFFFFF', borderRadius: 20, border: '1.5px solid #E4DFD2', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>六大類飲食份數</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: gInfo.setBy === 'dietitian' ? '#5B8DB8' : '#6B7565', fontWeight: gInfo.setBy === 'dietitian' ? 700 : 400 }}>
            目標：{gInfo.setBy === 'dietitian' ? '營養師設定' : gInfo.custom ? '自訂區間' : '預設'}
          </div>
          <button onClick={() => openGuide()} className="hv-cream" style={{ flex: 'none', border: '1px solid #4A7C59', color: '#4A7C59', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2.5" /></svg>
            份數指南
          </button>
        </div>
      </div>
      {ROW_CFGS.map((cfg) => {
        const total = round1(cfg.keys.reduce((a, k) => a + dayTot[k], 0));
        const kcal = Math.round(cfg.keys.reduce((a, k) => a + dayTot[k] * KCAL[k], 0));
        const goal = gInfo.vals[cfg.gkey];
        // 目標為 0 時吃任何份數都算超標：跑條全滿＋紅字
        const over = goal > 0 ? total > goal * 1.2 : total > 0;
        const pct = Math.min(100, goal > 0 ? (total / goal) * 100 : total > 0 ? 100 : 0) + '%';
        return (
          <div key={cfg.gkey} style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '8px 0 2px', borderTop: '1px solid #F0EDE3' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, flex: 'none', borderRadius: 10, background: cfg.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: cfg.color, fontWeight: 900 }}>{cfg.glyph}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{cfg.name}</span>
                <span style={{ fontSize: 12, color: '#8A9284' }}>{kcal} kcal</span>
              </div>
              <div style={{ fontSize: 13.5, color: over ? '#C0564A' : '#2D3B2D', fontWeight: over ? 900 : 700 }}>{total} / {goal} 份</div>
            </div>
            <div style={{ height: 7, borderRadius: 99, background: '#F0EDE3', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 99, background: over ? '#C0564A' : cfg.color, width: pct, transition: 'width .3s' }} />
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11.5, color: '#8A9284' }}>紅字表示超過目標 20% 以上。點右下「＋」記錄，下方動態牆可查看每筆內容。</div>
    </div>
  );
}

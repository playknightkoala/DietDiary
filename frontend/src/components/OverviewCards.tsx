import { useStore } from '../store';
import { KCAL, dayFoodTotals, goalsFor, kcalOfFood, round1 } from '../lib/domain';
import type { FoodKey } from '../types';

// 熱量卡＋喝水卡（左欄上方 2 欄 grid）
export function KcalWaterRow() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const goals = useStore((s) => s.goals);

  const totalKcal = kcalOfFood(dayFoodTotals(day.entries));
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
  const setModal = useStore((s) => s.setModal);

  const dayTot = dayFoodTotals(day.entries);
  const gInfo = goalsFor(selected, goals);

  return (
    <div style={{ background: '#FFFFFF', borderRadius: 20, border: '1.5px solid #E4DFD2', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>六大類飲食份數</div>
        <div style={{ fontSize: 12, color: gInfo.setBy === 'dietitian' ? '#5B8DB8' : '#6B7565', fontWeight: gInfo.setBy === 'dietitian' ? 700 : 400 }}>
          目標：{gInfo.setBy === 'dietitian' ? '營養師設定' : gInfo.custom ? '自訂區間' : '預設'}
        </div>
      </div>
      {ROW_CFGS.map((cfg) => {
        const total = round1(cfg.keys.reduce((a, k) => a + dayTot[k], 0));
        const kcal = Math.round(cfg.keys.reduce((a, k) => a + dayTot[k] * KCAL[k], 0));
        const goal = gInfo.vals[cfg.gkey];
        const over = goal > 0 && total > goal * 1.2;
        const pct = Math.min(100, goal > 0 ? (total / goal) * 100 : 0) + '%';
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
      <div style={{ fontSize: 11.5, color: '#8A9284' }}>紅字表示超過目標 20% 以上。點右下「＋」記錄。</div>
      <button onClick={() => setModal('meals')} className="hv-cream" style={{ height: 44, border: '1.5px solid #4A7C59', borderRadius: 13, background: '#fff', color: '#4A7C59', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
        查看今日飲食
      </button>
    </div>
  );
}

// 今日運動卡
export function ExerciseCard() {
  const day = useStore((s) => s.day);
  const hasEx = (day.ex.min && +day.ex.min > 0) || day.ex.desc;
  const exSummary = hasEx
    ? (day.ex.min ? day.ex.min + ' 分鐘' : '') + (day.ex.min && day.ex.desc ? '・' : '') + (day.ex.desc || '')
    : '尚未記錄，點右下「＋」新增。';

  return (
    <div style={{ background: '#FFFFFF', borderRadius: 20, border: '1.5px solid #E4DFD2', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C77B4A" strokeWidth="2" strokeLinecap="round"><path d="M6.5 6.5l11 11M4 10l6-6M14 20l6-6M3 7l4-4M17 21l4-4" /></svg>
        <div style={{ fontSize: 16, fontWeight: 900 }}>今日運動</div>
      </div>
      <div style={{ fontSize: 14, color: '#4A5A4A', lineHeight: 1.6 }}>{exSummary}</div>
    </div>
  );
}

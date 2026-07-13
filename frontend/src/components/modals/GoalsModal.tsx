import { useState } from 'react';
import { api } from '../../lib/api';
import { DEFAULT_GOALS, DEFAULT_WATER, addDays, dstr } from '../../lib/domain';
import { useStore } from '../../store';
import type { GoalKey } from '../../types';
import { CloseButton, ModalShell } from './ModalShell';

const GOAL_DEFS: { k: GoalKey; name: string }[] = [
  { k: 'meat', name: '蛋豆魚肉' },
  { k: 'veg', name: '蔬菜' },
  { k: 'grain', name: '全穀雜糧' },
  { k: 'oil', name: '油脂堅果' },
  { k: 'fruit', name: '水果' },
  { k: 'milk', name: '乳品' },
];

interface Draft {
  start: string;
  end: string;
  vals: Record<GoalKey, string>;
  water: string;
}

export function GoalsModal() {
  const goals = useStore((s) => s.goals);
  const loadGoals = useStore((s) => s.loadGoals);
  const closeModal = useStore((s) => s.closeModal);

  const [draft, setDraft] = useState<Draft>(() => {
    if (goals) {
      const vals = {} as Record<GoalKey, string>;
      GOAL_DEFS.forEach(({ k }) => (vals[k] = String(goals.vals[k])));
      return { start: goals.start, end: goals.end, vals, water: String(goals.water) };
    }
    const today = dstr(new Date());
    const vals = {} as Record<GoalKey, string>;
    GOAL_DEFS.forEach(({ k }) => (vals[k] = String(DEFAULT_GOALS[k])));
    return { start: today, end: addDays(today, 27), vals, water: String(DEFAULT_WATER) };
  });
  const [error, setError] = useState('');

  const save = async () => {
    if (!draft.start || !draft.end || draft.end < draft.start) {
      setError('請確認日期區間（結束不可早於開始）');
      return;
    }
    const vals = {} as Record<GoalKey, number>;
    GOAL_DEFS.forEach(({ k }) => (vals[k] = Math.min(99, Math.max(0, parseFloat(draft.vals[k]) || 0))));
    const water = Math.min(999999, Math.max(0, Math.round(parseFloat(draft.water))) || DEFAULT_WATER);
    await api.putGoals({ start: draft.start, end: draft.end, vals, water });
    await loadGoals();
    closeModal();
  };

  const clear = async () => {
    await api.deleteGoals();
    await loadGoals();
    closeModal();
  };

  const numInputStyle = {
    width: 100, height: 40, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px',
    fontSize: 15, outline: 'none', background: '#FBFAF6', textAlign: 'center',
  } as const;

  return (
    <ModalShell maxWidth={420} cardStyle={{ padding: 22, maxHeight: '86vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>階段目標</div>
        <CloseButton onClick={closeModal} />
      </div>
      <div style={{ fontSize: 12.5, color: '#6B7565' }}>
        設定一段日期區間的每日目標；未設定的日期使用預設（蛋豆魚肉 7、蔬菜 3、全穀雜糧 10、油脂堅果 3、水果 2、乳品 2 份，喝水 2000ml）。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12, color: '#6B7565' }}>開始日期</label>
          <input type="date" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} style={{ height: 42, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px', fontSize: 14, outline: 'none', background: '#FBFAF6' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12, color: '#6B7565' }}>結束日期</label>
          <input type="date" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} style={{ height: 42, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px', fontSize: 14, outline: 'none', background: '#FBFAF6' }} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {GOAL_DEFS.map((g) => (
          <div key={g.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{g.name} <span style={{ fontSize: 12, color: '#8A9284', fontWeight: 400 }}>份</span></span>
            <input type="number" step={0.5} min={0} value={draft.vals[g.k]} onChange={(e) => setDraft((d) => ({ ...d, vals: { ...d.vals, [g.k]: e.target.value } }))} style={numInputStyle} />
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>喝水 <span style={{ fontSize: 12, color: '#8A9284', fontWeight: 400 }}>ml</span></span>
          <input type="number" step={50} min={0} value={draft.water} onChange={(e) => setDraft((d) => ({ ...d, water: e.target.value }))} style={numInputStyle} />
        </div>
      </div>
      {error && <div style={{ fontSize: 12.5, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={closeModal} className="hv-sand" style={{ flex: 1, height: 46, border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', fontSize: 15, fontWeight: 700, color: '#4A5A4A', cursor: 'pointer' }}>取消</button>
        <button onClick={() => void save()} className="hv-green" style={{ flex: 2, height: 46, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>儲存目標</button>
      </div>
      {goals && (
        <div style={{ fontSize: 12.5, color: '#6B7565', borderTop: '1px solid #F0EDE3', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>目前目標區間：{goals.start} ～ {goals.end}</span>
          <button onClick={() => void clear()} style={{ border: 'none', background: 'transparent', color: '#C0564A', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>清除</button>
        </div>
      )}
    </ModalShell>
  );
}

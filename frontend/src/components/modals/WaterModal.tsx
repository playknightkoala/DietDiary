import { useState } from 'react';
import { api } from '../../lib/api';
import { goalsFor } from '../../lib/domain';
import { useStore } from '../../store';
import { CloseButton, ModalShell } from './ModalShell';

export function WaterModal() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const goals = useStore((s) => s.goals);
  const refresh = useStore((s) => s.refresh);
  const closeModal = useStore((s) => s.closeModal);
  const [input, setInput] = useState('');

  const { water: waterGoal } = goalsFor(selected, goals);

  const addWater = async () => {
    let n = parseFloat(input);
    if (isNaN(n) || n <= 0) return;
    n = Math.min(9999, Math.round(n));
    await api.patchDay(selected, { water: day.water + n });
    setInput('');
    await refresh();
  };

  const resetWater = async () => {
    await api.patchDay(selected, { water: 0 });
    await refresh();
  };

  return (
    <ModalShell maxWidth={400} cardStyle={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>記錄喝水</div>
        <CloseButton onClick={closeModal} />
      </div>
      <div style={{ background: '#F0F5FA', borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, color: '#5B8DB8', fontWeight: 700 }}>今日累計</span>
        <span style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 800, color: '#2D3B2D' }}>
          {day.water} <span style={{ fontSize: 13, fontWeight: 500, color: '#8A9284' }}>/ {waterGoal} ml</span>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 12.5, color: '#6B7565' }}>本次喝水量（ml，正數自行輸入）</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            min={1}
            max={9999}
            step={1}
            placeholder="例：350"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addWater(); }}
            style={{ flex: 1, height: 46, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 12px', fontSize: 16, outline: 'none', background: '#FBFAF6', minWidth: 0 }}
          />
          <button onClick={() => void addWater()} className="hv-blue" style={{ flex: 'none', height: 46, padding: '0 20px', border: 'none', borderRadius: 12, background: '#5B8DB8', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>加入</button>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: '#8A9284' }}>
        <span>輸入錯了？</span>
        <button onClick={() => void resetWater()} style={{ border: 'none', background: 'transparent', color: '#C0564A', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>歸零重記</button>
      </div>
    </ModalShell>
  );
}

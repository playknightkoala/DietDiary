import { useState } from 'react';
import { api } from '../../lib/api';
import { MEALS, nowHM } from '../../lib/domain';
import { useStore } from '../../store';
import { CloseButton } from './ModalShell';

// 身體數據改由「身體數據」卡片右上角直接記錄
const EXTRA_OPTIONS = [
  { name: '喝水', glyph: '水', tint: '#E5EBF1', color: '#5B8DB8', modal: 'logWater' as const },
  { name: '運動', glyph: '動', tint: '#F3E7D8', color: '#C77B4A', modal: 'logEx' as const },
];

export function AddMenuSheet() {
  const selected = useStore((s) => s.selected);
  const setModal = useStore((s) => s.setModal);
  const openLogFood = useStore((s) => s.openLogFood);
  const loadDay = useStore((s) => s.loadDay);
  const closeModal = useStore((s) => s.closeModal);
  const [busy, setBusy] = useState(false);

  const pickMeal = async (meal: (typeof MEALS)[number]) => {
    if (busy) return;
    setBusy(true);
    try {
      const entry = await api.createEntry(selected, meal.k, nowHM());
      await loadDay();
      openLogFood(entry.id);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(45,59,45,.4)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }}>
      <div style={{ background: '#fff', borderRadius: '24px 24px 0 0', padding: '20px 20px 30px', width: '100%', maxWidth: 480, animation: 'fadeUp .25s ease both', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ width: 34 }} />
          <div style={{ fontSize: 16, fontWeight: 900 }}>記錄什麼？</div>
          <CloseButton onClick={closeModal} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
          {MEALS.map((m) => (
            <button key={m.k} onClick={() => void pickMeal(m)} className="hv-cream" style={{ border: '1.5px solid #E4DFD2', borderRadius: 18, background: '#FBFAF6', padding: '18px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: m.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: m.color, fontWeight: 900 }}>{m.glyph}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2D3B2D' }}>{m.name}</div>
            </button>
          ))}
          {EXTRA_OPTIONS.map((o) => (
            <button key={o.name} onClick={() => setModal(o.modal)} className="hv-cream" style={{ border: '1.5px solid #E4DFD2', borderRadius: 18, background: '#FBFAF6', padding: '18px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: o.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: o.color, fontWeight: 900 }}>{o.glyph}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2D3B2D' }}>{o.name}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { BODY_DEFS } from '../../lib/domain';
import { useStore } from '../../store';
import type { BodyKey } from '../../types';
import { CloseButton, ModalShell } from './ModalShell';

export function BodyModal() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const trendOpen = useStore((s) => s.trendOpen);
  const loadTrend = useStore((s) => s.loadTrend);
  const refresh = useStore((s) => s.refresh);
  const closeModal = useStore((s) => s.closeModal);
  const [body, setBody] = useState<Record<BodyKey, string>>({ ...day.body });
  const closing = useRef(false);

  const finish = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await api.patchDay(selected, { body });
      await refresh();
      if (trendOpen) await loadTrend();
    } finally {
      closeModal();
    }
  };

  return (
    <ModalShell maxWidth={420} cardStyle={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>記錄身體數據</div>
        <CloseButton onClick={() => void finish()} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
        {BODY_DEFS.map((b) => (
          <div key={b.k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#6B7565' }}>{b.name}（{b.unit}）</label>
            <input
              type="number"
              step={0.1}
              min={0}
              value={body[b.k]}
              onChange={(e) => setBody((s) => ({ ...s, [b.k]: e.target.value }))}
              placeholder="—"
              style={{ height: 44, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 12px', fontSize: 15, outline: 'none', background: '#FBFAF6', width: '100%' }}
            />
          </div>
        ))}
      </div>
      <button onClick={() => void finish()} className="hv-green" style={{ height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>完成</button>
    </ModalShell>
  );
}

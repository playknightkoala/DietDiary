import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useStore } from '../../store';
import { CloseButton, ModalShell } from './ModalShell';

export function ExerciseModal() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const refresh = useStore((s) => s.refresh);
  const closeModal = useStore((s) => s.closeModal);
  const [min, setMin] = useState(day.ex.min);
  const [desc, setDesc] = useState(day.ex.desc);
  const closing = useRef(false);

  // 完成與 ✕ 皆儲存（原型輸入即存檔的等效行為）
  const finish = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await api.patchDay(selected, { ex: { min: min.trim(), desc } });
      await refresh();
    } finally {
      closeModal();
    }
  };

  return (
    <ModalShell maxWidth={400} cardStyle={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>記錄運動</div>
        <CloseButton onClick={() => void finish()} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 12.5, color: '#6B7565' }}>運動時間（分鐘）</label>
        <input
          type="number"
          min={0}
          max={1440}
          step={1}
          placeholder="例：30"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          style={{ height: 46, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 12px', fontSize: 16, outline: 'none', background: '#FBFAF6' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 12.5, color: '#6B7565' }}>運動描述</label>
        <textarea
          rows={3}
          placeholder="例：慢跑 5 公里、瑜珈、重訓⋯"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          style={{ border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '10px 12px', fontSize: 15, outline: 'none', background: '#FBFAF6', resize: 'none' }}
        />
      </div>
      <button onClick={() => void finish()} className="hv-green" style={{ height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>完成</button>
    </ModalShell>
  );
}

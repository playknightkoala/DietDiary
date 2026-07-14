import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// 照片放大檢視（取代另開新視窗）：點背景或 ✕ 關閉
// 多張照片時可左右滑動（觸控）、點兩側箭頭或按 ←→ 切換；Esc 關閉
// caption：每張照片下方的資訊面板（份數摘要、評分按鈕等）
// zIndex 80：需蓋在一般彈窗（50）與指南（60）之上
export function Lightbox({ photos, index: initialIndex, onClose, caption }: { photos: string[]; index: number; onClose: () => void; caption?: (url: string) => ReactNode }) {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), photos.length - 1));
  const touchX = useRef<number | null>(null);
  const many = photos.length > 1;

  const prev = () => setIndex((i) => (i - 1 + photos.length) % photos.length);
  const next = () => setIndex((i) => (i + 1) % photos.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (!many) return;
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, onClose]);

  const navBtnStyle = (side: 'left' | 'right') =>
    ({
      position: 'fixed', [side]: 14, top: '50%', transform: 'translateY(-50%)',
      width: 44, height: 44, border: 'none', borderRadius: 14,
      background: 'rgba(255,255,255,.16)', color: '#fff', fontSize: 22, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }) as const;

  return (
    <div
      onClick={onClose}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null || !many) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 40) (dx > 0 ? prev() : next());
      }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,26,20,.85)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minHeight: 0 }}
      >
        <img
          key={photos[index]}
          src={photos[index]}
          alt=""
          style={{ maxWidth: '100%', minHeight: 0, flex: '0 1 auto', objectFit: 'contain', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.45)', animation: 'popIn .2s ease both' }}
        />
        {caption && (
          <div style={{ flex: 'none', maxWidth: 520, width: '100%', background: 'rgba(20,26,20,.72)', borderRadius: 14, padding: '10px 14px', color: '#F4F1EA' }}>
            {caption(photos[index])}
          </div>
        )}
      </div>
      {many && (
        <>
          <button onClick={(e) => { e.stopPropagation(); prev(); }} title="上一張" style={navBtnStyle('left')}>‹</button>
          <button onClick={(e) => { e.stopPropagation(); next(); }} title="下一張" style={navBtnStyle('right')}>›</button>
          <div style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', color: '#fff', fontSize: 13, fontWeight: 700, background: 'rgba(20,26,20,.55)', borderRadius: 99, padding: '4px 14px', pointerEvents: 'none', fontFamily: 'Outfit' }}>
            {index + 1} / {photos.length}
          </div>
        </>
      )}
      <button
        onClick={onClose}
        title="關閉"
        style={{ position: 'fixed', top: 14, right: 14, width: 38, height: 38, border: 'none', borderRadius: 12, background: 'rgba(255,255,255,.16)', color: '#fff', fontSize: 17, cursor: 'pointer' }}
      >
        ✕
      </button>
    </div>
  );
}

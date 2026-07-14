import type { CSSProperties, ReactNode } from 'react';

// 共用彈窗外殼：置中卡片 + popIn。依規格「不可點背景關閉」，overlay 不綁 onClick。
export function ModalShell({ children, maxWidth, cardStyle, zIndex = 50 }: { children: ReactNode; maxWidth: number; cardStyle?: CSSProperties; zIndex?: number }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(45,59,45,.4)', zIndex, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        style={{
          background: '#fff', borderRadius: 22, width: '100%', maxWidth,
          animation: 'popIn .25s ease both', boxShadow: '0 24px 60px rgba(45,59,45,.25)',
          ...cardStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClick, fontSize = 16 }: { onClick: () => void; fontSize?: number }) {
  return (
    <button onClick={onClick} style={{ width: 34, height: 34, border: 'none', borderRadius: 10, background: '#F4F1EA', cursor: 'pointer', fontSize, color: '#4A5A4A' }}>
      ✕
    </button>
  );
}

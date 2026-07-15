import { useState } from 'react';
import { APP_VERSION } from '../lib/version';
import { ChangelogModal } from './modals/ChangelogModal';

// 頁面底部版號 ＋「版本紀錄」；點開看每個版本更新了什麼
export function VersionFooter({ style }: { style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ textAlign: 'center', fontFamily: 'Outfit', fontSize: 11.5, color: '#A7AE9F', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...style }}>
      <span>均衡日記 v{APP_VERSION}</span>
      <span aria-hidden>·</span>
      <button
        onClick={() => setOpen(true)}
        className="hv-cream"
        style={{ border: 'none', background: 'transparent', color: '#8A9284', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}
      >
        版本紀錄
      </button>
      {open && <ChangelogModal onClose={() => setOpen(false)} />}
    </div>
  );
}

import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';

const iconBtnStyle: CSSProperties = {
  width: 38, height: 38, border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="hv-cream" style={iconBtnStyle}>
      {children}
    </button>
  );
}

export function TopBar() {
  const setModal = useStore((s) => s.setModal);
  const openCalendar = useStore((s) => s.openCalendar);
  const logout = useStore((s) => s.logout);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 11, background: '#4A7C59', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F4F1EA" strokeWidth="2" strokeLinecap="round"><path d="M12 21c4.5 0 8-3.5 8-9V5l-8-2-8 2v7c0 5.5 3.5 9 8 9z" /></svg>
        </div>
        <div style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 800, color: '#2D3B2D' }}>均衡日記</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconBtn title="月曆" onClick={openCalendar}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 9h18" /></svg>
        </IconBtn>
        <IconBtn title="目標設定" onClick={() => setModal('goals')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="#4A5A4A" /></svg>
        </IconBtn>
        <IconBtn title="份數指南" onClick={() => setModal('guide')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2.5" /></svg>
        </IconBtn>
        <IconBtn title="登出" onClick={logout}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
        </IconBtn>
      </div>
    </div>
  );
}

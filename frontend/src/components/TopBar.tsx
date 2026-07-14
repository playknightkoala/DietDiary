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
  const setGuideTab = useStore((s) => s.setGuideTab);
  const openCalendar = useStore((s) => s.openCalendar);
  const logout = useStore((s) => s.logout);
  const role = useStore((s) => s.role);
  const setView = useStore((s) => s.setView);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 11, background: '#4A7C59', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F4F1EA" strokeWidth="2" strokeLinecap="round"><path d="M12 21c4.5 0 8-3.5 8-9V5l-8-2-8 2v7c0 5.5 3.5 9 8 9z" /></svg>
        </div>
        <div style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 800, color: '#2D3B2D' }}>均衡日記</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {(role === 'dietitian' || role === 'admin') && (
          <IconBtn title="營養師頁面" onClick={() => setView('pro')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B8DB8" strokeWidth="2" strokeLinecap="round"><path d="M8 3v5a4 4 0 0 0 8 0V3" /><path d="M12 12v3a5 5 0 0 1-5 5" /><circle cx="19" cy="17" r="2.5" /></svg>
          </IconBtn>
        )}
        {role === 'admin' && (
          <IconBtn title="管理者後台" onClick={() => setView('admin')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C77B4A" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
          </IconBtn>
        )}
        <IconBtn title="月曆" onClick={openCalendar}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 9h18" /></svg>
        </IconBtn>
        <IconBtn title="目標設定" onClick={() => setModal('goals')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="#4A5A4A" /></svg>
        </IconBtn>
        <IconBtn title="份數指南" onClick={() => { setGuideTab(0); setModal('guide'); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2.5" /></svg>
        </IconBtn>
        <IconBtn title="會員中心" onClick={() => setModal('account')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></svg>
        </IconBtn>
        <IconBtn title="登出" onClick={logout}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
        </IconBtn>
      </div>
    </div>
  );
}

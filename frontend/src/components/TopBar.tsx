import { useState, type CSSProperties, type ReactNode } from 'react';
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
  const openGuide = useStore((s) => s.openGuide);
  const openCalendar = useStore((s) => s.openCalendar);
  const unreadCount = useStore((s) => s.unreadCount);
  const logout = useStore((s) => s.logout);
  const role = useStore((s) => s.role);
  const setView = useStore((s) => s.setView);
  // 「更多功能」下拉選單：把不常用的按鈕收成一顆（通知與營養師／管理者入口維持常駐）
  const [menuOpen, setMenuOpen] = useState(false);

  const menuItems: { title: string; icon: ReactNode; onClick: () => void }[] = [
    {
      title: '月曆',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 9h18" /></svg>,
      onClick: openCalendar,
    },
    {
      title: '身體數據',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M12 3v18M5 8c2-2 12-2 14 0M5 16c2 2 12 2 14 0" /></svg>,
      onClick: () => setModal('bodyView'),
    },
    {
      title: '目標設定',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="#4A5A4A" /></svg>,
      onClick: () => setModal('goals'),
    },
    {
      title: '份數指南',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2.5" /></svg>,
      onClick: () => openGuide(),
    },
    {
      title: '介面自定義',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18" cy="12" r="2.5" /><circle cx="15" cy="18" r="2.5" /></svg>,
      onClick: () => setModal('layout'),
    },
    {
      title: '會員中心',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></svg>,
      onClick: () => setModal('account'),
    },
    {
      title: '登出',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
      onClick: logout,
    },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 20px 8px' }}>
      {/* 標題固定不換行、不被壓縮，管理者圖示較多時只讓右側圖示換行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
        <div style={{ width: 34, height: 34, flex: 'none', borderRadius: 11, background: '#4A7C59', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F4F1EA" strokeWidth="2" strokeLinecap="round"><path d="M12 21c4.5 0 8-3.5 8-9V5l-8-2-8 2v7c0 5.5 3.5 9 8 9z" /></svg>
        </div>
        <div style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 800, color: '#2D3B2D', whiteSpace: 'nowrap' }}>均衡日記</div>
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
        <div style={{ position: 'relative' }}>
          <IconBtn title="通知" onClick={() => setModal('notify')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          </IconBtn>
          {unreadCount > 0 && (
            <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 99, background: '#C0564A', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', pointerEvents: 'none' }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
        {/* 更多功能：月曆／目標設定／份數指南／會員中心／登出 */}
        <div style={{ position: 'relative' }}>
          <IconBtn title="更多功能" onClick={() => setMenuOpen((o) => !o)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </IconBtn>
          {menuOpen && (
            <>
              {/* 點選單以外的地方關閉 */}
              <div style={{ position: 'fixed', inset: 0, zIndex: 55 }} onClick={() => setMenuOpen(false)} />
              <div style={{ position: 'absolute', top: 44, right: 0, zIndex: 56, background: '#fff', border: '1.5px solid #E4DFD2', borderRadius: 14, boxShadow: '0 12px 32px rgba(45,59,45,.16)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 168, animation: 'fadeUp .15s ease both' }}>
                {menuItems.map((it) => (
                  <button
                    key={it.title}
                    onClick={() => { setMenuOpen(false); it.onClick(); }}
                    className="hv-cream"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'transparent', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 700, color: '#2D3B2D', cursor: 'pointer', textAlign: 'left' }}
                  >
                    {it.icon}
                    {it.title}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

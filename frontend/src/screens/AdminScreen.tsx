import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { useStore } from '../store';
import type { AdminUser, Role } from '../types';

const ROLE_NAMES: Record<Role, string> = { member: '一般會員', citizen: '駒駒國民', dietitian: '營養師', admin: '管理者' };

const backBtnStyle: CSSProperties = {
  height: 38, padding: '0 14px', border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff',
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: '#4A5A4A',
};

export function AdminScreen() {
  const setView = useStore((s) => s.setView);
  const username = useStore((s) => s.username);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setError('');
    try {
      setUsers(await api.adminUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入會員清單失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const run = async (id: number, fn: () => Promise<void>) => {
    if (busyId !== null) return;
    setBusyId(id);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗，請再試一次');
    } finally {
      setBusyId(null);
    }
  };

  const approve = (u: AdminUser) => run(u.id, async () => { await api.adminApprove(u.id); });
  const setRole = (u: AdminUser, role: Role) => run(u.id, async () => { await api.adminPatchUser(u.id, { role }); });
  const suspend = (u: AdminUser) =>
    run(u.id, async () => {
      if (!window.confirm(`確定要停用 ${u.username}？停用後該帳號將無法登入，需重新開通。`)) return;
      await api.adminPatchUser(u.id, { status: 'pending' });
    });
  const remove = (u: AdminUser) =>
    run(u.id, async () => {
      if (!window.confirm(`確定要刪除 ${u.username}？此操作會一併刪除該會員的所有紀錄與照片，且無法復原。`)) return;
      await api.adminDeleteUser(u.id);
    });

  return (
    <div style={{ minHeight: '100vh', maxWidth: 900, margin: '0 auto', padding: '0 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 11, background: '#C77B4A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F4F1EA" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
          </div>
          <div style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 800, color: '#2D3B2D' }}>管理者後台</div>
        </div>
        <button onClick={() => setView('diary')} className="hv-cream" style={backBtnStyle}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          回到日記
        </button>
      </div>

      <div style={{ fontSize: 12.5, color: '#6B7565' }}>
        新註冊的帳號需在此開通後才能登入。也可以在這裡調整會員身分（一般會員／營養師／管理者）、停用或刪除會員。
      </div>
      {error && <div style={{ fontSize: 13, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
      {loading && <div style={{ padding: 30, textAlign: 'center', color: '#8A9284' }}>載入中…</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {users.map((u) => {
          const isSelf = u.username === username;
          const busy = busyId === u.id;
          return (
            <div key={u.id} style={{ background: '#FFFFFF', border: `1.5px solid ${u.status === 'pending' ? '#E8C49A' : '#E4DFD2'}`, borderRadius: 16, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, opacity: busy ? 0.6 : 1 }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: '#2D3B2D', wordBreak: 'break-all' }}>{u.username}</span>
                  {isSelf && <span style={{ fontSize: 11, fontWeight: 700, color: '#4A7C59', background: '#EDF2E6', borderRadius: 99, padding: '2px 8px' }}>自己</span>}
                  {u.status === 'pending' ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#B07A2A', background: '#FBF4E4', borderRadius: 99, padding: '2px 8px' }}>待開通</span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4A7C59', background: '#EDF2E6', borderRadius: 99, padding: '2px 8px' }}>已開通</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#8A9284', marginTop: 2 }}>註冊於 {u.createdAt.slice(0, 10)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <select
                  value={u.role}
                  disabled={isSelf || busy}
                  onChange={(e) => void setRole(u, e.target.value as Role)}
                  title="會員身分"
                  style={{ height: 34, border: '1.5px solid #DDD8CA', borderRadius: 10, background: '#FBFAF6', fontSize: 13, padding: '0 8px', color: '#4A5A4A', cursor: isSelf ? 'default' : 'pointer' }}
                >
                  {(Object.keys(ROLE_NAMES) as Role[]).map((r) => (
                    <option key={r} value={r}>{ROLE_NAMES[r]}</option>
                  ))}
                </select>
                {u.status === 'pending' ? (
                  <button onClick={() => void approve(u)} disabled={busy} className="hv-green" style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 10, background: '#4A7C59', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    開通
                  </button>
                ) : (
                  !isSelf && (
                    <button onClick={() => void suspend(u)} disabled={busy} style={{ height: 34, padding: '0 12px', border: '1px solid #DDD8CA', borderRadius: 10, background: '#fff', color: '#6B7565', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      停用
                    </button>
                  )
                )}
                {!isSelf && (
                  <button onClick={() => void remove(u)} disabled={busy} className="hv-red-tint" style={{ height: 34, padding: '0 12px', border: '1px solid #E0C5C0', borderRadius: 10, background: 'transparent', color: '#C0564A', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    刪除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!loading && users.length === 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: '#8A9284' }}>目前沒有任何帳號。</div>
      )}
    </div>
  );
}

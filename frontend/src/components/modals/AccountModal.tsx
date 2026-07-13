import { useState, type CSSProperties } from 'react';
import { api } from '../../lib/api';
import { useStore } from '../../store';
import { CloseButton, ModalShell } from './ModalShell';

const inputStyle: CSSProperties = {
  height: 44, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 12px',
  fontSize: 14.5, outline: 'none', background: '#FBFAF6', width: '100%',
};

const ROLE_NAMES = { member: '一般會員', dietitian: '營養師', admin: '管理者' } as const;

export function AccountModal() {
  const username = useStore((s) => s.username);
  const role = useStore((s) => s.role);
  const closeModal = useStore((s) => s.closeModal);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const changePassword = async () => {
    if (busy) return;
    setError('');
    setNotice('');
    if (!oldPassword) return setError('請輸入目前密碼');
    if (newPassword.length < 6) return setError('新密碼至少 6 碼');
    if (newPassword !== confirmPassword) return setError('兩次輸入的新密碼不一致');
    setBusy(true);
    try {
      await api.changePassword(oldPassword, newPassword, confirmPassword);
      setNotice('密碼已更新，下次登入請使用新密碼');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '變更密碼失敗，請再試一次');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell maxWidth={400} cardStyle={{ padding: 22, maxHeight: '86vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>會員中心</div>
        <CloseButton onClick={closeModal} />
      </div>

      <div style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, color: '#8A9284' }}>帳號</div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: '#2D3B2D', wordBreak: 'break-all' }}>{username}</div>
        <div style={{ fontSize: 12, color: '#8A9284', marginTop: 4 }}>身分</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#4A7C59' }}>{ROLE_NAMES[role]}</div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void changePassword(); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid #F0EDE3', paddingTop: 14 }}
      >
        <div style={{ fontSize: 14, fontWeight: 900 }}>變更密碼</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>目前密碼</label>
          <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>新密碼（至少 6 碼）</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>確認新密碼</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" style={inputStyle} />
        </div>
        {error && <div style={{ fontSize: 12.5, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
        {notice && <div style={{ fontSize: 12.5, color: '#4A7C59', fontWeight: 700 }}>{notice}</div>}
        <button type="submit" className="hv-green" disabled={busy} style={{ height: 46, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.7 : 1 }}>
          更新密碼
        </button>
      </form>
    </ModalShell>
  );
}

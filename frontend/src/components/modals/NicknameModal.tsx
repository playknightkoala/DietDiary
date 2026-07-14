import { useState } from 'react';
import { api } from '../../lib/api';
import { useStore } from '../../store';
import { ModalShell } from './ModalShell';

// 強制設定暱稱：尚未設定暱稱的帳號登入後必須先設定才能繼續使用（無關閉鈕、蓋在所有畫面之上）
export function NicknameModal() {
  const username = useStore((s) => s.username);
  const setNickname = useStore((s) => s.setNickname);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const nickname = input.trim();
    if (!nickname) return setError('請輸入 1～20 字的暱稱');
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.setNickname(nickname);
      setNickname(r.nickname);
    } catch (e) {
      setError(e instanceof Error ? e.message : '設定失敗，請再試一次');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell maxWidth={400} zIndex={90} cardStyle={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 17, fontWeight: 900 }}>設定你的暱稱</div>
      <div style={{ fontSize: 13, color: '#6B7565', lineHeight: 1.7 }}>
        歡迎使用均衡日記！請先設定一個暱稱（1～20 字），方便營養師與夥伴辨識你。之後可以在會員中心隨時修改。
      </div>
      <div style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 12, padding: '9px 12px', fontSize: 12.5, color: '#8A9284', wordBreak: 'break-all' }}>
        帳號：{username}
      </div>
      <input
        type="text"
        placeholder="例：小明"
        maxLength={20}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }}
        style={{ height: 46, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 12px', fontSize: 15, outline: 'none', background: '#FBFAF6' }}
      />
      {error && <div style={{ fontSize: 12.5, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
      <button
        onClick={() => void save()}
        disabled={busy}
        className="hv-green"
        style={{ height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.7 : 1 }}
      >
        開始使用
      </button>
    </ModalShell>
  );
}

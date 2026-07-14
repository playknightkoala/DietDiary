import { useEffect, useState } from 'react';
import { fmtCommentTime } from '../lib/domain';
import type { EntryComment } from '../types';

const ROLE_BADGES: Record<string, { name: string; color: string; bg: string } | undefined> = {
  dietitian: { name: '營養師', color: '#5B8DB8', bg: '#E5EBF1' },
  admin: { name: '管理者', color: '#C77B4A', bg: '#F3E7D8' },
};

interface CommentsThreadProps {
  count: number;
  load: () => Promise<EntryComment[]>;
  post: (body: string) => Promise<EntryComment[]>;
  remove: (id: number) => Promise<void>;
  initialOpen?: boolean;
}

// 收合式留言串：點開才載入並顯示內容，會員與營養師頁面共用
// initialOpen：掛載時即展開並載入（營養師由通知跳轉至該貼文時使用）
export function CommentsThread({ count: initialCount, load, post, remove, initialOpen }: CommentsThreadProps) {
  const [open, setOpen] = useState(!!initialOpen);
  const [comments, setComments] = useState<EntryComment[] | null>(null);
  const [count, setCount] = useState(initialCount);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initialOpen) return;
    load()
      .then((list) => { setComments(list); setCount(list.length); })
      .catch(() => setError('載入留言失敗'));
    // 僅掛載時載入一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (comments === null) {
      try {
        const list = await load();
        setComments(list);
        setCount(list.length);
      } catch {
        setError('載入留言失敗');
      }
    }
  };

  const send = async () => {
    const body = input.trim();
    if (!body || busy) return;
    setBusy(true);
    setError('');
    try {
      const list = await post(body);
      setComments(list);
      setCount(list.length);
      setInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '留言失敗，請再試一次');
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await remove(id);
      const list = await load();
      setComments(list);
      setCount(list.length);
    } catch {
      setError('刪除留言失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid #F0EDE3', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        onClick={() => void toggle()}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#6B7565', fontSize: 12.5, fontWeight: 700, padding: 0, alignSelf: 'flex-start' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /></svg>
        留言{count > 0 ? `（${count}）` : ''}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {comments === null && <div style={{ fontSize: 12.5, color: '#8A9284' }}>載入中…</div>}
          {comments?.length === 0 && <div style={{ fontSize: 12.5, color: '#8A9284' }}>還沒有留言。</div>}
          {comments?.map((c) => {
            const badge = ROLE_BADGES[c.role];
            return (
              <div key={c.id} style={{ background: badge ? '#F4F7FA' : '#F7F5EF', borderRadius: 12, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#2D3B2D', wordBreak: 'break-all' }}>{c.author}</span>
                  {badge && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: badge.color, background: badge.bg, borderRadius: 99, padding: '1px 7px' }}>{badge.name}</span>
                  )}
                  <span style={{ fontSize: 11, color: '#8A9284' }}>{fmtCommentTime(c.createdAt)}</span>
                  <span style={{ flex: 1 }} />
                  {c.mine && (
                    <button onClick={() => void del(c.id)} title="刪除留言" style={{ border: 'none', background: 'transparent', color: '#C0564A', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                      刪除
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#4A5A4A', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
              </div>
            );
          })}
          {error && <div style={{ fontSize: 12, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              placeholder="寫下留言…"
              value={input}
              maxLength={1000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send(); }}
              style={{ flex: 1, minWidth: 0, height: 38, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px', fontSize: 13.5, outline: 'none', background: '#FBFAF6' }}
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="hv-green"
              style={{ height: 38, padding: '0 14px', border: 'none', borderRadius: 11, background: '#4A7C59', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy || !input.trim() ? 0.55 : 1 }}
            >
              送出
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

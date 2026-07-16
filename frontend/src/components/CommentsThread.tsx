import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { fmtCommentTime } from '../lib/domain';
import type { EntryComment } from '../types';

// 觸控裝置的 Enter＝換行（用「送出」按鈕送出）；桌機 Enter＝送出、Shift+Enter＝換行
const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const ROLE_BADGES: Record<string, { name: string; color: string; bg: string } | undefined> = {
  dietitian: { name: '營養師', color: '#5B8DB8', bg: '#E5EBF1' },
  admin: { name: '管理者', color: '#C77B4A', bg: '#F3E7D8' },
};
const AI_BADGE = { name: 'AI 助手', color: '#7A5AB8', bg: '#EDE7F6' };

const menuItemStyle: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
  padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
};

interface CommentsThreadProps {
  count: number;
  load: () => Promise<EntryComment[]>;
  post: (body: string) => Promise<EntryComment[]>;
  edit: (id: number, body: string) => Promise<EntryComment[]>;
  remove: (id: number) => Promise<void>;
  initialOpen?: boolean;
  // 提供時顯示「AI 評語」按鈕，點擊會產生並張貼一則 AI 留言（回傳更新後的留言串）
  aiComment?: () => Promise<EntryComment[]>;
}

// 收合式留言串：點開才載入並顯示內容，會員與營養師頁面共用
// initialOpen：掛載時即展開並載入（營養師由通知跳轉至該貼文時使用）
export function CommentsThread({ count: initialCount, load, post, edit, remove, initialOpen, aiComment }: CommentsThreadProps) {
  const [open, setOpen] = useState(!!initialOpen);
  const [comments, setComments] = useState<EntryComment[] | null>(null);
  const [count, setCount] = useState(initialCount);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [menuId, setMenuId] = useState<number | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 輸入框隨內容自動長高（上限 120px，之後改為內部捲動）
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [input, open]);

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

  const runAi = async () => {
    if (!aiComment || aiBusy || busy) return;
    setOpen(true);
    setAiBusy(true);
    setError('');
    try {
      const list = await aiComment();
      setComments(list);
      setCount(list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 評語產生失敗，請再試一次');
    } finally {
      setAiBusy(false);
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

  const startEdit = (c: EntryComment) => {
    setError('');
    setEditingId(c.id);
    setEditDraft(c.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };

  const saveEdit = async (id: number) => {
    const body = editDraft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError('');
    try {
      const list = await edit(id, body);
      setComments(list);
      setCount(list.length);
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : '編輯留言失敗，請再試一次');
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
            const badge = c.ai ? AI_BADGE : ROLE_BADGES[c.role];
            return (
              <div key={c.id} style={{ background: c.ai ? '#F6F3FB' : badge ? '#F4F7FA' : '#F7F5EF', borderRadius: 12, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#2D3B2D', wordBreak: 'break-all' }}>{c.author}</span>
                  {badge && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: badge.color, background: badge.bg, borderRadius: 99, padding: '1px 7px' }}>{badge.name}</span>
                  )}
                  <span style={{ fontSize: 11, color: '#8A9284' }}>{fmtCommentTime(c.createdAt)}</span>
                  <span style={{ flex: 1 }} />
                  {/* 本人留言：可編輯／刪除；自己貼文下的 AI 評語：只可刪除（aiComment 存在＝擁有者的 AI 檢視） */}
                  {((c.mine) || (c.ai && !!aiComment)) && editingId !== c.id && (
                    <div style={{ position: 'relative', flex: 'none' }}>
                      <button
                        onClick={() => setMenuId(menuId === c.id ? null : c.id)}
                        title="更多"
                        aria-label="更多"
                        style={{ border: 'none', background: menuId === c.id ? '#ECE8DD' : 'transparent', color: '#8A9284', cursor: 'pointer', padding: '2px 5px', borderRadius: 8, display: 'flex', alignItems: 'center' }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                      </button>
                      {menuId === c.id && (
                        <>
                          <div onClick={() => setMenuId(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
                          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 21, background: '#fff', border: '1px solid #E4DFD2', borderRadius: 10, boxShadow: '0 8px 24px rgba(45,59,45,.15)', overflow: 'hidden', minWidth: 92 }}>
                            {c.mine && (
                              <button className="hv-cream" onClick={() => { setMenuId(null); startEdit(c); }} style={{ ...menuItemStyle, color: '#4A5A4A' }}>
                                編輯
                              </button>
                            )}
                            <button className="hv-cream" onClick={() => { setMenuId(null); void del(c.id); }} style={{ ...menuItemStyle, color: '#C0564A' }}>
                              刪除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {editingId === c.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <textarea
                      rows={2}
                      value={editDraft}
                      maxLength={1000}
                      autoFocus
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
                        if (IS_TOUCH) return;
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void saveEdit(c.id);
                        }
                      }}
                      style={{ width: '100%', minHeight: 40, maxHeight: 160, border: '1.5px solid #DDD8CA', borderRadius: 10, padding: '7px 9px', fontSize: 13, lineHeight: 1.55, outline: 'none', background: '#fff', resize: 'none', overflowY: 'auto', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button onClick={cancelEdit} disabled={busy} style={{ height: 30, padding: '0 12px', border: '1px solid #DDD8CA', borderRadius: 9, background: '#fff', color: '#6B7565', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        取消
                      </button>
                      <button onClick={() => void saveEdit(c.id)} disabled={busy || !editDraft.trim()} className="hv-green" style={{ height: 30, padding: '0 14px', border: 'none', borderRadius: 9, background: '#4A7C59', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: busy || !editDraft.trim() ? 0.55 : 1 }}>
                        儲存
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#4A5A4A', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
                )}
              </div>
            );
          })}
          {error && <div style={{ fontSize: 12, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
          {aiComment && (
            <button
              onClick={() => void runAi()}
              disabled={aiBusy || busy}
              className="hv-cream"
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', border: '1.5px solid #D9CEEA', borderRadius: 10, background: '#F6F3FB', color: '#7A5AB8', fontSize: 12.5, fontWeight: 700, cursor: aiBusy || busy ? 'default' : 'pointer', opacity: aiBusy || busy ? 0.6 : 1 }}
            >
              <span style={{ fontSize: 13 }}>✨</span>
              {aiBusy ? 'AI 撰寫中…' : '請 AI 給評語'}
            </button>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <textarea
              ref={taRef}
              rows={1}
              placeholder={IS_TOUCH ? '寫下留言…' : '寫下留言…（Enter 送出、Shift+Enter 換行）'}
              value={input}
              maxLength={1000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (IS_TOUCH) return; // 觸控裝置 Enter＝換行
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              style={{ flex: 1, minWidth: 0, minHeight: 38, maxHeight: 120, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '8px 10px', fontSize: 13.5, lineHeight: 1.55, outline: 'none', background: '#FBFAF6', resize: 'none', overflowY: 'auto' }}
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

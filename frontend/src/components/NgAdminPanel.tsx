import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../lib/api';
import { NG_LEVELS, NG_LEVEL_COLORS, NG_LEVEL_LABELS } from '../lib/ng';
import { CloseButton, ModalShell } from './modals/ModalShell';
import type { NgCategoryInfo, NgKeyword, NgLevel } from '../types';

const inputStyle: CSSProperties = {
  height: 38, border: '1.5px solid #DDD8CA', borderRadius: 10, background: '#fff',
  fontSize: 13.5, padding: '0 10px', color: '#2D3B2D',
};
const smallBtn = (kind: 'green' | 'plain' | 'red'): CSSProperties => ({
  height: 32, padding: '0 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flex: 'none',
  border: kind === 'green' ? 'none' : kind === 'red' ? '1px solid #E0C5C0' : '1px solid #DDD8CA',
  background: kind === 'green' ? '#4A7C59' : kind === 'red' ? 'transparent' : '#fff',
  color: kind === 'green' ? '#fff' : kind === 'red' ? '#C0564A' : '#6B7565',
});
const fieldLabel: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#4A5A4A' };

const levelBadge = (level: NgLevel) => (
  <span style={{ fontSize: 11, fontWeight: 800, color: NG_LEVEL_COLORS[level].fg, background: NG_LEVEL_COLORS[level].bg, borderRadius: 99, padding: '2px 8px', flex: 'none' }}>
    {NG_LEVEL_LABELS[level]}
  </span>
);

// NG 分類／關鍵字＋每日精緻糖門檻管理（管理者後台）。分類是資料（可自行增刪改），依等級分區顯示。
// 新增走 modal（分頁：關鍵字／分類）；既有項目就地編輯。
// 錯誤策略：任何失敗保留草稿與編輯狀態、只重置 busy，成功才收合（design-guardrails 12）
export function NgAdminPanel() {
  const [sugarLimit, setSugarLimit] = useState<number | null>(null);
  const [categories, setCategories] = useState<NgCategoryInfo[]>([]);
  const [keywords, setKeywords] = useState<NgKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 門檻草稿（字串；儲存時才 parse）
  const [limitDraft, setLimitDraft] = useState('');

  // 新增 modal（分頁：關鍵字／分類）
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<'keyword' | 'category'>('keyword');

  // 關鍵字草稿：新增（modal）與就地編輯共用。
  // level 只是 UI 的兩段式選擇（先等級再分類，避免 27 個分類擠在一起），不送後端
  const emptyKwDraft = { keyword: '', categoryId: null as number | null, isExclusion: false, level: null as NgLevel | null };
  const [editingKw, setEditingKw] = useState<number | null>(null);
  const [kwDraft, setKwDraft] = useState(emptyKwDraft);

  // 分類草稿：新增（modal）與就地編輯共用
  const emptyCatDraft = { name: '', level: 'high' as NgLevel, note: '' };
  const [editingCat, setEditingCat] = useState<number | null>(null);
  const [catDraft, setCatDraft] = useState(emptyCatDraft);

  const load = async () => {
    setError('');
    try {
      const data = await api.adminNg();
      setSugarLimit(data.sugarLimit);
      setCategories(data.categories);
      setKeywords(data.keywords);
      setLimitDraft(String(data.sugarLimit));
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入 NG 食品設定失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗，請再試一次');
    } finally {
      setBusy(false);
    }
  };

  const saveLimit = () =>
    run(async () => {
      const grams = Number(limitDraft);
      if (!Number.isInteger(grams) || grams < 1 || grams > 200) {
        setError('門檻需為 1–200 的整數（公克）');
        return;
      }
      const { sugarLimit: saved } = await api.adminSetSugarLimit(grams);
      setSugarLimit(saved);
      setLimitDraft(String(saved));
    });

  // ---- 共用驗證 ----

  const validKwDraft = (): boolean => {
    if (!kwDraft.keyword.trim()) {
      setError('關鍵字不可為空');
      return false;
    }
    if (!kwDraft.isExclusion && !kwDraft.categoryId) {
      setError('請選擇分類');
      return false;
    }
    return true;
  };

  // ---- 新增（modal） ----

  const openAdd = () => {
    setAddOpen(true);
    setAddTab('keyword');
    setKwDraft(emptyKwDraft);
    setCatDraft(emptyCatDraft);
    setEditingKw(null);
    setEditingCat(null);
    setError('');
  };

  const addKeyword = () =>
    run(async () => {
      if (!validKwDraft()) return;
      await api.adminAddNgKeyword(kwDraft.keyword.trim(), kwDraft.categoryId, kwDraft.isExclusion);
      await load();
      // 只有成功才關閉並清草稿；失敗（409 重複等）保留讓管理者修改
      setAddOpen(false);
      setKwDraft(emptyKwDraft);
    });

  const addCategory = () =>
    run(async () => {
      if (!catDraft.name.trim()) {
        setError('分類名稱不可為空');
        return;
      }
      await api.adminAddNgCategory(catDraft.name.trim(), catDraft.level, catDraft.note.trim());
      await load();
      setAddOpen(false);
      setCatDraft(emptyCatDraft);
    });

  // ---- 就地編輯／刪除 ----

  const saveKeyword = () =>
    run(async () => {
      if (editingKw === null || !validKwDraft()) return;
      await api.adminUpdateNgKeyword(editingKw, kwDraft.keyword.trim(), kwDraft.categoryId, kwDraft.isExclusion);
      await load();
      setEditingKw(null);
      setKwDraft(emptyKwDraft);
    });

  const removeKeyword = (k: NgKeyword) =>
    run(async () => {
      if (!window.confirm(`確定要刪除關鍵字「${k.keyword}」？`)) return;
      await api.adminDeleteNgKeyword(k.id);
      await load();
    });

  const startEditKw = (k: NgKeyword) => {
    setEditingKw(k.id);
    setKwDraft({
      keyword: k.keyword,
      categoryId: k.categoryId,
      isExclusion: k.isExclusion,
      level: categories.find((c) => c.id === k.categoryId)?.level ?? null,
    });
    setEditingCat(null);
    setError('');
  };

  const saveCategory = () =>
    run(async () => {
      if (editingCat === null) return;
      if (!catDraft.name.trim()) {
        setError('分類名稱不可為空');
        return;
      }
      await api.adminUpdateNgCategory(editingCat, catDraft.name.trim(), catDraft.level, catDraft.note.trim());
      await load();
      setEditingCat(null);
      setCatDraft(emptyCatDraft);
    });

  // 刪除分類＝連同底下所有關鍵字一併刪除（不可復原）：改用輸入「確定刪除」的確認視窗把關
  const [deletingCat, setDeletingCat] = useState<NgCategoryInfo | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const confirmDeleteCat = () =>
    run(async () => {
      if (!deletingCat || deleteText !== '確定刪除') return;
      await api.adminDeleteNgCategory(deletingCat.id);
      await load();
      setDeletingCat(null);
      setDeleteText('');
    });

  const startEditCat = (c: NgCategoryInfo) => {
    setEditingCat(c.id);
    setCatDraft({ name: c.name, level: c.level, note: c.note });
    setEditingKw(null);
    setError('');
  };

  // ---- 共用表單片段 ----

  // 等級選擇（segmented pills）；withExclusion＝關鍵字表單多一顆「排除詞」
  const levelPicker = (withExclusion: boolean) => {
    const pill = (label: string, active: boolean, colors: { fg: string; bg: string } | null, onClick: () => void) => (
      <button
        key={label}
        onClick={onClick}
        style={{
          height: 34, padding: '0 14px', borderRadius: 99, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          border: active ? `1.5px solid ${colors?.fg ?? '#4A5A4A'}` : '1.5px solid #DDD8CA',
          background: active ? colors?.bg ?? '#F0EDE3' : '#fff',
          color: active ? colors?.fg ?? '#4A5A4A' : '#8A9284',
        }}
      >
        {label}
      </button>
    );
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {NG_LEVELS.map((l) =>
          pill(NG_LEVEL_LABELS[l], !kwDraft.isExclusion && kwDraft.level === l, NG_LEVEL_COLORS[l], () =>
            setKwDraft((d) => ({ ...d, isExclusion: false, level: l, categoryId: null }))
          )
        )}
        {withExclusion &&
          pill('排除詞', kwDraft.isExclusion, null, () => setKwDraft((d) => ({ ...d, isExclusion: true, level: null, categoryId: null })))}
      </div>
    );
  };

  // 就地編輯關鍵字的列（清單內使用；沿用兩段式選擇）
  const kwEditorRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: '1.5px solid #4A7C59', borderRadius: 13, background: '#FBFAF6', padding: '9px 12px' }}>
      <input
        value={kwDraft.keyword}
        onChange={(e) => setKwDraft((d) => ({ ...d, keyword: e.target.value }))}
        placeholder="關鍵字（如：珍珠奶茶）"
        maxLength={30}
        style={{ ...inputStyle, flex: '1 1 140px', minWidth: 0 }}
      />
      <select
        value={kwDraft.isExclusion ? '__exclusion' : kwDraft.level ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          setKwDraft((d) =>
            v === '__exclusion'
              ? { ...d, isExclusion: true, categoryId: null, level: null }
              : { ...d, isExclusion: false, level: (v || null) as NgLevel | null, categoryId: null });
        }}
        style={{ ...inputStyle, cursor: 'pointer', background: '#FBFAF6' }}
      >
        <option value="">等級…</option>
        {NG_LEVELS.map((l) => (
          <option key={l} value={l}>{NG_LEVEL_LABELS[l]}</option>
        ))}
        <option value="__exclusion">排除詞</option>
      </select>
      {!kwDraft.isExclusion && kwDraft.level && (
        <select
          value={String(kwDraft.categoryId ?? '')}
          onChange={(e) => setKwDraft((d) => ({ ...d, categoryId: e.target.value ? Number(e.target.value) : null }))}
          style={{ ...inputStyle, cursor: 'pointer', background: '#FBFAF6', maxWidth: 180 }}
        >
          <option value="">分類…</option>
          {categories.filter((c) => c.level === kwDraft.level).map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
      )}
      <button onClick={() => void saveKeyword()} disabled={busy} className="hv-green" style={smallBtn('green')}>儲存</button>
      <button onClick={() => { setEditingKw(null); setKwDraft(emptyKwDraft); setError(''); }} disabled={busy} className="hv-cream" style={smallBtn('plain')}>取消</button>
    </div>
  );

  // 就地編輯分類的列
  const catEditorRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: '1.5px solid #4A7C59', borderRadius: 13, background: '#FBFAF6', padding: '9px 12px' }}>
      <input
        value={catDraft.name}
        onChange={(e) => setCatDraft((d) => ({ ...d, name: e.target.value }))}
        placeholder="分類名稱（如：宵夜）"
        maxLength={20}
        style={{ ...inputStyle, flex: '1 1 120px', minWidth: 0 }}
      />
      <select
        value={catDraft.level}
        onChange={(e) => setCatDraft((d) => ({ ...d, level: e.target.value as NgLevel }))}
        style={{ ...inputStyle, cursor: 'pointer', background: '#FBFAF6' }}
      >
        {NG_LEVELS.map((l) => (
          <option key={l} value={l}>{NG_LEVEL_LABELS[l]}</option>
        ))}
      </select>
      <input
        value={catDraft.note}
        onChange={(e) => setCatDraft((d) => ({ ...d, note: e.target.value }))}
        placeholder="為什麼 NG（選填）"
        maxLength={100}
        style={{ ...inputStyle, flex: '2 1 180px', minWidth: 0 }}
      />
      <button onClick={() => void saveCategory()} disabled={busy} className="hv-green" style={smallBtn('green')}>儲存</button>
      <button onClick={() => { setEditingCat(null); setCatDraft(emptyCatDraft); setError(''); }} disabled={busy} className="hv-cream" style={smallBtn('plain')}>取消</button>
    </div>
  );

  const field = (label: string, node: ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={fieldLabel}>{label}</div>
      {node}
    </div>
  );

  const exclusions = keywords.filter((k) => k.isExclusion);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontFamily: 'Outfit', fontSize: 17, fontWeight: 800, color: '#2D3B2D', paddingTop: 10 }}>NG 食品與精緻糖設定</div>
      <div style={{ fontSize: 12.5, color: '#6B7565', lineHeight: 1.7 }}>
        會員主頁日期旁的「糖超標／NG 食品」統計會比對每天精緻糖是否超過門檻，並用下方關鍵字掃描飲食敘述與自定義項目名稱。
        比對方式為<b>文字包含</b>，過短的關鍵字（如單字「糖」）容易誤判，建議至少兩個字。
        <b>排除詞</b>可擋誤判：命中排除詞的字段不參與比對——例如把「黑巧克力」設為排除詞，「70% 黑巧克力」就不會被「巧克力」判成 NG。
      </div>
      {error && !addOpen && <div style={{ fontSize: 13, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#8A9284' }}>載入中…</div>
      ) : (
        <>
          {/* 新增入口（置頂）：開 modal，分頁選關鍵字／分類 */}
          <button
            onClick={openAdd}
            disabled={busy}
            className="hv-cream"
            style={{ height: 42, border: '1.5px dashed #C9C3B2', borderRadius: 13, background: 'transparent', color: '#4A7C59', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            ＋ 新增關鍵字或分類
          </button>

          {/* 每日精緻糖門檻 */}
          <div style={{ background: '#FFFFFF', border: '1.5px solid #E4DFD2', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2D3B2D' }}>每日精緻糖門檻</div>
              <div style={{ fontSize: 12, color: '#8A9284', marginTop: 2 }}>超過此公克數的日子會被標為超標（WHO 建議 25 g）</div>
            </div>
            <input
              value={limitDraft}
              onChange={(e) => setLimitDraft(e.target.value)}
              inputMode="numeric"
              style={{ ...inputStyle, width: 72, textAlign: 'center', fontFamily: 'Outfit', fontWeight: 700 }}
            />
            <span style={{ fontSize: 13, color: '#6B7565' }}>公克</span>
            <button onClick={() => void saveLimit()} disabled={busy || limitDraft === String(sugarLimit)} className="hv-green" style={{ ...smallBtn('green'), opacity: limitDraft === String(sugarLimit) ? 0.5 : 1 }}>
              儲存
            </button>
          </div>

          {/* 分類（依等級分區）＋各分類的關鍵字 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {categories.map((cat) => {
              const list = keywords.filter((k) => k.categoryId === cat.id);
              return (
                <div key={cat.id} style={{ background: '#FFFFFF', border: '1.5px solid #E4DFD2', borderRadius: 16, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {editingCat === cat.id ? (
                    catEditorRow
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {levelBadge(cat.level)}
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: '#2D3B2D', flex: 'none' }}>{cat.name}</span>
                      <span style={{ fontSize: 11.5, color: '#8A9284', flex: '1 1 120px', minWidth: 0 }}>{cat.note}</span>
                      <button onClick={() => startEditCat(cat)} disabled={busy} className="hv-cream" style={smallBtn('plain')}>編輯</button>
                      <button onClick={() => { setDeletingCat(cat); setDeleteText(''); setError(''); }} disabled={busy} className="hv-red-tint" style={smallBtn('red')}>刪除</button>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {list.map((k) =>
                      editingKw === k.id ? (
                        <div key={k.id}>{kwEditorRow}</div>
                      ) : (
                        <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #F0EDE3', borderRadius: 11, background: '#FBFAF6', padding: '6px 10px', opacity: busy ? 0.6 : 1 }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: '#2D3B2D', wordBreak: 'break-all' }}>{k.keyword}</span>
                          <button onClick={() => startEditKw(k)} disabled={busy} className="hv-cream" style={smallBtn('plain')}>編輯</button>
                          <button onClick={() => void removeKeyword(k)} disabled={busy} className="hv-red-tint" style={smallBtn('red')}>刪除</button>
                        </div>
                      )
                    )}
                    {list.length === 0 && <div style={{ fontSize: 12, color: '#A39C8C' }}>（此分類目前沒有關鍵字）</div>}
                  </div>
                </div>
              );
            })}

            {/* 排除詞 */}
            {exclusions.length > 0 && (
              <div style={{ background: '#FFFFFF', border: '1.5px dashed #DDD8CA', borderRadius: 16, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#4A5A4A' }}>
                  排除詞
                  <span style={{ fontWeight: 400, color: '#8A9284', marginLeft: 6 }}>命中的字段不參與 NG 比對</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {exclusions.map((k) =>
                    editingKw === k.id ? (
                      <div key={k.id}>{kwEditorRow}</div>
                    ) : (
                      <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #F0EDE3', borderRadius: 11, background: '#FBFAF6', padding: '6px 10px', opacity: busy ? 0.6 : 1 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: '#6B7565', wordBreak: 'break-all' }}>{k.keyword}</span>
                        <button onClick={() => startEditKw(k)} disabled={busy} className="hv-cream" style={smallBtn('plain')}>編輯</button>
                        <button onClick={() => void removeKeyword(k)} disabled={busy} className="hv-red-tint" style={smallBtn('red')}>刪除</button>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* 刪除分類確認 modal：連同底下關鍵字一併刪除，需輸入「確定刪除」才啟用刪除鈕 */}
      {deletingCat && (() => {
        const kwCount = keywords.filter((k) => k.categoryId === deletingCat.id).length;
        const confirmed = deleteText === '確定刪除';
        return (
          <ModalShell maxWidth={420} cardStyle={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#C0564A' }}>刪除分類</div>
              <CloseButton onClick={() => { setDeletingCat(null); setDeleteText(''); }} />
            </div>
            <div style={{ padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13.5, color: '#2D3B2D', lineHeight: 1.8 }}>
                即將刪除分類 <b>「{deletingCat.name}」</b>
                {kwCount > 0 ? <>，底下的 <b style={{ color: '#C0564A' }}>{kwCount} 個關鍵字</b>也會一併刪除</> : ''}，
                此操作<b>無法復原</b>。
              </div>
              {error && <div style={{ fontSize: 13, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={fieldLabel}>請輸入「確定刪除」以繼續</div>
                <input
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                  placeholder="確定刪除"
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setDeletingCat(null); setDeleteText(''); }}
                  disabled={busy}
                  className="hv-cream"
                  style={{ flex: 1, height: 44, border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff', color: '#4A5A4A', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  取消
                </button>
                <button
                  onClick={() => void confirmDeleteCat()}
                  disabled={busy || !confirmed}
                  className={confirmed ? 'hv-red-tint' : undefined}
                  style={{
                    flex: 1, height: 44, border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700,
                    background: confirmed ? '#C0564A' : '#E4DFD2', color: confirmed ? '#fff' : '#A39C8C',
                    cursor: confirmed ? 'pointer' : 'default',
                  }}
                >
                  刪除分類{kwCount > 0 ? `與 ${kwCount} 個關鍵字` : ''}
                </button>
              </div>
            </div>
          </ModalShell>
        );
      })()}

      {/* 新增 modal：分頁（關鍵字／分類） */}
      {addOpen && (
        <ModalShell maxWidth={440} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 17, fontWeight: 900 }}>新增</div>
            <CloseButton onClick={() => { setAddOpen(false); setError(''); }} />
          </div>
          <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 分頁切換 */}
            <div style={{ display: 'flex', gap: 8 }}>
              {([['keyword', '關鍵字'], ['category', '分類']] as const).map(([key, name]) => (
                <button
                  key={key}
                  onClick={() => { setAddTab(key); setError(''); }}
                  className={addTab === key ? undefined : 'hv-cream'}
                  style={{
                    flex: 1, height: 38, borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                    border: addTab === key ? 'none' : '1.5px solid #DDD8CA',
                    background: addTab === key ? '#4A7C59' : '#fff',
                    color: addTab === key ? '#fff' : '#4A5A4A',
                  }}
                >
                  {name}
                </button>
              ))}
            </div>

            {error && <div style={{ fontSize: 13, color: '#C0564A', fontWeight: 700 }}>{error}</div>}

            {addTab === 'keyword' ? (
              <>
                {field('關鍵字', (
                  <input
                    value={kwDraft.keyword}
                    onChange={(e) => setKwDraft((d) => ({ ...d, keyword: e.target.value }))}
                    placeholder="如：珍珠奶茶"
                    maxLength={30}
                    style={inputStyle}
                  />
                ))}
                {field('等級', levelPicker(true))}
                {kwDraft.isExclusion ? (
                  <div style={{ fontSize: 12, color: '#8A9284', lineHeight: 1.6 }}>
                    排除詞不算 NG：命中的字段會先從掃描文字剔除，再比對其他關鍵字。
                  </div>
                ) : kwDraft.level ? (
                  field('分類', (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {categories.filter((c) => c.level === kwDraft.level).map((c) => {
                        const active = kwDraft.categoryId === c.id;
                        return (
                          <button
                            key={c.id}
                            onClick={() => setKwDraft((d) => ({ ...d, categoryId: c.id }))}
                            className={active ? undefined : 'hv-cream'}
                            style={{
                              height: 32, padding: '0 12px', borderRadius: 99, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                              border: active ? '1.5px solid #4A7C59' : '1.5px solid #DDD8CA',
                              background: active ? '#E3EBD9' : '#fff',
                              color: active ? '#3B6647' : '#6B7565',
                            }}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, color: '#A39C8C' }}>先選擇等級，就會列出該等級的分類。</div>
                )}
                <button onClick={() => void addKeyword()} disabled={busy} className="hv-green" style={{ height: 44, border: 'none', borderRadius: 12, background: '#4A7C59', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>
                  新增關鍵字
                </button>
              </>
            ) : (
              <>
                {field('分類名稱', (
                  <input
                    value={catDraft.name}
                    onChange={(e) => setCatDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="如：宵夜"
                    maxLength={20}
                    style={inputStyle}
                  />
                ))}
                {field('等級', (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {NG_LEVELS.map((l) => {
                      const active = catDraft.level === l;
                      return (
                        <button
                          key={l}
                          onClick={() => setCatDraft((d) => ({ ...d, level: l }))}
                          style={{
                            height: 34, padding: '0 14px', borderRadius: 99, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            border: active ? `1.5px solid ${NG_LEVEL_COLORS[l].fg}` : '1.5px solid #DDD8CA',
                            background: active ? NG_LEVEL_COLORS[l].bg : '#fff',
                            color: active ? NG_LEVEL_COLORS[l].fg : '#8A9284',
                          }}
                        >
                          {NG_LEVEL_LABELS[l]}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {field('為什麼 NG（選填）', (
                  <input
                    value={catDraft.note}
                    onChange={(e) => setCatDraft((d) => ({ ...d, note: e.target.value }))}
                    placeholder="顯示在分類名稱旁的小字說明"
                    maxLength={100}
                    style={inputStyle}
                  />
                ))}
                <button onClick={() => void addCategory()} disabled={busy} className="hv-green" style={{ height: 44, border: 'none', borderRadius: 12, background: '#4A7C59', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>
                  新增分類
                </button>
              </>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  );
}

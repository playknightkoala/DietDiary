import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, api } from '../../lib/api';
import { useStore } from '../../store';
import { BODY_DEFS, bmrTdeeOf, dstr, fmtCommentTime } from '../../lib/domain';
import type { BodyAiComment, BodyKey, BodyTrendRow, Profile } from '../../types';
import { TrendChart } from '../TrendChart';
import { CloseButton, ModalShell } from './ModalShell';

// 身體數據視窗的純展示層：當日數值、BMR／TDEE 與歷程趨勢。
// 會員端（BodyOverviewModal）傳 onAdd 顯示「＋ 記錄」；營養師端（MemberBodyModal）不傳＝唯讀
export function BodyOverviewView({
  dateLabel,
  body,
  bodyTime,
  weightAt,
  profile,
  trendRows,
  onAdd,
  aiSection,
  onClose,
}: {
  dateLabel: string;
  body: Record<BodyKey, string>;
  bodyTime: string;
  // 檢視日期適用的體重（當天含以前最近一次）；TDEE 依它計算，過去日期不受之後的新體重影響
  weightAt: { date: string; value: number } | null;
  profile: Profile | null;
  trendRows: BodyTrendRow[];
  onAdd?: () => void;
  // 會員端的「AI 評語」區塊（營養師檢視會員時不提供——分析的是登入者自己的資料）
  aiSection?: ReactNode;
  onClose: () => void;
}) {
  // BMR／TDEE：以基本資料＋檢視日期適用的體重計算（公式見 domain.bmrTdeeOf；資料不齊顯示 —）
  const { bmr, tdee } = bmrTdeeOf(profile, weightAt);

  const tile = (name: string, value: string, unit: string) => (
    <div key={name} style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 14, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 11.5, color: '#8A9284' }}>{name}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 700, color: '#2D3B2D' }}>{value}</span>
        <span style={{ fontSize: 11, color: '#8A9284' }}>{unit}</span>
      </div>
    </div>
  );

  return (
    <ModalShell maxWidth={520} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round"><path d="M12 3v18M5 8c2-2 12-2 14 0M5 16c2 2 12 2 14 0" /></svg>
          <div style={{ fontSize: 17, fontWeight: 900 }}>身體數據</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 當日數值 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#4A5A4A' }}>
            {dateLabel} 的數值
            {bodyTime && <span style={{ fontSize: 11.5, fontWeight: 400, color: '#8A9284', marginLeft: 6 }}>{bodyTime} 測量</span>}
          </div>
          {onAdd && (
            <button
              onClick={onAdd}
              className="hv-green"
              style={{ border: 'none', background: '#4A7C59', color: '#fff', borderRadius: 99, fontSize: 12, fontWeight: 700, padding: '6px 16px', cursor: 'pointer', flex: 'none' }}
            >
              ＋ 記錄
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10 }}>
          {BODY_DEFS.map((b) => tile(b.name, body[b.k] !== '' ? body[b.k] : '—', b.unit))}
        </div>

        {/* 代謝估算：BMR／TDEE（基本資料與活動量在「＋ 記錄」視窗內設定） */}
        <div style={{ fontSize: 13, fontWeight: 800, color: '#4A5A4A' }}>代謝估算</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {([['BMR（基礎代謝）', bmr], ['TDEE（每日消耗）', tdee]] as const).map(([name, v]) => tile(name, String(v ?? '—'), 'kcal'))}
        </div>

        {/* 歷程趨勢 */}
        <div style={{ fontSize: 13, fontWeight: 800, color: '#4A5A4A' }}>歷程趨勢</div>
        <div style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 14, padding: 10 }}>
          <TrendChart rows={trendRows} />
        </div>

        {aiSection}
      </div>
    </ModalShell>
  );
}

// 身體數據總覽（漢堡選單 → 身體數據）：當日數值、BMR／TDEE 與歷程趨勢一次呈現，
// 主頁不再顯示身體數據卡片；記錄入口在此視窗與右下角「＋」選單
export function BodyOverviewModal() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const trendRows = useStore((s) => s.trendRows);
  const loadTrend = useStore((s) => s.loadTrend);
  const openLogBody = useStore((s) => s.openLogBody);
  const closeModal = useStore((s) => s.closeModal);
  const profile = useStore((s) => s.profile);
  const aiEnabled = useStore((s) => s.aiEnabled);

  // AI 評語：每次產生都會存入歷史（後端 body_ai_comments），可從「歷史評語」回看
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiError, setAiError] = useState('');
  // 歷史評語：null＝尚未載入（展開時才抓）
  const [histOpen, setHistOpen] = useState(false);
  const [histBusy, setHistBusy] = useState(false);
  const [histItems, setHistItems] = useState<BodyAiComment[] | null>(null);
  const [histError, setHistError] = useState('');

  // 開啟即載入趨勢（含剛記錄完的新數值）
  useEffect(() => {
    void loadTrend();
  }, [loadTrend]);

  const loadHist = async () => {
    setHistBusy(true);
    setHistError('');
    try {
      const { items } = await api.aiBodyHistory();
      setHistItems(items);
    } catch (e) {
      setHistError(e instanceof ApiError ? e.message : '歷史評語載入失敗，請再試一次');
    } finally {
      setHistBusy(false);
    }
  };

  const toggleHist = () => {
    const next = !histOpen;
    setHistOpen(next);
    if (next && histItems === null && !histBusy) void loadHist();
  };

  const runAi = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiError('');
    try {
      // 以 client 的「今天」當分析錨點（日記日期是本地日，伺服器時區不可靠）
      const { comment, model } = await api.aiBodyComment(dstr(new Date()));
      setAiText(comment);
      setAiModel(model);
      // 新評語已入庫：歷史展開中就重抓，否則清掉快取讓下次展開拿最新
      if (histOpen) void loadHist();
      else setHistItems(null);
    } catch (e) {
      // 失敗只顯示錯誤讓使用者重試，不影響視窗其他內容
      setAiError(e instanceof ApiError ? e.message : 'AI 評語產生失敗，請稍後再試');
    } finally {
      setAiBusy(false);
    }
  };

  const aiSection = aiEnabled ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => void runAi()}
          disabled={aiBusy}
          className="hv-cream"
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, border: '1.5px solid #D9CEEA', borderRadius: 12, background: '#F6F3FB', color: '#7A5AB8', fontSize: 14, fontWeight: 700, cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.65 : 1 }}
        >
          <span style={{ fontSize: 15 }}>✨</span>
          {aiBusy ? 'AI 分析中…約需 10～30 秒' : aiText ? '重新產生 AI 評語' : 'AI 評語（分析趨勢與近三個月飲食）'}
        </button>
        <button
          onClick={toggleHist}
          className="hv-cream"
          style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5, height: 44, padding: '0 14px', border: `1.5px solid ${histOpen ? '#7A5AB8' : '#DDD8CA'}`, borderRadius: 12, background: histOpen ? '#F6F3FB' : '#fff', color: histOpen ? '#7A5AB8' : '#4A5A4A', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          歷史評語
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: histOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {aiError && <div style={{ fontSize: 12, color: '#C0564A', textAlign: 'center' }}>{aiError}</div>}
      {aiText && (
        <div style={{ background: '#FBF9FE', border: '1.5px solid #E0D6F0', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#7A5AB8' }}>AI 評語{aiModel ? `（${aiModel}）` : ''}</div>
          <div style={{ fontSize: 13.5, color: '#2D3B2D', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{aiText}</div>
        </div>
      )}
      {histOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {histBusy && <div style={{ fontSize: 12.5, color: '#8A9284', textAlign: 'center', padding: '6px 0' }}>載入中…</div>}
          {histError && <div style={{ fontSize: 12, color: '#C0564A', textAlign: 'center' }}>{histError}</div>}
          {!histBusy && !histError && histItems !== null && histItems.length === 0 && (
            <div style={{ fontSize: 12.5, color: '#8A9284', textAlign: 'center', padding: '6px 0' }}>還沒有歷史評語，產生第一則後會保留在這裡。</div>
          )}
          {(histItems ?? []).map((h) => (
            <div key={h.id} style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 14, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A9284' }}>{fmtCommentTime(h.createdAt)}{h.model ? `・${h.model}` : ''}</div>
              <div style={{ fontSize: 13, color: '#2D3B2D', lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{h.body}</div>
            </div>
          ))}
          {histItems !== null && histItems.length >= 20 && (
            <div style={{ fontSize: 11.5, color: '#8A9284', textAlign: 'center' }}>只顯示最近 20 筆</div>
          )}
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <BodyOverviewView
      dateLabel={selected}
      body={day.body}
      bodyTime={day.bodyTime}
      weightAt={day.weightAt}
      profile={profile}
      trendRows={trendRows}
      onAdd={() => openLogBody(true)}
      aiSection={aiSection}
      onClose={closeModal}
    />
  );
}

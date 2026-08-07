import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { GUIDE_DATA } from '../lib/guideData';
import { CUSTOM_ITEM_DEFS, FOOD_KEYS, FOOD_KEY_NAMES, MAX_CUSTOM_ITEMS, clampAmount, clampKcal, customDraftKcal, customItemLabel, foodSummary, origTotals, type CustomDraft, type Macros } from '../lib/domain';
import { useStore } from '../store';
import type { CustomItem, CustomItemType, Entry, EntryOrig, Food, FoodKey } from '../types';

export interface FoodInputGroup {
  name: string;
  glyph: string;
  tint: string;
  color: string;
  note: string;
  fields: { key: FoodKey; label: string }[];
}

export const FOOD_INPUT_GROUPS: FoodInputGroup[] = [
  { name: '蛋豆魚肉', glyph: '蛋', tint: '#F5E3DB', color: '#C0564A', note: '55–135 卡/份',
    fields: [
      { key: 'meatLow', label: '低脂（55卡）' },
      { key: 'meatMed', label: '中脂（75卡）' },
      { key: 'meatHigh', label: '高脂（120卡）' },
      { key: 'meatXHigh', label: '超高脂（135卡）' },
    ] },
  { name: '蔬菜', glyph: '蔬', tint: '#E3EBD9', color: '#4A7C59', note: '25 卡/份', fields: [{ key: 'veg', label: '份數' }] },
  { name: '全穀雜糧', glyph: '穀', tint: '#F1E8D2', color: '#A8842E', note: '70 卡/份', fields: [{ key: 'grain', label: '份數' }] },
  { name: '油脂堅果', glyph: '油', tint: '#F3E7D8', color: '#C77B4A', note: '45 卡/份', fields: [{ key: 'oil', label: '份數' }] },
  { name: '水果', glyph: '果', tint: '#F6E5E9', color: '#B5537A', note: '60 卡/份', fields: [{ key: 'fruit', label: '份數' }] },
  { name: '乳品', glyph: '乳', tint: '#E5EBF1', color: '#5B8DB8', note: '80–150 卡/份',
    fields: [
      { key: 'milkSkim', label: '脫脂（80卡）' },
      { key: 'milkLow', label: '低脂（120卡）' },
      { key: 'milkFull', label: '全脂（150卡）' },
    ] },
];

// 版面順序（三欄）：水果 蔬菜 全穀雜糧／蛋豆魚肉 乳品 油脂堅果
const LAYOUT_ORDER = ['水果', '蔬菜', '全穀雜糧', '蛋豆魚肉', '乳品', '油脂堅果'];
const ORDERED_GROUPS = LAYOUT_ORDER.map((n) => FOOD_INPUT_GROUPS.find((g) => g.name === n)!);

// 佔位文字用短欄位名（去掉卡數註記）
const shortLabel = (label: string) => label.split('（')[0];

interface FoodFieldsProps {
  foodStr: Record<FoodKey, string>;
  onChange: (key: FoodKey, raw: string) => void;
  onBlur: (key: FoodKey) => void;
}

// 六大類份數輸入表單（記錄飲食視窗與營養師編輯份數共用）
// 緊湊三欄版型：圓形圖示＋名稱＋直排輸入框；點圖示或名稱開啟該分類的份數指南
export function FoodFields({ foodStr, onChange, onBlur }: FoodFieldsProps) {
  const openGuide = useStore((s) => s.openGuide);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px 10px', borderTop: '1px solid #F0EDE3', paddingTop: 14 }}>
      {ORDERED_GROUPS.map((g) => (
        <div key={g.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <button
            onClick={() => openGuide(Math.max(0, GUIDE_DATA.findIndex((c) => c.name === g.name)))}
            title={`${g.note}・點我看「一份是多少？」`}
            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
          >
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'transparent', border: `2px solid ${g.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, color: g.color, fontWeight: 900 }}>{g.glyph}</div>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: '#2D3B2D' }}>{g.name}</span>
          </button>
          {g.fields.map((f) => (
            <input
              key={f.key}
              type="number"
              min={0}
              max={99}
              step={0.1}
              placeholder={shortLabel(f.label)}
              title={f.label}
              value={foodStr[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
              onBlur={() => onBlur(f.key)}
              style={{ height: 38, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 8px', fontSize: 14.5, outline: 'none', background: '#FBFAF6', width: '100%', textAlign: 'center' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// 唯讀版份數列：動態牆貼文用，只顯示「分類圖示＋份數」（多欄位分類顯示合計；滑過看細項）
export function FoodSummaryGrid({ food }: { food: Food }) {
  const groups = ORDERED_GROUPS
    .map((g) => {
      const filled = g.fields.filter((f) => (food[f.key] || 0) > 0);
      const total = Math.round(filled.reduce((a, f) => a + (food[f.key] || 0), 0) * 10) / 10;
      return { g, filled, total };
    })
    .filter((x) => x.total > 0);
  if (!groups.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', borderTop: '1px solid #F0EDE3', paddingTop: 10 }}>
      {groups.map(({ g, filled, total }) => (
        <div
          key={g.name}
          title={`${g.name}：${filled.map((f) => `${shortLabel(f.label)} ${food[f.key]} 份`).join('、')}`}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <div style={{ width: 30, height: 30, flex: 'none', borderRadius: '50%', background: 'transparent', border: `1.8px solid ${g.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13.5, color: g.color, fontWeight: 900 }}>{g.glyph}</div>
          <span style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 800, color: '#2D3B2D' }}>{total}</span>
        </div>
      ))}
    </div>
  );
}

// 自定義熱量項目編輯器（記錄飲食視窗與營養師編輯份數共用）：
// 四種新增按鈕＋逐項卡片；custom 自填名稱＋大卡，糖／酒精／蛋白質輸入重量自動換算。
// history（選用）＝載入「之前記過的自訂項目」讓使用者一鍵再次加入
export function CustomItemsEditor({
  drafts,
  setDrafts,
  history,
}: {
  drafts: CustomDraft[];
  setDrafts: Dispatch<SetStateAction<CustomDraft[]>>;
  history?: () => Promise<{ name: string; kcal: number }[]>;
}) {
  const full = drafts.length >= MAX_CUSTOM_ITEMS;
  const setDraft = (i: number, patch: Partial<CustomDraft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const removeDraft = (i: number) => setDrafts((ds) => ds.filter((_, j) => j !== i));
  const addDraft = (type: CustomItemType) =>
    setDrafts((ds) => (ds.length >= MAX_CUSTOM_ITEMS ? ds : [...ds, { type, name: '', amountStr: '', kcalStr: '' }]));
  // 歷史自訂項目：有「名稱還空著的自定義卡」時才載入（null＝未載入），
  // 建議清單顯示在該卡內，點一下直接填入名稱＋大卡；填了名稱就自動收起
  const [hist, setHist] = useState<{ name: string; kcal: number }[] | null>(null);
  const wantHist = !!history && drafts.some((d) => d.type === 'custom' && !d.name);
  useEffect(() => {
    if (wantHist && hist === null && history) {
      history().then(setHist).catch(() => setHist([]));
    }
  }, [wantHist, hist, history]);
  const inputStyle = { height: 42, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px', fontSize: 14, outline: 'none', background: '#FBFAF6' } as const;
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CUSTOM_ITEM_DEFS.map((def) => (
          <button
            key={def.k}
            onClick={() => addDraft(def.k)}
            disabled={full}
            className="hv-sand"
            style={{
              flex: 'none', height: 36, padding: '0 14px', borderRadius: 99, border: '1.5px solid #DDD8CA',
              background: '#fff', color: '#4A5A4A', fontSize: 13, fontWeight: 800,
              cursor: full ? 'default' : 'pointer', opacity: full ? 0.5 : 1,
            }}
          >
            ＋{def.label}
          </button>
        ))}
      </div>
      {drafts.length === 0 && (
        <div style={{ fontSize: 13, color: '#8A9284', padding: '14px 0', textAlign: 'center', lineHeight: 1.7 }}>
          還沒有自定義項目。<br />點上方按鈕新增，例如手搖飲、酒類或蛋白粉。
        </div>
      )}
      {drafts.map((d, i) => {
        const def = CUSTOM_ITEM_DEFS.find((x) => x.k === d.type) ?? CUSTOM_ITEM_DEFS[0];
        const isCustom = d.type === 'custom';
        return (
          <div key={i} style={{ flex: 'none', border: '1.5px solid #E4DFD2', borderRadius: 14, background: '#FBFAF6', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 900, color: '#2D3B2D' }}>{def.label}</span>
              <span style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 700, color: '#4A7C59' }}>{customDraftKcal(d)} kcal</span>
              <span style={{ flex: 1 }} />
              <button
                onClick={() => removeDraft(i)}
                title="移除這個項目"
                style={{ width: 22, height: 22, border: 'none', borderRadius: '50%', background: 'rgba(45,59,45,.65)', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>
            {isCustom ? (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="名稱（例：珍珠奶茶）"
                    value={d.name}
                    maxLength={50}
                    onChange={(e) => setDraft(i, { name: e.target.value })}
                    style={{ ...inputStyle, flex: 2, minWidth: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="大卡"
                      value={d.kcalStr}
                      onChange={(e) => setDraft(i, { kcalStr: e.target.value })}
                      onBlur={() => { const v = clampKcal(d.kcalStr); setDraft(i, { kcalStr: v ? String(v) : '' }); }}
                      style={{ ...inputStyle, width: '100%', minWidth: 0 }}
                    />
                    <span style={{ flex: 'none', fontSize: 12.5, color: '#6B7565' }}>kcal</span>
                  </div>
                </div>
                {/* 名稱還空著時列出記過的自訂項目（新→舊），點一下填入這張卡；填了名稱自動收起 */}
                {history && !d.name && hist !== null && hist.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: '#8A9284' }}>從記過的項目選：</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {hist.map((h, hi) => (
                        <button
                          key={`${h.name}|${h.kcal}|${hi}`}
                          onClick={() => setDraft(i, { name: h.name, kcalStr: String(h.kcal) })}
                          className="hv-sand"
                          style={{
                            flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, padding: '0 12px',
                            border: '1px solid #E4DFD2', borderRadius: 99, background: '#fff', color: '#4A5A4A',
                            fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                          }}
                        >
                          {h.name}
                          <span style={{ fontFamily: 'Outfit', color: '#4A7C59' }}>{h.kcal} kcal</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={d.amountStr}
                    onChange={(e) => setDraft(i, { amountStr: e.target.value })}
                    onBlur={() => { const v = clampAmount(d.amountStr); setDraft(i, { amountStr: v ? String(v) : '' }); }}
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  />
                  <span style={{ flex: 'none', fontSize: 13, color: '#4A5A4A', fontWeight: 700 }}>{def.unit}</span>
                  <span style={{ flex: 'none', fontSize: 12.5, color: '#8A9284' }}>= {customDraftKcal(d)} 大卡</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#8A9284' }}>{def.hint}</div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// 唯讀版三大營養素列：動態牆貼文與營養師檢視共用（醣類／蛋白質／脂質公克數，依份數與自定義換算）。
// 預設收起，點「三大營養素」隨時展開／收起（逐貼文各自記憶展開狀態）。
export function MacroSummaryRow({ macros }: { macros: Macros }) {
  const [open, setOpen] = useState(false);
  if (!macros.carb && !macros.protein && !macros.fat) return null;
  const parts: { name: string; grams: number; color: string }[] = [
    { name: '醣類', grams: macros.carb, color: '#C0564A' },
    { name: '蛋白質', grams: macros.protein, color: '#5B8DB8' },
    { name: '脂質', grams: macros.fat, color: '#C77B4A' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? '收起三大營養素' : '展開三大營養素'}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', padding: 0, fontSize: 12, fontWeight: 700, color: '#8A9284', cursor: 'pointer' }}
      >
        三大營養素
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px', fontSize: 12, color: '#6B7565' }}>
          {parts.map((p) => (
            <span key={p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flex: 'none' }} />
              {p.name} <span style={{ fontFamily: 'Outfit', fontWeight: 800, color: '#4A5A4A' }}>{p.grams}</span> g
            </span>
          ))}
          {macros.sugar > 0 && (
            <span style={{ color: '#A8433A' }}>（含精緻糖 <span style={{ fontFamily: 'Outfit', fontWeight: 800 }}>{macros.sugar}</span> g）</span>
          )}
        </div>
      )}
    </div>
  );
}

// 營養師調整前的會員原始紀錄（動態牆貼文、營養師檢視與編輯視窗共用）：
// 調整後的數值為主要顯示，這裡逐頁（每張照片／每個無照片項目）列出原始內容；
// 帶入 current（目前的 entry）時只列「有被調整」的頁面（調整前 → 調整後對照），
// 沒動過的頁面不顯示；若所有頁面都沒差異（例如營養師編輯器剛開啟時）退回列出全部當參考。
// collapsible＝預設收起、點標題展開／收起（動態牆貼文用，與三大營養素一致）。
export function OrigSummary({
  orig,
  current,
  label = '調整前的原始紀錄',
  collapsible = false,
}: {
  orig: EntryOrig;
  current?: Pick<Entry, 'photos' | 'photoFoods' | 'photoCustoms' | 'items'>;
  label?: string;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = origTotals(orig);
  const pageText = (food: Food | undefined, customs: CustomItem[]): string => {
    const parts = [
      food ? foodSummary(food) : '',
      customs.map((c) => `${customItemLabel(c)} ${c.kcal} kcal`).join('、'),
    ].filter(Boolean);
    return parts.join('；');
  };
  const sameFood = (a?: Food, b?: Food) => FOOD_KEYS.every((k) => (a?.[k] || 0) === (b?.[k] || 0));
  const cKey = (c: CustomItem) => `${c.type}|${c.name}|${c.amount ?? ''}|${c.kcal}`;
  const sameCustoms = (a: CustomItem[], b: CustomItem[]) =>
    a.length === b.length && a.every((c, i) => cKey(c) === cKey(b[i]));

  // 逐值 diff：只列出真正被改的類別（例如「蔬菜 2 → 3 份」），沒動的類別不出現
  const foodDiff = (a?: Food, b?: Food): string[] =>
    FOOD_KEYS.filter((k) => (a?.[k] || 0) !== (b?.[k] || 0)).map(
      (k) => `${FOOD_KEY_NAMES[k]} ${a?.[k] || 0} → ${b?.[k] || 0} 份`
    );
  // 自定義項目 diff：內容有變視為「移除舊的＋新增新的」
  const customsDiff = (a: CustomItem[], b: CustomItem[]): string[] => {
    const as = a.map(cKey);
    const bs = b.map(cKey);
    return [
      ...a.filter((c) => !bs.includes(cKey(c))).map((c) => `移除「${customItemLabel(c)} ${c.kcal} kcal」`),
      ...b.filter((c) => !as.includes(cKey(c))).map((c) => `新增「${customItemLabel(c)} ${c.kcal} kcal」`),
    ];
  };

  // after === null＝這一頁沒被調整（單行灰字）；removed＝照片已被移除；
  // diffs＝有被調整的頁面逐值差異（只列被改的類別與自定義項目增刪）
  type Row = { id: string; thumb?: string; itemNo?: number; before: string; after: string | null; removed?: boolean; diffs?: string[] };
  const rows: Row[] = [];

  // 照片頁：以目前照片順序為主，只存在快照的照片（已被移除）附在後面
  const curPhotos = current?.photos ?? [];
  const origUrls = new Set([...Object.keys(orig.photoFoods), ...Object.keys(orig.photoCustoms)]);
  const urls = [...curPhotos, ...[...origUrls].filter((u) => !curPhotos.includes(u))];
  for (const url of urls) {
    const oF = orig.photoFoods[url];
    const oC = orig.photoCustoms[url] ?? [];
    const before = pageText(oF, oC);
    if (!current) {
      if (before) rows.push({ id: `p${url}`, thumb: url, before, after: null });
      continue;
    }
    const exists = curPhotos.includes(url);
    const after = exists ? pageText(current.photoFoods[url], current.photoCustoms[url] ?? []) : '';
    const changed = !exists || !sameFood(oF, current.photoFoods[url]) || !sameCustoms(oC, current.photoCustoms[url] ?? []);
    if (!before && !after && !changed) continue; // 前後都空白的照片不列
    const diffs = changed && exists
      ? [...foodDiff(oF, current.photoFoods[url]), ...customsDiff(oC, current.photoCustoms[url] ?? [])]
      : undefined;
    rows.push({ id: `p${url}`, thumb: url, before, after: changed ? after : null, removed: !exists, diffs });
  }

  // 無照片項目頁：依序對照（營養師編輯器保留項目順序）
  const itemCount = Math.max(orig.items.length, current?.items.length ?? 0);
  for (let i = 0; i < itemCount; i++) {
    const o = orig.items[i];
    const c = current?.items[i];
    const before = o ? pageText(o.food, o.customItems) : '';
    if (!current) {
      if (before) rows.push({ id: `i${i}`, itemNo: i + 1, before, after: null });
      continue;
    }
    const changed = !sameFood(o?.food, c?.food) || !sameCustoms(o?.customItems ?? [], c?.customItems ?? []);
    const after = c ? pageText(c.food, c.customItems) : '';
    if (!before && !after && !changed) continue;
    const diffs = changed
      ? [...foodDiff(o?.food, c?.food), ...customsDiff(o?.customItems ?? [], c?.customItems ?? [])]
      : undefined;
    rows.push({ id: `i${i}`, itemNo: i + 1, before, after: changed ? after : null, diffs });
  }

  // legacy 紀錄（份數只存在整筆 food、無逐頁資料）：退回整餐摘要
  if (!rows.length && FOOD_KEYS.some((k) => (orig.food[k] || 0) > 0)) {
    rows.push({ id: 'legacy', before: pageText(orig.food, []), after: null });
  }

  // 只顯示有被調整的頁面（after !== null）；全部無差異時退回列出全部（編輯器剛開啟時的參考用途）
  const shown = current && rows.some((r) => r.after !== null) ? rows.filter((r) => r.after !== null) : rows;

  const box = (
    <div style={{ background: '#FBFAF6', border: '1px dashed #DDD8CA', borderRadius: 11, padding: '8px 11px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#8A9284' }}>
        {collapsible ? '調整前合計' : label}
        <span style={{ fontFamily: 'Outfit', fontWeight: 700, color: '#A39C8C', marginLeft: 6 }}>{t.kcal} kcal</span>
      </div>
      {shown.length === 0 && (
        <div style={{ fontSize: 12, color: '#6B7565', lineHeight: 1.6 }}>（原本未記份數）</div>
      )}
      {shown.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {r.thumb ? (
            <div
              title={r.removed ? '這張照片已被移除' : undefined}
              style={{ width: 26, height: 26, flex: 'none', borderRadius: 7, border: '1px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${r.thumb}')`, opacity: r.removed ? 0.5 : 1 }}
            />
          ) : r.itemNo !== undefined ? (
            <div
              title={`無照片項目 ${r.itemNo}`}
              style={{ width: 26, height: 26, flex: 'none', borderRadius: 7, border: '1px solid #E4DFD2', background: '#F0EDE3', color: '#8A9284', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20h16" /><path d="M6 20a6 6 0 0 1 12 0" /><circle cx="12" cy="9" r="1.2" /></svg>
            </div>
          ) : null}
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.55, wordBreak: 'break-word' }}>
            {r.after === null ? (
              <span style={{ color: '#6B7565' }}>{r.before || '（未記份數）'}</span>
            ) : r.diffs && r.diffs.length ? (
              <div style={{ color: '#5B8DB8', fontWeight: 700 }}>{r.diffs.join('、')}</div>
            ) : (
              <>
                <div style={{ color: '#6B7565' }}>調整前：{r.before || '未記'}</div>
                <div style={{ color: '#5B8DB8', fontWeight: 700 }}>
                  調整後：{r.removed ? '照片已移除' : r.after || '清空'}
                </div>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  if (!collapsible) return box;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? `收起${label}` : `展開${label}`}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', padding: 0, fontSize: 12, fontWeight: 700, color: '#8A9284', cursor: 'pointer' }}
      >
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && box}
    </div>
  );
}

// 唯讀版自定義熱量項目列：動態牆貼文與營養師檢視共用（糖 10g・40 kcal）
export function CustomItemsSummary({ items }: { items: CustomItem[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid #F0EDE3', paddingTop: 10 }}>
      {items.map((it, i) => (
        <span
          key={i}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #E4DFD2', borderRadius: 99, background: '#FBFAF6', padding: '3px 10px', fontSize: 12, color: '#4A5A4A', fontWeight: 700 }}
        >
          {customItemLabel(it)}
          <span style={{ fontFamily: 'Outfit', color: '#4A7C59' }}>{it.kcal} kcal</span>
        </span>
      ))}
    </div>
  );
}

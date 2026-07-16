import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './helpers.js';

// 對接 eland LLM Gateway（LiteLLM，OpenAI 相容）。Token 只存在後端，絕不外流到前端。
// 需要的環境變數：
//   LLM_TOKEN        （必填）呼叫 gateway 的 Bearer token
//   LLM_BASE_URL     （選填）預設 https://eigw.elandai.cloud
//   LLM_CHAT_URL     （選填）完整的 chat completions 端點，未設定時由 BASE_URL 推導
//   LLM_OCR_MODEL    （選填）判斷營養素／看圖用的「視覺」模型，預設 gemma-4-31b
//                    （已實測：gemma-4-31b 看圖正常、且單次請求可吃多張圖（10 張 OK）；
//                     gemma-4-12b 為純文字部署、不吃圖；gemma-4-e4b、olmocr 亦可看圖作為備援）
//   LLM_COMMENT_MODEL（選填）純文字 AI 評語用的模型，預設 gemma-4-12b；貼文含照片時改用視覺模型
const LLM_TOKEN = (process.env.LLM_TOKEN || '').trim();
const BASE_URL = (process.env.LLM_BASE_URL || 'https://eigw.elandai.cloud').replace(/\/$/, '');
const CHAT_URL = process.env.LLM_CHAT_URL || `${BASE_URL}/v1/chat/completions`;

// 看圖任務（OCR、含照片的評語）用的視覺模型；主模型（31b）壞掉時自動退回備援（e4b）
export const OCR_MODEL = process.env.LLM_OCR_MODEL || 'gemma-4-31b';
export const OCR_FALLBACK_MODEL = process.env.LLM_OCR_FALLBACK_MODEL || 'gemma-4-e4b';
// 純文字評語用的模型；主模型（12b）壞掉時自動退回備援（e4b）
export const COMMENT_MODEL = process.env.LLM_COMMENT_MODEL || 'gemma-4-12b';
export const COMMENT_FALLBACK_MODEL = process.env.LLM_COMMENT_FALLBACK_MODEL || 'gemma-4-e4b';

// AI 評語是否附上照片（送進視覺模型）。31b 修復後預設「開啟」：
// 評語會參考貼文的全部照片；設 LLM_COMMENT_USE_PHOTO=false 可退回純文字模式（省視覺模型負載）。
const COMMENT_USE_PHOTO_RAW = (process.env.LLM_COMMENT_USE_PHOTO || '').trim();
export const COMMENT_USE_PHOTO =
  COMMENT_USE_PHOTO_RAW === '' ? true : /^(1|true|yes|on)$/i.test(COMMENT_USE_PHOTO_RAW);

export function aiConfigured(): boolean {
  return !!LLM_TOKEN;
}

// OpenAI 相容的訊息內容：純文字或（文字＋圖片）陣列
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  // 要求回傳 JSON 物件（gateway 支援時）；不支援時仍會靠提示詞約束
  json?: boolean;
}

// 讀取 uploads 內的照片並轉成 data URI（供視覺模型使用）
export function photoDataUri(photoUrl: string): string | null {
  if (!photoUrl.startsWith('/uploads/')) return null;
  const file = path.join(UPLOAD_DIR, path.basename(photoUrl));
  try {
    const buf = fs.readFileSync(file);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export function imagePart(dataUri: string): ContentPart {
  return { type: 'image_url', image_url: { url: dataUri } };
}
export function textPart(text: string): ContentPart {
  return { type: 'text', text };
}

// 單次模型呼叫的逾時（毫秒）。主模型卡住時要留時間換備援：
// 兩段嘗試合計需小於 nginx 對 /api/ai/ 的 proxy_read_timeout（150s），預設 45s×2＝90s。
const TIMEOUT_MS = Math.max(5_000, Number(process.env.LLM_TIMEOUT_MS) || 45_000);

// 呼叫 gateway 取得單一回覆文字；逾時、非 2xx 或格式異常皆丟出錯誤（由呼叫端轉成 502/503）
export async function chat(opts: ChatOptions): Promise<string> {
  if (!aiConfigured()) throw new Error('AI 服務尚未設定');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_TOKEN}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 800,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`LLM gateway ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('LLM 回覆為空');
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

// 依序嘗試多個模型（主模型 → 備援模型），回傳成功的回覆與「實際使用的模型」。
// 模型偶爾會整組壞掉（如 31b 曾看圖 500），任何錯誤（HTTP 錯誤／逾時／空回覆）都換下一個；全部失敗才丟錯。
export async function chatWithFallback(
  models: string[],
  opts: Omit<ChatOptions, 'model'>
): Promise<{ text: string; model: string }> {
  const chain = [...new Set(models.filter(Boolean))];
  let lastError: unknown = new Error('沒有可用的模型');
  for (const model of chain) {
    try {
      const text = await chat({ ...opts, model });
      return { text, model };
    } catch (e) {
      lastError = e;
      console.error(`LLM model ${model} failed, trying next:`, e instanceof Error ? e.message : e);
    }
  }
  throw lastError;
}

// 從模型回覆中抽出第一個 JSON 物件（容忍 ```json 圍欄或前後多餘文字）
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('LLM 未回傳 JSON');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

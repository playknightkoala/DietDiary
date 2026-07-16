import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './helpers.js';

// 對接 eland LLM Gateway（LiteLLM，OpenAI 相容）。Token 只存在後端，絕不外流到前端。
// 需要的環境變數：
//   LLM_TOKEN        （必填）呼叫 gateway 的 Bearer token
//   LLM_BASE_URL     （選填）預設 https://eigw.elandai.cloud
//   LLM_CHAT_URL     （選填）完整的 chat completions 端點，未設定時由 BASE_URL 推導
//   LLM_OCR_MODEL    （選填）判斷營養素／看圖用的「視覺」模型，預設 gemma-4-e4b
//                    （此 gateway 上 gemma-4-12b 為純文字部署、不吃圖；gemma-4-31b 看圖會 500，
//                     可看圖的是 gemma-4-e4b 與 olmocr）
//   LLM_COMMENT_MODEL（選填）純文字 AI 評語用的模型，預設 gemma-4-12b；貼文含照片時改用視覺模型
const LLM_TOKEN = (process.env.LLM_TOKEN || '').trim();
const BASE_URL = (process.env.LLM_BASE_URL || 'https://eigw.elandai.cloud').replace(/\/$/, '');
const CHAT_URL = process.env.LLM_CHAT_URL || `${BASE_URL}/v1/chat/completions`;

// 看圖任務（OCR、含照片的評語）用的視覺模型
export const OCR_MODEL = process.env.LLM_OCR_MODEL || 'gemma-4-e4b';
// 純文字評語用的模型
export const COMMENT_MODEL = process.env.LLM_COMMENT_MODEL || 'gemma-4-12b';

// AI 評語是否附上照片（送進視覺模型）。
// 自架環境為省重模型負載預設「關閉」：評語只依敘述＋已記錄份數，一律走純文字模型（COMMENT_MODEL）。
// 待更強的視覺模型（如 gemma-4-31b）修復上線後，設為 true 讓評語也參考照片。
export const COMMENT_USE_PHOTO = /^(1|true|yes|on)$/i.test((process.env.LLM_COMMENT_USE_PHOTO || '').trim());

export function aiConfigured(): boolean {
  return !!LLM_TOKEN;
}

// OpenAI 相容的訊息內容：純文字或（文字＋圖片）陣列
type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
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

// 呼叫 gateway 取得單一回覆文字；逾時、非 2xx 或格式異常皆丟出錯誤（由呼叫端轉成 502/503）
export async function chat(opts: ChatOptions): Promise<string> {
  if (!aiConfigured()) throw new Error('AI 服務尚未設定');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
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

// 從模型回覆中抽出第一個 JSON 物件（容忍 ```json 圍欄或前後多餘文字）
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('LLM 未回傳 JSON');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

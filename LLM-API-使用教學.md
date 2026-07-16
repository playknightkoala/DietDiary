# eLAND Intelligence Gateway — LLM API 串接教學

本平台提供 **OpenAI 相容** 的 API。只要你會用 OpenAI 的 SDK 或 HTTP 請求，把 **base URL** 換成本平台、**API Key** 換成你的 Virtual Key，就能直接串接使用。

> 本文件適用對象：要在自己的程式 / 服務中**串接**本平台 LLM 的開發者。

---

## 目錄

1. [基本資訊](#1-基本資訊)
2. [取得 API Key](#2-取得-api-key)
3. [認證方式（設定 Token）](#3-認證方式設定-token)
4. [發送對話請求](#4-發送對話請求)
5. [請求 Body 參數](#5-請求-body-參數)
6. [回傳格式](#6-回傳格式)
7. [串流（Streaming）](#7-串流streaming)
8. [錯誤格式與狀態碼](#8-錯誤格式與狀態碼)
9. [各語言完整範例](#9-各語言完整範例)
10. [常見問題](#10-常見問題)

---

## 1. 基本資訊

| 項目 | 內容 |
|------|------|
| **Base URL** | `https://eigw.elandai.cloud/v1` |
| **對話端點** | `POST https://eigw.elandai.cloud/v1/chat/completions` |
| **格式** | OpenAI 相容（Chat Completions） |
| **認證** | HTTP Header `Authorization: Bearer <你的 API Key>` |

可用的**模型清單**請參考另行提供的清單，`model` 欄位填入其中的名稱即可。

---

## 2. 取得 API Key

API Key（Virtual Key，以 `sk-` 開頭）請**向相關人員申請**取得。

> 🔒 API Key 等同密碼，請勿寫死在前端網頁、公開的程式碼或 commit 進版控。建議以環境變數或密鑰管理方式保存。

---

## 3. 認證方式（設定 Token）

每個請求都要帶上這個 HTTP Header：

```
Authorization: Bearer sk-你的KEY
```

另外送 JSON 時需要：

```
Content-Type: application/json
```

---

## 4. 發送對話請求

**端點**：`POST https://eigw.elandai.cloud/v1/chat/completions`

**最小範例（curl）**
```bash
curl https://eigw.elandai.cloud/v1/chat/completions \
  -H "Authorization: Bearer sk-你的KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-4-12b",
    "messages": [
      { "role": "user", "content": "你好，請自我介紹" }
    ]
  }'
```

（`model` 請改成你拿到的清單中的名稱。）

`messages` 是一個陣列，依對話順序放入，每筆有 `role` 與 `content`：

| role | 用途 |
|------|------|
| `system` | 系統設定 / 角色指示（可選，放在最前面） |
| `user` | 使用者輸入 |
| `assistant` | 模型先前的回覆（做多輪對話時把歷史帶回來） |

**多輪對話範例 body**
```json
{
  "model": "gemma-4-12b",
  "messages": [
    { "role": "system", "content": "你是一個簡潔的助理，回答不超過三句話。" },
    { "role": "user", "content": "什麼是 LLM？" },
    { "role": "assistant", "content": "LLM 是大型語言模型，能理解與生成文字。" },
    { "role": "user", "content": "那它可以用來做什麼？" }
  ]
}
```

---

## 5. 請求 Body 參數

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `model` | string | ✅ | 模型名稱（填清單中提供的名稱） |
| `messages` | array | ✅ | 對話訊息陣列（見上） |
| `stream` | boolean | | `true` 時以串流逐字回傳，預設 `false` |
| `temperature` | number | | 隨機性，0～2，越高越發散，預設依模型 |
| `max_tokens` | integer | | 限制回覆最大 token 數 |
| `top_p` | number | | Nucleus sampling，0～1 |
| `stop` | string / array | | 遇到指定字串即停止生成 |

> 其餘 OpenAI Chat Completions 參數多數也支援，會透傳給後端模型。

---

## 6. 回傳格式

非串流（`stream` 未設或為 `false`）時，回傳一個 JSON 物件：

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1752600000,
  "model": "gemma-4-12b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！我是 AI 助理，可以協助你回答問題、整理資訊等。"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 20,
    "total_tokens": 35
  }
}
```

**最常用的欄位**：

| 欄位 | 說明 |
|------|------|
| `choices[0].message.content` | **模型的回覆文字**（最常取用的就是這個） |
| `choices[0].finish_reason` | 結束原因：`stop`（正常）、`length`（達 max_tokens）等 |
| `usage.prompt_tokens` | 輸入 token 數 |
| `usage.completion_tokens` | 輸出 token 數 |
| `usage.total_tokens` | 總計 token 數 |
| `model` | 實際使用的模型 |

取用回覆內容（以 Python 為例）：
```python
answer = resp["choices"][0]["message"]["content"]
```

---

## 7. 串流（Streaming）

在 body 加上 `"stream": true`，伺服器會以 **SSE（Server-Sent Events）** 逐塊回傳，適合即時顯示打字效果。

**請求**
```bash
curl https://eigw.elandai.cloud/v1/chat/completions \
  -H "Authorization: Bearer sk-你的KEY" \
  -H "Content-Type: application/json" \
  -d '{ "model": "gemma-4-12b", "messages": [{"role":"user","content":"寫一首短詩"}], "stream": true }'
```

**回傳**（多行，每行一個 `data:` 事件）
```
data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"春"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"風"},"finish_reason":null}]}

data: [DONE]
```

處理方式：
- 逐行讀取，只看 `data:` 開頭的行。
- 把每塊的 `choices[0].delta.content` **累加**起來，就是完整回覆。
- 收到 `data: [DONE]` 表示結束。

---

## 8. 錯誤格式與狀態碼

錯誤一律以 OpenAI 相容格式回傳：

```json
{
  "error": {
    "message": "Invalid API key",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  },
  "object": "error"
}
```

常見狀態碼：

| HTTP | code | 意義 / 處理 |
|------|------|------------|
| `401` | `missing_api_key` / `invalid_api_key` | 沒帶或帶錯 Key、Key 已停用/過期 → 檢查 `Authorization` header |
| `403` | — | 此 Key 無權使用該 model → 換模型或洽管理員開通 |
| `429` | `budget_exceeded` | 預算用罄 → 洽管理員調整額度 |
| `429` | `rate_limited` | 超過速率限制（TPM/RPM/並行）→ 降低頻率後重試 |
| `503` | — | 該模型暫無健康的後端節點 → 稍後重試或換模型 |
| `404` | — | 路徑或 model 名稱錯誤 → 確認 base URL 與 model |

---

## 9. 各語言完整範例

### Python（建議用 OpenAI SDK）

```bash
pip install openai
```

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://eigw.elandai.cloud/v1",
    api_key="sk-你的KEY",
)

resp = client.chat.completions.create(
    model="gemma-4-12b",
    messages=[{"role": "user", "content": "你好，請自我介紹"}],
)
print(resp.choices[0].message.content)
```

串流：
```python
stream = client.chat.completions.create(
    model="gemma-4-12b",
    messages=[{"role": "user", "content": "寫一首短詩"}],
    stream=True,
)
for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)
```

### Python（不裝 SDK，用 requests）

```python
import requests

r = requests.post(
    "https://eigw.elandai.cloud/v1/chat/completions",
    headers={
        "Authorization": "Bearer sk-你的KEY",
        "Content-Type": "application/json",
    },
    json={
        "model": "gemma-4-12b",
        "messages": [{"role": "user", "content": "你好"}],
    },
)
print(r.json()["choices"][0]["message"]["content"])
```

### JavaScript / Node（OpenAI SDK）

```bash
npm install openai
```

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://eigw.elandai.cloud/v1",
  apiKey: "sk-你的KEY",
});

const resp = await client.chat.completions.create({
  model: "gemma-4-12b",
  messages: [{ role: "user", content: "你好，請自我介紹" }],
});
console.log(resp.choices[0].message.content);
```

### JavaScript（fetch，無 SDK）

```js
const res = await fetch("https://eigw.elandai.cloud/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk-你的KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gemma-4-12b",
    messages: [{ role: "user", content: "你好" }],
  }),
});
const data = await res.json();
console.log(data.choices[0].message.content);
```

---

## 10. 常見問題

**Q：`model` 要填什麼？**
A：填相關人員提供的模型清單中的名稱，填錯會失敗。

**Q：瀏覽器網頁直接呼叫出現 CORS / `Failed to fetch`？**
A：本 API 是給後端 / SDK / 伺服器端呼叫用的，瀏覽器前端直接跨來源呼叫會被 CORS 擋。請從後端程式或伺服器端呼叫。

**Q：收到 401？**
A：檢查 `Authorization: Bearer sk-...` 是否正確、Key 是否已停用或過期。

**Q：收到 429？**
A：`budget_exceeded` 是預算用罄、`rate_limited` 是頻率過高，前者洽管理員，後者降低請求頻率再試。

**Q：收到 404 或被導到登入頁？**
A：確認 base URL 為 `https://eigw.elandai.cloud/v1`，且路徑、model 名稱正確。

---

_最後更新：2026-07-16_

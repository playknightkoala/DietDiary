# Embedding 微服務（均衡日記知識庫用）

給主後端的「共用菜色知識庫」算向量。文字（菜名/敘述）＋圖片（餐點照片）各一個模型，
底層是 **量化 ONNX + onnxruntime（無 PyTorch）**，記憶體足跡小，適合 ~2GB 機器。

## 記憶體概估

| 元件 | 常駐 RAM |
|---|---|
| onnxruntime + fastembed + FastAPI | ~0.3GB |
| 文字模型 paraphrase-multilingual-MiniLM-L12-v2（384 維） | ~0.5GB |
| 圖片模型 clip-ViT-B-32（512 維） | ~0.4GB |
| **合計** | **~1.2–1.5GB** |

留給主程式與 OS 尚有餘裕，但**實體負載請以你的機器實測為準**；吃緊就把主後端的
`AI_KB_ENABLED` 關掉，主功能不受影響。

## 跑起來

### 方式 A：同機、用主專案的 docker-compose（profile 隔離，推薦單機部署）

已在根目錄 `docker-compose.yml` 定義為 `embedder` 服務，並用 `profiles: ["embed"]` 隔離
（平時 `docker compose up` 不會啟動它，不佔記憶體）：

```bash
# 要用知識庫時，帶 profile 一起起（會多起 embedder）
docker compose --profile embed up -d --build
```

主後端與 embedder 在同一個 compose 網路，用服務名互連。啟用知識庫時，設定主後端環境：

```
AI_KB_ENABLED=true
AI_EMBED_URL=http://embedder:8900
```

（記憶體吃緊就把 `AI_KB_ENABLED` 設回 `false`，或不帶 `--profile embed` 起，主功能照舊。）

### 方式 B：另一台機器（記憶體完全隔離）

```bash
docker build -t dietdiary-embed ./embedding-service
docker run -d --name dietdiary-embed -p 8900:8900 \
  -v dietdiary-embed-models:/models \
  dietdiary-embed
```

主後端設 `AI_EMBED_URL=http://<那台的位址>:8900`、`AI_KB_ENABLED=true`。

首次啟動會下載模型（幾百 MB），`/health` 期間回 `loading`，就緒後回 `ok`。

## 接到主後端

主後端 `docker-compose.yml` 設兩個環境變數即可啟用知識庫：

```
AI_KB_ENABLED=true
AI_EMBED_URL=http://<這台的位址>:8900
```

兩者其一沒設，知識庫自動停用（`kbActive()` 為 false），OCR 照舊。

## API

- `GET /health` → `{ "status": "ok"|"loading", "text_model", "image_model" }`
- `POST /embed/text` body `{ "texts": ["滷雞腿便當"] }` → `{ "vectors": [[...384]], "dim": 384, "model": "..." }`
- `POST /embed/image` body `{ "images": ["<base64 jpeg/png，可含 data: 前綴>"] }` → `{ "vectors": [[...512]], "dim": 512, "model": "..." }`

兩個 embed 端點都支援一次傳多筆（batch）。

## 換模型

用環境變數覆蓋（換模型後知識庫既有向量要重算，見主後端的重新種庫）：

```
TEXT_MODEL=intfloat/multilingual-e5-small
IMAGE_MODEL=Qdrant/clip-ViT-B-32-vision
```

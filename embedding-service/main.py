"""
均衡日記 — Embedding 微服務（文字＋圖片向量）

用途：給主後端的「共用菜色知識庫」算向量。
- /embed/text  ：把敘述（菜名）轉成向量，用來比對「同類菜色」
- /embed/image ：把餐點照片轉成向量，用來比對「相似的圖」
- /health      ：健康檢查與模型資訊

刻意用 fastembed（底層是量化 ONNX + onnxruntime，**不裝 PyTorch**），
記憶體足跡小，適合 ~2GB 的機器。模型於首次啟動時下載並快取。
"""
import base64
import io
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
from fastembed import TextEmbedding, ImageEmbedding

# 多語小模型（含中文），384 維；圖片用 CLIP ViT-B/32，512 維。可用環境變數覆蓋。
TEXT_MODEL = os.environ.get("TEXT_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
IMAGE_MODEL = os.environ.get("IMAGE_MODEL", "Qdrant/clip-ViT-B-32-vision")

_models: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 啟動時載入模型（第一次會下載到 fastembed 快取目錄，建議掛 volume）
    _models["text"] = TextEmbedding(model_name=TEXT_MODEL)
    _models["image"] = ImageEmbedding(model_name=IMAGE_MODEL)
    yield
    _models.clear()


app = FastAPI(title="dietdiary-embedding", lifespan=lifespan)


class TextReq(BaseModel):
    texts: list[str]


class ImageReq(BaseModel):
    images: list[str]  # base64（可含 data: 前綴）


@app.get("/health")
def health():
    ready = "text" in _models and "image" in _models
    return {"status": "ok" if ready else "loading", "text_model": TEXT_MODEL, "image_model": IMAGE_MODEL}


@app.post("/embed/text")
def embed_text(req: TextReq):
    if not req.texts:
        return {"vectors": [], "dim": 0, "model": TEXT_MODEL}
    try:
        vecs = [v.tolist() for v in _models["text"].embed(req.texts)]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"text embed failed: {e}")
    return {"vectors": vecs, "dim": len(vecs[0]) if vecs else 0, "model": TEXT_MODEL}


@app.post("/embed/image")
def embed_image(req: ImageReq):
    if not req.images:
        return {"vectors": [], "dim": 0, "model": IMAGE_MODEL}
    try:
        imgs = []
        for b64 in req.images:
            raw = base64.b64decode(b64.split(",")[-1])
            imgs.append(Image.open(io.BytesIO(raw)).convert("RGB"))
        vecs = [v.tolist() for v in _models["image"].embed(imgs)]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"image embed failed: {e}")
    return {"vectors": vecs, "dim": len(vecs[0]) if vecs else 0, "model": IMAGE_MODEL}

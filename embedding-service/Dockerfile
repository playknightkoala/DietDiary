# Debian slim（glibc）：onnxruntime 原生輪子相容，比 alpine 穩
FROM python:3.11-slim
WORKDIR /app
ENV PIP_NO_CACHE_DIR=1
# fastembed 模型快取目錄（建議掛 volume，避免每次重啟重新下載）
ENV FASTEMBED_CACHE_PATH=/models
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY main.py .
EXPOSE 8900
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8900"]

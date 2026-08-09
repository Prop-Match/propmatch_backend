FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ANONYMIZED_TELEMETRY=FALSE \
    CHROMA_PATH=/data/chroma

WORKDIR /service

COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt

COPY app.py verify.py ./

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data/chroma \
    && chown -R appuser:appuser /service /data/chroma

USER appuser

EXPOSE 8001

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]

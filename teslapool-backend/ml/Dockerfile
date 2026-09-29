# TeslaPool ML inference sidecar. Build context: ./ml
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/ml

COPY inference/requirements.txt inference/requirements.txt
RUN pip install -r inference/requirements.txt

COPY preprocessing/ preprocessing/
COPY models/ models/
COPY inference/app.py inference/app.py

RUN useradd --system --uid 10001 --no-create-home mluser
USER mluser

WORKDIR /srv/ml/inference
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"

CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]

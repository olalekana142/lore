# --- Lore backend: FastAPI + Kùzu + fastembed, all in one image ---
FROM python:3.11-slim

# onnxruntime (used by fastembed) needs libgomp.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    DB_PATH=/app/data/lore.kuzu \
    LORE_EMBED_CACHE=/opt/models/fastembed

# Install deps first (better layer caching). Editable-free install needs the package
# present, so copy the source the build reads from.
COPY pyproject.toml README.md ./
COPY lore ./lore
RUN pip install --no-cache-dir ".[files,drive]"

# Bake the embedding model into the image so runtime needs no network.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/opt/models/fastembed')"

# Sample data (for optional first-boot seeding) + entrypoint.
COPY sample_data ./sample_data
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Persist the Kùzu graph across container restarts.
VOLUME ["/app/data"]
EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

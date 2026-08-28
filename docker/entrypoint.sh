#!/bin/sh
# Seed the sample company on first boot (idempotent, and only if LORE_SEED_SAMPLE is set),
# then hand off to the API server. Seeding runs as its own process that exits BEFORE
# uvicorn opens the Kùzu database, so there is no writer-lock conflict.
set -e

python -m lore.seed || echo "[entrypoint] seed step failed - starting with an empty graph."

exec uvicorn lore.api:app --host 0.0.0.0 --port 8000

"""End-to-end demo of the Echo core loop.

Assumes you've already ingested data, e.g.:
    python -m echo.ingestion.pipeline --creator alice --platform twitter \
        --source sample_data/tweets_sample.csv

Then:
    python scripts/demo.py --creator alice
"""

from __future__ import annotations

import argparse

from echo.graph.queries import find_underused_gems
from echo.graph.schema import get_connection, init_schema
from echo.retrieval.repurpose import generate_repurpose


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--creator", default="alice")
    ap.add_argument("--format", default="twitter thread", help="target format for repurpose")
    args = ap.parse_args()

    conn = init_schema(get_connection())

    print("\n=== UNDERUSED GEMS ===")
    gems = find_underused_gems(conn, args.creator, limit=5)
    if not gems:
        print("No gems found. Did you run the ingestion pipeline first?")
        return
    for g in gems:
        print(f"  [{round(g['best_score']):>6}]  {g['idea']}")

    top = gems[0]
    print(f"\n=== REPURPOSING TOP GEM (in {args.creator}'s voice) ===")
    print(f"Idea: {top['idea']}\n" + "-" * 60)
    print(generate_repurpose(conn, top["idea_id"], target_format=args.format))


if __name__ == "__main__":
    main()

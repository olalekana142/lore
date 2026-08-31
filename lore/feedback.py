"""Answer feedback — thumbs up/down, stored as graph nodes.

Write-mostly signal used to spot bad answers and, later, tune retrieval. Kept in the graph
(not a flat file) so writes are transactional and safe under concurrent requests.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import kuzu


def record(conn: kuzu.Connection, company_id: str, question: str, answer: str,
           rating: str, note: str = "") -> None:
    """Append one feedback row. rating is 'up' or 'down'."""
    conn.execute(
        """CREATE (f:Feedback {id:$id, company_id:$c, question:$q, answer:$a,
                               rating:$r, note:$n, created_at:$t})""",
        {"id": f"fb:{uuid.uuid4().hex}", "c": company_id, "q": question, "a": answer,
         "r": "down" if rating == "down" else "up", "n": note, "t": datetime.now()},
    )


def summary(conn: kuzu.Connection, company_id: str) -> dict:
    """Aggregate up/down counts for a company."""
    res = conn.execute(
        "MATCH (f:Feedback {company_id:$c}) RETURN f.rating AS r, count(*) AS n",
        {"c": company_id},
    )
    counts = {"up": 0, "down": 0}
    while res.has_next():
        rating, n = res.get_next()
        counts[rating if rating in counts else "up"] = int(n)
    return counts

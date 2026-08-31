"""Authentication + permission model.

- Users belong to a company and to zero or more groups (e.g. "hr", "engineering").
- Documents carry an `audience`: the groups allowed to see them. `everyone` = public.
- Answers, search, and document listings are filtered so a user only ever sees content
  their groups are permitted to see. Anonymous callers see only `everyone` (public) docs.

Passwords are salted PBKDF2 (stdlib, no external deps). Sessions are stateless
HMAC-signed tokens (no server-side session store to lose on restart).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

import kuzu

from lore.config import settings

_ITERATIONS = 200_000


# --------------------------------------------------------------- passwords
def _derive(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _ITERATIONS).hex()


def hash_password(password: str) -> tuple[str, str]:
    salt = os.urandom(16).hex()
    return salt, _derive(password, salt)


def verify_password(password: str, salt: str, expected: str) -> bool:
    return hmac.compare_digest(_derive(password, salt), expected)


# --------------------------------------------------------------- users
def create_user(conn: kuzu.Connection, company_id: str, username: str, password: str,
                name: str = "", groups: list[str] | None = None) -> dict:
    salt, pw_hash = hash_password(password)
    uid = f"{company_id}:{username}"
    conn.execute(
        """MERGE (u:User {id:$id})
           SET u.company_id=$c, u.username=$un, u.name=$n,
               u.salt=$s, u.pw_hash=$h, u.groups=$g""",
        {"id": uid, "c": company_id, "un": username, "n": name or username,
         "s": salt, "h": pw_hash, "g": groups or []},
    )
    return {"username": username, "name": name or username, "groups": groups or []}


def _fetch_user(conn: kuzu.Connection, company_id: str, username: str) -> dict | None:
    res = conn.execute(
        "MATCH (u:User {id:$id}) RETURN u.username, u.name, u.salt, u.pw_hash, u.groups",
        {"id": f"{company_id}:{username}"},
    )
    if not res.has_next():
        return None
    un, name, salt, pw_hash, groups = res.get_next()
    return {"username": un, "name": name, "salt": salt, "pw_hash": pw_hash, "groups": groups or []}


def verify_login(conn: kuzu.Connection, company_id: str, username: str, password: str) -> dict | None:
    u = _fetch_user(conn, company_id, username)
    if not u or not verify_password(password, u["salt"], u["pw_hash"]):
        return None
    return {"username": u["username"], "name": u["name"], "groups": u["groups"]}


# --------------------------------------------------------------- tokens
def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(body: str) -> str:
    return hmac.new(settings.secret_key.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]


def mint_token(company_id: str, username: str, groups: list[str]) -> str:
    payload = {"c": company_id, "u": username, "g": groups,
               "exp": int(time.time()) + settings.session_hours * 3600}
    body = _b64e(json.dumps(payload).encode())
    return f"{body}.{_sign(body)}"


def parse_token(token: str | None) -> dict | None:
    """Return {company_id, username, groups} for a valid, unexpired token, else None."""
    if not token:
        return None
    token = token.removeprefix("Bearer ").strip()
    if "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(body)):
        return None
    try:
        payload = json.loads(_b64d(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if payload.get("exp", 0) < time.time():
        return None
    return {"company_id": payload["c"], "username": payload["u"], "groups": payload.get("g", [])}


# --------------------------------------------------------------- permissions
PUBLIC = "everyone"


def can_see(audience: list[str] | None, groups: list[str] | None) -> bool:
    """True if a user in `groups` may see a doc with this `audience`."""
    aud = set(audience) if audience else {PUBLIC}
    return PUBLIC in aud or bool(aud & set(groups or []))

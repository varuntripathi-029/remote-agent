"""GitHub OAuth + JWT — identifies the human, per aim.md §4.

Design (see backend/README.md's "Auth" section for the fuller writeup):

- **httpx over authlib**: the whole flow is two outbound HTTP calls (code ->
  GitHub access token, access token -> GitHub user) plus building a redirect
  URL. authlib's generic OAuth client (PKCE, OIDC discovery, many providers)
  is weight this doesn't need; httpx keeps every request this module makes
  readable top to bottom, which matters for something security-sensitive.
- **The GitHub access token is never stored past the callback that fetches
  it** (see `_exchange_code_for_github_user`). Our own JWT is the session
  from then on; GitHub is consulted only to answer "who is this."
- **JWT is a single long-lived token (30 days), not short-lived + refresh.**
  Simpler — no refresh endpoint or refresh-token storage — at the cost of no
  way to shorten a leaked token's window short of adding real revocation.
  aim.md's build order defers revocation to the Ed25519/pairing phase
  anyway, so this isn't giving up anything that phase wasn't already going
  to have to build; it's the pragmatic choice for right now.
- **Mobile OAuth without ever shipping the client secret to the phone**: the
  phone never talks to GitHub directly. It opens a browser at *our*
  `/auth/github/login`, which redirects to GitHub, which redirects back to
  *our* `/auth/github/callback` (a fixed URL, registered once with GitHub —
  see OAUTH_REDIRECT_URI below). That handler does the code exchange
  (needs the secret — stays server-side, never touches the phone) and then
  redirects the browser one more time, to whatever `return_to` the phone
  asked for in the first request (its Expo Go `exp://...` redirect URI, or
  a native build's `devagentremote://` scheme), with our JWT attached. The
  phone's `expo-web-browser` call is watching for exactly that redirect.
- `return_to` is client-supplied, so it's restricted to `exp://` or
  `devagentremote://` — anything else is rejected outright. Without that
  check, this would be an open redirect that could exfiltrate a freshly
  issued JWT to an attacker-controlled URL.

TODO(pairing): everything here identifies a *user*. It says nothing yet
about which `device_id`s that user is allowed to reach — that binding lands
in the Ed25519 + pairing-code phase (aim.md §4). `_user_owns_device` below is
the one seam that phase needs to tighten; every other ownership-adjacent
check in this file only asks "is this JWT valid," never "is this JWT allowed
to reach device X."
"""

from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass, field

import httpx
import jwt
from fastapi import APIRouter
from fastapi.responses import RedirectResponse

GITHUB_CLIENT_ID = os.environ.get("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.environ.get("GITHUB_CLIENT_SECRET")
JWT_SECRET = os.environ.get("JWT_SECRET")
OAUTH_REDIRECT_URI = os.environ.get("OAUTH_REDIRECT_URI")

JWT_ALGORITHM = "HS256"
JWT_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days — see module docstring
LOGIN_STATE_TTL_SECONDS = 5 * 60  # long enough to finish a GitHub login

# Only these URI schemes are ever redirected to with a freshly issued JWT
# attached — see module docstring's open-redirect note.
_ALLOWED_RETURN_TO_SCHEMES = ("exp://", "devagentremote://")


def _require_config() -> None:
    missing = [
        name
        for name, value in (
            ("GITHUB_CLIENT_ID", GITHUB_CLIENT_ID),
            ("GITHUB_CLIENT_SECRET", GITHUB_CLIENT_SECRET),
            ("JWT_SECRET", JWT_SECRET),
            ("OAUTH_REDIRECT_URI", OAUTH_REDIRECT_URI),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            "backend/.env is missing required auth config: "
            f"{', '.join(missing)}. Copy backend/.env.example to backend/.env "
            "and fill these in — see backend/README.md's Auth setup section."
        )


# ---- Users --------------------------------------------------------------


@dataclass
class User:
    user_id: str
    github_id: int
    github_login: str
    created_at: float = field(default_factory=time.time)


class UserStore:
    """In-memory, keyed by github_id for login lookups and by user_id for
    JWT-claim lookups. Same shape as registry.py's ConnectionRegistry:
    swapping in a Postgres-backed implementation later means reimplementing
    these two methods, not touching any call site."""

    def __init__(self) -> None:
        self._by_github_id: dict[int, User] = {}
        self._by_user_id: dict[str, User] = {}

    def get_or_create(self, github_id: int, github_login: str) -> User:
        existing = self._by_github_id.get(github_id)
        if existing is not None:
            return existing
        user = User(user_id=str(uuid.uuid4()), github_id=github_id, github_login=github_login)
        self._by_github_id[github_id] = user
        self._by_user_id[user.user_id] = user
        return user

    def get(self, user_id: str) -> User | None:
        return self._by_user_id.get(user_id)


users = UserStore()


# ---- JWT ------------------------------------------------------------------


def issue_jwt(user: User) -> str:
    now = int(time.time())
    payload = {"sub": user.user_id, "login": user.github_login, "iat": now, "exp": now + JWT_TTL_SECONDS}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> str | None:
    """Return the user_id a valid, unexpired token was issued for, or None
    for anything wrong with it (bad signature, expired, malformed, or a
    user_id that no longer resolves to a known user) — one result type so
    every caller has exactly one thing to check, never a reason to
    distinguish *why* a token didn't work."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or users.get(user_id) is None:
        return None
    return user_id


# ---- Device ownership (pairing seam) --------------------------------------


def user_owns_device(user_id: str, device_id: str) -> bool:
    """TODO(pairing): device_id -> user_id binding doesn't exist until the
    Ed25519 + pairing-code phase (aim.md §4). Until then this can only prove
    *who is asking*, not *whether they're allowed to reach this laptop* — so
    it always returns True. This is the one call site that phase needs to
    change; nothing else in main.py's routing should need to."""
    return True


# ---- Login-state store (CSRF + return_to correlation) ---------------------


class _LoginStateStore:
    def __init__(self) -> None:
        self._pending: dict[str, tuple[str, float]] = {}  # state -> (return_to, created_at)

    def create(self, return_to: str) -> str:
        self._sweep()
        state = uuid.uuid4().hex
        self._pending[state] = (return_to, time.time())
        return state

    def consume(self, state: str) -> str | None:
        entry = self._pending.pop(state, None)
        if entry is None:
            return None
        return_to, created_at = entry
        if time.time() - created_at > LOGIN_STATE_TTL_SECONDS:
            return None
        return return_to

    def _sweep(self) -> None:
        cutoff = time.time() - LOGIN_STATE_TTL_SECONDS
        expired = [s for s, (_, created_at) in self._pending.items() if created_at < cutoff]
        for s in expired:
            self._pending.pop(s, None)


_login_states = _LoginStateStore()


# ---- Routes -----------------------------------------------------------------

router = APIRouter()


@router.get("/auth/github/login")
async def github_login(return_to: str) -> RedirectResponse:
    _require_config()
    if not return_to.startswith(_ALLOWED_RETURN_TO_SCHEMES):
        return RedirectResponse(url="about:blank", status_code=400)

    state = _login_states.create(return_to)
    params = httpx.QueryParams(
        {
            "client_id": GITHUB_CLIENT_ID,
            "redirect_uri": OAUTH_REDIRECT_URI,
            "scope": "read:user",
            "state": state,
        }
    )
    return RedirectResponse(url=f"https://github.com/login/oauth/authorize?{params}")


@router.get("/auth/github/callback")
async def github_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    _require_config()

    return_to = _login_states.consume(state) if state else None
    if return_to is None:
        # Unknown/expired/missing state — nowhere safe to redirect back to,
        # so this is the one auth failure that can't hand the phone a clean
        # error via redirect. Not actionable by the user; just log-worthy.
        return RedirectResponse(url="about:blank", status_code=400)

    if error or not code:
        return RedirectResponse(url=f"{return_to}?error={error or 'missing_code'}")

    try:
        github_id, github_login = await _exchange_code_for_github_user(code)
    except Exception:
        return RedirectResponse(url=f"{return_to}?error=github_exchange_failed")

    user = users.get_or_create(github_id, github_login)
    token = issue_jwt(user)
    return RedirectResponse(url=f"{return_to}?token={token}")


async def _exchange_code_for_github_user(code: str) -> tuple[int, str]:
    """Trade an OAuth code for GitHub's `id`/`login` and nothing else — the
    GitHub access token this obtains along the way is used exactly once, for
    the `GET /user` call two lines down, and then goes out of scope. It is
    never written to the User record, a log line, or returned to this
    function's caller."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": OAUTH_REDIRECT_URI,
            },
            headers={"Accept": "application/json"},
        )
        token_resp.raise_for_status()
        github_access_token = token_resp.json()["access_token"]

        user_resp = await client.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {github_access_token}",
                "Accept": "application/vnd.github+json",
            },
        )
        user_resp.raise_for_status()
        user_json = user_resp.json()
        return user_json["id"], user_json["login"]

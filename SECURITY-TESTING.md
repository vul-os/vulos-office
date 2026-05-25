# Security Testing — Vulos Office + Spaces

This document describes the **pentest / adversarial test suite** for the
`vulos-office` backend (Go) and the Spaces message render path (JSX/vitest).

The suites are written attacker-first: every test **attempts a concrete attack
and asserts it is blocked**. A green run means the corresponding defense holds.
If one of these tests ever goes red, treat it as a **live vulnerability**, not a
flaky test.

## How to run

Go (backend) pentests:

```bash
cd vulos-office

# Run only the pentest suites (verbose):
CGO_ENABLED=0 go test ./backend/... -run 'Pentest' -v

# Or the whole backend test suite (includes pentests + unit tests):
CGO_ENABLED=0 go build ./... && CGO_ENABLED=0 go vet ./... && CGO_ENABLED=0 go test ./...
```

Frontend (Spaces XSS render path) pentest:

```bash
cd vulos-office
npx vitest run src/apps/spaces/pentest-xss.test.jsx
# or the full vitest suite:
npm test
```

## Where the tests live

| File | Layer | Attack classes |
|------|-------|----------------|
| `backend/middleware/pentest_token_test.go` | Auth middleware | 1 (auth/token), 2 (identity at middleware) |
| `backend/handlers/pentest_files_test.go` | File handlers | 2 (identity spoof), 3 (file IDOR), 8 (CSRF/ambient authority) |
| `backend/handlers/pentest_spaces_test.go` | Spaces handlers | 4 (Spaces authz), 5 (MergeOps forgery) |
| `backend/handlers/pentest_meet_test.go` | Meeting handlers | 4 (organizer-only endpoints) |
| `backend/handlers/pentest_creds_test.go` | Auth/creds | 7 (per-user credentials) |
| `backend/handlers/pentest_helpers_test.go` / `pentest_storage_test.go` | test harness | (support) |
| `src/apps/spaces/pentest-xss.test.jsx` | JSX render path | 6 (XSS) |

These build on (and do not replace) the pre-existing focused tests:
`backend/middleware/auth_test.go`, `backend/handlers/files_authz_test.go`,
`backend/handlers/spaces_authz_test.go`, `backend/handlers/auth_creds_test.go`,
and `src/apps/slides/sanitize.test.js`.

## Threat coverage (attack classes)

### 1. Auth / token forgery (`pentest_token_test.go`)
- Forged JWT signed with the **wrong secret** → 401.
- **alg=none** (unsigned) token → 401 (alg-confusion blocked).
- **RS256** token presented to an HS256 verifier → 401 (the middleware pins the
  signing method to `*SigningMethodHMAC`).
- **Expired** token (validly signed) → 401.
- **Tampered** payload (signature no longer matches) → 401.
- **Missing** token on a protected route → 401.
- Garbage bearer value → 401.
- **Dev-secret gating**: the well-known dev key is rejected while a real secret
  is configured; with **no secret and dev mode off** the verifier **fails closed
  (503)** — it never silently accepts the dev key.

### 2. Identity spoofing (`pentest_token_test.go`, `pentest_files_test.go`)
- A forged `X-Account-ID` header does **not** change the acting identity for a
  non-admin; identity is taken only from the verified JWT `sub`.
- Admin impersonation via `X-Account-ID` is gated on the **verified admin
  scope** (`vulos:admin` audience), not on header presence.

### 3. File IDOR / ACL (`pentest_files_test.go`)
The recently-added per-file ACL (`backend/fileacl`) is enforced by **every**
file-scoped handler, all sharing the process-wide `SharedFileAuthz`. The
pentests prove a non-owner cannot pivot from a denied `GET /files/:id` to an
open sibling endpoint:
- Non-owner Get/Update/Delete/**export**/**comment**/**version** → **404**
  (no existence leak — denial mimics "not found").
- `List` returns only the caller's accessible files (no cross-tenant leak).
- An explicit **share** grants the grantee access across the secondary handlers;
  a non-shared **third party is still denied**.
- A non-owner **cannot self-share** the victim's file to gain access.
- Admins bypass the ACL (by design).

### 4. Spaces authz (`pentest_spaces_test.go`, `pentest_meet_test.go`)
- A non-member is denied **every** private/DM channel surface: read, send, edit,
  delete, export-ops, react, list-reactions, pin, list-pins, **search**, list-members.
- Private channels are **hidden** from `ListChannels` for non-members.
- A non-member **cannot self-join** a private channel to bootstrap access.
- **Organizer-only** meeting endpoints (lobby list / admit / admit-all / deny /
  delete) reject non-organizers, and a forged `X-Account-ID` does not promote a
  caller to organizer.

### 5. MergeOps forgery (`pentest_spaces_test.go`, plus `spaces_authz_test.go`)
- An op whose `AuthorID` is **forged** as another user is rejected (403).
- A peer **cannot tombstone** a message authored by someone else, even with a
  self-authored op envelope.
- A non-member **cannot inject ops** into a private channel via the CRDT merge
  path, even when the op is honestly self-authored.

### 6. XSS (`src/apps/spaces/pentest-xss.test.jsx`)
Exercises the **real** Spaces render pipeline
(`RichMessage` → `renderMarkdown()` → DOMPurify → `dangerouslySetInnerHTML`)
with hostile message bodies (`<script>`, `<img onerror>`, `<svg onload>`,
`<iframe>`, `javascript:` / `vbscript:` URLs, autofocus/ontoggle handlers,
markdown links with script-scheme targets). Assertions are **DOM-level**: no
executable element survives and no element carries an `on*` handler or a
`javascript:`/`vbscript:` URL attribute. A standalone DOMPurify-config test for
the slides/docs path lives in `src/apps/slides/sanitize.test.js`.

> Note: an inert `javascript:` substring rendered as **text** (e.g. an
> unconverted markdown link `[x](javascript:...)`, which the renderer leaves as
> plain text rather than an anchor) is harmless and intentionally not flagged —
> the tests assert on the live DOM, not on raw substrings.

### 7. Per-user credentials (`pentest_creds_test.go`, plus `auth_creds_test.go`)
- Once a user is registered, the legacy **shared password** can no longer
  authenticate that account (self-asserted-identity hole stays closed).
- Wrong password → rejected.
- **No user-enumeration oracle**: an unknown account and a wrong password return
  the same `ErrInvalidCredential`; the store also runs a dummy bcrypt compare to
  keep timing roughly constant.
- Empty password never authenticates.
- Registration validation: duplicate registration is rejected (no account
  takeover); passwords shorter than 8 chars are rejected.

### 8. CSRF / method (`pentest_files_test.go`)
The office API is **bearer/JWT-driven**: every handler trusts only the
context identity derived from the verified token (`Authorization: Bearer` or an
explicit token). A cross-site request cannot attach the `Authorization` header,
so **classic CSRF is N/A** for the bearer path. The session **cookie** path is
mitigated with `HttpOnly` + `SameSite=Lax` (see `backend/handlers/auth.go`
`Login`), and the token is never returned in the response body. The pentest
proves there is **no ambient authority**: a state-changing request that carries
no verified token (and only a forged `X-Account-ID`) is attributed to the local
`self` identity, **never** to an attacker-named account.

## Findings

No live vulnerabilities were found while writing this suite — all attacks are
blocked. One initial false alarm in the XSS suite was investigated and confirmed
**not** a vulnerability: `renderMarkdown` only converts `http(s)://` markdown
links to anchors, so a `[x](javascript:...)` payload is left as inert escaped
**text**, never an executable `href`. The assertion was tightened to a DOM-level
check accordingly.

If you add a new file-scoped, channel-scoped, or organizer-scoped endpoint,
extend the relevant pentest suite with a negative test before shipping.

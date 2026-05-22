---
status: design
date: 2026-05-22
---

# Strava MCP — Design

A hosted multi-tenant MCP server that lets any Strava user connect their account to an LLM. Users sign in once via Strava OAuth on the website, copy a generated MCP URL into Claude, and the LLM can then read and modify their Strava data.

## Goals & non-goals

**Goals**
- Any Strava user can connect their account through a short web flow and end up with a working MCP URL they paste into Claude.
- Cover the high-value read surface (activities, streams, stats, gear, clubs, segments) plus the small useful write surface Strava allows.
- Avoid the claude.ai OAuth broker pathway, which has known issues for end-user MCPs in tim-os (see `feedback_no_github_oauth_for_staff` and `project_sheaf_path_token_auth`).

**Non-goals (v1)**
- Kudos / comments — Strava's API does not allow third-party apps to post these.
- Webhook subscriptions for live activity push (deferred — adds significant operational complexity).
- Routes API, club activity feeds, public segment leaderboards beyond the athlete's own efforts.
- Custom domain — using Vercel auto-domain `strava-mcp.vercel.app` for v1.

## Architecture

- **Repo:** `~/tim-os/strava-mcp/`
- **Stack:** Next.js 16 (App Router) on Vercel, Neon Postgres, Drizzle ORM. Matches sheaf / ctca-crm / sfmagic / weft.
- **Domain:** `strava-mcp.vercel.app` (Vercel auto-domain).
- **Surface at the domain:**
  - `/` — marketing page with "Powered by Strava" badge and "Connect Strava" CTA.
  - `/connect` — kicks off the Strava OAuth redirect.
  - `/api/strava/callback` — handles OAuth code exchange and mints the path token.
  - `/connected/<athlete_id>` — shows the user's MCP URL with copy-to-clipboard and disconnect button.
  - `/api/mcp/<path_token>/<athlete_id>` — the MCP HTTP endpoint itself.

## Onboarding flow

1. User visits `/`, clicks **Connect Strava**.
2. Server redirects to Strava's authorize endpoint with the requested scopes.
3. User approves on Strava.
4. Strava redirects back to `/api/strava/callback?code=...&scope=...`.
5. Server exchanges the code for `access_token`, `refresh_token`, `expires_at`, and the athlete payload at `POST https://www.strava.com/api/v3/oauth/token`.
6. Upsert the `athletes` row keyed by Strava athlete id. Generate a fresh random `path_token` (32 random bytes, URL-safe base64). Store its sha256 hash; never persist the raw token.
7. Set a signed session cookie identifying the athlete so `/connected/<id>` refresh works.
8. Redirect to `/connected/<athlete_id>` which renders the MCP URL once: `https://strava-mcp.vercel.app/api/mcp/<path_token>/<athlete_id>`. The user copies this into a Claude custom connector.

**Re-connecting** issues a fresh path token and invalidates the previous one. The MCP URL is shown only on the connected page right after auth; it cannot be recovered later. This keeps the model simple (no second sign-in mechanism). If the user loses the URL they reconnect.

## OAuth scopes

- `read` — public profile
- `activity:read_all` — all activities incl. private
- `activity:write` — update / create / upload activities, star segments
- `profile:read_all` — full profile + stats

All four are requested up front. Splitting read vs. write into two flows is YAGNI for v1.

## Token handling

- **Refresh on every MCP request:** resolve athlete by `(sha256(path_token), athlete_id)` with constant-time compare on the token hash. If `expires_at - now < 5 minutes`, call Strava's refresh endpoint, persist both new `access_token` and new `refresh_token` (refresh tokens rotate on every use), then proceed.
- **Encryption at rest:** `access_token` and `refresh_token` stored encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` env var. Per-row random IV stored alongside the ciphertext.
- **Disconnect:** `/connected/<id>` has a "Disconnect" button that calls `POST https://www.strava.com/oauth/deauthorize` then deletes the `athletes` row.

## Tool surface

### Read (12)

| Tool | Purpose |
|---|---|
| `get_athlete` | Profile + premium status |
| `get_athlete_stats` | Recent 4w / YTD / all-time totals by activity type |
| `get_athlete_zones` | HR + power zones |
| `list_activities` | Date-range, page, per_page; returns summary objects |
| `get_activity` | Full activity (laps, splits, photos, gear, kudos count) |
| `get_activity_streams` | Time-series (latlng, altitude, heartrate, watts, cadence, velocity, temp); `types` + `resolution` params; warns if asking for everything |
| `get_activity_laps` | Lap breakdown |
| `list_gear` | All bikes + shoes |
| `get_gear` | Single piece of gear with mileage |
| `list_clubs` | Athlete's clubs |
| `list_starred_segments` | Athlete's starred segments |
| `get_segment` | Segment details + athlete's leaderboard position |

### Write (4)

| Tool | Purpose |
|---|---|
| `update_activity` | name, type, sport_type, gear_id, commute, trainer, hide_from_home, description |
| `create_activity` | Manual entry: name, sport_type, start_date_local, elapsed_time, distance, description |
| `upload_activity` | Upload .fit / .gpx / .tcx (URL or base64); returns upload id; tool polls upload status to completion |
| `star_segment` | Star / unstar a segment id |

**Total: 16 tools.**

## Data model (Neon)

```sql
CREATE TABLE athletes (
  id                bigint PRIMARY KEY,           -- Strava athlete id
  username          text,
  firstname         text,
  lastname          text,
  profile_url       text,
  scope             text NOT NULL,
  access_token_enc  bytea NOT NULL,
  access_token_iv   bytea NOT NULL,
  refresh_token_enc bytea NOT NULL,
  refresh_token_iv  bytea NOT NULL,
  expires_at        timestamptz NOT NULL,
  path_token_hash   bytea NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz
);
CREATE INDEX athletes_path_token_idx ON athletes(path_token_hash);

CREATE TABLE usage_log (
  id          bigserial PRIMARY KEY,
  athlete_id  bigint NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  tool_name   text NOT NULL,
  ok          boolean NOT NULL,
  error_code  text,
  duration_ms int,
  ts          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_log_athlete_ts_idx ON usage_log(athlete_id, ts DESC);
```

Migrations via Drizzle. Schema in `src/db/schema.ts`.

## Strava API constraints

- **Rate limits — shared across the entire app, not per user.** Overall: 100 req / 15 min and 1,000 req / day. Read: 200 / 2,000 specifically. At scale this is the binding constraint.
- **Mitigations:**
  - In-memory + Neon-backed cache for recent responses keyed by `(athlete_id, endpoint, args)`. Activity lists cached briefly; profile / gear / clubs cached for ~1 hour.
  - Read `X-RateLimit-Usage` / `X-RateLimit-Limit` response headers; expose a debug tool `get_rate_limit_status`; refuse new requests within 5% of either ceiling with a clear, actionable error.
  - Document the constraint visibly on the connected page so users understand what shared limits mean for them.
- **Brand guidelines (Strava ToS):** "Powered by Strava" logo required on marketing + connected pages. App name in the Strava developer settings cannot contain the word "Strava" — register it as e.g. "MCP Connector" while the public name on the site is "Strava MCP". Link to Strava ToS + privacy policy on the marketing page.
- **Refresh tokens rotate** on every use. The refresh path must persist both new tokens or future refreshes break.

## Security

- Path tokens: 32 random bytes URL-safe-base64-encoded; sha256-hashed at rest; constant-time compare on lookup; never logged in plaintext after the one-time display.
- Tokens encrypted at rest (AES-256-GCM, per-row IV).
- HTTPS only (Vercel default).
- Session cookies are signed and httpOnly.
- The MCP URL itself is a bearer credential — losing it means losing access; we recommend rotating by reconnecting if exposed.

## Testing strategy

- Vitest + MSW for unit tests; MSW intercepts all Strava API calls with fixture responses captured from the real API docs.
- Token-refresh logic has dedicated unit tests: stale-token → refresh → persist new pair → retry original call.
- Path-token routing tested for: wrong token, wrong athlete id, valid pair, expired-then-refreshed.
- One end-to-end smoke test against the live Strava API using Tim's account, gated on `STRAVA_TEST_ATHLETE_TOKEN` env so it only runs locally and in selected CI jobs.
- No DB mocking — tests run against a Neon dev branch. `.env.local` must override inherited shell env (per `feedback_env_local_override_for_tests`).

## Open questions / future work

- **Webhook subscriptions** for live activity push — defer; revisit when an LLM workflow needs sub-minute freshness or when polling cost becomes meaningful.
- **Per-user rate limit budgets** — Strava limits are app-wide; if usage gets concentrated on a few heavy users we will need fair-share throttling. Out of v1.
- **Custom domain** — `strava-mcp.vercel.app` is fine for v1; revisit when there is a reason to brand more.
- **Read-only vs write toggle** in onboarding — if users push back on granting `activity:write`, split the connect button into two flows.

## Project metadata

To be added to `~/tim-os/strava-mcp/CLAUDE.md`:

```yaml
---
status: active
last_touched: 2026-05-22
deploy: git push origin main
---
```

(Push-to-deploy via Vercel's GitHub integration.)

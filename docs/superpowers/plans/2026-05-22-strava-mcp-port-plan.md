# Strava MCP — Port Plan (CF Workers → Vercel + Neon)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` for tracking.

**Goal:** Port the forked SportMCP source (upstream `gabeperez/strava-mcp`) from Cloudflare Workers + KV to Vercel Functions + Neon Postgres, deploy to `strava-mcp.vercel.app`, and walk the connect flow end-to-end.

**Why the original 22-task greenfield plan is obsolete:** We discovered SportMCP after writing that plan. The 21 tools, OAuth flow, brand assets, and HTML templates are already implemented upstream — we don't need to rewrite them. The port surface is ~4 files.

**Tech stack changes:**

| Upstream (CF) | This fork (Vercel) |
|---|---|
| Hono on Cloudflare Workers | Hono on Vercel Functions via `@hono/vercel` |
| `STRAVA_SESSIONS: KVNamespace` | `DATABASE_URL` → Neon Postgres |
| `wrangler dev` / `wrangler deploy` | `vercel dev` / `vercel deploy` (or git push) |
| `wrangler secret put …` | `vercel env add …` |
| `c.env.STRAVA_*` | `process.env.STRAVA_*` |

---

## Conventions

- Working directory: `~/tim-os/strava-mcp/`.
- All Strava API logic, OAuth, tools, templates, brand assets are **untouched** from upstream — only the runtime/storage surface changes.
- Keep `wrangler.jsonc` in the tree (not deleted) so upstream merges don't fight us. It's just no longer the build target.

---

## Task 1: Dependencies & scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add Vercel + Neon deps; replace wrangler scripts**

```bash
npm install hono @hono/vercel @neondatabase/serverless
npm install --save-dev @types/node typescript@^5.5.2 vercel
```

- [ ] **Step 2: Edit `package.json` scripts to**

```json
{
  "scripts": {
    "dev": "vercel dev",
    "build": "vercel build",
    "deploy": "vercel deploy --prod --yes",
    "typecheck": "tsc --noEmit",
    "test": "vitest"
  }
}
```

- [ ] **Step 3: Verify the install + typecheck**

Run: `npm run typecheck`
Expected: 0 errors (or only errors pointing at the still-CF-typed `Env.STRAVA_SESSIONS: KVNamespace`, which we'll fix next).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "port: vercel + neon deps and scripts"
```

---

## Task 2: Database schema

**Files:**
- Create: `drizzle/0000_init.sql` (raw SQL — no ORM since we have one table)

- [ ] **Step 1: Write the SQL**

```sql
-- Sessions for connected Strava athletes.
-- Mirrors the KV shape exactly: one JSON blob per athlete keyed by athlete id.
CREATE TABLE IF NOT EXISTS strava_sessions (
  athlete_id BIGINT PRIMARY KEY,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ,            -- denormalized from data.expires_at for cleanup queries
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strava_sessions_expires_at_idx
  ON strava_sessions (expires_at);
```

- [ ] **Step 2: Commit**

```bash
git add drizzle/0000_init.sql
git commit -m "port: postgres schema for sessions"
```

---

## Task 3: `NeonSessionManager`

**Files:**
- Modify: `src/types.ts` (`Env` interface)
- Modify: `src/session.ts` (replace `KVSessionManager` with `NeonSessionManager`)
- Modify: `src/middleware.ts` (rename references)

- [ ] **Step 1: Update `Env` in `src/types.ts`**

Replace:

```ts
STRAVA_SESSIONS: KVNamespace;
```

with:

```ts
DATABASE_URL: string;
```

- [ ] **Step 2: Rewrite `src/session.ts`**

Replace `KVSessionManager` with a Neon-backed implementation. Keep the rest of the file (cookie helpers, `generateState`) unchanged.

```ts
import { neon } from '@neondatabase/serverless';
import { Env, StravaSession, StravaTokenResponse, SessionManager } from './types';

export class NeonSessionManager implements SessionManager {
  private sql;
  constructor(env: Pick<Env, 'DATABASE_URL' | 'STRAVA_CLIENT_ID' | 'STRAVA_CLIENT_SECRET'>) {
    this.sql = neon(env.DATABASE_URL);
    this.env = env;
  }
  private env: Pick<Env, 'STRAVA_CLIENT_ID' | 'STRAVA_CLIENT_SECRET'>;

  async getSession(athleteId: number): Promise<StravaSession | null> {
    const rows = await this.sql`
      SELECT data FROM strava_sessions WHERE athlete_id = ${athleteId} LIMIT 1
    ` as Array<{ data: StravaSession }>;
    return rows[0]?.data ?? null;
  }

  async setSession(athleteId: number, session: StravaSession): Promise<void> {
    await this.sql`
      INSERT INTO strava_sessions (athlete_id, data, expires_at, updated_at)
      VALUES (${athleteId}, ${JSON.stringify(session)}::jsonb, to_timestamp(${session.expires_at}), now())
      ON CONFLICT (athlete_id) DO UPDATE
      SET data = EXCLUDED.data,
          expires_at = EXCLUDED.expires_at,
          updated_at = now()
    `;
  }

  async deleteSession(athleteId: number): Promise<void> {
    await this.sql`DELETE FROM strava_sessions WHERE athlete_id = ${athleteId}`;
  }

  async refreshToken(session: StravaSession): Promise<StravaSession> {
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.env.STRAVA_CLIENT_ID,
        client_secret: this.env.STRAVA_CLIENT_SECRET,
        refresh_token: session.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${body}`);
    }
    const tokenData = await response.json() as StravaTokenResponse;
    const updated: StravaSession = {
      ...session,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at,
    };
    await this.setSession(session.athlete_id, updated);
    return updated;
  }
}
```

- [ ] **Step 3: Update `src/middleware.ts`**

Replace:

```ts
import { KVSessionManager, getCookieValue } from './session';
// ...
private sessionManager: KVSessionManager;
// ...
this.sessionManager = new KVSessionManager(env);
```

with:

```ts
import { NeonSessionManager, getCookieValue } from './session';
// ...
private sessionManager: NeonSessionManager;
// ...
this.sessionManager = new NeonSessionManager(env);
```

- [ ] **Step 4: Search the rest of the tree for `KVSessionManager` references and migrate them**

Run: `grep -rn 'KVSessionManager\|STRAVA_SESSIONS' src/`
Expected: every remaining hit is in code that constructs the session manager — replace with `NeonSessionManager`. Hits referencing `STRAVA_SESSIONS` as the KV binding need to read from the Neon-backed session manager instead.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors. Fix any straggling references.

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "port: NeonSessionManager replacing KVSessionManager"
```

---

## Task 4: Vercel entry

**Files:**
- Create: `api/index.ts`
- Create: `vercel.json`

- [ ] **Step 1: Create `api/index.ts`**

```ts
import { handle } from '@hono/vercel';
import app from '../src/index';

export const config = {
  runtime: 'nodejs',
};

export default handle(app);
```

- [ ] **Step 2: Create `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
  ]
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add api/ vercel.json
git commit -m "port: vercel entry via @hono/vercel"
```

---

## Task 5: Env wiring

**Files:**
- Modify: `.env.example`
- Modify: `src/index.ts` (only if `c.env` reads are broken on Vercel — verify first)

`@hono/vercel`'s `handle()` populates `c.env` with `process.env` by default, so existing `c.env.STRAVA_CLIENT_ID` reads continue to work. No code changes needed beyond confirming via typecheck and the smoke test.

- [ ] **Step 1: Update `.env.example`**

```
# Neon (replaces Cloudflare KV)
DATABASE_URL=postgres://...

# Strava OAuth app — same as upstream
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=https://strava-mcp.vercel.app/callback

# Optional — upstream features kept intact
STRAVA_WEBHOOK_VERIFY_TOKEN=
POKE_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "port: env example for vercel + neon"
```

---

## Task 6: Local smoke test

- [ ] **Step 1: Provision a dev Neon DB**

Use Neon dashboard or `vercel marketplace install neon`. Capture the connection string into `.env.local`.

- [ ] **Step 2: Apply schema**

Run: `psql "$DATABASE_URL" -f drizzle/0000_init.sql`
Expected: `CREATE TABLE` then `CREATE INDEX`.

- [ ] **Step 3: Set up a dev Strava app**

Register a separate Strava app for development (Authorization Callback Domain: `localhost`). Capture client id + secret into `.env.local`. `STRAVA_REDIRECT_URI=http://localhost:3000/callback`.

- [ ] **Step 4: `vercel dev`**

Run: `npm run dev`
Expected: server starts at `http://localhost:3000`. Landing page renders. Clicking "Connect with Strava" redirects to Strava authorize.

- [ ] **Step 5: Walk the full flow**

Authorize on Strava → returns to `/callback` → dashboard shows a personal MCP URL. Hit the MCP URL with a `mcp-remote` client or curl-style probe to verify tools list and `get_athlete`.

- [ ] **Step 6: Inspect the DB**

```bash
psql "$DATABASE_URL" -c "select athlete_id, expires_at, updated_at from strava_sessions;"
```

Expected: one row for your test athlete.

- [ ] **Step 7: Refresh-on-stale check (optional)**

Manually update `expires_at` in DB to a past timestamp; re-call the MCP. The middleware's 5-minute-skew check should trigger a token refresh, persist new tokens, and proceed.

---

## Task 7: Deploy

- [ ] **Step 1: Provision a production Neon DB**

```bash
vercel marketplace install neon
# Or via the Vercel dashboard.
# Capture the production DATABASE_URL.
```

- [ ] **Step 2: Apply schema to production**

```bash
psql "$PROD_DATABASE_URL" -f drizzle/0000_init.sql
```

- [ ] **Step 3: Push to origin (your fork)**

```bash
git push -u origin main
```

- [ ] **Step 4: Link the repo to Vercel + set env vars**

```bash
vercel link
vercel env add DATABASE_URL production
vercel env add STRAVA_CLIENT_ID production
vercel env add STRAVA_CLIENT_SECRET production
vercel env add STRAVA_REDIRECT_URI production   # https://<your>.vercel.app/callback
vercel env add STRAVA_WEBHOOK_VERIFY_TOKEN production   # if using webhooks
vercel env add POKE_API_KEY production                  # if using poke notifications
```

- [ ] **Step 5: Deploy**

```bash
vercel deploy --prod --yes
```

Expected: deployment succeeds; landing page renders at the Vercel URL.

- [ ] **Step 6: Update Strava app callback**

In `strava.com/settings/api`, set the Authorization Callback Domain to the deployed hostname (e.g. `strava-mcp.vercel.app`).

- [ ] **Step 7: Walk the connect flow**

Visit the deployed site, connect Strava, paste the MCP URL into Claude, call `get_athlete` — expected: your profile is returned.

- [ ] **Step 8: Add memory entry**

Update `~/.claude/projects/-Users-timcox-tim-os/memory/MEMORY.md` and `reference_strava_mcp_existing.md`: project moved from `parked` to `active`; fork is live at `<vercel URL>`; upstream is `gabeperez/strava-mcp`.

- [ ] **Step 9: Final commit (if any deploy adjustments)**

```bash
git add -A && git diff --cached --quiet || git commit -m "chore: deploy adjustments"
git push
```

---

## Risk / things to watch

- **`c.env` shape on Vercel.** `@hono/vercel` populates `c.env` from `process.env` but doesn't transform key names; existing `c.env.STRAVA_CLIENT_ID` works. If a route ever reaches for `c.env.STRAVA_SESSIONS`, that's a leftover from the KV path and should be replaced with a `NeonSessionManager` call.
- **Webhook endpoint URL.** Upstream's webhook docs assume `*.workers.dev`. If you register webhooks, point them at the Vercel URL.
- **Cold-start cost.** Neon serverless is fast (~50ms cold), and Vercel Fluid Compute reuses instances. Should be comparable to CF Workers; if it's not, look at connection pooling.
- **Upstream merges.** When you `git merge upstream/main`, expect conflicts only in: `src/types.ts` (Env), `src/session.ts`, `src/middleware.ts`, `package.json`. Resolve in favor of the Neon path.

---

## Self-review

**Spec coverage:**

| Need | Task |
|---|---|
| Hono on Vercel (not Workers) | 4 |
| Neon Postgres replaces KV | 2, 3 |
| Env types updated | 3 |
| `.env.example` updated | 5 |
| Local smoke test of OAuth → MCP URL → tool call | 6 |
| Production deploy with Strava callback updated | 7 |
| CLAUDE.md flips status to active with deploy command | (in `CLAUDE.md` already, this commit) |

No gaps. The 21 tools and OAuth/auth code intentionally untouched; the entire upstream tool surface ports for free.

**Placeholder scan:** all code blocks contain full code. All commands have expected output. The DB password and Strava client id will be filled in by the engineer at runtime, which is correct.

**Type consistency:** `SessionManager` interface is the contract — both `KVSessionManager` (upstream) and `NeonSessionManager` (us) implement it identically. `Env` change is the only widening that ripples; `STRAVA_SESSIONS` references are explicitly removed in Task 3.

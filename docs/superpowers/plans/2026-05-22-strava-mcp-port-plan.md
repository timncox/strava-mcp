# Strava MCP — Port Plan (CF Workers + KV → Vercel + Upstash Redis)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Port the forked SportMCP source from Cloudflare Workers + KV to Vercel Functions + Upstash Redis, deploy, walk the connect flow end-to-end.

**Strategy:** Wrap Upstash Redis with a small adapter that exposes the same `get/put/delete/list({prefix})` shape as Cloudflare KV. Inject it into `c.env.STRAVA_SESSIONS` on each request. **Call sites stay byte-identical to upstream**, so the diff is small and upstream merges stay clean.

**Why not Neon Postgres:** CF KV is used at ~60 call sites across 5 files for 14+ keyspaces. Porting to SQL would refactor each site. Upstash Redis is the same primitive as CF KV — adapter, not refactor.

---

## Task 1: Dependencies & scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deps**

```bash
npm install hono @hono/vercel @upstash/redis
npm install --save-dev @types/node vercel
```

- [ ] **Step 2: Replace scripts in `package.json`**

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

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "port: vercel + upstash deps and scripts"
```

---

## Task 2: KV adapter

**Files:**
- Create: `src/kv.ts`

- [ ] **Step 1: Write the adapter**

```ts
import type { Context, Next } from 'hono';
import { Redis } from '@upstash/redis';

/**
 * The subset of Cloudflare KVNamespace upstream code actually calls.
 * Native CF KV satisfies this structurally; our Upstash impl does too.
 */
export interface KVPutOptions {
  expirationTtl?: number;
}

export interface KVListKey {
  name: string;
}

export interface KVListResult {
  keys: KVListKey[];
}

export interface KVAdapter {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: KVPutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string }): Promise<KVListResult>;
}

export function makeUpstashKVAdapter(url: string, token: string): KVAdapter {
  const redis = new Redis({ url, token });
  return {
    async get(key) {
      // Upstash's TS client returns the parsed type. We always store strings, so coerce.
      const v = await redis.get<unknown>(key);
      if (v === null || v === undefined) return null;
      return typeof v === 'string' ? v : JSON.stringify(v);
    },
    async put(key, value, options) {
      if (options?.expirationTtl) {
        await redis.set(key, value, { ex: options.expirationTtl });
      } else {
        await redis.set(key, value);
      }
    },
    async delete(key) {
      await redis.del(key);
    },
    async list({ prefix }) {
      const keys: KVListKey[] = [];
      let cursor: string | number = 0;
      const match = `${prefix}*`;
      do {
        const [next, batch] = await redis.scan(cursor, { match, count: 200 });
        for (const k of batch) keys.push({ name: k });
        cursor = next;
      } while (cursor !== '0' && cursor !== 0);
      return { keys };
    },
  };
}

/**
 * Hono middleware: build the KV adapter once per request (cheap — just constructs a
 * Redis client) and attach it to c.env.STRAVA_SESSIONS so all existing call sites work
 * unchanged.
 */
export function kvInjectionMiddleware() {
  let cached: KVAdapter | null = null;
  return async (c: Context, next: Next) => {
    const env = c.env as Record<string, unknown>;
    if (!env.STRAVA_SESSIONS) {
      if (!cached) {
        const url = (env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_REST_URL) as string;
        const token = (env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN) as string;
        if (!url || !token) {
          return c.json({ error: 'Upstash Redis env not configured' }, 500);
        }
        cached = makeUpstashKVAdapter(url, token);
      }
      env.STRAVA_SESSIONS = cached;
    }
    await next();
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/kv.ts
git commit -m "port: upstash kv adapter matching CF KV surface"
```

---

## Task 3: Env type + register the middleware

**Files:**
- Modify: `src/types.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update `Env` in `src/types.ts`**

Replace:

```ts
STRAVA_SESSIONS: KVNamespace;
```

with (also keeping the new Upstash vars):

```ts
import type { KVAdapter } from './kv';

// ...inside Env interface
STRAVA_SESSIONS: KVAdapter;
UPSTASH_REDIS_REST_URL: string;
UPSTASH_REDIS_REST_TOKEN: string;
```

Remove the `KVNamespace` global reference (was provided by `@cloudflare/workers-types` — no longer needed).

- [ ] **Step 2: Register the middleware in `src/index.ts`**

Add the import and middleware registration near the top of the file, BEFORE the existing CORS middleware and BEFORE any route registration:

```ts
import { kvInjectionMiddleware } from './kv';

// ...after `const app = new Hono<{ Bindings: Env }>();`
app.use('*', kvInjectionMiddleware());
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors. The `KVNamespace` type removal might cause a missing-type error in `@cloudflare/workers-types`; if so, remove that dep:

```bash
npm uninstall @cloudflare/workers-types
```

…and confirm the only remaining reference to `KVNamespace` was the one we just removed.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/index.ts
git commit -m "port: typed KVAdapter env + kv-injection middleware"
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

## Task 5: Env example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace contents**

```
# Upstash Redis — REST API endpoint. Vercel Marketplace's "Upstash for Redis"
# integration sets these automatically on install. Locally, copy from the
# Upstash console.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Strava OAuth app (same as upstream)
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
git commit -m "port: env example for vercel + upstash"
```

---

## Task 6: Local smoke test

- [ ] **Step 1: Provision a dev Upstash instance**

Either via [Upstash console](https://console.upstash.com/redis) directly (free tier covers 10K commands/day), or `vercel marketplace install upstash` once the project is linked. Capture `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` into `.env.local`.

- [ ] **Step 2: Set up a dev Strava app**

Register a separate Strava app (Authorization Callback Domain: `localhost`). Capture client id + secret into `.env.local`. Set `STRAVA_REDIRECT_URI=http://localhost:3000/callback`.

- [ ] **Step 3: `vercel dev`**

Run: `npm run dev`
Expected: server starts at `http://localhost:3000`. Landing page renders. Clicking "Connect with Strava" redirects to Strava authorize.

- [ ] **Step 4: Walk the full flow**

Authorize on Strava → returns to `/callback` → dashboard shows a personal MCP URL. Hit the MCP URL with `npx mcp-remote@latest <url>` or a curl probe to verify tools list and `get_athlete`.

- [ ] **Step 5: Verify Upstash contents**

```bash
# Using the Upstash CLI or REST: scan and list a few keys
curl -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  "$UPSTASH_REDIS_REST_URL/scan/0/match/user:*/count/10"
```

Expected: a `user:<athleteId>` key with the JSON session.

- [ ] **Step 6: Refresh-on-stale check (optional)**

Temporarily set the `expires_at` field in the session JSON to a past timestamp; re-call the MCP. The middleware's 5-minute-skew check should refresh, persist, and proceed.

---

## Task 7: Deploy

- [ ] **Step 1: Push to your fork**

```bash
git push -u origin main
```

- [ ] **Step 2: Link the repo to Vercel**

```bash
vercel link
```

- [ ] **Step 3: Install Upstash via Vercel Marketplace (provisions env vars automatically)**

```bash
vercel marketplace install upstash
# Or via Vercel dashboard → Storage → Add → Upstash for Redis.
# This sets UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN automatically in
# production / preview / development scopes.
```

- [ ] **Step 4: Set remaining env vars**

```bash
vercel env add STRAVA_CLIENT_ID production
vercel env add STRAVA_CLIENT_SECRET production
vercel env add STRAVA_REDIRECT_URI production   # https://strava-mcp.vercel.app/callback
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

Visit the deployed site, connect Strava, paste the MCP URL into Claude, call `get_athlete`. Expected: your profile returns.

- [ ] **Step 8: Update memory**

Update `~/.claude/projects/-Users-timcox-tim-os/memory/MEMORY.md` and `reference_strava_mcp_existing.md`: project moved from `parked` to `active`; fork is live at `<vercel URL>`; upstream is `gabeperez/strava-mcp`; substrate is Vercel + Upstash.

- [ ] **Step 9: Final commit (if any deploy adjustments)**

```bash
git add -A && git diff --cached --quiet || git commit -m "chore: deploy adjustments"
git push
```

---

## Risk / things to watch

- **Upstash free-tier limit (10K commands/day).** Heavy use (or a viral moment) could blow it. Upstash bills per-command above that. Cheaper than CF KV at low volume, comparable above.
- **Webhook endpoint URL.** When you register Strava webhooks, point them at the Vercel URL, not stravamcp.com or workers.dev.
- **Cold-start cost.** Upstash REST adds ~30ms per call vs. native CF KV bindings. Per-request middleware caches the client, so it's amortized. Fluid Compute reuses instances; this should be negligible in practice.
- **Upstream merges.** Conflicts expected only in: `src/types.ts` (Env), `src/index.ts` (middleware registration line), `package.json`. Resolve in favor of the Vercel/Upstash path.

---

## Self-review

**Spec coverage:**

| Need | Task |
|---|---|
| Vercel runtime (not CF Workers) | 4 |
| Same KV semantics on Upstash | 2 |
| Env types updated; CF binding dropped | 3 |
| KV adapter injected at request time | 2, 3 |
| `.env.example` updated | 5 |
| Local smoke test of OAuth → MCP URL → tool call | 6 |
| Production deploy + Strava callback updated | 7 |
| CLAUDE.md flipped to active w/ deploy command | (in CLAUDE.md, separate commit) |

No gaps. The 21 tools, OAuth, webhook handler, brand assets, and templates are intentionally untouched. Call sites that read/write KV stay byte-identical to upstream.

**Placeholder scan:** all code complete, all commands have expected output. Secrets are filled in by the engineer at runtime, which is correct.

**Type consistency:** `KVAdapter` matches the subset of `KVNamespace` the codebase actually uses (verified by grep). Both CF KV native bindings and the Upstash adapter satisfy it structurally. The injection middleware is the one place that knows about Upstash; everything downstream sees a generic `KVAdapter`.

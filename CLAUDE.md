---
status: active
last_touched: 2026-05-22
deploy: git push origin main
---

# strava-mcp

Fork of [gabeperez/strava-mcp](https://github.com/gabeperez/strava-mcp) (the open-source SportMCP at stravamcp.com), ported from **Cloudflare Workers + KV** to **Vercel + Upstash Redis**.

Forked to `timncox/strava-mcp` 2026-05-22. Upstream is added as `upstream` remote.

## Why fork

- Owned infra (Vercel account, Upstash via Vercel Marketplace) instead of depending on stravamcp.com.
- Matches tim-os hosting (Vercel by default — sheaf, ctca-crm, sfmagic, weft).
- Lets us add tools / integrations later (e.g. MMP hook) without upstream coordination.

## Stack

- **Hono 4.9** — runs on Vercel Functions via `@hono/vercel`.
- **Vercel Functions** (Node runtime) — replaces Cloudflare Workers.
- **Upstash Redis** via `@upstash/redis` (REST-over-HTTP) — replaces Cloudflare KV. Same primitive (key-value with TTL + prefix scan), so the port is a thin adapter rather than a refactor.
- Tools, OAuth flow, Strava API client, webhook handler, HTML templates — unchanged from upstream.

## Port surface

Why Upstash (not Neon) — Cloudflare KV is used in ~60 call sites across 5 files for 14+ keyspaces (sessions, OAuth state/codes/pending flows, device fingerprints, personal MCP tokens, agent connection tracking, notification configs, etc.). Upstash Redis is the same primitive as CF KV; one ~60-line adapter wraps it with the same `get/put/delete/list({prefix})` shape, so call sites stay byte-identical to upstream. Neon would have required refactoring every call site to SQL.

Files added vs. upstream:

- `src/kv.ts` — `KVAdapter` interface (mirrors the subset of `KVNamespace` upstream actually uses) plus `makeUpstashKVAdapter`. Also exports a KV-injection middleware that attaches the adapter to `c.env.STRAVA_SESSIONS` on each request.
- `api/index.ts` — Vercel entry, wraps the Hono app via `@hono/vercel`.
- `vercel.json` — rewrites all paths to the function.

Files modified vs. upstream:

- `src/types.ts` — `Env.STRAVA_SESSIONS` typed as `KVAdapter`; adds `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.
- `src/index.ts` — registers the KV-injection middleware near the top of the app.
- `package.json` — adds `@hono/vercel`, `@upstash/redis`; swaps wrangler scripts for vercel scripts.
- `.env.example` — Upstash + Vercel envs.

Files left in place but unused on Vercel:

- `wrangler.jsonc` — kept for clean upstream merges; not in the build path.
- `.github/workflows/deploy.yml` — replaced by Vercel's git integration.

## Convention with upstream

- Pull upstream changes with `git fetch upstream && git merge upstream/main`. Port-surface files (listed above) are the only expected conflict points; everything else merges cleanly because call sites are unchanged.
- Bug fixes that apply to upstream should be PR'd back to `gabeperez/strava-mcp`.

## Docs

- Spec (history): `docs/superpowers/specs/2026-05-22-strava-mcp-design.md` — the original greenfield design.
- Old plan (superseded): `docs/superpowers/plans/2026-05-22-strava-mcp-implementation.md` — 22-task greenfield plan.
- Port plan (active): `docs/superpowers/plans/2026-05-22-strava-mcp-port-plan.md`.
- Upstream docs: `README.md`, `README_DEPLOY.md`, `WEBHOOK_SETUP.md`, `WARP.md`.

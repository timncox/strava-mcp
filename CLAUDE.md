---
status: active
last_touched: 2026-05-22
deploy: git push origin main
---

# strava-mcp

Fork of [gabeperez/strava-mcp](https://github.com/gabeperez/strava-mcp) (the open-source SportMCP at stravamcp.com), ported from **Cloudflare Workers + KV** to **Vercel + Neon Postgres**.

Forked to `timncox/strava-mcp` 2026-05-22. Upstream is added as `upstream` remote.

## Why fork

- Owned infra (Vercel account, Neon DB) instead of depending on stravamcp.com.
- Matches the rest of tim-os hosting (sheaf, ctca-crm, sfmagic, weft are all Vercel + Neon).
- Lets us add tools or integrations later (e.g. MMP hook) without upstream coordination.

## Stack

- **Hono 4.9** — runs on Vercel Functions natively via `@hono/vercel`.
- **Vercel Functions** (Node runtime) — drop-in replacement for Cloudflare Workers.
- **Neon Postgres** via `@neondatabase/serverless` — replaces Cloudflare KV for session storage.
- Tools, OAuth flow, Strava API client, webhook handler, HTML templates — unchanged from upstream.

## Port surface

Files modified vs. upstream:

- `src/types.ts` — `Env` no longer carries `STRAVA_SESSIONS: KVNamespace`; gains `DATABASE_URL: string`.
- `src/session.ts` — adds `NeonSessionManager implements SessionManager`. `KVSessionManager` removed; the interface stays as the indirection point.
- `src/middleware.ts` — instantiates `NeonSessionManager` instead of `KVSessionManager`.
- `package.json` — adds `@hono/vercel` and `@neondatabase/serverless`; replaces wrangler scripts with Vercel scripts.

Files added:

- `api/index.ts` — Vercel entry, re-exports the Hono app via the Vercel adapter.
- `drizzle/0000_init.sql` — Postgres schema for `strava_sessions`.
- `vercel.json` — minimal config (just the rewrite for `/*` → `/api/index.ts`).

Files removed (or marked unused):

- `wrangler.jsonc` — kept in tree for clean upstream merges; not in the build path.
- `.github/workflows/deploy.yml` — replaced by Vercel's git integration (no GHA needed for deploy).

## Convention with upstream

- Pull upstream changes with `git fetch upstream && git merge upstream/main`. Port-surface files (listed above) are the conflict points; everything else should merge cleanly.
- Bug fixes that apply to upstream should be PR'd back to `gabeperez/strava-mcp`.

## Docs

- Spec (history): `docs/superpowers/specs/2026-05-22-strava-mcp-design.md` — the original greenfield design before we found SportMCP.
- Old plan (superseded): `docs/superpowers/plans/2026-05-22-strava-mcp-implementation.md` — 22-task greenfield plan. Not active.
- Port plan (active): `docs/superpowers/plans/2026-05-22-strava-mcp-port-plan.md` — bite-sized port steps.
- Upstream docs: `README.md`, `README_DEPLOY.md`, `WEBHOOK_SETUP.md`, `WARP.md`.

# Strava MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hosted multi-tenant MCP server (`strava-mcp.vercel.app`) that lets any Strava user connect their account via Strava OAuth, receive a path-token MCP URL, and use 16 tools to read/modify their Strava data from an LLM.

**Architecture:** Next.js 15 App Router on Vercel with a single MCP route (`/api/mcp/[token]`). Onboarding via Strava OAuth (no claude.ai broker). Path-token credentials stored as bcrypt hashes with a prefix index. Strava tokens stored encrypted-at-rest with AES-256-GCM and auto-refreshed on staleness. Neon Postgres via Drizzle ORM. Mirrors the proven `ctca-crm` pattern.

**Tech Stack:** Next.js 15, React 19, TypeScript 5, `@modelcontextprotocol/sdk` v1, `@neondatabase/serverless`, `drizzle-orm`, `bcryptjs`, `zod`, `vitest`, `msw`.

---

## File Structure

```
~/tim-os/strava-mcp/
├── CLAUDE.md                          # status: active frontmatter
├── README.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── drizzle.config.ts
├── vitest.config.ts
├── .env.example
├── .env.local                         # gitignored
├── .gitignore
├── app/
│   ├── layout.tsx
│   ├── page.tsx                       # marketing + Connect Strava CTA
│   ├── connect/
│   │   └── route.ts                   # GET → 302 redirect to Strava authorize
│   ├── connected/
│   │   └── [athleteId]/
│   │       ├── page.tsx               # shows MCP URL once
│   │       └── copy-button.tsx        # client component
│   └── api/
│       ├── strava/
│       │   ├── callback/route.ts      # OAuth code exchange + mint token
│       │   └── disconnect/route.ts    # POST → deauthorize + delete row
│       └── mcp/
│           └── [token]/route.ts       # POST/GET/OPTIONS handler
├── lib/
│   ├── env.ts                         # validated env via zod
│   ├── crypto.ts                      # AES-256-GCM encrypt/decrypt
│   ├── path-token.ts                  # mint, verify (prefix+bcrypt)
│   ├── session.ts                     # signed httpOnly session cookie
│   ├── db/
│   │   ├── schema.ts                  # athletes, mcp_tokens, usage_log
│   │   └── index.ts                   # getDb()
│   ├── strava/
│   │   ├── oauth.ts                   # exchangeCode, refreshTokens
│   │   ├── client.ts                  # authed fetch + rate-limit tracking
│   │   ├── types.ts                   # Strava response types (subset)
│   │   └── athlete-repo.ts            # upsert, getByTokenAuth, refreshIfStale
│   └── mcp/
│       ├── server.ts                  # buildMcpServerForAthlete
│       └── tools/
│           ├── get-athlete.ts
│           ├── get-athlete-stats.ts
│           ├── get-athlete-zones.ts
│           ├── list-activities.ts
│           ├── get-activity.ts
│           ├── get-activity-streams.ts
│           ├── get-activity-laps.ts
│           ├── list-gear.ts
│           ├── get-gear.ts
│           ├── list-clubs.ts
│           ├── list-starred-segments.ts
│           ├── get-segment.ts
│           ├── update-activity.ts
│           ├── create-activity.ts
│           ├── upload-activity.ts
│           ├── star-segment.ts
│           └── get-rate-limit-status.ts
├── drizzle/                           # generated migrations
├── tests/
│   ├── setup.ts                       # MSW server start/stop
│   ├── fixtures/
│   │   └── strava.ts                  # MSW handlers + sample payloads
│   ├── lib/
│   │   ├── crypto.test.ts
│   │   ├── path-token.test.ts
│   │   ├── strava-oauth.test.ts
│   │   ├── strava-client.test.ts
│   │   └── athlete-repo.test.ts
│   ├── mcp/
│   │   ├── route.test.ts              # POST routing, auth, refresh-on-stale
│   │   └── tools/
│   │       ├── list-activities.test.ts
│   │       ├── update-activity.test.ts
│   │       └── upload-activity.test.ts
│   └── e2e/
│       └── smoke.test.ts              # gated on STRAVA_TEST_ATHLETE_TOKEN
└── docs/
    └── superpowers/
        ├── specs/2026-05-22-strava-mcp-design.md
        └── plans/2026-05-22-strava-mcp-implementation.md
```

---

## Conventions used by every task

- **Working directory** for all commands: `~/tim-os/strava-mcp/`.
- **Commit message format:** `<type>: <short description>` where type ∈ {feat, test, chore, fix, docs}.
- **Path token format:** `stmk_<prefix8>_<secret64>` (8 hex chars of prefix + 64 hex chars of secret). The prefix is indexed; bcrypt hashes the whole token.
- **`maxDuration = 60`** on the MCP route to allow slow upload polling.
- **`runtime = "nodejs"`** everywhere — we need `crypto`, `bcryptjs`, and Drizzle's Node adapter.

---

## Task 1: Bootstrap project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `app/layout.tsx`
- Create: `app/page.tsx` (placeholder)
- Create: `CLAUDE.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "strava-mcp",
  "version": "0.1.0",
  "private": true,
  "description": "Hosted MCP server letting any Strava user connect their account to an LLM.",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push"
  },
  "engines": { "node": ">=20.6" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@neondatabase/serverless": "^0.10.0",
    "bcryptjs": "^2.4.3",
    "dotenv": "^17.4.2",
    "drizzle-orm": "^0.36.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "drizzle-kit": "^0.28.0",
    "msw": "^2.6.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.ts`**

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
};

export default config;
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules
.next
.env.local
.env*.local
*.tsbuildinfo
.vercel
coverage
```

- [ ] **Step 5: Create `.env.example`**

```
# Postgres (Neon)
DATABASE_URL=postgres://...

# Strava OAuth app
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=

# Crypto
TOKEN_ENCRYPTION_KEY=                 # 64 hex chars (32 bytes)
SESSION_COOKIE_SECRET=                # 64 hex chars (32 bytes)

# Public origin used in redirect_uri and shown URLs
PUBLIC_ORIGIN=https://strava-mcp.vercel.app

# Optional: gates the e2e smoke test
STRAVA_TEST_ATHLETE_TOKEN=
```

- [ ] **Step 6: Create `app/layout.tsx`**

```tsx
import type { ReactNode } from "react";

export const metadata = {
  title: "Strava MCP",
  description: "Connect your Strava account to an LLM.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Create placeholder `app/page.tsx`**

```tsx
export default function Home() {
  return <main><h1>Strava MCP</h1></main>;
}
```

- [ ] **Step 8: Create `CLAUDE.md`**

```markdown
---
status: active
last_touched: 2026-05-22
deploy: git push origin main
---

# strava-mcp

Hosted MCP server (`strava-mcp.vercel.app`) that lets any Strava user connect
their account via Strava OAuth and exposes 16 tools for reading and modifying
their data from an LLM.

- Spec: `docs/superpowers/specs/2026-05-22-strava-mcp-design.md`
- Plan: `docs/superpowers/plans/2026-05-22-strava-mcp-implementation.md`
- Pattern mirrors `~/tim-os/ctca-crm` (path-token MCP, Drizzle + Neon, Next 15).

## Conventions

- Token format `stmk_<prefix8>_<secret64>`; bcrypt-hashed.
- Strava tokens encrypted at rest (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`).
- Tests use MSW; one optional live smoke test gated on `STRAVA_TEST_ATHLETE_TOKEN`.
```

- [ ] **Step 9: Install dependencies**

Run: `npm install`
Expected: completes without errors, `node_modules/` and `package-lock.json` appear.

- [ ] **Step 10: Verify Next.js + TypeScript compile cleanly**

Run: `npm run typecheck`
Expected: exits 0 with no output.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: bootstrap strava-mcp project"
```

---

## Task 2: Database schema, Neon client, env validation

**Files:**
- Create: `lib/env.ts`
- Create: `lib/db/schema.ts`
- Create: `lib/db/index.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create `lib/env.ts`**

```ts
import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().url(),
  STRAVA_CLIENT_ID: z.string().min(1),
  STRAVA_CLIENT_SECRET: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 hex chars"),
  SESSION_COOKIE_SECRET: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 hex chars"),
  PUBLIC_ORIGIN: z.string().url(),
});

let _env: z.infer<typeof Env> | null = null;

export function env() {
  if (_env) return _env;
  _env = Env.parse(process.env);
  return _env;
}
```

- [ ] **Step 2: Create `lib/db/schema.ts`**

```ts
import {
  pgTable,
  bigint,
  serial,
  bigserial,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * One row per connected Strava athlete. Tokens are encrypted at rest
 * (`encryptToken`/`decryptToken` in lib/crypto.ts). Refresh tokens rotate on
 * every refresh — both columns must be updated together.
 */
export const athletes = pgTable("athletes", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  username: text("username"),
  firstname: text("firstname"),
  lastname: text("lastname"),
  profileUrl: text("profile_url"),
  scope: text("scope").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

/**
 * Path tokens. Format `stmk_<prefix8>_<secret64>`. The full token sits in the
 * connector URL: https://strava-mcp.vercel.app/api/mcp/<token>. Lookup is by
 * `tokenPrefix` (indexed), then bcrypt-compared against `tokenHash`.
 */
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: serial("id").primaryKey(),
    athleteId: bigint("athlete_id", { mode: "number" })
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    label: text("label"),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prefixIdx: index("mcp_tokens_prefix_idx").on(t.tokenPrefix),
    athleteIdx: index("mcp_tokens_athlete_idx").on(t.athleteId),
  }),
);

/** Lightweight per-call audit log. */
export const usageLog = pgTable(
  "usage_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    athleteId: bigint("athlete_id", { mode: "number" })
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    ok: boolean("ok").notNull(),
    errorCode: text("error_code"),
    durationMs: integer("duration_ms"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    athleteTsIdx: index("usage_log_athlete_ts_idx").on(t.athleteId, t.ts),
  }),
);

export type Athlete = typeof athletes.$inferSelect;
export type NewAthlete = typeof athletes.$inferInsert;
export type McpToken = typeof mcpTokens.$inferSelect;
```

- [ ] **Step 3: Create `lib/db/index.ts`**

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _db = drizzle(neon(url), { schema });
  return _db;
}

export { schema };
export * from "./schema";
```

- [ ] **Step 4: Create `drizzle.config.ts`**

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

- [ ] **Step 5: Generate the initial migration**

Run: `npm run db:generate`
Expected: a new file appears under `drizzle/` (e.g. `drizzle/0000_<adjective>_<noun>.sql`) containing `CREATE TABLE athletes`, `CREATE TABLE mcp_tokens`, `CREATE TABLE usage_log`.

- [ ] **Step 6: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add lib/env.ts lib/db drizzle.config.ts drizzle/
git commit -m "feat: db schema + neon client + env validation"
```

---

## Task 3: Vitest scaffold + MSW setup

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/fixtures/strava.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname) },
  },
});
```

- [ ] **Step 2: Create `tests/setup.ts`**

```ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./fixtures/strava";

// MSW lifecycle. Each test can call `server.use(...)` to add per-test handlers.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Test-only env defaults so modules importing env() don't blow up.
process.env.DATABASE_URL ??= "postgres://test/test";
process.env.STRAVA_CLIENT_ID ??= "test-client-id";
process.env.STRAVA_CLIENT_SECRET ??= "test-client-secret";
process.env.TOKEN_ENCRYPTION_KEY ??= "00".repeat(32);
process.env.SESSION_COOKIE_SECRET ??= "11".repeat(32);
process.env.PUBLIC_ORIGIN ??= "https://strava-mcp.test";
```

- [ ] **Step 3: Create `tests/fixtures/strava.ts`**

```ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Default handlers — individual tests override via server.use(...).
export const server = setupServer(
  http.post("https://www.strava.com/api/v3/oauth/token", () =>
    HttpResponse.json({ error: "no handler registered for this test" }, { status: 500 }),
  ),
);

export { http, HttpResponse };

// Sample payloads — keep tiny and focused; tests assert on these.
export const sampleAthlete = {
  id: 12345,
  username: "tcox",
  firstname: "Tim",
  lastname: "Cox",
  profile: "https://example.com/p.jpg",
};

export const sampleActivity = {
  id: 9999,
  name: "Morning Run",
  distance: 5234.5,
  moving_time: 1800,
  elapsed_time: 1850,
  type: "Run",
  sport_type: "Run",
  start_date: "2026-05-20T11:30:00Z",
  start_date_local: "2026-05-20T07:30:00",
};
```

- [ ] **Step 4: Run the test suite (it should report 0 tests)**

Run: `npm test`
Expected: exits 0 with "No test files found" or similar — vitest is wired up but nothing to run.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/setup.ts tests/fixtures/strava.ts
git commit -m "test: vitest + msw scaffold"
```

---

## Task 4: Crypto module (AES-256-GCM)

**Files:**
- Create: `lib/crypto.ts`
- Create: `tests/lib/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/crypto.test.ts
import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "@/lib/crypto";

describe("crypto", () => {
  it("round-trips a token", () => {
    const ct = encryptToken("hello-world");
    expect(ct).not.toContain("hello-world");
    expect(decryptToken(ct)).toBe("hello-world");
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const a = encryptToken("same");
    const b = encryptToken("same");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("same");
    expect(decryptToken(b)).toBe("same");
  });

  it("rejects tampered ciphertext", () => {
    const ct = encryptToken("payload");
    const [iv, , tag] = ct.split(":");
    const tampered = `${iv}:${Buffer.from("evil").toString("base64")}:${tag}`;
    expect(() => decryptToken(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- crypto`
Expected: FAIL with "Cannot find module '@/lib/crypto'".

- [ ] **Step 3: Write `lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  if (hex.length !== 64) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  return Buffer.from(hex, "hex");
}

/** Encrypt with AES-256-GCM. Returns "iv:ciphertext:authTag" base64-encoded. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${ct.toString("base64")}:${authTag.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  const key = getKey();
  const [ivB64, ctB64, tagB64] = stored.split(":");
  if (!ivB64 || !ctB64 || !tagB64) throw new Error("invalid encrypted token format");
  const iv = Buffer.from(ivB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- crypto`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crypto.ts tests/lib/crypto.test.ts
git commit -m "feat: aes-256-gcm token encryption"
```

---

## Task 5: Path-token module

**Files:**
- Create: `lib/path-token.ts`
- Create: `tests/lib/path-token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/path-token.test.ts
import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import {
  mintPathToken,
  parsePathToken,
  verifyTokenAgainstHash,
  PATH_TOKEN_PREFIX,
} from "@/lib/path-token";

describe("path-token", () => {
  it("mintPathToken returns a well-formed token + matching prefix/hash", async () => {
    const minted = await mintPathToken();
    expect(minted.token.startsWith(`${PATH_TOKEN_PREFIX}_`)).toBe(true);
    const parsed = parsePathToken(minted.token);
    expect(parsed?.prefix).toBe(minted.prefix);
    expect(bcrypt.compareSync(minted.token, minted.hash)).toBe(true);
  });

  it("parsePathToken returns null for malformed tokens", () => {
    expect(parsePathToken("")).toBeNull();
    expect(parsePathToken("nope")).toBeNull();
    expect(parsePathToken("wrong_prefix_secret")).toBeNull();
    expect(parsePathToken(`${PATH_TOKEN_PREFIX}_short_secret`)).toBeNull();
  });

  it("verifyTokenAgainstHash returns true only for the right token", async () => {
    const minted = await mintPathToken();
    expect(await verifyTokenAgainstHash(minted.token, minted.hash)).toBe(true);
    expect(await verifyTokenAgainstHash(minted.token + "x", minted.hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- path-token`
Expected: FAIL with "Cannot find module '@/lib/path-token'".

- [ ] **Step 3: Write `lib/path-token.ts`**

```ts
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export const PATH_TOKEN_PREFIX = "stmk";
const PREFIX_HEX_LEN = 8;
const SECRET_HEX_LEN = 64;

export interface MintedToken {
  token: string;       // full plaintext, e.g. stmk_<prefix>_<secret>
  prefix: string;      // 8 hex chars, indexed in DB
  hash: string;        // bcrypt hash of the full token
}

export async function mintPathToken(): Promise<MintedToken> {
  const prefix = randomBytes(PREFIX_HEX_LEN / 2).toString("hex");
  const secret = randomBytes(SECRET_HEX_LEN / 2).toString("hex");
  const token = `${PATH_TOKEN_PREFIX}_${prefix}_${secret}`;
  const hash = await bcrypt.hash(token, 10);
  return { token, prefix, hash };
}

export function parsePathToken(token: string | undefined | null): { prefix: string } | null {
  if (!token) return null;
  const parts = token.split("_");
  if (parts.length !== 3) return null;
  if (parts[0] !== PATH_TOKEN_PREFIX) return null;
  if (parts[1].length !== PREFIX_HEX_LEN) return null;
  if (parts[2].length !== SECRET_HEX_LEN) return null;
  return { prefix: parts[1] };
}

export async function verifyTokenAgainstHash(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- path-token`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/path-token.ts tests/lib/path-token.test.ts
git commit -m "feat: path-token mint + parse + verify"
```

---

## Task 6: Strava OAuth code exchange & token refresh

**Files:**
- Create: `lib/strava/oauth.ts`
- Create: `lib/strava/types.ts`
- Create: `tests/lib/strava-oauth.test.ts`

- [ ] **Step 1: Create `lib/strava/types.ts`**

```ts
export interface StravaAthlete {
  id: number;
  username: string | null;
  firstname: string | null;
  lastname: string | null;
  profile: string | null;
}

export interface StravaTokenResponse {
  token_type: "Bearer";
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete?: StravaAthlete;
}

export interface StravaErrorBody {
  message: string;
  errors?: Array<{ resource: string; field: string; code: string }>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/lib/strava-oauth.test.ts
import { describe, it, expect } from "vitest";
import { http, HttpResponse, server } from "@/tests/fixtures/strava";
import { exchangeCode, refreshTokens } from "@/lib/strava/oauth";

describe("strava oauth", () => {
  it("exchangeCode posts to /oauth/token and returns tokens + athlete", async () => {
    server.use(
      http.post("https://www.strava.com/api/v3/oauth/token", async ({ request }) => {
        const body = await request.json() as Record<string, string>;
        expect(body.client_id).toBe("test-client-id");
        expect(body.client_secret).toBe("test-client-secret");
        expect(body.code).toBe("abc");
        expect(body.grant_type).toBe("authorization_code");
        return HttpResponse.json({
          token_type: "Bearer",
          expires_at: 9999999999,
          expires_in: 21600,
          access_token: "at",
          refresh_token: "rt",
          athlete: { id: 42, username: "u", firstname: "f", lastname: "l", profile: "p" },
        });
      }),
    );

    const result = await exchangeCode("abc");
    expect(result.access_token).toBe("at");
    expect(result.refresh_token).toBe("rt");
    expect(result.athlete?.id).toBe(42);
  });

  it("refreshTokens posts grant_type=refresh_token", async () => {
    server.use(
      http.post("https://www.strava.com/api/v3/oauth/token", async ({ request }) => {
        const body = await request.json() as Record<string, string>;
        expect(body.grant_type).toBe("refresh_token");
        expect(body.refresh_token).toBe("old-rt");
        return HttpResponse.json({
          token_type: "Bearer",
          expires_at: 9999999999,
          expires_in: 21600,
          access_token: "new-at",
          refresh_token: "new-rt",
        });
      }),
    );

    const result = await refreshTokens("old-rt");
    expect(result.access_token).toBe("new-at");
    expect(result.refresh_token).toBe("new-rt");
  });

  it("throws on non-200 response", async () => {
    server.use(
      http.post("https://www.strava.com/api/v3/oauth/token", () =>
        HttpResponse.json({ message: "Bad Request" }, { status: 400 }),
      ),
    );
    await expect(exchangeCode("bad")).rejects.toThrow(/Bad Request|400/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- strava-oauth`
Expected: FAIL with "Cannot find module '@/lib/strava/oauth'".

- [ ] **Step 4: Write `lib/strava/oauth.ts`**

```ts
import type { StravaTokenResponse } from "./types";
export type { StravaTokenResponse } from "./types";

const TOKEN_URL = "https://www.strava.com/api/v3/oauth/token";

function clientId() {
  const id = process.env.STRAVA_CLIENT_ID;
  if (!id) throw new Error("STRAVA_CLIENT_ID not set");
  return id;
}

function clientSecret() {
  const s = process.env.STRAVA_CLIENT_SECRET;
  if (!s) throw new Error("STRAVA_CLIENT_SECRET not set");
  return s;
}

async function postOAuth(body: Record<string, string>): Promise<StravaTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const j = await res.json() as { message?: string };
      if (j.message) detail = `${j.message} (${res.status})`;
    } catch { /* ignore parse errors */ }
    throw new Error(`Strava OAuth error: ${detail}`);
  }
  return res.json() as Promise<StravaTokenResponse>;
}

export function exchangeCode(code: string): Promise<StravaTokenResponse> {
  return postOAuth({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    grant_type: "authorization_code",
  });
}

export function refreshTokens(refreshToken: string): Promise<StravaTokenResponse> {
  return postOAuth({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- strava-oauth`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/strava/oauth.ts lib/strava/types.ts tests/lib/strava-oauth.test.ts
git commit -m "feat: strava oauth code exchange + refresh"
```

---

## Task 7: Athlete repository

**Files:**
- Create: `lib/strava/athlete-repo.ts`
- Create: `tests/lib/athlete-repo.test.ts`

The repo wraps DB writes/reads for athletes and is the place where token refresh is triggered on staleness. We mock `getDb()` and `refreshTokens()` in tests so DB-less unit tests still cover the refresh path.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/athlete-repo.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbCalls: Array<{ op: string; data: unknown }> = [];
const fakeRow = {
  id: 42,
  username: "u",
  firstname: "f",
  lastname: "l",
  profileUrl: "p",
  scope: "read,activity:read_all",
  accessTokenEnc: "",
  refreshTokenEnc: "",
  expiresAt: new Date("2026-05-22T12:00:00Z"),
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSeenAt: null,
};

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [fakeRow],
        }),
      }),
    }),
    update: () => ({
      set: (data: unknown) => ({
        where: async () => { dbCalls.push({ op: "update", data }); },
      }),
    }),
    insert: () => ({
      values: (data: unknown) => ({
        onConflictDoUpdate: async () => { dbCalls.push({ op: "upsert", data }); },
      }),
    }),
    delete: () => ({ where: async () => { dbCalls.push({ op: "delete", data: null }); } }),
  }),
  athletes: { id: "id" } as never,
  schema: {},
}));

vi.mock("@/lib/strava/oauth", () => ({
  refreshTokens: vi.fn(async () => ({
    token_type: "Bearer",
    expires_at: Math.floor(Date.now() / 1000) + 21600,
    expires_in: 21600,
    access_token: "new-at",
    refresh_token: "new-rt",
  })),
}));

import { encryptToken } from "@/lib/crypto";
import { getAthleteWithValidToken } from "@/lib/strava/athlete-repo";
import { refreshTokens } from "@/lib/strava/oauth";

beforeEach(() => {
  dbCalls.length = 0;
  vi.clearAllMocks();
  fakeRow.accessTokenEnc = encryptToken("at-current");
  fakeRow.refreshTokenEnc = encryptToken("rt-current");
});

describe("athlete-repo.getAthleteWithValidToken", () => {
  it("returns the existing token when not stale", async () => {
    fakeRow.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const result = await getAthleteWithValidToken(42);
    expect(result.accessToken).toBe("at-current");
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("refreshes when token expires within 5 minutes", async () => {
    fakeRow.expiresAt = new Date(Date.now() + 2 * 60 * 1000);
    const result = await getAthleteWithValidToken(42);
    expect(refreshTokens).toHaveBeenCalledWith("rt-current");
    expect(result.accessToken).toBe("new-at");
    expect(dbCalls.some((c) => c.op === "update")).toBe(true);
  });

  it("refreshes when token is already expired", async () => {
    fakeRow.expiresAt = new Date(Date.now() - 1000);
    const result = await getAthleteWithValidToken(42);
    expect(refreshTokens).toHaveBeenCalled();
    expect(result.accessToken).toBe("new-at");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- athlete-repo`
Expected: FAIL with "Cannot find module '@/lib/strava/athlete-repo'".

- [ ] **Step 3: Write `lib/strava/athlete-repo.ts`**

```ts
import { eq } from "drizzle-orm";
import { getDb, athletes, type Athlete, type NewAthlete } from "@/lib/db";
import { encryptToken, decryptToken } from "@/lib/crypto";
import { refreshTokens, type StravaTokenResponse } from "@/lib/strava/oauth";

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface AthleteWithToken {
  athleteId: number;
  accessToken: string;
  scope: string;
}

export async function upsertAthleteFromTokenResponse(t: StravaTokenResponse, scope: string): Promise<void> {
  if (!t.athlete) throw new Error("upsert called without athlete payload");
  const a = t.athlete;
  const row: NewAthlete = {
    id: a.id,
    username: a.username,
    firstname: a.firstname,
    lastname: a.lastname,
    profileUrl: a.profile,
    scope,
    accessTokenEnc: encryptToken(t.access_token),
    refreshTokenEnc: encryptToken(t.refresh_token),
    expiresAt: new Date(t.expires_at * 1000),
    updatedAt: new Date(),
  };
  await getDb()
    .insert(athletes)
    .values(row)
    .onConflictDoUpdate({
      target: athletes.id,
      set: {
        username: row.username,
        firstname: row.firstname,
        lastname: row.lastname,
        profileUrl: row.profileUrl,
        scope: row.scope,
        accessTokenEnc: row.accessTokenEnc,
        refreshTokenEnc: row.refreshTokenEnc,
        expiresAt: row.expiresAt,
        updatedAt: new Date(),
      },
    });
}

async function loadAthlete(id: number): Promise<Athlete | null> {
  const rows = await getDb().select().from(athletes).where(eq(athletes.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getAthleteWithValidToken(athleteId: number): Promise<AthleteWithToken> {
  const row = await loadAthlete(athleteId);
  if (!row) throw new Error(`athlete ${athleteId} not found`);

  const expiresMs = row.expiresAt.getTime();
  if (expiresMs - Date.now() > REFRESH_SKEW_MS) {
    return {
      athleteId: row.id,
      accessToken: decryptToken(row.accessTokenEnc),
      scope: row.scope,
    };
  }

  const refreshed = await refreshTokens(decryptToken(row.refreshTokenEnc));
  await getDb()
    .update(athletes)
    .set({
      accessTokenEnc: encryptToken(refreshed.access_token),
      refreshTokenEnc: encryptToken(refreshed.refresh_token),
      expiresAt: new Date(refreshed.expires_at * 1000),
      updatedAt: new Date(),
    })
    .where(eq(athletes.id, athleteId));

  return {
    athleteId: row.id,
    accessToken: refreshed.access_token,
    scope: row.scope,
  };
}

export async function deleteAthlete(athleteId: number): Promise<void> {
  await getDb().delete(athletes).where(eq(athletes.id, athleteId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- athlete-repo`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/strava/athlete-repo.ts tests/lib/athlete-repo.test.ts
git commit -m "feat: athlete repo with auto-refresh on staleness"
```

---

## Task 8: Strava authed fetch client with rate-limit tracking

**Files:**
- Create: `lib/strava/client.ts`
- Create: `tests/lib/strava-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/strava-client.test.ts
import { describe, it, expect } from "vitest";
import { http, HttpResponse, server } from "@/tests/fixtures/strava";
import { stravaGet, stravaPost } from "@/lib/strava/client";

describe("strava client", () => {
  it("includes Bearer token and parses rate-limit headers", async () => {
    server.use(
      http.get("https://www.strava.com/api/v3/athlete", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer abc");
        return HttpResponse.json(
          { id: 1, username: "u" },
          {
            headers: {
              "x-ratelimit-limit": "200,2000",
              "x-ratelimit-usage": "13,42",
              "x-readratelimit-limit": "100,1000",
              "x-readratelimit-usage": "7,21",
            },
          },
        );
      }),
    );

    const { data, rateLimit } = await stravaGet<{ id: number }>("/athlete", "abc");
    expect(data.id).toBe(1);
    expect(rateLimit.shortLimit).toBe(200);
    expect(rateLimit.shortUsage).toBe(13);
    expect(rateLimit.dailyLimit).toBe(2000);
    expect(rateLimit.dailyUsage).toBe(42);
  });

  it("encodes querystring params", async () => {
    let calledUrl = "";
    server.use(
      http.get("https://www.strava.com/api/v3/athlete/activities", ({ request }) => {
        calledUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await stravaGet("/athlete/activities", "abc", { per_page: 30, page: 2 });
    expect(calledUrl).toContain("per_page=30");
    expect(calledUrl).toContain("page=2");
  });

  it("throws structured error on 4xx", async () => {
    server.use(
      http.get("https://www.strava.com/api/v3/foo", () =>
        HttpResponse.json({ message: "Authorization Error" }, { status: 401 }),
      ),
    );
    await expect(stravaGet("/foo", "abc")).rejects.toMatchObject({
      status: 401,
      message: expect.stringMatching(/Authorization Error/),
    });
  });

  it("stravaPost serialises JSON body", async () => {
    let received: unknown;
    server.use(
      http.post("https://www.strava.com/api/v3/activities", async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ id: 1 });
      }),
    );
    await stravaPost("/activities", "abc", { name: "Run", type: "Run" });
    expect(received).toEqual({ name: "Run", type: "Run" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- strava-client`
Expected: FAIL with "Cannot find module '@/lib/strava/client'".

- [ ] **Step 3: Write `lib/strava/client.ts`**

```ts
const BASE = "https://www.strava.com/api/v3";

export interface StravaRateLimit {
  shortLimit: number | null;
  shortUsage: number | null;
  dailyLimit: number | null;
  dailyUsage: number | null;
  readShortLimit: number | null;
  readShortUsage: number | null;
  readDailyLimit: number | null;
  readDailyUsage: number | null;
}

let _latestRateLimit: StravaRateLimit | null = null;
export function getLatestRateLimit(): StravaRateLimit | null { return _latestRateLimit; }

export class StravaApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "StravaApiError";
  }
}

function parseRateLimit(headers: Headers): StravaRateLimit {
  const parsePair = (h: string | null): [number | null, number | null] => {
    if (!h) return [null, null];
    const [a, b] = h.split(",").map((s) => Number(s.trim()));
    return [Number.isFinite(a) ? a : null, Number.isFinite(b) ? b : null];
  };
  const [shortLimit, dailyLimit] = parsePair(headers.get("x-ratelimit-limit"));
  const [shortUsage, dailyUsage] = parsePair(headers.get("x-ratelimit-usage"));
  const [readShortLimit, readDailyLimit] = parsePair(headers.get("x-readratelimit-limit"));
  const [readShortUsage, readDailyUsage] = parsePair(headers.get("x-readratelimit-usage"));
  return {
    shortLimit, shortUsage, dailyLimit, dailyUsage,
    readShortLimit, readShortUsage, readDailyLimit, readDailyUsage,
  };
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function handle<T>(res: Response): Promise<{ data: T; rateLimit: StravaRateLimit }> {
  const rateLimit = parseRateLimit(res.headers);
  _latestRateLimit = rateLimit;
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* not json */ }
    const msg = (body as { message?: string })?.message ?? res.statusText ?? "Strava API error";
    throw new StravaApiError(res.status, msg, body);
  }
  const data = (await res.json()) as T;
  return { data, rateLimit };
}

export function stravaGet<T>(
  path: string,
  accessToken: string,
  params?: Record<string, string | number | boolean | undefined>,
) {
  return fetch(buildUrl(path, params), {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  }).then((r) => handle<T>(r));
}

export function stravaPost<T>(path: string, accessToken: string, body: unknown) {
  return fetch(buildUrl(path), {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export function stravaPut<T>(path: string, accessToken: string, body: unknown) {
  return fetch(buildUrl(path), {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export function stravaPostMultipart<T>(path: string, accessToken: string, form: FormData) {
  return fetch(buildUrl(path), {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  }).then((r) => handle<T>(r));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- strava-client`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/strava/client.ts tests/lib/strava-client.test.ts
git commit -m "feat: strava authed fetch client with rate-limit tracking"
```

---

## Task 9: MCP server scaffold + route + first tool `get_athlete`

**Files:**
- Create: `lib/mcp/server.ts`
- Create: `lib/mcp/tools/get-athlete.ts`
- Create: `app/api/mcp/[token]/route.ts`
- Create: `tests/mcp/route.test.ts`

- [ ] **Step 1: Write `lib/mcp/tools/get-athlete.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const GetAthleteInput = z.object({});

export async function getAthlete(_args: z.infer<typeof GetAthleteInput>, accessToken: string) {
  const { data } = await stravaGet("/athlete", accessToken);
  return data;
}
```

- [ ] **Step 2: Write `lib/mcp/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAthleteWithValidToken } from "@/lib/strava/athlete-repo";
import { GetAthleteInput, getAthlete } from "./tools/get-athlete";

function wrap<T>(fn: () => Promise<T>) {
  return fn().then(
    (result) => ({
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    }),
    (err: unknown) => ({
      content: [
        {
          type: "text" as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    }),
  );
}

export async function buildMcpServerForAthlete(athleteId: number): Promise<McpServer> {
  const server = new McpServer({ name: "strava-mcp", version: "0.1.0" });

  const { accessToken } = await getAthleteWithValidToken(athleteId);

  server.tool(
    "get_athlete",
    "Return the authenticated Strava athlete's profile: id, username, name, profile photo URL, premium status, weight, FTP, and measurement preferences.",
    GetAthleteInput.shape,
    (args) => wrap(() => getAthlete(args, accessToken)),
  );

  return server;
}
```

- [ ] **Step 3: Write `app/api/mcp/[token]/route.ts`**

```ts
import type { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb, mcpTokens } from "@/lib/db";
import { parsePathToken, verifyTokenAgainstHash } from "@/lib/path-token";
import { buildMcpServerForAthlete } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RouteContext { params: Promise<{ token: string }> }

async function authenticate(token: string): Promise<{ ok: true; athleteId: number; tokenId: number } | { ok: false; status: number; error: string }> {
  const parsed = parsePathToken(token);
  if (!parsed) return { ok: false, status: 401, error: "malformed token" };

  const rows = await getDb()
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.tokenPrefix, parsed.prefix), isNull(mcpTokens.revokedAt)));

  for (const row of rows) {
    if (await verifyTokenAgainstHash(token, row.tokenHash)) {
      await getDb()
        .update(mcpTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(mcpTokens.id, row.id));
      return { ok: true, athleteId: row.athleteId, tokenId: row.id };
    }
  }
  return { ok: false, status: 401, error: "token not found or revoked" };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params;
  const auth = await authenticate(token);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const server = await buildMcpServerForAthlete(auth.athleteId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req as unknown as Request);
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params;
  const auth = await authenticate(token);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  return Response.json({
    name: "strava-mcp",
    description: "Read/write access to a connected Strava athlete.",
    transport: "streamable-http",
    methods: ["POST"],
  }, { headers: { allow: "POST, OPTIONS, GET" } });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS, GET",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS, GET",
      "access-control-allow-headers": "content-type, mcp-session-id",
      "access-control-max-age": "86400",
    },
  });
}
```

If `@modelcontextprotocol/sdk@1` doesn't ship `webStandardStreamableHttp.js`, fall back to `streamableHttp.js` (older SDKs name the export differently). Verify by listing `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/`.

- [ ] **Step 4: Write the failing route test**

```ts
// tests/mcp/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const tokensTable: Array<{ id: number; athleteId: number; tokenPrefix: string; tokenHash: string; revokedAt: Date | null }> = [];
  return {
    getDb: () => ({
      select: () => ({ from: () => ({ where: () => tokensTable.filter((r) => r.revokedAt === null) }) }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    }),
    mcpTokens: { tokenPrefix: "token_prefix", id: "id" } as never,
    schema: {},
    __tokens: tokensTable,
  };
});

vi.mock("@/lib/mcp/server", () => ({
  buildMcpServerForAthlete: vi.fn(async () => ({ connect: async () => {} })),
}));

vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: class {
    async handleRequest() { return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
  },
}));

import bcrypt from "bcryptjs";
import { POST } from "@/app/api/mcp/[token]/route";

const db = (await import("@/lib/db")) as unknown as { __tokens: Array<unknown> };

function mkRequest(token: string) {
  return {
    request: new Request(`http://localhost/api/mcp/${token}`, { method: "POST", body: "{}" }),
    ctx: { params: Promise.resolve({ token }) },
  };
}

beforeEach(() => { (db.__tokens as Array<unknown>).length = 0; });

describe("MCP route auth", () => {
  it("rejects a malformed token", async () => {
    const { request, ctx } = mkRequest("nope");
    const res = await POST(request as never, ctx);
    expect(res.status).toBe(401);
  });

  it("rejects an unknown token", async () => {
    const token = "stmk_aabbccdd_" + "0".repeat(64);
    const { request, ctx } = mkRequest(token);
    const res = await POST(request as never, ctx);
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and dispatches to the server", async () => {
    const token = "stmk_aabbccdd_" + "1".repeat(64);
    (db.__tokens as Array<unknown>).push({
      id: 1,
      athleteId: 42,
      tokenPrefix: "aabbccdd",
      tokenHash: bcrypt.hashSync(token, 4),
      revokedAt: null,
    });
    const { request, ctx } = mkRequest(token);
    const res = await POST(request as never, ctx);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- route`
Expected: 3 tests PASS.

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp app/api/mcp tests/mcp
git commit -m "feat: mcp route scaffold + get_athlete tool"
```

---

## Task 10: Read tools — stats, zones

**Files:**
- Create: `lib/mcp/tools/get-athlete-stats.ts`
- Create: `lib/mcp/tools/get-athlete-zones.ts`
- Modify: `lib/mcp/server.ts`

- [ ] **Step 1: Write `lib/mcp/tools/get-athlete-stats.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const GetAthleteStatsInput = z.object({
  athleteId: z.number().int().describe("Athlete id whose stats to fetch. Pass the id from get_athlete."),
});

export async function getAthleteStats(args: z.infer<typeof GetAthleteStatsInput>, accessToken: string) {
  const { data } = await stravaGet(`/athletes/${args.athleteId}/stats`, accessToken);
  return data;
}
```

- [ ] **Step 2: Write `lib/mcp/tools/get-athlete-zones.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const GetAthleteZonesInput = z.object({});

export async function getAthleteZones(_args: z.infer<typeof GetAthleteZonesInput>, accessToken: string) {
  const { data } = await stravaGet("/athlete/zones", accessToken);
  return data;
}
```

- [ ] **Step 3: Register both in `lib/mcp/server.ts`**

After the `get_athlete` registration, add:

```ts
import { GetAthleteStatsInput, getAthleteStats } from "./tools/get-athlete-stats";
import { GetAthleteZonesInput, getAthleteZones } from "./tools/get-athlete-zones";

server.tool(
  "get_athlete_stats",
  "Recent (last 4 weeks) / year-to-date / all-time totals — broken out by run, ride, and swim. Pass the athlete id from get_athlete.",
  GetAthleteStatsInput.shape,
  (args) => wrap(() => getAthleteStats(args, accessToken)),
);

server.tool(
  "get_athlete_zones",
  "The authenticated athlete's heart-rate and power zone definitions.",
  GetAthleteZonesInput.shape,
  (args) => wrap(() => getAthleteZones(args, accessToken)),
);
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/tools/get-athlete-stats.ts lib/mcp/tools/get-athlete-zones.ts lib/mcp/server.ts
git commit -m "feat: get_athlete_stats + get_athlete_zones"
```

---

## Task 11: Read tools — list_activities, get_activity (TDD)

**Files:**
- Create: `lib/mcp/tools/list-activities.ts`
- Create: `lib/mcp/tools/get-activity.ts`
- Modify: `lib/mcp/server.ts`
- Create: `tests/mcp/tools/list-activities.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp/tools/list-activities.test.ts
import { describe, it, expect } from "vitest";
import { http, HttpResponse, server, sampleActivity } from "@/tests/fixtures/strava";
import { listActivities } from "@/lib/mcp/tools/list-activities";

describe("list_activities", () => {
  it("forwards before/after/page/per_page to Strava", async () => {
    let url = "";
    server.use(
      http.get("https://www.strava.com/api/v3/athlete/activities", ({ request }) => {
        url = request.url;
        return HttpResponse.json([sampleActivity]);
      }),
    );

    const result = await listActivities(
      { before: 1700000000, after: 1690000000, page: 2, per_page: 50 },
      "at",
    );
    expect(url).toContain("before=1700000000");
    expect(url).toContain("after=1690000000");
    expect(url).toContain("page=2");
    expect(url).toContain("per_page=50");
    expect(Array.isArray(result)).toBe(true);
  });

  it("works with no params", async () => {
    server.use(
      http.get("https://www.strava.com/api/v3/athlete/activities", () =>
        HttpResponse.json([sampleActivity]),
      ),
    );
    const result = await listActivities({}, "at");
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- list-activities`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `lib/mcp/tools/list-activities.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const ListActivitiesInput = z.object({
  before: z.number().int().optional().describe("Unix timestamp (seconds). Filter to activities started before this time."),
  after: z.number().int().optional().describe("Unix timestamp (seconds). Filter to activities started after this time."),
  page: z.number().int().min(1).optional().describe("1-indexed page number (default 1)."),
  per_page: z.number().int().min(1).max(200).optional().describe("Page size (default 30, max 200)."),
});

export async function listActivities(args: z.infer<typeof ListActivitiesInput>, accessToken: string) {
  const { data } = await stravaGet("/athlete/activities", accessToken, args);
  return data;
}
```

- [ ] **Step 4: Write `lib/mcp/tools/get-activity.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const GetActivityInput = z.object({
  id: z.number().int().describe("Activity id."),
  include_all_efforts: z.boolean().optional().describe("Include hidden segment efforts."),
});

export async function getActivity(args: z.infer<typeof GetActivityInput>, accessToken: string) {
  const { data } = await stravaGet(`/activities/${args.id}`, accessToken, {
    include_all_efforts: args.include_all_efforts,
  });
  return data;
}
```

- [ ] **Step 5: Register both in `lib/mcp/server.ts`**

```ts
import { ListActivitiesInput, listActivities } from "./tools/list-activities";
import { GetActivityInput, getActivity } from "./tools/get-activity";

server.tool(
  "list_activities",
  "List the authenticated athlete's activities, newest first. Filter by `before`/`after` (Unix seconds) and paginate with `page`/`per_page` (max 200). Returns summary objects — use get_activity for full detail.",
  ListActivitiesInput.shape,
  (args) => wrap(() => listActivities(args, accessToken)),
);

server.tool(
  "get_activity",
  "Full detail for one activity: laps, splits, photos count, gear, kudos count, segment efforts. Use list_activities to find ids.",
  GetActivityInput.shape,
  (args) => wrap(() => getActivity(args, accessToken)),
);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- list-activities`
Expected: 2 tests PASS.

- [ ] **Step 7: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add lib/mcp/tools/list-activities.ts lib/mcp/tools/get-activity.ts lib/mcp/server.ts tests/mcp/tools/list-activities.test.ts
git commit -m "feat: list_activities + get_activity"
```

---

## Task 12: Read tools — streams, laps, gear, clubs, segments, rate-limit

**Files:**
- Create: `lib/mcp/tools/get-activity-streams.ts`
- Create: `lib/mcp/tools/get-activity-laps.ts`
- Create: `lib/mcp/tools/list-gear.ts`
- Create: `lib/mcp/tools/get-gear.ts`
- Create: `lib/mcp/tools/list-clubs.ts`
- Create: `lib/mcp/tools/list-starred-segments.ts`
- Create: `lib/mcp/tools/get-segment.ts`
- Create: `lib/mcp/tools/get-rate-limit-status.ts`
- Modify: `lib/mcp/server.ts`

- [ ] **Step 1: Write `lib/mcp/tools/get-activity-streams.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

const STREAM_TYPES = [
  "time", "distance", "latlng", "altitude", "velocity_smooth",
  "heartrate", "cadence", "watts", "temp", "moving", "grade_smooth",
] as const;

export const GetActivityStreamsInput = z.object({
  id: z.number().int().describe("Activity id."),
  keys: z.array(z.enum(STREAM_TYPES)).describe(
    "Which streams to fetch. Each stream is a time-series for the activity. Heavy — prefer the smallest set you need (e.g. ['time','latlng'] for a map, ['time','heartrate','watts'] for performance).",
  ),
  resolution: z.enum(["low", "medium", "high"]).optional().describe("Downsample to ~100 / ~1000 / ~10000 points."),
});

export async function getActivityStreams(args: z.infer<typeof GetActivityStreamsInput>, accessToken: string) {
  const { data } = await stravaGet(`/activities/${args.id}/streams`, accessToken, {
    keys: args.keys.join(","),
    key_by_type: true,
    resolution: args.resolution,
  });
  return data;
}
```

- [ ] **Step 2: Write `lib/mcp/tools/get-activity-laps.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const GetActivityLapsInput = z.object({
  id: z.number().int().describe("Activity id."),
});

export async function getActivityLaps(args: z.infer<typeof GetActivityLapsInput>, accessToken: string) {
  const { data } = await stravaGet(`/activities/${args.id}/laps`, accessToken);
  return data;
}
```

- [ ] **Step 3: Write `lib/mcp/tools/list-gear.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";
import type { StravaAthlete } from "@/lib/strava/types";

interface AthleteWithGear extends StravaAthlete {
  bikes?: Array<{ id: string; name: string; distance: number; primary?: boolean }>;
  shoes?: Array<{ id: string; name: string; distance: number; primary?: boolean }>;
}

export const ListGearInput = z.object({});

export async function listGear(_args: z.infer<typeof ListGearInput>, accessToken: string) {
  const { data } = await stravaGet<AthleteWithGear>("/athlete", accessToken);
  return { bikes: data.bikes ?? [], shoes: data.shoes ?? [] };
}
```

- [ ] **Step 4: Write `lib/mcp/tools/get-gear.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const GetGearInput = z.object({
  id: z.string().describe("Gear id from list_gear (e.g. 'b1234567' for bike, 'g7654321' for shoes)."),
});

export async function getGear(args: z.infer<typeof GetGearInput>, accessToken: string) {
  const { data } = await stravaGet(`/gear/${args.id}`, accessToken);
  return data;
}
```

- [ ] **Step 5: Write `lib/mcp/tools/list-clubs.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const ListClubsInput = z.object({});

export async function listClubs(_args: z.infer<typeof ListClubsInput>, accessToken: string) {
  const { data } = await stravaGet("/athlete/clubs", accessToken);
  return data;
}
```

- [ ] **Step 6: Write `lib/mcp/tools/list-starred-segments.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const ListStarredSegmentsInput = z.object({
  page: z.number().int().min(1).optional(),
  per_page: z.number().int().min(1).max(200).optional(),
});

export async function listStarredSegments(args: z.infer<typeof ListStarredSegmentsInput>, accessToken: string) {
  const { data } = await stravaGet("/segments/starred", accessToken, args);
  return data;
}
```

- [ ] **Step 7: Write `lib/mcp/tools/get-segment.ts`**

```ts
import { z } from "zod";
import { stravaGet } from "@/lib/strava/client";

export const GetSegmentInput = z.object({
  id: z.number().int().describe("Segment id."),
});

export async function getSegment(args: z.infer<typeof GetSegmentInput>, accessToken: string) {
  const { data } = await stravaGet(`/segments/${args.id}`, accessToken);
  return data;
}
```

- [ ] **Step 8: Write `lib/mcp/tools/get-rate-limit-status.ts`**

```ts
import { z } from "zod";
import { getLatestRateLimit, stravaGet } from "@/lib/strava/client";

export const GetRateLimitStatusInput = z.object({});

export async function getRateLimitStatus(_args: z.infer<typeof GetRateLimitStatusInput>, accessToken: string) {
  await stravaGet("/athlete", accessToken);
  const rl = getLatestRateLimit();
  if (!rl) return { warning: "no rate-limit headers seen yet" };
  return {
    short_15min: { used: rl.shortUsage, limit: rl.shortLimit },
    daily: { used: rl.dailyUsage, limit: rl.dailyLimit },
    read_short_15min: { used: rl.readShortUsage, limit: rl.readShortLimit },
    read_daily: { used: rl.readDailyUsage, limit: rl.readDailyLimit },
    note: "Strava rate limits are SHARED ACROSS THE ENTIRE APP, not per user.",
  };
}
```

- [ ] **Step 9: Register all eight tools in `lib/mcp/server.ts`**

```ts
import { GetActivityStreamsInput, getActivityStreams } from "./tools/get-activity-streams";
import { GetActivityLapsInput, getActivityLaps } from "./tools/get-activity-laps";
import { ListGearInput, listGear } from "./tools/list-gear";
import { GetGearInput, getGear } from "./tools/get-gear";
import { ListClubsInput, listClubs } from "./tools/list-clubs";
import { ListStarredSegmentsInput, listStarredSegments } from "./tools/list-starred-segments";
import { GetSegmentInput, getSegment } from "./tools/get-segment";
import { GetRateLimitStatusInput, getRateLimitStatus } from "./tools/get-rate-limit-status";

server.tool(
  "get_activity_streams",
  "Time-series data for one activity: time, distance, latlng, altitude, velocity, heartrate, cadence, watts, temp. Pass only the `keys` you need — heavier than other tools.",
  GetActivityStreamsInput.shape,
  (args) => wrap(() => getActivityStreams(args, accessToken)),
);

server.tool(
  "get_activity_laps",
  "Lap-by-lap breakdown for an activity (auto and manual laps).",
  GetActivityLapsInput.shape,
  (args) => wrap(() => getActivityLaps(args, accessToken)),
);

server.tool(
  "list_gear",
  "List the athlete's bikes and shoes with cumulative distances. Returns { bikes: [...], shoes: [...] }.",
  ListGearInput.shape,
  (args) => wrap(() => listGear(args, accessToken)),
);

server.tool(
  "get_gear",
  "Detailed info for a single piece of gear (bike or shoes) by id.",
  GetGearInput.shape,
  (args) => wrap(() => getGear(args, accessToken)),
);

server.tool(
  "list_clubs",
  "Clubs the authenticated athlete belongs to.",
  ListClubsInput.shape,
  (args) => wrap(() => listClubs(args, accessToken)),
);

server.tool(
  "list_starred_segments",
  "Segments the athlete has starred. Paginated.",
  ListStarredSegmentsInput.shape,
  (args) => wrap(() => listStarredSegments(args, accessToken)),
);

server.tool(
  "get_segment",
  "Details for a single segment by id: location, distance, average grade, and the athlete's personal best on it.",
  GetSegmentInput.shape,
  (args) => wrap(() => getSegment(args, accessToken)),
);

server.tool(
  "get_rate_limit_status",
  "Report current Strava API rate-limit usage (15-minute and daily, both general and read-specific). NOTE: limits are shared across the entire app, not per user.",
  GetRateLimitStatusInput.shape,
  (args) => wrap(() => getRateLimitStatus(args, accessToken)),
);
```

- [ ] **Step 10: Run all tests**

Run: `npm test`
Expected: every previous test still PASS.

- [ ] **Step 11: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 12: Commit**

```bash
git add lib/mcp/tools lib/mcp/server.ts
git commit -m "feat: streams/laps/gear/clubs/segments/rate-limit tools"
```

---

## Task 13: Write tools — update_activity, star_segment (TDD)

**Files:**
- Create: `lib/mcp/tools/update-activity.ts`
- Create: `lib/mcp/tools/star-segment.ts`
- Modify: `lib/mcp/server.ts`
- Create: `tests/mcp/tools/update-activity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp/tools/update-activity.test.ts
import { describe, it, expect } from "vitest";
import { http, HttpResponse, server } from "@/tests/fixtures/strava";
import { updateActivity } from "@/lib/mcp/tools/update-activity";

describe("update_activity", () => {
  it("PUTs only the fields provided", async () => {
    let received: Record<string, unknown> = {};
    server.use(
      http.put("https://www.strava.com/api/v3/activities/1234", async ({ request }) => {
        received = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: 1234, name: "Renamed" });
      }),
    );

    await updateActivity({ id: 1234, name: "Renamed", commute: true }, "at");
    expect(received).toEqual({ name: "Renamed", commute: true });
    expect(received).not.toHaveProperty("type");
    expect(received).not.toHaveProperty("gear_id");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- update-activity`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `lib/mcp/tools/update-activity.ts`**

```ts
import { z } from "zod";
import { stravaPut } from "@/lib/strava/client";

export const UpdateActivityInput = z.object({
  id: z.number().int().describe("Activity id to update."),
  name: z.string().optional(),
  type: z.string().optional().describe("Legacy activity type (e.g. 'Run', 'Ride'). Prefer sport_type."),
  sport_type: z.string().optional().describe("New-style sport type (e.g. 'TrailRun', 'GravelRide')."),
  gear_id: z.string().optional().describe("Gear id from list_gear, or 'none' to clear."),
  commute: z.boolean().optional(),
  trainer: z.boolean().optional(),
  hide_from_home: z.boolean().optional(),
  description: z.string().optional(),
});

export async function updateActivity(args: z.infer<typeof UpdateActivityInput>, accessToken: string) {
  const { id, ...body } = args;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) clean[k] = v;
  const { data } = await stravaPut(`/activities/${id}`, accessToken, clean);
  return data;
}
```

- [ ] **Step 4: Write `lib/mcp/tools/star-segment.ts`**

```ts
import { z } from "zod";
import { stravaPut } from "@/lib/strava/client";

export const StarSegmentInput = z.object({
  id: z.number().int().describe("Segment id."),
  starred: z.boolean().describe("true to star, false to unstar."),
});

export async function starSegment(args: z.infer<typeof StarSegmentInput>, accessToken: string) {
  const { data } = await stravaPut(`/segments/${args.id}/starred`, accessToken, { starred: args.starred });
  return data;
}
```

- [ ] **Step 5: Register both in `lib/mcp/server.ts`**

```ts
import { UpdateActivityInput, updateActivity } from "./tools/update-activity";
import { StarSegmentInput, starSegment } from "./tools/star-segment";

server.tool(
  "update_activity",
  "Edit one of the athlete's activities. Pass only the fields you want to change: name, type, sport_type, gear_id, commute, trainer, hide_from_home, description.",
  UpdateActivityInput.shape,
  (args) => wrap(() => updateActivity(args, accessToken)),
);

server.tool(
  "star_segment",
  "Star (or unstar) a segment for the athlete.",
  StarSegmentInput.shape,
  (args) => wrap(() => starSegment(args, accessToken)),
);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- update-activity`
Expected: 1 test PASS.

- [ ] **Step 7: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add lib/mcp/tools/update-activity.ts lib/mcp/tools/star-segment.ts lib/mcp/server.ts tests/mcp/tools/update-activity.test.ts
git commit -m "feat: update_activity + star_segment"
```

---

## Task 14: Write tool — create_activity (manual entry)

**Files:**
- Create: `lib/mcp/tools/create-activity.ts`
- Modify: `lib/mcp/server.ts`

- [ ] **Step 1: Write `lib/mcp/tools/create-activity.ts`**

```ts
import { z } from "zod";
import { stravaPost } from "@/lib/strava/client";

export const CreateActivityInput = z.object({
  name: z.string().describe("Activity name."),
  sport_type: z.string().describe("Sport type, e.g. 'Run', 'Ride', 'Workout'."),
  start_date_local: z.string().describe("ISO 8601 local time, e.g. '2026-05-22T07:30:00Z'."),
  elapsed_time: z.number().int().describe("Total elapsed time in seconds."),
  distance: z.number().optional().describe("Distance in meters."),
  description: z.string().optional(),
  trainer: z.boolean().optional(),
  commute: z.boolean().optional(),
});

export async function createActivity(args: z.infer<typeof CreateActivityInput>, accessToken: string) {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined) body[k] = v;
  const { data } = await stravaPost("/activities", accessToken, body);
  return data;
}
```

- [ ] **Step 2: Register in `lib/mcp/server.ts`**

```ts
import { CreateActivityInput, createActivity } from "./tools/create-activity";

server.tool(
  "create_activity",
  "Create a manual activity (no GPS). Required: name, sport_type, start_date_local (ISO 8601), elapsed_time (seconds). Optional: distance (meters), description, trainer, commute.",
  CreateActivityInput.shape,
  (args) => wrap(() => createActivity(args, accessToken)),
);
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add lib/mcp/tools/create-activity.ts lib/mcp/server.ts
git commit -m "feat: create_activity (manual entry)"
```

---

## Task 15: Write tool — upload_activity with polling (TDD)

**Files:**
- Create: `lib/mcp/tools/upload-activity.ts`
- Modify: `lib/mcp/server.ts`
- Create: `tests/mcp/tools/upload-activity.test.ts`

Strava's upload endpoint returns an upload id; the upload processes asynchronously. We poll `/uploads/{id}` until `activity_id` appears or `error` is non-empty (typically ≤ 30s).

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp/tools/upload-activity.test.ts
import { describe, it, expect } from "vitest";
import { http, HttpResponse, server } from "@/tests/fixtures/strava";
import { uploadActivity } from "@/lib/mcp/tools/upload-activity";

describe("upload_activity", () => {
  it("uploads then polls until activity_id appears", async () => {
    let polls = 0;
    server.use(
      http.post("https://www.strava.com/api/v3/uploads", () =>
        HttpResponse.json({ id: 7, id_str: "7", status: "Your activity is still being processed.", error: null, activity_id: null }),
      ),
      http.get("https://www.strava.com/api/v3/uploads/7", () => {
        polls++;
        if (polls < 2) {
          return HttpResponse.json({ id: 7, id_str: "7", status: "Your activity is still being processed.", error: null, activity_id: null });
        }
        return HttpResponse.json({ id: 7, id_str: "7", status: "Your activity is ready.", error: null, activity_id: 9999 });
      }),
    );

    const result = await uploadActivity(
      { data_type: "gpx", data_base64: Buffer.from("<gpx/>").toString("base64"), name: "Test" },
      "at",
      { pollIntervalMs: 5, maxPolls: 10 },
    );
    expect(result.activity_id).toBe(9999);
    expect(polls).toBe(2);
  });

  it("throws if Strava reports an error", async () => {
    server.use(
      http.post("https://www.strava.com/api/v3/uploads", () =>
        HttpResponse.json({ id: 8, id_str: "8", status: "There was an error processing your activity.", error: "Activity already exists", activity_id: null }),
      ),
    );
    await expect(
      uploadActivity({ data_type: "gpx", data_base64: "x" }, "at", { pollIntervalMs: 5, maxPolls: 2 }),
    ).rejects.toThrow(/already exists/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- upload-activity`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `lib/mcp/tools/upload-activity.ts`**

```ts
import { z } from "zod";
import { stravaGet, stravaPostMultipart } from "@/lib/strava/client";

export const UploadActivityInput = z.object({
  data_type: z.enum(["fit", "fit.gz", "tcx", "tcx.gz", "gpx", "gpx.gz"]).describe(
    "File format. .gz variants are pre-gzipped.",
  ),
  data_base64: z.string().describe("Base64-encoded file contents."),
  name: z.string().optional().describe("Activity name (defaults to file name)."),
  description: z.string().optional(),
  external_id: z.string().optional().describe("Caller-supplied id for idempotency."),
  trainer: z.boolean().optional(),
  commute: z.boolean().optional(),
  sport_type: z.string().optional(),
});

interface UploadStatus {
  id: number;
  id_str: string;
  status: string;
  error: string | null;
  activity_id: number | null;
}

interface UploadOpts {
  pollIntervalMs?: number;
  maxPolls?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLLS = 30;

export async function uploadActivity(
  args: z.infer<typeof UploadActivityInput>,
  accessToken: string,
  opts: UploadOpts = {},
): Promise<UploadStatus> {
  const form = new FormData();
  form.set("data_type", args.data_type);
  const fileBlob = new Blob([Buffer.from(args.data_base64, "base64")]);
  form.set("file", fileBlob, `upload.${args.data_type.replace(".gz", "")}`);
  if (args.name) form.set("name", args.name);
  if (args.description) form.set("description", args.description);
  if (args.external_id) form.set("external_id", args.external_id);
  if (args.trainer !== undefined) form.set("trainer", String(args.trainer ? 1 : 0));
  if (args.commute !== undefined) form.set("commute", String(args.commute ? 1 : 0));
  if (args.sport_type) form.set("sport_type", args.sport_type);

  const { data: initial } = await stravaPostMultipart<UploadStatus>("/uploads", accessToken, form);

  if (initial.error) throw new Error(`Strava upload error: ${initial.error}`);
  if (initial.activity_id) return initial;

  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = opts.maxPolls ?? DEFAULT_MAX_POLLS;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, interval));
    const { data } = await stravaGet<UploadStatus>(`/uploads/${initial.id}`, accessToken);
    if (data.error) throw new Error(`Strava upload error: ${data.error}`);
    if (data.activity_id) return data;
  }
  throw new Error(`upload polling timed out after ${maxPolls} attempts`);
}
```

- [ ] **Step 4: Register in `lib/mcp/server.ts`**

```ts
import { UploadActivityInput, uploadActivity } from "./tools/upload-activity";

server.tool(
  "upload_activity",
  "Upload a .fit / .gpx / .tcx file (or .gz variants) as a new activity. Pass `data_base64` (the file contents base64-encoded) and `data_type`. Returns the upload status once processing completes (usually within 30s).",
  UploadActivityInput.shape,
  (args) => wrap(() => uploadActivity(args, accessToken)),
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- upload-activity`
Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/tools/upload-activity.ts lib/mcp/server.ts tests/mcp/tools/upload-activity.test.ts
git commit -m "feat: upload_activity with polling"
```

---

## Task 16: Session cookie helper

**Files:**
- Create: `lib/session.ts`

- [ ] **Step 1: Write `lib/session.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "strava_mcp_session";
const MAX_AGE_S = 60 * 60 * 24 * 7;

function secret(): Buffer {
  const hex = process.env.SESSION_COOKIE_SECRET;
  if (!hex) throw new Error("SESSION_COOKIE_SECRET not set");
  return Buffer.from(hex, "hex");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function buildSessionCookie(athleteId: number): string {
  const payload = `${athleteId}.${Date.now()}`;
  const sig = sign(payload);
  const value = `${payload}.${sig}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_S}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionCookie(cookieHeader: string | null): number | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(/;\s*/).find((p) => p.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = match.slice(COOKIE_NAME.length + 1);
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [aid, ts, sig] = parts;
  const expected = sign(`${aid}.${ts}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const id = Number(aid);
  return Number.isFinite(id) ? id : null;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add lib/session.ts
git commit -m "feat: signed session cookie helper"
```

---

## Task 17: Connect route + OAuth callback

**Files:**
- Create: `app/connect/route.ts`
- Create: `app/api/strava/callback/route.ts`

- [ ] **Step 1: Write `app/connect/route.ts`**

```ts
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const SCOPES = "read,activity:read_all,activity:write,profile:read_all";

export function GET(_req: NextRequest) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const origin = process.env.PUBLIC_ORIGIN;
  if (!clientId || !origin) {
    return new Response("server misconfigured", { status: 500 });
  }
  const redirect = `${origin}/api/strava/callback`;
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", SCOPES);
  return Response.redirect(url.toString(), 302);
}
```

- [ ] **Step 2: Write `app/api/strava/callback/route.ts`**

```ts
import type { NextRequest } from "next/server";
import { exchangeCode } from "@/lib/strava/oauth";
import { upsertAthleteFromTokenResponse } from "@/lib/strava/athlete-repo";
import { mintPathToken } from "@/lib/path-token";
import { getDb, mcpTokens } from "@/lib/db";
import { buildSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const scope = url.searchParams.get("scope") ?? "";

  if (error) return new Response(`Strava OAuth denied: ${error}`, { status: 400 });
  if (!code) return new Response("missing code", { status: 400 });

  const tokenResponse = await exchangeCode(code);
  if (!tokenResponse.athlete) {
    return new Response("Strava response missing athlete payload", { status: 502 });
  }

  await upsertAthleteFromTokenResponse(tokenResponse, scope);

  const minted = await mintPathToken();
  await getDb().insert(mcpTokens).values({
    athleteId: tokenResponse.athlete.id,
    tokenPrefix: minted.prefix,
    tokenHash: minted.hash,
    label: "strava-oauth",
  });

  const origin = process.env.PUBLIC_ORIGIN!;
  const mcpUrl = `${origin}/api/mcp/${minted.token}`;

  const redirectUrl = new URL(`/connected/${tokenResponse.athlete.id}`, origin);
  redirectUrl.searchParams.set("token", minted.token);
  redirectUrl.searchParams.set("mcp_url", mcpUrl);

  return new Response(null, {
    status: 302,
    headers: {
      location: redirectUrl.toString(),
      "set-cookie": buildSessionCookie(tokenResponse.athlete.id),
    },
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add app/connect app/api/strava/callback
git commit -m "feat: /connect redirect + oauth callback mints path-token"
```

---

## Task 18: Connected page + disconnect route

**Files:**
- Create: `app/connected/[athleteId]/page.tsx`
- Create: `app/connected/[athleteId]/copy-button.tsx`
- Create: `app/api/strava/disconnect/route.ts`

- [ ] **Step 1: Write `app/connected/[athleteId]/copy-button.tsx`**

```tsx
"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
```

- [ ] **Step 2: Write `app/connected/[athleteId]/page.tsx`**

```tsx
import { CopyButton } from "./copy-button";

export const dynamic = "force-dynamic";

export default async function ConnectedPage(props: {
  params: Promise<{ athleteId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const mcpUrl = searchParams.mcp_url;
  const athleteId = params.athleteId;

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", padding: "1rem", fontFamily: "system-ui" }}>
      <h1>Connected as athlete {athleteId}</h1>

      {mcpUrl ? (
        <>
          <p>Add this URL as a custom connector in Claude:</p>
          <pre style={{ background: "#f4f4f4", padding: "1rem", overflow: "auto" }}>{mcpUrl}</pre>
          <CopyButton value={mcpUrl} />
          <p style={{ marginTop: "1rem", color: "#a00", fontWeight: 600 }}>
            Save this URL now. It is shown only once. If you lose it, click Connect again to mint a new one.
          </p>
          <ol>
            <li>In Claude, open Settings → Connectors → Add custom connector.</li>
            <li>Paste the URL above.</li>
            <li>Save. The MCP appears in Claude's tool list.</li>
          </ol>
        </>
      ) : (
        <p>
          You are connected, but the MCP URL is no longer in the address bar. Click
          {" "}<a href="/connect">Connect Strava</a> to mint a fresh one.
        </p>
      )}

      <hr style={{ margin: "2rem 0" }} />
      <h2>Heads up: rate limits</h2>
      <p>
        Strava's API limits (100 req / 15 min, 1000 / day) are shared across the
        whole app — not per user. We cache aggressively and refuse requests close
        to the ceiling, but this is the binding constraint at scale.
      </p>

      <hr style={{ margin: "2rem 0" }} />
      <form action="/api/strava/disconnect" method="post">
        <button type="submit">Disconnect</button>
      </form>

      <hr style={{ margin: "2rem 0" }} />
      <p style={{ fontSize: "0.9em", color: "#666" }}>Powered by Strava.</p>
    </main>
  );
}
```

- [ ] **Step 3: Write `app/api/strava/disconnect/route.ts`**

```ts
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, athletes } from "@/lib/db";
import { decryptToken } from "@/lib/crypto";
import { readSessionCookie, clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const athleteId = readSessionCookie(req.headers.get("cookie"));
  if (!athleteId) {
    return new Response("not signed in", { status: 401 });
  }

  const rows = await getDb().select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  const row = rows[0];
  if (row) {
    try {
      const accessToken = decryptToken(row.accessTokenEnc);
      await fetch("https://www.strava.com/oauth/deauthorize", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
      });
    } catch { /* ignore */ }
    await getDb().delete(athletes).where(eq(athletes.id, athleteId));
  }

  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": clearSessionCookie() },
  });
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add app/connected app/api/strava/disconnect
git commit -m "feat: connected page + disconnect"
```

---

## Task 19: Marketing page

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "3rem auto", padding: "1rem", fontFamily: "system-ui" }}>
      <h1>Strava MCP</h1>
      <p style={{ fontSize: "1.1rem", lineHeight: 1.5 }}>
        Connect your Strava account to an LLM. Lets you ask things like
        <em> "summarise my last week of running"</em>,
        <em> "what was my fastest 5k this year?"</em>, or
        <em> "rename yesterday's activity to 'Recovery jog'"</em>.
      </p>

      <a
        href="/connect"
        style={{
          display: "inline-block",
          marginTop: "1.5rem",
          padding: "0.75rem 1.25rem",
          background: "#fc4c02",
          color: "white",
          textDecoration: "none",
          borderRadius: 4,
          fontWeight: 600,
        }}
      >
        Connect Strava
      </a>

      <h2 style={{ marginTop: "3rem" }}>What it does</h2>
      <ul>
        <li>Reads your activities, gear, segments, clubs, and stats.</li>
        <li>Edits activity metadata (name, type, gear, description, commute flag).</li>
        <li>Creates manual activities and uploads .fit / .gpx / .tcx files.</li>
        <li>Stars and unstars segments.</li>
      </ul>

      <h2 style={{ marginTop: "2rem" }}>What it doesn't do (yet)</h2>
      <ul>
        <li>Post kudos or comments — Strava's API blocks third-party apps from this.</li>
        <li>Live activity push — we poll on demand.</li>
        <li>Public segment leaderboards beyond your own personal best.</li>
      </ul>

      <p style={{ marginTop: "3rem", fontSize: "0.85em", color: "#666" }}>
        Powered by Strava. We never sell your data. Disconnect at any time from the connected page.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: marketing page"
```

---

## Task 20: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# strava-mcp

Hosted MCP server that lets any Strava user connect their account to an LLM. Live at `https://strava-mcp.vercel.app`.

## What it does

- Onboards users via Strava OAuth.
- Issues each athlete a path-token MCP URL (`/api/mcp/<token>`) to paste into Claude.
- Exposes 16 tools — 12 read, 4 write — covering activities, streams, gear, clubs, segments, plus write operations Strava allows.

## Stack

Next.js 15 App Router, React 19, Drizzle ORM, Neon Postgres, `@modelcontextprotocol/sdk` v1.

## Local development

```bash
npm install
cp .env.example .env.local
# fill in DATABASE_URL, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET,
# TOKEN_ENCRYPTION_KEY (64 hex), SESSION_COOKIE_SECRET (64 hex), PUBLIC_ORIGIN
npm run db:generate
npm run db:migrate
npm run dev
```

Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Strava app setup

1. Create an app at https://www.strava.com/settings/api.
2. App name cannot contain "Strava" — call it e.g. `MCP Connector`.
3. Authorization Callback Domain: `strava-mcp.vercel.app` (and `localhost` for dev).
4. Copy the Client ID and Client Secret into `.env.local`.

## Tests

```bash
npm test
STRAVA_TEST_ATHLETE_TOKEN=... npm test -- e2e/smoke
```

## Deploy

`git push origin main` — Vercel builds and deploys automatically.

## Spec / plan

- Spec: `docs/superpowers/specs/2026-05-22-strava-mcp-design.md`
- Plan: `docs/superpowers/plans/2026-05-22-strava-mcp-implementation.md`
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: readme"
```

---

## Task 21: E2E smoke test (gated)

**Files:**
- Create: `tests/e2e/smoke.test.ts`

- [ ] **Step 1: Write `tests/e2e/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { stravaGet } from "@/lib/strava/client";

const accessToken = process.env.STRAVA_TEST_ATHLETE_TOKEN;
const describeIf = accessToken ? describe : describe.skip;

describeIf("e2e smoke (live Strava API)", () => {
  it("lists at least one recent activity", async () => {
    const { data, rateLimit } = await stravaGet<Array<{ id: number; name: string }>>(
      "/athlete/activities",
      accessToken!,
      { per_page: 5 },
    );
    expect(Array.isArray(data)).toBe(true);
    expect(rateLimit.shortLimit).not.toBeNull();
    if (data.length > 0) {
      expect(typeof data[0].id).toBe("number");
      expect(typeof data[0].name).toBe("string");
    }
  });

  it("returns athlete profile", async () => {
    const { data } = await stravaGet<{ id: number; firstname: string }>("/athlete", accessToken!);
    expect(typeof data.id).toBe("number");
    expect(typeof data.firstname).toBe("string");
  });
});
```

Note: vitest setup wires MSW with `onUnhandledRequest: "error"`. For the e2e smoke test to hit the real API, run it via `vitest run --reporter=verbose tests/e2e/smoke.test.ts` and either (a) temporarily set `onUnhandledRequest: "bypass"` in `tests/setup.ts` when `STRAVA_TEST_ATHLETE_TOKEN` is set, or (b) call `server.use(http.all('https://www.strava.com/api/v3/*', () => passthrough()))` at the top of the smoke file. Pick (a) — guard the setup with `if (process.env.STRAVA_TEST_ATHLETE_TOKEN) server.listen({ onUnhandledRequest: "bypass" });` and otherwise keep the default `"error"` behavior.

- [ ] **Step 2: Run with no env var — confirm skip**

Run: `npm test -- smoke`
Expected: 0 tests run (suite skipped), no failures.

- [ ] **Step 3: (Optional, local-only) Run with a real access token**

Run: `STRAVA_TEST_ATHLETE_TOKEN=<real-access-token> npm test -- smoke`
Expected: 2 tests PASS against live Strava API.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/smoke.test.ts tests/setup.ts
git commit -m "test: e2e smoke against live strava api (gated)"
```

---

## Task 22: GitHub repo + Vercel link + first deploy

External-system setup. Requires `gh` and `vercel` CLIs logged in.

- [ ] **Step 1: Create a Neon database**

Use the Neon dashboard or `vercel marketplace install neon` once the project exists. Capture the connection string into `.env.local` under `DATABASE_URL`.

- [ ] **Step 2: Run migrations against Neon**

Run: `npm run db:migrate`
Expected: migrations applied; tables `athletes`, `mcp_tokens`, `usage_log` exist.

- [ ] **Step 3: Create a Strava API app**

Visit https://www.strava.com/settings/api, register the app (not naming it "Strava-something"). Set Authorization Callback Domain to `strava-mcp.vercel.app` and `localhost`. Capture Client ID and Client Secret.

- [ ] **Step 4: Push to a new GitHub repo**

```bash
gh repo create strava-mcp --private --source=. --remote=origin --push
```

- [ ] **Step 5: Link to Vercel and deploy**

```bash
vercel link
vercel env add DATABASE_URL production
vercel env add STRAVA_CLIENT_ID production
vercel env add STRAVA_CLIENT_SECRET production
vercel env add TOKEN_ENCRYPTION_KEY production
vercel env add SESSION_COOKIE_SECRET production
vercel env add PUBLIC_ORIGIN production    # value: https://strava-mcp.vercel.app
# Add the same env vars to preview/development as needed.
git push origin main
```

Expected: Vercel auto-deploys on push; `https://strava-mcp.vercel.app` renders the marketing page.

- [ ] **Step 6: Walk the connect flow once**

Visit `https://strava-mcp.vercel.app/`, click Connect Strava, complete the OAuth dance, confirm the connected page shows an MCP URL.

- [ ] **Step 7: Add MCP URL to Claude and call `get_athlete`**

In Claude: Settings → Connectors → Add custom connector → paste the URL. Call `get_athlete` — your Strava profile should return. Check Vercel function logs + `usage_log` rows if anything fails.

- [ ] **Step 8: Add project to MEMORY.md**

Add an entry to `~/.claude/projects/-Users-timcox-tim-os/memory/MEMORY.md` pointing to a new `project_strava_mcp.md` memory file with status, domain, and `last_touched: 2026-05-22`. Use the same shape as `project_ctca_crm.md`.

- [ ] **Step 9: Final commit (if deploy debugging produced changes)**

```bash
git add -A && git diff --cached --quiet || git commit -m "chore: deploy adjustments"
git push origin main
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Marketing page with Powered by Strava | 19 |
| `/connect` redirect | 17 |
| OAuth callback exchanges code, upserts athlete, mints path token | 17 |
| `/connected/<athleteId>` page with copy button + disconnect | 18 |
| `/api/mcp/<token>` route — POST/GET/OPTIONS | 9 |
| Token format `stmk_<prefix>_<secret>` | 5 |
| OAuth scopes read,activity:read_all,activity:write,profile:read_all | 17 |
| Token refresh within 5 min skew, persisting rotated refresh_token | 7 |
| AES-256-GCM encryption at rest | 4 |
| Path-token bcrypt + constant-time compare (bcrypt provides timing safety) | 5, 9 |
| Disconnect via deauthorize + row delete | 18 |
| 16 tools | 9, 10, 11, 12, 13, 14, 15 |
| Athletes / mcp_tokens / usage_log tables | 2 |
| Drizzle migrations | 2 |
| Rate-limit reading + `get_rate_limit_status` debug tool | 8, 12 |
| MSW-based unit tests + gated e2e smoke | 3, 21 |
| `feedback_env_local_override_for_tests` honored in tests/setup.ts | 3 |
| CLAUDE.md frontmatter with status/last_touched/deploy | 1 |
| README + spec + plan in docs | 20 |
| GitHub + Vercel + Neon + Strava app provisioning | 22 |

No gaps.

**Placeholder scan:** no "TBD", "TODO", "implement later", or hand-wavy "handle errors" steps. Every code step contains the full code. Commands have expected output. Two intentional fallback notes (Task 9 SDK transport import, Task 21 MSW passthrough for live smoke) — these are explicit recovery instructions, not unfinished work.

**Type consistency:**
- `mintPathToken` returns `{ token, prefix, hash }` — used consistently in Tasks 5, 9, 17.
- `getAthleteWithValidToken` returns `{ athleteId, accessToken, scope }` — used in `lib/mcp/server.ts` (Task 9).
- `stravaGet` / `stravaPost` / `stravaPut` / `stravaPostMultipart` all return `{ data, rateLimit }` — every tool destructures `{ data }` consistently.
- Cookie name `strava_mcp_session` matches across Tasks 16 and 18.
- Strava OAuth `exchangeCode` / `refreshTokens` re-export `StravaTokenResponse` (Task 6 step 4) so `athlete-repo.ts` (Task 7) can import it from `@/lib/strava/oauth`.

No issues found.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-22-strava-mcp-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `executing-plans`, batch with checkpoints.

**Which approach?**

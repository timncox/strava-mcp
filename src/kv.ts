import type { Context, Next } from 'hono';
import { Redis } from '@upstash/redis';

/**
 * The subset of Cloudflare's KVNamespace surface that upstream code actually
 * calls. Native CF KV satisfies this structurally; the Upstash adapter below
 * does too — call sites stay byte-identical between the two runtimes.
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
      let cursor = '0';
      const match = `${prefix}*`;
      do {
        const [next, batch] = (await redis.scan(cursor, { match, count: 200 })) as [
          string,
          string[],
        ];
        for (const k of batch) keys.push({ name: k });
        cursor = next;
      } while (cursor !== '0');
      return { keys };
    },
  };
}

/**
 * Hono middleware: build the Upstash-backed adapter once and attach it to
 * c.env.STRAVA_SESSIONS so all upstream call sites work unchanged on Vercel.
 * The cached client is reused across requests within the same warm instance.
 */
export function kvInjectionMiddleware() {
  let cached: KVAdapter | null = null;
  return async (c: Context, next: Next) => {
    const env = c.env as Record<string, unknown>;
    if (!env.STRAVA_SESSIONS) {
      if (!cached) {
        const url = (env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_REST_URL) as
          | string
          | undefined;
        const token = (env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN) as
          | string
          | undefined;
        if (!url || !token) {
          return c.json(
            { error: 'Upstash Redis env not configured (UPSTASH_REDIS_REST_URL / _TOKEN)' },
            500,
          );
        }
        cached = makeUpstashKVAdapter(url, token);
      }
      env.STRAVA_SESSIONS = cached;
    }
    await next();
  };
}

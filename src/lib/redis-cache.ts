import Redis from 'ioredis';
import { IS_STB } from './stb-config';

const REDIS_URL = process.env.REDIS_URL || '';

let redis: Redis | null = null;
let redisAvailable = false;

// In-memory fallback cache
const memCache = new Map<string, { value: string; expiry: number }>();

// Cleanup expired entries every 60s
const _memCacheTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memCache) {
    if (now > entry.expiry) memCache.delete(key);
  }
}, 60_000);
if (_memCacheTimer.unref) _memCacheTimer.unref();

async function initRedis() {
  if (!REDIS_URL) return;
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      ...({
        retryDelayOnFailover: 100,
        retryDelayOnClusterDown: 300,
      } as any),
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5000,
      // STB: lower memory
      ...(IS_STB ? { family: 4 } : {}),
    });
    
    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
      redisAvailable = false;
    });
    
    redis.on('ready', () => {
      console.log('[Redis] Connected');
      redisAvailable = true;
    });
    
    redis.on('close', () => {
      redisAvailable = false;
    });
    
    await redis.connect();
  } catch (err) {
    console.warn('[Redis] Unavailable, using in-memory cache fallback');
    redis = null;
    redisAvailable = false;
  }
}

// Initialize on import (non-blocking)
initRedis().catch(() => {});

export interface CacheOptions {
  ttlMs?: number; // Time to live in ms (default: 60000 = 1 min)
}

/**
 * Get a value from cache (Redis or in-memory fallback)
 */
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  try {
    if (redisAvailable && redis) {
      const raw = await redis.get(key);
      if (raw) {
        return JSON.parse(raw) as T;
      }
      return null;
    }
  } catch {
    redisAvailable = false;
  }
  
  // In-memory fallback
  const entry = memCache.get(key);
  if (entry && Date.now() < entry.expiry) {
    return JSON.parse(entry.value) as T;
  }
  if (entry) memCache.delete(key);
  return null;
}

/**
 * Set a value in cache (Redis or in-memory fallback)
 */
export async function cacheSet(key: string, value: unknown, options?: CacheOptions): Promise<void> {
  const ttlMs = options?.ttlMs ?? 60_000;
  const raw = JSON.stringify(value);
  
  try {
    if (redisAvailable && redis) {
      await redis.setex(key, Math.ceil(ttlMs / 1000), raw);
      return;
    }
  } catch {
    redisAvailable = false;
  }
  
  // In-memory fallback
  memCache.set(key, { value: raw, expiry: Date.now() + ttlMs });
}

/**
 * Delete a cache key
 */
export async function cacheDel(key: string | string[]): Promise<void> {
  const keys = Array.isArray(key) ? key : [key];
  
  try {
    if (redisAvailable && redis) {
      await redis.del(...keys);
    }
  } catch {
    redisAvailable = false;
  }
  
  for (const k of keys) memCache.delete(k);
}

/**
 * Get multiple values by pattern (Redis SCAN or in-memory filter)
 */
export async function cacheGetByPattern(pattern: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  
  try {
    if (redisAvailable && redis) {
      const stream = redis.scanStream({ match: pattern, count: 100 });
      const keys: string[] = [];
      
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (foundKeys: string[]) => keys.push(...foundKeys));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      
      if (keys.length > 0) {
        const values = await redis.mget(...keys);
        for (let i = 0; i < keys.length; i++) {
          if (values[i]) result[keys[i]] = JSON.parse(values[i]!);
        }
      }
      return result;
    }
  } catch {
    redisAvailable = false;
  }
  
  // In-memory fallback — simple prefix match
  for (const [k, entry] of memCache) {
    if (Date.now() < entry.expiry) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(k)) result[k] = JSON.parse(entry.value);
    }
  }
  
  return result;
}

/**
 * Check Redis health status
 */
export function getCacheStatus(): { redis: boolean; memEntries: number } {
  return {
    redis: redisAvailable,
    memEntries: memCache.size,
  };
}

/**
 * Invalidate cache by prefix pattern
 */
export async function cacheInvalidatePrefix(prefix: string): Promise<number> {
  let count = 0;
  
  try {
    if (redisAvailable && redis) {
      const stream = redis.scanStream({ match: `${prefix}*`, count: 100 });
      const keys: string[] = [];
      
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (foundKeys: string[]) => keys.push(...foundKeys));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      
      if (keys.length > 0) {
        count = keys.length;
        await redis.del(...keys);
      }
    }
  } catch {
    redisAvailable = false;
  }
  
  // In-memory fallback
  for (const k of memCache.keys()) {
    if (k.startsWith(prefix)) {
      memCache.delete(k);
      count++;
    }
  }
  
  return count;
}

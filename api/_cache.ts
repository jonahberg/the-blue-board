// Shared in-memory cache for API endpoints
// TTL-based with optional max-size eviction and stale-while-revalidate support

import type { CacheStoreOptions, CacheEntry } from './_types.js';

export class CacheStore<T = unknown> {
  name: string;
  maxSize: number;
  defaultTTL: number;
  private _store: Map<string, CacheEntry<T>>;

  constructor(name: string, { maxSize = 100, defaultTTL = 60_000 }: CacheStoreOptions = {}) {
    this.name = name;
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this._store = new Map();
  }

  /** Get a cached value, or null if expired/missing. */
  get(key: string): T | null {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) return null;
    return entry.value;
  }

  /** Get a cached value even if expired, within a grace window (ms). Returns null if beyond grace. */
  getStale(key: string, graceMs: number): T | null {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires + graceMs) return null;
    return entry.value;
  }

  /** Store a value with optional TTL override (ms). */
  set(key: string, value: T, ttl?: number): void {
    // Evict oldest entries if at capacity
    if (this._store.size >= this.maxSize && !this._store.has(key)) {
      const oldest = this._store.keys().next().value;
      if (oldest !== undefined) this._store.delete(oldest);
    }
    this._store.set(key, {
      value,
      expires: Date.now() + (ttl ?? this.defaultTTL),
    });
  }

  delete(key: string): void {
    this._store.delete(key);
  }

  clear(): void {
    this._store.clear();
  }

  /** Remove all expired entries. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expires) this._store.delete(key);
    }
  }

  get size(): number {
    return this._store.size;
  }
}

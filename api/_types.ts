import type { VercelRequest, VercelResponse } from '@vercel/node';
export type { VercelRequest, VercelResponse };

export interface CacheStoreOptions {
  maxSize?: number;
  defaultTTL?: number;
}

export interface CacheEntry<T = unknown> {
  value: T;
  expires: number;
}

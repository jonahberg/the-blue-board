import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const rlsSql = readFileSync(new URL('../sql/009_pro_rls.sql', import.meta.url), 'utf8');
const schemaSql = readFileSync(new URL('../sql/008_pro_v1.sql', import.meta.url), 'utf8');

describe('Pro RLS SQL guards', () => {
  it('requires active unexpired Pro subscription in user_flights and push_subscriptions policies', () => {
    expect(rlsSql).toMatch(/current_period_end\s*>\s*NOW\(\)/i);
    expect(rlsSql).toMatch(/status\s*=\s*'active'/i);
    expect(rlsSql).toMatch(/CREATE POLICY "user_flights_insert_own"[\s\S]*is_active_pro_user\(auth\.uid\(\)\)/i);
    expect(rlsSql).toMatch(/CREATE POLICY "push_subscriptions_insert_own"[\s\S]*is_active_pro_user\(auth\.uid\(\)\)/i);
  });

  it('has a database trigger enforcing the 10 tracked-flight cap', () => {
    expect(schemaSql).toMatch(/MAX_FLIGHTS_PER_USER\s+CONSTANT\s+INTEGER\s*:=\s*10/i);
    expect(schemaSql).toMatch(/CREATE TRIGGER enforce_user_flights_limit/i);
  });
});

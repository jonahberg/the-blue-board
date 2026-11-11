// A small in-memory stand-in for the supabase-js query builder, for the ops-brief tests. It supports
// exactly the chains api/_brief-store.ts, api/_feature-spend.ts and api/_radio-*.ts use: select with
// eq/gte/lte/lt/in/order/limit, insert(...).select().limit(), update(...).eq(), delete().in(), and
// rpc('increment_feature_spend'). Every call is recorded in `calls`. `failures` makes a table/op
// answer with an error: { 'ops_briefs.select': { code: '42P01', message: '...' } }.

export function fakeSupabase({ tables = {}, failures = {} } = {}) {
  const state = {};
  for (const [name, rows] of Object.entries(tables)) state[name] = rows.map((r) => ({ ...r }));
  const calls = [];
  let nextId = 1000;

  const matches = (row, filters) => filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return v === val;
    if (op === 'gte') return String(v) >= String(val);
    if (op === 'lte') return String(v) <= String(val);
    if (op === 'lt') return String(v) < String(val);
    if (op === 'in') return val.includes(v);
    return true;
  });

  function execute(q) {
    calls.push({ table: q.table, op: q.op, filters: q.filters, payload: q.payload, columns: q.columns, order: q.order, limit: q.limit });
    const failure = failures[`${q.table}.${q.op}`];
    if (failure) return { data: null, error: failure };
    const rows = (state[q.table] ||= []);
    if (q.op === 'insert') {
      const list = Array.isArray(q.payload) ? q.payload : [q.payload];
      const inserted = list.map((r) => ({ id: r.id ?? nextId++, ...r }));
      rows.push(...inserted);
      return { data: q.returning ? inserted : null, error: null };
    }
    if (q.op === 'update') {
      const hit = rows.filter((r) => matches(r, q.filters));
      for (const r of hit) Object.assign(r, q.payload);
      return { data: null, error: null };
    }
    if (q.op === 'upsert') {
      const list = Array.isArray(q.payload) ? q.payload : [q.payload];
      for (const r of list) rows.push({ id: r.id ?? nextId++, ...r });
      return { data: null, error: null };
    }
    if (q.op === 'delete') {
      const keep = rows.filter((r) => !matches(r, q.filters));
      const removed = rows.length - keep.length;
      state[q.table] = keep;
      return { data: null, error: null, count: removed };
    }
    let out = rows.filter((r) => matches(r, q.filters));
    if (q.order) {
      const { col, ascending } = q.order;
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (ascending ? 1 : -1));
    }
    if (q.limit != null) out = out.slice(0, q.limit);
    return { data: out.map((r) => ({ ...r })), error: null };
  }

  function from(table) {
    const q = { table, op: 'select', filters: [], order: null, limit: null, payload: null, columns: '*', returning: false };
    const api = {
      select(cols) { if (q.op === 'insert' || q.op === 'update') q.returning = true; else q.op = 'select'; q.columns = cols; return api; },
      insert(payload) { q.op = 'insert'; q.payload = payload; return api; },
      upsert(payload) { q.op = 'upsert'; q.payload = payload; return api; },
      update(payload) { q.op = 'update'; q.payload = payload; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(col, val) { q.filters.push(['eq', col, val]); return api; },
      gte(col, val) { q.filters.push(['gte', col, val]); return api; },
      lte(col, val) { q.filters.push(['lte', col, val]); return api; },
      lt(col, val) { q.filters.push(['lt', col, val]); return api; },
      in(col, vals) { q.filters.push(['in', col, vals]); return api; },
      order(col, opts = {}) { q.order = { col, ascending: opts.ascending !== false }; return api; },
      limit(n) { q.limit = n; return api; },
      then(resolve, reject) { return Promise.resolve().then(() => execute(q)).then(resolve, reject); },
    };
    return api;
  }

  async function rpc(name, args) {
    calls.push({ rpc: name, args });
    const failure = failures[`rpc.${name}`];
    if (failure) return { data: null, error: failure };
    if (name === 'increment_feature_spend') {
      const rows = (state.feature_spend_daily ||= []);
      let row = rows.find((r) => r.feature === args.p_feature && r.day === args.p_day);
      if (!row) { row = { feature: args.p_feature, day: args.p_day, usd: 0, calls: 0, input_tokens: 0, output_tokens: 0 }; rows.push(row); }
      row.usd = Math.round((Number(row.usd) + Math.max(0, Number(args.p_usd) || 0)) * 1e6) / 1e6;
      row.calls += Math.max(0, args.p_calls || 0);
      row.input_tokens += Math.max(0, args.p_input_tokens || 0);
      row.output_tokens += Math.max(0, args.p_output_tokens || 0);
      return { data: row.usd, error: null };
    }
    return { data: null, error: { code: 'PGRST202', message: `function ${name} not found` } };
  }

  return { client: { from, rpc }, state, calls };
}

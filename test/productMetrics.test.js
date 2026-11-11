
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/productMetrics');
const { PATTERNS } = require('../lib/internal');

const ENV = { LAUNCH_DATE: '2026-10-01', POSTHOG_HOST: 'https://ph.example/', POSTHOG_PROJECT_ID: '42', POSTHOG_API_KEY: 'key' };
const ALL = { $identify: 5, signed_in: 9, project_created: 3, credits_consumed: 4, subscription_started: 2, subscription_cancelled: 1 };
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const sqlOf = (init) => JSON.parse(init.body).query.query;

function answer(sql, inventory = ALL) {
  if (/inventory_n/.test(sql)) return reply(200, { results: Object.entries(inventory) });
  if (/signin_days/.test(sql)) return reply(200, { results: [['2026-11-01', '2026-11-02', ['2026-11-05'], 0], ['2026-11-03', '1970-01-01', ['2026-11-06'], 1]] });
  if (/first_credit/.test(sql)) return reply(200, { results: [['2026-11-01', '2026-11-03', 0]] });
  if (/\bAS credits\b/.test(sql)) return reply(200, { results: [['2026-11-03', 0, 12.5, 0]] });
  if (/\bAS projects\b/.test(sql)) return reply(200, { results: [['2026-11-02', 0, 2]] });
  if (/\bAS starts\b/.test(sql)) return reply(200, { results: [[['2026-11-01'], ['2026-11-05'], 0]] });
  return reply(500, { error: 'unexpected query' });
}
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const sql = sqlOf(init);
    calls.push({ url, sql, auth: init.headers.Authorization });
    return handler ? handler(sql, calls) : answer(sql);
  };
  return { fn, calls };
}
const reader = (fetch, extra = {}) => M.createReader({ env: ENV, fetch, yesterday: () => '2026-11-09', ...extra });

test('rejects invalid cutoffs and a missing PostHog configuration without calling PostHog', async () => {
  const f = fakeFetch();
  const r = reader(f.fn);
  for (const c of ['2026-11-1', '2026-02-30', '2026-09-30', '2026-11-10', 'x']) {
    await assert.rejects(r.metrics(c), (e) => e.status === 400, c);
  }
  const bare = M.createReader({ env: { LAUNCH_DATE: '2026-10-01' }, fetch: f.fn, yesterday: () => '2026-11-09' });
  await assert.rejects(bare.metrics('2026-11-09'), (e) => e.status === 409);
  assert.equal(f.calls.length, 0);
});

test('default cutoff is yesterday; queries use Bogota days, the cutoff, internal patterns and no person ids', async () => {
  const f = fakeFetch();
  const out = await reader(f.fn).metrics();
  assert.equal(out.cutoff, '2026-11-09');
  assert.equal(f.calls[0].url, 'https://ph.example/api/projects/42/query/');
  assert.equal(f.calls[0].auth, 'Bearer key');
  for (const c of f.calls) {
    assert.match(c.sql, /America\/Bogota/);
    assert.match(c.sql, /toDate\('2026-11-09'\)/);
    assert.doesNotMatch(c.sql, /SELECT person_id/);
    assert.doesNotMatch(c.sql, /person\.properties\.email\)\s+AS/);
  }
  for (const c of f.calls.slice(1)) assert.ok(PATTERNS.every((p) => c.sql.includes(p)), 'internal rule embedded');
  assert.deepEqual(out.accounts, [
    { created: '2026-11-01', first_project: '2026-11-02', signin_days: ['2026-11-05'], internal: false },
    { created: '2026-11-03', first_project: null, signin_days: ['2026-11-06'], internal: true },
  ]);
  assert.deepEqual(out.projectDays, [{ date: '2026-11-02', internal: false, projects: 2 }]);
  assert.equal(out.credits.days[0].credits, 12.5);
  assert.deepEqual(out.credits.people, [{ created: '2026-11-01', first_credit: '2026-11-03', internal: false }]);
  assert.deepEqual(out.subscriptions, [{ starts: ['2026-11-01'], cancels: ['2026-11-05'], internal: false }]);
  assert.equal(out.events.credits_consumed.available, true);
});

test('a missing event is waiting (null), never zero, and its query is not run', async () => {
  const f = fakeFetch((sql) => answer(sql, { $identify: 5, signed_in: 9 }));
  const out = await reader(f.fn).metrics('2026-11-09');
  assert.equal(out.events.project_created.available, false);
  assert.equal(out.events.project_created.count, 0);
  assert.equal(out.projectDays, null);
  assert.equal(out.credits, null);
  assert.equal(out.subscriptions, null);
  assert.equal(f.calls.length, 2, 'inventory + accounts only');
  assert.ok(Array.isArray(out.accounts));
});

test('cached for 30 minutes per cutoff; simultaneous requests share one load', async () => {
  let t = 1_000_000;
  const f = fakeFetch();
  const r = reader(f.fn, { now: () => t });
  const inventories = () => f.calls.filter((c) => /inventory_n/.test(c.sql)).length;
  const [a, b] = await Promise.all([r.metrics('2026-11-09'), r.metrics('2026-11-09')]);
  assert.equal(a.cached, false);
  assert.equal(b, a);
  assert.equal(inventories(), 1);
  assert.equal((await r.metrics('2026-11-09')).cached, true);
  assert.equal(inventories(), 1);
  await r.metrics('2026-11-08');
  assert.equal(inventories(), 2);
  t += 31 * 60 * 1000;
  await r.metrics('2026-11-09');
  assert.equal(inventories(), 3, 'expired cache asks PostHog again');
});

test('at most maxConcurrent loads hit PostHog at once', async () => {
  let active = 0, peak = 0;
  const fn = async (url, init) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active--;
    return answer(sqlOf(init));
  };
  const r = M.createReader({ env: ENV, fetch: fn, yesterday: () => '2026-11-09', maxConcurrent: 1 });
  await Promise.all(['2026-11-07', '2026-11-08', '2026-11-09'].map((c) => r.metrics(c)));
  assert.equal(peak, 1);
});

test('an inventory failure is a 502 and is not cached; an optional section failure is a warning', async () => {
  let failInventory = true;
  const f = fakeFetch((sql) => {
    if (/inventory_n/.test(sql) && failInventory) return reply(500, { error: 'boom' });
    if (/\bAS projects\b/.test(sql)) return reply(500, { error: 'timeout' });
    return answer(sql);
  });
  const r = reader(f.fn);
  await assert.rejects(r.metrics('2026-11-09'), (e) => e.status === 502);
  failInventory = false;
  const out = await r.metrics('2026-11-09');
  assert.equal(out.projectDays, null, 'failed section stays null, not zero');
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /^projects:/);
  assert.ok(Array.isArray(out.accounts));
});

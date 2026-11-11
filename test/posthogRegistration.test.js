'use strict';
// PostHog registration_started report: one row per person, and a timeout keeps the last good
// result (marked stale) instead of erasing it on ingest.
const test = require('node:test');
const assert = require('node:assert/strict');

// Fake store injected before lib/connectors requires it lazily on the failure path.
const fakeStore = { snapshots: [], metrics: [], async list(kind) { return kind === 'snapshot' ? this.snapshots : kind === 'metric' ? this.metrics : []; } };
const storePath = require.resolve('../lib/store');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

const date = '2026-10-20';
const response = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
const timeout = { ok: false, status: 504, text: async () => '{"type":"server_error","code":"error","detail":"Query has hit the max execution time before completing."}' };

function env(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}
const POSTHOG = { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test', POSTHOG_PROJECT_CREATED_ENABLED: '0' };

function mockPosthog(t, onRegistration) {
  const queries = [];
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    const sql = JSON.parse(opts.body).query.query;
    if (sql.includes("event = 'registration_started'")) { queries.push(sql); return onRegistration(); }
    return response({ results: [] });
  });
  return queries;
}

test('registration_started groups by person only and takes type and country from the first event', async (t) => {
  env(t, POSTHOG);
  fakeStore.snapshots = []; fakeStore.metrics = [];
  const { connectors } = require('../lib/connectors');
  const queries = mockPosthog(t, () => response({ results: [[date, 'External', 'Colombia', 28], [date, 'Internal', 'Colombia', 6]] }));
  const load = await connectors.posthog();
  const sql = queries[0];
  assert.ok(sql, 'registration query should run');
  assert.match(sql, /GROUP BY person_id\) GROUP BY d, account_type, country/);
  assert.doesNotMatch(sql, /GROUP BY person_id, account_type/);
  assert.equal((sql.match(/argMin\(/g) || []).length, 2);
  assert.equal((sql.match(/tuple\(timestamp, uuid\)/g) || []).length, 2);
  assert.match(sql, /qa_probe/);
  assert.match(sql, /\{filters\}/);
  assert.deepEqual(load.metrics.find((r) => r.metric === 'ph_signups' && r.dim_value === 'External'), { metric: 'ph_signups', date, dim: 'account_type', dim_value: 'External', value: 28 });
  assert.equal(load.metrics.find((r) => r.metric === 'ph_signups_geo').value, 28);
  assert.equal(load.metrics.find((r) => r.metric === 'ph_signups_geo_internal').value, 6);
  const coverage = load.snapshots.find((s) => s.key === 'registration_coverage').rows[0];
  assert.equal(coverage.available, true);
  assert.equal(coverage.stale, undefined);
});

test('a PostHog 504 keeps the last good registration rows, marked stale', async (t) => {
  env(t, POSTHOG);
  fakeStore.snapshots = [{ source: 'posthog', key: 'registration_coverage', from: '2026-10-01', to: '2026-11-08', pulled_at: '2026-11-08T12:00:00.000Z',
    rows: [{ available: true, event: 'registration_started', unit: 'person', country_available: true }] }];
  fakeStore.metrics = [
    { source: 'posthog', metric: 'ph_signups', date, dim: 'account_type', dim_value: 'External', value: 28, _k: 'x1' },
    { source: 'posthog', metric: 'ph_signups_geo', date, dim: 'country', dim_value: 'Colombia', value: 20, _k: 'x2' },
    { source: 'posthog', metric: 'ph_signups_geo_internal', date, dim: 'country', dim_value: 'Colombia', value: 6, _k: 'x3' },
    { source: 'posthog', metric: 'ph_accounts', date, dim: 'account_type', dim_value: 'External', value: 99, _k: 'x4' },
    { source: 'ga4', metric: 'ph_signups', date, dim: '', dim_value: '', value: 1, _k: 'x5' },
  ];
  const { connectors } = require('../lib/connectors');
  mockPosthog(t, () => timeout);
  const load = await connectors.posthog();
  const signups = load.metrics.filter((r) => r.metric.startsWith('ph_signups'));
  assert.equal(signups.length, 3);
  assert.deepEqual(signups.find((r) => r.metric === 'ph_signups'), { metric: 'ph_signups', date, dim: 'account_type', dim_value: 'External', value: 28 });
  assert.equal(load.metrics.some((r) => r.metric === 'ph_accounts' && r.value === 99), false, 'only registration rows are re-emitted');
  const coverage = load.snapshots.find((s) => s.key === 'registration_coverage').rows[0];
  assert.equal(coverage.available, true);
  assert.equal(coverage.stale, true);
  assert.equal(coverage.last_good_pulled_at, '2026-11-08T12:00:00.000Z');
  assert.match(coverage.stale_reason, /504/);
});

test('a repeated failure keeps the original last good pull time', async (t) => {
  env(t, POSTHOG);
  fakeStore.snapshots = [{ source: 'posthog', key: 'registration_coverage', from: '2026-10-01', to: '2026-11-09', pulled_at: '2026-11-09T12:00:00.000Z',
    rows: [{ available: true, event: 'registration_started', unit: 'person', country_available: true, stale: true, last_good_pulled_at: '2026-11-08T12:00:00.000Z' }] }];
  fakeStore.metrics = [{ source: 'posthog', metric: 'ph_signups', date, dim: 'account_type', dim_value: 'External', value: 28 }];
  const { connectors } = require('../lib/connectors');
  mockPosthog(t, () => timeout);
  const load = await connectors.posthog();
  const coverage = load.snapshots.find((s) => s.key === 'registration_coverage').rows[0];
  assert.equal(coverage.last_good_pulled_at, '2026-11-08T12:00:00.000Z');
});

test('with no previous good result a timeout stays unavailable and invents nothing', async (t) => {
  env(t, POSTHOG);
  const { connectors } = require('../lib/connectors');
  mockPosthog(t, () => timeout);
  for (const snapshots of [[], [{ source: 'posthog', key: 'registration_coverage', from: '2026-10-01', to: '2026-11-08', rows: [{ available: false }] }]]) {
    fakeStore.snapshots = snapshots;
    fakeStore.metrics = [{ source: 'posthog', metric: 'ph_signups', date, dim: 'account_type', dim_value: 'External', value: 5 }];
    const load = await connectors.posthog();
    assert.equal(load.metrics.some((r) => r.metric.startsWith('ph_signups')), false);
    const coverage = load.snapshots.find((s) => s.key === 'registration_coverage').rows[0];
    assert.equal(coverage.available, false);
    assert.equal(coverage.stale, undefined);
  }
});

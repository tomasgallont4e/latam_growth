'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, monthOk } = require('../lib/executive');

const UNSPLIT = 'Not split by country';

function storeWithMetrics(metrics, snapshots = []) {
  const rows = {
    metric: metrics,
    event: [],
    snapshot: snapshots,
    goal_plan: [{ _k: 'latam', countries: {} }],
  };
  return {
    list: async (kind) => rows[kind] || [],
    upsert: async (kind, key, data) => {
      rows[kind] = rows[kind] || [];
      rows[kind].push({ _k: key, ...data });
    },
  };
}

test('Executive new accounts use the dedicated external first-identify country series', async () => {
  const data = await build(storeWithMetrics([
    { source: 'posthog', metric: 'ph_new_persons', date: '2026-10-02', dim: 'account_type', dim_value: 'External', value: 99 },
    { source: 'posthog', metric: 'ph_accounts', date: '2026-10-02', dim: 'account_type', dim_value: 'External', value: 88 },
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-10-02', dim: 'account_type', dim_value: 'External', value: 3 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-10-02', dim: 'country', dim_value: 'Colombia', value: 2 },
  ], [{ source: 'posthog', key: 'executive_accounts', from: '2026-10-01', to: '2026-10-30', rows: [{
    available: true, country_available: true, external_accounts: 3, country_assigned: 2, country_missing: 1,
    excluded_host_accounts: 3, excluded_hosts: [{ host: 'cell-ssm-use1-0006.us.portal.think4ever.com', external_accounts: 3 }],
  }] }]));
  const day = data.days.indexOf('2026-10-02');
  assert.equal(data.series.platform_signups.Colombia[day], 2);
  assert.equal(data.series.platform_signups[UNSPLIT][day], 1);
  const metric = data.metrics.find((item) => item.id === 'platform_signups');
  assert.equal(metric.status, 'pending');
  assert.match(metric.reason, /unclassified.*host/i);
  assert.match(metric.definition, /first.*identify/i);
});

test('Executive landing sessions use the go-only GA4 country series, not broad GA4 or HubSpot totals', async () => {
  const data = await build(storeWithMetrics([
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-10-02', dim: 'country', dim_value: 'Colombia', value: 20 },
    { source: 'ga4', metric: 'ga_geo_sessions', date: '2026-10-02', dim: 'country', dim_value: 'Brazil', value: 900 },
    { source: 'hubspot', metric: 'sessions', date: '2026-10-02', value: 1200 },
  ]));
  const day = data.days.indexOf('2026-10-02');
  assert.equal(data.series.landing_sessions.Colombia[day], 20);
  assert.equal(data.series.landing_sessions.Brazil[day], 0);
  assert.equal(data.series.landing_sessions[UNSPLIT][day], 0);
  assert.equal(data.metrics.find((metric) => metric.id === 'landing_sessions').source, 'Google Analytics 4 · go.think4ever.com');
});

test('Executive go-host sessions distinguish successful zero from unavailable coverage', async () => {
  const broadOnly = await build(storeWithMetrics([
    { source: 'ga4', metric: 'ga_geo_sessions', date: '2026-10-02', dim: 'country', dim_value: 'Colombia', value: 200 },
    { source: 'hubspot', metric: 'sessions', date: '2026-10-02', value: 500 },
  ]));
  assert.match(broadOnly.metrics.find((metric) => metric.id === 'landing_sessions').noData, /Google Analytics 4/);

  const failed = await build(storeWithMetrics([], [
    { source: 'ga4', key: 'executive_landing', from: '2026-10-01', to: '2026-10-30', rows: [{ available: false, host: 'go.think4ever.com' }] },
  ]));
  assert.match(failed.metrics.find((metric) => metric.id === 'landing_sessions').noData, /Google Analytics 4/);

  const measuredZero = await build(storeWithMetrics([], [
    { source: 'ga4', key: 'executive_landing', from: '2026-10-01', to: '2026-10-30', rows: [{ available: true, host: 'go.think4ever.com', country_available: false }] },
  ]));
  assert.equal(measuredZero.metrics.find((metric) => metric.id === 'landing_sessions').noData, undefined);
});

test('Executive account zero requires successful account coverage', async () => {
  const missing = await build(storeWithMetrics([
    { source: 'posthog', metric: 'ph_new_persons', date: '2026-10-02', dim: 'account_type', dim_value: 'External', value: 11 },
  ]));
  assert.match(missing.metrics.find((metric) => metric.id === 'platform_signups').noData, /PostHog/);

  const measuredZero = await build(storeWithMetrics([], [
    { source: 'posthog', key: 'executive_accounts', from: '2026-10-01', to: '2026-10-30', rows: [{ available: true, country_available: false, external_accounts: 0, country_assigned: 0, country_missing: 0, excluded_host_accounts: 0 }] },
  ]));
  assert.equal(measuredZero.metrics.find((metric) => metric.id === 'platform_signups').noData, undefined);
});

test('Executive month validation rejects malformed calendar months', () => {
  assert.equal(monthOk('2026-10'), true);
  assert.equal(monthOk('2026-01'), true);
  for (const month of ['', '2026-1', '2026-00', '2026-13', '2026-10-01', '2026-10,2026-11', 'not-a-month']) assert.equal(monthOk(month), false);
});

test('Executive month response clamps to last full Bogota day and keeps since-launch accounts', async () => {
  const rows = [
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-10-02', dim: 'account_type', dim_value: 'External', value: 2 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-10-02', dim: 'country', dim_value: 'Colombia', value: 2 },
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-10-30', dim: 'account_type', dim_value: 'External', value: 7 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-10-30', dim: 'country', dim_value: 'Colombia', value: 7 },
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-11-01', dim: 'account_type', dim_value: 'External', value: 9 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-11-01', dim: 'country', dim_value: 'Colombia', value: 9 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-10-02', dim: 'country', dim_value: 'Colombia', value: 50 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-10-30', dim: 'country', dim_value: 'Colombia', value: 70 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-11-01', dim: 'country', dim_value: 'Colombia', value: 90 },
  ];
  const snapshots = [
    { source: 'posthog', key: 'executive_accounts', from: '2026-10-01', to: '2026-11-01', rows: [{ available: true, country_available: true, external_accounts: 18, country_assigned: 18, country_missing: 0, excluded_host_accounts: 0 }] },
    { source: 'ga4', key: 'executive_landing', from: '2026-10-01', to: '2026-11-01', rows: [{ available: true, country_available: true }] },
  ];
  const data = await build(storeWithMetrics(rows, snapshots), '2026-10', new Date('2026-10-30T17:00:00.000Z'));
  assert.equal(data.month, '2026-10');
  assert.equal(data.cutoff, '2026-10-29');
  assert.equal(data.days[0], '2026-10-01');
  assert.equal(data.days.at(-1), '2026-10-29');
  assert.equal(data.days.length, 29);
  assert.equal(data.series.platform_signups.Colombia[data.days.indexOf('2026-10-02')], 2);
  assert.equal(data.series.landing_sessions.Colombia[data.days.indexOf('2026-10-02')], 50);
  assert.equal(data.monthTotals.platform_signups, 2);
  assert.equal(data.sinceLaunch.platform_signups, 2);
});

test('Executive month response marks uncovered start-of-month days as unknown, not zero', async () => {
  const rows = [
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-10-16', dim: 'account_type', dim_value: 'External', value: 2 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-10-16', dim: 'country', dim_value: 'Colombia', value: 2 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-10-16', dim: 'country', dim_value: 'Colombia', value: 30 },
  ];
  const snapshots = [
    { source: 'posthog', key: 'executive_accounts', from: '2026-10-15', to: '2026-10-30', rows: [{ available: true, country_available: true, external_accounts: 2, country_assigned: 2, country_missing: 0, excluded_host_accounts: 0 }] },
    { source: 'ga4', key: 'executive_landing', from: '2026-10-15', to: '2026-10-30', rows: [{ available: true, country_available: true }] },
  ];
  const data = await build(storeWithMetrics(rows, snapshots), '2026-10', new Date('2026-10-30T17:00:00.000Z'));
  const beforeCoverage = data.days.indexOf('2026-10-02');
  assert.equal(data.series.platform_signups[UNSPLIT][beforeCoverage], null);
  assert.equal(data.series.landing_sessions.Colombia[beforeCoverage], null);
  assert.equal(data.monthTotals.platform_signups, null);
  assert.equal(data.monthTotals.landing_sessions, null);
  assert.equal(data.metrics.find((metric) => metric.id === 'platform_signups').status, 'pending');
  assert.equal(data.metrics.find((metric) => metric.id === 'landing_sessions').status, 'pending');
});

test('Executive month totals remain unavailable when successful snapshots lack valid date bounds', async () => {
  const snapshots = [
    { source: 'posthog', key: 'executive_accounts', from: '2026-10-01', to: 'invalid', rows: [{ available: true, country_available: false, external_accounts: 0 }] },
    { source: 'ga4', key: 'executive_landing', from: '2026-10-01', rows: [{ available: true, country_available: false }] },
  ];
  const data = await build(storeWithMetrics([], snapshots), '2026-10', new Date('2026-10-30T17:00:00.000Z'));
  assert.equal(data.cutoff, null);
  assert.equal(data.monthTotals.platform_signups, null);
  assert.equal(data.monthTotals.landing_sessions, null);
  assert.equal(data.metrics.find((metric) => metric.id === 'platform_signups').status, 'pending');
  assert.equal(data.metrics.find((metric) => metric.id === 'landing_sessions').status, 'pending');
});

test('Executive monthly response has no cutoff when neither required source has successful coverage', async () => {
  const data = await build(storeWithMetrics([], []), '2026-10', new Date('2026-10-30T17:00:00.000Z'));
  assert.equal(data.cutoff, null);
  assert.deepEqual(data.days, []);
  assert.equal(data.monthTotals.platform_signups, null);
  assert.equal(data.monthTotals.landing_sessions, null);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, monthOk } = require('../lib/executive');

const UNSPLIT = 'Not split by country';

function storeWithMetrics(metrics, snapshots = [], extra = {}) {
  const rows = {
    metric: metrics,
    event: [],
    snapshot: snapshots,
    goal_plan: [{ _k: 'latam', countries: {} }],
    ...extra,
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
  assert.equal(metric.status, 'loaded');
  assert.equal(metric.underReview.label, 'Under review');
  assert.match(metric.underReview.reason, /hosts were excluded/i);
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

test('Executive response exposes covered approved-host accounts separately from unavailable subscription type', async () => {
  const data = await build(storeWithMetrics([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-10-02', dim: 'account_type', dim_value: 'External', value: 3 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-10-02', dim: 'country', dim_value: 'Colombia', value: 2 },
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-10-20', dim: 'account_type', dim_value: 'External', value: 4 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-10-20', dim: 'country', dim_value: 'Brazil', value: 1 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-10-20', dim: 'country', dim_value: 'Colombia', value: 1 },
  ], [
    { source: 'posthog', key: 'executive_accounts', from: '2026-10-01', to: '2026-10-28', rows: [{ available: true, country_available: true, external_accounts: 7, country_assigned: 3, country_missing: 4, excluded_host_accounts: 2 }] },
    { source: 'ga4', key: 'executive_landing', from: '2026-10-01', to: '2026-10-28', rows: [{ available: true, country_available: true }] },
  ]), '2026-10', new Date('2026-10-29T17:00:00.000Z'));
  assert.deepEqual(data.executiveAccounts, {
    month: 7,
    sinceLaunch: 7,
    byCountry: { Colombia: 2, Brazil: 1 },
    country_assigned: 3,
    country_missing: 4,
    excludedHosts: 2,
    byPlan: { status: 'pending', free: null, paid: null, reason: 'No account subscription-plan report is configured.' },
  });
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
  assert.equal(data.view.cards.signups.status, 'pending');
  assert.equal(data.view.cards.signups.value, null);
});

function coveredMonth(metrics, extra = {}) {
  const snapshots = [
    { source: 'posthog', key: 'executive_accounts', from: '2026-10-01', to: '2026-11-30', pulled_at: '2026-11-02T11:00:00.000Z', rows: [{ available: true, country_available: true, external_accounts: 1, country_assigned: 1, country_missing: 0, excluded_host_accounts: 0 }] },
    { source: 'ga4', key: 'executive_landing', from: '2026-10-01', to: '2026-11-30', pulled_at: '2026-11-02T11:05:00.000Z', rows: [{ available: true, country_available: true, form_start_available: true }] },
  ];
  return storeWithMetrics(metrics, snapshots, extra);
}

test('Executive shows allowlisted sign-ups and known spend with honest review states', async () => {
  const store = coveredMonth([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-11-02', dim: 'account_type', dim_value: 'External', value: 5 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 5 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 335 },
    { source: 'ga4', metric: 'ga_exec_form_starts', date: '2026-11-02', value: 3 },
    { source: 'meta', metric: 'ad_spend', date: '2026-11-02', dim: 'campaign', dim_value: 'Boost', value: 20.27 },
  ], { source: [{ _k: 'google_ads', state: 'connected', window: '2026-10-01 to 2026-11-30' }] });
  const posthogSnapshot = (await store.list('snapshot')).find((row) => row.key === 'executive_accounts');
  posthogSnapshot.rows[0].excluded_host_accounts = 4;
  const data = await build(store, '2026-11', new Date('2026-11-04T17:00:00.000Z'));
  assert.equal(data.view.cards.signups.status, 'loaded');
  assert.equal(data.view.cards.signups.value, 5);
  assert.equal(data.view.cards.signups.pace, null);
  assert.equal(data.view.cards.signups.projection, null);
  assert.equal(data.view.cards.signups.underReview.label, 'Under review');
  assert.match(data.view.cards.signups.lines.join(' '), /Under review: Unclassified first-identify hosts are excluded/);
  assert.equal(data.view.cards.sinceLaunch.status, 'loaded');
  assert.equal(data.view.cards.sinceLaunch.value, 5);
  assert.equal(data.view.cards.sinceLaunch.underReview.label, 'Under review');
  assert.match(data.view.cards.sinceLaunch.lines.join(' '), /Under review: Unclassified first-identify hosts are excluded/);
  assert.equal(data.view.cards.spend.status, 'loaded');
  assert.equal(data.view.cards.spend.value, 20.27);
  assert.equal(data.view.cards.spend.complete, false);
  assert.equal(data.view.cards.spend.underReview.label, 'Under review');
  assert.match(data.view.cards.spend.underReview.reason, /LinkedIn paid reporting is not connected/);
  assert.equal(data.view.cards.cps.status, 'pending');
  assert.match(data.view.cards.cps.reason, /spend incomplete/);
  assert.equal(data.view.cards.visit.status, 'pending');
  assert.equal(data.view.cards.visit.underReview.label, 'Under review');
  assert.match(data.view.cards.visit.reason, /Unclassified first-identify hosts are excluded/);
  assert.equal(data.view.chart.certified, true);
  assert.match(data.view.chart.note, /Under review: Unclassified first-identify hosts are excluded/);
  assert.equal(data.view.chart.days.some((day) => day.signups != null), true);
  assert.equal(data.view.chart.days.some((day) => day.projected != null), false);
});

test('Executive preserves a reconciliation review reason without claiming host exclusions', async () => {
  const metrics = [];
  for (let day = 1; day <= 3; day += 1) {
    const date = `2026-11-0${day}`;
    metrics.push(
      { source: 'posthog', metric: 'ph_exec_accounts', date, dim: 'account_type', dim_value: 'External', value: day },
      { source: 'posthog', metric: 'ph_exec_accounts_geo', date, dim: 'country', dim_value: 'Colombia', value: day },
      { source: 'ga4', metric: 'ga_exec_geo_sessions', date, dim: 'country', dim_value: 'Colombia', value: 100 },
      { source: 'ga4', metric: 'ga_exec_form_starts', date, value: 1 },
    );
  }
  const data = await build(coveredMonth(metrics, {
    note: [{ _k: 'exec_flag|signups', label: 'Awaiting reconciliation from Finance.' }],
  }), '2026-11', new Date('2026-11-04T17:00:00.000Z'));
  assert.equal(data.view.cards.signups.value, 6);
  assert.equal(data.view.cards.signups.underReview.label, 'Under review');
  assert.match(data.view.cards.signups.underReview.reason, /Awaiting reconciliation from Finance/);
  assert.doesNotMatch(data.view.cards.signups.underReview.reason, /host/i);
  assert.equal(data.view.cards.signups.pace, null);
  assert.equal(data.view.cards.signups.projection, null);
  assert.equal(data.view.cards.visit.underReview.label, 'Under review');
  assert.match(data.view.cards.visit.reason, /Awaiting reconciliation from Finance/);
  assert.ok(data.view.changed.phrases.join(' ').includes('Awaiting reconciliation from Finance'));
  assert.doesNotMatch(data.view.changed.phrases.join(' '), /sign-ups: .*from .* to/);
});

test('Executive shows approved-host sign-ups when other hosts were excluded', async () => {
  const store = coveredMonth([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-11-02', dim: 'account_type', dim_value: 'External', value: 5 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 5 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 335 },
    { source: 'ga4', metric: 'ga_exec_form_starts', date: '2026-11-02', value: 3 },
  ]);
  const snapshot = (await store.list('snapshot')).find((row) => row.key === 'executive_accounts');
  Object.assign(snapshot.rows[0], { external_accounts: 5, country_assigned: 5, excluded_host_accounts: 4 });
  const data = await build(store, '2026-11', new Date('2026-11-04T17:00:00.000Z'));
  assert.equal(data.view.cards.signups.status, 'loaded');
  assert.equal(data.view.cards.signups.value, 5);
  assert.equal(data.view.cards.signups.underReview.label, 'Under review');
  assert.equal(data.view.cards.sinceLaunch.value, 5);
  assert.equal(data.view.cards.sinceLaunch.status, 'loaded');
  assert.equal(data.view.cards.sinceLaunch.underReview.label, 'Under review');
  assert.equal(data.view.chart.certified, true);
  assert.match(data.view.chart.note, /Under review: Unclassified first-identify hosts are excluded/);
});

test('Executive cost per sign-up stays pending until every paid channel has reported', async () => {
  const partialWithSignups = await build(coveredMonth([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-11-02', dim: 'account_type', dim_value: 'External', value: 5 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 5 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 335 },
    { source: 'ga4', metric: 'ga_exec_form_starts', date: '2026-11-02', value: 3 },
    { source: 'meta', metric: 'ad_spend', date: '2026-11-02', dim: 'campaign', dim_value: 'Boost', value: 20.27 },
  ], { source: [{ _k: 'google_ads', state: 'connected', window: '2026-10-01 to 2026-11-30' }] }), '2026-11', new Date('2026-11-04T17:00:00.000Z'));
  assert.equal(partialWithSignups.view.cards.spend.value, 20.27);
  assert.equal(partialWithSignups.view.cards.spend.complete, false);
  assert.equal(partialWithSignups.view.cards.cps.status, 'pending');
  assert.equal(partialWithSignups.view.cards.cps.value, null);

  const partialWithZeroSignups = await build(coveredMonth([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-10-04', dim: 'account_type', dim_value: 'External', value: 0 },
    { source: 'meta', metric: 'ad_spend', date: '2026-10-04', dim: 'campaign', dim_value: 'Boost', value: 12.5 },
  ], { source: [{ _k: 'google_ads', state: 'connected', window: '2026-10-01 to 2026-10-30' }] }), '2026-10', new Date('2026-10-30T17:00:00.000Z'));
  assert.equal(partialWithZeroSignups.view.cards.cps.status, 'pending');
  assert.equal(partialWithZeroSignups.view.cards.cps.value, null);
});

test('Executive month sign-ups keep outside LATAM off the goal number and October has no goal', async () => {
  const data = await build(coveredMonth([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-10-02', dim: 'account_type', dim_value: 'External', value: 8 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-10-02', dim: 'country', dim_value: 'Colombia', value: 2 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-10-02', dim: 'country', dim_value: 'United States', value: 5 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-10-02', dim: 'country', dim_value: 'Colombia', value: 40 },
    { source: 'ga4', metric: 'ga_event', date: '2026-10-02', dim: 'event', dim_value: 'form_start', value: 999 },
    { source: 'ga4', metric: 'ga_exec_form_starts', date: '2026-10-02', value: 4 },
  ], { target: [{ month: '2026-10', country: 'LATAM', metric_key: 'platform_signups', target_value: 50000, proposal: true }] }), '2026-10', new Date('2026-10-30T17:00:00.000Z'));
  assert.equal(data.monthTotals.platform_signups, 8);
  assert.equal(data.view.cards.signups.value, 3);
  assert.equal(data.view.cards.signups.outside, 5);
  assert.equal(data.view.cards.signups.goal, null);
  assert.equal(data.view.cards.signups.pace, null);
  assert.equal(data.view.cards.sinceLaunch.value, 8);
  assert.equal(data.view.cards.sinceLaunch.latam, 3);
  assert.equal(data.view.cards.sinceLaunch.outside, 5);
  assert.equal(data.view.funnel.steps.find((step) => step.id === 'form_start').value, 4);
  assert.equal(data.view.funnel.steps.find((step) => step.id === 'impressions').status, 'pending');
  assert.match(data.view.chart.note, /No goal for October 2026/);
  assert.equal(data.view.countries.rows[0].country, 'United States');
  assert.equal(data.view.countries.rows.some((row) => row.country === 'United States'), true);
  assert.ok(data.view.changed.phrases[0].startsWith('External sign-ups:'));
  assert.match(data.view.changed.phrases.join(' '), /Ad spend not compared: Meta ad account access pending/);
});

test('Executive keeps Meta spend pending when only impressions were delivered', async () => {
  const data = await build(coveredMonth([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-11-02', dim: 'account_type', dim_value: 'External', value: 5 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 5 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 335 },
    { source: 'meta', metric: 'ad_impressions', date: '2026-11-02', value: 1000 },
  ], { source: [{ _k: 'google_ads', state: 'connected', window: '2026-10-01 to 2026-11-30' }] }), '2026-11', new Date('2026-11-04T17:00:00.000Z'));
  assert.equal(data.view.channels.meta.status, 'pending');
  assert.equal(data.view.channels.meta.spend, null);
  assert.equal(data.view.cards.spend.value, null);
  assert.equal(data.view.cards.spend.status, 'pending');
  assert.equal(data.view.cards.spend.complete, false);
});

test('Executive spend stays unavailable while Meta is pending and Google with no rows is no campaigns', async () => {
  const data = await build(coveredMonth([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-10-04', dim: 'account_type', dim_value: 'External', value: 3 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-10-04', dim: 'country', dim_value: 'Mexico', value: 3 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-10-04', dim: 'country', dim_value: 'Mexico', value: 100 },
    { source: 'meta', metric: 'ad_spend', date: '2026-10-04', value: 0 },
    { source: 'meta', metric: 'ad_impressions', date: '2026-10-04', value: 1000 },
  ], { source: [{ _k: 'google_ads', state: 'connected', window: '2026-10-01 to 2026-10-30' }] }), '2026-10', new Date('2026-10-30T17:00:00.000Z'));
  assert.equal(data.view.channels.meta.status, 'loaded');
  assert.equal(data.view.channels.meta.spend, 0);
  assert.equal(data.view.channels.google_ads.status, 'no_campaigns');
  assert.equal(data.view.channels.linkedin.status, 'pending');
  assert.equal(data.view.cards.spend.value, null);
  assert.equal(data.view.cards.spend.status, 'pending');
  assert.equal(data.view.cards.cps.status, 'pending');
  assert.match(data.view.cards.cps.reason, /spend incomplete/);
  assert.equal(data.view.funnel.steps[0].status, 'pending');
});

test('Executive November goal is read from stored targets and projects only from day 7', async () => {
  const early = await build(coveredMonth([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-11-02', dim: 'account_type', dim_value: 'External', value: 4 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 4 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 80 },
  ], { target: [{ month: '2026-11', country: 'LATAM', metric_key: 'platform_signups', target_value: 30000, proposal: true }] }), '2026-11', new Date('2026-11-04T17:00:00.000Z'));
  assert.equal(early.cutoff, '2026-11-03');
  assert.equal(early.view.cards.signups.goal, 30000);
  assert.equal(early.view.cards.signups.proposal, true);
  assert.equal(early.view.chart.goalLabel, 'Goal 30,000 · Proposal');
  assert.equal(early.view.cards.signups.projection, null);
  assert.ok(early.view.cards.signups.lines.includes('Too early to project'));
  assert.equal(early.view.cards.signups.pace, 'trailing');

  const later = await build(coveredMonth([
    { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-11-02', dim: 'account_type', dim_value: 'External', value: 9 },
    { source: 'posthog', metric: 'ph_exec_accounts_geo', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 9 },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 90 },
  ], { target: [{ month: '2026-11', country: 'LATAM', metric_key: 'platform_signups', target_value: 30000, status: 'proposal' }] }), '2026-11', new Date('2026-11-10T17:00:00.000Z'));
  assert.equal(later.view.elapsedDays, 9);
  assert.equal(later.view.cards.signups.projection, 9 / 9 * 30);
  assert.equal(later.view.cards.signups.proposal, true);
  assert.equal(later.view.chart.days.find((day) => day.date === '2026-11-10').signups, null);
  assert.equal(later.view.chart.days.find((day) => day.date === '2026-11-02').cumulative, 9);
});

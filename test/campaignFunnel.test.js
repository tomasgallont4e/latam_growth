'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCampaignFunnel } = require('../lib/campaignFunnel');
const { build } = require('../lib/executive');

const FROM = '2026-11-01';
const TO = '2026-11-30';
const m = (source, metric, value, extra = {}) => ({ source, metric, date: '2026-11-05', value, ...extra });
const snap = (source, key, rows) => ({ source, key, from: '2026-10-01', to: TO, rows });
const stageOf = (funnel, id) => funnel.stages.find((s) => s.id === id);

function input({ metrics = [], snapshots = [], events = [], dropSnapshots = [] } = {}) {
  const baseSnapshots = [
    snap('meta', 'outbound_coverage', [{ available: true }]),
    snap('meta', 'organic_coverage', [{ facebook: { available: true }, instagram: { available: true } }]),
  ].filter((s) => !dropSnapshots.includes(s.key));
  return {
    from: FROM, to: TO, monthEnd: TO, sources: [], monthTarget: {},
    metricRows: [
      m('meta', 'ad_impressions', 1000, { dim: 'campaign', dim_value: 'Launch' }),
      m('meta', 'ad_spend', 30, { dim: 'campaign', dim_value: 'Launch' }),
      m('meta', 'ad_clicks', 90, { dim: 'campaign', dim_value: 'Launch' }),
      m('meta', 'ad_outbound_clicks', 40, { dim: 'campaign', dim_value: 'Launch' }),
      m('google_ads', 'ad_impressions', 500, { dim: 'campaign', dim_value: 'Search' }),
      m('google_ads', 'ad_clicks', 10, { dim: 'campaign', dim_value: 'Search' }),
      m('google_ads', 'ad_spend', 20, { dim: 'campaign', dim_value: 'Search' }),
      m('linkedin', 'post_impressions', 200),
      m('meta', 'organic_views', 300, { dim: 'platform', dim_value: 'Facebook' }),
      m('meta', 'organic_views', 100, { dim: 'platform', dim_value: 'Instagram' }),
      ...metrics,
    ],
    snapshots: [...baseSnapshots, ...snapshots],
    eventRows: events,
  };
}

test('the funnel has seven stages in the agreed order', () => {
  const funnel = buildCampaignFunnel(input());
  assert.deepEqual(funnel.stages.map((s) => s.id), ['impressions', 'clicks', 'sessions', 'forms', 'accounts', 'logins', 'projects']);
});

test('impressions add paid and organic with the breakdown visible', () => {
  const stage = stageOf(buildCampaignFunnel(input()), 'impressions');
  assert.equal(stage.status, 'loaded');
  assert.equal(stage.value, 2100);
  assert.deepEqual(stage.split, { paid: 1500, organic: 600 });
  const rows = stage.breakdowns[0].rows;
  assert.equal(rows.find((r) => r.network === 'Meta Ads').value, 1000);
  assert.equal(rows.find((r) => r.network === 'Facebook page').value, 300);
  assert.equal(rows.find((r) => r.network === 'LinkedIn page').value, 200);
});

test('LinkedIn Ads is not used, so it never appears as a pending paid network', () => {
  const stage = stageOf(buildCampaignFunnel(input()), 'impressions');
  assert.equal(stage.breakdowns[0].rows.some((r) => r.network === 'LinkedIn Ads'), false);
  assert.ok(!stage.underReview || !/LinkedIn Ads/.test(stage.underReview.reason));
});

test('clicks use Meta outbound clicks, never all-clicks, and convert against paid impressions', () => {
  const stage = stageOf(buildCampaignFunnel(input()), 'clicks');
  assert.equal(stage.value, 50);
  assert.equal(stage.conversion.value, 50 / 1500);
});

test('Meta without outbound coverage is pending for clicks instead of substituting link clicks', () => {
  const stage = stageOf(buildCampaignFunnel(input({ dropSnapshots: ['outbound_coverage'] })), 'clicks');
  assert.equal(stage.value, 10);
  assert.match(stage.underReview.reason, /Meta Ads/);
});

test('click-to-session conversion uses only campaigns matched by utm_campaign', () => {
  const funnel = buildCampaignFunnel(input({
    metrics: [m('ga4', 'ga_exec_geo_sessions', 120, { dim: 'country', dim_value: 'Colombia' })],
    snapshots: [
      snap('ga4', 'executive_landing', [{ available: true }]),
      snap('ga4', 'executive_landing_utm', [{ available: true }]),
      snap('ga4', 'executive_landing_utm_1', [
        { date: '2026-11-05', source: 'facebook', medium: 'paid_social', campaign: 'launch', content: 'v1', sessions: 20 },
        { date: '2026-11-05', source: '(direct)', medium: '(none)', campaign: '(not set)', content: '(not set)', sessions: 100 },
        { date: '2026-10-20', source: 'facebook', medium: 'paid_social', campaign: 'launch', content: 'v1', sessions: 999 },
      ]),
    ],
  }));
  const stage = stageOf(funnel, 'sessions');
  assert.equal(stage.value, 120);
  assert.equal(stage.conversion.value, 0.5);
  assert.match(stage.conversion.basis, /Campaign-matched: 1/);
  assert.equal(stage.cost.value, 1.5);
});

test('cost per result uses Meta Ads + Google Ads spend and is complete when both reported', () => {
  const funnel = buildCampaignFunnel(input());
  assert.equal(funnel.spend.known, 50);
  assert.equal(funnel.spend.complete, true);
  assert.deepEqual(funnel.spend.pending, []);
  const clicks = stageOf(funnel, 'clicks');
  assert.equal(clicks.cost.value, 1);
  assert.equal(clicks.cost.partial, false);
});

test('accounts created = External first $identify on all hosts; internal is excluded and verified is not shown', () => {
  const funnel = buildCampaignFunnel(input({
    metrics: [
      m('posthog', 'ph_accounts', 3, { dim: 'account_type', dim_value: 'External' }),
      m('posthog', 'ph_accounts', 4, { dim: 'account_type', dim_value: 'Internal' }),
    ],
    snapshots: [snap('posthog', 'account_coverage', [{ available: true }])],
  }));
  const accounts = stageOf(funnel, 'accounts');
  assert.equal(accounts.value, 3);
  assert.equal(accounts.name, 'Accounts created');
  assert.equal(accounts.extras.some((x) => /Verified/i.test(x.label)), false);
});

test('accounts stay pending without account coverage instead of showing zero', () => {
  const accounts = stageOf(buildCampaignFunnel(input()), 'accounts');
  assert.equal(accounts.status, 'pending');
  assert.equal(accounts.value, null);
});

test('HubSpot and PostHog cross only through the email HMAC', () => {
  const funnel = buildCampaignFunnel(input({
    metrics: [m('posthog', 'ph_accounts', 3, { dim: 'account_type', dim_value: 'External' })],
    events: [
      { source: 'hubspot', kind: 'form_signup', date: '2026-11-03', email_hmac: 'h1', internal: false },
      { source: 'hubspot', kind: 'form_signup', date: '2026-11-03', email_hmac: 'h2', internal: false },
      { source: 'hubspot', kind: 'form_signup', date: '2026-11-03', email_hmac: 'h3', internal: true },
    ],
    snapshots: [
      snap('posthog', 'account_coverage', [{ available: true }]),
      snap('posthog', 'identity_cohort', [{ available: true }]),
      snap('posthog', 'identity_cohort_1', [
        { created: '2026-11-04', verified: '2026-11-04', project: null, id_hash: 'h1' },
        { created: '2026-11-06', verified: null, project: null, id_hash: 'h3' },
        { created: '2026-11-07', verified: '2026-11-08', project: null, id_hash: 'h9' },
      ]),
    ],
  }));
  assert.equal(stageOf(funnel, 'forms').value, 2);
  const accounts = stageOf(funnel, 'accounts');
  assert.equal(accounts.value, 3);
  assert.equal(accounts.extras.find((x) => /HMAC/.test(x.label)).value, 1);
});

test('logins stay No data yet until a signed_in event is synced', () => {
  const stage = stageOf(buildCampaignFunnel(input()), 'logins');
  assert.equal(stage.status, 'pending');
  assert.equal(stage.value, null);
  assert.match(stage.reason, /signed_in/);
});

test('logins count PostHog signed_in events only and are flagged as events, not people', () => {
  const stage = stageOf(buildCampaignFunnel(input({
    metrics: [m('posthog', 'ph_event', 6, { dim: 'event', dim_value: 'credits_purchased' }), m('posthog', 'ph_event', 9, { dim: 'event', dim_value: 'signed_in' })],
  })), 'logins');
  assert.equal(stage.status, 'loaded');
  assert.equal(stage.value, 9);
  assert.match(stage.underReview.reason, /not people/);
});

test('projects created counts project_created events; the step % is versus logins', () => {
  const funnel = buildCampaignFunnel(input({
    metrics: [m('posthog', 'ph_event', 7, { dim: 'event', dim_value: 'project_created' }), m('posthog', 'ph_event', 40, { dim: 'event', dim_value: 'signed_in' })],
  }));
  const stage = stageOf(funnel, 'projects');
  assert.equal(stage.status, 'loaded');
  assert.equal(stage.value, 7);
  assert.equal(stage.conversion.value, 7 / 40);
});

test('projects step % waits for logins when signed_in is not synced', () => {
  const stage = stageOf(buildCampaignFunnel(input({
    metrics: [m('posthog', 'ph_event', 7, { dim: 'event', dim_value: 'project_created' })],
  })), 'projects');
  assert.equal(stage.value, 7);
  assert.equal(stage.conversion.value, null);
  assert.match(stage.conversion.reason, /Logins/);
});

test('builder cohort tracks day 0 and the first 14 days, with mature cohorts only for the rate', () => {
  const funnel = buildCampaignFunnel(input({
    snapshots: [
      snap('posthog', 'identity_cohort', [{ available: true }]),
      snap('posthog', 'identity_cohort_1', [
        { created: '2026-11-01', verified: null, project: '2026-11-01', id_hash: null },
        { created: '2026-11-02', verified: null, project: '2026-11-10', id_hash: null },
        { created: '2026-11-03', verified: null, project: '2026-11-25', id_hash: null },
        { created: '2026-11-20', verified: null, project: null, id_hash: null },
      ]),
    ],
  }));
  const stage = stageOf(funnel, 'projects');
  assert.equal(stage.builders.day0, 1);
  assert.equal(stage.builders.within14, 2);
  assert.equal(stage.builders.mature, 3);
  assert.equal(stage.builders.rate14, 2 / 3);
});

test('published content stays No data yet and projects stay pending without PostHog events', () => {
  const stage = stageOf(buildCampaignFunnel(input()), 'projects');
  assert.equal(stage.published.status, 'pending');
  assert.equal(stage.published.label, 'No data yet');
  assert.equal(stage.status, 'pending');
  assert.equal(stage.builders, null);
});

test('weakest step is the lowest % versus the previous stage among stages with data', () => {
  const funnel = buildCampaignFunnel(input());
  assert.equal(funnel.weakest.id, 'clicks');
  assert.equal(funnel.weakest.value, 50 / 1500);
});

test('no complete day returns a pending funnel without stages', () => {
  const funnel = buildCampaignFunnel({ from: '2026-11-01', to: null });
  assert.equal(funnel.status, 'pending');
  assert.deepEqual(funnel.stages, []);
});

test('Executive month response includes view.campaignFunnel with seven stages', async () => {
  const rows = {
    metric: [
      { source: 'posthog', metric: 'ph_exec_accounts', date: '2026-11-02', dim: 'account_type', dim_value: 'External', value: 5 },
      { source: 'posthog', metric: 'ph_accounts', date: '2026-11-02', dim: 'account_type', dim_value: 'External', value: 5 },
      { source: 'ga4', metric: 'ga_exec_geo_sessions', date: '2026-11-02', dim: 'country', dim_value: 'Colombia', value: 335 },
    ],
    event: [],
    snapshot: [
      { source: 'posthog', key: 'executive_accounts', from: '2026-10-01', to: '2026-11-30', rows: [{ available: true, country_available: false, external_accounts: 5, country_assigned: 0, country_missing: 5, excluded_host_accounts: 0 }] },
      { source: 'posthog', key: 'account_coverage', from: '2026-10-01', to: '2026-11-30', rows: [{ available: true }] },
      { source: 'ga4', key: 'executive_landing', from: '2026-10-01', to: '2026-11-30', rows: [{ available: true, country_available: true }] },
    ],
    goal_plan: [{ _k: 'latam', countries: {} }],
  };
  const store = { list: async (kind) => rows[kind] || [], upsert: async () => {} };
  const data = await build(store, '2026-11', new Date('2026-11-04T17:00:00.000Z'));
  const funnel = data.view.campaignFunnel;
  assert.equal(funnel.status, 'loaded');
  assert.deepEqual(funnel.stages.map((s) => s.id), ['impressions', 'clicks', 'sessions', 'forms', 'accounts', 'logins', 'projects']);
  assert.equal(funnel.stages.find((s) => s.id === 'accounts').value, 5);
  assert.equal(funnel.stages.find((s) => s.id === 'sessions').value, 335);
});

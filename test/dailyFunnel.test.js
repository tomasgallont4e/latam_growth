'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, bogotaDay, NO_CAMPAIGN, NO_SOURCE } = require('../lib/dailyFunnel');

const NOW = new Date('2026-11-06T15:00:00Z'); // 10:00 in Bogota
const W = { from: '2026-10-01', to: '2026-11-05' };
const m = (source, metric, date, value, extra = {}) => ({ source, metric, date, value, ...extra });
const snap = (source, key, rows, w = W) => ({ source, key, from: w.from, to: w.to, rows });
const conn = (k) => ({ _k: k, state: 'connected', last_sync: '2026-11-06T14:00:00Z' });

function input(over = {}) {
  const snapshots = [
    snap('meta', 'outbound_coverage', [{ available: true }]),
    snap('ga4', 'executive_landing_utm', [{ available: true }]),
    snap('ga4', 'executive_landing_utm_1', [
      { date: '2026-11-03', source: 'facebook', medium: 'paid_social', campaign: 'launch', content: 'v1', sessions: 30 },
      { date: '2026-11-03', source: 'facebook', medium: 'paid_social', campaign: 'launch-v2', content: 'v1', sessions: 5 },
      { date: '2026-11-03', source: '(direct)', medium: '(none)', campaign: '(not set)', content: '(not set)', sessions: 50 },
    ]),
    snap('hubspot', 'utm_capture', [{ available: true }]),
    snap('posthog', 'account_coverage', [{ available: true }]),
    snap('posthog', 'identity_cohort', [{ available: true }]),
    snap('posthog', 'identity_cohort_1', [
      { created: '2026-11-03', project: '2026-11-04', id_hash: 'hash-aaa', utm_source: 'linkedin', utm_campaign: 'other' },
      { created: '2026-11-03', project: null, id_hash: 'hash-bbb', utm_source: '', utm_campaign: '' },
      { created: '2026-11-03', project: null, id_hash: 'hash-ccc', utm_source: 'google', utm_campaign: 'brand' },
    ]),
    ...(over.snapshots || []),
  ].filter((s) => !(over.drop || []).includes(s.key));
  return {
    month: '2026-11', now: over.now || NOW, launch: '2026-10-01',
    sources: ['meta', 'google_ads', 'ga4', 'hubspot', 'posthog'].map(conn),
    metricRows: [
      m('meta', 'ad_spend', '2026-11-03', 30, { dim: 'campaign', dim_value: 'Launch' }),
      m('meta', 'ad_impressions', '2026-11-03', 3000, { dim: 'campaign', dim_value: 'Launch' }),
      m('meta', 'ad_outbound_clicks', '2026-11-03', 60, { dim: 'campaign', dim_value: 'Launch' }),
      m('posthog', 'ph_accounts', '2026-11-03', 4, { dim: 'account_type', dim_value: 'External' }),
      m('posthog', 'ph_accounts', '2026-11-03', 9, { dim: 'account_type', dim_value: 'Internal' }),
      ...(over.metrics || []),
    ],
    snapshots,
    eventRows: [
      { source: 'hubspot', kind: 'form_signup', date: '2026-11-03', internal: false, email_hmac: 'hash-aaa', first_utm_source: 'facebook', first_utm_medium: 'paid_social', first_utm_campaign: 'Launch', utm_source: '', utm_campaign: '' },
      { source: 'hubspot', kind: 'form_signup', date: '2026-11-03', internal: false, email_hmac: 'hash-ddd', utm_source: 'newsletter', utm_medium: 'email', utm_campaign: '' },
      { source: 'hubspot', kind: 'form_signup', date: '2026-11-03', internal: true, email_hmac: 'hash-eee', utm_campaign: 'Launch' },
      ...(over.events || []),
    ],
  };
}
const row = (r, date, channel, campaign) => r.rows.find((x) => x.date === date && x.channel === channel && x.campaign === campaign);
const day = (r, date) => r.days.find((d) => d.date === date);
const stage = (r, id) => r.stages.find((s) => s.id === id);

test('days run from the month start to today in America/Bogota', () => {
  assert.equal(bogotaDay(new Date('2026-11-07T03:00:00Z')), '2026-11-06');
  const r = build(input({ now: new Date('2026-11-07T03:00:00Z') }));
  assert.equal(r.status, 'loaded');
  assert.equal(r.timezone, 'America/Bogota');
  assert.equal(r.from, '2026-11-01');
  assert.equal(r.to, '2026-11-06');
  assert.equal(r.days.length, 6);
  assert.equal(day(r, '2026-11-06').partial, true);
});

test('a day outside the synced window is null; inside it is a real zero', () => {
  const r = build(input());
  const out = day(r, '2026-11-06');
  for (const f of ['spend', 'impressions', 'clicks', 'sessions', 'forms', 'accounts', 'projects']) assert.equal(out[f], null, f);
  const quiet = day(r, '2026-11-04');
  for (const f of ['spend', 'impressions', 'clicks', 'sessions', 'forms', 'accounts']) assert.equal(quiet[f], 0, f);
  assert.equal(quiet.projects, 1);
});

test('ad metrics join sessions, forms and accounts only on an exact campaign name', () => {
  const r = build(input());
  const paid = row(r, '2026-11-03', 'Meta Ads', 'Launch');
  assert.ok(paid);
  assert.equal(paid.spend, 30);
  assert.equal(paid.impressions, 3000);
  assert.equal(paid.clicks, 60);
  assert.equal(paid.sessions, 30);
  assert.equal(paid.forms, 1);
  assert.equal(paid.accounts, 1, 'the account matched to the HubSpot form takes the HubSpot UTMs');
  assert.equal(paid.metrics.cpm, 10);
  assert.equal(paid.metrics.cpc, 0.5);
  assert.equal(paid.metrics.costPerSession, 1);
  assert.equal(paid.metrics.costPerAccount, 30);
  assert.equal(paid.metrics.clickToSession, 0.5);
  const near = row(r, '2026-11-03', 'facebook', 'launch-v2');
  assert.ok(near, 'a similar name is not joined');
  assert.equal(near.spend, null);
  assert.equal(near.metrics.costPerSession, null);
  assert.deepEqual(near.mediums, ['paid_social']);
});

test('a missing UTM never becomes a campaign', () => {
  const r = build(input());
  const direct = row(r, '2026-11-03', '(direct)', NO_CAMPAIGN);
  assert.equal(direct.sessions, 50);
  assert.equal(direct.spend, null);
  assert.equal(row(r, '2026-11-03', NO_SOURCE, NO_CAMPAIGN).accounts, 1);
  assert.equal(row(r, '2026-11-03', 'newsletter', NO_CAMPAIGN).forms, 1);
});

test('HubSpot UTMs win for matched people; PostHog first touch otherwise', () => {
  const r = build(input());
  assert.equal(row(r, '2026-11-03', 'linkedin', 'other'), undefined);
  assert.equal(row(r, '2026-11-03', 'google', 'brand').accounts, 1);
  assert.deepEqual(r.attribution.accounts, { hubspot: 1, posthog: 1, none: 1 });
  assert.equal(row(r, '2026-11-04', 'Meta Ads', 'Launch').projects, 1);
});

test('daily totals use external accounts and exclude internal contacts', () => {
  const t = day(build(input()), '2026-11-03');
  assert.equal(t.accounts, 4);
  assert.equal(t.accountsCohort, 3);
  assert.equal(t.forms, 2);
  assert.equal(t.sessions, 85);
  assert.equal(t.metrics.costPerSession, 1);
  assert.equal(t.metrics.costPerAccountBlended, 30 / 4);
  assert.equal(t.metrics.sessionToAccount, 4 / 85);
});

test('Meta without outbound coverage leaves clicks and CPC unavailable', () => {
  const r = build(input({ drop: ['outbound_coverage'] }));
  const paid = row(r, '2026-11-03', 'Meta Ads', 'Launch');
  assert.equal(paid.clicks, null);
  assert.equal(paid.metrics.cpc, null);
  assert.equal(stage(r, 'clicks').status, 'no_data');
  assert.equal(day(r, '2026-11-04').spend, null, 'without a synced window an empty day is No data');
});

test('logins stay Not connected until signed_in is synced, then count signed_in events per day', () => {
  const r = build(input());
  assert.equal(stage(r, 'logins').status, 'not_connected');
  assert.equal(day(r, '2026-11-03').logins, null);
  const withLogins = build(input({ metrics: [
    m('posthog', 'ph_event', '2026-11-03', 7, { dim: 'event', dim_value: 'signed_in' }),
    m('posthog', 'ph_event', '2026-11-03', 3, { dim: 'event', dim_value: 'project_created' }),
  ] }));
  assert.equal(stage(withLogins, 'logins').status, 'loaded');
  assert.equal(day(withLogins, '2026-11-03').logins, 7);
  assert.equal(day(withLogins, '2026-11-04').logins, 0);
});

test('LinkedIn Ads is not connected for impressions but never makes spend partial', () => {
  const r = build(input({ metrics: [m('google_ads', 'ad_spend', '2026-11-03', 12, { dim: 'campaign', dim_value: 'Search' })] }));
  assert.equal(r.networks.find((n) => n.key === 'linkedin_ads').status, 'not_connected');
  assert.equal(stage(r, 'spend').reason, null);
  assert.match(stage(r, 'impressions').reason, /LinkedIn Ads/);
  assert.doesNotMatch(r.notes.join(' '), /Known spend only/);
});

test('spend is known spend only while Meta or Google Ads has not reported', () => {
  const r = build(input());
  assert.match(stage(r, 'spend').reason, /Known spend only: Google Ads not included/);
  assert.doesNotMatch(stage(r, 'spend').reason, /LinkedIn/);
});

test('seed rows are excluded and counted', () => {
  const r = build(input({ metrics: [m('meta', 'ad_spend', '2026-11-03', 1000, { dim: 'campaign', dim_value: 'Launch', seed: true })] }));
  assert.equal(day(r, '2026-11-03').spend, 30);
  assert.equal(r.sampleExcluded, 1);
});

test('the output carries no personal data or identity hashes', () => {
  const text = JSON.stringify(build(input()));
  assert.equal(text.includes('hash-'), false);
  assert.equal(text.includes('@'), false);
  assert.equal(/email_hmac|id_hash/.test(text), false);
});

test('a month after today is pending', () => {
  const r = build({ ...input(), month: '2026-12' });
  assert.equal(r.status, 'pending');
  assert.deepEqual(r.rows, []);
});

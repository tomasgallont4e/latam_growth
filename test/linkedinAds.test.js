'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV = ['LINKEDIN_ORG_ID', 'LINKEDIN_TOKEN', 'LINKEDIN_REFRESH_TOKEN', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_AD_ACCOUNT_ID', 'LINKEDIN_ADS_TOKEN', 'LINKEDIN_ADS_REFRESH_TOKEN', 'LINKEDIN_ADS_CLIENT_ID', 'LINKEDIN_ADS_CLIENT_SECRET'];
const withEnv = (t, values) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, values);
};
const reply = (body, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(body) });
const day = (year, month, d) => ({ start: { year, month, day: d }, end: { year, month, day: d } });

test('page analytics and ads reporting are configured separately', (t) => {
  const { configured } = require('../lib/connectors');
  withEnv(t, {});
  assert.equal(configured('linkedin'), false);
  assert.equal(configured('linkedin_ads'), false);
  process.env.LINKEDIN_AD_ACCOUNT_ID = '558716366';
  assert.equal(configured('linkedin_ads'), false);
  process.env.LINKEDIN_ADS_TOKEN = 't';
  assert.equal(configured('linkedin_ads'), true);
  assert.equal(configured('linkedin'), false);
  withEnv(t, { LINKEDIN_ORG_ID: '129864039', LINKEDIN_TOKEN: 't' });
  assert.equal(configured('linkedin'), true);
  assert.equal(configured('linkedin_ads'), false);
  // The page token alone never unlocks ads reporting.
  process.env.LINKEDIN_AD_ACCOUNT_ID = '558716366';
  assert.equal(configured('linkedin_ads'), false);
});

test('ads reporting: daily rows by campaign in the linkedin_ads source', async (t) => {
  withEnv(t, { LINKEDIN_AD_ACCOUNT_ID: '558716366', LINKEDIN_ADS_TOKEN: 'secret' });
  const { connectors } = require('../lib/connectors');
  const calls = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/adCampaigns')) return reply({ elements: [{ id: 11, name: 'Boost A' }] });
    if (url.includes('/adAnalytics')) {
      // Only the first 30-day slice has data.
      if (!url.includes('start:(year:2026,month:10,day:1)')) return reply({ elements: [] });
      return reply({ elements: [
        { dateRange: day(2026, 10, 17), pivotValues: ['urn:li:sponsoredCampaign:11'], impressions: 1000, clicks: 12, landingPageClicks: 9, costInUsd: '4.25' },
        { dateRange: day(2026, 10, 18), pivotValues: ['urn:li:sponsoredCampaign:22'], impressions: 500, clicks: 3, costInUsd: '1.5' },
      ] });
    }
    throw new Error(`unexpected ${url}`);
  });
  const load = await connectors.linkedin_ads();
  assert.equal(load.source, 'linkedin_ads');
  // The connector owns the whole source: a successful sync replaces the CSV rows.
  assert.equal(load.owns, undefined);
  const row = (metric, date) => load.metrics.find((r) => r.metric === metric && r.date === date);
  assert.deepEqual(row('ad_impressions', '2026-10-17'), { metric: 'ad_impressions', date: '2026-10-17', dim: 'campaign', dim_value: 'Boost A', value: 1000 });
  assert.equal(row('ad_clicks', '2026-10-17').value, 12);
  assert.equal(row('ad_landing_clicks', '2026-10-17').value, 9);
  assert.equal(row('ad_spend', '2026-10-17').value, 4.25);
  // A campaign without a name keeps its id; a missing field is zero.
  assert.equal(row('ad_impressions', '2026-10-18').dim_value, 'Campaign 22');
  assert.equal(row('ad_landing_clicks', '2026-10-18').value, 0);
  assert.equal(load.metrics.length, 8);
  assert.equal(load.snapshots[0].key, 'ads_coverage');
  assert.equal(load.snapshots[0].rows[0].campaigns, 2);
  // The page analytics endpoints are never called, and every call carries the ads token.
  assert.ok(calls.every((c) => !/organizational|networkSizes|\/posts/.test(c.url)));
  assert.ok(calls.every((c) => c.opts.headers.Authorization === 'Bearer secret'));
  const analytics = calls.find((c) => c.url.includes('/adAnalytics'));
  assert.ok(analytics.url.includes('accounts=List(urn%3Ali%3AsponsoredAccount%3A558716366)'));
  assert.ok(analytics.url.includes('pivot=CAMPAIGN') && analytics.url.includes('timeGranularity=DAILY'));
});

test('an empty ads answer fails, so nothing stored is cleared', async (t) => {
  withEnv(t, { LINKEDIN_AD_ACCOUNT_ID: '558716366', LINKEDIN_ADS_TOKEN: 'secret' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async () => reply({ elements: [] }));
  await assert.rejects(connectors.linkedin_ads(), /returned no rows for ad account 558716366/);
});

test('page analytics owns only its own facts in the linkedin source', async (t) => {
  withEnv(t, { LINKEDIN_ORG_ID: '129864039', LINKEDIN_TOKEN: 'page' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(global, 'fetch', async (url) => {
    assert.ok(!url.includes('adAnalytics'));
    if (url.includes('networkSizes')) return reply({ firstDegreeSize: 120 });
    return reply({ elements: [] });
  });
  const load = await connectors.linkedin();
  assert.equal(load.source, 'linkedin');
  assert.deepEqual(load.owns, { metrics: ['followers', 'new_followers', 'post_', 'page_views'], snapshots: ['posts'] });
  assert.equal(load.metrics.find((r) => r.metric === 'followers').value, 120);
});

test('ingest clears only the prefixes a connector owns', async (t) => {
  const store = require('../lib/store');
  const ingest = require('../lib/ingest');
  const removed = [];
  t.mock.method(store, 'removePrefix', async (kind, prefix) => { removed.push(`${kind}:${prefix}`); });
  t.mock.method(store, 'upsert', async () => {});
  t.mock.method(store, 'list', async () => []);
  await ingest({ source: 'linkedin', metrics: [], snapshots: [], owns: { metrics: ['post_', 'bad prefix|'], snapshots: ['posts'] } }, 'connector');
  assert.deepEqual(removed, ['metric:linkedin|post_', 'snapshot:linkedin|posts']);
  removed.length = 0;
  await ingest({ source: 'linkedin_ads', metrics: [], snapshots: [] }, 'connector');
  assert.deepEqual(removed, ['metric:linkedin_ads|', 'snapshot:linkedin_ads|']);
  removed.length = 0;
  await ingest({ source: 'linkedin', metrics: [], owns: { metrics: ['post_'], snapshots: [] } }, 'csv');
  assert.deepEqual(removed, []);
});

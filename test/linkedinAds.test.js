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

test('LinkedIn counts as configured with either part, and not with half of one', (t) => {
  const { configured } = require('../lib/connectors');
  withEnv(t, {});
  assert.equal(configured('linkedin'), false);
  process.env.LINKEDIN_AD_ACCOUNT_ID = '558716366';
  assert.equal(configured('linkedin'), false);
  process.env.LINKEDIN_ADS_TOKEN = 't';
  assert.equal(configured('linkedin'), true);
  withEnv(t, { LINKEDIN_ORG_ID: '129864039', LINKEDIN_TOKEN: 't' });
  assert.equal(configured('linkedin'), true);
  withEnv(t, { LINKEDIN_TOKEN: 't' });
  assert.equal(configured('linkedin'), false);
});

test('ads reporting alone: daily rows by campaign, and only ad facts are owned', async (t) => {
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
  const load = await connectors.linkedin();
  assert.equal(load.source, 'linkedin');
  assert.deepEqual(load.owns, { metrics: ['ad_'], snapshots: ['ads_'] });
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

test('an empty ads answer fails instead of clearing what is stored', async (t) => {
  withEnv(t, { LINKEDIN_AD_ACCOUNT_ID: '558716366', LINKEDIN_ADS_TOKEN: 'secret' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async () => reply({ elements: [] }));
  await assert.rejects(connectors.linkedin(), /returned no rows for ad account 558716366/);
});

test('one part failing keeps the other, and its facts are not owned', async (t) => {
  withEnv(t, { LINKEDIN_AD_ACCOUNT_ID: '558716366', LINKEDIN_ADS_TOKEN: 'ads', LINKEDIN_ORG_ID: '129864039', LINKEDIN_TOKEN: 'page' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (opts.headers.Authorization === 'Bearer page') return reply({ message: 'expired' }, false, 401);
    if (url.includes('/adAnalytics')) return reply({ elements: [{ dateRange: day(2026, 10, 17), pivotValues: ['urn:li:sponsoredCampaign:11'], impressions: 10, clicks: 1, landingPageClicks: 1, costInUsd: '0.1' }] });
    return reply({ elements: [] });
  });
  const load = await connectors.linkedin();
  assert.deepEqual(load.owns, { metrics: ['ad_'], snapshots: ['ads_'] });
  assert.ok(load.metrics.length > 0 && load.metrics.every((r) => r.metric.startsWith('ad_')));
});

test('ingest clears only the prefixes a connector owns', async (t) => {
  const store = require('../lib/store');
  const ingest = require('../lib/ingest');
  const removed = [];
  t.mock.method(store, 'removePrefix', async (kind, prefix) => { removed.push(`${kind}:${prefix}`); });
  t.mock.method(store, 'upsert', async () => {});
  t.mock.method(store, 'list', async () => []);
  await ingest({ source: 'linkedin', metrics: [], snapshots: [], owns: { metrics: ['ad_', 'bad prefix|'], snapshots: ['ads_'] } }, 'connector');
  assert.deepEqual(removed, ['metric:linkedin|ad_', 'snapshot:linkedin|ads_']);
  removed.length = 0;
  await ingest({ source: 'meta', metrics: [], snapshots: [] }, 'connector');
  assert.deepEqual(removed, ['metric:meta|', 'snapshot:meta|']);
  removed.length = 0;
  await ingest({ source: 'linkedin', metrics: [], owns: { metrics: ['ad_'], snapshots: [] } }, 'csv');
  assert.deepEqual(removed, []);
});

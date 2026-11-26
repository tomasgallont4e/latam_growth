'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const clickSplit = require('../public/js/clickSplit');
const { buildCampaignFunnel } = require('../lib/campaignFunnel');
const { cleanOverviewFunnel } = require('../lib/assistant');

const m = (source, metric, date, value, dim_value = 'Campaign') => ({ source, metric, date, dim: 'campaign', dim_value, value });
const snap = (source, key, rows, extra = {}) => ({ source, key, from: '2026-10-01', to: '2026-11-24', pulled_at: '2026-11-24T12:00:00Z', rows, ...extra });
const ok = (source, key) => snap(source, key, [{ available: true }]);

// The Gmail campaign of 10 to 14-nov, as read in Google Ads and GA4 on 19-nov.
function gmailFixture() {
  const metrics = [
    m('google_ads', 'ad_impressions', '2026-11-12', 64109, 'Early Builders CO - Gmail - 2026-11'),
    m('google_ads', 'ad_clicks', '2026-11-12', 1044, 'Early Builders CO - Gmail - 2026-11'),
  ];
  const detail = [
    { date: '2026-11-12', campaign: 'Early Builders CO - Gmail - 2026-11', device: 'MOBILE', network: 'GMAIL', kind: 'image', impressions: 50383, clicks: 986 },
    { date: '2026-11-12', campaign: 'Early Builders CO - Gmail - 2026-11', device: 'DESKTOP', network: 'GMAIL', kind: 'image', impressions: 13221, clicks: 41 },
    { date: '2026-11-12', campaign: 'Early Builders CO - Gmail - 2026-11', device: 'TABLET', network: 'GMAIL', kind: 'image', impressions: 505, clicks: 17 },
  ];
  const sessions = [
    { date: '2026-11-12', source: 'google', medium: 'cpc', campaign: 'early_builders_co_202611', device: 'mobile', sessions: 386 },
    { date: '2026-11-12', source: 'google', medium: 'cpc', campaign: 'early_builders_co_202611', device: 'desktop', sessions: 42 },
    { date: '2026-11-12', source: 'google', medium: 'cpc', campaign: 'early_builders_co_202611', device: 'tablet', sessions: 3 },
    { date: '2026-11-12', source: '(direct)', medium: '(none)', campaign: '(not set)', device: 'mobile', sessions: 500 },
  ];
  const snapshots = [
    ok('google_ads', 'ad_click_detail'), snap('google_ads', 'ad_click_detail_1', detail),
    ok('ga4', 'landing_device'), snap('ga4', 'landing_device_1', sessions),
  ];
  return { metrics, snapshots };
}

test('Google Ads: clicks that open the page are paired with their own sessions, by device', () => {
  const out = clickSplit.build({ ...gmailFixture(), from: '2026-11-10', to: '2026-11-14' });
  const g = out.networks.find((n) => n.key === 'google_ads');
  assert.equal(g.all_clicks, 1044);
  assert.equal(g.no_page, 0, 'image ads only: every click requests the page');
  assert.equal(g.open_page, 1044);
  assert.equal(g.sessions, 431, 'direct visits are not given to Google Ads');
  assert.equal(g.lost_after_click, 613);
  const phone = g.devices.find((d) => d.device === 'Phone');
  const computer = g.devices.find((d) => d.device === 'Computer');
  assert.equal(phone.open_page, 986); assert.equal(phone.sessions, 386); assert.equal(phone.lost_after_click, 600);
  assert.equal(Math.round(phone.click_to_session * 100), 39);
  assert.equal(computer.lost_after_click, 0);
  assert.equal(computer.more_sessions_than_clicks, true, '41 clicks and 42 sessions is not a loss');
});

test('Gmail video ad clicks never request the page and are not counted as loss', () => {
  const f = gmailFixture();
  f.snapshots[1].rows.push({ date: '2026-11-12', campaign: 'Early Builders CO - Gmail - 2026-11', device: 'MOBILE', network: 'GMAIL', kind: 'video', impressions: 900, clicks: 100 });
  f.metrics[1].value = 1144;
  const g = clickSplit.build({ ...f, from: '2026-11-10', to: '2026-11-14' }).networks.find((n) => n.key === 'google_ads');
  assert.equal(g.no_page, 100);
  assert.equal(g.open_page, 1044);
  assert.equal(g.devices.find((d) => d.device === 'Phone').open_page, 986);
});

test('Meta: all clicks, link clicks and outbound clicks stay apart; landing page views only since the pixel', () => {
  const metrics = [
    m('meta', 'ad_impressions', '2026-11-17', 9000, 'IG boost'),
    m('meta', 'ad_platform_clicks', '2026-11-17', 260, 'IG boost'),
    m('meta', 'ad_link_clicks', '2026-11-17', 173, 'IG boost'),
    m('meta', 'ad_outbound_clicks', '2026-11-17', 0, 'IG boost'),
    m('meta', 'ad_impressions', '2026-11-20', 5000, 'Landing test'),
    m('meta', 'ad_platform_clicks', '2026-11-20', 120, 'Landing test'),
    m('meta', 'ad_link_clicks', '2026-11-20', 90, 'Landing test'),
    m('meta', 'ad_outbound_clicks', '2026-11-20', 80, 'Landing test'),
    m('meta', 'ad_landing_page_views', '2026-11-20', 50, 'Landing test'),
  ];
  const snapshots = [
    ok('meta', 'outbound_coverage'), ok('meta', 'landing_view_coverage'),
    ok('ga4', 'executive_landing_utm'),
    snap('ga4', 'executive_landing_utm_1', [{ date: '2026-11-20', source: 'instagram', medium: 'paid_social', campaign: 'Landing test', content: 'a', sessions: 44 }]),
  ];
  const out = clickSplit.build({ metrics, snapshots, from: '2026-11-17', to: '2026-11-20' });
  const meta = out.networks.find((n) => n.key === 'meta');
  assert.equal(meta.all_clicks, 380);
  assert.equal(meta.link_clicks, 263);
  assert.equal(meta.open_page, 80);
  assert.equal(meta.no_page, 300, 'profile visits and other on-Meta clicks are not a loss');
  assert.equal(meta.page_views, 50);
  assert.equal(meta.sessions, 44);
  assert.equal(meta.lost_after_click, 36);
  assert.match(meta.note, /183 link clicks went to a destination on Instagram or Facebook/);
  assert.equal(out.sessions_basis, 'GA4 go.think4ever.com sessions by UTM (no device split yet)');
  const before = clickSplit.build({ metrics, snapshots, from: '2026-11-01', to: '2026-11-10' });
  assert.equal(before.networks.find((n) => n.key === 'meta').status, 'no_data', 'a window without Meta rows is No data, not 0');
});

test('LinkedIn page clicks are counted in step 2 but never split or paired', () => {
  const metrics = [
    m('meta', 'ad_impressions', '2026-11-20', 5000), m('meta', 'ad_platform_clicks', '2026-11-20', 120), m('meta', 'ad_outbound_clicks', '2026-11-20', 80),
    m('google_ads', 'ad_impressions', '2026-11-20', 2000), m('google_ads', 'ad_clicks', '2026-11-20', 60),
    { source: 'linkedin', metric: 'post_clicks', date: '2026-11-20', value: 300 },
  ];
  const snapshots = [ok('meta', 'outbound_coverage'), ok('ga4', 'landing_device'), snap('ga4', 'landing_device_1', [
    { date: '2026-11-20', source: 'instagram', medium: 'paid_social', campaign: 'c', device: 'mobile', sessions: 50 },
    { date: '2026-11-20', source: 'google', medium: 'cpc', campaign: 'c', device: 'mobile', sessions: 30 },
    { date: '2026-11-20', source: 'linkedin', medium: 'social', campaign: '(not set)', device: 'mobile', sessions: 200 },
    { date: '2026-11-20', source: 'linkedin', medium: 'qa', campaign: '(not set)', device: 'mobile', sessions: 9 },
  ])];
  const out = clickSplit.build({ metrics, snapshots, from: '2026-11-20', to: '2026-11-20' });
  const li = out.networks.find((n) => n.key === 'linkedin');
  assert.equal(li.all_clicks, 300); assert.equal(li.open_page, null); assert.equal(li.lost_after_click, null);
  assert.equal(li.sessions, 200, 'QA visits are excluded');
  assert.deepEqual(out.step2, { counted: 440, open_page: 140, no_page: null, not_separable: 300 });
  assert.deepEqual(out.total.networks, ['Meta Ads', 'Google Ads']);
  assert.equal(out.total.open_page, 140); assert.equal(out.total.sessions, 80); assert.equal(out.total.lost_after_click, 60);
  assert.equal(clickSplit.networkOf('linkedin', 'social'), 'linkedin');
  assert.equal(clickSplit.networkOf('instagram', 'social'), null, 'organic Instagram is not paired with ad clicks');
});

test('The Executive campaign funnel shows the same split under landing sessions', () => {
  const f = gmailFixture();
  const funnel = buildCampaignFunnel({ metricRows: f.metrics, snapshots: f.snapshots, from: '2026-11-10', to: '2026-11-14', sources: [] });
  const sessions = funnel.stages.find((s) => s.id === 'sessions');
  const table = sessions.breakdowns.find((b) => /Clicks that open the page/.test(b.title));
  assert.equal(table.rows[0].network, 'Google Ads');
  assert.equal(table.rows[0].open, 1044);
  assert.equal(table.rows[0].lost, 613);
  const devices = sessions.breakdowns.find((b) => /by device/.test(b.title));
  assert.equal(devices.rows.find((r) => r.device === 'Phone').lost_after_click, 600);
});

function env(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}
const response = (data) => ({ ok: true, text: async () => JSON.stringify(data) });

test('Meta sync stores landing page views from the same insights call', async (t) => {
  env(t, { META_TOKEN: 'test-token', META_AD_ACCOUNT_ID: 'act_123' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(global, 'fetch', async (url) => {
    const u = new URL(url);
    if (u.searchParams.get('fields') === 'currency') return response({ currency: 'USD' });
    if (u.searchParams.get('breakdowns') === 'country') return response({ data: [] });
    if (/outbound_clicks/.test(u.searchParams.get('fields') || '')) return response({ data: [] });
    return response({ data: [{ campaign_name: 'Landing test', date_start: '2026-11-20', spend: '10', impressions: '5000', clicks: '120', inline_link_clicks: '90', actions: [{ action_type: 'landing_page_view', value: '50' }, { action_type: 'link_click', value: '90' }] }] });
  });
  const load = await connectors.meta();
  const lpv = load.metrics.filter((r) => r.metric === 'ad_landing_page_views');
  assert.equal(lpv.length, 1);
  assert.equal(lpv[0].value, 50);
  assert.equal(load.snapshots.find((s) => s.key === 'landing_view_coverage').rows[0].pixel_since, '2026-11-18');
});

test('Google Ads sync adds clicks by device and ad type, and a failed detail report keeps the totals', async (t) => {
  env(t, { GOOGLE_ADS_DEVELOPER_TOKEN: 'd', GOOGLE_ADS_CUSTOMER_ID: '931-161-4388', GOOGLE_ADS_CLIENT_ID: 'c', GOOGLE_ADS_CLIENT_SECRET: 's', GOOGLE_ADS_REFRESH_TOKEN: 'r' });
  const { connectors } = require('../lib/connectors');
  let failDetail = false;
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (url.includes('oauth2.googleapis.com')) return response({ access_token: 'test' });
    const q = JSON.parse(opts.body).query;
    if (/customer\.currency_code/.test(q)) return response([{ results: [{ customer: { currencyCode: 'USD' } }] }]);
    if (/user_location_view/.test(q)) return response([{ results: [] }]);
    if (/FROM ad_group_ad/.test(q)) {
      if (failDetail) return { ok: false, status: 400, text: async () => 'bad field' };
      assert.match(q, /segments\.device/); assert.match(q, /ad_group_ad\.ad\.type/);
      return response([{ results: [
        { segments: { date: '2026-11-12', device: 'MOBILE', adNetworkType: 'GMAIL' }, campaign: { name: 'Gmail' }, adGroupAd: { ad: { type: 'DEMAND_GEN_MULTI_ASSET_AD' } }, metrics: { impressions: '100', clicks: '10' } },
        { segments: { date: '2026-11-12', device: 'MOBILE', adNetworkType: 'GMAIL' }, campaign: { name: 'Gmail' }, adGroupAd: { ad: { type: 'DEMAND_GEN_MULTI_ASSET_AD' } }, metrics: { impressions: '50', clicks: '5' } },
        { segments: { date: '2026-11-12', device: 'MOBILE', adNetworkType: 'GMAIL' }, campaign: { name: 'Gmail' }, adGroupAd: { ad: { type: 'DEMAND_GEN_VIDEO_RESPONSIVE_AD' } }, metrics: { impressions: '40', clicks: '4' } },
      ] }]);
    }
    return response([{ results: [{ segments: { date: '2026-11-12' }, campaign: { name: 'Gmail' }, metrics: { costMicros: '1000000', impressions: '190', clicks: '19' } }] }]);
  });
  const load = await connectors.google_ads();
  const head = load.snapshots.find((s) => s.key === 'ad_click_detail');
  assert.equal(head.rows[0].available, true);
  const rows = load.snapshots.find((s) => s.key === 'ad_click_detail_1').rows;
  assert.deepEqual(rows.map((r) => [r.device, r.network, r.kind, r.clicks]), [['MOBILE', 'GMAIL', 'image', 15], ['MOBILE', 'GMAIL', 'video', 4]]);
  failDetail = true;
  const again = await connectors.google_ads();
  assert.equal(again.metrics.find((r) => r.metric === 'ad_clicks').value, 19, 'campaign totals survive');
  assert.equal(again.snapshots.find((s) => s.key === 'ad_click_detail').rows[0].available, false);
});

test('GA4 sync adds go-host sessions by device for the networks with clicks only', async (t) => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  env(t, { GA4_PROPERTY_ID: '123', GA4_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'test@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) });
  const { connectors } = require('../lib/connectors');
  const row = (values, sessions) => ({ dimensionValues: values.map((value) => ({ value })), metricValues: [{ value: String(sessions) }] });
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (url.includes('oauth2.googleapis.com')) return response({ access_token: 'test' });
    const body = JSON.parse(opts.body);
    if ((body.dimensions || []).map((d) => d.name).join(',') === 'date,sessionManualSource,sessionManualMedium,sessionManualCampaignName,deviceCategory') {
      assert.equal(body.dimensionFilter.filter.stringFilter.value, 'go.think4ever.com');
      return response({ rowCount: 3, rows: [
        row(['20261112', 'google', 'cpc', 'early_builders_co_202611', 'mobile'], 386),
        row(['20261112', '(direct)', '(none)', '(not set)', 'mobile'], 50),
        row(['20261112', 'linkedin', 'social', '(not set)', 'mobile'], 20),
      ] });
    }
    return response({ rows: [] });
  });
  const load = await connectors.ga4();
  assert.equal(load.snapshots.find((s) => s.key === 'landing_device').rows[0].available, true);
  const rows = load.snapshots.find((s) => s.key === 'landing_device_1').rows;
  assert.deepEqual(rows.map((r) => [r.source, r.device, r.sessions]), [['google', 'mobile', 386], ['linkedin', 'mobile', 20]]);
});

test('The assistant receives the click split as counts only', () => {
  const safe = cleanOverviewFunnel({ window: 'Nov 10 – Nov 14', steps: [{ step: 'Clicks to the landing', value: 1044 }], click_split: {
    step2: { counted: 1044, open_page: 1044, no_page: 0, not_separable: 0 },
    networks: [{ network: 'Google Ads', all_clicks: 1044, do_not_open_page: 0, open_page: 1044, landing_sessions: 431, lost_after_click: 613, click_to_session: 0.41, devices: [{ device: 'Phone', open_page: 986, landing_sessions: 386, lost_after_click: 600, click_to_session: 0.39 }] }],
    paired_total: { network: 'Google Ads', open_page: 1044, landing_sessions: 431, lost_after_click: 613, click_to_session: 0.41 },
  } });
  const cs = safe.click_split;
  assert.equal(cs.networks[0].devices[0].lost_after_click, 600);
  assert.equal(cs.paired_total.landing_sessions, 431);
});

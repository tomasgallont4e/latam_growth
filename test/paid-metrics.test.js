'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const paid = require('../public/js/paid');

function dashboard() {
  const elements = new Map();
  const App = { views: {}, render() {}, store() {}, resolve: (x) => x, api: () => new Promise(() => {}), targets: { ensure() {}, strip: () => '' } };
  const context = vm.createContext({ window: { App }, location: { hash: '' }, document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { options: [{ value: 'day' }], addEventListener() {} });
      return elements.get(id);
    },
  } });
  for (const file of ['paid.js', 'ui.js', 'charts.js', 'views/social.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8'), context, { filename: file });
  }
  App.S.from = '2026-10-01'; App.S.to = '2026-10-28';
  App.S.data = { metrics: [], snapshots: [], events: [], sources: [] };
  return App;
}
const date = '2026-10-20';
const metric = (source, name, value, dim_value = '') => ({ source, metric: name, value, date, dim_value });
const available = (source, key) => ({ source, key, from: '2026-10-01', to: '2026-10-28', rows: [{ available: true }] });

test('paid matching accepts existing UTM variants and rejects QA and organic visits', () => {
  assert.equal(paid.platform('instagram', 'paid_social'), 'meta');
  assert.equal(paid.platform('LinkedIn', 'paid-social'), 'linkedin');
  assert.equal(paid.platform('google_ads', 'cpc'), 'google_ads');
  assert.equal(paid.platform('linkedin', 'qa'), null);
  assert.equal(paid.platform('linkedin', 'organic_social'), null);
  assert.equal(paid.platform('other', 'paid_social'), null);
  assert.equal(paid.cost(null, 50), null);
  assert.equal(paid.cost(50, 0), null);
  assert.equal(paid.cost(0, 50), 0);
});

test('costs use attributed forms and funded channels, never global product sign-ups', () => {
  const A = dashboard();
  A.S.data.metrics = [metric('meta', 'ad_spend', 100), metric('meta', 'ad_impressions', 10000), metric('meta', 'ad_link_clicks', 100),
    metric('meta', 'ad_clicks', 900), metric('ga4', 'ga_paid_sessions', 80, 'meta'), metric('ga4', 'ga_paid_sessions', 1000, 'linkedin'), metric('posthog', 'ph_new_persons', 500)];
  A.S.data.snapshots = [available('ga4', 'paid_sessions'), available('hubspot', 'utm_capture')];
  A.S.data.events = [
    { kind: 'form_signup', date, utm_source: 'instagram', utm_medium: 'paid_social' },
    { kind: 'form_signup', date, utm_source: 'facebook', utm_medium: 'paid-social' },
    { kind: 'form_signup', date, utm_source: 'instagram', utm_medium: 'paid_social', internal: true },
    { kind: 'form_signup', date, utm_source: 'linkedin', utm_medium: 'paid-social' },
    { kind: 'form_signup', date, utm_source: 'instagram', utm_medium: 'qa' },
  ];
  const stats = A.D.paidTotals();
  assert.equal(stats.clicks, 100);
  assert.equal(stats.cpm, 10);
  assert.equal(stats.cpc, 1);
  assert.equal(stats.sessions, 80);
  assert.equal(stats.costSession, 1.25);
  assert.equal(stats.forms, 2);
  assert.equal(stats.costForm, 50);
  assert.equal(A.D.paidStats('linkedin').spend, null);
  assert.equal(A.D.paidStats('linkedin').costForm, null);
  const html = A.views.social.render();
  assert.match(html, /Unit costs by paid channel/);
  assert.match(html, /Cost \/ attributed form sign-up/);
  assert.doesNotMatch(html, /Spend \/ total sign-ups|NaN|Infinity/);
});

test('missing reports and legacy Meta all-clicks do not become fake zeros or link clicks', () => {
  const A = dashboard();
  A.S.data.metrics = [metric('meta', 'ad_spend', 100), metric('meta', 'ad_clicks', 999)];
  const stats = A.D.paidStats('meta');
  for (const field of ['clicks', 'sessions', 'forms', 'cpc', 'costSession', 'costForm']) assert.equal(stats[field], null, field);
  assert.doesNotMatch(A.views.social.render(), /NaN|Infinity/);
  A.S.data.snapshots = [available('ga4', 'paid_sessions'), available('hubspot', 'utm_capture')];
  assert.equal(A.D.paidStats('meta').sessions, 0);
  assert.equal(A.D.paidStats('meta').forms, 0);
  assert.equal(A.D.paidStats('meta').costForm, null);
});

test('first-touch forms use a complete source/medium pair and respect internal filtering', () => {
  const A = dashboard();
  A.S.data.events = [{ kind: 'form_signup', date, first_utm_source: 'instagram', first_utm_medium: 'paid_social', utm_source: 'linkedin', utm_medium: 'paid_social', internal: true }];
  assert.equal(A.D.paidStats('meta').forms, 0);
  A.S.exInt = false;
  assert.equal(A.D.paidStats('meta').forms, 1);
  assert.equal(A.D.paidStats('linkedin').forms, 0);
});

test('PostHog click proxy is visible without implying confirmed creation or cohort conversion', () => {
  const A = dashboard();
  assert.equal(A.D.funnel().at(-1).n, null);
  A.S.data.metrics = [metric('posthog', 'ph_activated_users', 16)];
  const step = A.D.funnel().at(-1);
  assert.equal(step.n, 16);
  assert.match(step.name, /click proxy/);
  assert.equal(step.separate, true);
  assert.match(step.bridge, /not confirmed/);
});

function env(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}
const response = (data) => ({ ok: true, text: async () => JSON.stringify(data) });

test('Meta sync paginates link clicks and keeps country facts separate from campaign totals', async (t) => {
  env(t, { META_TOKEN: 'test-token', META_AD_ACCOUNT_ID: 'act_123' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(global, 'fetch', async (url) => {
    const u = new URL(url);
    if (u.searchParams.get('breakdowns') === 'country') return response({ data: [{ country: 'CO', date_start: date, spend: '60', impressions: '6000', inline_link_clicks: '50' }, { country: 'CO', date_start: date, spend: '40', impressions: '4000', inline_link_clicks: '30' }] });
    if (u.searchParams.has('after')) return response({ data: [{ campaign_name: 'Second', date_start: date, spend: '0', clicks: '20' }] });
    assert.match(u.searchParams.get('fields'), /inline_link_clicks/);
    return response({ data: [{ campaign_name: 'First', date_start: date, spend: '100', impressions: '10000', clicks: '1000', inline_link_clicks: '80' }], paging: { next: 'https://graph.facebook.com/test?after=next' } });
  });
  const load = await connectors.meta();
  const total = (name) => load.metrics.filter((r) => r.metric === name).reduce((n, r) => n + r.value, 0);
  assert.equal(total('ad_spend'), 100);
  assert.equal(total('ad_clicks'), 80);
  assert.equal(total('ad_link_clicks'), 80);
  assert.equal(total('ad_platform_clicks'), 1020);
  assert.equal(total('ad_spend_geo'), 100);
  assert.equal(total('ad_clicks_geo'), 80);
  assert.equal(load.metrics.filter((r) => r.metric === 'ad_clicks_geo').length, 1);
  assert.equal(load.metrics.find((r) => r.metric === 'ad_clicks_geo').dim_value, 'Colombia');
});

test('GA4 paginated source/medium report combines aliases before ingest and excludes QA', async (t) => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  env(t, { GA4_PROPERTY_ID: '123', GA4_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'test@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) });
  const { connectors } = require('../lib/connectors');
  const row = (source, medium, sessions) => ({ dimensionValues: ['20261020', source, medium].map((value) => ({ value })), metricValues: [{ value: String(sessions) }] });
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (url.includes('oauth2.googleapis.com')) return response({ access_token: 'test' });
    const body = JSON.parse(opts.body);
    if ((body.dimensions || []).map((d) => d.name).join(',') === 'date,sessionManualSource,sessionManualMedium') {
      return response({ rowCount: 4, rows: body.offset ? [row('linkedin', 'qa', 999), row('linkedin', 'paid-social', 15)] : [row('instagram', 'paid_social', 30), row('facebook', 'paid-social', 20)] });
    }
    return response({ rows: [] });
  });
  const load = await connectors.ga4();
  const rows = load.metrics.filter((r) => r.metric === 'ga_paid_sessions');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.dim_value === 'meta').value, 50);
  assert.equal(rows.find((r) => r.dim_value === 'linkedin').value, 15);
  assert.equal(load.snapshots.find((r) => r.key === 'paid_sessions').rows[0].available, true);
});

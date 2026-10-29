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
  App.testLoad = (file) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8'), context, { filename: file });
  for (const file of ['paid.js', 'measurement.js', 'ui.js', 'charts.js', 'views/social.js', 'views/overview.js', 'views/conversion.js', 'views/acquisition.js', 'app.js']) {
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
  assert.equal(stats.sessions, 1080); // Traffic is visible even for channels without an ad report.
  assert.equal(stats.costSession, 1.25);
  assert.equal(stats.forms, 3); // Costs still use only the funded-channel contacts below.
  assert.equal(stats.costForm, 50);
  assert.equal(A.D.paidStats('linkedin').spend, null);
  assert.equal(A.D.paidStats('linkedin').costForm, null);
  const html = A.views.social.render();
  assert.match(html, /unit costs by paid channel/);
  assert.match(html, /Cost \/ attributed CRM contact/);
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

function auditedDashboard() {
  const A = dashboard();
  A.S.data.metrics = [metric('hubspot', 'sessions', 1425), metric('ga4', 'ga_sessions', 1752), metric('ga4', 'ga_engaged_sessions', 508),
    { ...metric('posthog', 'ph_new_persons', 27, 'External'), dim: 'account_type' },
    { ...metric('posthog', 'ph_new_persons', 6, 'Internal'), dim: 'account_type' },
    { ...metric('posthog', 'ph_new_persons', 1, 'Unknown'), dim: 'account_type' }];
  A.S.data.events = Array.from({ length: 4 }, (_, i) => ({ kind: 'form_signup', date, utm_source: i < 3 ? 'instagram' : '', utm_medium: i < 3 ? 'paid_social' : '' }));
  A.S.data.goalPlan = { ...require('../lib/targets').DEFAULT_PLAN, impression_to_visit: 0.6 };
  A.S.data.snapshots = [available('posthog', 'people_coverage'), { source: 'ga4', key: 'totals', from: A.S.from, to: A.S.to, rows: [{ users: 1599, new_users: 1792 }] }];
  return A;
}

test('audited 4 CRM + 34 PostHog case never claims 38 verified accounts or 850% conversion', () => {
  const A = auditedDashboard();
  assert.equal(A.D.crmTotal(), 4);
  assert.equal(A.D.platform(), 28);
  assert.equal(A.D.signups(), null);
  assert.equal(A.D.actual('total_signups', A.S.from, A.S.to), null);
  assert.equal(A.D.actual('activation_7d', A.S.from, A.S.to), null);
  assert.equal(A.D.actual('visit_to_signup_rate', A.S.from, A.S.to), null);
  assert.equal(A.D.ga().rate, 508 / 1752);
  const conversion = A.views.conversion.render(), overview = A.views.overview.render();
  assert.match(conversion, /29\.0%/);
  assert.match(overview, /Verified actual pending/);
  assert.doesNotMatch(conversion + overview, /850|72\.1%|35\.6%|38 sign-ups|Weakest step|drop-off<|continue<|Direct Platform Sign-ups/);
  A.S.exInt = false;
  assert.equal(A.D.platform(), 34);
});

test('legacy unclassified people require resync for exclusion, rather than pretending internals were removed', () => {
  const A = dashboard();
  A.S.data.metrics = [metric('posthog', 'ph_new_persons', 34)];
  assert.equal(A.D.platform(), null);
  A.S.exInt = false;
  assert.equal(A.D.platform(), 34);
});

test('paid UTM sessions remain available without spend; QA and unknown contact attribution reconcile', () => {
  const A = dashboard();
  A.S.data.metrics = [metric('ga4', 'ga_paid_sessions', 1379, 'meta'), metric('ga4', 'ga_paid_sessions', 198, 'linkedin')];
  A.S.data.snapshots = [available('ga4', 'paid_sessions'), available('hubspot', 'utm_capture')];
  A.S.data.events = [
    { kind: 'form_signup', date, utm_source: 'instagram', utm_medium: 'paid_social' },
    { kind: 'form_signup', date, utm_source: 'linkedin', utm_medium: 'organic_social' },
    { kind: 'form_signup', date },
    { kind: 'form_signup', date, utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'qa_registro_28oct' },
  ];
  const totals = A.D.paidTotals();
  assert.equal(totals.sessions, 1577);
  assert.equal(totals.spend, null);
  assert.equal(totals.costSession, null);
  let contacts = A.D.contactAttribution();
  assert.equal(contacts.paid, 1); assert.equal(contacts.other, 1); assert.equal(contacts.unknown, 1); assert.equal(contacts.total, 3);
  A.S.exInt = false; contacts = A.D.contactAttribution();
  assert.equal(contacts.tests, 1);
  assert.equal(contacts.total, contacts.paid + contacts.other + contacts.unknown + contacts.tests);
  assert.match(A.views.social.render(), /1,577/);
});

test('country users require a deduplicated exact-window snapshot and never a daily sum', () => {
  const A = auditedDashboard();
  A.S.data.metrics.push(metric('ga4', 'ga_geo_users', 90, 'Colombia'));
  A.S.data.snapshots.push({ source: 'ga4', key: 'countries', from: A.S.from, to: A.S.to, rows: [{ country: 'Colombia', users: 30 }] });
  assert.equal(A.D.countryUsers('Colombia'), 30);
  assert.equal(A.D.countryUsers('Colombia', '2026-10-10', A.S.to), null);
  assert.equal(A.D.verified(A.S.from, A.S.to, 'Colombia'), null);
});

test('weekly and monthly grouping preserve counts; changing grouping does not reset the date range', () => {
  const A = auditedDashboard();
  for (const grain of ['day', 'week', 'month']) {
    A.S.grain = grain;
    const periods = A.D.periods();
    assert.equal(periods.reduce((n, p) => n + A.D.crmTotal(p.from, p.to), 0), 4);
    assert.equal(periods.reduce((n, p) => n + A.D.platform(p.from, p.to), 0), 28);
    assert.match(A.views.social.render(), new RegExp(A.D.grainName() + ' CRM contact attribution'));
  }
  A.setRange('2026-10-10', '2026-10-21');
  A.setGrain('day');
  assert.equal(A.S.from, '2026-10-10'); assert.equal(A.S.to, '2026-10-21');
  assert.equal(A.D.periods()[0].from, '2026-10-10');
});

test('plan flags 60% against 0.577% implied, without mutating saved targets', () => {
  const p = { ...require('../lib/targets').DEFAULT_PLAN, impression_to_visit: 0.6 };
  const before = JSON.stringify(p), check = require('../public/js/measurement').planCheck(p);
  assert.equal(check.issues.length, 1);
  assert.equal(check.issues[0].key, 'impression_to_visit');
  assert.equal(check.derived.impression_to_visit, 12438491 / 2157556427);
  assert.equal(check.countryTotal, 500000);
  assert.equal(JSON.stringify(p), before);
});

test('native GA4 new/total mismatch is visible, never clamped or silently recomputed', () => {
  const A = auditedDashboard(), ga = A.D.ga();
  assert.equal(ga.users, 1599); assert.equal(ga.newUsers, 1792); assert.equal(ga.userWarning, true);
  assert.match(A.views.acquisition.render(), /GA4 reporting needs review/);
});

test('verified-account actual needs a trusted report and cannot come from observed people', () => {
  const A = auditedDashboard();
  A.S.data.metrics.push({ ...metric('posthog', 'ph_verified_accounts', 7, 'External'), dim: 'account_type' });
  assert.equal(A.D.verified(), null);
  A.S.data.snapshots.push({ ...available('posthog', 'verified_accounts'), rows: [{ available: true, unit: 'verified_account' }] });
  assert.equal(A.D.verified(), 7);
  assert.match(A.views.overview.render(), /7 · 0\.001% of goal/);
  const coverage = A.S.data.snapshots.find((s) => s.key === 'verified_accounts').rows[0];
  coverage.country_complete = true;
  A.S.data.metrics.push({ ...metric('posthog', 'ph_verified_accounts_geo', 5, 'Colombia'), dim: 'country' });
  assert.equal(A.D.verified(A.S.from, A.S.to, 'Colombia'), 5);
  A.S.exInt = false;
  assert.equal(A.D.verified(A.S.from, A.S.to, 'Colombia'), null);
});

test('Targets uses the same canonical counts, keeps missing activation pending and treats costs lower-is-better', () => {
  const A = auditedDashboard(); A.testLoad('views/targets.js');
  assert.equal(A.targets.actual('total_signups', 'LATAM', A.S.from, A.S.to), null);
  assert.equal(A.targets.actual('total_signups', 'Colombia', A.S.from, A.S.to), null);
  assert.equal(A.targets.actual('activation_7d', 'LATAM', A.S.from, A.S.to), null);
  A.S.data.metrics.push(metric('meta', 'ad_spend', 100));
  A.targets.byMonth['2026-10|LATAM'] = [{ metric_key: 'cps', target_value: 60 }];
  A.ui.today = () => '2026-10-28';
  const goal = A.targets.goal('cps', '2026-10');
  assert.equal(goal.actual, 100 / 3); assert.equal(goal.projected, goal.actual); assert.equal(goal.status, 'green');
});

test('PostHog sync classifies people consistently and distinguishes failed Action from a successful zero', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test', POSTHOG_PROJECT_CREATED_ENABLED: '0' });
  const { connectors } = require('../lib/connectors'); let failAction = true;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    const sql = JSON.parse(opts.body).query.query;
    if (sql.includes('matchesAction')) return failAction ? { ok: false, text: async () => '504 query timed out' } : response({ results: [] });
    if (sql.includes('AS source,')) return response({ results: [[date, 'instagram', 'paid_social', 'launch', 'p01', 'External', 28], [date, '(not set)', '(not set)', '(not set)', '(not set)', 'Internal', 6]] });
    if (sql.includes(' AS c,')) return response({ results: [['Colombia', date, 'External', 28], ['Colombia', date, 'Internal', 6]] });
    if (sql.includes('AS account_type')) {
      assert.match(sql, /person\.properties\.email/); assert.match(sql, /person\.properties\.company/);
      return response({ results: [[date, 'External', 28], [date, 'Internal', 6]] });
    }
    return response({ results: [] });
  });
  const failed = await connectors.posthog();
  assert.equal(failed.metrics.filter((r) => r.metric === 'ph_new_persons').length, 2);
  assert.equal(failed.metrics.find((r) => r.metric === 'ph_new_persons' && r.dim_value === 'External').value, 28);
  assert.equal(failed.snapshots.find((r) => r.key === 'activation_action').rows[0].available, false);
  const A = dashboard(); A.S.data = { ...A.S.data, metrics: failed.metrics.map((r) => ({ ...r, source: 'posthog' })), snapshots: failed.snapshots.map((r) => ({ ...r, source: 'posthog' })) };
  assert.equal(A.D.platform(), 28); assert.equal(A.D.proxy(), null);
  failAction = false;
  const empty = await connectors.posthog();
  A.S.data.snapshots = empty.snapshots.map((r) => ({ ...r, source: 'posthog' }));
  assert.equal(A.D.proxy(), 0);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const paid = require('../public/js/paid');

test('Executive is the default tab unless the URL or a non-default saved tab selects another view', () => {
  assert.equal(dashboard().S.tab, 'executive');
  assert.equal(dashboard({ 't4e-growth-tab': 'overview' }).S.tab, 'executive');
  assert.equal(dashboard({ 't4e-growth-tab': 'conversion' }).S.tab, 'conversion');
  assert.equal(dashboard({}, '#acquisition').S.tab, 'acquisition');
});

test('Executive shows management outcomes and the campaign funnel', async () => {
  const A = dashboard();
  A.api = (url) => url.startsWith('api/executive?') ? Promise.resolve({
    month: new URL(url, 'http://localhost').searchParams.get('month'),
    view: { outcomes: {
      accountsCreated: { value: 8, status: 'loaded', event: 'account_created' },
      projectsCreated: { value: 5, status: 'loaded', event: 'project_created' },
      activation14d: { value: null, status: 'pending', reason: 'No verified shared identity key.' },
    }, cards: { signups: { status: 'pending' }, spend: { status: 'pending' } } },
  }) : new Promise(() => {});
  A.views.executive.render();
  await new Promise((resolve) => setImmediate(resolve));
  const html = A.views.executive.render();
  assert.match(html, /Accounts created/);
  assert.match(html, /8/);
  assert.match(html, /Projects created/);
  assert.match(html, /5/);
  assert.match(html, /No verified shared identity key/);
  assert.match(html, /Campaign funnel/);
  assert.doesNotMatch(html, /Visit to sign-up rate|Cost per sign-up/);
});

test('Executive renders separate management indicators and no mixed/source funnel', async () => {
  const A = dashboard();
  A.api = (url) => Promise.resolve({
    month: new URL(url, 'http://localhost').searchParams.get('month'),
    view: { cutoff: '2026-11-03', cards: {
      signups: { status: 'loaded', value: 12, lines: [] },
      spend: { status: 'pending', reason: 'Ads sources pending' },
    }, outcomes: {
      accountsCreated: { status: 'loaded', value: 8, reason: null },
      projectsCreated: { status: 'loaded', value: 5, reason: null },
      activation14d: { status: 'pending', reason: 'No verified shared identity key.' },
    }, changed: { phrases: [] } },
  });
  A.views.executive.render();
  await new Promise((resolve) => setImmediate(resolve));
  const html = A.views.executive.render();
  for (const label of ['Management indicators', 'Sign-ups target progress', 'Ads spend', 'Accounts created', 'Projects created', '14-day project activation', 'What changed']) assert.ok(html.includes(label), label);
  assert.match(html, /No verified shared identity key/);
  assert.match(html, /Campaign funnel/);
  assert.match(html, /Marketing-to-Project Activation Funnel/);
  assert.doesNotMatch(html, /Visit to sign-up rate|Cost per sign-up/);
});

test('Executive renders known PostHog sign-ups and social spend with coverage caveats', async () => {
  const A = dashboard();
  A.api = (url) => Promise.resolve({
    month: new URL(url, 'http://localhost').searchParams.get('month'),
    view: {
      cards: {
        signups: { status: 'loaded', value: 5, lines: ['Under review: Unclassified first-identify hosts are excluded.'], underReview: { label: 'Under review', reason: 'Unclassified first-identify hosts are excluded.' } },
        sinceLaunch: { status: 'loaded', value: 5, lines: ['LATAM 5 · Outside LATAM 0', 'since Oct 1, 2026', 'Under review: Unclassified first-identify hosts are excluded.'], underReview: { label: 'Under review', reason: 'Unclassified first-identify hosts are excluded.' } },
        spend: { status: 'loaded', value: 20.27, complete: false, underReview: { label: 'Under review', reason: 'LinkedIn has not reported.' }, lines: ['Meta US$20.27', 'LinkedIn · No data yet'] },
        cps: { status: 'pending', reason: 'spend incomplete' },
        visit: { status: 'pending', reason: 'PostHog host coverage incomplete', underReview: { label: 'Under review', reason: 'Unclassified first-identify hosts are excluded.' } },
      },
      chart: { certified: true, note: 'Under review: Unclassified first-identify hosts are excluded.', days: [], sinceLaunch: [], underReview: { label: 'Under review', reason: 'Unclassified first-identify hosts are excluded.' } },
      countries: { status: 'pending', rows: [] },
      executiveAccounts: { sinceLaunch: 8, byPlan: { status: 'pending' } },
      allAccounts: { status: 'loaded', month: 20, sinceLaunch: 27, monthByType: { External: 18, Unknown: 1, Internal: 1 }, byType: { External: 22, Unknown: 2, Internal: 3 }, dataThrough: '2026-11-04' },
      funnel: { steps: [], note: '' },
      changed: { phrases: [] },
    },
  });
  A.views.executive.render();
  await new Promise((resolve) => setImmediate(resolve));
  const html = A.views.executive.render();
  assert.match(html, /Sign-ups target progress/);
  assert.match(html, /Ads spend/);
  assert.match(html, /Under review · Unclassified first-identify hosts are excluded/);
  assert.match(html, /LinkedIn has not reported/);
  assert.match(html, /Accounts created/);
  assert.match(html, /Projects created/);
});

test('Executive view keeps the monthly sign-up KPI and pending outcomes separate', async () => {
  const A = dashboard();
  A.api = (url) => Promise.resolve({
    month: new URL(url, 'http://localhost').searchParams.get('month'),
    view: { cutoff: '2026-11-03', cards: { signups: { status: 'loaded', value: 4, lines: [], pace: 'trailing' }, spend: { status: 'pending', reason: 'Ads pending', lines: [] } },
      outcomes: { accountsCreated: { status: 'pending', reason: 'account_created coverage unavailable.' }, projectsCreated: { status: 'pending', reason: 'project_created coverage unavailable.' }, activation14d: { status: 'pending', reason: 'No verified shared identity key.' } }, changed: { phrases: [] } },
  });
  A.views.executive.render(); await new Promise((resolve) => setImmediate(resolve));
  const html = A.views.executive.render();
  assert.match(html, /Sign-ups target progress/);
  assert.match(html, /Accounts created/);
  assert.match(html, /Projects created/);
  assert.match(html, /14-day project activation/);
  assert.match(html, /account_created coverage unavailable/);
  assert.match(html, /No verified shared identity key/);
  assert.match(html, /Campaign funnel/);
  assert.match(html, /Marketing-to-Project Activation Funnel/);
  assert.doesNotMatch(html, /Goal 30,000 · Proposal/);
});

function dashboard(stored = {}, hash = '') {
  const elements = new Map();
  const App = { views: {}, render() {}, store: (key) => stored[key], resolve: (x) => x, api: () => new Promise(() => {}), targets: { ensure() {}, strip: () => '' } };
  const context = vm.createContext({ window: { App }, location: { hash }, document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { options: [{ value: 'day' }], addEventListener() {} });
      return elements.get(id);
    },
  } });
  App.testLoad = (file) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8'), context, { filename: file });
  for (const file of ['paid.js', 'measurement.js', 'ui.js', 'charts.js', 'funnels.js', 'aggregate.js', 'assistant.js', 'views/social.js', 'views/landing.js', 'views/overview.js', 'views/executive.js', 'views/conversion.js', 'views/acquisition.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8'), context, { filename: file });
  }
  App.S.from = '2026-10-01'; App.S.to = '2026-10-28';
  App.S.data = { metrics: [], snapshots: [], events: [], sources: [] };
  return App;
}
const date = '2026-10-20';
const metric = (source, name, value, dim_value = '') => ({ source, metric: name, value, date, dim_value });
const available = (source, key) => ({ source, key, from: '2026-10-01', to: '2026-10-28', rows: [{ available: true }] });

test('metric corrections preserve the goal, channel and conversion charts', () => {
  const A = dashboard();
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  A.S.data.metrics = [metric('hubspot', 'sessions', 10, 'direct')];
  A.S.data.events = [{ kind: 'form_signup', date, internal: false }];
  const overview = A.views.overview.render(), conversion = A.views.conversion.render();
  assert.match(overview, /LATAM 500K goal/);
  assert.match(overview, /sign-ups once per person/);
  assert.match(conversion, /Sign-ups/);
  assert.doesNotMatch(overview + conversion, /Confirmed accounts created/);
  assert.doesNotMatch(overview, /Plan needs review/);
  assert.match(conversion, /Daily registration starts and sign-ups/);
  assert.doesNotMatch(overview, /class="goal-col"/);
  const realZero = A.charts.goalProgress({ dates: ['2026-10-01'], values: [0], goal: 500000 });
  assert.match(realZero, /class="goal-dot"/);
});

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

test('GA4 Executive geo sessions use only go.think4ever.com without narrowing shared host reports', async (t) => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  env(t, {
    GA4_PROPERTY_ID: '123',
    GA4_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'test@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
    SITE_HOSTS: 'think4ever.com,www.think4ever.com,go.think4ever.com,portal.think4ever.com',
  });
  const { connectors } = require('../lib/connectors');
  const reports = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (url.includes('oauth2.googleapis.com')) return response({ access_token: 'test' });
    const body = JSON.parse(opts.body);
    reports.push(body);
    const dimensions = (body.dimensions || []).map((d) => d.name).join(',');
    const hostFilter = body.dimensionFilter && body.dimensionFilter.filter;
    if (dimensions === 'date,country' && hostFilter && hostFilter.stringFilter?.value === 'go.think4ever.com') {
      return response({ rows: [{ dimensionValues: [{ value: '20261020' }, { value: 'Colombia' }], metricValues: [{ value: '42' }, { value: '18' }] }] });
    }
    return response({ rows: [] });
  });

  const load = await connectors.ga4();
  const goReport = reports.find((body) => body.dimensionFilter?.filter?.stringFilter?.value === 'go.think4ever.com');
  const sharedReport = reports.find((body) => body.dimensionFilter?.filter?.inListFilter);
  assert.ok(goReport, 'Executive geo report should explicitly filter the confirmed landing hostname');
  assert.deepEqual(goReport.dimensions.map((d) => d.name), ['date', 'country']);
  assert.ok(sharedReport, 'existing GA4 reports must continue using the shared SITE_HOSTS allowlist');
  assert.deepEqual(sharedReport.dimensionFilter.filter.inListFilter.values, ['think4ever.com', 'www.think4ever.com', 'go.think4ever.com', 'portal.think4ever.com']);
  assert.equal(load.source, 'ga4');
  assert.deepEqual(load.metrics.find((r) => r.metric === 'ga_exec_geo_sessions'), {
    metric: 'ga_exec_geo_sessions', date: '2026-10-20', dim: 'country', dim_value: 'Colombia', value: 42,
  });
});

test('GA4 landing people are deduplicated go-host users per fixed window, never summed days', async (t) => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  env(t, { GA4_PROPERTY_ID: '123', GA4_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'test@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) });
  const { connectors } = require('../lib/connectors');
  const calls = [];
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (url.includes('oauth2.googleapis.com')) return response({ access_token: 'test' });
    const body = JSON.parse(opts.body);
    const go = body.dimensionFilter?.filter?.stringFilter?.value === 'go.think4ever.com';
    if (go && !body.dimensions && (body.metrics || []).some((m) => m.name === 'totalUsers')) {
      calls.push(body.dateRanges[0]);
      return response({ rows: [{ metricValues: [{ value: '37' }, { value: '30' }] }] });
    }
    return response({ rows: [] });
  });
  const load = await connectors.ga4();
  const snaps = load.snapshots.filter((s) => s.key === 'landing_people');
  assert.ok(snaps.length >= 3, 'launch-to-date plus 7/28-day windows');
  assert.ok(snaps.every((s) => s.rows[0].available === true && s.rows[0].users === 37 && s.rows[0].host === 'go.think4ever.com'));
  assert.equal(calls.length, snaps.length, 'one deduplicated query per window');
  assert.equal(load.metrics.some((r) => r.metric === 'ga_landing_people'), false, 'no additive daily series');
});

test('GA4 go-host report success with no rows is a measured zero with explicit coverage', async (t) => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  env(t, { GA4_PROPERTY_ID: '123', GA4_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'test@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) });
  const { connectors } = require('../lib/connectors');
  t.mock.method(global, 'fetch', async (url) => url.includes('oauth2.googleapis.com') ? response({ access_token: 'test' }) : response({ rows: [] }));
  const load = await connectors.ga4();
  const coverage = load.snapshots.find((r) => r.key === 'executive_landing');
  assert.equal(coverage.rows[0].available, true);
  assert.equal(coverage.rows[0].country_available, false);
  assert.equal(coverage.rows[0].form_start_available, true);
  assert.equal(load.metrics.some((r) => r.metric === 'ga_exec_geo_sessions'), false);
});

test('GA4 go-host form starts are a separate series and do not replace shared events', async (t) => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  env(t, { GA4_PROPERTY_ID: '123', GA4_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'test@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) });
  const { connectors } = require('../lib/connectors');
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (url.includes('oauth2.googleapis.com')) return response({ access_token: 'test' });
    const body = JSON.parse(opts.body);
    const names = (body.dimensions || []).map((d) => d.name).join(',');
    const grouped = body.dimensionFilter && body.dimensionFilter.andGroup;
    if (names === 'date' && grouped) {
      return response({ rows: [{ dimensionValues: [{ value: '20261020' }], metricValues: [{ value: '7' }] }] });
    }
    if (names === 'date,eventName') {
      return response({ rows: [{ dimensionValues: [{ value: '20261020' }, { value: 'form_start' }], metricValues: [{ value: '80' }, { value: '80' }] }] });
    }
    return response({ rows: [] });
  });
  const load = await connectors.ga4();
  assert.deepEqual(load.metrics.find((row) => row.metric === 'ga_exec_form_starts'), { metric: 'ga_exec_form_starts', date: '2026-10-20', value: 7 });
  assert.equal(load.metrics.find((row) => row.metric === 'ga_event' && row.dim_value === 'form_start').value, 80);
  assert.equal(load.snapshots.find((row) => row.key === 'executive_landing').rows[0].form_start_available, true);
});

test('GA4 go-host report failure leaves Executive pending without breaking shared reports', async (t) => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  env(t, { GA4_PROPERTY_ID: '123', GA4_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'test@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  const reports = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (url.includes('oauth2.googleapis.com')) return response({ access_token: 'test' });
    const body = JSON.parse(opts.body); reports.push(body);
    if (body.dimensionFilter?.filter?.stringFilter?.value === 'go.think4ever.com') throw new Error('simulated go-host report failure');
    if ((body.dimensions || []).map((d) => d.name).join(',') === 'date,sessionDefaultChannelGroup') {
      return response({ rows: [{ dimensionValues: [{ value: '20261020' }, { value: 'Organic Search' }], metricValues: [{ value: '25' }, { value: '10' }] }] });
    }
    return response({ rows: [] });
  });
  const load = await connectors.ga4();
  const coverage = load.snapshots.find((r) => r.key === 'executive_landing');
  assert.equal(coverage.rows[0].available, false);
  assert.equal(load.metrics.find((r) => r.metric === 'ga_sessions').value, 25);
  assert.ok(reports.some((body) => body.dimensionFilter?.filter?.inListFilter), 'shared SITE_HOSTS reports should still run');
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
  assert.match(overview, /LATAM 500K goal · .*Monthly · .*sign-ups once per person \(first \$identify/);
  assert.doesNotMatch(conversion + overview, /850|72\.1%|35\.6%|38 sign-ups|Direct Platform Sign-ups/);
  assert.doesNotMatch(conversion, /Weakest step|drop-off<|continue</);
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

test('period comparison uses the last two fully covered buckets for each selected grain', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-29'; A.S.grain = 'day';
  let compare = A.D.completeBucketComparison();
  assert.deepEqual([compare.previous.from, compare.previous.to, compare.current.from, compare.current.to], ['2026-10-27', '2026-10-27', '2026-10-28', '2026-10-28']);
  A.S.grain = 'week'; compare = A.D.completeBucketComparison();
  assert.deepEqual([compare.previous.from, compare.previous.to, compare.current.from, compare.current.to], ['2026-10-12', '2026-10-18', '2026-10-19', '2026-10-25']);
  A.S.grain = 'biweek'; assert.equal(A.D.completeBucketComparison(), null);
  A.S.grain = 'month'; assert.equal(A.D.completeBucketComparison(), null);
  A.S.from = '2026-10-20'; A.S.to = '2026-10-29'; A.S.grain = 'week'; compare = A.D.completeBucketComparison();
  assert.deepEqual([compare.previous.from, compare.previous.to, compare.current.from, compare.current.to], ['2026-10-12', '2026-10-18', '2026-10-19', '2026-10-25']);
  const goalCompare = A.D.completeBucketComparison('2026-10-01', '2026-10-29', 'week', '2026-10-29');
  assert.deepEqual([goalCompare.previous.label, goalCompare.current.label], ['Oct 12–18', 'Oct 19–25']);
  assert.equal(A.D.periods('2026-10-01', '2026-10-28')[0].label, 'Oct 1–4');
});

test('Overview opens with the 500K goal hero and section links, without the old three key cards', () => {
  const A = dashboard();
  A.S.from = '2026-10-01'; A.S.to = '2026-10-28';
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  A.S.data.metrics = [
    { ...metric('posthog', 'ph_accounts', 21, 'External'), dim: 'account_type' },
    { ...metric('posthog', 'ph_accounts', 9, 'Internal'), dim: 'account_type' },
  ];
  A.S.data.snapshots.push({ ...available('posthog', 'account_coverage'), rows: [{ available: true }] });
  const html = A.views.overview.render();
  assert.doesNotMatch(html, /overview-key-card|People on the landing|three key numbers/);
  assert.match(html, /acct-hero-card/);
  assert.match(html, /LATAM 500K goal/);
  assert.match(html, /Monthly history/);
  assert.match(html, /class="ov-links"/);
  for (const go of ['acquisition', 'conversion', 'product', 'executive', 'targets']) assert.ok(html.includes(`data-go="${go}"`), go);
  assert.doesNotMatch(html, /Visit-to-sign-up|conversion rate|Campaign funnel/i);
});

test('Overview 7-step funnel shows % between steps, the weakest step and the country split', () => {
  const A = dashboard();
  A.S.from = '2026-10-01'; A.S.to = '2026-10-28';
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  A.S.data.metrics = [
    { ...metric('meta', 'ad_impressions', 9000, 'launch'), dim: 'campaign' },
    { ...metric('google_ads', 'ad_impressions', 1000, 'search'), dim: 'campaign' },
    { ...metric('meta', 'ad_outbound_clicks', 150, 'launch'), dim: 'campaign' },
    { ...metric('google_ads', 'ad_clicks', 50, 'search'), dim: 'campaign' },
    { ...metric('ga4', 'ga_exec_geo_sessions', 120, 'Colombia'), dim: 'country' },
    { ...metric('posthog', 'ph_accounts', 21, 'External'), dim: 'account_type' },
    { ...metric('posthog', 'ph_accounts', 9, 'Internal'), dim: 'account_type' },
    { ...metric('posthog', 'ph_accounts_geo', 12, 'Colombia'), dim: 'country' },
    { ...metric('posthog', 'ph_event', 7, 'project_created'), dim: 'event' },
  ];
  A.S.data.snapshots.push({ ...available('posthog', 'account_coverage'), rows: [{ available: true }] });
  const html = A.views.overview.render();
  assert.match(html, /Funnel · 7 steps/);
  assert.match(html, /Logins/);
  assert.match(html, /No signed_in event is synced yet/);
  assert.doesNotMatch(html, /Credits loaded/);
  assert.match(html, /Weakest step/);
  assert.match(html, /continue</);
  assert.match(html, /id="goal-country"/);
  A.S.overviewCountry = 'Colombia';
  const country = A.views.overview.render();
  assert.match(country, /Not split by country/);
  assert.match(country, /option value="Colombia" selected/);
});

test('Overview shows the monthly 500K chart: one clickable bar per month, selected month highlighted', () => {
  const A = dashboard();
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  const html = A.views.overview.render();
  assert.match(html, /goal-month-svg/);
  const bars = html.match(/data-goal-month="\d{4}-\d{2}"/g) || [];
  assert.equal(bars.length, A.months().length);
  const first = A.months()[0].id;
  assert.match(A.goalMonthChart(first), new RegExp(`gm-bar is-sel" data-goal-month="${first}"`));
});

test('global Month sets From/To to the whole calendar month so every view and funnel filters by it', () => {
  const A = dashboard();
  A.ui.today = () => '2026-11-15';
  const oct = A.monthRange('2026-10'), nov = A.monthRange('2026-11');
  assert.equal(oct.from, '2026-10-01'); assert.equal(oct.to, '2026-10-31');
  assert.equal(nov.from, '2026-11-01'); assert.equal(nov.to, '2026-11-15', 'current month is capped at today');
  A.S.data.metrics = [metric('meta', 'ad_impressions', 1000), { ...metric('meta', 'ad_impressions', 500), date: '2026-10-30' }];
  assert.equal(A.D.paidTotals().impressions, 1000, 'harness range Oct 1-28 leaves Oct 30 out');
  A.setGoalMonth('2026-10');
  assert.equal(A.S.goalMonth, '2026-10');
  assert.equal(A.S.from, '2026-10-01'); assert.equal(A.S.to, '2026-10-31');
  assert.equal(A.D.paidTotals().impressions, 1500, 'the Month now drives every From/To-based number');
  A.S.grain = 'day';
  assert.equal(A.D.periods()[0].from, '2026-10-01');
  assert.equal(A.isMonthRange(), true);
  A.setRange('2026-10-10', '2026-10-21');
  assert.equal(A.isMonthRange(), false, 'hand-edited days are a custom range');
  assert.equal(A.D.paidTotals().impressions, 1000);
  A.setGoalMonth('2026-10');
  assert.equal(A.S.from, '2026-10-01'); assert.equal(A.S.to, '2026-10-31');
});

test('Overview and Acquisition compare the two latest complete buckets, not a partial current bucket', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-29'; A.S.grain = 'day';
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  const daily = (source, name, value, day, dim = '', dim_value = '') => ({ source, metric: name, value, date: day, dim, dim_value });
  A.S.data.metrics = [
    daily('ga4', 'ga_sessions', 100, '2026-10-27'), daily('ga4', 'ga_sessions', 150, '2026-10-28'),
    daily('ga4', 'ga_engaged_sessions', 50, '2026-10-27'), daily('ga4', 'ga_engaged_sessions', 90, '2026-10-28'),
    daily('hubspot', 'sessions', 10, '2026-10-27'), daily('hubspot', 'sessions', 20, '2026-10-28'),
  ];
  const overview = A.views.overview.render(), acquisition = A.views.acquisition.render();
  assert.match(overview, /data-go="acquisition"/);
  assert.match(overview, /Last complete Daily period vs previous/);
  assert.match(acquisition, /Last complete Daily period vs previous/);
  assert.match(acquisition, /\+10\.0 pp/);
});

test('Acquisition KPI strip shows last-complete-period deltas while preserving range totals', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-29'; A.S.grain = 'day';
  const row = (metricName, value, date, channel) => ({ source: 'ga4', metric: metricName, value, date, dim: channel ? 'channel' : '', dim_value: channel || '' });
  A.S.data.metrics = [
    row('ga_sessions', 100, '2026-10-27', 'Organic Search'), row('ga_engaged_sessions', 50, '2026-10-27', 'Organic Search'), row('ga_new_users', 5, '2026-10-27'),
    row('ga_sessions', 150, '2026-10-28', 'Paid Social'), row('ga_engaged_sessions', 90, '2026-10-28', 'Paid Social'), row('ga_new_users', 8, '2026-10-28'),
  ];
  const html = A.views.acquisition.render();
  const comparisonSection = html.indexOf('Last complete Daily period vs previous');
  const kpis = html.slice(0, comparisonSection);
  assert.match(kpis, /title="250">250/);
  assert.match(kpis, /\+50\.0%/);
  assert.match(kpis, /\+60\.0%/);
  assert.match(kpis, /\+10\.0 pp/);
  assert.match(kpis, /per-bucket delta needs exact snapshots/);
  assert.match(kpis, /Latest complete Daily: Paid Social/);
  assert.match(kpis, /previous Daily: Organic Search/);
});

test('Acquisition KPI deltas remain visible when the selected range has no daily facts', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-10'; A.S.grain = 'day';
  const row = (metricName, value, date, channel) => ({ source: 'ga4', metric: metricName, value, date, dim: channel ? 'channel' : '', dim_value: channel || '' });
  A.S.data.metrics = [
    row('ga_sessions', 100, '2026-10-27', 'Organic Search'), row('ga_engaged_sessions', 50, '2026-10-27', 'Organic Search'), row('ga_new_users', 5, '2026-10-27'),
    row('ga_sessions', 150, '2026-10-28', 'Paid Social'), row('ga_engaged_sessions', 90, '2026-10-28', 'Paid Social'), row('ga_new_users', 8, '2026-10-28'),
  ];
  const html = A.views.acquisition.render();
  const comparisonSection = html.indexOf('Last complete Daily period vs previous');
  const kpis = html.slice(0, comparisonSection);
  assert.match(kpis, /\+50\.0%/);
  assert.match(kpis, /\+60\.0%/);
  assert.match(kpis, /\+10\.0 pp/);
  assert.match(kpis, /Latest complete Daily: Paid Social/);
  assert.match(kpis, /previous Daily: Organic Search/);
});

test('Acquisition GA4 sessions KPI shows a sparkline rolled up to the selected grain', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-30';
  A.S.from = '2026-10-19'; A.S.to = '2026-10-29'; A.S.grain = 'week';
  A.S.data.metrics = [
    { source: 'ga4', metric: 'ga_sessions', value: 100, date: '2026-10-20', dim: 'channel', dim_value: 'Organic Search' },
    { source: 'ga4', metric: 'ga_sessions', value: 40, date: '2026-10-27', dim: 'channel', dim_value: 'Paid Social' },
  ];
  const html = A.views.acquisition.render();
  const kpis = html.slice(0, html.indexOf('Last complete Weekly period vs previous'));
  const sessions = kpis.slice(kpis.indexOf('GA4 sessions'), kpis.indexOf('Unique visitors'));
  assert.match(sessions, /title="140">140/);
  assert.match(sessions, /class="sparkline"/);
  assert.match(sessions, /points="2\.0,5\.0 94\.0,27\.0"/);
});

test('Acquisition unique-visitor delta uses exact snapshots for both complete buckets', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-29'; A.S.grain = 'day';
  const row = (metricName, value, date, channel) => ({ source: 'ga4', metric: metricName, value, date, dim: channel ? 'channel' : '', dim_value: channel || '' });
  A.S.data.metrics = [
    row('ga_sessions', 100, '2026-10-27', 'Organic Search'), row('ga_engaged_sessions', 50, '2026-10-27', 'Organic Search'),
    row('ga_sessions', 150, '2026-10-28', 'Paid Social'), row('ga_engaged_sessions', 90, '2026-10-28', 'Paid Social'),
  ];
  A.S.data.snapshots = [
    { source: 'ga4', key: 'totals', from: A.S.from, to: A.S.to, rows: [{ users: 500, sessions: 250, engaged_sessions: 140, new_users: 13 }] },
    { source: 'ga4', key: 'totals', from: '2026-10-27', to: '2026-10-27', rows: [{ users: 80, sessions: 100, engaged_sessions: 50, new_users: 5 }] },
    { source: 'ga4', key: 'totals', from: '2026-10-28', to: '2026-10-28', rows: [{ users: 110, sessions: 150, engaged_sessions: 90, new_users: 8 }] },
  ];
  const html = A.views.acquisition.render();
  const kpis = html.slice(0, html.indexOf('Last complete Daily period vs previous'));
  const unique = kpis.slice(kpis.indexOf('Unique visitors'), kpis.indexOf('New users'));
  assert.match(unique, /title="500">500/);
  assert.match(unique, /\+37\.5%/);
  assert.match(unique, /Latest complete daily: Oct 28 vs Oct 27/);
});

test('Acquisition withholds unique-visitor delta when one complete bucket lacks an exact snapshot', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-29'; A.S.grain = 'day';
  A.S.data.metrics = [
    { source: 'ga4', metric: 'ga_sessions', value: 100, date: '2026-10-27', dim: 'channel', dim_value: 'Organic Search' },
    { source: 'ga4', metric: 'ga_sessions', value: 150, date: '2026-10-28', dim: 'channel', dim_value: 'Paid Social' },
  ];
  A.S.data.snapshots = [
    { source: 'ga4', key: 'totals', from: A.S.from, to: A.S.to, rows: [{ users: 500, sessions: 250, engaged_sessions: 0, new_users: 0 }] },
    { source: 'ga4', key: 'totals', from: '2026-10-28', to: '2026-10-28', rows: [{ users: 110, sessions: 150, engaged_sessions: 0, new_users: 8 }] },
  ];
  const html = A.views.acquisition.render();
  const kpis = html.slice(0, html.indexOf('Last complete Daily period vs previous'));
  const unique = kpis.slice(kpis.indexOf('Unique visitors'), kpis.indexOf('New users'));
  assert.match(unique, /title="500">500/);
  assert.match(unique, /No comparison for this period/);
  assert.match(unique, /per-bucket change requires exact snapshots/);
});

test('Acquisition channel engagement detail follows the selected period buckets', () => {
  const A = dashboard();
  A.S.from = '2026-10-19'; A.S.to = '2026-10-29'; A.S.grain = 'week'; A.ui.today = () => '2026-10-30';
  const row = (name, value, channel, day) => ({ ...metric('ga4', name, value, channel), date: day, dim: 'channel' });
  A.S.data.metrics = [
    row('ga_sessions', 100, 'Paid Social', '2026-10-20'), row('ga_engaged_sessions', 50, 'Paid Social', '2026-10-20'),
    row('ga_sessions', 40, 'Organic Search', '2026-10-27'), row('ga_engaged_sessions', 30, 'Organic Search', '2026-10-27'),
  ];
  const html = A.views.acquisition.render();
  assert.match(html, /GA4 channel engagement by period/);
  assert.match(html, /Oct 19–25/);
  assert.match(html, /Oct 26–29/);
  assert.match(html, /Paid Social/);
  assert.match(html, /Organic Search/);
});

test('Acquisition groups HubSpot, UTM and country detail by period without summing daily unique users', () => {
  const A = dashboard(); A.S.from = '2026-10-19'; A.S.to = '2026-10-29'; A.S.grain = 'week'; A.ui.today = () => '2026-10-30';
  const m = (source, metricName, value, date, dim, dim_value) => ({ source, metric: metricName, value, date, dim, dim_value });
  A.S.data.metrics = [
    m('hubspot', 'sessions', 12, '2026-10-20', 'source', 'Organic Search'),
    m('hubspot', 'sessions', 7, '2026-10-27', 'source', 'Organic Search'),
    m('hubspot', 'bounces', 3, '2026-10-20', 'source', 'Organic Search'),
    m('ga4', 'ga_geo_sessions', 8, '2026-10-20', 'country', 'Colombia'),
    m('ga4', 'ga_geo_users', 6, '2026-10-20', 'country', 'Colombia'),
    m('ga4', 'ga_geo_sessions', 5, '2026-10-27', 'country', 'Colombia'),
    m('ga4', 'ga_geo_users', 4, '2026-10-27', 'country', 'Colombia'),
  ];
  const rows = [
    { date: '2026-10-20', campaign: 'launch', source: 'google', medium: 'cpc', content: 'p01_video', landing_page: '/home?utm_source=google', sessions: 4, engaged_sessions: 2, key_events: 1 },
    { date: '2026-10-27', campaign: 'launch', source: 'google', medium: 'cpc', content: 'p01_video', landing_page: '/home', sessions: 3, engaged_sessions: 2, key_events: 0 },
  ];
  A.S.data.snapshots = [{ source: 'ga4', key: 'utm_attribution', from: A.S.from, to: A.S.to, rows }];
  const html = A.views.acquisition.render();
  assert.match(html, /HubSpot sessions by source and period/);
  assert.match(html, /UTM campaigns by period \(GA4\)/);
  assert.match(html, /Entry pages by period \(GA4\)/);
  assert.match(html, /Countries by period \(GA4\)/);
  assert.match(html, /Oct 19–25/); assert.match(html, /Oct 26–29/);
  assert.match(html, /Colombia/); assert.match(html, /p01_video/);
  assert.match(html, /daily unique-user counts are not summed/);
});

test('Acquisition row caps keep the highest-volume entries within the newest period', () => {
  const A = dashboard(); A.S.from = '2026-10-19'; A.S.to = '2026-10-29'; A.S.grain = 'week'; A.ui.today = () => '2026-10-30';
  const rows = Array.from({ length: 102 }, (_, i) => ({
    date: '2026-10-27', campaign: `campaign-${String(i).padStart(3, '0')}`, source: 'google', medium: 'cpc', content: 'p01',
    landing_page: `/page-${String(i).padStart(3, '0')}`, sessions: i + 1, engaged_sessions: i, key_events: 0,
  }));
  A.S.data.snapshots = [{ source: 'ga4', key: 'utm_attribution', from: A.S.from, to: A.S.to, rows }];
  const html = A.views.acquisition.render();
  assert.match(html, /campaign-101/); assert.doesNotMatch(html, /campaign-000/);
  assert.match(html, /page-101/); assert.doesNotMatch(html, /page-000/);
  assert.match(html, /Showing the latest 100 of 102 campaign-period rows/);
});

test('comparison treats an absent daily session row as zero but withholds a rate delta without a baseline', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-29'; A.S.grain = 'day';
  A.S.data.metrics = [
    { ...metric('ga4', 'ga_sessions', 25), date: '2026-10-28' },
    { ...metric('ga4', 'ga_engaged_sessions', 15), date: '2026-10-28' },
  ];
  const html = A.views.acquisition.render();
  assert.match(html, /Oct 27: 0/);
  assert.match(html, />new<\/span>/);
  assert.match(html, /Oct 27: –/);
  assert.match(html, /No comparison for this period/);
});

test('partial UTM snapshot coverage is disclosed when grouping dated rows', () => {
  const A = dashboard(); A.S.from = '2026-10-19'; A.S.to = '2026-10-29'; A.S.grain = 'week';
  A.S.data.snapshots = [{ source: 'ga4', key: 'utm_attribution', from: '2026-10-20', to: A.S.to, rows: [
    { date: '2026-10-20', campaign: 'launch', source: 'google', medium: 'cpc', content: 'p01', landing_page: '/home', sessions: 5, engaged_sessions: 3, key_events: 1 },
  ] }];
  const html = A.views.acquisition.render();
  assert.match(html, /Stored snapshot coverage does not span the full selected range, so some buckets may be partial/);
  assert.match(html, /snapshot Oct 20 – Oct 29/);
});

test('PostHog funnel is explicitly a selected-range aggregate, not a grain-bucket series', () => {
  const A = dashboard(); A.S.grain = 'week';
  const html = A.platformFunnels.nativeBody({ title: 'Landing to project', from: '2026-10-01', to: '2026-10-29', window_days: 14, steps: [{ name: 'Landing', n: 100 }, { name: 'Identify', n: 10 }] });
  assert.match(html, /whole selected range/);
  assert.match(html, /Group by does not split this funnel into weekly cohorts/);
});

test('dashboard defaults the PostHog funnel selector and loader to the Marketing-to-Project Activation Funnel', async () => {
  const A = dashboard(), requests = [];
  A.api = (path) => { requests.push(path); return Promise.resolve({ title: 'Marketing-to-Project Activation Funnel', from: A.S.from, to: A.S.to, steps: [] }); };
  const html = A.platformFunnels.render(), overview = A.views.overview.render(), conversion = A.views.conversion.render();
  assert.match(html, /option value="marketing_project" selected/);
  assert.doesNotMatch(overview, /option value="marketing_project" selected|Marketing-to-Project Activation Funnel/);
  assert.match(conversion, /option value="marketing_project" selected/);
  assert.match(html, /Marketing-to-Project Activation Funnel/);
  await A.platformFunnels.ensureSummary();
  assert.match(requests[0], /funnel=marketing_project/);
  assert.equal(A.platformFunnels.summary().path, 'marketing_project');
  const handlers = {}, box = { isConnected: true, innerHTML: '' };
  A.platformFunnels.mount({ addEventListener: (name, handler) => { handlers[name] = handler; }, querySelector: () => box });
  handlers.change({ target: { value: 'ga4', hasAttribute: (name) => name === 'data-funnel-platform' } });
  await A.platformFunnels.ensureSummary();
  assert.equal(requests.length, 1, 'non-PostHog platforms must not request the PostHog funnel');
});

test('percentage-point deltas compare zero rates as valid values', () => {
  const U = dashboard().ui;
  assert.match(U.deltaPoints(0.5, 0), /\+50\.0 pp/);
  assert.match(U.deltaPoints(0, 0.5), /−50\.0 pp/);
  assert.match(U.deltaPoints(null, 0), /No comparison for this period/);
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

test('native GA4 counts are retained without the removed review banner', () => {
  const A = auditedDashboard(), ga = A.D.ga();
  assert.equal(ga.users, 1599); assert.equal(ga.newUsers, 1792); assert.equal(ga.userWarning, true);
  assert.doesNotMatch(A.views.acquisition.render(), /GA4 reporting needs review/);
});

test('verified-account actual needs a trusted report and cannot come from observed people', () => {
  const A = auditedDashboard();
  A.S.data.metrics.push({ ...metric('posthog', 'ph_verified_accounts', 7, 'External'), dim: 'account_type' });
  assert.equal(A.D.verified(), null);
  A.S.data.snapshots.push({ ...available('posthog', 'verified_accounts'), rows: [{ available: true, unit: 'verified_account' }] });
  assert.equal(A.D.verified(), 7);
  assert.doesNotMatch(A.views.overview.render(), /7 verified/);
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

test('PostHog connector keeps account_created and project_created pending until their schemas are verified', async (t) => {
  env(t, {
    POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test',
    POSTHOG_EXECUTIVE_HOSTS: 'portal.think4ever.com,think4ever.com,www.think4ever.com',
    POSTHOG_PROJECT_CREATED_ENABLED: '1',
  });
  const { connectors } = require('../lib/connectors');
  const queries = [];
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, options) => {
    const sql = JSON.parse(options.body).query.query; queries.push(sql);
    if (sql.includes("event = '$identify'")) return response({ results: [[date, 'External', 'Colombia', 99]] });
    if (sql.includes("event = 'registration_started'")) return response({ results: [] });
    if (sql.includes('matchesAction')) return response({ results: [] });
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  assert.equal(load.metrics.find((row) => row.metric === 'ph_accounts_created'), undefined);
  assert.equal(load.metrics.some((row) => row.metric === 'ph_projects_created' && row.dim === 'account_type'), false);
  assert.equal(load.snapshots.find((row) => row.key === 'accounts_created_coverage')?.rows[0].available, false);
  assert.equal(load.snapshots.find((row) => row.key === 'projects_created_coverage')?.rows[0].available, false);
  assert.match(load.snapshots.find((row) => row.key === 'accounts_created_coverage').rows[0].reason, /verified account_created identity/);
  assert.equal(queries.some((sql) => /GROUP BY d, account_type/.test(sql) && sql.includes("event = 'account_created'")), false);
  assert.equal(queries.some((sql) => /GROUP BY d, account_type/.test(sql) && sql.includes("event = 'project_created'")), false);
});

test('PostHog connector classifies moadbus, t4e and think4ever as Internal by email, company or name', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test' });
  const { connectors } = require('../lib/connectors');
  const queries = [];
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, options) => { queries.push(JSON.parse(options.body).query.query); return response({ results: [] }); });
  await connectors.posthog();
  const identify = queries.find((sql) => sql.includes("event = '$identify'") && sql.includes('AS account_type'));
  assert.ok(identify, 'first-identify query runs');
  assert.match(identify, /person\.properties\.name/);
  for (const p of ['think4ever', 'moadbus', 't4e']) assert.ok(identify.includes(`, '${p}') > 0`), `pattern ${p}`);
});

test('PostHog product usage snapshot is per portal account, internal-aware and stores no identifiers', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test' });
  const { connectors } = require('../lib/connectors');
  let usageSql = '', projectSql = '';
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, options) => {
    const sql = JSON.parse(options.body).query.query;
    if (sql.includes('portal_user_id') && sql.includes('signin_days')) {
      usageSql = sql;
      return response({ results: [
        ['2026-11-04', '2026-11-05', ['2026-11-05', '2026-11-06'], 0],
        ['2026-11-04', '', [], 1],
      ] });
    }
    if (sql.includes('count(DISTINCT') && sql.includes('project_id')) {
      projectSql = sql;
      return response({ results: [['2026-11-05', 0, 2], ['2026-11-05', 1, 4]] });
    }
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  assert.match(usageSql, /GROUP BY uid/);
  assert.match(usageSql, /'account_created'/);
  assert.match(usageSql, /'signed_in'/);
  assert.match(usageSql, /, 'moadbus'\) > 0/);
  assert.doesNotMatch(usageSql + projectSql, /toUInt8/, 'HogQL rejects toUInt8');
  const head = load.snapshots.find((s) => s.key === 'product_usage');
  assert.equal(head.rows[0].available, true);
  assert.equal(head.rows[0].accounts, 2);
  const rows = load.snapshots.filter((s) => /^product_usage_\d+$/.test(s.key)).flatMap((s) => s.rows);
  assert.deepEqual(rows[0], { created: '2026-11-04', first_project: '2026-11-05', signin_days: ['2026-11-05', '2026-11-06'], internal: false });
  assert.equal(rows[1].first_project, null);
  assert.equal(rows[1].internal, true);
  assert.ok(rows.every((r) => !('uid' in r) && !('portal_user_id' in r)), 'no identifiers stored');
  assert.deepEqual(load.snapshots.find((s) => s.key === 'product_projects').rows, [
    { date: '2026-11-05', internal: false, projects: 2 },
    { date: '2026-11-05', internal: true, projects: 4 },
  ]);
});

test('PostHog product usage failure is pending, not zero', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, options) => {
    const sql = JSON.parse(options.body).query.query;
    if (sql.includes('signin_days')) return { ok: false, status: 500, text: async () => 'boom' };
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  const head = load.snapshots.find((s) => s.key === 'product_usage');
  assert.equal(head.rows[0].available, false);
  assert.match(head.rows[0].reason, /query failed/);
});

test('Executive PostHog account country rows use event GeoIP on external first identify only', async (t) => {
  env(t, {
    POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test',
    POSTHOG_EXECUTIVE_HOSTS: 'portal.think4ever.com,think4ever.com,www.think4ever.com',
    POSTHOG_PROJECT_CREATED_ENABLED: '0',
  });
  const { connectors } = require('../lib/connectors');
  const requests = [];
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    const request = JSON.parse(opts.body), sql = request.query.query;
    requests.push(request);
    if (sql.includes('properties.$geoip_country_name') && sql.includes('first_host')) {
      return response({ results: [
        [date, 'External', 'Colombia', 'portal.think4ever.com', 2],
        [date, 'External', '', 'portal.think4ever.com', 1],
        [date, 'Internal', 'Colombia', 'portal.think4ever.com', 4],
        [date, 'Unknown', 'Canada', 'portal.think4ever.com', 5],
        [date, 'External', 'Mexico', 'cell-ssm-use1-0006.us.portal.think4ever.com', 3],
      ] });
    }
    if (sql.includes("event = '$identify'")) return response({ results: [[date, 'External', 'Colombia', 21], [date, 'Internal', 'Colombia', 5]] });
    if (sql.includes("event = 'registration_started'")) return response({ results: [] });
    if (sql.includes('matchesAction')) return response({ results: [] });
    return response({ results: [] });
  });

  const load = await connectors.posthog();
  const accountQuery = requests.find((r) => r.query.query.includes("event = '$identify'") && !r.query.query.includes('first_host'));
  assert.match(accountQuery.query.query, /argMin\(coalesce\(nullIf\(toString\(properties\.\$geoip_country_name/);
  assert.match(accountQuery.query.query, /person\.properties\.country/);
  const executiveTotal = load.metrics.find((r) => r.metric === 'ph_exec_accounts');
  const executiveGeo = load.metrics.find((r) => r.metric === 'ph_exec_accounts_geo');
  const coverage = load.snapshots.find((r) => r.key === 'executive_accounts');
  const query = requests.find((r) => r.query.query.includes('properties.$geoip_country_name') && r.query.query.includes('first_host'));
  assert.deepEqual(executiveTotal, { metric: 'ph_exec_accounts', date, dim: 'account_type', dim_value: 'External', value: 3 });
  assert.deepEqual(executiveGeo, { metric: 'ph_exec_accounts_geo', date, dim: 'country', dim_value: 'Colombia', value: 2 });
  assert.equal(load.metrics.some((r) => r.metric === 'ph_exec_accounts_geo' && r.dim_value === 'Canada'), false);
  assert.equal(coverage.rows[0].available, true);
  assert.equal(coverage.rows[0].country_available, true);
  assert.equal(coverage.rows[0].external_accounts, 3);
  assert.equal(coverage.rows[0].country_assigned, 2);
  assert.equal(coverage.rows[0].country_missing, 1);
  assert.equal(coverage.rows[0].excluded_host_accounts, 3);
  assert.deepEqual(coverage.rows[0].allowed_hosts, ['portal.think4ever.com', 'think4ever.com', 'www.think4ever.com']);
  assert.deepEqual(coverage.rows[0].excluded_hosts, [{ host: 'cell-ssm-use1-0006.us.portal.think4ever.com', external_accounts: 3 }]);
  assert.match(query.query.query, /event = '\$identify'/);
  assert.match(query.query.query, /argMin\(coalesce\(nullIf\(toString\(properties\.\$geoip_country_name/);
  assert.equal((query.query.query.match(/tuple\(timestamp, uuid\)/g) || []).length, 3);
  assert.match(query.query.query, /LIMIT 5001$/);
  assert.equal(query.query.filters.filterTestAccounts, true);
});

test('PostHog aggregates last reported plans for approved-host external accounts', async (t) => {
  env(t, {
    POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test',
    POSTHOG_EXECUTIVE_HOSTS: 'portal.think4ever.com,think4ever.com,www.think4ever.com',
    POSTHOG_PLAN_PROPERTY: 'plan', POSTHOG_PROJECT_CREATED_ENABLED: '0',
  });
  const { connectors } = require('../lib/connectors');
  let planQuery = '';
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    const sql = JSON.parse(opts.body).query.query;
    if (sql.includes("event IN ('signed_in','plan_changed')")) {
      planQuery = sql;
      return response({ results: [['free', 2], ['paid', 1], ['Other', 1], ['', 1]] });
    }
    if (sql.includes('properties.$geoip_country_name') && sql.includes('first_host')) return response({ results: [[date, 'External', 'Colombia', 'portal.think4ever.com', 5]] });
    if (sql.includes("event = '$identify'")) return response({ results: [[date, 'External', '', 5]] });
    if (sql.includes("event = 'registration_started'")) return response({ results: [] });
    if (sql.includes('matchesAction')) return response({ results: [] });
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  const coverage = load.snapshots.find((row) => row.key === 'executive_plan_accounts');
  assert.ok(planQuery, 'sync should read the signed-in and plan-changed events');
  assert.match(planQuery, /properties\.plan/);
  assert.match(planQuery, /argMaxIf/);
  assert.match(planQuery, /event IN \('signed_in','plan_changed'\)/);
  assert.match(planQuery, /portal\.think4ever\.com/);
  assert.match(planQuery, /person_id IN \(SELECT person_id FROM events/);
  assert.match(planQuery, /properties\.\$host.*portal\.think4ever\.com/);
  assert.equal(coverage.rows[0].available, true);
  assert.deepEqual(coverage.rows[0].last_reported_plan, { free: 2, paid: 1, other: 1, unknown: 1 });
  assert.equal(coverage.rows[0].semantics, 'last_observed_plan_from_signed_in_or_plan_changed_not_verified_billing_status');
});

test('Executive PostHog account query with truncated result pages is pending, not a partial count', async (t) => {
  env(t, {
    POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test',
    POSTHOG_PROJECT_CREATED_ENABLED: '0',
  });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    const sql = JSON.parse(opts.body).query.query;
    if (sql.includes('properties.$geoip_country_name') && sql.includes('first_host')) {
      return response({ results: Array.from({ length: 5001 }, () => [date, 'External', 'Colombia', 'portal.think4ever.com', 1]), hasMore: false });
    }
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  const coverage = load.snapshots.find((r) => r.key === 'executive_accounts').rows[0];
  assert.equal(coverage.available, false);
  assert.match(coverage.reason, /safety limit/i);
  assert.equal(load.metrics.some((r) => r.metric === 'ph_exec_accounts'), false);
  assert.equal(load.metrics.some((r) => r.metric === 'ph_exec_accounts_geo'), false);
});

test('Executive PostHog account query honors API hasMore even below the row cap', async (t) => {
  env(t, {
    POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test',
    POSTHOG_PROJECT_CREATED_ENABLED: '0',
  });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    const sql = JSON.parse(opts.body).query.query;
    if (sql.includes('properties.$geoip_country_name') && sql.includes('first_host')) {
      return response({ results: [[date, 'External', 'Colombia', 'portal.think4ever.com', 1]], hasMore: true });
    }
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  const coverage = load.snapshots.find((r) => r.key === 'executive_accounts').rows[0];
  assert.equal(coverage.available, false);
  assert.match(coverage.reason, /safety limit/i);
  assert.equal(load.metrics.some((r) => r.metric === 'ph_exec_accounts'), false);
});

test('PostHog sync classifies people consistently and distinguishes failed Action from a successful zero', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test', POSTHOG_PROJECT_CREATED_ENABLED: '0' });
  const { connectors } = require('../lib/connectors'); let failAction = true;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    const sql = JSON.parse(opts.body).query.query;
    if (sql.includes("event = 'registration_started'")) return response({ results: [[date, 'External', 'Colombia', 28], [date, 'Internal', 'Colombia', 6]] });
    if (sql.includes("event = '$identify'")) { assert.match(sql, /person\.created_at >= toDate/); return response({ results: [[date, 'External', 'Colombia', 21], [date, 'Internal', 'Colombia', 5]] }); }
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
  assert.equal(A.D.signups(), 21);
  assert.equal(A.D.accounts(A.S.from, A.S.to, 'Colombia'), 21);
  assert.equal(A.D.registrations(A.S.from, A.S.to, 'Colombia'), 28);
  A.S.exInt = false; assert.equal(A.D.accounts(), 26); A.S.exInt = true;
  failAction = false;
  const empty = await connectors.posthog();
  A.S.data.snapshots = empty.snapshots.map((r) => ({ ...r, source: 'posthog' }));
  assert.equal(A.D.proxy(), 0);
});

test('assistant can await the visible PostHog funnel without fetching it twice', async () => {
  const A = dashboard();
  let calls = 0;
  A.api = async () => { calls += 1; return { title: 'Embudo landing a cuenta y proyecto (sin internos)', from: A.S.from, to: A.S.to, window_days: 14, steps: [{ name: 'Identify', n: 9 }, { name: 'Proyecto creado (clic)', n: 2 }] }; };
  const summary = await A.platformFunnels.ensureSummary();
  assert.equal(summary.steps[0].n, 9);
  assert.equal(calls, 1);
  await A.platformFunnels.ensureSummary();
  assert.equal(calls, 1);
});

test('loaded PostHog funnel exposes only aggregate step counts to the assistant context', async () => {
  const A = dashboard();
  const box = { isConnected: true, innerHTML: '' };
  const root = { querySelector: () => box, addEventListener() {} };
  A.api = async () => ({ title: 'Embudo landing a cuenta y proyecto (sin internos)', from: A.S.from, to: A.S.to, window_days: 14, steps: [
    { name: 'Identify', n: 9, person_email: 'private@example.com' },
    { name: 'Proyecto creado (clic)', n: 2, action_id: 407660 },
  ] });
  A.platformFunnels.mount(root);
  await new Promise((resolve) => setImmediate(resolve));
  const summary = A.platformFunnels.summary();
  assert.equal(summary.name, 'Embudo landing a cuenta y proyecto (sin internos)');
  assert.deepEqual(summary.steps.map((s) => [s.name, s.n]), [['Identify', 9], ['Proyecto creado (clic)', 2]]);
  assert.equal(JSON.stringify(summary).includes('private@example.com'), false);
});

test('Overview sign-up goal stays on first identify and outcomes are separate', () => {
  const A = auditedDashboard();
  A.S.data.snapshots.push({ ...available('posthog', 'account_coverage'), rows: [{ available: true, country_available: true }] });
  A.S.data.snapshots.push({ ...available('posthog', 'accounts_created_coverage'), rows: [{ available: true, event: 'account_created' }] });
  A.S.data.snapshots.push({ ...available('posthog', 'projects_created_coverage'), rows: [{ available: true, event: 'project_created' }] });
  A.S.data.metrics.push({ ...metric('posthog', 'ph_accounts', 21, 'External'), dim: 'account_type' });
  A.S.data.metrics.push({ ...metric('posthog', 'ph_accounts_created', 8, 'External'), dim: 'account_type' });
  A.S.data.metrics.push({ ...metric('posthog', 'ph_projects_created', 3, 'External'), dim: 'account_type' });
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  const html = A.views.overview.render();
  assert.equal(A.D.signups(), 21);
  assert.match(html, /LATAM 500K goal/);
  assert.match(html, /sign-ups once per person/);
  assert.match(html, /data-go="product"/);
  assert.match(html, /sign-ups once per person \(first \$identify/);
  assert.doesNotMatch(html, /Campaign funnel|Marketing-to-Project Activation Funnel/);
});

test('LinkedIn organic cards take the page metrics and Details no longer repeats them', () => {
  const A = dashboard();
  A.S.data.metrics = [
    { source: 'linkedin', metric: 'followers', value: 200, date: '2026-10-20' },
    { source: 'linkedin', metric: 'followers', value: 207, date: '2026-10-28' },
    { source: 'linkedin', metric: 'new_followers', value: 15, date: '2026-10-10' },
    { source: 'linkedin', metric: 'new_followers', value: 25, date: '2026-10-20' },
    { source: 'linkedin', metric: 'page_views', value: 511, date: '2026-10-20' },
    { source: 'linkedin', metric: 'post_clicks', value: 312, date: '2026-10-20' },
    { source: 'linkedin', metric: 'post_comments', value: 2, date: '2026-10-20' },
    { source: 'meta', metric: 'ad_spend', value: 40, date, dim_value: 'Launch' },
  ];
  const html = A.views.social.render();
  const organic = html.slice(html.indexOf('LinkedIn organic'), html.indexOf('>Details<'));
  const labels = [...organic.matchAll(/class="kpi-label">([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Followers', 'New followers', 'Page views', 'Post clicks', 'Post comments']);
  assert.match(organic, /kpi-value[^>]*>207</);
  assert.match(organic, /Latest total · on Oct 28/);
  assert.match(organic, /kpi-value[^>]*>40</);
  assert.match(organic, /kpi-value[^>]*>511</);
  assert.match(organic, /kpi-value[^>]*>312</);
  assert.match(organic, /kpi-value[^>]*>2</);
  assert.doesNotMatch(html, /LinkedIn metrics/);
  assert.match(html, /Meta campaigns/);
});

test('country columns accumulate within the month and restart on the 1st', () => {
  const A = dashboard();
  const dates = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];
  const run = A.charts.runningByMonth(dates, { '2026-10-30': 2, '2026-10-31': 3, '2026-11-01': 1, '2026-11-02': 4 });
  assert.equal(run['2026-10-30'], 2);
  assert.equal(run['2026-10-31'], 5);
  assert.equal(run['2026-11-01'], 1);
  assert.equal(run['2026-11-02'], 5);
});

test('goal share chart moves the completion bar with the share of the goal', () => {
  const A = dashboard();
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03'];
  // 10 / 500,000 is 0.002%, so the axis zooms and the dashed bar sits on that share, not on 100%.
  const full = A.charts.goalShare({ dates, daily: [3, 2, 5], goal: 500000 });
  assert.match(full, /0\.002%/);
  assert.match(full, /class="grid gp-goal"/);
  assert.match(full, /y1="55\.6" y2="55\.6"/);
  assert.doesNotMatch(full, />100%</);
  // 20% is large enough to keep the 0–100% axis, and the bar is at 20%, below the 100% gridline.
  const mid = A.charts.goalShare({ dates, daily: [100000, 0, 0], goal: 500000 });
  assert.match(mid, />100%</);
  assert.match(mid, />20%</);
  assert.match(mid, /class="grid gp-goal" x1="78" x2="984" y1="174\.4" y2="174\.4"/);
  const reached = A.charts.goalShare({ dates, daily: [200000, 200000, 100000], goal: 500000 });
  assert.match(reached, />Goal</);
  const mini = A.charts.goalShare({ dates, daily: [3, 2, 5], goal: 1000, mini: true });
  assert.match(mini, /chart-svg mini/);
  assert.match(A.charts.goalShare({ dates, daily: [1, 1, 1], goal: 0 }), /No goal set/);
});

function clarityInfo(metric, row) { return { metric, ...row }; }

function clarityFixture(extra = []) {
  return [{
    source: 'clarity', key: 'live_insights', from: '2026-10-27', to: '2026-10-29',
    rows: [
      clarityInfo('DeadClickCount', { subTotal: 18, pagesViews: 15, sessionsCount: 780, sessionsWithMetricPercentage: 1.9, sessionsWithoutMetricPercentage: 98.1 }),
      clarityInfo('ExcessiveScroll', { subTotal: 0, pagesViews: 0, sessionsCount: 789, sessionsWithMetricPercentage: 0, sessionsWithoutMetricPercentage: 100 }),
      clarityInfo('RageClickCount', { subTotal: 0, pagesViews: 0, sessionsCount: 789, sessionsWithMetricPercentage: 0, sessionsWithoutMetricPercentage: 100 }),
      clarityInfo('QuickbackClick', { subTotal: 1, pagesViews: 1, sessionsCount: 789, sessionsWithMetricPercentage: 0.13, sessionsWithoutMetricPercentage: 99.87 }),
      clarityInfo('ScriptErrorCount', { subTotal: 69, pagesViews: 65, sessionsCount: 789, sessionsWithMetricPercentage: 8.24, sessionsWithoutMetricPercentage: 91.76 }),
      clarityInfo('ErrorClickCount', { subTotal: 0, pagesViews: 0, sessionsCount: 789, sessionsWithMetricPercentage: 0, sessionsWithoutMetricPercentage: 100 }),
      clarityInfo('ScrollDepth', { averageScrollDepth: 14.31 }),
      clarityInfo('Traffic', { distinctUserCount: 740, totalSessionCount: 789, pagesPerSessionPercentage: 1.0773130544893663 }),
      clarityInfo('EngagementTime', { totalTime: 83, activeTime: 31 }),
      clarityInfo('Browser', { name: 'InstagramApp', sessionsCount: 555 }),
      clarityInfo('Browser', { name: 'ChromeMobile', sessionsCount: 134 }),
      clarityInfo('Browser', { name: 'FacebookApp', sessionsCount: 52 }),
      clarityInfo('Browser', { name: 'Chrome', sessionsCount: 22 }),
      clarityInfo('Browser', { name: 'MobileSafari', sessionsCount: 20 }),
      clarityInfo('Browser', { name: 'SamsungInternet', sessionsCount: 4 }),
      clarityInfo('Browser', { name: 'Other', sessionsCount: 2 }),
      clarityInfo('Device', { name: 'Mobile', sessionsCount: 755 }),
    ],
  }, ...extra];
}

test('Landing owns Clarity; Social and Paid contains no duplicate landing diagnostics', () => {
  const A = dashboard();
  A.S.data.snapshots = clarityFixture();
  const landing = A.views.landing.render();
  const social = A.views.social.render();
  assert.equal(A.views.landing.title, 'Landing');
  assert.match(landing, /Where visitors open the site/);
  assert.match(landing, /76\.9%/);
  assert.match(landing, /Whether the page worked/);
  assert.match(landing, /Which ad, and which page/);
  assert.doesNotMatch(landing, /Social and paid at a glance/);
  assert.doesNotMatch(landing, /Ad Spend/);
  assert.match(social, /Social and paid at a glance/);
  assert.doesNotMatch(social, /Where visitors open the site|Whether the page worked|Which ad, and which page|Microsoft Clarity export/);
});

test('Landing owns the Clarity summary and source rows', () => {
  const A = dashboard();
  A.S.data.snapshots = clarityFixture();
  const html = A.views.landing.render();
  const section = html.slice(html.indexOf('Where visitors open the site'));
  assert.match(section, /Last 72 hours/);
  assert.match(section, /76\.9%/);
  assert.match(section, /Instagram app/);
  assert.match(section, /Most visitors open the ad inside Instagram or Facebook on a phone and leave before the first screen/);
  assert.match(section, /31s active · 1\.1 pages per session/);
  assert.match(section, /kpi-tile watch[\s\S]*Script errors[\s\S]*8\.2%/);
  assert.match(section, /Campaign and page detail arrives on the next Clarity sync/);
  assert.doesNotMatch(section, /sessionsWithoutMetricPercentage/);
  assert.doesNotMatch(A.views.social.render(), /Microsoft Clarity export/);
});

test('Clarity breakdowns keep the ad and the login on separate rows', () => {
  const A = dashboard();
  A.S.data.snapshots = clarityFixture([
    {
      source: 'clarity', key: 'by_browser', from: '2026-10-27', to: '2026-10-29',
      rows: [
        clarityInfo('ScriptErrorCount', { Browser: 'InstagramApp', sessionsCount: 555, sessionsWithMetricPercentage: 10.1, subTotal: 60 }),
        clarityInfo('ScriptErrorCount', { Browser: 'ChromeMobile', sessionsCount: 134, sessionsWithMetricPercentage: 1.5, subTotal: 2 }),
        clarityInfo('ScrollDepth', { Browser: 'InstagramApp', averageScrollDepth: 12 }),
        clarityInfo('ScrollDepth', { Browser: 'ChromeMobile', averageScrollDepth: 22 }),
      ],
    },
    {
      source: 'clarity', key: 'by_acquisition', from: '2026-10-27', to: '2026-10-29',
      rows: [
        clarityInfo('Traffic', { Channel: 'Social', Campaign: 'latam-launch', Url: 'https://go.think4ever.com/start', totalSessionCount: '400' }),
        clarityInfo('Traffic', { Channel: 'Social', Campaign: 'latam-launch', Url: 'https://portal.think4ever.com/login', totalSessionCount: '40' }),
        clarityInfo('ScrollDepth', { Channel: 'Social', Campaign: 'latam-launch', Url: 'https://go.think4ever.com/start', averageScrollDepth: 11 }),
        clarityInfo('ScriptErrorCount', { Channel: 'Social', Campaign: 'latam-launch', Url: 'https://go.think4ever.com/start', sessionsWithMetricPercentage: 9, sessionsCount: '400' }),
        clarityInfo('DeadClickCount', { Channel: 'Social', Campaign: 'latam-launch', Url: 'https://go.think4ever.com/start', sessionsWithMetricPercentage: 2, sessionsCount: '400' }),
      ],
    },
  ]);
  const html = A.views.landing.render();
  assert.match(html, /Script errors by app/);
  assert.match(html, /watch-row/);
  assert.match(html, /latam-launch/);
  assert.match(html, />440</);
  assert.match(html, /pill pill-success[\s\S]*Landing/);
  assert.match(html, /pill pill-warning[\s\S]*Login/);
  assert.doesNotMatch(html, /sessionsWithoutMetricPercentage/);
});

test('Clarity refresh stays inside the daily request limit and keeps a failed breakdown', () => {
  const { clarityTtlMs, flattenClarity, assembleClarity } = require('../lib/connectors');
  const prev = process.env.CLARITY_CACHE_HOURS;
  process.env.CLARITY_CACHE_HOURS = '3';
  assert.equal(clarityTtlMs(), 20 * 36e5);
  process.env.CLARITY_CACHE_HOURS = '48';
  assert.equal(clarityTtlMs(), 48 * 36e5);
  if (prev === undefined) delete process.env.CLARITY_CACHE_HOURS;
  else process.env.CLARITY_CACHE_HOURS = prev;

  const res = [
    { metricName: 'ScriptErrorCount', information: [{ Browser: 'InstagramApp', sessionsWithMetricPercentage: 8.24 }] },
    { metricName: 'ExcessiveScroll', information: [{ Browser: 'InstagramApp', subTotal: 1 }] },
  ];
  assert.deepEqual(flattenClarity(res, 'by_browser').map((r) => r.metric), ['ScriptErrorCount']);
  assert.equal(flattenClarity(res, 'live_insights').length, 2);
  const snaps = assembleClarity('2026-10-27', '2026-10-29', [
    { key: 'live_insights', rows: [{ metric: 'Traffic' }] },
    { key: 'by_browser', error: new Error('429') },
  ], [{ key: 'by_browser', from: '2026-10-20', to: '2026-10-22', rows: [{ metric: 'ScriptErrorCount' }] }]);
  assert.deepEqual(snaps.map((s) => s.key), ['live_insights', 'by_browser']);
  assert.equal(snaps[1].from, '2026-10-20');
  assert.equal(snaps[1].rows[0].metric, 'ScriptErrorCount');
});

test('Overview offers drilldowns, the 7-step funnel with a country selector, and no activation funnel', () => {
  const A = dashboard();
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  const html = A.views.overview.render();
  assert.match(html, /LATAM 500K goal/);
  assert.match(html, /data-go="targets"/);
  assert.match(html, /data-go="acquisition"/);
  assert.match(html, /data-go="conversion"/);
  assert.match(html, /id="goal-country"/);
  assert.match(html, /Funnel · 7 steps/);
  assert.doesNotMatch(html, /Marketing-to-Project Activation Funnel/);
});

test('Acquisition prioritizes GA4 sessions and engagement by channel', () => {
  const A = dashboard();
  A.S.data.metrics = [
    { ...metric('ga4', 'ga_sessions', 140, 'Paid Social'), dim: 'channel' },
    { ...metric('ga4', 'ga_engaged_sessions', 70, 'Paid Social'), dim: 'channel' },
    { ...metric('ga4', 'ga_sessions', 20, 'Organic Search'), dim: 'channel' },
    { ...metric('ga4', 'ga_engaged_sessions', 10, 'Organic Search'), dim: 'channel' },
  ];
  const html = A.views.acquisition.render();
  assert.match(html, /GA4 sessions by channel/);
  assert.match(html, /Engaged sessions/);
  assert.match(html, /Engagement rate/);
  assert.doesNotMatch(html, /Channel mix/);
  assert.match(A.views.overview.render(), /data-go="acquisition"/);
});

test('Conversion highlights the ordered steps, not unclassified observed people or raw GA4 event noise', () => {
  const A = dashboard();
  A.S.data.snapshots.push(
    { source: 'posthog', key: 'registration_coverage', from: A.S.from, to: A.S.to, rows: [{ available: true }] },
    { source: 'posthog', key: 'account_coverage', from: A.S.from, to: A.S.to, rows: [{ available: true, country_available: true }] },
  );
  A.S.data.metrics = [
    { ...metric('posthog', 'ph_signups', 8, 'External'), dim: 'account_type' },
    { ...metric('posthog', 'ph_accounts', 5, 'External'), dim: 'account_type' },
    metric('ga4', 'ga_event', 30, 'page_view'), metric('ga4', 'ga_event', 4, 'form_start'), metric('ga4', 'ga_event', 2, 'sign_up'),
  ];
  const html = A.views.conversion.render();
  assert.match(html, /Registration starts/);
  assert.match(html, /Sign-ups/);
  assert.doesNotMatch(html, /Accounts created/);
  assert.doesNotMatch(html, /class="kpi-label">New observed people/);
  assert.doesNotMatch(html, /page_view/);
  assert.match(html, /event counts, not unique people/);
});

test('Product usage shows unique-account KPIs through yesterday, 7-day activation with n, and pending credits/churn', () => {
  const A = dashboard();
  A.testLoad('productUsage.js');
  A.testLoad('views/product.js');
  A.ui.today = () => '2026-11-09';
  const acct = (created, first_project, signin_days = [], internal = false) => ({ created, first_project, signin_days, internal });
  A.S.data.snapshots.push(
    { source: 'posthog', key: 'product_usage', from: '2026-10-01', to: '2026-11-09', pulled_at: '2026-11-09T12:00:00Z', rows: [{ available: true, accounts: 5 }] },
    { source: 'posthog', key: 'product_usage_1', from: '2026-10-01', to: '2026-11-09', rows: [
      acct('2026-10-30', '2026-11-01', ['2026-11-03', '2026-11-09']),
      acct('2026-10-30', '', ['2026-11-04']),
      acct('2026-11-06', '2026-11-07', ['2026-11-08']),
      acct('2026-11-01', '2026-11-01', ['2026-11-08'], true),
      acct('', '2026-11-02', ['2026-11-02']),
    ] },
    { source: 'posthog', key: 'product_projects', from: '2026-10-01', to: '2026-11-09', rows: [
      { date: '2026-11-01', internal: false, projects: 2 }, { date: '2026-11-07', internal: false, projects: 1 }, { date: '2026-11-01', internal: true, projects: 9 },
    ] },
  );
  const html = A.views.product.render();
  assert.match(html, /Data through Nov 8/);
  assert.match(html, /Active users \(7 days\)/);
  assert.match(html, />3</, 'active Nov 2-8: three external accounts');
  assert.match(html, /Accounts created/);
  assert.match(html, /Projects created/);
  assert.doesNotMatch(html, />12</, 'internal projects excluded');
  assert.match(html, /1 of 2 mature accounts/);
  assert.match(html, /Open cohort/);
  assert.match(html, /Not the 14-day campaign activation/);
  assert.match(html, /1 internal or test account excluded/);
  assert.match(html, /No data · Product event pending/);
  assert.doesNotMatch(html, /Nov 9/, 'today is never part of the consolidated cut');
  assert.doesNotMatch(html, /<td[^>]*>Oct 29</, 'days before the first product event are not shown as zero');
});

test('Product usage is pending, not zero, when the PostHog query failed', () => {
  const A = dashboard();
  A.testLoad('productUsage.js');
  A.testLoad('views/product.js');
  A.S.data.snapshots.push({ source: 'posthog', key: 'product_usage', from: '2026-10-01', to: '2026-11-09', rows: [{ available: false, reason: 'PostHog product usage query failed.' }] });
  const html = A.views.product.render();
  assert.match(html, /PostHog product usage query failed/);
  assert.doesNotMatch(html, /class="overview-metric-value">0</);
});

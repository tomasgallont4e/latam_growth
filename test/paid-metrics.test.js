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
  for (const label of ['Management indicators', 'Sign-ups target progress', 'Ads spend', 'Accounts created', 'Projects created', '14-day project activation']) assert.ok(html.includes(label), label);
  assert.match(html, /No verified shared identity key/);
  assert.match(html, /Campaign funnel/);
  assert.doesNotMatch(html, /Marketing-to-Project Activation Funnel|LATAM 500K goal by month|Accounts created vs goal|<h2 class="section-title">What changed/);
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
  assert.doesNotMatch(html, /Marketing-to-Project Activation Funnel|LATAM 500K goal by month|Accounts created vs goal|<h2 class="section-title">What changed/);
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
  for (const file of ['paid.js', 'channels.js', 'measurement.js', 'ui.js', 'charts.js', 'funnels.js', 'aggregate.js', 'assistant.js', 'regions.js', 'views/social.js', 'views/landing.js', 'views/overview.js', 'views/executive.js', 'views/conversion.js', 'views/form.js', 'views/acquisition.js', 'app.js']) {
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
  assert.match(conversion, /Weekly registration starts and sign-ups/);
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
    if (u.searchParams.get('fields') === 'currency') return response({ currency: 'USD' });
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
  assert.match(overview, /LATAM 500K goal · .*Monthly · .*sign-ups once per person \(first account_created or \$identify/);
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
  // Group by at the top sets the funnel window, always ending at To; Monthly = the selected From -> To.
  assert.deepEqual([A.grainWindow('day').from, A.grainWindow('day').to], ['2026-10-28', '2026-10-28']);
  assert.deepEqual([A.grainWindow('week').from, A.grainWindow('week').to], ['2026-10-22', '2026-10-28']);
  assert.equal(A.grainWindow('quarter').from, '2026-10-01', 'capped at launch');
  assert.equal(A.grainWindow('year').from, '2026-10-01');
  A.S.grain = 'month';
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
  assert.match(html, /Product usage not synced yet/);
  assert.doesNotMatch(html, /Credits loaded/);
  assert.match(html, /Biggest leak/);
  assert.match(html, /class="funnel has-verdicts"/);
  assert.match(html, /Reference · not part of the %/);
  assert.match(html, /vs Accounts created<\/small>/, 'projects compare with accounts, skipping logins');
  assert.match(html, /id="goal-country"/);
  A.S.overviewCountry = 'Colombia';
  const country = A.views.overview.render();
  assert.match(country, /Not split by country/);
  assert.match(country, /option value="Colombia" selected/);
});

test('Overview accounts for the selected period follow Group by inside the selected Month; the monthly goal stays fixed', () => {
  const A = dashboard();
  A.ui.today = () => '2026-11-15';
  A.S.goalMonth = '2026-10';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-28';
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  const at = (row, d) => ({ ...row, date: d });
  A.S.data.metrics = [
    at({ ...metric('posthog', 'ph_accounts', 21, 'External'), dim: 'account_type' }, '2026-10-05'),
    at({ ...metric('posthog', 'ph_accounts', 6, 'External'), dim: 'account_type' }, '2026-10-25'),
    at({ ...metric('posthog', 'ph_accounts', 4, 'External'), dim: 'account_type' }, '2026-10-28'),
    at({ ...metric('posthog', 'ph_accounts', 9, 'Internal'), dim: 'account_type' }, '2026-10-28'),
  ];
  A.S.data.snapshots.push({ ...available('posthog', 'account_coverage'), rows: [{ available: true }] });
  const period = (html) => Number((html.match(/acct-hero-period[\s\S]*?acct-hero-actual">([\d,]+)</) || [])[1].replace(/,/g, ''));
  const monthNum = (html) => Number((html.match(/acct-hero-now[\s\S]*?acct-hero-actual">([\d,]+)</) || [])[1].replace(/,/g, ''));
  A.S.grain = 'day';
  const day = A.views.overview.render();
  assert.match(day, /Selected period/);
  assert.equal(period(day), 4, 'Daily = the To day, internal excluded');
  A.S.grain = 'week';
  const week = A.views.overview.render();
  assert.equal(period(week), 10, 'Weekly = last 7 days up to To');
  A.S.grain = 'month';
  const month = A.views.overview.render();
  assert.equal(period(month), 31, 'Monthly = the selected Month From -> To');
  for (const html of [day, week, month]) assert.equal(monthNum(html), 31, 'the monthly goal number does not move');
  // From/To outside the selected Month: the period still uses the Month's dates.
  A.S.from = '2026-11-01'; A.S.to = '2026-11-10';
  assert.equal(period(A.views.overview.render()), 31);
});

test('Overview: dates typed in From/To set the accounts card, the pace chart and the 7-step funnel', () => {
  const A = dashboard();
  A.ui.today = () => '2026-11-13';
  A.S.goalMonth = '2026-11';
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  const at = (row, d) => ({ ...row, date: d });
  const ext = (n, d) => at({ ...metric('posthog', 'ph_accounts', n, 'External'), dim: 'account_type' }, d);
  A.S.data.metrics = [
    ext(3, '2026-11-06'), ext(3, '2026-11-10'), ext(3, '2026-11-11'), ext(2, '2026-11-12'), ext(2, '2026-11-13'),
    at({ ...metric('posthog', 'ph_accounts', 5, 'Internal'), dim: 'account_type' }, '2026-11-12'),
  ];
  A.S.data.snapshots.push({ ...available('posthog', 'account_coverage'), to: '2026-11-13', rows: [{ available: true }] });
  const period = (html) => Number((html.match(/acct-hero-period[\s\S]*?acct-hero-actual">([\d,]+)</) || [])[1].replace(/,/g, ''));
  const monthNum = (html) => Number((html.match(/acct-hero-now[\s\S]*?acct-hero-actual">([\d,]+)</) || [])[1].replace(/,/g, ''));
  const funnelAccounts = (w) => A.D.sum('posthog', 'ph_accounts', (r) => r.dim === 'account_type' && r.dim_value !== 'Internal', w.from, w.to);
  // Month picked, Group by Daily: the preset (the To day) still applies.
  A.S.from = '2026-11-01'; A.S.to = '2026-11-13'; A.S.grain = 'day'; A.S.ovWin = 'grain';
  assert.deepEqual([A.overviewWindow().mode, A.overviewWindow().from], ['grain', '2026-11-13']);
  assert.equal(period(A.views.overview.render()), 2);
  // Dates typed by hand: exactly From -> To, whatever Group by says.
  A.S.from = '2026-11-10'; A.S.to = '2026-11-13'; A.S.ovWin = 'range';
  const win = A.overviewWindow();
  assert.deepEqual([win.mode, win.from, win.to], ['range', '2026-11-10', '2026-11-13']);
  const html = A.views.overview.render();
  assert.equal(period(html), 10, 'accounts created in the typed dates, internal excluded');
  assert.equal(period(html), funnelAccounts(win), 'same number as step 5 of the funnel');
  assert.equal(monthNum(html), 13, 'the Month total stays next to it');
  assert.match(html, /acct-hero-top is-range/);
  assert.match(html, /Selected dates · Accounts created/);
  assert.match(html, /follows From\/To at the top/);
  assert.match(html, /2026-11-10 to 2026-11-13 · From\/To at the top/);
  assert.match(html, /class="goal-focus"/);
  assert.ok((html.match(/goal-col is-dim/g) || []).length >= 1, 'days outside the typed dates are dimmed');
  // The assistant receives the same seven steps and window the page draws.
  const fed = A.overviewFunnel();
  assert.deepEqual([fed.from, fed.to, fed.set_by, fed.steps.length], ['2026-11-10', '2026-11-13', 'From/To', 7]);
  assert.equal(fed.steps.find((x) => x.step === 'Accounts created').value, 10);
  // Step 4 split by HubSpot form: Developer Network registrations read apart from the landing sign-up.
  A.S.data.events = [{ kind: 'form_signup', date: '2026-11-12', form: 'T4E – Early Builders Colombia' }, { kind: 'form_signup', date: '2026-11-13', form: 'T4E – Early Builders Colombia' }, { kind: 'form_signup', date: '2026-11-13', form: 'T4E – Landing Signup LATAM' }, { kind: 'form_signup', date: '2026-11-13', form: 'T4E – Landing Signup LATAM', utm_medium: 'test' }, { kind: 'form_signup', date: '2026-11-05', form: 'T4E – Landing Signup LATAM' }];
  assert.match(A.views.overview.render(), /ov-forms-by-form">HubSpot form submissions: <b>3<\/b> \(Early Builders Colombia 2 · Landing Signup LATAM 1\)\. A separate path, not a funnel step/);
  // Narrower dates move every number together.
  A.S.from = '2026-11-12';
  assert.equal(period(A.views.overview.render()), 4);
  // Picking a Group by preset hands the window back to Group by.
  A.S.ovWin = 'grain'; A.S.grain = 'week';
  assert.equal(A.overviewWindow().from, '2026-11-07');
  assert.doesNotMatch(A.views.overview.render(), /is-range|goal-focus/);
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
  // Acquisition shows the change on its KPI tiles only; the separate comparison section repeated them.
  assert.doesNotMatch(acquisition, /Last complete Daily period vs previous/);
  assert.match(trafficKpis(acquisition), /\+10\.0 pp/);
});

// The traffic KPI row: from its section title to the first traffic card.
function trafficKpis(html) { return html.slice(html.indexOf('Traffic to the sites'), html.indexOf('GA4 sessions by channel')); }

test('Acquisition KPI strip shows last-complete-period deltas while preserving range totals', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-29'; A.S.grain = 'day';
  const row = (metricName, value, date, channel) => ({ source: 'ga4', metric: metricName, value, date, dim: channel ? 'channel' : '', dim_value: channel || '' });
  A.S.data.metrics = [
    row('ga_sessions', 100, '2026-10-27', 'Organic Search'), row('ga_engaged_sessions', 50, '2026-10-27', 'Organic Search'), row('ga_new_users', 5, '2026-10-27'),
    row('ga_sessions', 150, '2026-10-28', 'Paid Social'), row('ga_engaged_sessions', 90, '2026-10-28', 'Paid Social'), row('ga_new_users', 8, '2026-10-28'),
  ];
  const kpis = trafficKpis(A.views.acquisition.render());
  assert.match(kpis, /title="250">250/);
  assert.match(kpis, /\+50\.0%/);
  assert.match(kpis, /\+60\.0%/);
  assert.match(kpis, /\+10\.0 pp/);
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
  const kpis = trafficKpis(A.views.acquisition.render());
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
  const kpis = trafficKpis(A.views.acquisition.render());
  const sessions = kpis.slice(kpis.indexOf('GA4 sessions'), kpis.indexOf('Unique visitors'));
  assert.match(sessions, /title="140">140/);
  assert.match(sessions, /class="sparkline"/);
  assert.match(sessions, /points="2\.0,5\.0 94\.0,27\.0"/);
});

test('Acquisition shows the deduplicated unique-visitor total without a period change', () => {
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
  const kpis = trafficKpis(A.views.acquisition.render());
  const unique = kpis.slice(kpis.indexOf('Unique visitors'), kpis.indexOf('New users'));
  assert.match(unique, /title="500">500/);
  // Even with exact bucket snapshots there is no change: the connector stores totals counted back from
  // today, which never match calendar buckets, so a delta here was almost always "–".
  assert.doesNotMatch(unique, /class="delta/);
  assert.match(unique, /no period change: daily unique visitors cannot be added/);
});

test('Acquisition shows no unique-visitor value when the range has no deduplicated total', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  A.S.from = '2026-10-01'; A.S.to = '2026-10-29'; A.S.grain = 'day';
  A.S.data.metrics = [
    { source: 'ga4', metric: 'ga_sessions', value: 100, date: '2026-10-27', dim: 'channel', dim_value: 'Organic Search' },
    { source: 'ga4', metric: 'ga_users', value: 70, date: '2026-10-27' },
    { source: 'ga4', metric: 'ga_users', value: 90, date: '2026-10-28' },
  ];
  const kpis = trafficKpis(A.views.acquisition.render());
  const unique = kpis.slice(kpis.indexOf('Unique visitors'), kpis.indexOf('New users'));
  assert.doesNotMatch(unique, /160/, 'daily users are never added into a unique-visitor total');
  assert.match(unique, /Deduplicated total not available for this range/);
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

test('Acquisition groups UTM and country detail by period, without the whole-site HubSpot table or summed users', () => {
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
  A.S.data.events = [{ kind: 'form_signup', date: '2026-10-20', country: 'Colombia', internal: false }];
  const html = A.views.acquisition.render();
  // HubSpot's traffic report covers the whole site with no domain filter, so it contradicted GA4 here.
  assert.doesNotMatch(html, /HubSpot sessions by source and period/);
  assert.match(html, /UTM campaigns by period \(GA4\)/);
  assert.match(html, /Entry pages by period \(GA4\)/);
  assert.match(html, /Countries by period \(GA4\)/);
  assert.match(html, /Oct 19–25/); assert.match(html, /Oct 26–29/);
  assert.match(html, /Colombia/); assert.match(html, /p01_video/);
  const countries = html.slice(html.indexOf('Countries by period (GA4)'));
  // Per-period GA4 users needed a snapshot per bucket and were always empty; the HubSpot column counts forms.
  assert.doesNotMatch(countries, /Users \(GA4\)/);
  assert.match(countries, /Form sign-ups \(HubSpot\)/);
  assert.doesNotMatch(countries, /CRM contacts/);
  assert.match(html, /GA4 unique users are never summed across days/);
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
  const kpis = trafficKpis(A.views.acquisition.render());
  const sessions = kpis.slice(kpis.indexOf('GA4 sessions'), kpis.indexOf('Unique visitors'));
  const rate = kpis.slice(kpis.indexOf('Engagement rate'), kpis.indexOf('Top channel'));
  assert.match(sessions, />new<\/span>/);
  assert.match(rate, /No comparison for this period/);
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

test('Executive PostHog accounts use the Overview population; country and host come from the first identify only', async (t) => {
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
  assert.match(accountQuery.query.query, /argMinIf\(coalesce\(nullIf\(toString\(properties\.\$geoip_country_name/);
  assert.match(accountQuery.query.query, /event IN \('\$identify', 'account_created'\)/, 'one-click sign-ups without $identify are counted');
  assert.match(accountQuery.query.query, /tuple\(timestamp, uuid\), event = '\$identify'\) AS country/, 'country comes from the first $identify only');
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
  // Same population as ph_accounts: first account_created or $identify per person. Country and host only
  // from $identify; an account with no identify (backend account_created) counts on the portal host.
  assert.match(query.query.query, /event IN \('\$identify', 'account_created'\)/);
  assert.match(query.query.query, /argMinIf\(coalesce\(nullIf\(toString\(properties\.\$geoip_country_name[\s\S]*event = '\$identify'\) AS country/);
  assert.match(query.query.query, /if\(countIf\(event = '\$identify'\) > 0, argMinIf\([\s\S]*'portal\.think4ever\.com'\) AS first_host/);
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
  assert.match(html, /sign-ups once per person \(first account_created or \$identify/);
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

test('HubSpot sync reads the t4e_ plan and credit properties into an aggregate with no contact identifier', async (t) => {
  env(t, { HUBSPOT_TOKEN: 'test-token' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(global, 'fetch', async (url, opts = {}) => {
    if (!String(url).includes('/crm/v3/objects/contacts/search')) return response({});
    const body = JSON.parse(opts.body);
    if (!body.properties.includes('t4e_plan_name')) return response({ results: [] });
    assert.equal(body.filterGroups[0].filters[0].operator, 'HAS_PROPERTY');
    return response({ results: [
      { id: '1', properties: { email: 'ana@cliente.co', t4e_plan_name: 'Builder', t4e_subscription_status: 'active', t4e_credits_used: '12', t4e_credits_remaining: '88', t4e_subscription_started_at: '2026-11-02T15:00:00.000Z', t4e_last_credit_used_at: '2026-11-10T15:00:00.000Z' } },
      { id: '2', properties: { email: 'qa@think4ever.com', t4e_plan_name: 'Builder', t4e_credits_used: '500' } },
    ] });
  });
  const load = await connectors.hubspot();
  const snap = load.snapshots.find((s) => s.key === 'plan_credits');
  const row = snap.rows[0];
  assert.equal(row.available, true);
  assert.equal(row.contacts, 1);
  assert.equal(row.internal_excluded, 1);
  assert.equal(row.credits_used, 12);
  assert.equal(row.active, 1);
  assert.doesNotMatch(JSON.stringify(snap), /ana@cliente|"id"/);
});

test('HubSpot plan and credits search retries once after the per-second limit', async (t) => {
  env(t, { HUBSPOT_TOKEN: 'test-token' });
  const { connectors } = require('../lib/connectors');
  let planCalls = 0;
  t.mock.method(global, 'fetch', async (url, opts = {}) => {
    if (!String(url).includes('/crm/v3/objects/contacts/search')) return response({});
    if (!JSON.parse(opts.body).properties.includes('t4e_plan_name')) return response({ results: [] });
    planCalls += 1;
    if (planCalls === 1) return { ok: false, status: 429, text: async () => '{"message":"You have reached your secondly limit."}' };
    return response({ results: [{ id: '1', properties: { email: 'ana@cliente.co', t4e_plan_name: 'Builder', t4e_credits_used: '3' } }] });
  });
  const load = await connectors.hubspot();
  const row = load.snapshots.find((s) => s.key === 'plan_credits').rows[0];
  assert.equal(planCalls, 2);
  assert.equal(row.available, true);
  assert.equal(row.credits_used, 3);
});

test('Product usage shows plans and credits from HubSpot and drops the waiting credit and churn cards', () => {
  const A = dashboard();
  A.testLoad('productUsage.js');
  A.testLoad('views/product.js');
  const row = { available: true, ...A.productUsage.planCredits([
    { plan: 'Builder', status: 'active', used: 40, remaining: 60, last_used: '2026-11-12', started: '2026-11-01' },
    { plan: 'Free', status: '', used: 0, remaining: 10 },
  ], '2026-11-13') };
  A.S.data.snapshots.push({ source: 'hubspot', key: 'plan_credits', from: '2026-10-01', to: '2026-11-13', pulled_at: '2026-11-13T12:00:00Z', rows: [row] });
  const html = A.views.product.render();
  assert.match(html, /Plans and credits/);
  assert.match(html, /Credits used/);
  assert.match(html, />40</);
  assert.match(html, /Builder/);
  assert.match(html, /Subscriptions by month/);
  assert.doesNotMatch(html, /Cancellations and monthly churn/);
  assert.match(html, /Retention D1 \/ D7/);
});

test('Plans and credits waits for HubSpot instead of showing zero', () => {
  const A = dashboard();
  A.testLoad('productUsage.js');
  A.testLoad('views/product.js');
  const html = A.views.product.render();
  assert.match(html, /Waiting for the next HubSpot sync/);
  assert.match(html, /Cancellations and monthly churn/);
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

function formDashboard({ formStarts = true } = {}) {
  const A = dashboard();
  const cover = { from: '2026-10-01', to: '2026-11-05' };
  A.S.data.snapshots.push(
    { source: 'ga4', key: 'executive_landing', ...cover, rows: [{ available: true, form_start_available: formStarts }] },
    { source: 'hubspot', key: 'utm_capture', ...cover, rows: [{ available: true }] },
  );
  const days = (from, to) => A.ui.days(from, to);
  for (const d of days('2026-10-21', '2026-10-27')) A.S.data.metrics.push({ source: 'ga4', metric: 'ga_exec_geo_sessions', date: d, dim: 'country', dim_value: 'Colombia', value: 100 });
  for (const d of days('2026-10-29', '2026-11-05')) A.S.data.metrics.push({ source: 'ga4', metric: 'ga_exec_geo_sessions', date: d, dim: 'country', dim_value: 'Colombia', value: 200 }, { source: 'ga4', metric: 'ga_exec_form_starts', date: d, value: 2 });
  A.S.data.metrics.push({ source: 'ga4', metric: 'ga_exec_form_starts', date: '2026-10-24', value: 1 });
  A.S.data.events.push(
    { kind: 'form_signup', date: '2026-10-30', internal: false, site_host: 'go.think4ever.com', form: 'Registro LATAM' },
    { kind: 'form_signup', date: '2026-10-30', internal: false, site_host: 'think4ever.com', form: 'Early Builders' },
    { kind: 'form_signup', date: '2026-10-31', internal: true, site_host: 'go.think4ever.com', form: 'Registro LATAM' },
  );
  return A;
}

test('Sign-up form compares daily averages before and after the short form', () => {
  const html = formDashboard().views.form.render();
  assert.match(html, /Before is Oct 21 – Oct 27 and after is Oct 29 – Nov 5/);
  assert.match(html, /Form starts per day[\s\S]*?0\.1<\/td>[\s\S]*?>2<\/td>/, 'starts per day: 1 in 7 days before, 16 in 8 days after');
  assert.match(html, /Form starts per landing session[\s\S]*?0\.14%[\s\S]*?1\.00%/);
  assert.match(html, /Form submissions per day[\s\S]*?>0<\/td>[\s\S]*?0\.1<\/td>/, 'only the external landing submission counts');
});

test('Sign-up form shows Pending, not zero, when GA4 form starts are not reported', () => {
  const html = formDashboard({ formStarts: false }).views.form.render();
  assert.match(html, /Form starts per day[\s\S]*?Pending[\s\S]*?Pending/);
  assert.match(html, /Form starts<small>[^<]*<\/small><\/span><div class="funnel-track pending"><\/div><span class="funnel-count"><span class="awaiting-chip">Awaiting GA4</);
  assert.doesNotMatch(html, /class="kpi-value hero"[^>]*>0</);
});

function executiveWithReview(review) {
  const A = dashboard();
  A.api = (url) => {
    const month = new URL(url, 'http://localhost').searchParams.get('month');
    if (url.startsWith('api/month-review?')) return Promise.resolve({ month, ...review });
    if (url.startsWith('api/executive?')) return Promise.resolve({ month, view: { cards: {}, outcomes: {}, changed: { phrases: [] } } });
    return new Promise(() => {});
  };
  return A;
}
async function renderExecutive(A) {
  A.views.executive.render();
  await new Promise((resolve) => setImmediate(resolve));
  A.views.executive.render();
  await new Promise((resolve) => setImmediate(resolve));
  return A.views.executive.render();
}

test('Executive compares this month with the same days of last month and keeps gaps Pending', async () => {
  const html = await renderExecutive(executiveWithReview({ sameDays: {
    status: 'loaded', through: '2026-11-11', current: { from: '2026-11-01', to: '2026-11-11' }, previous: { from: '2026-10-01', to: '2026-10-11', complete: true }, reason: null,
    rows: [
      { id: 'accounts', name: 'Accounts created', source: 'PostHog', kind: 'count', current: 24, previous: 20, change: 0.2 },
      { id: 'spend', name: 'Ads spend', source: 'Meta Ads · Google Ads', kind: 'money', current: null, previous: 30, change: null },
      { id: 'cpa', name: 'Cost per account', source: 'Spend ÷ accounts', kind: 'money', lowerIsBetter: true, current: 2, previous: 4, change: -0.5 },
    ],
  } }));
  assert.match(html, /This month vs last month · same days/);
  assert.match(html, /Nov 1 – Nov 11 against Oct 1 – Oct 11/);
  assert.match(html, /Accounts created[\s\S]*?>24<[\s\S]*?>20<[\s\S]*?\+20\.0%/);
  assert.match(html, /Ads spend[\s\S]*?Pending/);
  assert.match(html, /Cost per account[\s\S]*?delta-up[^>]*>[\s\S]*?−50\.0%/, 'a lower cost per account reads as good');
});

test('Executive draws sessions by channel with the long tail folded and spend Pending when not loaded', async () => {
  const sessions = ['Meta Ads', '(direct)', 'google', 'linkedin', 'newsletter', 'bing', 'tiktok', 'x'].map((name, i) => ({ name, value: 80 - i * 10 }));
  const html = await renderExecutive(executiveWithReview({ channels: {
    status: 'loaded', from: '2026-11-01', to: '2026-11-12', sessions, spend: null, reasons: { sessions: null, spend: 'No ad network has reported.' },
  } }));
  assert.match(html, /Where traffic and spend come from/);
  assert.match(html, /Meta Ads<\/span>[\s\S]*?>80</);
  assert.match(html, /Other 2<\/span>[\s\S]*?>30</, 'tiktok 20 + x 10');
  assert.doesNotMatch(html, /tiktok/);
  assert.match(html, /Ads spend by platform[\s\S]*?No ad network has reported/);
});

test('Executive lists campaigns with spend and shows unknown accounts and cost as –, never 0', async () => {
  const html = await renderExecutive(executiveWithReview({ campaigns: { status: 'loaded', from: '2026-11-01', to: '2026-11-12', rows: [
    { channel: 'Meta Ads', campaign: 'latam_launch', paid: true, spend: 120, impressions: 9000, clicks: 300, sessions: 250, forms: 6, accounts: 4, projects: 1, costPerAccount: 30 },
    { channel: 'Google Ads', campaign: 'brand_latam', paid: true, spend: 40, impressions: 900, clicks: 50, sessions: 40, forms: null, accounts: null, projects: null, costPerAccount: null },
  ] } }));
  assert.match(html, /Campaigns this month/);
  assert.match(html, /latam_launch[\s\S]*?Meta Ads[\s\S]*?120\.00[\s\S]*?9,000[\s\S]*?30\.00/);
  assert.match(html, /brand_latam[\s\S]*?Google Ads(?:(?!<\/tr>)[\s\S])*text-muted">–<\/span><\/td><\/tr>/, 'unknown cost per account is –');
  assert.match(html, /data-mr-channel/);
});

test('Executive hides QA and research traffic from the campaign table unless asked', async () => {
  const html = await renderExecutive(executiveWithReview({ campaigns: { status: 'loaded', from: '2026-11-01', to: '2026-11-12', rows: [
    { channel: 'google', campaign: 'early_builders_co_202611', paid: false, spend: null, impressions: null, clicks: null, sessions: 218, forms: 11, accounts: 3, projects: 3, costPerAccount: null },
    { channel: 'qa', campaign: 'qa-directo-1106', paid: false, spend: null, impressions: null, clicks: null, sessions: 21, forms: 1, accounts: 0, projects: 0, costPerAccount: null },
    { channel: 'meta', campaign: 'qa_registro_28oct', paid: false, spend: null, impressions: null, clicks: null, sessions: 5, forms: 0, accounts: 0, projects: 0, costPerAccount: null },
  ] } }));
  assert.match(html, /early_builders_co_202611/);
  assert.doesNotMatch(html, /qa-directo-1106|qa_registro_28oct/);
  assert.match(html, /Show test traffic · 26 sessions, 1 form</);
});

test('Executive shows Meta Ads by country for the month, sorted by spend, and Pending without the breakdown', async () => {
  const A = executiveWithReview({});
  const month = A.bogotaMonth();
  const day = `${month}-01`;
  const geo = (metric, country, value) => ({ source: 'meta', metric, date: day, dim: 'country', dim_value: country, value });
  const pending = await renderExecutive(A);
  assert.match(pending, /Meta Ads by country[\s\S]*?Meta has not sent the country breakdown yet/);
  A.S.data.metrics.push(
    geo('ad_spend_geo', 'Colombia', 30), geo('ad_impressions_geo', 'Colombia', 3000), geo('ad_clicks_geo', 'Colombia', 60),
    geo('ad_spend_geo', 'Mexico', 70), geo('ad_impressions_geo', 'Mexico', 5000), geo('ad_clicks_geo', 'Mexico', 0),
    { ...geo('ad_spend_geo', 'Peru', 999), date: '2020-01-01' },
  );
  const html = A.views.executive.render();
  assert.match(html, /Mexico[\s\S]*?70\.00[\s\S]*?Colombia[\s\S]*?30\.00[\s\S]*?2\.00%[\s\S]*?\$0\.50/);
  assert.doesNotMatch(html, /Peru/, 'rows outside the month are left out');
  assert.match(html, /Mexico(?:(?!<\/tr>)[\s\S])*text-muted">–<\/span><\/td><\/tr>/, 'no clicks means no cost per click');
});

test('Executive groups landing sessions and accounts by world region and keeps an uncovered source Pending', async () => {
  const A = executiveWithReview({});
  const month = A.bogotaMonth();
  const from = `${month}-01`, today = A.ui.today();
  const cover = (source, key) => ({ source, key, from, to: today, rows: [{ available: true }] });
  const geo = (source, metric, country, value) => ({ source, metric, date: from, dim: 'country', dim_value: country, value });
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  A.S.data.snapshots.push(cover('ga4', 'executive_landing'));
  A.S.data.metrics.push(
    geo('ga4', 'ga_exec_geo_sessions', 'Colombia', 60), geo('ga4', 'ga_exec_geo_sessions', 'Mexico', 20),
    geo('ga4', 'ga_exec_geo_sessions', 'United States', 15), geo('ga4', 'ga_exec_geo_sessions', 'Atlantis', 5),
    geo('posthog', 'ph_accounts_geo', 'Colombia', 4),
  );
  const html = await renderExecutive(A);
  assert.match(html, /Sessions and accounts by world region/);
  assert.match(html, /LATAM plan countries<br><small class="text-muted">Colombia, Mexico<\/small>[\s\S]*?>80<small class="text-muted"> 80\.0%/);
  assert.match(html, /United States and Canada[\s\S]*?>15</);
  assert.match(html, /Not in the region table<br><small class="text-muted">Atlantis/, 'an unknown country is listed by name');
  assert.match(html, /LATAM plan countries(?:(?!<\/tr>)[\s\S])*Pending/, 'accounts without coverage are Pending, not 0');
  A.S.data.snapshots.push(cover('posthog', 'account_coverage'));
  const both = A.views.executive.render();
  assert.match(both, /LATAM plan countries(?:(?!<\/tr>)[\s\S])*>4<small class="text-muted"> 100\.0%/);
});

test('Executive lists personas with their names, keeps the untagged row and says how much carries a code', async () => {
  const html = await renderExecutive(executiveWithReview({ personas: {
    status: 'loaded', from: '2026-11-01', to: '2026-11-12', loaded: { sessions: true, forms: false, accounts: true, projects: true }, tagged: { sessions: 0.25, forms: null, accounts: 0.5, projects: 1 },
    rows: [
      { persona: 'p05', name: 'Designers', sessions: 25, forms: null, accounts: 3, projects: 0 },
      { persona: '(no persona code)', name: null, sessions: 75, forms: null, accounts: 3, projects: 0 },
    ],
  } }));
  assert.match(html, /Personas this month/);
  assert.match(html, /p05<\/span> Designers[\s\S]*?>25<[\s\S]*?Pending[\s\S]*?>3</);
  assert.match(html, /class="muted"[\s\S]*?\(no persona code\)/);
  assert.match(html, /A persona code reaches 25\.0% of landing sessions, 50\.0% of attributed accounts\./);
});

test('Executive says in one line that no visit carries a persona code instead of a one-row table', async () => {
  const html = await renderExecutive(executiveWithReview({ personas: {
    status: 'loaded', from: '2026-11-01', to: '2026-11-12', loaded: { sessions: true, forms: true, accounts: true, projects: true }, tagged: { sessions: 0, forms: 0, accounts: 0, projects: 0 },
    rows: [{ persona: '(no persona code)', name: null, sessions: 849, forms: 22, accounts: 13, projects: 13 }],
  } }));
  assert.match(html, /No visit this month carries a persona code[^<]*all 849 landing sessions and 22 forms stay untagged/);
  assert.doesNotMatch(html, /By persona|A persona code reaches/);
});

test('Overview groups by week by default and splits impressions to clicks by ad channel', () => {
  const A = dashboard();
  assert.equal(A.D.grain(), 'week');
  A.S.from = '2026-11-01'; A.S.to = '2026-11-14'; A.S.ovWin = 'range';
  const d = '2026-11-10';
  A.S.data.metrics.push(
    { source: 'meta', metric: 'ad_impressions', value: 10000, date: d, dim_value: 'Early Builders' },
    { source: 'meta', metric: 'ad_outbound_clicks', value: 80, date: d, dim_value: 'Early Builders' },
    { source: 'google_ads', metric: 'ad_impressions', value: 2000, date: d, dim_value: 'Search' },
    { source: 'google_ads', metric: 'ad_clicks', value: 60, date: d, dim_value: 'Search' },
  );
  const html = A.views.overview.render();
  assert.match(html, /Impressions → clicks by channel/);
  assert.match(html, /Meta Ads<\/td><td class="td-num">10,000<\/td><td class="td-num">80 <small class="text-muted">outbound clicks<\/small><\/td><td class="td-num">0\.80%/);
  assert.match(html, /Google Ads<\/td><td class="td-num">2,000<\/td><td class="td-num">60 <small class="text-muted">clicks<\/small><\/td><td class="td-num"><b>3\.00%<\/b>/);
  const fed = A.overviewFunnel();
  assert.equal(fed.steps[0].value, 12000, 'the channel rows add up to the funnel impressions');
  assert.equal(fed.steps[1].value, 140, 'and to the funnel clicks');
});

test('channels follow the Early Builders rule: exact source, medium and campaign, HubSpot emails with Referrals', () => {
  const { classify, formUtm } = require('../public/js/channels');
  assert.equal(classify({ source: 'equipo', medium: 'referral', campaign: 'developer-network' }), 'referral');
  assert.equal(classify({ source: 'Google', medium: 'CPC', campaign: 'early_builders_co_202611', content: 'gmail_promo_02' }), 'gmail', 'a new piece keeps its channel');
  assert.equal(classify({ source: 'linkedin', medium: 'paid_social', campaign: 'early_builders_co_202611' }), 'linkedin');
  assert.equal(classify({ source: 'linkedin', medium: 'cpc', campaign: 'early_builders_co_202611' }), 'other', 'same campaign, other medium');
  assert.equal(classify({ source: 'google', medium: 'cpc', campaign: 'brand_search' }), 'other', 'google / cpc outside the program campaign');
  for (const source of ['hs_email', 'hs_automation', 'hubspot']) assert.equal(classify({ source, medium: 'email', campaign: 'dn_welcome' }), 'referral');
  assert.equal(classify({ source: 'hubspot', medium: 'social' }), 'other');
  assert.equal(classify({ source: 'linkedin', medium: 'influencer', campaign: 'early_builders_co_202611', content: 'jdoe_dev' }), 'influencer', 'a builder referral link');
  assert.equal(classify({ source: 'instagram', medium: 'influencer', campaign: 'early_builders_co_202611' }), 'influencer');
  assert.equal(classify({ source: 'instagram', medium: 'influencer', campaign: 'other_campaign' }), 'other');
  assert.equal(classify({ source: 'google', medium: 'cpc', campaign: 'early_builders_co_202611', content: 'prueba-01' }), 'test');
  assert.equal(classify({ source: '(not set)', medium: '', campaign: null }), 'none');
  assert.deepEqual(formUtm({ first_utm_source: 'equipo', first_utm_medium: 'referral', first_utm_campaign: 'developer-network', utm_source: 'google' }).source, 'equipo', 'first touch wins');
  assert.equal(formUtm({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'x' }).source, 'google', 'falls back to the submission UTMs');
});

test('PostHog accounts by channel come from the same rows as Accounts created and add up to it', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test', POSTHOG_PROJECT_CREATED_ENABLED: '0' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  let accountSql = '';
  t.mock.method(global, 'fetch', async (url, opts) => {
    const sql = JSON.parse(opts.body).query.query;
    if (sql.includes("event IN ('$identify', 'account_created')") && sql.includes('count() AS n, source, medium, campaign, content')) {
      accountSql = sql;
      return response({ results: [
        [date, 'External', 'Colombia', 5, 'google', 'cpc', 'early_builders_co_202611', 'gmail_promo_01'],
        [date, 'External', '', 2, 'hs_automation', 'email', 'dn_activation', 'a'],
        [date, 'Unknown', '', 1, 'equipo', 'referral', 'developer-network', '(not set)'],
        [date, 'External', 'Mexico', 3, '(not set)', '(not set)', '(not set)', '(not set)'],
        [date, 'External', 'Chile', 1, 'facebook', 'paid_social', 'eb', 'x'],
        [date, 'External', 'Chile', 1, 'linkedin', 'paid_social', 'early_builders_co_202611', 'sponsored_msg_01'],
        [date, 'External', 'Peru', 1, 'qa', 'test', 'x', ''],
        [date, 'Internal', 'Colombia', 4, 'google', 'cpc', 'early_builders_co_202611', ''],
      ] });
    }
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  assert.match(accountSql, /utm_source_first/);
  const sum = (metric, f = () => true) => load.metrics.filter((r) => r.metric === metric && f(r)).reduce((n, r) => n + r.value, 0);
  const ch = (key) => sum('ph_accounts_origin', (r) => r.dim_value === key);
  assert.deepEqual(['referral', 'gmail', 'linkedin', 'other', 'none', 'test'].map(ch), [3, 5, 1, 1, 3, 1]);
  assert.equal(sum('ph_accounts_origin'), sum('ph_accounts', (r) => r.dim_value !== 'Internal'), 'channels add up to step 5');
  assert.equal(load.snapshots.find((s) => s.key === 'account_origin_coverage').rows[0].available, true);
});

test('Overview funnel splits forms and accounts by channel into campaigns and general traffic, Pending before the sync', () => {
  const A = dashboard();
  A.S.from = '2026-11-01'; A.S.to = '2026-11-14'; A.S.ovWin = 'range';
  const d = '2026-11-10';
  A.S.data.events.push(
    { kind: 'form_signup', date: d, form: 'T4E – Early Builders Colombia', first_utm_source: 'equipo', first_utm_medium: 'referral', first_utm_campaign: 'developer-network' },
    { kind: 'form_signup', date: d, form: 'T4E – Early Builders Colombia', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'early_builders_co_202611' },
    { kind: 'form_signup', date: d, form: 'T4E – Registro LATAM' },
  );
  assert.match(A.views.overview.render(), /Pending is not zero/);
  A.S.data.snapshots.push(
    { source: 'posthog', key: 'account_coverage', from: '2026-10-01', to: '2026-11-14', rows: [{ available: true }] },
    { source: 'posthog', key: 'account_origin_coverage', from: '2026-10-01', to: '2026-11-14', rows: [{ available: true }] },
  );
  A.S.data.metrics.push(
    { source: 'posthog', metric: 'ph_accounts', date: d, dim: 'account_type', dim_value: 'External', value: 10 },
    ...[['gmail', 5], ['referral', 3], ['none', 2]].map(([v, n]) => ({ source: 'posthog', metric: 'ph_accounts_origin', date: d, dim: 'origin', dim_value: v, value: n })),
  );
  const html = A.views.overview.render();
  assert.match(html, /<b>Campaigns<\/b> <small class="text-muted">2 forms<\/small><\/td><td class="td-num"><b><span class="kpi-awaiting">Pending<\/span><\/b><\/td><td class="td-num">8<\/td>/);
  assert.match(html, /<b>General traffic<\/b> <small class="text-muted">1 form<\/small><\/td><td class="td-num"><b><span class="kpi-awaiting">Pending<\/span><\/b><\/td><td class="td-num">2<\/td>/);
  assert.doesNotMatch(html, /Gmail ads · Google Ads <small/, 'no per-channel rows');
  assert.match(html, /How each step is measured/);
  assert.doesNotMatch(html, /<span class="funnel-name">Form submissions/, 'HubSpot forms are not a funnel step');
  assert.match(html, /HubSpot form submissions: <b>3<\/b>/);
  const f = JSON.parse(JSON.stringify(A.overviewFunnel()));
  assert.deepEqual(f.by_channel.map((r) => [r.channel, r.group, r.forms, r.accounts]).slice(0, 3), [['Referrals · Developer Network', 'program', 1, 3], ['Gmail ads · Google Ads', 'program', 1, 5], ['LinkedIn paid', 'program', 0, 0]]);
});

test('the assistant reads the funnel card as drawn: window, country, step %, weakest step and its tables', () => {
  const A = dashboard();
  A.S.from = '2026-11-01'; A.S.to = '2026-11-17'; A.S.grain = 'week'; A.S.ovWin = 'grain';
  const d = '2026-11-14';
  A.S.data.snapshots.push(
    { source: 'posthog', key: 'account_coverage', from: '2026-10-01', to: '2026-11-17', rows: [{ available: true }] },
    { source: 'posthog', key: 'account_origin_coverage', from: '2026-10-01', to: '2026-11-17', rows: [{ available: true }] },
  );
  A.S.data.metrics.push(
    { source: 'meta', metric: 'ad_impressions', value: 10000, date: d }, { source: 'meta', metric: 'ad_outbound_clicks', value: 100, date: d },
    { source: 'google_ads', metric: 'ad_impressions', value: 5000, date: d }, { source: 'google_ads', metric: 'ad_clicks', value: 150, date: d },
    { source: 'meta', metric: 'ad_impressions', value: 99999, date: '2026-11-05' },
    { source: 'posthog', metric: 'ph_accounts', date: d, dim: 'account_type', dim_value: 'External', value: 6 },
    { source: 'posthog', metric: 'ph_accounts_origin', date: d, dim: 'origin', dim_value: 'gmail', value: 4 },
    { source: 'posthog', metric: 'ph_accounts_origin', date: d, dim: 'origin', dim_value: 'none', value: 2 },
  );
  A.S.data.events.push({ kind: 'form_signup', date: d, form: 'T4E – Early Builders Colombia' });
  const html = A.views.overview.render();
  const f = JSON.parse(JSON.stringify(A.overviewFunnel()));
  assert.equal(f.window, 'Nov 11 – Nov 17');
  assert.ok(html.includes(`<div class="card-sub">${f.window} · All countries`), 'same window as the card');
  assert.equal(f.country, 'All countries');
  assert.equal(f.steps[0].value, 15000, 'Nov 5 is outside the weekly window');
  assert.equal(f.steps[1].pct_of_previous, 250 / 15000);
  assert.equal(f.steps[1].previous_step, 'Impressions');
  assert.ok(f.weakest_step && html.includes(`Biggest leak: ${f.weakest_step.from} → ${f.weakest_step.to}`), 'same weakest step as the card');
  assert.deepEqual(f.channels.map((c) => [c.channel, c.impressions, c.clicks]), [['Meta Ads', 10000, 100], ['Google Ads', 5000, 150]]);
  assert.deepEqual(f.forms, [{ form: 'Early Builders Colombia', submissions: 1 }]);
  assert.deepEqual(f.by_channel.filter((r) => r.accounts).map((r) => [r.channel, r.accounts]), [['Gmail ads · Google Ads', 4], ['No UTM', 2]]);
  A.S.data.metrics.push({ source: 'posthog', metric: 'ph_accounts_geo', date: d, dim: 'country', dim_value: 'Colombia', value: 3 });
  A.S.overviewCountry = 'Colombia';
  const c = JSON.parse(JSON.stringify(A.overviewFunnel()));
  assert.equal(c.country, 'Colombia');
  assert.equal(c.steps[4].value, 3, 'the country picked on the card reaches the assistant');
  assert.deepEqual(c.channels, []);
});

test('steps 1 and 2 add the organic LinkedIn page impressions and post clicks', () => {
  const A = dashboard();
  A.S.from = '2026-11-01'; A.S.to = '2026-11-14'; A.S.ovWin = 'range';
  const d = '2026-11-10';
  A.S.data.metrics.push(
    { source: 'meta', metric: 'ad_impressions', value: 10000, date: d }, { source: 'meta', metric: 'ad_outbound_clicks', value: 100, date: d },
    { source: 'google_ads', metric: 'ad_impressions', value: 2000, date: d }, { source: 'google_ads', metric: 'ad_clicks', value: 60, date: d },
    { source: 'linkedin', metric: 'post_impressions', value: 3000, date: d }, { source: 'linkedin', metric: 'post_clicks', value: 90, date: d },
  );
  const html = A.views.overview.render();
  const f = JSON.parse(JSON.stringify(A.overviewFunnel()));
  assert.equal(f.steps[0].value, 15000, 'Meta + Google + LinkedIn page');
  assert.equal(f.steps[0].source, 'Meta Ads · Google Ads · LinkedIn page');
  assert.equal(f.steps[1].value, 250, 'Meta outbound + Google Ads clicks + LinkedIn post clicks');
  assert.equal(f.steps[1].source, 'Meta outbound · Google Ads clicks · LinkedIn page clicks');
  assert.match(html, /LinkedIn · organic page<br><small class="text-muted">Organic posts · every click on a post/);
  assert.match(html, /Google Ads<\/td><td class="td-num">2,000<\/td><td class="td-num">60 <small class="text-muted">clicks<\/small><\/td><td class="td-num"><b>3\.00%<\/b>/, 'the best rate is ranked among paid channels only');
  assert.deepEqual(f.channels.map((c) => [c.channel, c.organic]), [['Meta Ads', false], ['Google Ads', false], ['LinkedIn · organic page', true]]);
  A.S.data.metrics.push({ source: 'meta', metric: 'ad_impressions_geo', value: 4000, date: d, dim: 'country', dim_value: 'Colombia' }, { source: 'ga4', metric: 'ga_exec_geo_sessions', value: 5, date: d, dim: 'country', dim_value: 'Colombia' });
  A.S.overviewCountry = 'Colombia';
  assert.equal(A.overviewFunnel().steps[0].value, 4000, 'a country view counts ads only: LinkedIn page has no country');
});


test('started sign-up always holds the accounts created, and logins are unique people without internal accounts', () => {
  const A = dashboard();
  A.S.from = '2026-11-01'; A.S.to = '2026-11-14'; A.S.ovWin = 'range';
  const d = '2026-11-10';
  A.S.data.snapshots.push(
    { source: 'posthog', key: 'account_coverage', from: '2026-10-01', to: '2026-11-14', rows: [{ available: true }] },
    { source: 'posthog', key: 'signup_start_coverage', from: '2026-10-01', to: '2026-11-14', rows: [{ available: true }] },
    { source: 'posthog', key: 'product_usage', from: '2026-10-01', to: '2026-11-14', pulled_at: '2026-11-14T10:00:00Z', rows: [{ available: true, accounts: 4 }] },
    { source: 'posthog', key: 'product_usage_1', from: '2026-10-01', to: '2026-11-14', rows: [
      { created: '2026-10-20', signin_days: ['2026-10-21', '2026-11-03', '2026-11-04'], internal: false },
      { created: '2026-11-05', signin_days: ['2026-11-05'], internal: false },
      { created: '2026-11-06', signin_days: [], internal: false },
      { created: '2026-11-02', signin_days: ['2026-11-02', '2026-11-09'], internal: true },
      { created: '2026-10-02', signin_days: ['2026-10-03'], internal: false },
    ] },
  );
  A.S.data.metrics.push(
    { source: 'posthog', metric: 'ph_accounts', date: d, dim: 'account_type', dim_value: 'External', value: 35 },
    { source: 'posthog', metric: 'ph_signup_starts', date: d, dim: 'account_type', dim_value: 'External', value: 40 },
    { source: 'posthog', metric: 'ph_signup_starts', date: d, dim: 'account_type', dim_value: 'Internal', value: 7 },
    { source: 'posthog', metric: 'ph_signup_starts_reg', date: d, dim: 'account_type', dim_value: 'External', value: 12 },
    { source: 'posthog', metric: 'ph_event', date: d, dim: 'event', dim_value: 'signed_in', value: 208 },
  );
  const html = A.views.overview.render();
  const f = JSON.parse(JSON.stringify(A.overviewFunnel()));
  assert.equal(f.steps[3].step, 'Started sign-up');
  assert.equal(f.steps[3].value, 40, 'internal people excluded');
  assert.equal(f.steps[3].with_registration_started, 12);
  assert.equal(f.steps[4].pct_of_previous, 35 / 40, 'accounts are part of started sign-up');
  assert.match(html, /Started sign-up: 40 people, 12 of them through the landing code \(registration_started\) and 28 who created the account directly/);
  assert.equal(f.steps[5].value, 2, 'two external people signed in between Nov 1 and Nov 14, not 208 events');
  assert.equal(f.steps[5].counts, 'people');
  assert.match(html, /2<em>people<\/em>/);
});

test('PostHog started sign-up counts the first registration_started, account_created or $identify per person', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test', POSTHOG_PROJECT_CREATED_ENABLED: '0' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  let sql = '';
  t.mock.method(global, 'fetch', async (url, opts) => {
    const q = JSON.parse(opts.body).query.query;
    if (q.includes("event IN ('registration_started', '$identify', 'account_created')")) { sql = q; return response({ results: [[date, 'External', 40, 12], [date, 'Internal', 7, 7]] }); }
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  assert.match(sql, /person\.created_at >= toDate/, 'same person filter as Accounts created');
  const sum = (m, f = () => true) => load.metrics.filter((r) => r.metric === m && f(r)).reduce((n, r) => n + r.value, 0);
  assert.equal(sum('ph_signup_starts', (r) => r.dim_value !== 'Internal'), 40);
  assert.equal(sum('ph_signup_starts_reg', (r) => r.dim_value !== 'Internal'), 12);
  assert.equal(load.snapshots.find((x) => x.key === 'signup_start_coverage').rows[0].available, true);
});


test('builders by channel are verified accounts, like Early Builders; forms sit small next to each channel', () => {
  const A = dashboard();
  A.S.from = '2026-10-01'; A.S.to = '2026-11-17'; A.S.ovWin = 'range';
  const d = '2026-11-10';
  for (const key of ['account_coverage', 'account_origin_coverage', 'builders_coverage']) A.S.data.snapshots.push({ source: 'posthog', key, from: '2026-10-01', to: '2026-11-17', rows: [{ available: true }] });
  const m = (metric, v, n) => ({ source: 'posthog', metric, date: d, dim: 'origin', dim_value: v, value: n });
  A.S.data.metrics.push(
    { source: 'posthog', metric: 'ph_accounts', date: d, dim: 'account_type', dim_value: 'External', value: 35 },
    m('ph_accounts_origin', 'gmail', 16), m('ph_accounts_origin', 'referral', 3), m('ph_accounts_origin', 'none', 16),
    m('ph_builders_origin', 'gmail', 14), m('ph_builders_origin', 'referral', 3), m('ph_builders_origin', 'none', 10),
    { source: 'posthog', metric: 'ph_builders_internal', date: d, dim: 'account_type', dim_value: 'Internal', value: 9 },
    { source: 'google_ads', metric: 'ad_spend', date: d, dim: 'campaign', dim_value: 'Early Builders CO - Gmail - 2026-11', value: 490 },
    { source: 'google_ads', metric: 'ad_clicks', date: d, dim: 'campaign', dim_value: 'Early Builders CO - Gmail - 2026-11', value: 1044 },
  );
  A.S.data.events.push({ kind: 'form_signup', date: d, form: 'T4E – Early Builders Colombia', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'early_builders_co_202611' });
  const html = A.views.overview.render();
  assert.match(html, /<h4 class="cf-sub">Builders · campaigns vs general traffic<\/h4>/);
  assert.match(html, /<b>Campaigns<\/b> <small class="text-muted">1 form<\/small><\/td><td class="td-num"><b>17<\/b><\/td><td class="td-num">19<\/td>/);
  assert.match(html, /<b>General traffic<\/b> <small class="text-muted">0 forms<\/small><\/td><td class="td-num"><b>10<\/b><\/td><td class="td-num">16<\/td>/);
  assert.match(html, /9 internal builders left out\./);
});

test('PostHog builders are the first account_verified per person, by channel, internal excluded', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test', POSTHOG_PROJECT_CREATED_ENABLED: '0' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', async (url, opts) => {
    const q = JSON.parse(opts.body).query.query;
    if (q.includes("WHERE event = 'account_verified'") && q.includes('count() AS n, source, medium, campaign, content')) {
      return response({ results: [[date, 'External', 14, 'google', 'cpc', 'early_builders_co_202611', 'gmail_promo_01'], [date, 'External', 2, 'linkedin', 'influencer', 'early_builders_co_202611', 'jdoe_dev'], [date, 'Unknown', 10, '(not set)', '(not set)', '(not set)', '(not set)'], [date, 'Internal', 5, 'google', 'cpc', 'early_builders_co_202611', '']] });
    }
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  const ch = (k) => load.metrics.filter((r) => r.metric === 'ph_builders_origin' && r.dim_value === k).reduce((n, r) => n + r.value, 0);
  assert.deepEqual([ch('gmail'), ch('influencer'), ch('none')], [14, 2, 10]);
  assert.equal(load.metrics.filter((r) => r.metric === 'ph_builders_internal').reduce((n, r) => n + r.value, 0), 5, 'internal builders counted apart');
  assert.equal(load.snapshots.find((x) => x.key === 'builders_coverage').rows[0].available, true);
});


test('each funnel step shows its % large on the right with a verdict against its target', () => {
  const A = dashboard();
  A.S.from = '2026-11-01'; A.S.to = '2026-11-14'; A.S.ovWin = 'range';
  const d = '2026-11-10';
  A.S.data.metrics.push(
    { source: 'meta', metric: 'ad_impressions', value: 10000, date: d }, { source: 'meta', metric: 'ad_outbound_clicks', value: 400, date: d },
    { source: 'ga4', metric: 'ga_exec_geo_sessions', value: 300, date: d, dim: 'country', dim_value: 'Colombia' },
  );
  const html = A.views.overview.render();
  assert.match(html, /<div class="funnel-verdict is-below is-weak"><span class="fv-text"><b>Biggest leak<\/b><small>target 10%<\/small><\/span><span class="fv-pct">4\.0%<\/span>/, 'clicks 4% are under the 10% target');
  assert.match(html, /<div class="funnel-verdict is-close"><span class="fv-text"><b>Close to target<\/b><small>target 85%<\/small><\/span><span class="fv-pct">75\.0%<\/span>/, 'sessions 75% are within 20% of 85%');
  assert.match(html, /Started sign-up · target at least 50%/);
  assert.match(html, /Targets per step/);
  const f = JSON.parse(JSON.stringify(A.overviewFunnel()));
  assert.equal(f.steps[1].target_pct_of_previous, 0.1);
  assert.equal(f.steps[1].target_max_pct_of_previous, undefined);
  assert.equal(f.steps[5].target_pct_of_previous, undefined, 'logins have no target');
});


test('the assistant gets the previous window of the same length and the ad spend', () => {
  const A = dashboard();
  A.S.from = '2026-11-08'; A.S.to = '2026-11-14'; A.S.ovWin = 'range';
  A.S.data.metrics.push(
    { source: 'meta', metric: 'ad_impressions', value: 1000, date: '2026-11-10' }, { source: 'meta', metric: 'ad_spend', value: 50, date: '2026-11-10' },
    { source: 'meta', metric: 'ad_impressions', value: 400, date: '2026-11-03' }, { source: 'meta', metric: 'ad_spend', value: 20, date: '2026-11-03' },
  );
  const f = JSON.parse(JSON.stringify(A.overviewFunnel()));
  assert.equal(f.previous_window.window, 'Nov 1 – Nov 7');
  assert.equal(f.previous_window.steps[0].value, 400);
  assert.deepEqual(f.spend, [{ platform: 'Meta Ads', spend: 50, previous_spend: 20 }]);
});


test('a step larger than the one above is grey with the multiple, a met step is green, a missing step says no data', () => {
  const A = dashboard();
  const C = A.charts;
  const html = C.funnel([
    { name: 'Impressions', src: 'a', n: 1000 },
    { name: 'Clicks to the landing', src: 'b', n: 100, target: 0.07, targetMax: 0.1 },
    { name: 'Landing sessions', src: 'c', n: 180, why: 'organic too' },
    { name: 'Started sign-up', src: 'd', n: null },
  ], 'x', { verdicts: true });
  assert.match(html, /funnel-verdict is-met"><span class="fv-text"><b>On target<\/b><small>target 7–10%<\/small><\/span><span class="fv-pct">10\.0%/);
  assert.match(html, /funnel-verdict is-over"><span class="fv-text"><b>More than the step above<\/b><small>organic too<\/small><\/span><span class="fv-pct">1\.8×/);
  assert.match(html, /funnel-verdict is-empty"><span class="fv-text"><b>No data yet<\/b><small>not zero/);
  assert.doesNotMatch(html, /drop-off|funnel-conn/, 'verdicts replace the connector lines');
  assert.doesNotMatch(C.funnel([{ name: 'A', src: 'a', n: 10 }, { name: 'B', src: 'b', n: 5 }], 'y'), /funnel-verdict/, 'other funnels keep their layout');
});

// Users acquired (Acquisition): PostHog accounts, non-Internal, the same people Overview counts.
// November data: attribution splits start on 2026-11-06, so the 2026-11-03 accounts count in the total only.
function acquiredData(A, { utm = true } = {}) {
  A.S.from = '2026-10-01'; A.S.to = '2026-11-20'; A.S.goalMonth = '2026-11'; A.ui.today = () => '2026-11-21';
  A.S.data.goalPlan = require('../lib/targets').DEFAULT_PLAN;
  const day = (d) => `2026-11-${String(d).padStart(2, '0')}`;
  const row = (metricName, dim, value, d, dim_value) => ({ source: 'posthog', metric: metricName, value, date: day(d), dim, dim_value });
  const acc = (value, d, type = 'External') => row('ph_accounts', 'account_type', value, d, type);
  const spend = (source, value, d) => ({ source, metric: 'ad_spend', value, date: day(d), dim: 'campaign', dim_value: 'c' });
  A.S.data.metrics = [
    acc(5, 3), acc(6, 10), acc(4, 11), acc(3, 11, 'Internal'),
    row('ph_accounts_origin', 'origin', 5, 3, 'none'),
    row('ph_accounts_origin', 'origin', 3, 10, 'other'), row('ph_accounts_origin', 'origin', 1, 10, 'gmail'), row('ph_accounts_origin', 'origin', 2, 10, 'none'), row('ph_accounts_origin', 'origin', 4, 11, 'none'),
    row('ph_builders_origin', 'origin', 2, 10, 'other'), row('ph_builders_origin', 'origin', 1, 11, 'gmail'),
    ...(utm ? [
      row('ph_accounts_utm', 'utm', 5, 3, 'meta|paid_social|latam_co|p01_video'),
      row('ph_accounts_utm', 'utm', 2, 10, 'meta|paid_social|latam_co|p01_video'), row('ph_accounts_utm', 'utm', 1, 10, 'instagram|social|organic_ig|p03_reel'),
      row('ph_accounts_utm', 'utm', 1, 10, 'google|cpc|early_builders_co_202611|gmail_promo_01'),
      row('ph_accounts_utm', 'utm', 2, 10, '(not set)|(not set)|(not set)|(not set)'), row('ph_accounts_utm', 'utm', 4, 11, '(not set)|(not set)|(not set)|(not set)'),
      row('ph_builders_utm', 'utm', 2, 10, 'meta|paid_social|latam_co|p01_video'), row('ph_builders_utm', 'utm', 1, 11, 'google|cpc|early_builders_co_202611|gmail_promo_01'),
    ] : []),
    spend('meta', 50, 3), spend('meta', 30, 10), spend('google_ads', 12.5, 10),
    row('ph_accounts_geo', 'country', 5, 10, 'Colombia'), row('ph_accounts_geo', 'country', 1, 10, 'Spain'),
  ];
  const cov = (key) => ({ source: 'posthog', key, from: '2026-10-01', to: '2026-11-20', rows: [{ available: true }] });
  A.S.data.snapshots = ['account_coverage', 'account_origin_coverage', 'builders_coverage', ...(utm ? ['account_utm_coverage', 'builders_utm_coverage'] : [])].map(cov);
}
function acquiredSection(html) { return html.slice(html.indexOf('Users acquired'), html.indexOf('Traffic to the sites')); }

test('Acquisition counts accounts like Overview: non-Internal, whatever the internal-tests toggle says', () => {
  for (const exInt of [true, false]) {
    const A = dashboard(); A.S.exInt = exInt;
    acquiredData(A);
    const html = acquiredSection(A.views.acquisition.render());
    assert.match(html, /title="15">15/, 'internal accounts never counted; the total keeps accounts before Nov 6');
    assert.match(html, /same count as Overview/);
  }
});

test('Acquisition reads accounts against the month goal and each country goal, like Overview', () => {
  const A = dashboard();
  acquiredData(A);
  const html = acquiredSection(A.views.acquisition.render());
  const g = A.D.goalAccounts();
  assert.equal(g.value, 15);
  assert.match(html, new RegExp(`Month goal[\\s\\S]*?${A.ui.pct(g.ratio).replace('.', '\\.')}`));
  assert.match(html, /15 of 500,000 accounts · November 2026/);
  assert.match(html, /500K plan/);
  // Colombia against its monthly goal from the plan; Spain has no goal; the rest has no country.
  assert.match(html, /Colombia<\/td><td class="td-num">5<\/td><td class="td-num">57,598/);
  assert.match(html, /Other countries<\/td><td class="td-num">1</);
  assert.match(html, /No country<\/td><td class="td-num">9</);
});

test('Acquisition splits accounts by channel, persona, campaign and platform from Nov 6, with verified people', () => {
  const A = dashboard();
  acquiredData(A);
  const html = acquiredSection(A.views.acquisition.render());
  // Attribution window Nov 6 – Nov 20: 10 accounts, 4 with a UTM; the 5 Meta accounts of Nov 3 are left out.
  assert.match(html, /With a first-touch UTM[\s\S]*?title="4">4/);
  assert.match(html, /40\.0% of 10 accounts · Nov 6 – Nov 20/);
  assert.match(html, /First-touch UTMs are recorded from Nov 6; earlier accounts are left out of this split/);
  // Paid = paid medium (Meta paid_social, Google cpc); organic includes Instagram social and no UTM.
  assert.match(html, /Paid \/ organic[\s\S]*?3 \/ 7/);
  // Spend in the window only: (30 + 12.5) / 3 accounts and / 3 verified; the Nov 3 Meta spend is left out.
  assert.match(html, /\$42\.50 ÷ 3 accounts from Meta, Google Ads and LinkedIn UTMs · \$14\.17 per verified account/);
  assert.match(html, /Meta<\/td><td class="td-num">\$30\.00<\/td><td class="td-num">2<\/td><td class="td-num">\$15\.00<\/td><td class="td-num">2<\/td><td class="td-num">\$15\.00/);
  assert.match(html, /Spend in US dollars, converted at sync/);
  // Channel table with verified people: Other UTM 3 accounts, 2 verified.
  assert.match(html, /Other UTM<\/td><td class="td-num">3<\/td><td class="td-num">30\.0%<\/td><td class="td-num">2<\/td><td class="td-num">66\.7%/);
  // Persona from utm_content; Gmail's piece has no persona code.
  assert.match(html, /p01<\/span><\/td><td class="td-num">2</);
  assert.match(html, /p03<\/span><\/td><td class="td-num">1</);
  assert.match(html, /No persona code<\/td><td class="td-num">1</);
  assert.match(html, /No UTM<\/td><td class="td-num">6</);
  // Campaigns sum utm_content; Meta named even though its channel is Other UTM; Executive difference explained.
  assert.match(html, /latam_co<\/code>[\s\S]*?meta \/ paid_social[\s\S]*?Other UTM[\s\S]*?Paid · Meta[\s\S]*?<td class="td-num">2<\/td>/);
  assert.match(html, /6 accounts have no first-touch UTM and are not listed/);
  assert.match(html, /Executive's campaign funnel splits a different population/);
  assert.match(html, /Not connected/, 'LinkedIn without spend data');
});

test('Acquisition attribution splits wait for Nov 6 and for the PostHog sync, never showing zero', () => {
  const A = dashboard(); A.ui.today = () => '2026-10-29';
  assert.match(acquiredSection(A.views.acquisition.render()), /Awaiting PostHog/);
  acquiredData(A, { utm: false });
  let html = acquiredSection(A.views.acquisition.render());
  assert.match(html, /title="15">15/);
  assert.match(html, /Waiting for the next PostHog sync \(accounts by first-touch UTM\)/);
  assert.match(html, /Accounts by campaign appear after the next PostHog sync/);
  acquiredData(A); A.S.to = '2026-11-05';
  html = acquiredSection(A.views.acquisition.render());
  assert.match(html, /First-touch UTMs are recorded from Nov 6; pick a range that reaches it/);
  assert.doesNotMatch(html, /Nov 6 – Nov 5/);
});

test('UTM detail joins every stored part of the GA4 report for the same window', () => {
  const A = dashboard(); A.S.from = '2026-10-19'; A.S.to = '2026-10-29'; A.S.grain = 'week'; A.ui.today = () => '2026-10-30';
  const row = (campaign) => ({ date: '2026-10-27', campaign, source: 'google', medium: 'cpc', content: 'p01', landing_page: '/home', sessions: 2, engaged_sessions: 1, key_events: 0 });
  const part = (key, rows, from = A.S.from) => ({ source: 'ga4', key, from, to: A.S.to, rows });
  A.S.data.snapshots = [
    part('utm_attribution', [row('part-one')]), part('utm_attribution_2', [row('part-two')]),
    part('utm_attribution_2', [row('stale-window')], '2026-10-01'),
    { source: 'ga4', key: 'utm_attribution_coverage', from: A.S.from, to: A.S.to, rows: [{ available: true, rows: 2, parts: 2, truncated: false }] },
  ];
  assert.deepEqual([...A.D.utmRows().map((r) => r.campaign)], ['part-one', 'part-two']);
  const html = A.views.acquisition.render();
  assert.match(html, /part-two/); assert.doesNotMatch(html, /stale-window/);
  assert.doesNotMatch(html, /reached its row limit/);
  A.S.data.snapshots[3].rows[0].truncated = true;
  assert.match(A.views.acquisition.render(), /reached its row limit/);
});

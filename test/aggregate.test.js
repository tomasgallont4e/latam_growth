'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const agg = require('../public/js/aggregate');
const { buildQuery, read } = require('../lib/funnels');
const { cleanRequest, ask } = require('../lib/assistant');

const from = '2026-10-01', to = '2026-11-05';
const phSteps = [676, 73, 33, 9, 3, 3].map((n, i) => ({ name: `step ${i}`, n }));
function sample(overrides = {}) {
  return {
    from, to, exclude: true,
    platforms: [
      { key: 'meta', name: 'Meta Ads', channel: 'Paid Social', impressions: 348000, clicks: 6468, spend: 900, paid_sessions: 2604, campaigns: [{ campaign: 'latam_co_launch', impressions: 300000, clicks: 6000, spend: 800 }, { campaign: 'latam_br', impressions: 48000, clicks: 468, spend: 100 }] },
      { key: 'linkedin', name: 'LinkedIn Ads', channel: 'Paid Social', impressions: null, clicks: null, spend: null, paid_sessions: 0, campaigns: [] },
      { key: 'google_ads', name: 'Google Ads', channel: 'Paid Search', impressions: null, clicks: null, spend: null, paid_sessions: null, campaigns: [] },
    ],
    ga4: { sessions: 2900, channels: [{ channel: 'Paid Social', sessions: 2604 }, { channel: 'Direct', sessions: 200 }, { channel: 'Referral', sessions: 96 }], campaigns: [{ campaign: 'latam_co_launch', sessions: 2500 }] },
    posthog: { status: 'loaded', steps: phSteps },
    posthogChannels: { status: 'loaded', groups: [
      { value: 'Paid Social', steps: [600, 50, 20, 4, 1, 1].map((n) => ({ n })) },
      { value: 'Direct', steps: [76, 23, 13, 5, 2, 2].map((n) => ({ n })) },
    ] },
    ...overrides,
  };
}

test('approved model separates acquisition source totals from the ordered PostHog person funnel', () => {
  const model = agg.build(sample({ hubspot: { contacts: 12, from: '2026-10-05', to: '2026-11-02', coverage: { available: true, from: '2026-10-05', to: '2026-11-02' } }, ga4: { sessions: 2900, from, to, coverage: { available: true, from, to } }, platforms: [{ key: 'meta', name: 'Meta', impressions: 348000, clicks: 6468 }] }));
  assert.deepEqual(Object.keys(model.acquisition.sources), ['ads', 'ga4', 'hubspot']);
  assert.equal(model.acquisition.sources.ads.totals.impressions, 348000);
  assert.equal(model.acquisition.sources.ads.totals.clicks, 6468);
  assert.equal(model.acquisition.sources.ga4.totals.sessions, 2900);
  assert.equal(model.acquisition.sources.hubspot.totals.contacts, 12);
  assert.deepEqual(model.acquisition.period, { from, to, cutoff: to });
  assert.deepEqual(model.product_funnel.period, { from, to, cutoff: to });
  assert.equal(model.product_funnel.steps[0].name, 'Page view');
  assert.equal(model.product_funnel.steps[3].name, 'Sign-up ($identify)');
  assert.equal(model.product_funnel.steps[3].value, 9);
  assert.ok(model.product_funnel.steps.slice(1).every((step) => step.rate_basis === 'within saved ordered PostHog funnel'));
  assert.equal(model.acquisition.cross_source_rates, undefined);
  assert.equal(model.channels, undefined);
  assert.equal(model.campaigns, undefined);
});

test('coverage mismatch is visible and missing HubSpot contacts remain pending, not zero', () => {
  const model = agg.build(sample({ hubspot: null, ga4: { sessions: 2900, from: '2026-10-01', to: '2026-10-31', channels: [{ channel: 'Organic Search', sessions: 2200 }] } }));
  assert.equal(model.acquisition.sources.hubspot.totals.contacts, null);
  assert.equal(model.acquisition.sources.hubspot.coverage.status, 'pending');
  assert.equal(model.acquisition.sources.ga4.coverage.status, 'partial');
  assert.equal(model.acquisition.coverage_mismatch, true);
  assert.equal(model.acquisition.sources.ga4.coverage.to, '2026-10-31');
  assert.equal(model.product_funnel.coverage.cutoff, to);
});


test('acquisition totals are source-separated; ordered rates exist only within PostHog persons', () => {
  const model = agg.build(sample({ hubspot: { contacts: 12, from: '2026-10-05', to: '2026-11-02', coverage: { available: true, from: '2026-10-05', to: '2026-11-02' } }, ga4: { sessions: 2900, from: '2026-10-01', to: '2026-10-31', coverage: { available: true, from: '2026-10-01', to: '2026-10-31' } } }));
  assert.deepEqual(Object.keys(model.acquisition.sources), ['ads', 'ga4', 'hubspot']);
  assert.equal(model.acquisition.sources.ads.totals.impressions, 348000);
  assert.equal(model.acquisition.sources.ads.totals.clicks, 6468);
  assert.equal(model.acquisition.sources.ga4.totals.sessions, 2900);
  assert.equal(model.acquisition.sources.hubspot.totals.contacts, 12);
  assert.deepEqual(model.acquisition.period, { from, to, cutoff: to });
  assert.deepEqual(model.product_funnel.period, { from, to, cutoff: to });
  assert.equal(model.product_funnel.steps[0].name, 'Page view');
  assert.equal(model.product_funnel.steps[3].name, 'Sign-up ($identify)');
  assert.equal(model.product_funnel.steps[3].value, 9);
  assert.ok(model.product_funnel.steps.slice(1).every((step) => step.rate_basis === 'within saved ordered PostHog funnel'));
  assert.equal(model.acquisition.cross_source_rates, undefined);
  assert.equal(model.channels, undefined);
  assert.equal(model.campaigns, undefined);
});

test('coverage mismatch is visible and missing HubSpot contacts remain pending, not zero', () => {
  const model = agg.build(sample({ hubspot: null, ga4: { sessions: 2900, from: '2026-10-01', to: '2026-10-31', coverage: { available: true, from: '2026-10-01', to: '2026-10-31' } } }));
  assert.equal(model.acquisition.sources.hubspot.totals.contacts, null);
  assert.equal(model.acquisition.sources.hubspot.coverage.status, 'pending');
  assert.equal(model.acquisition.sources.ga4.coverage.status, 'partial');
  assert.equal(model.acquisition.coverage_mismatch, true);
  assert.equal(model.acquisition.sources.ga4.coverage.to, '2026-10-31');
  assert.equal(model.product_funnel.coverage.cutoff, to);
});

test('rendered Overview group has no cross-source rates or channel/campaign joins', () => {
  const model = agg.build(sample({ hubspot: { contacts: 12, from, to, coverage: { available: true, from, to } }, ga4: { sessions: 2900, from, to, channels: [], coverage: { available: true, from, to } }, platforms: [{ key: 'meta', name: 'Meta', impressions: 348000, clicks: 6468 }] }));
  const summary = agg.summarize(model);
  assert.deepEqual(Object.keys(summary.acquisition.sources), ['ads', 'ga4', 'hubspot']);
  assert.equal(summary.rule, 'Source totals are independent populations. No cross-source conversion rates or identity joins.');
  assert.equal(summary.product_funnel.steps[3].name, 'Sign-up ($identify)');
});

test('ordered PostHog funnel has six person steps and within-funnel ratios; acquisition is separate', () => {
  const model = agg.build(sample());
  assert.deepEqual(model.product_funnel.steps.map((s) => s.key), ['page', 'cta', 'registration_started', 'signup', 'login', 'project']);
  assert.deepEqual(model.product_funnel.steps.map((s) => s.value), [676, 73, 33, 9, 3, 3]);
  assert.deepEqual(model.product_funnel.steps.map((s) => s.rate_basis), [null, ...Array(5).fill('within saved ordered PostHog funnel')]);
  assert.equal(model.product_funnel.steps[1].rate, 73 / 676);
  assert.equal(model.product_funnel.steps[3].rate, 9 / 33);
  assert.equal(model.acquisition.sources.ga4.totals.sessions, 2900);
  assert.equal(model.acquisition.sources.ads.totals.impressions, 348000);
  assert.equal(model.acquisition.sources.hubspot.totals.contacts, null);
});

test('source-native missing totals stay pending and PostHog errors are not converted to zero', () => {
  const model = agg.build(sample());
  assert.equal(model.acquisition.sources.ads.totals.impressions, 348000);
  assert.equal(model.acquisition.sources.ads.platforms[1].impressions, null);
  const none = agg.build(sample({ platforms: [], ga4: null, posthog: { status: 'error', error: 'PostHog is not configured' } }));
  assert.equal(none.acquisition.sources.ads.totals.impressions, null);
  assert.equal(none.acquisition.sources.ga4.totals.sessions, null);
  assert.equal(none.product_funnel.steps[0].status, 'error');
});

test('source/channel dimensions are kept independent, with no joins by shared labels', () => {
  const model = agg.build(sample());
  assert.equal(model.acquisition.sources.ga4.channels.find((c) => c.channel === 'Paid Social').sessions, 2604);
  assert.equal(model.acquisition.sources.ga4.channels.some((c) => c.channel === 'Direct'), true);
  assert.deepEqual(model.product_funnel.steps.map((s) => s.value), [676, 73, 33, 9, 3, 3]);
  assert.equal(model.acquisition.sources.ads.platforms[0].campaigns, undefined);
  assert.equal(model.channels, undefined);
  assert.equal(model.campaigns, undefined);
});

test('assistant receives the aggregate funnel and channel comparison, sanitized and bounded', async () => {
  const summary = agg.summarize(agg.build(sample()));
  summary.acquisition.sources.ga4.channels.push({ channel: 'leak@example.com', sessions: 1 });
  const safe = cleanRequest({ mode: 'insights', question: 'Which funnel step is next?', context: { period: { from, to }, executive_funnel: summary } });
  const funnel = safe.context.executive_funnel;
  assert.equal(funnel.product_funnel.steps.length, 6);
  assert.equal(funnel.acquisition.sources.ads.totals.impressions, 348000);
  assert.equal(funnel.acquisition.sources.ads.totals.clicks, 6468);
  assert.equal(funnel.acquisition.sources.ga4.totals.sessions, 2900);
  assert.equal(funnel.acquisition.sources.hubspot.totals.contacts, null);
  assert.equal(funnel.acquisition.sources.ga4.channels.some((c) => /@/.test(c.channel)), false);
  let sent;
  await ask({ mode: 'insights', question: 'Which funnel step is next?', context: { executive_funnel: summary } }, {
    apiKey: 'test-secret', fetchImpl: async (url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; },
  });
  assert.match(sent.system, /executive_funnel/);
  assert.match(sent.system, /never calculate cross-source conversion\/drop-off/);
  assert.match(sent.messages[0].content, /"executive_funnel"/);
});

test('PostHog breakdown reuses the saved funnel and returns persons per channel', async (t) => {
  const before = { ...process.env };
  t.after(() => { for (const key of ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY']) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });
  Object.assign(process.env, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347865', POSTHOG_API_KEY: 'test' });
  const saved = { kind: 'FunnelsQuery', series: [
    { kind: 'EventsNode', event: 'marketing_page_viewed' }, { kind: 'EventsNode', event: 'marketing_cta_clicked' }, { kind: 'EventsNode', event: 'registration_started' },
    { kind: 'EventsNode', event: '$identify', custom_name: 'Registgration Finished' }, { kind: 'ActionsNode', id: 8102, custom_name: 'Login' }, { kind: 'ActionsNode', id: 8103, custom_name: 'Project View/Project Created' },
  ], funnelsFilter: { funnelOrderType: 'ordered', funnelWindowInterval: 14, funnelWindowIntervalUnit: 'day' } };
  assert.deepEqual(buildQuery('marketing_project', from, to, false, saved, 'channel').breakdownFilter, { breakdown_type: 'session', breakdown: '$channel_type', breakdown_limit: 12 });
  assert.equal(buildQuery('marketing_project', from, to, false, saved).breakdownFilter, undefined);
  const calls = [];
  const request = async (url, opts) => {
    calls.push(opts && opts.body ? JSON.parse(opts.body) : null);
    if (url.includes('insights/?')) return { ok: true, json: async () => ({ results: [{ name: 'Marketing-to-Project Activation Funnel', short_id: 'mp', query: { kind: 'InsightVizNode', source: saved } }] }) };
    const query = calls.at(-1).query;
    if (query.kind === 'FunnelsQuery') return { ok: true, json: async () => ({ results: [
      [10, 4, 2, 1, 0, 0].map((count, order) => ({ count, order, breakdown_value: ['Direct'] })),
      [50, 9, 3, 2, 1, 1].map((count, order) => ({ count, order, breakdown_value: ['Paid Social'] })),
    ] }) };
    return { ok: true, json: async () => ({ results: [['marketing_page_viewed'], ['marketing_cta_clicked'], ['registration_started'], ['$identify']] }) };
  };
  const data = await read('marketing_project', from, to, false, request, 'channel');
  assert.equal(calls.find((c) => c && c.query.kind === 'FunnelsQuery').query.breakdownFilter.breakdown, '$channel_type');
  assert.equal(data.breakdown, 'channel');
  assert.deepEqual(data.groups.map((g) => g.value), ['Paid Social', 'Direct']);
  assert.deepEqual(data.groups[0].steps.map((s) => s.n), [50, 9, 3, 2, 1, 1]);
  assert.equal(data.groups[0].steps[3].name, 'Registration Finished');
  await assert.rejects(read('marketing_project', from, to, false, request, 'country'), /Invalid funnel breakdown/);
});

test('coverage mismatches never become source joins and absent channels remain source-native', () => {
  const model = agg.build(sample({ ga4: { sessions: 3000, from: '2026-10-01', to: '2026-10-31', channels: [{ channel: 'Paid Social', sessions: 2604 }] } }));
  assert.equal(model.acquisition.coverage_mismatch, true);
  assert.equal(model.acquisition.sources.ga4.channels[0].channel, 'Paid Social');
  assert.equal(model.acquisition.sources.ga4.channels[0].sessions, 2604);
  assert.equal(model.product_funnel.steps[1].value, 73);
  assert.equal(model.channels, undefined);
});

test('PostHog rate basis reaches the assistant and acquisition stays outside the ordered model', () => {
  const model = agg.build(sample());
  const safe = cleanRequest({ question: 'q', context: { executive_funnel: agg.summarize(model) } }).context.executive_funnel;
  assert.equal(safe.product_funnel.steps[2].rate_basis, 'within saved ordered PostHog funnel');
  assert.ok(safe.product_funnel.steps.every((s, i) => s.rate_basis === (i ? 'within saved ordered PostHog funnel' : null)));
  assert.equal(safe.product_funnel.steps[3].step, 'Sign-up ($identify)');
  assert.deepEqual(Object.keys(safe.acquisition.sources), ['ads', 'ga4', 'hubspot']);
});

// ---------- D.goalAccounts (monthly 500K goal, memory #141), tested against the real public/js/app.js
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function loadApp(today = '2026-11-10') {
  const el = () => ({ value: '', checked: false, min: '', max: '', options: [], innerHTML: '', textContent: '', dataset: {}, addEventListener() {} });
  const els = {};
  const document = { getElementById: (id) => (els[id] = els[id] || el()), documentElement: { dataset: {} }, body: { dataset: {} } };
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const ui = {
    today: () => today, esc: (s) => String(s), days: () => [],
    diffDays: (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5),
    addDays: (d, n) => iso(Date.parse(d) + n * 864e5),
    endOfMonth: (m) => { const [y, mo] = m.split('-').map(Number); return iso(Date.UTC(y, mo, 0)); },
  };
  const App = { ui, views: {}, store: () => null, resolve: (t) => t || 'overview', render() {}, logout() {}, api: () => new Promise(() => {}) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8'), { window: { App }, document, location: { hash: '' }, Intl, Date, console });
  return App;
}
const GOAL_PLAN = { verified_users: 500000, countries: { Brazil: 1, Mexico: 1, Colombia: 1, Argentina: 1, Peru: 1, Chile: 1, Ecuador: 1, 'Dominican Republic': 1, Bolivia: 1, Paraguay: 1, Uruguay: 1 } };
const ph = (metric, date, dim, dim_value, value) => ({ source: 'posthog', metric, date, dim, dim_value, value });
const COVER = [{ source: 'posthog', key: 'account_coverage', from: '2026-10-01', to: '2026-11-08', rows: [{ available: true }] }];
function goalData(snapshots) {
  return { goalPlan: GOAL_PLAN, events: [], sources: [], snapshots, metrics: [
    ph('ph_accounts', '2026-11-02', 'account_type', 'External', 100),
    ph('ph_accounts', '2026-11-03', 'account_type', 'Internal', 40),
    ph('ph_accounts', '2026-11-09', 'account_type', 'External', 999), // after the last covered day
    ph('ph_accounts', '2026-10-30', 'account_type', 'External', 7),
    ph('ph_accounts_geo', '2026-11-02', 'country', 'Brazil', 30),
    ph('ph_accounts_geo', '2026-11-02', 'country', 'Mexico', 20),
    ph('ph_accounts_geo', '2026-11-02', 'country', 'Spain', 5),
    ph('ph_accounts_geo_internal', '2026-11-03', 'country', 'Brazil', 9),
  ] };
}

test('goalAccounts always excludes internal accounts, even when Exclude internal tests is off', () => {
  const A = loadApp();
  A.S.data = goalData(COVER);
  for (const exInt of [true, false]) {
    A.S.exInt = exInt;
    const g = A.D.goalAccounts('2026-11');
    assert.equal(g.status, 'loaded');
    assert.equal(g.value, 100);
    assert.equal(g.goal, 500000);
    assert.equal(g.ratio, 100 / 500000);
  }
});

test('goalAccounts LATAM share counts only the 11 plan countries, external only', () => {
  const A = loadApp();
  A.S.data = goalData(COVER);
  A.S.exInt = false;
  const g = A.D.goalAccounts('2026-11');
  assert.equal(g.latam, 50);
  assert.equal(g.latamShare, 0.5);
});

test('goalAccounts window runs from month start to the last covered day', () => {
  const A = loadApp();
  A.S.data = goalData(COVER);
  const nov = A.D.goalAccounts('2026-11');
  assert.equal(nov.from, '2026-11-01');
  assert.equal(nov.to, '2026-11-08');
  const oct = A.D.goalAccounts('2026-10');
  assert.equal(oct.from, '2026-10-01');
  assert.equal(oct.to, '2026-10-31');
  assert.equal(oct.value, 7);
});

test('goalAccounts is Pending, never zero, without coverage', () => {
  const A = loadApp();
  A.S.data = goalData([]);
  const g = A.D.goalAccounts('2026-11');
  assert.equal(g.status, 'pending');
  assert.equal(g.value, null);
  assert.equal(g.latam, null);
  assert.equal(g.goal, 500000);
  A.S.data = goalData(COVER);
  const future = A.D.goalAccounts('2026-12');
  assert.equal(future.status, 'pending');
  assert.equal(future.to, null);
});

test('goalDaily cumulative series ends at the goal-card number; pace is goal × day ÷ days in month', () => {
  const A = loadApp();
  A.S.data = goalData(COVER);
  A.S.exInt = false;
  const p = A.D.goalDaily('2026-11');
  const g = A.D.goalAccounts('2026-11');
  assert.equal(p.dates.length, 30);
  assert.equal(p.dates[0], '2026-11-01');
  assert.equal(p.dates[29], '2026-11-30');
  assert.equal(p.values[0], 0);
  assert.equal(p.values[1], 100); // Nov 2
  assert.equal(p.values[2], 100); // Nov 3 internal excluded
  assert.equal(p.values[7], g.value); // last covered day = goal-card number
  assert.equal(p.values[8], null); // Nov 9 after coverage: empty, not zero
  assert.equal(p.pace[0], 500000 / 30);
  assert.equal(p.pace[29], 500000);
  assert.equal(p.required, (500000 * 8) / 30);
  assert.equal(p.delta, 100 - (500000 * 8) / 30);
  assert.equal(p.ahead, false);
});

test('goalDaily is all empty, never zero, without coverage', () => {
  const A = loadApp();
  A.S.data = goalData([]);
  const p = A.D.goalDaily('2026-11');
  assert.equal(p.status, 'pending');
  assert.ok(p.values.every((v) => v === null));
  assert.equal(p.required, null);
  assert.equal(p.pace[29], 500000);
});

test('the ordered PostHog identify is called sign-up and assistant never equates it to cross-source totals', async () => {
  const model = agg.build(sample());
  assert.equal(model.product_funnel.steps[3].name, 'Sign-up ($identify)');
  let sent;
  await ask({ mode: 'insights', question: 'q', context: { executive_funnel: agg.summarize(model) } }, {
    apiKey: 'test-secret', fetchImpl: async (url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; },
  });
  assert.match(sent.system, /never calculate cross-source conversion\/drop-off/);
  assert.match(sent.messages[0].content, /"Sign-up \(\$identify\)"/);
});

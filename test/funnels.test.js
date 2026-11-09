'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { buildQuery, normalize, read } = require('../lib/funnels');
const from = '2026-10-01', to = '2026-10-29';
function env(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}
test('PostHog screenshot paths keep ordered persons and registration_started separate from account_created', () => {
  const website = buildQuery('website', from, to, true);
  assert.deepEqual(website.series.map((s) => s.event), ['marketing_page_viewed', 'marketing_cta_clicked', 'registration_started']);
  assert.equal(website.funnelsFilter.funnelWindowInterval, 14);
  assert.equal(website.filterTestAccounts, true);
  const mvp = buildQuery('mvp', from, to, false);
  assert.deepEqual(mvp.series.map((s) => s.event), ['marketing_cta_clicked', 'registration_started', 'account_created', 'first_use_path_selected', 'blueprint_generated']);
  assert.equal(mvp.filterTestAccounts, false);
  assert.equal(mvp.properties, undefined);
});
test('Landing to account and project is an ordered five-step funnel and honors internal exclusion', (t) => {
  env(t, { INTERNAL_DOMAINS: 'think4ever.com', INTERNAL_COMPANIES: 'think4ever,moadbus', POSTHOG_ACTIVATION_ACTION_ID: '407660' });
  const query = buildQuery('landing_project', from, to, true);
  assert.deepEqual(query.series, [
    { kind: 'EventsNode', event: 'marketing_page_viewed' },
    { kind: 'EventsNode', event: 'marketing_cta_clicked' },
    { kind: 'EventsNode', event: 'registration_started' },
    { kind: 'EventsNode', event: '$identify', custom_name: 'Identify' },
    { kind: 'ActionsNode', id: 407660, custom_name: 'Proyecto creado (clic)' },
  ]);
  assert.equal(query.filterTestAccounts, true);
  // One shared rule: every internal pattern is excluded on email, company and name.
  for (const pattern of ['think4ever', 'moadbus', 't4e']) {
    for (const key of ['email', 'company', 'name']) {
      assert.ok(query.properties.some((p) => p.key === key && p.type === 'person' && p.operator === 'not_icontains' && p.value[0] === pattern), `${key} ${pattern}`);
    }
  }
  assert.equal(query.dateRange.date_from, from);
  assert.equal(query.funnelsFilter.funnelOrderType, 'ordered');
});
test('saved PostHog query filters and any review steps are preserved with the selected dates', (t) => {
  env(t, { INTERNAL_DOMAINS: 'think4ever.com', INTERNAL_COMPANIES: 'think4ever,moadbus' });
  const saved = buildQuery('mvp', from, to, true);
  saved.series[0].properties = [{ key: 'cta_type', type: 'event', operator: 'exact', value: ['signup'] }];
  saved.series.push({ kind: 'EventsNode', event: 'actual_review_event_from_saved_insight' });
  saved.properties = [{ key: 'qa_probe', value: ['true'], operator: 'is_not', type: 'event' }];
  const query = buildQuery('mvp', '2026-10-10', to, true, { kind: 'InsightVizNode', source: saved });
  assert.deepEqual(query.series, saved.series);
  assert.deepEqual(query.properties[0], saved.properties[0]);
  assert.equal(query.properties.length, 10); // saved filter + 3 patterns × email/company/name
  assert.equal(query.dateRange.date_from, '2026-10-10');
  assert.equal(saved.dateRange.date_from, from);
});
test('native funnel is ordered, not daily event totals, and uninstrumented downstream steps are pending', () => {
  const query = buildQuery('mvp', from, to, true);
  const data = normalize({ results: [33, 28, 0, 0, 0].map((count, order) => ({ order, count, median_conversion_time: order === 1 ? 2 : null })) }, query, new Set(['marketing_cta_clicked', 'registration_started']));
  assert.equal(data[1].n, 28); assert.equal(data[1].median_seconds, 2);
  assert.equal(data[2].n, null); assert.equal(data[2].missing, true);
  const observedZero = normalize({ results: [33, 28, 0, 0, 0].map((count, order) => ({ order, count })) }, query, new Set(query.series.map((s) => s.event)));
  assert.equal(observedZero[2].n, 0);
  assert.throws(() => normalize({ results: [] }, query));
});
test('read discovers the pictured saved insight, reuses filters and never hardcodes screenshot counts', async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347860', POSTHOG_API_KEY: 'test' });
  t.after(() => { for (const k of ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY', 'INTERNAL_DOMAINS', 'INTERNAL_COMPANIES']) { if (previous[k] == null) delete process.env[k]; else process.env[k] = previous[k]; } });
  const saved = buildQuery('website', from, to, true);
  saved.series[1].properties = [{ key: 'target', operator: 'exact', type: 'event', value: ['registration'] }];
  const calls = [];
  const request = async (url, opts) => {
    calls.push(url);
    if (url.includes('insights/?')) return { ok: true, json: async () => ({ results: [{ name: 'Website → Registration — signup CTAs only', short_id: 'website1', query: saved }] }) };
    const body = JSON.parse(opts.body);
    if (body.query.kind === 'FunnelsQuery') {
      assert.deepEqual(body.query.series[1].properties, saved.series[1].properties);
      return { ok: true, json: async () => ({ results: [100, 40, 30].map((count, order) => ({ count, order })) }) };
    }
    return { ok: true, json: async () => ({ results: saved.series.map((s) => [s.event]) }) };
  };
  const data = await read('website', from, to, true, request);
  assert.deepEqual(data.steps.map((s) => s.n), [100, 40, 30]);
  assert.equal(calls.length, 3);
});
test('Landing-to-project read uses the saved ordered funnel and applies the internal/test filter', async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347862', POSTHOG_API_KEY: 'test', INTERNAL_DOMAINS: 'think4ever.com', INTERNAL_COMPANIES: 'think4ever,moadbus', POSTHOG_ACTIVATION_ACTION_ID: '407660' });
  t.after(() => { for (const k of ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY', 'INTERNAL_DOMAINS', 'INTERNAL_COMPANIES', 'POSTHOG_ACTIVATION_ACTION_ID']) { if (previous[k] == null) delete process.env[k]; else process.env[k] = previous[k]; } });
  const saved = buildQuery('landing_project', from, to, false);
  const expected = ['marketing_page_viewed', 'marketing_cta_clicked', 'registration_started', '$identify', 'action:407660'];
  const request = async (url, opts) => {
    if (url.includes('insights/?')) return { ok: true, json: async () => ({ results: [{ name: 'Embudo landing a cuenta y proyecto (sin internos)', short_id: 'landing-account-project', query: saved }] }) };
    const body = JSON.parse(opts.body);
    if (body.query.kind === 'FunnelsQuery') {
      assert.deepEqual(body.query.series.map((s) => s.kind === 'ActionsNode' ? `action:${s.id}` : s.event), expected);
      assert.equal(body.query.filterTestAccounts, true);
      assert.equal(body.query.properties.length, 9); // 3 patterns × email/company/name
      return { ok: true, json: async () => ({ results: [599, 70, 32, 9, 2].map((count, order) => ({ count, order })) }) };
    }
    return { ok: true, json: async () => ({ results: expected.filter((s) => !s.startsWith('action:')).map((event) => [event]) }) };
  };
  const data = await read('landing_project', from, to, true, request);
  assert.deepEqual(data.steps.map((s) => s.n), [599, 70, 32, 9, 2]);
  assert.equal(data.steps[3].name, 'Identify');
  assert.equal(data.steps[4].name, 'Proyecto creado (clic)');
  assert.equal(data.steps[4].action_id, 407660);
  assert.equal(data.saved_insight, 'landing-account-project');
});
test('missing saved Landing-to-project insight explains the exact event sequence required', async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347863', POSTHOG_API_KEY: 'test' });
  t.after(() => { for (const k of ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY', 'INTERNAL_DOMAINS', 'INTERNAL_COMPANIES']) { if (previous[k] == null) delete process.env[k]; else process.env[k] = previous[k]; } });
  const request = async () => ({ ok: true, json: async () => ({ results: [] }) });
  await assert.rejects(read('landing_project', from, to, true, request), /saved PostHog funnel.*\$identify.*Proyecto creado \(clic\)/i);
});
test('Marketing-to-Project lookup follows insight pagination and recognizes PostHog derived_name', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347870', POSTHOG_API_KEY: 'test' });
  const saved = {
    kind: 'FunnelsQuery',
    series: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked' },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'ActionsNode', id: 8701, custom_name: 'Registration Finished' },
      { kind: 'ActionsNode', id: 8702, custom_name: 'Login' },
      { kind: 'ActionsNode', id: 8703, custom_name: 'Project View/Project Created' },
    ],
    funnelsFilter: { funnelOrderType: 'ordered', funnelWindowInterval: 14, funnelWindowIntervalUnit: 'day' },
    properties: [],
  };
  const calls = [];
  const request = async (url, opts) => {
    calls.push(url);
    if (url.includes('insights/?')) {
      if (url.includes('offset=100')) return { ok: true, json: async () => ({ results: [{ name: null, derived_name: 'Marketing-to-Project Activation Funnel', short_id: 'marketing-project-derived', query: { kind: 'InsightVizNode', source: saved } }] }) };
      return { ok: true, json: async () => ({ results: [], next: 'https://example.test/api/projects/347870/insights/?search=Marketing-to-Project+Activation+Funnel&limit=100&offset=100' }) };
    }
    const body = JSON.parse(opts.body);
    if (body.query.kind === 'FunnelsQuery') return { ok: true, json: async () => ({ results: saved.series.map((_, order) => ({ order, count: 6 - order })) }) };
    return { ok: true, json: async () => ({ results: [['marketing_page_viewed'], ['marketing_cta_clicked'], ['registration_started']] }) };
  };
  const data = await read('marketing_project', from, to, false, request);
  assert.equal(data.title, 'Marketing-to-Project Activation Funnel');
  assert.equal(data.saved_insight, 'marketing-project-derived');
  assert.deepEqual(data.steps.map((step) => step.n), [6, 5, 4, 3, 2, 1]);
  assert.equal(calls.filter((url) => url.includes('insights/?')).length, 2);
});

test('Marketing-to-Project lookup requires a complete page scan and no longer rejects mislabeled titles', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347871', POSTHOG_API_KEY: 'test' });
  const saved = {
    kind: 'FunnelsQuery',
    series: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked' },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'ActionsNode', id: 8801, custom_name: 'Registration Finished' },
      { kind: 'ActionsNode', id: 8802, custom_name: 'Login' },
      { kind: 'ActionsNode', id: 8803, custom_name: 'Project View/Project Created' },
    ],
  };
  const request = async (url, opts) => {
    if (url.includes('insights/?')) return { ok: true, json: async () => ({ results: [{ name: 'marketing-to-project activation funnel', derived_name: 'Marketing-to-Project Activation Funnel', short_id: 'marketing-project-derived-name', query: saved }] }) };
    const body = JSON.parse(opts.body);
    if (body.query.kind === 'FunnelsQuery') return { ok: true, json: async () => ({ results: saved.series.map((_, order) => ({ order, count: 3 - order })) }) };
    return { ok: true, json: async () => ({ results: [['marketing_page_viewed'], ['marketing_cta_clicked'], ['registration_started']] }) };
  };
  const data = await read('marketing_project', from, to, false, request);
  assert.equal(data.title, 'Marketing-to-Project Activation Funnel');
  assert.equal(data.saved_insight, 'marketing-project-derived-name');
});

test('Marketing-to-Project funnel reuses the saved six-step PostHog insight and its action IDs', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347864', POSTHOG_API_KEY: 'test', INTERNAL_DOMAINS: 'think4ever.com', INTERNAL_COMPANIES: 'think4ever,moadbus' });
  const saved = {
    kind: 'FunnelsQuery',
    series: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked', properties: [{ key: 'cta_type', type: 'event', operator: 'exact', value: ['registration'] }] },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'ActionsNode', id: 8101, custom_name: 'Registration Finished' },
      { kind: 'ActionsNode', id: 8102, custom_name: 'Login' },
      { kind: 'ActionsNode', id: 8103, custom_name: 'Project View/Project Created' },
    ],
    funnelsFilter: { funnelOrderType: 'ordered', funnelWindowInterval: 9, funnelWindowIntervalUnit: 'day' },
    properties: [{ key: 'qa_probe', type: 'event', operator: 'is_not', value: ['true'] }],
  };
  const calls = [];
  const request = async (url, opts) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (url.includes('insights/?')) return { ok: true, json: async () => ({ results: [{ name: 'Marketing-to-Project Activation Funnel', short_id: 'marketing-project-1', query: { kind: 'InsightVizNode', source: saved } }] }) };
    const query = calls.at(-1).body.query;
    if (query.kind === 'FunnelsQuery') return { ok: true, json: async () => ({ results: [100, 48, 20, 8, 5, 2].map((count, order) => ({ count, order })) }) };
    return { ok: true, json: async () => ({ results: [['marketing_page_viewed'], ['marketing_cta_clicked'], ['registration_started']] }) };
  };
  const data = await read('marketing_project', from, to, true, request);
  const funnelRequest = calls.find((call) => call.body && call.body.query.kind === 'FunnelsQuery').body.query;
  assert.equal(data.title, 'Marketing-to-Project Activation Funnel');
  assert.equal(data.saved_insight, 'marketing-project-1');
  assert.equal(data.window_days, 9);
  assert.deepEqual(data.steps.map((step) => step.name), ['marketing_page_viewed', 'marketing_cta_clicked', 'registration_started', 'Registration Finished', 'Login', 'Project View/Project Created']);
  assert.deepEqual(data.steps.map((step) => step.n), [100, 48, 20, 8, 5, 2]);
  assert.deepEqual(funnelRequest.series, saved.series);
  assert.equal(funnelRequest.filterTestAccounts, true);
  assert.deepEqual(funnelRequest.properties[0], saved.properties[0]);
  assert.equal(funnelRequest.properties.length, 10); // saved filter + 3 patterns × email/company/name
  assert.equal(funnelRequest.funnelsFilter.funnelOrderType, 'ordered');
  assert.equal(funnelRequest.funnelsFilter.funnelWindowInterval, 9);
});

test('Marketing-to-Project selector key requires a saved funnel, not a fabricated action sequence', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347865', POSTHOG_API_KEY: 'test' });
  const request = async () => ({ ok: true, json: async () => ({ results: [] }) });
  await assert.rejects(read('marketing_project', from, to, true, request), /Saved PostHog funnel.*Marketing-to-Project Activation Funnel.*Expected exactly/i);
});

test('Marketing-to-Project finder tolerates saved downstream event or action nodes without guessing IDs', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347866', POSTHOG_API_KEY: 'test' });
  const saved = {
    kind: 'FunnelsQuery',
    series: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked' },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'EventsNode', event: 'registration_finished', custom_name: 'REGISTGRATION FINISHED IDENTIFY' },
      { kind: 'ActionsNode', id: 8202, custom_name: 'Login' },
      { kind: 'ActionsNode', id: 8203, custom_name: 'Project View/Project Created' },
    ],
    funnelsFilter: { funnelOrderType: 'ordered', funnelWindowInterval: 12, funnelWindowIntervalUnit: 'day' },
    properties: [],
  };
  const request = async (url, opts) => {
    if (url.includes('insights/?')) return { ok: true, json: async () => ({ results: [{ name: 'Marketing-to-Project Activation Funnel', short_id: 'marketing-project-mixed', query: saved }] }) };
    const query = JSON.parse(opts.body).query;
    if (query.kind === 'FunnelsQuery') return { ok: true, json: async () => ({ results: saved.series.map((_, order) => ({ order, count: 10 - order })) }) };
    return { ok: true, json: async () => ({ results: [['marketing_page_viewed'], ['marketing_cta_clicked'], ['registration_started'], ['registration_finished']] }) };
  };
  const data = await read('marketing_project', from, to, false, request);
  assert.equal(data.saved_insight, 'marketing-project-mixed');
  assert.deepEqual(data.steps.map((step) => step.name), ['marketing_page_viewed', 'marketing_cta_clicked', 'registration_started', 'Registration Finished', 'Login', 'Project View/Project Created']);
  assert.deepEqual(data.steps.map((step) => step.n), [10, 9, 8, 7, 6, 5]);
});

test('Marketing-to-Project reuses downstream Action IDs when PostHog omits their display names', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347869', POSTHOG_API_KEY: 'test' });
  const saved = {
    kind: 'FunnelsQuery',
    series: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked' },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'ActionsNode', id: 8501 },
      { kind: 'ActionsNode', id: 8502 },
      { kind: 'ActionsNode', id: 8503 },
    ],
    funnelsFilter: { funnelWindowInterval: 6, funnelWindowIntervalUnit: 'day' },
    properties: [],
  };
  const calls = [];
  const request = async (url, opts) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (url.includes('insights/?')) return { ok: true, json: async () => ({ results: [{ name: 'Marketing-to-Project Activation Funnel', short_id: 'marketing-project-ids-only', query: saved }] }) };
    const query = calls.at(-1).body.query;
    if (query.kind === 'FunnelsQuery') return { ok: true, json: async () => ({ results: saved.series.map((_, order) => ({ order, count: 7 - order })) }) };
    return { ok: true, json: async () => ({ results: [['marketing_page_viewed'], ['marketing_cta_clicked'], ['registration_started']] }) };
  };
  const data = await read('marketing_project', from, to, false, request);
  const query = calls.find((call) => call.body && call.body.query.kind === 'FunnelsQuery').body.query;
  assert.deepEqual(query.series, saved.series);
  assert.deepEqual(data.steps.map((step) => step.name), ['marketing_page_viewed', 'marketing_cta_clicked', 'registration_started', 'Registration Finished', 'Login', 'Project View/Project Created']);
  assert.equal(data.window_days, 6);
});

test('Marketing-to-Project lookup does not fall back to a different saved funnel title', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347867', POSTHOG_API_KEY: 'test' });
  const saved = {
    kind: 'FunnelsQuery',
    series: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked' },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'ActionsNode', id: 8301, custom_name: 'Registration Finished' },
      { kind: 'ActionsNode', id: 8302, custom_name: 'Login' },
      { kind: 'ActionsNode', id: 8303, custom_name: 'Project View/Project Created' },
    ],
  };
  const request = async (url) => ({ ok: true, json: async () => ({ results: [
    { name: 'Unrelated saved funnel', short_id: 'other', query: saved },
    { name: 'marketing-to-project activation funnel', short_id: 'case-mismatch', query: saved },
  ] }) });
  await assert.rejects(read('marketing_project', from, to, true, request), /Marketing-to-Project Activation Funnel.*not found/i);
});

test('Marketing-to-Project requires the exact visible downstream step sequence', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347868', POSTHOG_API_KEY: 'test' });
  const saved = {
    kind: 'FunnelsQuery',
    series: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked' },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'ActionsNode', id: 8401, custom_name: 'Registration Finished' },
      { kind: 'ActionsNode', id: 8402, custom_name: 'Sign in' },
      { kind: 'ActionsNode', id: 8403, custom_name: 'Project View/Project Created' },
    ],
  };
  const request = async () => ({ ok: true, json: async () => ({ results: [{ name: 'Marketing-to-Project Activation Funnel', short_id: 'wrong-sequence', query: saved }] }) });
  await assert.rejects(read('marketing_project', from, to, true, request), /Marketing-to-Project Activation Funnel.*was found \(wrong-sequence\).*step 5 does not match.*Login.*Sign in/i);
});

test('Marketing-to-Project recognizes the live insight shape ($identify "Registgration Finished", $pageview steps)', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347874', POSTHOG_API_KEY: 'test' });
  const saved = {
    kind: 'FunnelsQuery',
    series: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked' },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'EventsNode', event: '$identify', custom_name: 'Registgration Finished' },
      { kind: 'EventsNode', event: '$pageview', custom_name: 'Login', properties: [{ key: '$current_url', type: 'event', operator: 'icontains', value: 'login' }] },
      { kind: 'EventsNode', event: '$pageview', custom_name: 'Project View/Project Created', properties: [{ key: '$current_url', type: 'event', operator: 'icontains', value: 'project' }] },
    ],
    funnelsFilter: { funnelOrderType: 'ordered', funnelWindowInterval: 14, funnelWindowIntervalUnit: 'day' },
    properties: [],
  };
  const calls = [];
  const request = async (url, opts) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (url.includes('insights/?')) return { ok: true, json: async () => ({ results: [{ name: 'Marketing-to-Project Activation Funnel', short_id: 'K5KD9MSL', query: { kind: 'InsightVizNode', source: saved } }] }) };
    const query = calls.at(-1).body.query;
    if (query.kind === 'FunnelsQuery') return { ok: true, json: async () => ({ results: [120, 50, 30, 20, 12, 5].map((count, order) => ({ count, order })) }) };
    return { ok: true, json: async () => ({ results: [['marketing_page_viewed'], ['marketing_cta_clicked'], ['registration_started'], ['$identify'], ['$pageview']] }) };
  };
  const data = await read('marketing_project', from, to, false, request);
  const funnelRequest = calls.find((call) => call.body && call.body.query.kind === 'FunnelsQuery').body.query;
  assert.equal(data.saved_insight, 'K5KD9MSL');
  assert.deepEqual(funnelRequest.series, saved.series);
  assert.deepEqual(data.steps.map((step) => step.name), ['marketing_page_viewed', 'marketing_cta_clicked', 'registration_started', 'Registration Finished', 'Login', 'Project View/Project Created']);
  assert.deepEqual(data.steps.map((step) => step.n), [120, 50, 30, 20, 12, 5]);
});

test('PostHog insights pagination rejects a next link outside the configured host/project', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347872', POSTHOG_API_KEY: 'test' });
  const request = async () => ({ ok: true, json: async () => ({ results: [], next: 'https://attacker.test/api/projects/999/insights/?offset=100' }) });
  await assert.rejects(read('marketing_project', from, to, true, request), /Invalid PostHog insights pagination link/);
});

test('PostHog insights pagination has a bounded page count even for empty pages', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347873', POSTHOG_API_KEY: 'test' });
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    return { ok: true, json: async () => ({ results: [], next: `https://example.test/api/projects/347873/insights/?limit=100&offset=${offset + 100}` }) };
  };
  await assert.rejects(read('marketing_project', from, to, true, request), /exceeded the 100-page safety limit/i);
  assert.equal(calls.length, 100);
});

test('a PostHog 403 explains the missing read access instead of showing a retry as the fix', async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347861', POSTHOG_API_KEY: 'test' });
  t.after(() => { for (const k of ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY', 'INTERNAL_DOMAINS', 'INTERNAL_COMPANIES']) { if (previous[k] == null) delete process.env[k]; else process.env[k] = previous[k]; } });
  const request = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(read('website', from, to, true, request), /403.*insight:read.*query:read.*347861/i);
});

const { normalizeBreakdown, route } = require('../lib/funnels');
const marketingSaved = { kind: 'FunnelsQuery', series: [
  { kind: 'EventsNode', event: 'marketing_page_viewed' }, { kind: 'EventsNode', event: 'marketing_cta_clicked' }, { kind: 'EventsNode', event: 'registration_started' },
  { kind: 'EventsNode', event: '$identify', custom_name: 'Registgration Finished' }, { kind: 'EventsNode', event: '$pageview', custom_name: 'Login' }, { kind: 'EventsNode', event: '$pageview', custom_name: 'Project View/Project Created' },
], funnelsFilter: { funnelVizType: 'steps' } };
function marketingRequest(calls) {
  return async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, kind: body ? body.query.kind : 'insights' });
    if (!body) return { ok: true, json: async () => ({ results: [{ name: 'Marketing-to-Project Activation Funnel', short_id: 'K5KD9MSL', query: { kind: 'InsightVizNode', source: marketingSaved } }] }) };
    if (body.query.kind === 'HogQLQuery') return { ok: true, json: async () => ({ results: [['marketing_page_viewed'], ['marketing_cta_clicked'], ['registration_started'], ['$identify'], ['$pageview']] }) };
    const counts = [676, 73, 33, 9, 3, 3];
    if (!body.query.breakdownFilter) return { ok: true, json: async () => ({ results: counts.map((count, order) => ({ count, order })) }) };
    return { ok: true, json: async () => ({ results: [counts.map((count, order) => ({ count, order, breakdown_value: ['Direct'] }))] }) };
  };
}

test('funnel and breakdown lookups ignore prototype keys', () => {
  for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => buildQuery(key, from, to, false), /Invalid funnel/);
    assert.throws(() => buildQuery('website', from, to, false, null, key), /Invalid funnel breakdown/);
  }
});

test('the PostHog funnel route rejects prototype and unknown breakdowns and keeps the unsplit response', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347880', POSTHOG_API_KEY: 'test', LAUNCH_DATE: '2026-10-01' });
  const express = require('express'), http = require('node:http');
  const calls = [];
  const app = express();
  app.get('/api/funnels/posthog', route(marketingRequest(calls)));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/funnels/posthog?funnel=marketing_project&from=${from}&to=${to}&exclude=0`;
  for (const breakdown of ['toString', 'constructor', '__proto__', 'valueOf', 'country']) {
    const response = await fetch(`${base}&breakdown=${breakdown}`);
    assert.equal(response.status, 400, breakdown);
    assert.match((await response.json()).error, /breakdown must be channel or campaign/);
  }
  const badFunnel = await fetch(`http://127.0.0.1:${server.address().port}/api/funnels/posthog?funnel=toString&from=${from}&to=${to}`);
  assert.equal(badFunnel.status, 502);
  assert.match((await badFunnel.json()).error, /Invalid funnel/);
  assert.equal(calls.length, 0, 'invalid requests never reach PostHog');
  const plain = await fetch(base);
  assert.equal(plain.status, 200);
  assert.deepEqual(await plain.json(), JSON.parse(JSON.stringify(await read('marketing_project', from, to, false, marketingRequest([])))));
  const body = await (await fetch(base)).json();
  assert.equal(body.breakdown, undefined);
  assert.equal(body.groups, undefined);
  assert.deepEqual(body.steps.map((s) => s.n), [676, 73, 33, 9, 3, 3]);
});

test('breakdowns reuse the saved insight and event presence instead of rescanning PostHog', async (t) => {
  env(t, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347881', POSTHOG_API_KEY: 'test' });
  const calls = [], request = marketingRequest(calls);
  await read('marketing_project', from, to, true, request);
  await read('marketing_project', from, to, true, request, 'channel');
  await read('marketing_project', from, to, true, request, 'campaign');
  assert.equal(calls.filter((c) => c.kind === 'insights').length, 1);
  assert.equal(calls.filter((c) => c.kind === 'HogQLQuery').length, 1);
  assert.equal(calls.filter((c) => c.kind === 'FunnelsQuery').length, 3);
  // Another date range needs its own presence check, still not a new insights scan.
  await read('marketing_project', from, '2026-10-20', true, request, 'channel');
  assert.equal(calls.filter((c) => c.kind === 'insights').length, 1);
  assert.equal(calls.filter((c) => c.kind === 'HogQLQuery').length, 2);
});

test('normalizeBreakdown names PostHog null and other buckets', () => {
  const query = { series: [{ kind: 'EventsNode', event: 'a' }, { kind: 'EventsNode', event: 'b' }] };
  const group = (value, counts) => counts.map((count, order) => ({ count, order, breakdown_value: value }));
  const groups = normalizeBreakdown({ results: [
    group(['$$_posthog_breakdown_null_$$'], [5, 1]), group('$$_posthog_breakdown_other_$$', [7, 2]), group([''], [3, 0]), group(['Direct'], [9, 4]),
  ] }, query, new Set(['a', 'b']));
  assert.deepEqual(groups.map((g) => [g.value, g.steps.map((s) => s.n)]), [['Direct', [9, 4]], ['Other', [7, 2]], ['(none)', [5, 1]], ['(none)', [3, 0]]]);
});

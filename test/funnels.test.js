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
  assert.deepEqual(query.properties, [
    { key: 'email', type: 'person', operator: 'not_icontains', value: ['@think4ever.com'] },
    { key: 'company', type: 'person', operator: 'not_icontains', value: ['think4ever'] },
    { key: 'company', type: 'person', operator: 'not_icontains', value: ['moadbus'] },
  ]);
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
  assert.equal(query.properties.length, 4);
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
      assert.equal(body.query.properties.length, 3);
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
test('a PostHog 403 explains the missing read access instead of showing a retry as the fix', async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '347861', POSTHOG_API_KEY: 'test' });
  t.after(() => { for (const k of ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY', 'INTERNAL_DOMAINS', 'INTERNAL_COMPANIES']) { if (previous[k] == null) delete process.env[k]; else process.env[k] = previous[k]; } });
  const request = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(read('website', from, to, true, request), /403.*insight:read.*query:read.*347861/i);
});

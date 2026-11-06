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

test('all-channel funnel runs impressions to project with one source and unit per step', () => {
  const model = agg.build(sample());
  assert.deepEqual(model.steps.map((s) => s.key), ['impressions', 'clicks', 'sessions', 'cta', 'registration_started', 'registration_finished', 'login', 'project']);
  assert.deepEqual(model.steps.map((s) => s.value), [348000, 6468, 2900, 73, 33, 9, 3, 3]);
  assert.deepEqual(model.steps.map((s) => s.unit), ['impressions', 'clicks', 'sessions', 'persons', 'persons', 'persons', 'persons', 'persons']);
  assert.ok(model.steps.every((s) => s.source));
  // CTR within the platforms that report both.
  assert.equal(model.steps[1].rate, 6468 / 348000);
  // Sessions are compared with clicks only through paid UTM sessions, never all-source sessions.
  assert.equal(model.steps[2].rate, 2604 / 6468);
  assert.match(model.steps[2].basis, /2,604 GA4 paid UTM sessions/);
  assert.match(model.steps[2].unitChange, /clicks .* sessions/);
  // The CTA step is divided by persons who viewed a marketing page, not by GA4 sessions.
  assert.equal(model.steps[3].rate, 73 / 676);
  assert.match(model.steps[3].basis, /not divided by GA4 sessions/);
  assert.match(model.steps[3].unitChange, /sessions .* persons/);
  assert.equal(model.steps[4].rate, 33 / 73);
  assert.equal(model.highlights.registrations_finished, 9);
  assert.equal(model.highlights.top_channel_by_landing_sessions.channel, 'Paid Social');
});

test('platforms without data stay "No data connected" and are never estimated', () => {
  const model = agg.build(sample());
  const split = model.steps[0].split;
  assert.deepEqual(split.map((r) => [r.label, r.status]), [['Meta Ads', 'loaded'], ['LinkedIn Ads', 'no_data'], ['Google Ads', 'no_data']]);
  assert.equal(model.steps[0].value, 348000);
  const none = agg.build(sample({ platforms: [], ga4: null, posthog: { status: 'error', error: 'PostHog is not configured' } }));
  assert.ok(none.steps.every((s) => s.value == null && s.status === 'no_data'));
  assert.match(none.steps[0].reason, /No ad platform data connected/);
  assert.equal(none.steps[3].reason, 'PostHog is not configured');
});

test('channel matrix joins ad platforms, GA4 channels and PostHog $channel_type by name', () => {
  const model = agg.build(sample());
  const paidSocial = model.channels.find((c) => c.channel === 'Paid Social');
  assert.equal(paidSocial.impressions, 348000);
  assert.equal(paidSocial.sessions, 2604);
  assert.equal(paidSocial.registration_finished, 4);
  assert.equal(paidSocial.signup_rate_of_cta, 4 / 50);
  const referral = model.channels.find((c) => c.channel === 'Referral');
  assert.equal(referral.sessions, 96);
  assert.equal(referral.cta, 0);
  assert.equal(referral.impressions, 0);
  const campaign = model.campaigns.find((c) => c.campaign === 'latam_co_launch');
  assert.equal(campaign.impressions, 300000);
  assert.equal(campaign.sessions, 2500);
  // Without a PostHog split the PostHog columns stay unknown, not zero.
  const noSplit = agg.build(sample({ posthogChannels: { status: 'error', error: 'breakdown failed' } }));
  assert.equal(noSplit.channels.find((c) => c.channel === 'Direct').cta, null);
});

test('assistant receives the aggregate funnel and channel comparison, sanitized and bounded', async () => {
  const summary = agg.summarize(agg.build(sample()));
  summary.channels.push({ channel: 'leak@example.com', sessions: 1 });
  const safe = cleanRequest({ mode: 'insights', question: 'Which channel works best?', context: { period: { from, to }, aggregate_funnel: summary } });
  const funnel = safe.context.aggregate_funnel;
  assert.equal(funnel.steps.length, 8);
  assert.equal(funnel.steps[0].unit, 'impressions');
  assert.equal(funnel.steps[0].value, 348000);
  assert.equal(funnel.highlights.total_ad_clicks, 6468);
  assert.equal(funnel.platforms.find((p) => p.platform === 'LinkedIn Ads').connected, false);
  assert.equal(funnel.channels.some((c) => /@/.test(c.channel)), false);
  assert.equal(funnel.posthog_channel_split_available, true);
  let sent;
  await ask({ mode: 'insights', question: 'Which channel works best?', context: { aggregate_funnel: summary } }, {
    apiKey: 'test-secret', fetchImpl: async (url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; },
  });
  assert.match(sent.system, /aggregate_funnel/);
  assert.match(sent.system, /## All-channel funnel/);
  assert.match(sent.system, /not CTA clicks/);
  assert.match(sent.messages[0].content, /"aggregate_funnel"/);
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

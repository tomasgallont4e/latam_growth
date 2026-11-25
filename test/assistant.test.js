'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ask, cleanRequest, status, createLimiter } = require('../lib/assistant');

function clientAssistant() {
  const App = {
    S: { from: '2026-10-01', to: '2026-10-29', grain: 'week', exInt: true, goalCountry: 'Colombia', data: { goalPlan: { verified_users: 500000 } } },
    LAUNCH: '2026-10-01',
    render() {},
    ui: { esc: (value) => String(value).replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c])), card: (o) => `<section class="${o.cls}"><h2>${o.title}</h2>${o.body}</section>` },
    D: {
      grainName: () => 'Weekly',
      ga: () => ({ sessions: 120, users: 90, engaged: 72, rate: 0.6 }),
      accounts: () => 7, signups: () => 12, outcome: (metric) => metric === 'accounts_created' ? { status: 'loaded', value: 7 } : { status: 'pending', value: null }, registrations: () => 9, proxy: () => 2, platform: () => 12, sessions: () => 110, crmTotal: () => 4,
      paidTotals: () => ({ spend: 10, clicks: 4, sessions: 3, forms: 1 }),
      gaChannels: () => [{ channel: 'Organic Search', sessions: 80, engaged_sessions: 50 }],
      channels: () => [0, 0, 0, 40],
      gaCountries: () => [{ country: 'Colombia', sessions: 70 }],
      accountsCountries: () => ({ Colombia: 5 }),
    },
    charts: { CHANNELS: [{ name: 'Organic Search' }, { name: 'Direct' }, { name: 'Paid Search' }, { name: 'Paid Social' }] },
    platformFunnels: {
      summary: () => ({ name: 'Landing → cuenta y proyecto (sin internos)', steps: [{ name: 'Identify', n: 7 }, { name: 'Proyecto creado (clic)', n: 2 }] }),
      ensureSummary: async () => ({ name: 'Landing → cuenta y proyecto (sin internos)' }),
    },
    api: async () => ({ answer: 'Organic Search led.' }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/assistant.js'), 'utf8'), { window: { App } }, { filename: 'assistant.js' });
  return App;
}

test('assistant client summarizes the selected window and uses only aggregate dashboard data', async () => {
  const App = clientAssistant();
  const context = JSON.parse(JSON.stringify(App.assistant.context()));
  assert.deepEqual(context.period, { from: '2026-10-01', to: '2026-10-29', grouping: 'Weekly', cutoff: null });
  assert.equal(context.internal_tests_excluded, true);
  assert.equal(context.kpis.ga4_sessions, 120);
  assert.equal(context.kpis.posthog_accounts_created, 7);
  assert.equal(context.kpis.posthog_signups, 12);
  assert.equal(context.kpis.posthog_projects_created, null);
  assert.equal(context.kpis.posthog_project_create_clicks, 2);
  assert.equal(context.ga4_channels[0].channel, 'Organic Search');
  assert.equal(context.hubspot_channels[0].channel, 'Paid Social');
  assert.equal(context.hubspot_channels[0].sessions, 40);
  assert.equal(context.countries[0].signups, 5);
  assert.equal(context.posthog_funnel[1].persons, 2);
  assert.equal(JSON.stringify(context).includes('email'), false);
  App.assistant.state.ready = false;
  const html = App.assistant.render();
  assert.match(html, /growth-assistant-form/);
  assert.match(html, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(html, /test-secret/);
  let call;
  App.api = async (...args) => { call = args; return { answer: 'Organic Search led.' }; };
  const result = await App.assistant.ask('¿Qué canal va mejor?');
  assert.equal(result.answer, 'Organic Search led.');
  assert.equal(call[0], 'api/assistant/ask');
  const sent = JSON.parse(call[1].body);
  assert.equal(sent.context.kpis.ga4_sessions, 120);
  assert.equal(sent.context.posthog_funnel[1].persons, 2);
  assert.doesNotMatch(call[1].body, /private@example|raw_events/);
});

test('automatic overview insights use insight mode once per snapshot and render safe formatted findings', async () => {
  const App = clientAssistant();
  App.S.tab = 'overview';
  App.assistant.state.ready = true;
  let calls = 0, sent;
  App.api = async (url, opts) => {
    calls += 1; sent = JSON.parse(opts.body);
    return { answer: '## Lectura ejecutiva\nPaid Social concentra sesiones.\n\n## Hallazgo\n- **Evidencia:** 40 de 80 sesiones.\n- **Siguiente paso:** validar otro canal.\n<script>alert(1)</script>' };
  };
  await App.assistant.generateInsights();
  assert.equal(sent.mode, 'insights');
  assert.equal(sent.context.hubspot_channels[0].sessions, 40);
  assert.equal(calls, 1);
  const html = App.assistant.render();
  assert.match(html, /<h[34][^>]*>Lectura ejecutiva<\/h[34]>/);
  assert.match(html, /<strong>Evidencia:<\/strong>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  await App.assistant.generateInsights();
  assert.equal(calls, 1);
});

test('Overview mount automatically asks Anthropic for insights after configuration is ready', { timeout: 250 }, async () => {
  const App = clientAssistant(); App.S.tab = 'overview';
  const root = { addEventListener() {} };
  let resolveInsight;
  const called = new Promise((resolve) => { resolveInsight = resolve; });
  App.api = async (url, opts) => {
    if (url === 'api/assistant/status') return { ready: true, model: 'claude-sonnet-5-5' };
    const body = JSON.parse(opts.body); resolveInsight(body);
    return { answer: '## Lectura ejecutiva\\nChannel mix is concentrated.' };
  };
  App.assistant.mount(root);
  const request = await called;
  assert.equal(request.mode, 'insights');
  assert.equal(request.context.hubspot_channels[0].channel, 'Paid Social');
  assert.equal(App.assistant.state.ready, true);
  assert.equal(App.assistant.state.insightStatus, 'loading');
});

test('assistant forwards only bounded aggregate dashboard data to Anthropic', async () => {
  const body = {
    mode: 'insights',
    question: '¿Qué canal trajo más sesiones?',
    context: {
      period: { from: '2026-10-01', to: '2026-10-29', grouping: 'Daily' },
      internal_tests_excluded: true,
      kpis: { ga4_sessions: 1000, ga4_engaged_sessions: 600, ga4_engagement_rate: 0.6, posthog_accounts_created: 8, posthog_project_create_clicks: 3 },
      ga4_channels: [{ channel: 'Organic Search', sessions: 600, engaged_sessions: 400 }],
      hubspot_channels: [{ channel: 'Paid Social', sessions: 70, contact_email: 'private@example.com' }],
      countries: [{ country: 'Colombia', sessions: 400, accounts_created: 6 }],
      email: 'private@example.com', raw_events: [{ email: 'private@example.com' }],
    },
  };
  const safe = cleanRequest(body);
  assert.equal(JSON.stringify(safe).includes('private@example.com'), false);
  assert.deepEqual(Object.keys(safe.context), ['internal_tests_excluded', 'overview_funnel', 'derived'], 'automatic findings read only the funnel card');
  const asked = cleanRequest({ ...body, mode: 'question' });
  assert.equal(asked.context.kpis.ga4_sessions, 1000);
  assert.equal(asked.context.ga4_channels[0].channel, 'Organic Search');
  assert.equal(asked.context.hubspot_channels[0].sessions, 70);

  let request;
  const result = await ask(body, {
    apiKey: 'test-secret', model: 'claude-sonnet-5-5',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ content: [
        { type: 'thinking', thinking: 'private internal analysis' },
        { type: 'text', text: 'Organic Search ' },
        { type: 'text', text: 'led.' },
      ] }) };
    },
  });
  assert.equal(result.answer, 'Organic Search led.');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.max_tokens, 16000);
  assert.equal(payload.output_config.effort, 'medium', 'insights reason at medium effort');
  assert.equal(payload.output_config.format.type, 'json_schema', 'insights come back as structured JSON');
  assert.match(payload.system, /Write in English/);
  assert.doesNotMatch(payload.system, /Answer in Spanish/);
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.options.headers['x-api-key'], 'test-secret');
  assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.options.headers['content-type'], 'application/json');
  assert.equal(payload.model, 'claude-sonnet-5-5');
  assert.match(payload.system, /first \$identify per person/i);
  assert.match(payload.system, /Every finding must say something the card does not show/);
  assert.match(payload.messages[0].content, /¿Qué canal trajo más sesiones\?/);
  assert.doesNotMatch(payload.messages[0].content, /private@example\.com|raw_events/);
});

test('assistant reports only a sanitized stop reason when Anthropic returns no text', async () => {
  const body = { question: 'Summarize the dashboard', context: {} };
  await assert.rejects(ask(body, {
    apiKey: 'test-secret',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'thinking', thinking: 'private' }], stop_reason: 'max_tokens' }) }),
  }), (error) => error.status === 502 && error.message.includes('stop reason: max_tokens') && !error.message.includes('private'));
  await assert.rejects(ask(body, {
    apiKey: 'test-secret',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ content: [], stop_reason: 'unsafe reason <script>' }) }),
  }), (error) => error.status === 502 && !error.message.includes('unsafe') && !error.message.includes('<script>'));
});

test('assistant rejects empty prompts, oversize data, and secret-looking prompt text', () => {
  assert.throws(() => cleanRequest({ question: '  ', context: {} }), { status: 400 });
  assert.throws(() => cleanRequest({ question: 'x'.repeat(1000), context: {} }), { status: 400 });
  assert.throws(() => cleanRequest({ question: 'Mi key es sk-ant-abcdefghijklmnopqrstuvwxyz123456', context: {} }), { status: 400 });
  assert.throws(() => cleanRequest({ question: 'What happened to ana@example.com?', context: {} }), { status: 400 });
  const capped = cleanRequest({ question: 'Summarize', context: { period: {}, kpis: {}, ga4_channels: Array(100).fill({ channel: 'a', sessions: 1 }) } });
  assert.equal(capped.context.ga4_channels.length, 10);
});

test('assistant requires an API key and never returns Anthropic error details', async () => {
  await assert.rejects(ask({ question: 'How are we doing?', context: {} }, { apiKey: '' }), (error) => error.status === 503 && /ANTHROPIC_API_KEY/.test(error.message));
  await assert.rejects(ask({ question: 'How are we doing?', context: {} }, {
    apiKey: 'test-secret', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key test-secret' } }) }),
  }), (error) => error.status === 502 && !error.message.includes('test-secret'));
});

test('assistant status exposes readiness but never the key, and request caps reset per user and window', () => {
  const info = status({ ANTHROPIC_API_KEY: 'secret-value', ANTHROPIC_MODEL: 'claude-sonnet-5-5' });
  assert.deepEqual(info, { ready: true, model: 'claude-sonnet-5-5' });
  assert.equal(JSON.stringify(info).includes('secret-value'), false);
  let now = 1000;
  const allow = createLimiter({ max: 2, windowMs: 60000, now: () => now });
  assert.equal(allow('analyst'), true);
  assert.equal(allow('analyst'), true);
  assert.equal(allow('analyst'), false);
  assert.equal(allow('other'), true);
  now += 60001;
  assert.equal(allow('analyst'), true);
});

test('read-only users can POST assistant questions but cannot change dashboard data', async (t) => {
  const previous = { DASH_USERS: process.env.DASH_USERS, SESSION_SECRET: process.env.SESSION_SECRET };
  process.env.DASH_USERS = 'analyst:localtest:read';
  process.env.SESSION_SECRET = 'assistant-test-session-secret-32-chars';
  t.after(() => {
    if (previous.DASH_USERS == null) delete process.env.DASH_USERS; else process.env.DASH_USERS = previous.DASH_USERS;
    if (previous.SESSION_SECRET == null) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous.SESSION_SECRET;
  });
  const app = express(); app.use(express.json());
  require('../lib/auth').mount(app);
  app.post('/api/assistant/ask', (req, res) => res.json({ user: req.user }));
  app.post('/api/notes', (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'analyst', password: 'localtest' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const assistant = await fetch(`${base}/api/assistant/ask`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(assistant.status, 200);
  assert.equal((await assistant.json()).user, 'analyst');
  const note = await fetch(`${base}/api/notes`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(note.status, 403);
});

test('the assistant reviews the 7-step Overview funnel and never receives the saved PostHog funnel', async () => {
  const overview_funnel = { from: '2026-11-10', to: '2026-11-13', set_by: 'From/To', steps: [
    { step: 'Impressions', source: 'Meta Ads + Google Ads', value: 12000 },
    { step: 'Clicks to the landing', source: 'Meta Ads + Google Ads', value: 300 },
    { step: 'Landing sessions', source: 'GA4', value: 250 },
    { step: 'Form submissions', source: 'HubSpot', value: 20 },
    { step: 'Accounts created', source: 'PostHog', value: 10 },
    { step: 'Logins', source: 'PostHog · signed_in (events)', value: 40, counts: 'events' },
    { step: 'Projects created', source: 'PostHog · project_created', value: null, note: 'PostHog events not synced' },
    { step: 'leak@example.com', value: 1 },
  ] };
  const posthog_funnel = [{ step: 'Sign-up ($identify)', persons: 0 }];
  const safe = cleanRequest({ question: 'Review funnel', context: { overview_funnel, posthog_funnel, funnel_name: 'Landing → cuenta' } }).context;
  assert.deepEqual(safe.overview_funnel.steps.map((s) => s.step), ['Impressions', 'Clicks to the landing', 'Landing sessions', 'Form submissions', 'Accounts created', 'Logins', 'Projects created']);
  assert.equal(safe.overview_funnel.steps[5].counts, 'events');
  assert.equal(safe.overview_funnel.steps[6].value, null);
  assert.equal(safe.overview_funnel.steps[6].note, 'PostHog events not synced');
  assert.equal(safe.posthog_funnel, undefined);
  assert.equal(safe.funnel_name, undefined);
  let sent;
  await ask({ question: 'Review funnel', context: { overview_funnel, posthog_funnel } }, {
    apiKey: 'test-secret', fetchImpl: async (url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; },
  });
  assert.match(sent.system, /The funnel to review is overview_funnel/);
  assert.match(sent.messages[0].content, /"Clicks to the landing"/);
  assert.doesNotMatch(sent.messages[0].content, /Sign-up \(\$identify\)|leak@example/);
});

test('automatic findings get only the funnel card with its tables, and the prompt asks for self-contained findings', async () => {
  const overview_funnel = {
    from: '2026-11-11', to: '2026-11-17', window: 'Nov 11 – Nov 17', set_by: 'Group by Weekly', country: 'All countries',
    steps: [{ step: 'Impressions', source: 'Meta Ads · Google Ads', value: 15000 }, { step: 'Clicks to the landing', source: 'Meta outbound · Google Ads clicks', value: 250, pct_of_previous: 250 / 15000, previous_step: 'Impressions' }],
    weakest_step: { from: 'Impressions', to: 'Clicks to the landing', continue: 250 / 15000 },
    channels: [{ channel: 'Meta Ads', impressions: 10000, clicks: 100, clicks_kind: 'outbound clicks', impressions_to_clicks: 0.01 }],
    forms: [{ form: 'Early Builders Colombia', submissions: 22 }, { form: 'leak@example.com', submissions: 1 }],
    by_channel: [{ channel: 'Gmail ads', group: 'program', builders: 14, forms: 1, accounts: 16 }, { channel: 'No UTM', group: 'bogus', forms: 0, accounts: 12 }],
  };
  const body = { mode: 'insights', question: 'Write the findings', context: { overview_funnel, kpis: { ga4_sessions: 999 }, ga4_channels: [{ channel: 'Organic Search', sessions: 1 }] } };
  const safe = cleanRequest(body).context;
  assert.deepEqual(Object.keys(safe), ['internal_tests_excluded', 'overview_funnel', 'derived']);
  assert.equal(safe.overview_funnel.window, 'Nov 11 – Nov 17');
  assert.equal(safe.overview_funnel.weakest_step.to, 'Clicks to the landing');
  assert.equal(safe.overview_funnel.channels[0].impressions_to_clicks, 0.01);
  assert.deepEqual(safe.overview_funnel.forms.map((r) => r.form), ['Early Builders Colombia']);
  assert.equal(safe.overview_funnel.by_channel[0].accounts, 16);
  assert.equal(safe.overview_funnel.by_channel[0].builders, 14);
  assert.equal(safe.overview_funnel.by_channel[1].group, 'general', 'unknown groups fall back to general');
  let sent;
  await ask(body, { apiKey: 'test-secret', fetchImpl: async (url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; } });
  assert.equal(sent.model, 'claude-opus-5-5', 'findings run on the strongest model');
  assert.match(sent.system, /A finding that only restates a number from the card is wrong/);
  assert.match(sent.system, /suggestion: the single most important decision for this week/);
  assert.deepEqual(sent.output_config.format.schema.required, ['suggestion', 'findings']);
  assert.match(sent.system, /Never write internal names such as overview_funnel/);
  assert.ok(JSON.parse(sent.messages[0].content).dashboard_context.derived, 'the model gets the derived figures');
  assert.doesNotMatch(sent.messages[0].content, /ga4_sessions|Organic Search/);
});

test('the findings label shows the funnel window and country, not From/To', async () => {
  const App = clientAssistant();
  App.S.tab = 'overview';
  App.assistant.state.ready = true;
  App.overviewFunnel = () => ({ from: '2026-10-23', to: '2026-10-29', window: 'Oct 23 – Oct 29', set_by: 'Group by Weekly', country: 'All countries', steps: [] });
  App.api = async () => ({ answer: '## Takeaway\nOk' });
  await App.assistant.generateInsights(true);
  const html = App.assistant.render();
  assert.match(html, /Funnel window · Oct 23 – Oct 29 · All countries · Group by Weekly/);
  assert.doesNotMatch(html, /Selected period · 2026-10-01 to 2026-10-29/);
});


test('derived figures size the gap to target, the change and the cost so the model can interpret', () => {
  const { deriveSignals } = require('../lib/assistant');
  const d = deriveSignals({
    steps: [
      { step: 'Impressions', value: 100000 },
      { step: 'Clicks to the landing', value: 2000, pct_of_previous: 0.02, previous_step: 'Impressions', target_pct_of_previous: 0.1 },
      { step: 'Landing sessions', value: 2500, pct_of_previous: null, previous_step: 'Clicks to the landing', target_pct_of_previous: 0.85 },
      { step: 'Started sign-up', value: 50, pct_of_previous: 0.02, previous_step: 'Landing sessions', target_pct_of_previous: 0.5 },
      { step: 'Accounts created', value: 40, pct_of_previous: 0.8, previous_step: 'Started sign-up', target_pct_of_previous: 0.7 },
    ],
    previous_window: { steps: [{ step: 'Accounts created', value: 20 }, { step: 'Impressions', value: 50000 }] },
    spend: [{ platform: 'Meta Ads', spend_usd: 400, previous_spend_usd: 200 }],
    channels: [{ channel: 'Meta Ads', clicks: 1600, organic: false }, { channel: 'LinkedIn page', clicks: 400, organic: true }],
    by_channel: [{ channel: 'Gmail ads', group: 'program', builders: 8 }, { channel: 'No UTM', group: 'general', builders: 2 }],
  });
  const starts = d.steps_vs_target.find((x) => x.step === 'Started sign-up');
  assert.equal(starts.missing_people_at_target, 1200, '2,500 sessions at 50% is 1,250 starts, 1,200 more than 50');
  assert.equal(d.worst_step_vs_target.step, 'Started sign-up');
  assert.equal(d.worst_step_vs_target.accounts_if_it_reached_target, 1000, '40 accounts at 25x the start rate');
  assert.deepEqual(d.change_vs_previous_window.find((x) => x.step === 'Accounts created'), { step: 'Accounts created', now: 40, before: 20, change_pct: 100 });
  assert.equal(d.spend.per_account_usd, 10);
  assert.equal(d.spend.previous_per_account_usd, 10);
  assert.equal(d.spend.per_paid_click_usd, 0.25, 'organic LinkedIn clicks are not paid clicks');
  assert.equal(d.spend.per_campaign_builder_usd, 50);
  assert.deepEqual(d.builders, { total: 10, from_campaigns: 8, campaign_share_pct: 80 });
});

test('a Started sign-up made of direct accounts is not sized, and spend reads per platform', () => {
  // The week of Nov 12 – Nov 18: 25 starts, all of them accounts created directly, none through the landing code.
  const overview_funnel = {
    window: 'Nov 12 – Nov 18', country: 'All countries',
    steps: [
      { step: 'Impressions', value: 122862 },
      { step: 'Clicks to the landing', value: 1653, pct_of_previous: 1653 / 122862, previous_step: 'Impressions', target_pct_of_previous: 0.1 },
      { step: 'Landing sessions', value: 959, pct_of_previous: 959 / 1653, previous_step: 'Clicks to the landing', target_pct_of_previous: 0.85 },
      { step: 'Started sign-up', value: 25, with_registration_started: 0, pct_of_previous: 25 / 959, previous_step: 'Landing sessions', target_pct_of_previous: 0.5, target_basis: 'team target, half of the landing sessions start signing up; the SaaS landing page median is 3.8% (Unbounce)' },
      { step: 'Accounts created', value: 25, pct_of_previous: 1, previous_step: 'Started sign-up', target_pct_of_previous: 0.7 },
    ],
    weakest_step: { from: 'Landing sessions', to: 'Started sign-up', continue: 25 / 959 },
    channels: [{ channel: 'Meta Ads', clicks: 874 }, { channel: 'Google Ads', clicks: 768 }],
    spend: [{ platform: 'Meta Ads', spend: 48.93, previous_spend: 0 }, { platform: 'Google Ads', spend: 380.43, previous_spend: 91.91 }],
    by_channel: [
      { channel: 'Gmail ads · Google Ads', group: 'program', platform: 'Google Ads', builders: 10, accounts: 16 },
      { channel: 'No UTM', group: 'general', builders: 2, accounts: 7 },
    ],
  };
  const { context } = cleanRequest({ mode: 'insights', question: 'q', context: { overview_funnel } });
  const d = context.derived;
  assert.equal(context.overview_funnel.steps[3].with_registration_started, 0, 'the landing-code count reaches the model');
  assert.match(context.overview_funnel.steps[3].target_basis, /3\.8%/);
  assert.equal(d.measurement_gaps[0].step, 'Started sign-up');
  assert.equal(d.measurement_gaps[0].direct_accounts, 25);
  assert.deepEqual(d.not_sized_steps, ['Started sign-up', 'Accounts created']);
  assert.equal(d.steps_vs_target.some((x) => x.step === 'Started sign-up' || x.step === 'Accounts created'), false, 'no people missing from a step that is not measured');
  assert.equal(d.worst_step_vs_target.step, 'Clicks to the landing', 'the worst step is picked among measured steps');
  assert.equal(d.worst_step_vs_target.accounts_if_it_reached_target, 185, '25 accounts at 1/0.135 of the click target');
  assert.equal(context.overview_funnel.weakest_step, null, 'the unmeasured weakest step is dropped');
  const google = d.spend.by_platform.find((x) => x.platform === 'Google Ads');
  assert.deepEqual([google.accounts_from_its_links, google.builders_from_its_links, google.per_account_usd], [16, 10, 23.78]);
  const meta = d.spend.by_platform.find((x) => x.platform === 'Meta Ads');
  assert.equal(meta.accounts_from_its_links, null, 'Meta has no campaign link: unknown, not zero');
  assert.match(meta.attribution, /no campaign link/);
  assert.equal(meta.clicks, 874);
});

test('a Started sign-up mostly through the landing code is sized as before', () => {
  const { deriveSignals } = require('../lib/assistant');
  const d = deriveSignals({ steps: [
    { step: 'Landing sessions', value: 1000 },
    { step: 'Started sign-up', value: 40, with_registration_started: 30, pct_of_previous: 0.04, previous_step: 'Landing sessions', target_pct_of_previous: 0.5 },
  ] });
  assert.deepEqual(d.measurement_gaps, []);
  assert.equal(d.steps_vs_target[0].missing_people_at_target, 460);
});

test('the findings prompt keeps unmeasured steps, stretch targets and unattributed platforms out of the decision', () => {
  const { INSIGHTS_SYSTEM } = require('../lib/assistant');
  assert.match(INSIGHTS_SYSTEM, /Never size, rank, call weakest or build the decision on a step in not_sized_steps/);
  assert.match(INSIGHTS_SYSTEM, /stretch goal/);
  assert.match(INSIGHTS_SYSTEM, /never that it brought zero/);
});

test('structured findings come back parsed, and the panel shows the decision first in its own box', async () => {
  const { ask } = require('../lib/assistant');
  const json = { suggestion: 'Nov 11 – Nov 17 · All countries: Fix the landing sign-up before adding budget, because 1,200 starts are missing.', findings: [
    { headline: 'The landing loses almost every visitor', meaning: 'Only 2% start.', likely_cause: 'Likely the code step.', action: 'Test a one-field form; starts should double.' },
  ] };
  const r = await ask({ mode: 'insights', question: 'q', context: {} }, { apiKey: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(json) }] }) }) });
  assert.deepEqual(r.insights, json);
  assert.match(r.answer, /^## Suggestion\n/);

  let calls = 0;
  const fallback = await ask({ mode: 'insights', question: 'q', context: {} }, { apiKey: 'k', fetchImpl: async (u, o) => { calls += 1; const b = JSON.parse(o.body); return b.output_config.format ? { ok: false, status: 400, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '## Suggestion\nDo X' }] }) }; } });
  assert.equal(calls, 2, 'a 400 on structured output retries as plain text');
  assert.equal(fallback.answer, '## Suggestion\nDo X');

  const App = clientAssistant();
  App.S.tab = 'overview';
  App.assistant.state.ready = true;
  App.overviewFunnel = () => ({ window: 'Nov 11 – Nov 17', set_by: 'Group by Weekly', country: 'All countries', steps: [] });
  App.api = async () => r;
  await App.assistant.generateInsights(true);
  const html = App.assistant.render();
  assert.match(html, /<div class="insight-suggestion" role="note"><span class="insight-kicker">Decision for this week<\/span><p>Nov 11 – Nov 17 · All countries: Fix the landing/);
  assert.ok(html.indexOf('insight-suggestion') < html.indexOf('insight-findings'), 'the decision is above the findings');
  assert.match(html, /<span>Why<\/span>Likely the code step\./);
  assert.match(html, /<span>Do<\/span>Test a one-field form/);
});

test('Nov 23: Landing sessions are never sized against clicks, and Meta reads its own clicks against its own UTM sessions', () => {
  // All countries, Nov 23: 1,201 clicks, all Meta; 291 landing sessions from every source, 140 of them with Meta's UTM.
  const overview_funnel = {
    window: 'Nov 23', country: 'All countries',
    steps: [
      { step: 'Impressions', value: 6350 },
      { step: 'Clicks to the landing', value: 1201, pct_of_previous: 1201 / 6350, previous_step: 'Impressions', target_pct_of_previous: 0.1 },
      { step: 'Landing sessions', value: 291, pct_of_previous: 291 / 1201, previous_step: 'Clicks to the landing', target_pct_of_previous: 0.85 },
      { step: 'Started sign-up', value: 10, with_registration_started: 8, pct_of_previous: 10 / 291, previous_step: 'Landing sessions', target_pct_of_previous: 0.5 },
      { step: 'Accounts created', value: 6, pct_of_previous: 0.6, previous_step: 'Started sign-up', target_pct_of_previous: 0.7 },
    ],
    weakest_step: { from: 'Clicks to the landing', to: 'Landing sessions', continue: 291 / 1201 },
    channels: [{ channel: 'Meta Ads', impressions: 6350, clicks: 1201, sessions_from_its_utm: 140 }],
    spend: [{ platform: 'Meta Ads', spend: 11.46 }],
    by_channel: [
      { channel: 'Meta Ads · Instagram and Facebook', group: 'general', platform: 'Meta Ads', accounts: 0, builders: 0 },
      { channel: 'No UTM', group: 'general', accounts: 6, builders: 1 },
    ],
  };
  const { context } = cleanRequest({ mode: 'insights', question: 'q', context: { overview_funnel } });
  const d = context.derived;
  assert.equal(context.overview_funnel.channels[0].sessions_from_its_utm, 140, 'the sessions with its UTM reach the model');
  assert.equal(d.steps_vs_target.some((x) => x.step === 'Landing sessions'), false, 'no people "missing" between clicks and sessions');
  assert.notEqual(d.worst_step_vs_target && d.worst_step_vs_target.step, 'Landing sessions');
  assert.equal(d.not_sized_steps.includes('Landing sessions'), false);
  assert.ok(d.steps_vs_target.some((x) => x.step === 'Started sign-up'), 'Started sign-up stays sized');
  assert.equal(context.overview_funnel.weakest_step, null, 'the card weakest step to Landing sessions is dropped');
  const meta = d.spend.by_platform.find((x) => x.platform === 'Meta Ads');
  assert.equal(meta.attribution, 'campaign link');
  assert.equal(meta.accounts_from_its_links, 0, 'Meta has its link: zero accounts from it, not unknown');
  assert.equal(meta.sessions_from_its_utm, 140);
  assert.equal(meta.click_to_session_pct, 11.7);
});

test('click to session by platform is null when its sessions or clicks are missing', () => {
  const { deriveSignals } = require('../lib/assistant');
  const d = deriveSignals({
    steps: [{ step: 'Impressions', value: 1000 }],
    spend: [{ platform: 'Meta Ads', spend_usd: 5 }, { platform: 'Google Ads', spend_usd: 5 }],
    channels: [{ channel: 'Meta Ads', clicks: 100, sessions_from_its_utm: null }, { channel: 'Google Ads', clicks: null, sessions_from_its_utm: 3 }],
  });
  assert.deepEqual(d.spend.by_platform.map((x) => x.click_to_session_pct), [null, null]);
});

test('both prompts say clicks to sessions is not a share of clickers, and the findings never invent ad settings', () => {
  const { SYSTEM, INSIGHTS_SYSTEM } = require('../lib/assistant');
  for (const p of [SYSTEM, INSIGHTS_SYSTEM]) {
    assert.match(p, /Landing sessions count visits from every source/);
    assert.match(p, /is not the share of clickers who arrived/);
    assert.match(p, /click_to_session_pct/);
  }
  assert.match(INSIGHTS_SYSTEM, /Never name an ad platform setting \(placements, Audience Network/);
  assert.match(INSIGHTS_SYSTEM, /there are no LinkedIn ads/);
});

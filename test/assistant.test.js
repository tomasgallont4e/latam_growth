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
      accounts: () => 7, registrations: () => 9, proxy: () => 2, platform: () => 12, sessions: () => 110, crmTotal: () => 4,
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
  assert.deepEqual(context.period, { from: '2026-10-01', to: '2026-10-29', grouping: 'Weekly' });
  assert.equal(context.internal_tests_excluded, true);
  assert.equal(context.kpis.ga4_sessions, 120);
  assert.equal(context.kpis.posthog_accounts_created, 7);
  assert.equal(context.kpis.posthog_project_create_clicks, 2);
  assert.equal(context.ga4_channels[0].channel, 'Organic Search');
  assert.equal(context.hubspot_channels[0].channel, 'Paid Social');
  assert.equal(context.hubspot_channels[0].sessions, 40);
  assert.equal(context.countries[0].accounts_created, 5);
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
  assert.equal(safe.context.kpis.ga4_sessions, 1000);
  assert.equal(safe.context.ga4_channels[0].channel, 'Organic Search');
  assert.equal(safe.context.hubspot_channels[0].sessions, 70);

  let request;
  const result = await ask(body, {
    apiKey: 'test-secret', model: 'claude-sonnet-5-5',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Organic Search led.' }] }) };
    },
  });
  assert.equal(result.answer, 'Organic Search led.');
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.options.headers['x-api-key'], 'test-secret');
  assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.options.headers['content-type'], 'application/json');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.model, 'claude-sonnet-5-5');
  assert.ok(payload.max_tokens <= 800);
  assert.match(payload.system, /first \$identify per person/i);
  assert.match(payload.system, /do not simply list every metric/i);
  assert.match(payload.messages[0].content, /¿Qué canal trajo más sesiones\?/);
  assert.doesNotMatch(payload.messages[0].content, /private@example\.com|raw_events/);
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

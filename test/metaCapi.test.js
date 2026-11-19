'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const capi = require('../lib/metaCapi');

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const NOW = Date.parse('2026-11-18T23:00:00Z');
const ts = (daysAgo) => Math.floor(NOW / 1000) - Math.round(daysAgo * 86400);

function memStore(rows = []) {
  const items = [...rows];
  return {
    items,
    list: async (kind) => items.filter((i) => i.kind === kind).map((i) => ({ ...i.data, _k: i.k })),
    upsert: async (kind, k, data) => { items.push({ kind, k, data }); },
  };
}

const row = (over = {}) => ({
  uid: 'u1', ts: ts(1), email: ' Ana@Example.com ', fn: 'Ana', ln: 'Pérez', name: 'Ana Pérez', company: '',
  method: 'google', build_mode: 'scratch', is_test: '', qa: 0, src: 'google', med: 'cpc', camp: 'early_builders_co_202611',
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', ip: '190.1.2.3', fburl: '', ...over,
});

function withEnv(vars, fn) {
  const keys = ['META_CAPI_TEST_CODE', 'META_CAPI_LIVE'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  return Promise.resolve(fn()).finally(() => { for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
}

test('event: hashed email, names and account id; browser data only when present; event_id reg_<id>', () => {
  const e = capi.buildEvent(row());
  assert.equal(e.event_name, 'CompleteRegistration');
  assert.equal(e.event_id, 'reg_u1');
  assert.equal(e.action_source, 'website');
  assert.deepEqual(e.user_data.em, [sha('ana@example.com')]);
  assert.deepEqual(e.user_data.fn, [sha('ana')]);
  assert.deepEqual(e.user_data.ln, [sha('pérez')]);
  assert.deepEqual(e.user_data.external_id, [sha('u1')]);
  assert.equal(e.user_data.client_ip_address, '190.1.2.3');
  assert.ok(!JSON.stringify(e).includes('ana@example.com'), 'no plain email in the event');
  const noUa = capi.buildEvent(row({ ua: '', ip: '190.1.2.3' }));
  assert.equal(noUa.user_data.client_user_agent, undefined);
  assert.equal(noUa.user_data.client_ip_address, undefined, 'never an IP without the browser that sent it');
});

test('names fall back to the full name; fbc comes from an fbclid URL', () => {
  const e = capi.buildEvent(row({ fn: 'null', ln: '', name: 'Luis Carlos Gómez' }));
  assert.deepEqual(e.user_data.fn, [sha('luis')]);
  assert.deepEqual(e.user_data.ln, [sha('carlosgómez')]);
  assert.equal(capi.fbcFrom('https://go.think4ever.com/latam?fbclid=AbC123&x=1', 100), 'fb.1.100000.AbC123');
  assert.equal(capi.fbcFrom('https://go.think4ever.com/latam', 100), '');
});

test('internal, test, old and email-less accounts are left out', () => {
  const now = Math.floor(NOW / 1000);
  assert.equal(capi.skipReason(row(), now), '');
  assert.equal(capi.skipReason(row({ email: 'dev@think4ever.com' }), now), 'internal');
  assert.equal(capi.skipReason(row({ is_test: 'true' }), now), 'test');
  assert.equal(capi.skipReason(row({ qa: 1 }), now), 'test');
  assert.equal(capi.skipReason(row({ email: '' }), now), 'no_email');
  assert.equal(capi.skipReason(row({ uid: '' }), now), 'no_account_id');
  assert.equal(capi.skipReason(row({ ts: ts(8) }), now), 'older_than_7_days');
});

test('dry run sends nothing and returns no emails', async () => withEnv({}, async () => {
  let calls = 0;
  const r = await capi.run({ store: memStore(), rows: [row(), row({ uid: 'u2', email: 'x@think4ever.com' })], send: async () => { calls++; }, now: NOW });
  assert.equal(r.mode, 'dry');
  assert.equal(calls, 0);
  assert.equal(r.eligible, 1);
  assert.deepEqual(r.skipped, { internal: 1 });
  assert.deepEqual(r.event_ids, ['reg_u1']);
  assert.ok(!JSON.stringify(r).toLowerCase().includes('example.com'));
}));

test('test mode sends with the test code and records nothing', async () => withEnv({ META_CAPI_TEST_CODE: 'TEST123' }, async () => {
  const store = memStore();
  let code;
  const r = await capi.run({ store, rows: [row()], send: async (ev, c) => { code = c; return { events_received: ev.length }; }, now: NOW });
  assert.equal(r.mode, 'test');
  assert.equal(code, 'TEST123');
  assert.equal(r.events_received, 1);
  assert.equal(store.items.length, 0);
}));

test('live mode records each account and never sends it twice; forceDry overrides live', async () => withEnv({ META_CAPI_LIVE: '1' }, async () => {
  const store = memStore();
  let sent = 0;
  const send = async (ev) => { sent += ev.length; return { events_received: ev.length }; };
  const rows = [row(), row(), row({ uid: 'u3' })];
  const first = await capi.run({ store, rows, send, now: NOW });
  assert.equal(first.mode, 'live');
  assert.equal(first.sent, 2, 'duplicate rows of one account count once');
  const second = await capi.run({ store, rows, send, now: NOW });
  assert.equal(second.sent, 0);
  assert.deepEqual(second.skipped, { already_sent: 2 });
  assert.equal(sent, 2);
  const preview = await capi.run({ store: memStore(), rows, send, now: NOW, forceDry: true });
  assert.equal(preview.mode, 'dry');
  assert.equal(sent, 2);
}));

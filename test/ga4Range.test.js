
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const G = require('../lib/ga4Range');

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const ENV = { LAUNCH_DATE: '2026-10-01', GA4_PROPERTY_ID: '123', GA4_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey }) };
const REPORT = { rows: [{ metricValues: ['812', '640', '1500', '900', '0.6'].map((value) => ({ value })) }], metadata: { subjectToThresholding: true } };
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

function fakeFetch(handler) {
  const calls = { token: 0, report: 0, bodies: [] };
  const fn = async (url, init) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) { calls.token++; return reply(200, { access_token: 'tok', expires_in: 3600 }); }
    calls.report++;
    calls.bodies.push(JSON.parse(init.body));
    return handler ? handler(calls) : reply(200, REPORT);
  };
  return { fn, calls };
}
const reader = (fetch, extra = {}) => G.createReader({ env: ENV, fetch, today: () => '2026-11-09', hosts: ['go.think4ever.com'], ...extra });

test('rejects invalid ranges and a missing GA4 configuration', async () => {
  const f = fakeFetch();
  const r = reader(f.fn);
  for (const [from, to] of [['2026-11-1', '2026-11-09'], ['2026-02-30', '2026-11-09'], ['2026-09-30', '2026-11-09'], ['2026-11-01', '2026-11-10'], ['2026-11-05', '2026-11-01'], ['', '']]) {
    await assert.rejects(r.rangeTotals(from, to), (e) => e.status === 400, `${from}..${to}`);
  }
  const bare = G.createReader({ env: { LAUNCH_DATE: '2026-10-01' }, fetch: f.fn, today: () => '2026-11-09' });
  await assert.rejects(bare.rangeTotals('2026-11-01', '2026-11-09'), (e) => e.status === 409);
  assert.strictEqual(f.calls.report, 0);
});

test('maps the GA4 report to snapshot field names; an empty report is zeros', () => {
  const m = G.mapReport(REPORT);
  assert.deepStrictEqual(m, { users: 812, new_users: 640, sessions: 1500, engaged_sessions: 900, engagement_rate: 0.6, subject_to_thresholding: true, user_counts_inconsistent: false });
  const empty = G.mapReport({});
  assert.strictEqual(empty.users, 0);
  assert.strictEqual(empty.subject_to_thresholding, false);
});

test('one runReport per range with the exact dates and host filter, cached for 30 minutes', async () => {
  let t = 1_000_000;
  const f = fakeFetch();
  const r = reader(f.fn, { now: () => t });
  const a = await r.rangeTotals('2026-11-01', '2026-11-09');
  assert.strictEqual(a.users, 812);
  assert.strictEqual(a.cached, false);
  assert.deepStrictEqual(f.calls.bodies[0].dateRanges, [{ startDate: '2026-11-01', endDate: '2026-11-09' }]);
  assert.deepStrictEqual(f.calls.bodies[0].dimensionFilter.filter.inListFilter.values, ['go.think4ever.com']);
  assert.deepStrictEqual(f.calls.bodies[0].metrics.map((m) => m.name), G.METRICS);
  const b = await r.rangeTotals('2026-11-01', '2026-11-09');
  assert.strictEqual(b.cached, true);
  assert.strictEqual(f.calls.report, 1);
  await r.rangeTotals('2026-11-02', '2026-11-09');
  assert.strictEqual(f.calls.report, 2);
  assert.strictEqual(f.calls.token, 1, 'token is reused');
  t += 31 * 60 * 1000;
  await r.rangeTotals('2026-11-01', '2026-11-09');
  assert.strictEqual(f.calls.report, 3, 'expired cache asks GA4 again');
});

test('simultaneous requests for one range share a single GA4 call', async () => {
  const f = fakeFetch();
  const r = reader(f.fn);
  const [a, b] = await Promise.all([r.rangeTotals('2026-11-01', '2026-11-09'), r.rangeTotals('2026-11-01', '2026-11-09')]);
  assert.strictEqual(a.users, b.users);
  assert.strictEqual(f.calls.report, 1);
});

test('a GA4 failure is a 502 and is not cached', async () => {
  let failNext = true;
  const f = fakeFetch(() => (failNext ? reply(500, { error: 'boom' }) : reply(200, REPORT)));
  const r = reader(f.fn);
  await assert.rejects(r.rangeTotals('2026-11-01', '2026-11-09'), (e) => e.status === 502);
  failNext = false;
  const ok = await r.rangeTotals('2026-11-01', '2026-11-09');
  assert.strictEqual(ok.users, 812);
  assert.strictEqual(f.calls.report, 2);
});

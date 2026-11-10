'use strict';
const test = require('node:test');
const assert = require('node:assert');

function fresh(env) {
  const keys = ['INTERNAL_PATTERNS', 'INTERNAL_DOMAINS', 'INTERNAL_COMPANIES'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env || {});
  delete require.cache[require.resolve('../lib/internal')];
  const mod = require('../lib/internal');
  for (const k of keys) { if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k]; }
  return mod;
}

test('default patterns exclude think4ever, moadbus and t4e in email, company or name', () => {
  const I = fresh();
  assert.deepStrictEqual(I.PATTERNS, ['think4ever', 'moadbus', 't4e']);
  assert.strictEqual(I.isInternal({ email: 'ana@think4ever.com' }), true);
  assert.strictEqual(I.isInternal({ email: 'qa@moadbus.io' }), true);
  assert.strictEqual(I.isInternal({ company: 'Moadbus SAS' }), true);
  assert.strictEqual(I.isInternal({ name: 'Prueba T4E' }), true);
  assert.strictEqual(I.isInternal({ email: 'cliente@empresa.co', company: 'Acme', name: 'Ana' }), false);
  assert.strictEqual(I.isInternal({}), false);
});

test('legacy domain and company variables still add patterns', () => {
  const I = fresh({ INTERNAL_DOMAINS: 'partner.dev', INTERNAL_COMPANIES: 'Acme QA' });
  assert.ok(I.PATTERNS.includes('partner.dev'));
  assert.ok(I.PATTERNS.includes('acme qa'));
  assert.ok(I.PATTERNS.includes('t4e'));
  assert.strictEqual(fresh({ INTERNAL_DOMAINS: 'think4ever.com' }).PATTERNS.includes('think4ever.com'), false, 'covered by think4ever');
  assert.strictEqual(I.isInternal({ email: 'x@partner.dev' }), true);
});

test('unsafe patterns are dropped so they never reach HogQL', () => {
  const I = fresh({ INTERNAL_PATTERNS: "think4ever,x') OR 1=1 --,t" });
  assert.deepStrictEqual(I.PATTERNS, ['think4ever']);
});

test('HogQL rule matches every pattern across email, company and name', () => {
  const I = fresh();
  const sql = I.hogql({ email: 'E', company: 'C', name: 'N' });
  assert.match(sql, /lower\(concat\(E, ' ', C, ' ', N\)\)/);
  for (const p of ['think4ever', 'moadbus', 't4e']) assert.ok(sql.includes(`, '${p}') > 0`), p);
});

test('PostHog funnel filters exclude each pattern on email, company and name', () => {
  const I = fresh();
  const f = I.posthogPersonFilters();
  assert.strictEqual(f.length, 9);
  assert.deepStrictEqual(f.find((x) => x.key === 'name' && x.value[0] === 't4e'), { key: 'name', type: 'person', operator: 'not_icontains', value: ['t4e'] });
});

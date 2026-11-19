'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { accountUtmKey, utmAttributionSnapshots } = require('../lib/connectors');

const channels = require('../public/js/channels');

test('one test rule: explicit markers only, utm_content never decides', () => {
  const t = (source, medium, campaign, content) => channels.isTest({ source, medium, campaign, content });
  // utm_medium exactly qa, test or prueba
  for (const m of ['qa', 'test', 'prueba', 'QA', ' Test ']) assert.equal(t('google', m, 'x'), true, m);
  for (const m of ['qa_email', 'testing', 'cpc']) assert.equal(t('google', m, 'x'), false, m);
  // source or campaign starting qa / test / prueba then - or _ (the real test campaigns use hyphens)
  for (const c of ['qa-sync-1106', 'qa-dn-api-1118', 'qa_dn', 'test-landing', 'prueba_registro']) assert.equal(t('x', 'cpc', c), true, c);
  assert.equal(t('qa-bot', 'email', 'nurturing_co_202611'), true);
  for (const c of ['latam_test_co', 'quality', 'qa', 'testimonials_co_202611', 'early_builders_co_202611']) assert.equal(t('google', 'cpc', c), false, c);
  // known probes
  for (const c of ['posthog_prodcheck_1104', 'posthog-prodcheck-1118', 'posthogprodcheck']) assert.equal(t('x', 'y', c), true, c);
  assert.equal(t('posthog_prodcheck', '', ''), true);
  // A/B piece names in utm_content are never tests
  assert.equal(t('meta', 'paid_social', 'latam_co_202611', 'p03_test_b'), false);
  assert.equal(channels.classify({ source: 'meta', medium: 'paid_social', campaign: 'latam_co_202611', content: 'p03_test_b' }), 'other');
  assert.equal(channels.classify({ source: 'x', medium: 'y', campaign: 'qa-sync-1106' }), 'test');
});

test('the same test rule as a HogQL condition', () => {
  const sql = channels.testSql('s', 'm', 'c');
  assert.equal(sql, "(lower(toString(m)) IN ('qa', 'test', 'prueba') OR match(lower(toString(s)), '^(qa|test|prueba)[-_]') OR match(lower(toString(s)), '^posthog[-_]?prodcheck') OR match(lower(toString(c)), '^(qa|test|prueba)[-_]') OR match(lower(toString(c)), '^posthog[-_]?prodcheck'))");
  // The regex strings are the ones isTest uses, so SQL and JS agree.
  for (const v of ['qa-sync-1106', 'posthog_prodcheck_1104', 'latam_test_co']) assert.equal(new RegExp(channels.TEST_RULE.prefix).test(v) || new RegExp(channels.TEST_RULE.probe).test(v), channels.isTest({ campaign: v }), v);
});

test('every PostHog query that feeds a funnel step leaves test people out with the shared rule', async (t) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  Object.assign(process.env, { POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'k', POSTHOG_PROJECT_CREATED_ENABLED: '0' });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  const sqls = [];
  t.mock.method(global, 'fetch', async (url, opts) => { sqls.push(JSON.parse(opts.body).query.query); return { ok: true, status: 200, json: async () => ({ results: [] }), text: async () => '{"results":[]}' }; });
  await connectors.posthog();
  const step = (needle) => sqls.find((s) => s.includes(needle) && s.includes('GROUP BY person_id'));
  const queries = {
    'registration starts (ph_signups)': step("event = 'registration_started' AND"),
    'started sign-up (ph_signup_starts)': step('AS has_reg'),
    'accounts created': sqls.find((s) => s.includes('country, count() AS n, source, medium, campaign, content FROM') && s.includes("event IN ('$identify', 'account_created')")),
    verified: step("event = 'account_verified'"),
    'Executive accounts': step('AS first_host'),
  };
  for (const [name, sql] of Object.entries(queries)) {
    assert.ok(sql, `${name} query sent`);
    assert.match(sql, /\) WHERE NOT \(lower\(toString\((t_)?medium\)\) IN \('qa', 'test', 'prueba'\)/, name);
    assert.match(sql, /\^posthog\[-_\]\?prodcheck/, name);
  }
});

test('account UTM key keeps source, medium, campaign and content separable and within ingest limits', () => {
  assert.equal(accountUtmKey('meta', 'paid_social', 'latam_co_202611', 'p01_video'), 'meta|paid_social|latam_co_202611|p01_video');
  assert.equal(accountUtmKey('', null, undefined, ''), '(not set)|(not set)|(not set)|(not set)');
  assert.equal(accountUtmKey('a|b', 'cpc', 'x', 'p02|a'), 'a/b|cpc|x|p02/a');
  const long = accountUtmKey('s'.repeat(80), 'm'.repeat(80), 'c'.repeat(80), 'p'.repeat(80));
  assert.ok(long.length <= 120, 'ingest keeps dim_value at 120 characters');
  assert.equal(long.split('|').length, 4);
});

test('UTM attribution keeps part 1 under its old key, numbers the rest and records coverage', () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ date: '2026-10-01', campaign: `c${i}`, sessions: 1 }));
  const snaps = utmAttributionSnapshots('2026-10-01', '2026-11-17', rows, false);
  assert.deepEqual(snaps.map((s) => s.key), ['utm_attribution', 'utm_attribution_2', 'utm_attribution_3', 'utm_attribution_coverage']);
  assert.deepEqual(snaps.slice(0, 3).map((s) => s.rows.length), [1000, 1000, 500]);
  assert.equal(snaps[0].rows[0].campaign, 'c0');
  assert.deepEqual(snaps[3].rows[0], { available: true, rows: 2500, parts: 3, truncated: false });
  assert.equal(utmAttributionSnapshots('2026-10-01', '2026-11-17', rows, true).at(-1).rows[0].truncated, true);
});

test('UTM attribution keeps at most 5,000 rows, the newest first, and flags the cut', () => {
  const rows = Array.from({ length: 6200 }, (_, i) => ({ date: '2026-10-01', campaign: `c${i}`, sessions: 1 }));
  const snaps = utmAttributionSnapshots('2026-10-01', '2026-11-17', rows, false);
  assert.equal(snaps.length, 6, 'five parts and the coverage row');
  assert.equal(snaps.slice(0, 5).reduce((s, x) => s + x.rows.length, 0), 5000);
  assert.equal(snaps[0].rows[0].campaign, 'c0', 'rows arrive newest first, so the oldest are the ones dropped');
  assert.deepEqual(snaps[5].rows[0], { available: true, rows: 5000, parts: 5, truncated: true });
});

test('a failed or empty UTM attribution report stores no rows and says whether it was available', () => {
  const failed = utmAttributionSnapshots('2026-10-01', '2026-11-17', [], false, false);
  assert.deepEqual(failed.map((s) => s.key), ['utm_attribution', 'utm_attribution_coverage']);
  assert.deepEqual(failed[0].rows, []);
  assert.equal(failed[1].rows[0].available, false);
  assert.equal(utmAttributionSnapshots('2026-10-01', '2026-11-17', [], false).at(-1).rows[0].available, true);
});

'use strict';
// Accounts by origin: each External account is matched to the HubSpot form its email submitted,
// through the email HMAC. Only daily counts are stored, never an email or a hash.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const KEY = 'test-identity-key';
const hash = (email) => crypto.createHmac('sha256', KEY).update(email).digest('hex').slice(0, 32);
const response = (data) => ({ ok: true, text: async () => JSON.stringify(data) });

test('PostHog connector emits daily External accounts by matched HubSpot form, with no identifiers', async (t) => {
  const before = {};
  for (const [k, v] of Object.entries({ POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test', IDENTITY_HMAC_KEY: KEY })) { before[k] = process.env[k]; process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const store = require('../lib/store');
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  t.mock.method(store, 'list', async (kind) => (kind !== 'event' ? [] : [
    { source: 'hubspot', kind: 'form_signup', form: 'T4E – Early Builders Colombia', email_hmac: hash('builder@example.com') },
    { source: 'hubspot', kind: 'form_signup', form: 'T4E – Landing Signup LATAM', email_hmac: hash('builder@example.com') },
    { source: 'hubspot', kind: 'form_signup', form: 'T4E – Landing Signup LATAM', email_hmac: hash('landing@example.com') },
    { source: 'hubspot', kind: 'form_signup', form: 'T4E – Landing Signup LATAM' },
  ]));
  const queries = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    const sql = JSON.parse(options.body).query.query; queries.push(sql);
    if (sql.includes('any(lower(coalesce(toString(person.properties.email)') && sql.includes('GROUP BY person_id LIMIT 20001') && !sql.includes('first_host')) {
      return response({ results: [
        ['2026-11-12', 'External', 'builder@example.com'],
        ['2026-11-12', 'External', 'landing@example.com'],
        ['2026-11-13', 'External', 'oneclick@example.com'],
        ['2026-11-13', 'External', 'Landing@Example.com '],
        ['2026-11-13', 'Internal', 'someone@think4ever.com'],
        ['bad-date', 'External', 'x@example.com'],
      ] });
    }
    return response({ results: [] });
  });
  const load = await connectors.posthog();
  const origin = load.metrics.filter((r) => r.metric === 'ph_accounts_origin').map((r) => `${r.date}|${r.dim}|${r.dim_value}|${r.value}`).sort();
  assert.deepEqual(origin, [
    '2026-11-12|origin|Developer Network form|1',
    '2026-11-12|origin|Landing sign-up form|1',
    '2026-11-13|origin|Landing sign-up form|1',
    '2026-11-13|origin|No form matched|1',
  ]);
  const coverage = load.snapshots.find((s) => s.key === 'account_origin_coverage');
  assert.equal(coverage.rows[0].available, true);
  // Same people as the accounts metric: first account_created or $identify, QA probes out.
  const sql = queries.find((q) => q.includes('GROUP BY person_id LIMIT 20001') && q.includes("event IN ('$identify', 'account_created')"));
  assert.ok(sql, 'accounts-by-origin query uses the accounts definition');
  assert.match(sql, /qa_probe/);
  assert.doesNotMatch(JSON.stringify(load), /example\.com/);
  assert.doesNotMatch(JSON.stringify(load), new RegExp(hash('builder@example.com')));
});

test('Without IDENTITY_HMAC_KEY the accounts-by-origin report stays unavailable and asks for no emails', async (t) => {
  const before = {};
  for (const [k, v] of Object.entries({ POSTHOG_HOST: 'https://example.test', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'test' })) { before[k] = process.env[k]; process.env[k] = v; }
  before.IDENTITY_HMAC_KEY = process.env.IDENTITY_HMAC_KEY; delete process.env.IDENTITY_HMAC_KEY;
  t.after(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const { connectors } = require('../lib/connectors');
  t.mock.method(console, 'warn', () => {});
  const queries = [];
  t.mock.method(global, 'fetch', async (url, options) => { queries.push(JSON.parse(options.body).query.query); return response({ results: [] }); });
  const load = await connectors.posthog();
  assert.equal(load.metrics.some((r) => r.metric === 'ph_accounts_origin'), false);
  assert.equal(load.snapshots.find((s) => s.key === 'account_origin_coverage').rows[0].available, false);
  assert.equal(queries.some((q) => q.includes('GROUP BY person_id LIMIT 20001') && q.includes("'account_created')") && q.includes('AS email')), false);
});

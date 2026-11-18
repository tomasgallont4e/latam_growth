'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { accountUtmKey, utmAttributionSnapshots } = require('../lib/connectors');

test('account UTM key keeps source, medium and campaign separable and within ingest limits', () => {
  assert.equal(accountUtmKey('meta', 'paid_social', 'latam_co_202611'), 'meta|paid_social|latam_co_202611');
  assert.equal(accountUtmKey('', null, undefined), '(not set)|(not set)|(not set)');
  assert.equal(accountUtmKey('a|b', 'cpc', 'x'), 'a/b|cpc|x');
  const long = accountUtmKey('s'.repeat(80), 'm'.repeat(80), 'c'.repeat(80));
  assert.ok(long.length <= 120);
  assert.equal(long.split('|').length, 3);
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

test('a failed or empty UTM attribution report stores no rows and says whether it was available', () => {
  const failed = utmAttributionSnapshots('2026-10-01', '2026-11-17', [], false, false);
  assert.deepEqual(failed.map((s) => s.key), ['utm_attribution', 'utm_attribution_coverage']);
  assert.deepEqual(failed[0].rows, []);
  assert.equal(failed[1].rows[0].available, false);
  assert.equal(utmAttributionSnapshots('2026-10-01', '2026-11-17', [], false).at(-1).rows[0].available, true);
});

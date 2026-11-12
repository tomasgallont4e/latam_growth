'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, prevMonth } = require('../lib/monthReview');

const day = (date, over = {}) => ({ date, partial: false, spend: 10, sessions: 100, forms: 2, accounts: 5, projects: 1, ...over });
const report = (month, days, over = {}) => ({ month, status: 'loaded', days, rows: [], ...over });
const range = (month, n, over) => Array.from({ length: n }, (_, i) => day(`${month}-${String(i + 1).padStart(2, '0')}`, over));
const row = (r, id) => r.sameDays.rows.find((x) => x.id === id);

test('compares closed days of this month with the same days of the previous month', () => {
  const cur = report('2026-11', [...range('2026-11', 4, { accounts: 6 }), day('2026-11-05', { partial: true, accounts: 50 })]);
  const prev = report('2026-10', range('2026-10', 31));
  const r = build({ cur, prev });
  assert.equal(r.sameDays.through, '2026-11-04', 'today is partial and left out');
  assert.deepEqual(r.sameDays.previous, { from: '2026-10-01', to: '2026-10-04', complete: true });
  assert.equal(row(r, 'accounts').current, 24);
  assert.equal(row(r, 'accounts').previous, 20);
  assert.equal(row(r, 'accounts').change, 0.2);
  assert.equal(row(r, 'cpa').current, 40 / 24);
  assert.equal(row(r, 'cpa').lowerIsBetter, true);
});

test('a day without data makes the value null, never a partial sum', () => {
  const days = range('2026-11', 3);
  days[1].spend = null;
  const r = build({ cur: report('2026-11', days), prev: report('2026-10', range('2026-10', 31)) });
  assert.equal(row(r, 'spend').current, null);
  assert.equal(row(r, 'spend').change, null);
  assert.equal(row(r, 'cpa').current, null);
  assert.equal(row(r, 'sessions').current, 300);
});

test('a previous month without full days keeps the comparison pending', () => {
  const r = build({ cur: report('2026-10', range('2026-10', 5)), prev: report('2026-09', [], { status: 'pending' }) });
  assert.equal(r.sameDays.previous.complete, false);
  assert.match(r.sameDays.reason, /2026-09 has no full data for days 1–5/);
  assert.equal(row(r, 'accounts').previous, null);
  assert.equal(row(r, 'accounts').current, 25);
});

test('the 31st compares with the last day of a shorter month', () => {
  const r = build({ cur: report('2026-03', range('2026-03', 31)), prev: report('2026-02', range('2026-02', 28)) });
  assert.equal(r.sameDays.previous.to, '2026-02-28');
  assert.equal(prevMonth('2026-01'), '2025-12');
});

test('a month with only today has no comparison yet', () => {
  const r = build({ cur: report('2026-12', [day('2026-12-01', { partial: true })]), prev: report('2026-11', range('2026-11', 30)) });
  assert.equal(r.sameDays.status, 'pending');
});

test('channels add the month rows by channel, largest first, and keep an unloaded stage Pending', () => {
  const rows = [
    { channel: 'Meta Ads', paid: true, sessions: 30, spend: 20 },
    { channel: 'Meta Ads', paid: true, sessions: 10, spend: 5 },
    { channel: '(direct)', paid: false, sessions: 50, spend: null },
    { channel: 'newsletter', paid: false, sessions: null, spend: null },
  ];
  const stages = [{ id: 'sessions', status: 'loaded' }, { id: 'spend', status: 'not_connected', reason: 'No ad network.' }];
  const r = build({ cur: report('2026-11', range('2026-11', 2), { rows, stages, from: '2026-11-01', to: '2026-11-02' }), prev: null });
  assert.deepEqual(r.channels.sessions, [{ name: '(direct)', value: 50 }, { name: 'Meta Ads', value: 40 }]);
  assert.equal(r.channels.spend, null);
  assert.equal(r.channels.reasons.spend, 'No ad network.');
});

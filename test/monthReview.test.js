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

test('campaigns roll the month up by channel and campaign, sorted by spend, with no cost where accounts are unknown', () => {
  const rows = [
    { date: '2026-11-01', channel: 'Meta Ads', campaign: 'Launch', paid: true, spend: 20, impressions: 1000, clicks: 30, sessions: 25, forms: 1, accounts: 2, projects: 1 },
    { date: '2026-11-02', channel: 'Meta Ads', campaign: 'Launch', paid: true, spend: 10, impressions: 500, clicks: 10, sessions: 5, forms: 0, accounts: 1, projects: 0 },
    { date: '2026-11-01', channel: 'Google Ads', campaign: 'Brand', paid: true, spend: 40, impressions: 900, clicks: 50, sessions: 40, forms: null, accounts: null, projects: null },
    { date: '2026-11-01', channel: '(direct)', campaign: '(no UTM campaign)', paid: false, spend: null, impressions: null, clicks: null, sessions: 60, forms: null, accounts: null, projects: null },
    { date: '2026-11-02', channel: 'newsletter', campaign: 'Digest', paid: false, spend: null, impressions: null, clicks: null, sessions: 0, forms: null, accounts: null, projects: null },
  ];
  const r = build({ cur: report('2026-11', range('2026-11', 2), { rows, from: '2026-11-01', to: '2026-11-02' }), prev: null });
  assert.deepEqual(r.campaigns.rows.map((c) => c.campaign), ['Brand', 'Launch', '(no UTM campaign)'], 'all-zero rows are dropped');
  const launch = r.campaigns.rows[1];
  assert.equal(launch.spend, 30);
  assert.equal(launch.accounts, 3);
  assert.equal(launch.costPerAccount, 10);
  assert.equal(r.campaigns.rows[0].costPerAccount, null);
  assert.equal(r.campaigns.rows[2].spend, null);
});

test('personas roll the month up by persona, keep the untagged row last and report the tagged share', () => {
  const personas = [
    { date: '2026-11-01', persona: 'p01', sessions: 30, forms: 1, accounts: 2, projects: 0 },
    { date: '2026-11-02', persona: 'p01', sessions: 10, forms: 0, accounts: 1, projects: 1 },
    { date: '2026-11-01', persona: 'p05', sessions: 10, forms: 2, accounts: 0, projects: 0 },
    { date: '2026-11-01', persona: '(no persona code)', sessions: 50, forms: 1, accounts: 1, projects: 0 },
  ];
  const stages = ['sessions', 'forms', 'accounts', 'projects'].map((id) => ({ id, status: id === 'forms' ? 'not_connected' : 'loaded' }));
  const r = build({ cur: report('2026-11', range('2026-11', 2, { accountsCohort: 3 }), { personas, stages, from: '2026-11-01', to: '2026-11-02' }), prev: null });
  assert.deepEqual(r.personas.rows.map((x) => x.persona), ['p01', 'p05', '(no persona code)']);
  assert.equal(r.personas.rows[0].name, 'Software developers and analysts');
  assert.equal(r.personas.rows[0].sessions, 40);
  assert.equal(r.personas.rows[0].forms, null, 'an unloaded stage stays null');
  assert.equal(r.personas.tagged.sessions, 0.5);
  assert.equal(r.personas.tagged.accounts, 0.75);
  assert.equal(r.personas.tagged.forms, null);
  const noCohort = build({ cur: report('2026-11', range('2026-11', 2), { personas, stages, from: '2026-11-01', to: '2026-11-02' }), prev: null });
  assert.equal(noCohort.personas.rows[0].accounts, null, 'without the identity cohort accounts by persona are unknown');
});

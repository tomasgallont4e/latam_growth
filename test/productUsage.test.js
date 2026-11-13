'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, bogotaYesterday } = require('../lib/productUsage');

const from = '2026-10-29', cutoff = '2026-11-08';
const acct = (created, first_project, signin_days = [], internal = false) => ({ created, first_project, signin_days, internal });

test('product usage counts unique external accounts and distinct projects, never events', () => {
  const s = summarize({
    from, cutoff,
    accounts: [
      acct('2026-10-30', '2026-11-01', ['2026-10-30', '2026-10-30', '2026-11-05']),
      acct('2026-11-04', '1970-01-01', ['2026-11-08']),
      acct('2026-11-04', '2026-11-04', [], true), // internal: excluded everywhere
      acct('1970-01-01', '2026-11-02', ['2026-11-02']), // account older than account_created
    ],
    projectDays: [{ date: '2026-11-01', internal: false, projects: 2 }, { date: '2026-11-04', internal: true, projects: 5 }],
  });
  const day = (d) => s.daily.find((r) => r.date === d);
  assert.equal(s.internalAccounts, 1);
  assert.equal(s.externalAccounts, 3);
  assert.equal(day('2026-11-04').accounts_created, 1);
  assert.equal(day('2026-11-04').projects_created, 0, 'internal projects excluded');
  assert.equal(day('2026-11-01').projects_created, 2);
  assert.equal(day('2026-10-30').signed_in, 1, 'one person signing in twice is one');
  assert.equal(day('2026-11-08').active_7d, 3, 'window Nov 2-8: signed in on 11-02, 11-05 and 11-08');
  assert.equal(day('2026-11-09'), undefined);
  assert.equal(day('2026-11-08').accounts_with_project, 2);
  assert.equal(s.daily.at(-1).date, cutoff, 'nothing after the cutoff');
});

test('7-day activation uses day 0..6 and marks cohorts whose window is still open', () => {
  const s = summarize({
    from, cutoff,
    accounts: [
      acct('2026-10-30', '2026-11-05'), // day 6 → activated
      acct('2026-10-30', '2026-11-06'), // day 7 → not activated in 7 days
      acct('2026-11-05', '2026-11-06'), // open cohort
      acct('2026-10-31', '2026-10-30'), // project before account: not activation
    ],
  });
  const c = Object.fromEntries(s.cohorts.map((r) => [r.cohort, r]));
  assert.deepEqual(c['2026-10-30'], { cohort: '2026-10-30', accounts: 2, activated_7d: 1, open: false });
  assert.equal(c['2026-11-05'].open, true);
  assert.equal(c['2026-10-31'].activated_7d, 0);
});

test('cutoff is yesterday in America/Bogota', () => {
  assert.equal(bogotaYesterday(new Date('2026-11-10T03:00:00Z')), '2026-11-08'); // 22:00 on Nov 9 in Bogota
  assert.equal(bogotaYesterday(new Date('2026-11-10T06:00:00Z')), '2026-11-09');
});

test('plans and credits sum external contacts, keep empty credits as null and derive active subscriptions from dates', () => {
  const { planCredits } = require('../lib/productUsage');
  const r = planCredits([
    { plan: 'Builder', status: 'Active', used: '30', remaining: '70', last_used: '2026-11-12', started: '2026-10-20' },
    { plan: 'Builder', status: 'cancelled', used: '5', remaining: '0', last_used: '2026-10-01', started: '2026-10-02', cancelled: '2026-11-03' },
    { plan: 'Free', used: '0', remaining: '10' },
    { plan: 'Builder', used: '999', started: '2026-10-01', internal: true },
  ], '2026-11-13');
  assert.equal(r.contacts, 3);
  assert.equal(r.internal_excluded, 1);
  assert.equal(r.credits_used, 35);
  assert.equal(r.credits_remaining, 80);
  assert.equal(r.using_credits, 2);
  assert.equal(r.used_last_7d, 1);
  assert.equal(r.active, 1);
  assert.equal(r.cancelled, 1);
  assert.deepEqual(r.by_plan.map((p) => [p.plan, p.contacts, p.active]), [['Builder', 2, 1], ['Free', 1, 0]]);
  assert.deepEqual(r.months, [{ month: '2026-10', started: 2, cancelled: 0 }, { month: '2026-11', started: 0, cancelled: 1 }]);
  assert.equal(planCredits([{ plan: 'Free' }], '2026-11-13').credits_used, null, 'no credit property means unknown, not zero');
});

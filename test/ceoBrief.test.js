
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../public/js/ceoBrief.js');

const goal = (value, to, extra = {}) => ({ month: '2026-11', from: '2026-11-01', to, value, goal: 500000, latam: 10, ...extra });

test('goal semaphore follows the prorated pace: green >= 90%, yellow 60-89%, red < 60%', () => {
  // Nov 1-10 = 10 of 30 days → expected 166,667
  assert.equal(B.goalPace(goal(160000, '2026-11-10')).semaphore, 'green');
  assert.equal(B.goalPace(goal(110000, '2026-11-10')).semaphore, 'yellow');
  const red = B.goalPace(goal(1000, '2026-11-10'));
  assert.equal(red.semaphore, 'red');
  assert.equal(red.daysLeft, 20);
  assert.equal(Math.round(red.perDay), Math.round(499000 / 20));
  assert.equal(B.goalPace(goal(null, '2026-11-10')), null, 'no value, no pace');
  assert.equal(B.goalPace(goal(10, '2026-11-10', { goal: null })), null, 'no goal, no pace');
});

test('a closed month is judged against the whole goal', () => {
  const met = B.goalPace(goal(510000, '2026-11-30'));
  assert.equal(met.closed, true);
  assert.equal(met.semaphore, 'green');
  assert.equal(B.goalPace(goal(200000, '2026-11-30')).semaphore, 'red');
});

test('headline and risks are generated from the numbers', () => {
  const m = B.build({ month: '2026-11', goal: goal(1000, '2026-11-10'), product: { status: 'loading' } });
  assert.match(m.headline.text, /^November 2026: 1,000 accounts created, 0\.2% of the 500K goal\. Behind pace/);
  assert.equal(m.headline.tone, 'bad');
  assert.ok(m.risks.some((r) => /accounts per day are needed/.test(r)));
  assert.ok(m.actions.some((a) => /Close the gap of 499,000 accounts/.test(a)));
  assert.equal(m.tiles[0].badge, 'Behind pace');
});

test('missing product data is Loading / No data / Waiting for event, never zero', () => {
  const loading = B.build({ month: '2026-11', goal: goal(10, '2026-11-10'), product: { status: 'loading' } });
  for (const t of loading.tiles.slice(1)) { assert.equal(t.state, 'loading'); assert.equal(t.value, null); }
  const err = B.build({ month: '2026-11', goal: {}, product: { status: 'error', error: 'boom' } });
  assert.equal(err.tiles[0].state, 'nodata');
  assert.ok(err.risks.some((r) => /boom/.test(r)));
  const waiting = B.build({
    month: '2026-11', goal: goal(10, '2026-11-10'),
    product: { status: 'loaded', data: { from: '2026-10-01', cutoff: '2026-11-10', events: { signed_in: { name: 'signed_in', available: true, count: 3 } }, accounts: [] } },
  });
  const [, active, projects, churn] = waiting.tiles;
  assert.equal(active.state, 'ok');
  assert.equal(projects.state, 'waiting');
  assert.equal(projects.value, null);
  assert.equal(projects.event, 'project_created');
  assert.equal(churn.state, 'waiting');
  assert.equal(waiting.strip[0].state, 'waiting', 'credits wait for credits_consumed');
  assert.ok(waiting.actions.some((a) => /Ask Product to ship the backend events: project_created, credits_consumed/.test(a)));
});

test('product KPIs: active users with change, share with a project, churn for the selected month', () => {
  const ev = (n) => ({ name: n, available: true, count: 1 });
  const data = {
    from: '2026-10-01', cutoff: '2026-11-10',
    events: { signed_in: ev('signed_in'), project_created: ev('project_created'), subscription_started: ev('subscription_started'), subscription_cancelled: ev('subscription_cancelled') },
    accounts: [
      { created: '2026-10-20', first_project: '2026-10-21', signin_days: ['2026-11-01', '2026-11-09'], internal: false },
      { created: '2026-11-05', first_project: null, signin_days: ['2026-11-10'], internal: false },
      { created: '2026-11-05', first_project: '2026-11-05', signin_days: ['2026-11-10'], internal: true },
    ],
    projectDays: [],
    subscriptions: [
      { starts: ['2026-10-05'], cancels: ['2026-11-03'], internal: false },
      { starts: ['2026-10-06'], cancels: [], internal: false },
    ],
  };
  const k = B.productKpis({ status: 'loaded', data }, '2026-11');
  assert.equal(k.active.value, 2, 'internal excluded');
  assert.equal(k.active.prev, 1, 'Nov 3 window: one sign-in on Nov 1');
  assert.equal(k.projects.value, 0.5);
  assert.equal(k.projects.prev, 1, 'a week earlier only the October account existed');
  assert.equal(k.churn.value, 0.5);
  assert.deepEqual(k.waiting, ['credits_consumed']);
  const m = B.build({ month: '2026-11', goal: goal(10, '2026-11-10'), product: { status: 'loaded', data } });
  assert.equal(m.tiles[1].value, '2');
  assert.equal(m.tiles[1].delta.text, '+100%');
  assert.equal(m.tiles[2].value, '50%');
  assert.equal(m.tiles[3].tone, 'bad');
  assert.ok(m.risks.some((r) => /Monthly churn is 50\.0%/.test(r)));
});

test('strip: spend incomplete is flagged and markets are ranked', () => {
  const m = B.build({
    month: '2026-11', goal: goal(10, '2026-11-10'), product: { status: 'loading' },
    spend: { value: 120.5, complete: false, reason: 'LinkedIn has not reported.' }, cps: { value: 12.05, status: 'loaded' },
    countries: [{ country: 'Peru', signups: 2, pace: 'Trailing' }, { country: 'Colombia', signups: 8, pace: 'Leading' }, { country: 'Chile', signups: 0 }],
  });
  assert.equal(m.strip[1].value, 'US$120.50');
  assert.match(m.strip[1].sub, /Cost per account US\$12\.05 · paid spend incomplete/);
  assert.equal(m.strip[2].value, 'Colombia 8');
  assert.ok(m.risks.some((r) => /Paid spend is incomplete/.test(r)));
  assert.ok(m.risks.some((r) => /1 market\(s\) trail their plan: Peru/.test(r)));
  assert.ok(m.actions.length <= 3);
});

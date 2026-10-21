'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { windowOf, statusOf, clean } = require('../lib/goals');

test('monthly window covers the calendar month', () => {
  const w = windowOf('monthly', '2026-10-20');
  assert.strictEqual(w.from, '2026-10-01');
  assert.strictEqual(w.end, '2026-10-31');
  assert.strictEqual(w.total_days, 31);
  assert.strictEqual(w.label, 'October 2026');
});

test('quarterly window covers the calendar quarter', () => {
  const w = windowOf('quarterly', '2026-11-05');
  assert.strictEqual(w.from, '2026-10-01');
  assert.strictEqual(w.end, '2026-12-31');
  assert.strictEqual(w.total_days, 92);
  assert.strictEqual(w.label, 'Q4 2026');
});

test('statusOf colors by pace against the target', () => {
  // 20 of 31 days elapsed: the expected value of a 100 target is 64.5
  assert.strictEqual(statusOf(100, 100, 20, 31), 'met');
  assert.strictEqual(statusOf(70, 100, 20, 31), 'on');
  assert.strictEqual(statusOf(64.6, 100, 20, 31), 'on');   // just above the expected 64.52
  assert.strictEqual(statusOf(64.5, 100, 20, 31), 'watch'); // just below the expected value
  assert.strictEqual(statusOf(30, 100, 20, 31), 'behind');
  assert.strictEqual(statusOf(5, 0, 20, 31), 'behind'); // target 0 never happens: guarded
});

test('custom (big goal) window spans the set dates', () => {
  const w = windowOf('custom', '2026-10-20', { start: '2026-10-01', end: '2027-03-31' });
  assert.strictEqual(w.from, '2026-10-01');
  assert.strictEqual(w.end, '2027-03-31');
  assert.strictEqual(w.total_days, 182); // 31+30+31+31+28+31
  assert.strictEqual(w.label, '1 Oct 2026 – 31 Mar 2027');
});

test('clean requires start and end for a custom window', () => {
  assert.ok(clean({ metric: 'external_signups', cadence: 'custom', target: 500000 }).error);
  assert.ok(clean({ metric: 'external_signups', cadence: 'custom', start: '2027-03-31', end: '2026-10-01', target: 500000 }).error);
  const g = clean({ metric: 'external_signups', cadence: 'custom', start: '2026-10-01', end: '2027-03-31', target: 500000 });
  assert.strictEqual(g.error, undefined);
  assert.strictEqual(g.start, '2026-10-01');
  assert.strictEqual(g.end, '2027-03-31');
  assert.strictEqual(g.target, 500000);
});

test('clean validates the goal fields', () => {
  assert.ok(clean({ metric: 'nope', cadence: 'monthly' }).error);
  assert.ok(clean({ metric: 'landing_sessions', cadence: 'yearly' }).error);
  assert.ok(clean({ metric: 'landing_sessions', cadence: 'monthly', grouping: 'channel' }).error); // channel is not a grouping of this metric
  assert.ok(clean({ metric: 'ga4_sessions', cadence: 'monthly', grouping: 'channel' }).error); // channel value missing
  assert.ok(clean({ metric: 'ga4_sessions', cadence: 'monthly', grouping: 'channel', group: 'Direct', target: 0 }).error);
  const g = clean({ metric: 'ga4_sessions', cadence: 'monthly', grouping: 'channel', group: 'Direct', target: 60 });
  assert.strictEqual(g.error, undefined);
  assert.strictEqual(g.metric, 'ga4_sessions');
  assert.strictEqual(g.cadence, 'monthly');
  assert.strictEqual(g.grouping, 'channel');
  assert.strictEqual(g.group, 'Direct');
  assert.strictEqual(g.target, 60);
  assert.ok(g.name.includes('GA4 sessions'));
});

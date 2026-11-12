'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildView } = require('../lib/executiveView');

const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
function input({ byMetric = new Map(), posthogFrom = '2026-11-03' } = {}) {
  return {
    month: '2026-11', cutoff: '2026-11-05', now: new Date('2026-11-06T12:00:00Z'), today: '2026-11-06', monthEnd: '2026-11-30',
    launchDate: '2026-10-01', firstDay: '2026-11-01', monthLabel: 'November 2026',
    days: DAYS, pos: new Map(DAYS.map((d, i) => [d, i])),
    series: {
      platform_signups: { Colombia: [0, 0, 1, 2, 3], '': [0, 0, 1, 0, 0] },
      landing_sessions: { Colombia: [10, 10, 10, 10, 10] },
    },
    byMetric, platformSeries: {},
    posthogSnapshot: { from: posthogFrom, to: '2026-11-05', rows: [{ available: true }] },
    ga4Snapshot: { from: '2026-11-01', to: '2026-11-05', rows: [{}] },
    validCoverage: (s) => !!(s && s.from && s.to),
    signupsAvailable: true, sessionsAvailable: true, signupReason: null, signupReviewReason: null, signupReviewFlags: {},
    sources: [], notes: [], targetRows: [],
  };
}
const rows = (metric, list) => list.map(([source, date, value]) => ({ source, metric, date, value }));

test('country sums are partial instead of null when a source misses days of the month', () => {
  const view = buildView(input());
  const co = view.countries.rows.find((r) => r.country === 'Colombia');
  assert.equal(co.signups, 6);
  assert.equal(co.signupsPartial, true);
  assert.equal(co.signupsMissingDays, 2);
  assert.equal(co.signupsCoveredThrough, '2026-11-05');
  assert.equal(co.sessions, 50);
  assert.equal(co.sessionsPartial, false);
  assert.equal(co.partial, true);
  assert.equal(co.percentOfMin, null);
  const last = view.countries.rows[view.countries.rows.length - 1];
  assert.equal(last.country, 'No country');
  assert.equal(last.noCountry, true);
  assert.equal(last.signups, 1);
  assert.equal(view.countries.noCountry, 1);
  assert.equal(view.countries.partial, true);
  assert.equal(view.cards.signups.status, 'pending', 'the monthly total still needs full coverage');
});

test('country sums are complete when the source covers every day', () => {
  const view = buildView(input({ posthogFrom: '2026-11-01' }));
  const co = view.countries.rows.find((r) => r.country === 'Colombia');
  assert.equal(co.signups, 6);
  assert.equal(co.signupsPartial, false);
  assert.equal(view.countries.partial, false);
});

test('LinkedIn Ads is not used: its rows never enter paid spend', () => {
  const byMetric = new Map([
    ['ad_spend', rows('ad_spend', [['linkedin', '2026-11-02', 12.5]])],
    ['ad_impressions', rows('ad_impressions', [['linkedin', '2026-11-02', 300]])],
  ]);
  const view = buildView(input({ byMetric }));
  const li = view.channels.linkedin;
  assert.equal(li.status, 'not_used');
  assert.equal(li.spend, null);
  assert.equal(view.cards.spend.source, 'Meta Ads, Google Ads');
  assert.doesNotMatch(view.cards.spend.lines.join(' '), /LinkedIn US\$/);
  assert.notEqual(view.cards.spend.value, 12.5);
});

test('spend completeness depends only on Meta Ads and Google Ads', () => {
  const view = buildView(input());
  assert.equal(view.channels.linkedin.status, 'not_used');
  assert.equal(view.cards.spend.complete, false, 'Meta and Google have not reported');
  assert.ok(view.cards.spend.underReview);
  assert.doesNotMatch(view.cards.spend.underReview.reason, /LinkedIn/);
});

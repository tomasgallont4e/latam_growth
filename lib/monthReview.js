'use strict';
// Executive month review, built only from two Daily Landing Funnel reports (this month and the previous one).
// A value is null when any day it needs has no data, so a gap is never read as 0.

const METRICS = [
  { id: 'accounts', name: 'Accounts created', source: 'PostHog · first identify · External', field: 'accounts' },
  { id: 'sessions', name: 'Landing sessions', source: 'GA4 · go.think4ever.com', field: 'sessions' },
  { id: 'forms', name: 'Form submissions', source: 'HubSpot · external contacts', field: 'forms' },
  { id: 'spend', name: 'Ads spend', source: 'Meta Ads · Google Ads', field: 'spend', kind: 'money' },
  { id: 'cpa', name: 'Cost per account', source: 'Ads spend ÷ accounts created', ratio: ['spend', 'accounts'], kind: 'money', lowerIsBetter: true },
  { id: 'projects', name: 'Projects created', source: 'PostHog · first project (identity cohort)', field: 'projects' },
];

const dayOf = (iso) => Number(iso.slice(8, 10));
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const sumDays = (days, field) => (days.length && days.every((d) => d[field] != null) ? days.reduce((s, d) => s + d[field], 0) : null);
function value(metric, days) {
  if (!metric.ratio) return sumDays(days, metric.field);
  const [a, b] = metric.ratio.map((f) => sumDays(days, f));
  return a != null && b ? a / b : null;
}

function sameDays(cur, prev) {
  const closed = cur && cur.status === 'loaded' ? (cur.days || []).filter((d) => !d.partial) : [];
  if (!closed.length) return { status: 'pending', reason: 'No complete day in this month yet.', rows: [] };
  const through = closed[closed.length - 1].date;
  const lastDay = dayOf(through);
  const pm = prevMonth(cur.month);
  const prevTo = `${pm}-${String(Math.min(lastDay, monthDays(pm))).padStart(2, '0')}`;
  const prevDays = prev && prev.status === 'loaded' ? (prev.days || []).filter((d) => d.date <= prevTo) : [];
  const prevComplete = prevDays.length === dayOf(prevTo) && !prevDays.some((d) => d.partial);
  const rows = METRICS.map((m) => {
    const now = value(m, closed);
    const before = prevComplete ? value(m, prevDays) : null;
    return {
      id: m.id, name: m.name, source: m.source, kind: m.kind || 'count', lowerIsBetter: !!m.lowerIsBetter,
      current: now, previous: before, change: now != null && before ? (now - before) / before : null,
    };
  });
  return {
    status: 'loaded', through, current: { from: closed[0].date, to: through }, previous: { from: `${pm}-01`, to: prevTo, complete: prevComplete },
    reason: prevComplete ? null : `${pm} has no full data for days 1–${dayOf(prevTo)}.`, rows,
  };
}

function build({ cur, prev }) {
  return { month: cur && cur.month, sameDays: sameDays(cur, prev) };
}

module.exports = { build, prevMonth, METRICS };

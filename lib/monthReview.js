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

// Month to date, today included, the same rows as the daily report. A channel is the ad network for
// campaign-matched rows and the utm_source otherwise; the daily report never infers one.
function byChannel(rows, field) {
  const out = new Map();
  for (const r of rows) if (r[field] != null) out.set(r.channel, (out.get(r.channel) || 0) + r[field]);
  return [...out].map(([name, value]) => ({ name, value })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
}
function channels(cur) {
  if (!cur || cur.status !== 'loaded') return { status: 'pending', reason: (cur && cur.reason) || 'The daily report has no day for this month.', sessions: [], spend: [] };
  const rows = cur.rows || [];
  const stage = (id) => (cur.stages || []).find((s) => s.id === id) || {};
  return {
    status: 'loaded', from: cur.from, to: cur.to,
    sessions: stage('sessions').status === 'loaded' ? byChannel(rows, 'sessions') : null,
    spend: stage('spend').status === 'loaded' ? byChannel(rows.filter((r) => r.paid), 'spend') : null,
    reasons: { sessions: stage('sessions').reason || null, spend: stage('spend').reason || null },
  };
}

const CAMPAIGN_FIELDS = ['spend', 'impressions', 'clicks', 'sessions', 'forms', 'accounts', 'projects'];
// One row per channel and campaign for the month to date. A field stays null when no day reported it,
// so an organic row has no spend and a campaign without the identity cohort has no accounts.
function campaigns(cur) {
  if (!cur || cur.status !== 'loaded') return { status: 'pending', reason: (cur && cur.reason) || 'The daily report has no day for this month.', rows: [] };
  const out = new Map();
  for (const r of cur.rows || []) {
    const key = JSON.stringify([r.channel, r.campaign]);
    if (!out.has(key)) out.set(key, { channel: r.channel, campaign: r.campaign, paid: !!r.paid, ...Object.fromEntries(CAMPAIGN_FIELDS.map((f) => [f, null])) });
    const c = out.get(key);
    for (const f of CAMPAIGN_FIELDS) if (r[f] != null) c[f] = (c[f] || 0) + r[f];
  }
  const rows = [...out.values()]
    .filter((c) => CAMPAIGN_FIELDS.some((f) => c[f]))
    .map((c) => ({ ...c, costPerAccount: c.spend != null && c.accounts > 0 ? c.spend / c.accounts : null }))
    .sort((a, b) => (b.spend || 0) - (a.spend || 0) || (b.sessions || 0) - (a.sessions || 0) || a.campaign.localeCompare(b.campaign));
  return { status: 'loaded', from: cur.from, to: cur.to, rows };
}

function build({ cur, prev }) {
  return { month: cur && cur.month, sameDays: sameDays(cur, prev), channels: channels(cur), campaigns: campaigns(cur) };
}

module.exports = { build, prevMonth, METRICS };

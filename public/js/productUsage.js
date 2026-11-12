'use strict';
// Shared by the browser (App.productUsage) and Node (lib/productUsage.js), like paid.js.
(function (root) {
// Product usage (handoff "Product usage", WBS 6.4.20), from PostHog backend events.
// Input rows are one per portal account (portal_user_id); identifiers never leave PostHog.
// Every count is unique accounts or distinct projects, never raw events. Internal/test accounts
// (lib/internal.js) are counted separately and excluded from every metric.
// Dates are America/Bogota calendar days. Data is consolidated through the cutoff (yesterday).

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE_WINDOW = 7;
const ACTIVATION_DAYS = 7; // day 0..6 after account_created. Not the campaign's 14-day activation.

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diffDays = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

function bogotaYesterday(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return addDays(`${p.year}-${p.month}-${p.day}`, -1);
}

// accounts: [{ created, first_project, signin_days: [iso], internal }]
// projectDays: [{ date, internal, projects }]  (distinct project_id per day)
function summarize({ accounts = [], projectDays = [], from, cutoff }) {
  const valid = (d) => DAY.test(String(d || '')) && d >= from && d <= cutoff;
  const ext = accounts.filter((a) => !a.internal);
  const internalAccounts = accounts.length - ext.length;
  const people = ext.map((a) => ({
    created: valid(a.created) ? a.created : null,
    project: valid(a.first_project) ? a.first_project : null,
    signins: [...new Set((a.signin_days || []).filter(valid))].sort(),
  }));
  const projectsByDay = new Map();
  for (const r of projectDays) {
    if (r.internal || !valid(r.date)) continue;
    projectsByDay.set(r.date, (projectsByDay.get(r.date) || 0) + (Number(r.projects) || 0));
  }

  const daily = [];
  for (let d = from; d <= cutoff; d = addDays(d, 1)) {
    const start = addDays(d, -(ACTIVE_WINDOW - 1));
    daily.push({
      date: d,
      accounts_created: people.filter((p) => p.created === d).length,
      signed_in: people.filter((p) => p.signins.includes(d)).length,
      active_7d: people.filter((p) => p.signins.some((s) => s >= start && s <= d)).length,
      projects_created: projectsByDay.get(d) || 0,
      accounts_with_project: people.filter((p) => p.project && p.project <= d).length,
    });
  }

  const cohortMap = new Map();
  for (const p of people) {
    if (!p.created) continue;
    const c = cohortMap.get(p.created) || { cohort: p.created, accounts: 0, activated_7d: 0 };
    c.accounts += 1;
    if (p.project && p.project >= p.created && diffDays(p.created, p.project) < ACTIVATION_DAYS) c.activated_7d += 1;
    cohortMap.set(p.created, c);
  }
  const cohorts = [...cohortMap.values()].sort((a, b) => a.cohort.localeCompare(b.cohort)).map((c) => ({
    ...c,
    // Open cohort: the 7-day window has not finished by the cutoff, so it can still activate.
    open: addDays(c.cohort, ACTIVATION_DAYS - 1) > cutoff,
  }));
  return { daily, cohorts, internalAccounts, externalAccounts: ext.length };
}

function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}
function endOfMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
}

// Monthly churn (provisional formula, docs/product-metrics.md): cancellations in the month among
// subscriptions active at the start of the month ÷ subscriptions active at the start.
// subscriptions: [{ starts: [iso], cancels: [iso], internal }]. Same-day start and cancel = start first.
function monthlyChurn({ subscriptions = [], from, cutoff }) {
  const ext = subscriptions.filter((s) => !s.internal).map((s) => {
    const ok = (d) => DAY.test(String(d || '')) && d <= cutoff;
    return [...(s.starts || []).filter(ok).map((d) => [d, 0]), ...(s.cancels || []).filter(ok).map((d) => [d, 1])]
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  });
  const months = [];
  if (!DAY.test(String(from || '')) || !DAY.test(String(cutoff || '')) || from > cutoff) return { months };
  for (let m = from.slice(0, 7); m <= cutoff.slice(0, 7); m = nextMonth(m)) {
    const start = `${m}-01`;
    const monthEnd = endOfMonth(m);
    const end = monthEnd < cutoff ? monthEnd : cutoff;
    let activeStart = 0, cancelled = 0, cancelledAll = 0, started = 0;
    for (const events of ext) {
      let active = false;
      for (const [d, kind] of events) if (d < start) active = kind === 0;
      const inMonth = events.filter(([d]) => d >= start && d <= end);
      const cancelledHere = inMonth.some(([, kind]) => kind === 1);
      if (inMonth.some(([, kind]) => kind === 0)) started += 1;
      if (cancelledHere) cancelledAll += 1;
      if (active) {
        activeStart += 1;
        if (cancelledHere) cancelled += 1;
      }
    }
    months.push({ month: m, active_start: activeStart, cancelled, cancelled_all: cancelledAll, started, churn: activeStart ? cancelled / activeStart : null, partial: end < monthEnd });
  }
  return { months };
}

// Credits consumed per day (external accounts) and time from account creation to first use.
// days: [{ date, internal, credits }]  people: [{ created, first_credit, internal }]
function creditUsage({ days = [], people = [], from, cutoff }) {
  const valid = (d) => DAY.test(String(d || '')) && d >= from && d <= cutoff;
  const byDay = new Map();
  for (const r of days) {
    if (r.internal || !valid(r.date)) continue;
    byDay.set(r.date, (byDay.get(r.date) || 0) + (Number(r.credits) || 0));
  }
  const daily = [];
  for (let d = from; d <= cutoff; d = addDays(d, 1)) daily.push({ date: d, credits: byDay.get(d) || 0 });
  const total = daily.reduce((n, r) => n + r.credits, 0);
  const last7 = daily.slice(-ACTIVE_WINDOW).reduce((n, r) => n + r.credits, 0);
  const users = people.filter((p) => !p.internal && valid(p.first_credit));
  const waits = users.filter((p) => valid(p.created) && p.first_credit >= p.created).map((p) => diffDays(p.created, p.first_credit)).sort((a, b) => a - b);
  const mid = Math.floor(waits.length / 2);
  const median = !waits.length ? null : waits.length % 2 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2;
  return { daily, total, last_7d: last7, accounts_using: users.length, median_days_to_first: median };
}

  const api = { summarize, monthlyChurn, creditUsage, bogotaYesterday, addDays, ACTIVE_WINDOW, ACTIVATION_DAYS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.App) root.App.productUsage = api;
})(typeof window !== 'undefined' ? window : this);

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

  const api = { summarize, bogotaYesterday, addDays, ACTIVE_WINDOW, ACTIVATION_DAYS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.App) root.App.productUsage = api;
})(typeof window !== 'undefined' ? window : this);

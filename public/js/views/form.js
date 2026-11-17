'use strict';
/* Sign-up form: the landing form step by step, and the before/after read of the short form
   (decision 2026-10-27, docs in the research KB). A step without source coverage is Pending, never 0. */
(function (A) {
  const HOST = 'go.think4ever.com';
  // The short form went live on the night of Oct 28, so that day belongs to neither window.
  const CHANGE = { date: '2026-10-28', label: 'Short form published (night)' };
  const BEFORE_DAYS = 7;
  const START_GOAL = 0.05;

  const landingCoverage = (D, from, to) => D.covered('ga4', 'executive_landing', from, to);
  const STEPS = [
    { id: 'sessions', name: 'Landing sessions', short: 'GA4', src: 'GA4 · go.think4ever.com',
      daily: (D, from, to) => (landingCoverage(D, from, to) ? D.byDay('ga4', 'ga_exec_geo_sessions', from, to) : null) },
    { id: 'starts', name: 'Form starts', short: 'GA4', src: 'GA4 form_start · go.think4ever.com',
      daily: (D, from, to) => { const c = landingCoverage(D, from, to); return c && c.form_start_available ? D.byDay('ga4', 'ga_exec_form_starts', from, to) : null; } },
    { id: 'submits', name: 'Form submissions', short: 'HubSpot', src: 'HubSpot · landing form · external contacts',
      daily: (D, from, to) => {
        if (!D.covered('hubspot', 'utm_capture', from, to)) return null;
        const out = Object.fromEntries(A.ui.days(from, to).map((d) => [d, 0]));
        for (const e of D.formsAll(from, to)) if (!D.isTestForm(e) && String(e.site_host || '').toLowerCase() === HOST) out[e.date] += 1;
        return out;
      } },
    { id: 'accounts', name: 'Accounts created', short: 'PostHog', src: 'PostHog · first account_created or identify · External · all hosts',
      daily: (D, from, to) => (D.accounts(from, to) == null ? null : D.accountsByDay(from, to)) },
  ];
  const total = (byDay) => (byDay ? Object.values(byDay).reduce((s, v) => s + v, 0) : null);
  const ratio = (a, b) => (a != null && b ? a / b : null);

  function read(D, from, to) {
    const daily = Object.fromEntries(STEPS.map((s) => [s.id, s.daily(D, from, to)]));
    const sums = Object.fromEntries(STEPS.map((s) => [s.id, total(daily[s.id])]));
    return { from, to, days: A.ui.diffDays(from, to) + 1, daily, sums, startRate: ratio(sums.starts, sums.sessions) };
  }

  function windows(D) {
    const U = A.ui;
    const head = D.snap('ga4', 'executive_landing');
    const yesterday = U.addDays(U.today(), -1);
    const end = head && head.to < yesterday ? head.to : yesterday;
    const afterFrom = U.addDays(CHANGE.date, 1);
    return {
      before: read(D, U.addDays(CHANGE.date, -BEFORE_DAYS), U.addDays(CHANGE.date, -1)),
      after: end >= afterFrom ? read(D, afterFrom, end) : null,
    };
  }

  function beforeAfter({ before, after }) {
    const U = A.ui;
    if (!after) return U.empty('The after window has not started', `The short form went live on ${U.dshort(CHANGE.date)}.`, 'clock');
    const perDay = (w, id) => (w.sums[id] == null ? null : w.sums[id] / w.days);
    const one = (v) => (v == null ? '<span class="kpi-awaiting">Pending</span>' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }));
    const rows = [
      ...STEPS.map((s) => ({ name: `${s.name} per day`, src: s.src, b: perDay(before, s.id), a: perDay(after, s.id), fmt: one, delta: U.delta })),
      { name: 'Form starts per landing session', src: `Goal ${U.pct(START_GOAL, 0)} · GA4`, b: before.startRate, a: after.startRate, fmt: (v) => (v == null ? '<span class="kpi-awaiting">Pending</span>' : U.pct(v)), delta: U.deltaPoints },
    ];
    return U.table([
      { t: 'Indicator', f: (r) => `${U.esc(r.name)}<br><small class="text-muted">${U.esc(r.src)}</small>` },
      { t: 'Before', num: 1, f: (r) => r.fmt(r.b) },
      { t: 'After', num: 1, f: (r) => r.fmt(r.a) },
      { t: 'Change', num: 1, f: (r) => r.delta(r.a, r.b) },
    ], rows) + `<p class="card-note">Before is ${U.win(before.from, before.to)} and after is ${U.win(after.from, after.to)}. Daily averages, so the two windows compare even with different lengths (${before.days} days before, ${after.days} after). ${U.esc(U.dshort(CHANGE.date))} is left out: the short form went live that night. Form submissions count only HubSpot contacts from ${HOST}; the portal to HubSpot sync was still queued in early November, so a 0 there is not yet evidence.</p>`;
  }

  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const now = read(D, S.from, S.to);
    const w = windows(D);
    const steps = STEPS.map((s, k) => ({ name: s.name, src: s.src, note: `Awaiting ${s.short}`, n: now.sums[s.id], ...(k === 3 ? { bridge: 'Accounts from every host, not only the landing form · not part of the step %', separate: true } : {}) }));
    const kpis = U.kpiRow([
      U.kpi({ label: 'Form starts', source: 'GA4', value: U.fmt(now.sums.starts), hero: true, compare: `${U.win(S.from, S.to)} · go.think4ever.com` }),
      U.kpi({ label: 'Starts per landing session', source: 'GA4', value: U.pct(now.startRate), compare: `Goal ${U.pct(START_GOAL, 0)} · ${now.startRate == null ? 'waiting for sessions and starts' : now.startRate >= START_GOAL ? 'above goal' : 'below goal'}` }),
      U.kpi({ label: 'Form submissions', source: 'HubSpot', value: U.fmt(now.sums.submits), compare: 'Landing form · external contacts' }),
      U.kpi({ label: 'Accounts created', source: 'PostHog', value: U.fmt(now.sums.accounts), compare: 'All hosts · same number as Overview' }),
    ], 4);
    const ticks = D.ticks();
    const roll = (id) => (now.daily[id] ? D.rollNum(now.daily[id]) : null);
    const starts = roll('starts'), sessions = roll('sessions');
    const notes = [CHANGE];
    const chart = U.card({ cls: 'chart-card', title: `${D.grainName()} form starts and landing sessions`, sub: `GA4 · go.think4ever.com · marker 1 is the short form · ${U.win(S.from, S.to)}`, body:
      '<h3>Form starts</h3>' + (starts ? C.stacked({ dates: ticks, keys: [{ name: 'Form starts', color: 'var(--series-a)' }], value: (d) => starts[d] || 0, notes, label: 'Form starts' }) : U.awaiting('ga4', 'Form starts on go.think4ever.com'))
      + '<h3>Landing sessions</h3>' + (sessions ? C.stacked({ dates: ticks, keys: [{ name: 'Landing sessions', color: 'var(--series-b)' }], value: (d) => sessions[d] || 0, notes, label: 'Landing sessions' }) : U.awaiting('ga4', 'Landing sessions on go.think4ever.com')) });
    const funnel = U.card({ title: 'Landing form, step by step', sub: `${U.win(S.from, S.to)} · each step from its own source`, body: C.funnel(steps, 'Landing form steps') });

    const landingForms = D.forms().filter((e) => !D.isTestForm(e));
    const by = (key) => Object.entries(landingForms.reduce((o, e) => { const k = e[key] || '(not set)'; o[k] = (o[k] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]);
    const breakdown = (title, key) => U.details(title, `${by(key).length} values`, landingForms.length
      ? U.table([{ t: title.replace(/^By /, ''), f: (r) => U.esc(r[0]) }, { t: 'Submissions', num: 1, f: (r) => U.fmt(r[1]) }], by(key))
      : U.empty('No external form submissions in this period'));

    return U.section('Sign-up form', `${U.win(S.from, S.to)} · landing go.think4ever.com`, kpis)
      + U.section('Before and after the short form', `Long form ${U.win(w.before.from, w.before.to)} against the short form since ${U.dshort(U.addDays(CHANGE.date, 1))}`, U.card({ title: 'Before and after the short form', sub: 'Daily averages · fixed windows, independent of the date picker', body: beforeAfter(w) }))
      + `<section class="section grid-2">${funnel}${chart}</section>`
      + U.section('Details', 'HubSpot submissions from every form, external contacts', `<div class="detail-group">${breakdown('By form', 'form')}${breakdown('By channel', 'channel')}${breakdown('By country', 'country')}</div>`);
  }
  A.views.form = { title: 'Sign-up form', render };
})(window.App);

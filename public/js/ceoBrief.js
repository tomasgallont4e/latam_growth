
'use strict';
// CEO brief for the Executive view: headline, 4 main KPIs, a compact strip, What changed / Risks /
// Next actions, all generated from numbers the page already has (api/executive + api/product/metrics).
// Pure and shared by the browser (App.ceoBrief) and Node tests, like productUsage.js.
// Presentation only. A missing value is "No data" or "Waiting for event", never zero.
(function (root) {
  function pu() {
    if (typeof module === 'object' && module.exports) return require('./productUsage.js');
    return root && root.App && root.App.productUsage;
  }

  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const isDay = (d) => DAY.test(String(d || ''));
  const num = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function addDays(iso, n) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const diffDays = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
  function endOfMonth(m) {
    const [y, mo] = m.split('-').map(Number);
    return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
  }
  const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const pct = (r, d = 1) => `${(Number(r) * 100).toFixed(d)}%`;
  const money = (n) => `US$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const compact = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : fmt(n));
  const dshort = (iso) => (isDay(iso) ? `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}` : '');
  const monthName = (m) => (/^\d{4}-\d{2}$/.test(String(m || '')) ? `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : '');

  // Goal semaphore on the prorated pace: green >= 90%, yellow 60-89%, red < 60%.
  function semaphore(ratio) {
    if (!num(ratio)) return 'none';
    if (ratio >= 0.9) return 'green';
    if (ratio >= 0.6) return 'yellow';
    return 'red';
  }

  // Pace against the monthly goal: expected = goal x elapsed days / days in the goal window.
  function goalPace(g) {
    if (!g || !num(g.value) || !num(g.goal) || Number(g.goal) <= 0) return null;
    if (!isDay(g.from) || !isDay(g.to) || !/^\d{4}-\d{2}$/.test(String(g.month || ''))) return null;
    const end = endOfMonth(g.month);
    const total = diffDays(g.from, end) + 1;
    const elapsed = Math.min(total, diffDays(g.from, g.to) + 1);
    if (total <= 0 || elapsed <= 0) return null;
    const value = Number(g.value), goal = Number(g.goal);
    const expected = (goal * elapsed) / total;
    const pace = expected > 0 ? value / expected : null;
    const closed = g.to >= end;
    const remaining = Math.max(0, goal - value);
    const daysLeft = Math.max(0, diffDays(g.to, end));
    return {
      value, goal, ratio: value / goal, expected, pace, closed, remaining, daysLeft, to: g.to, end,
      perDay: daysLeft ? remaining / daysLeft : null,
      latam: num(g.latam) ? Number(g.latam) : null,
      semaphore: closed ? (value >= goal ? 'green' : semaphore(value / goal)) : semaphore(pace),
    };
  }

  // Change vs a previous value. points: difference in percentage points (for rates). invert: a drop is good.
  function change(cur, prev, { invert = false, points = false } = {}) {
    if (!num(cur) || !num(prev)) return null;
    const c = Number(cur), p = Number(prev);
    if (points) {
      const d = (c - p) * 100;
      if (Math.abs(d) < 0.05) return { text: 'flat', tone: 'neutral', points: 0 };
      return { text: `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pp`, tone: (d > 0) !== invert ? 'good' : 'bad', points: d };
    }
    if (!p) return c ? { text: 'new', tone: invert ? 'bad' : 'good', ratio: null } : { text: 'flat', tone: 'neutral', ratio: 0 };
    const r = (c - p) / Math.abs(p);
    if (Math.abs(r) < 0.005) return { text: 'flat', tone: 'neutral', ratio: 0 };
    return { text: `${r > 0 ? '+' : '−'}${(Math.abs(r) * 100).toFixed(0)}%`, tone: (r > 0) !== invert ? 'good' : 'bad', ratio: r };
  }

  // Product KPIs from the api/product/metrics response. Each one: { state: ok|waiting|loading|nodata, ... }.
  function productKpis(product, month) {
    const st = product && product.status;
    if (st !== 'loaded' || !product.data) {
      const state = st === 'loading' ? 'loading' : 'nodata';
      const reason = st === 'error' ? `Product metrics did not load: ${(product && product.error) || 'unknown error'}`
        : st === 'loading' ? 'Loading from PostHog…' : (product && product.reason) || 'No product data for this month.';
      const blank = () => ({ state, value: null, reason });
      return { status: st || 'unavailable', reason, waiting: [], active: blank(), projects: blank(), credits: blank(), churn: blank() };
    }
    const d = product.data;
    const P = pu();
    const ev = d.events || {};
    const has = (k) => !!(ev[k] && ev[k].available);
    const name = (k) => (ev[k] && ev[k].name) || k;
    const waitingFor = (event) => ({ state: 'waiting', value: null, event });
    const out = {
      status: 'loaded', cutoff: d.cutoff,
      waiting: ['signed_in', 'project_created', 'credits_consumed', 'subscription_started', 'subscription_cancelled'].filter((k) => !has(k)).map(name),
    };
    const accountsOk = Array.isArray(d.accounts);

    if (!has('signed_in')) out.active = waitingFor(name('signed_in'));
    else if (!accountsOk) out.active = { state: 'nodata', value: null, reason: 'The accounts query failed.' };
    else {
      const daily = P.summarize({ accounts: d.accounts, projectDays: d.projectDays || [], from: d.from, cutoff: d.cutoff }).daily;
      const last = daily[daily.length - 1];
      const prev = daily.length > 7 ? daily[daily.length - 8] : null;
      out.active = last ? { state: 'ok', value: last.active_7d, prev: prev ? prev.active_7d : null } : { state: 'nodata', value: null, reason: 'No complete day since launch.' };
    }

    if (!has('project_created')) out.projects = waitingFor(name('project_created'));
    else if (!accountsOk) out.projects = { state: 'nodata', value: null, reason: 'The accounts query failed.' };
    else {
      const ext = d.accounts.filter((a) => !a.internal && isDay(a.created) && a.created >= d.from && a.created <= d.cutoff);
      const shareAt = (day) => {
        const created = ext.filter((a) => a.created <= day);
        if (!created.length) return null;
        const withProject = created.filter((a) => isDay(a.first_project) && a.first_project >= d.from && a.first_project <= day).length;
        return { share: withProject / created.length, with: withProject, total: created.length };
      };
      const now = shareAt(d.cutoff);
      const before = shareAt(addDays(d.cutoff, -7));
      out.projects = now ? { state: 'ok', value: now.share, with: now.with, total: now.total, prev: before ? before.share : null }
        : { state: 'nodata', value: null, reason: 'No external account created since launch yet.' };
    }

    if (!has('credits_consumed')) out.credits = waitingFor(name('credits_consumed'));
    else if (!d.credits) out.credits = { state: 'nodata', value: null, reason: 'The credits query failed.' };
    else {
      const c = P.creditUsage({ days: d.credits.days, people: d.credits.people, from: d.from, cutoff: d.cutoff });
      const prior = c.daily.length >= 14 ? c.daily.slice(-14, -7).reduce((n, r) => n + r.credits, 0) : null;
      out.credits = { state: 'ok', value: c.total, last7: c.last_7d, prev7: prior, accounts: c.accounts_using, medianDays: c.median_days_to_first };
    }

    if (!has('subscription_started') && !has('subscription_cancelled')) out.churn = waitingFor(`${name('subscription_started')} / ${name('subscription_cancelled')}`);
    else if (!has('subscription_cancelled')) out.churn = waitingFor(name('subscription_cancelled'));
    else if (!d.subscriptions) out.churn = { state: 'nodata', value: null, reason: 'The subscriptions query failed.' };
    else {
      const months = P.monthlyChurn({ subscriptions: d.subscriptions, from: d.from, cutoff: d.cutoff }).months;
      let idx = months.findIndex((m) => m.month === month);
      if (idx < 0) idx = months.length - 1;
      const cur = months[idx];
      const prev = idx > 0 ? months[idx - 1] : null;
      out.churn = !cur ? { state: 'nodata', value: null, reason: 'No subscription data for this month.' }
        : cur.churn == null ? { state: 'nodata', value: null, reason: 'No subscription was active at the start of the month.', cancelled: cur.cancelled_all }
          : { state: 'ok', value: cur.churn, prev: prev ? prev.churn : null, cancelled: cur.cancelled_all, activeStart: cur.active_start, partial: cur.partial };
    }
    return out;
  }

  // ---------- tiles
  function missing(label, k) {
    const sub = k.state === 'waiting' ? 'Turns on by itself when Product sends this backend event.' : k.reason || 'No data for this month.';
    return { label, state: k.state, value: null, event: k.event || '', tone: 'neutral', sub };
  }
  const SEM = { green: ['good', 'On pace'], yellow: ['warn', 'Near pace'], red: ['bad', 'Behind pace'] };
  function goalTile(g, pace) {
    const label = pace ? `Accounts created vs ${compact(pace.goal)} goal` : 'Accounts created vs monthly goal';
    if (!g || !num(g.value)) return { label, state: 'nodata', value: null, tone: 'neutral', sub: (g && g.reason) || 'No complete day of PostHog coverage in this month yet.' };
    if (!pace) return { label, state: 'ok', value: fmt(g.value), tone: 'neutral', badge: 'No goal set', sub: 'Set the monthly goal in Targets.' };
    const [tone, text] = SEM[pace.semaphore];
    const badge = pace.closed ? (pace.value >= pace.goal ? 'Goal met' : 'Goal missed') : text;
    const latam = pace.latam != null ? ` · LATAM ${fmt(pace.latam)}` : '';
    const sub = pace.closed ? `${pct(pace.ratio, 1)} of ${compact(pace.goal)} · month closed${latam}`
      : `${pct(pace.ratio, 1)} of ${compact(pace.goal)} · ${pct(pace.pace, 0)} of the pace needed by ${dshort(pace.to)}${latam}`;
    return { label, state: 'ok', value: fmt(pace.value), tone, badge, sub };
  }
  function activeTile(k) {
    const label = 'Active users (7 days)';
    if (k.state !== 'ok') return missing(label, k);
    const delta = change(k.value, k.prev);
    const tone = !delta || delta.ratio == null ? 'neutral' : delta.ratio <= -0.2 ? 'bad' : delta.ratio < -0.05 ? 'warn' : 'good';
    return { label, state: 'ok', value: fmt(k.value), delta, tone, sub: `Unique external accounts that signed in during the last 7 days${delta ? ' · vs the prior 7 days' : ''}.` };
  }
  function projectsTile(k) {
    const label = 'Accounts with a project';
    if (k.state !== 'ok') return missing(label, k);
    const delta = change(k.value, k.prev, { points: true });
    return { label, state: 'ok', value: pct(k.value, 0), delta, tone: delta ? (delta.tone === 'bad' ? 'warn' : delta.tone) : 'neutral', sub: `${fmt(k.with)} of ${fmt(k.total)} accounts created since launch built at least one project${delta ? ' · vs a week earlier' : ''}.` };
  }
  function churnTile(k, monthLabel) {
    const label = 'Monthly churn';
    if (k.state !== 'ok') return missing(label, k);
    const delta = change(k.value, k.prev, { points: true, invert: true });
    const tone = k.value >= 0.05 ? 'bad' : k.value >= 0.02 ? 'warn' : 'good';
    return { label, state: 'ok', value: pct(k.value, 1), delta, tone, badge: 'Provisional formula', sub: `${fmt(k.cancelled)} cancellation(s) in ${monthLabel}${k.partial ? ' (month in progress)' : ''} · ${fmt(k.activeStart)} subscriptions active at the start.` };
  }

  // ---------- strip
  function creditsChip(k) {
    const label = 'Credits consumed';
    if (k.state !== 'ok') return missing(label, k);
    const delta = change(k.last7, k.prev7);
    return { label, state: 'ok', value: fmt(k.value), sub: `Since launch · ${fmt(k.last7)} in the last 7 days${delta ? ` (${delta.text} vs the prior 7 days)` : ''} · ${fmt(k.accounts)} accounts used credits.` };
  }
  function spendChip(spend = {}, cps = {}) {
    const label = 'Investment & cost per account';
    if (!num(spend.value)) return { label, state: 'nodata', value: null, sub: spend.reason || 'No paid source reported data for this month.' };
    const cpa = num(cps.value) ? `Cost per account ${money(cps.value)}` : cps.status === 'no_signups' ? 'No accounts yet, so no cost per account' : `Cost per account unavailable${cps.reason ? ` (${cps.reason})` : ''}`;
    return { label, state: 'ok', value: money(spend.value), sub: `${cpa}${spend.complete === false ? ' · paid spend incomplete' : ''}.` };
  }
  function countriesChip(rows = []) {
    const label = 'Top markets';
    if (!rows.length) return { label, state: 'nodata', value: null, sub: 'No country data for this month yet.' };
    const [top, ...rest] = rows;
    const paceOf = (r) => (r.pace && r.pace !== 'No goal' ? ` (${r.pace})` : '');
    return { label, state: 'ok', value: `${top.country} ${fmt(top.signups)}`, sub: `${paceOf(top).trim() ? `${top.country}${paceOf(top)}` : 'Accounts created this month'}${rest.length ? ` · then ${rest.slice(0, 2).map((r) => `${r.country} ${fmt(r.signups)}${paceOf(r)}`).join(' · ')}` : ''}.` };
  }

  // ---------- text
  function headline(monthLabel, g, pace) {
    if (!g || !num(g.value)) return { tone: 'neutral', text: `${monthLabel}: ${(g && g.reason) || 'No complete day of account data yet.'}` };
    if (!pace) return { tone: 'neutral', text: `${monthLabel}: ${fmt(g.value)} accounts created. No monthly goal is set in Targets.` };
    const tone = SEM[pace.semaphore][0];
    const lead = `${monthLabel}: ${fmt(pace.value)} accounts created, ${pct(pace.ratio, 1)} of the ${compact(pace.goal)} goal.`;
    if (pace.closed) return { tone, text: `${lead} ${pace.value >= pace.goal ? 'Month closed with the goal met.' : 'Month closed below the goal.'}` };
    const by = dshort(pace.to);
    if (pace.semaphore === 'green') return { tone, text: `${lead} On pace: ${pct(pace.pace, 0)} of the expected count by ${by}.` };
    if (pace.semaphore === 'yellow') return { tone, text: `${lead} Close to pace: ${pct(pace.pace, 0)} of where we should be by ${by}.` };
    return { tone, text: `${lead} Behind pace: ${pct(pace.pace, 0)} of where we should be by ${by}.` };
  }

  function build(input = {}) {
    const month = input.month || '';
    const monthLabel = input.monthLabel || monthName(month);
    const g = input.goal || {};
    const pace = goalPace(g);
    const pk = productKpis(input.product, month);
    const spend = input.spend || {};
    const cps = input.cps || {};
    const countries = (input.countries || []).filter((r) => r && r.country && num(r.signups) && Number(r.signups) > 0)
      .sort((a, b) => Number(b.signups) - Number(a.signups));
    const funnel = input.funnel || {};

    const tiles = [goalTile(g, pace), activeTile(pk.active), projectsTile(pk.projects), churnTile(pk.churn, monthLabel)];
    const strip = [creditsChip(pk.credits), spendChip(spend, cps), countriesChip(countries)];

    const sub = [];
    if (pk.active.state === 'ok') sub.push(`${fmt(pk.active.value)} active users (7 days)`);
    if (pk.projects.state === 'ok') sub.push(`${pct(pk.projects.value, 0)} of new accounts built a project`);
    if (num(cps.value)) sub.push(`cost per account ${money(cps.value)}`);

    // What changed
    const changed = [];
    const dA = pk.active.state === 'ok' ? change(pk.active.value, pk.active.prev) : null;
    if (dA) changed.push(`Active users (7 days): ${fmt(pk.active.value)}, ${dA.text} vs the prior 7 days.`);
    const dP = pk.projects.state === 'ok' ? change(pk.projects.value, pk.projects.prev, { points: true }) : null;
    if (dP) changed.push(`Accounts with a project: ${pct(pk.projects.value, 0)}, ${dP.text} vs a week earlier.`);
    if (pk.credits.state === 'ok') {
      const dC = change(pk.credits.last7, pk.credits.prev7);
      changed.push(`Credits consumed in the last 7 days: ${fmt(pk.credits.last7)}${dC ? ` (${dC.text} vs the prior 7 days)` : ''}.`);
    }
    for (const line of (input.changed || []).slice(0, 2)) if (line) changed.push(String(line));
    if (!changed.length) changed.push('No comparison yet: the previous period has no complete data.');

    // Risks & blockers
    const risks = [];
    const actions = [];
    const trailing = countries.filter((r) => r.pace === 'Trailing' || r.pace === 'Missed').map((r) => r.country);
    if (pace && !pace.closed && (pace.semaphore === 'red' || pace.semaphore === 'yellow')) {
      risks.push(`Accounts are at ${pct(pace.pace, 0)} of the required pace${pace.perDay != null ? `; ${fmt(Math.ceil(pace.perDay))} accounts per day are needed for the remaining ${pace.daysLeft} day(s)` : ''}.`);
      actions.push(`Close the gap of ${fmt(pace.remaining)} accounts: review paid budget and creative${countries.length ? `, starting with the strongest market (${countries[0].country})` : ''}.`);
    }
    if (spend.complete === false && num(spend.value)) {
      risks.push(`Paid spend is incomplete, so cost per account is understated${spend.reason ? `: ${spend.reason}` : '.'}`);
      actions.push('Finish the paid spend sync so cost per account is complete.');
    }
    if (pk.status === 'error') risks.push(pk.reason);
    if (pk.waiting.length) {
      risks.push(`Product events not received yet: ${pk.waiting.join(', ')}. Those KPIs show “Waiting for event”.`);
      actions.push(`Ask Product to ship the backend events: ${pk.waiting.join(', ')}.`);
    }
    if (dA && dA.ratio != null && dA.ratio <= -0.2) {
      risks.push(`Active users fell ${pct(-dA.ratio, 0)} vs the prior 7 days.`);
      actions.push(`Check sign-in and onboarding: active users dropped ${pct(-dA.ratio, 0)}.`);
    }
    if (pk.churn.state === 'ok' && pk.churn.value >= 0.05) {
      risks.push(`Monthly churn is ${pct(pk.churn.value, 1)}.`);
      actions.push('Review cancellation reasons with Customer Success.');
    }
    if (trailing.length) {
      risks.push(`${trailing.length} market(s) trail their plan: ${trailing.slice(0, 4).join(', ')}.`);
      actions.push(`Review campaigns in ${trailing.slice(0, 3).join(', ')}.`);
    }
    if (funnel.total && funnel.gaps) risks.push(`${funnel.gaps} of ${funnel.total} funnel stages have no data.`);
    if (!risks.length) risks.push('No blocker detected in the numbers on this page.');
    if (!actions.length) actions.push('Keep the current plan and review again next week.');

    const through = input.dataThrough ? `Data through ${dshort(input.dataThrough)}` : 'No complete day yet';
    const productThrough = pk.cutoff ? ` Product KPIs read PostHog through ${dshort(pk.cutoff)}.` : '';
    return {
      month, monthLabel, through, pace, product: pk,
      headline: headline(monthLabel, g, pace),
      subline: sub.length ? `${sub.join(' · ')}.`.replace(/^./, (c) => c.toUpperCase()) : '',
      tiles, strip,
      changed: changed.slice(0, 4), risks: risks.slice(0, 4), actions: actions.slice(0, 3),
      foot: `Text generated automatically from the numbers on this page. Accounts = first account_created or $identify per person, all hosts, internal accounts always excluded.${productThrough} Missing feeds show No data or Waiting for event, never zero.`,
    };
  }

  const api = { build, goalPace, productKpis, change, semaphore };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.App) root.App.ceoBrief = api;
})(typeof window !== 'undefined' ? window : this);

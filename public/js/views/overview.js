'use strict';
/* Overview: opens with the MONTHLY 500K goal hero for the global top-bar Month (memory #141) with the
   daily sign-ups vs goal chart and a collapsible monthly history, then the 7-step funnel with a country
   selector, and the last two complete periods compared. The funnel uses the same step definitions as the Executive
   campaign funnel (lib/campaignFunnel.js, docs/executive-campaign-funnel.md). Its steps come from
   different sources, so % between steps are indicative, not a tracked person-by-person journey. */
(function (A) {
  const NOT_SPLIT = 'Not split by country';
  // Monthly 500K chart (memory #141): one bar per month since launch, height = % of that month's goal.
  // Same numbers as D.goalAccounts, so Overview and Executive always agree. A click (or Enter/Space)
  // on a bar sets the global Month; call A.bindGoalMonthChart(el) after render.
  function nice(v) {
    if (!(v > 0)) return 0.01;
    const e = Math.pow(10, Math.floor(Math.log10(v))), m = v / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
  }
  A.goalMonthChart = (selected = A.S.goalMonth) => {
    const U = A.ui, D = A.D;
    const pct = (r) => (A.charts && A.charts.sharePct ? A.charts.sharePct(r) : U.pct(r, 1));
    const months = A.months().map((m) => ({ ...m, g: D.goalAccounts(m.id) }));
    if (!months.some((m) => m.g.goal > 0)) return U.empty('No monthly goal saved', 'Set the 500K goal in Targets to chart progress by month.', 'bullseye');
    const ratio = (m) => (m.g.status === 'loaded' && m.g.goal > 0 ? m.g.value / m.g.goal : null);
    const peak = Math.max(0, ...months.map(ratio).filter((v) => v != null));
    const max = nice(peak * 1.15);
    const W = 1000, H = 250, L = 60, R = 16, T = 24, B = 212;
    const y = (v) => B - (v / max) * (B - T);
    const step = (W - L - R) / months.length;
    const bw = Math.min(step * 0.56, 88);
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = (max * k) / 4, yy = y(v).toFixed(1);
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${U.esc(pct(v))}</text>`;
    }
    if (max >= 1) g += `<line class="gm-target" x1="${L}" x2="${W - R}" y1="${y(1).toFixed(1)}" y2="${y(1).toFixed(1)}"><title>100% of the monthly goal</title></line>`;
    months.forEach((m, j) => {
      const r = ratio(m), sel = m.id === selected;
      const x0 = L + j * step, cx = (x0 + step / 2).toFixed(1);
      const tip = m.g.status === 'loaded'
        ? `${m.label} · ${U.fmt(m.g.value)} accounts created${m.g.goal ? ` · ${pct(r)} of ${U.fmt(m.g.goal)}` : ''} · cumulative since launch ${m.g.cumulative != null ? U.fmt(m.g.cumulative) : 'Pending'}`
        : `${m.label} · Pending: ${m.g.reason || 'coverage unavailable'}`;
      let inner = `<rect class="day-hit" x="${x0.toFixed(2)}" y="${T}" width="${step.toFixed(2)}" height="${B - T}"/>`;
      if (r != null) {
        const top = y(Math.min(r, max));
        inner += `<rect class="goal-col" x="${(x0 + (step - bw) / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.8, B - top).toFixed(2)}"/>`;
        inner += `<text class="gm-val" x="${cx}" y="${(top - 6).toFixed(1)}" text-anchor="middle">${U.esc(pct(r))}</text>`;
      } else inner += `<text class="gm-val" x="${cx}" y="${B - 6}" text-anchor="middle">Pending</text>`;
      inner += `<text x="${cx}" y="${H - 14}" text-anchor="middle">${U.esc(m.label)}</text>`;
      g += `<g class="gm-bar${sel ? ' is-sel' : ''}" data-goal-month="${U.esc(m.id)}" tabindex="0" role="button" aria-pressed="${sel}" aria-label="${U.esc(tip)}"><title>${U.esc(tip)}</title>${inner}</g>`;
    });
    return `<div class="chart-scroll"><svg class="chart-svg goal-month-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Accounts created by month as a percent of the monthly goal">${g}</svg></div><p class="card-note">Bars: External accounts created in each month ÷ that month's goal (internal accounts always excluded). The highlighted bar is the selected Month; click a bar to switch the Month for every view.</p>`;
  };
  A.bindGoalMonthChart = (el) => {
    el.querySelectorAll('[data-goal-month]').forEach((node) => {
      const pick = () => { const id = node.getAttribute('data-goal-month'); if (id && id !== A.S.goalMonth) A.setGoalMonth(id); };
      node.addEventListener('click', pick);
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  };

  // Change vs the same days of the previous month (g.prev from D.goalAccounts): +/− accounts and %.
  A.goalPrevHtml = (g) => {
    const U = A.ui, pr = g && g.prev;
    if (!pr) return '<span class="text-muted">–</span>';
    if (pr.status !== 'loaded') return '<span class="text-muted">Pending</span>';
    const up = pr.delta >= 0;
    const pctTxt = pr.change == null ? '' : ` (${up ? '+' : '−'}${U.pct(Math.abs(pr.change), 1)})`;
    return `<span class="gp-status gp-${up ? 'ahead' : 'behind'}">${U.icon(up ? 'arrow-trend-up' : 'arrow-trend-down')} ${up ? '+' : '−'}${U.fmt(Math.abs(pr.delta))}${U.esc(pctTxt)}</span>`;
  };
  A.goalPrevHint = (g) => (g && g.prev ? `Same days: ${A.ui.win(g.prev.from, g.prev.to)}` : 'No previous month since launch');
  // "This month: N · Cumulative since launch: M" (shared with Executive; same D.goalAccounts numbers).
  A.goalActualCumText = (g) => {
    const U = A.ui;
    const cur = g && g.status === 'loaded' ? U.fmt(g.value) : 'Pending';
    const cum = g && g.cumulative != null ? U.fmt(g.cumulative) : 'Pending';
    return `This month: ${cur} · Cumulative since launch: ${cum}`;
  };
  A.goalSourceText = (g) => (g && g.goalSource === 'targets' ? 'Goal from Targets' : g && g.goalSource === 'default' ? 'Default 500K plan' : '');

  // Sign-ups vs the 500K goal for one Month: daily cumulative Accounts created (D.goalDaily, same
  // number as the goal card), required pace and the 100% goal line. Shared with Executive.
  // opts.head === false hides the summary line (the Overview hero already shows those numbers).
  A.goalPaceChart = (month = A.S.goalMonth, opts = {}) => {
    const U = A.ui, C = A.charts;
    const p = A.D.goalDaily(month);
    if (!(p.goal > 0)) return U.empty('No monthly goal saved', 'Set the 500K goal in Targets to chart sign-ups against it.', 'bullseye');
    let head = '';
    if (opts.head === false) head = '';
    else if (p.status !== 'loaded') {
      head = `<div class="gp-head"><span class="kpi-awaiting">Pending</span><span>${U.esc(p.reason || 'Coverage unavailable.')}</span></div>`;
    } else {
      const gap = Math.round(Math.abs(p.delta));
      head = `<div class="gp-head"><span><b>${U.fmt(p.value)}</b> sign-ups to date</span><span><b>${U.esc(C.sharePct(p.ratio))}</b> of ${U.fmt(p.goal)}${p.goalSource ? ` <small>(${U.esc(A.goalSourceText(p))})</small>` : ''}</span><span>Minimum to date <b>${U.fmt(Math.ceil(p.required))}</b></span>`
        + `<span class="gp-status gp-${p.ahead ? 'ahead' : 'behind'}">${U.icon(p.ahead ? 'arrow-trend-up' : 'arrow-trend-down')} ${p.ahead ? 'Ahead of pace' : 'Behind pace'} · ${p.ahead ? '+' : '−'}${U.fmt(gap)}</span>`
        + (p.prev ? `<span>vs previous month (${U.esc(U.win(p.prev.from, p.prev.to))}) ${A.goalPrevHtml(p)}</span>` : '') + '</div>';
    }
    const chart = C.goalProgress({ dates: p.dates, values: p.values, goal: p.goal, pace: p.pace, goalLine: true, label: `Sign-ups vs goal · ${U.monthName(month)}`, unit: 'sign-ups' });
    const through = p.to ? `Through ${U.dshort(p.to)}. ` : '';
    return `${head}${chart}<p class="card-note">${U.esc(through)}Bars: cumulative External accounts created this month (first $identify, internal always excluded). Dashed line: required pace = goal × day ÷ days in month. Days without data yet are empty.</p>`;
  };

  // 500K goal hero for the global Month: Accounts created vs goal, LATAM share and pace (D.goalAccounts /
  // D.goalDaily, the same numbers as Executive), the daily pace chart and a collapsible monthly history.
  function goalCard() {
    const U = A.ui, D = A.D, S = A.S;
    const month = S.goalMonth, mName = U.monthName(month);
    const g = D.goalAccounts(month);
    const p = D.goalDaily(month);
    const loaded = g.status === 'loaded';
    const ratio = loaded && g.goal ? g.value / g.goal : null;
    const width = ratio == null ? 0 : Math.min(100, Math.max(0, ratio * 100));
    const span = g.to ? U.win(g.from, g.to) : 'no covered day yet';
    const nums = loaded
      ? `<span class="acct-hero-actual">${U.fmt(g.value)}</span>${g.goal ? `<span class="acct-hero-goal">of ${U.fmt(g.goal)}</span>` : ''}`
      : '<span class="acct-hero-actual"><span class="kpi-awaiting">Pending</span></span>';
    const foot = !loaded ? `<span>${U.esc(g.reason || 'Coverage unavailable.')}</span>`
      : g.goal ? `<span><b>${U.esc(U.pct(ratio, 1))}</b> of the ${U.esc(mName)} goal</span><span>${U.esc(span)}</span><span>${U.esc(A.goalSourceText(g))}</span>` : '<span>No monthly goal saved in Targets.</span>';
    const cumOk = loaded && g.cumulative != null;
    const cumBlock = `<div class="acct-hero-cum"><span class="acct-hero-label">Cumulative since launch</span><div class="acct-hero-nums">${cumOk ? `<span class="acct-hero-actual">${U.fmt(g.cumulative)}</span>` : '<span class="acct-hero-actual"><span class="kpi-awaiting">Pending</span></span>'}</div><small class="acct-hero-hint">${cumOk ? `of which LATAM: ${U.fmt(g.cumulativeLatam)} (${U.esc(U.pct(g.cumulative ? g.cumulativeLatam / g.cumulative : 0, 1))}) · ${U.esc(U.win(g.cumulativeFrom, g.to))}` : 'Needs account coverage for every month since launch; not zero.'}</small></div>`;
    const paceOk = p.status === 'loaded' && p.goal > 0;
    const paceVal = paceOk
      ? `<span class="gp-status gp-${p.ahead ? 'ahead' : 'behind'}">${U.icon(p.ahead ? 'arrow-trend-up' : 'arrow-trend-down')} ${p.ahead ? 'Ahead' : 'Behind'} · ${p.ahead ? '+' : '−'}${U.fmt(Math.round(Math.abs(p.delta)))}</span>`
      : '<span class="text-muted">Pending</span>';
    const side = [
      ['Of which LATAM', loaded ? `${U.fmt(g.latam)}<small>${U.esc(U.pct(g.latamShare || 0, 1))}</small>` : '–', 'The 11 plan countries'],
      ['Minimum to date', paceOk ? U.fmt(Math.ceil(p.required)) : '–', 'Goal × day ÷ days in month'],
      ['Pace', paceVal, 'Versus the minimum to date'],
      ['vs previous month', loaded ? A.goalPrevHtml(g) : '–', A.goalPrevHint(g)],
    ].map(([dt, dd, hint]) => `<div><dt>${U.esc(dt)}</dt><dd>${dd}</dd><dd class="acct-hero-hint">${U.esc(hint)}</dd></div>`).join('');
    const rows = A.months().map((m) => ({ ...m, g: D.goalAccounts(m.id) }));
    const bar = (r) => {
      if (r.g.status !== 'loaded' || !r.g.goal) return '<span class="text-muted">–</span>';
      const ratio = r.g.value / r.g.goal, width = Math.min(100, Math.max(0, ratio * 100));
      return `<div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(width)}" aria-label="${U.esc(r.label)} percent of goal"><i style="width:${width.toFixed(1)}%"></i></div><small>${U.pct(ratio, 1)}</small>`;
    };
    const history = U.table([
      { t: 'Month', f: (r) => (r.id === month ? `<b>${U.esc(r.label)}</b>` : U.esc(r.label)) },
      { t: 'Accounts created', num: 1, f: (r) => (r.g.status === 'loaded' ? U.fmt(r.g.value) : '<span class="text-muted">Pending</span>') },
      { t: 'Cumulative', num: 1, f: (r) => (r.g.cumulative != null ? U.fmt(r.g.cumulative) : '<span class="text-muted">Pending</span>') },
      { t: '% of goal', f: bar },
    ], rows);
    const historyPanel = `<details class="goal-panel ov-history" id="ov-history"${S.ovHistoryOpen ? ' open' : ''}><summary><span><b>Monthly history</b><small>% of the monthly goal and accounts created per month since launch · click a bar to switch the Month</small></span><span class="goal-summary">Details ${U.icon('chevron-down')}</span></summary><div class="goal-body"><h4 class="cf-sub">% of the monthly goal by month</h4>${A.goalMonthChart(month)}<h4 class="cf-sub">Accounts created by month</h4>${history}</div></details>`;
    const progress = `<div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(width)}" aria-label="${U.esc(mName)} percent of goal"><i style="width:${width.toFixed(1)}%"></i></div>`;
    return U.card({
      cls: 'acct-hero-card', title: `LATAM 500K goal · ${mName}`,
      sub: 'Monthly · External accounts created, sign-ups once per person (first $identify, all hosts, all countries) · internal accounts always excluded · America/Bogota',
      right: `<button class="btn btn-secondary btn-sm" type="button" data-go="targets">${U.icon('bullseye')} View targets</button>`,
      body: `<div class="acct-hero"><div class="acct-hero-main"><div style="display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start"><div><span class="acct-hero-label">This month · Accounts created · ${U.esc(mName)}</span><div class="acct-hero-nums">${nums}</div></div>${cumBlock}</div>${progress}<div class="acct-hero-foot">${foot}</div></div><dl class="acct-hero-side">${side}</dl><div class="acct-hero-trend"><h4 class="cf-sub">Sign-ups vs goal · ${U.esc(mName)}</h4>${A.goalPaceChart(month, { head: false })}</div></div>${historyPanel}`,
    });
  }

  // ---------- 7-step funnel (From/To window, optional country)
  function metricsList() {
    const D = A.D;
    return typeof D.M === 'function' ? D.M() : ((A.S.data && A.S.data.metrics) || []);
  }
  function countryOptions() {
    const plan = (A.S.data && A.S.data.goalPlan && A.S.data.goalPlan.countries) || {};
    const seen = new Set(Object.keys(plan));
    for (const r of metricsList()) {
      if (r.dim === 'country' && r.dim_value && (r.metric === 'ph_accounts_geo' || r.metric === 'ga_exec_geo_sessions')) seen.add(r.dim_value);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }
  function funnelSteps(from, to, country) {
    const D = A.D, all = !country || country === 'all';
    const inCountry = (r) => r.dim === 'country' && r.dim_value === country;
    const split = (name, src) => ({ name, src, n: null, note: NOT_SPLIT });
    const add = (parts) => parts.reduce((s, v) => s + (Number(v) || 0), 0);
    const steps = [];
    // 1. Impressions (Meta Ads + Google Ads; LinkedIn Ads is not used, memory #151)
    const impMetric = all ? 'ad_impressions' : 'ad_impressions_geo';
    const impNets = ['meta', 'google_ads'].filter((k) => D.has(k, impMetric));
    if (impNets.length) steps.push({ name: 'Impressions', src: 'Meta Ads · Google Ads', n: add(impNets.map((k) => D.sum(k, impMetric, all ? null : inCountry, from, to))) });
    else steps.push(all ? { name: 'Impressions', src: 'Meta Ads · Google Ads', n: null, note: 'No ad platform has reported' } : split('Impressions', 'Meta Ads · Google Ads'));
    // 2. Clicks to the landing (Meta outbound + Google Ads clicks); never split by country
    if (!all) steps.push(split('Clicks to the landing', 'Meta outbound · Google Ads clicks'));
    else {
      const parts = [];
      if (D.has('meta', 'ad_outbound_clicks')) parts.push(D.sum('meta', 'ad_outbound_clicks', null, from, to));
      if (D.has('google_ads', 'ad_clicks')) parts.push(D.sum('google_ads', 'ad_clicks', null, from, to));
      steps.push({ name: 'Clicks to the landing', src: 'Meta outbound · Google Ads clicks', n: parts.length ? add(parts) : null, note: 'No outbound clicks reported' });
    }
    // 3. Landing sessions (GA4, go.think4ever.com only)
    steps.push(D.has('ga4', 'ga_exec_geo_sessions')
      ? { name: 'Landing sessions', src: 'GA4 · go.think4ever.com', n: D.sum('ga4', 'ga_exec_geo_sessions', all ? null : inCountry, from, to) }
      : { name: 'Landing sessions', src: 'GA4 · go.think4ever.com', n: null, note: 'GA4 go-host sessions not synced' });
    // 4. Form submissions (HubSpot)
    if (!all) steps.push(split('Form submissions', 'HubSpot · CRM contacts'));
    else {
      const crm = D.crmTotal(from, to);
      steps.push({ name: 'Form submissions', src: 'HubSpot · CRM contacts', n: crm == null ? null : crm, note: 'HubSpot has not reported' });
    }
    // 5. Accounts created (memory #134: External first $identify, all hosts, internal excluded)
    const covered = D.covered('posthog', 'account_coverage', from, to);
    const accounts = !covered ? null : all
      ? D.sum('posthog', 'ph_accounts', (r) => r.dim === 'account_type' && r.dim_value !== 'Internal', from, to)
      : D.sum('posthog', 'ph_accounts_geo', inCountry, from, to);
    steps.push({ name: 'Accounts created', src: 'PostHog · first $identify · External', n: accounts, note: 'Account coverage unavailable; not zero' });
    // 6. Logins (PostHog signed_in events; entries to the platform; events, not people)
    const loginsSynced = metricsList().some((r) => r.source === 'posthog' && r.metric === 'ph_event' && r.dim_value === 'signed_in');
    // Shown in place but `aside`: login events include returning accounts, so they are not a subset of
    // accounts created and never enter a step % or the weakest step. Projects compare with accounts.
    const loginsAside = { aside: true, bridge: 'Logins are events, not people · not part of the step %' };
    if (!loginsSynced) steps.push({ name: 'Logins', src: 'PostHog · signed_in', n: null, note: 'No signed_in event is synced yet', ...loginsAside });
    else if (!all) steps.push({ ...split('Logins', 'PostHog · signed_in'), ...loginsAside });
    else steps.push({ name: 'Logins', src: 'PostHog · signed_in (events)', n: D.sum('posthog', 'ph_event', (r) => r.dim_value === 'signed_in', from, to), ...loginsAside });
    // 7. Projects created (PostHog project_created)
    if (!all) steps.push(split('Projects created', 'PostHog · project_created'));
    else steps.push({ name: 'Projects created', src: 'PostHog · project_created', n: D.has('posthog', 'ph_event') ? D.sum('posthog', 'ph_event', (r) => r.dim_value === 'project_created', from, to) : null, note: 'PostHog events not synced' });
    return steps;
  }
  function funnelCard(from, to) {
    const U = A.ui, C = A.charts, S = A.S;
    const options = countryOptions();
    const country = options.includes(S.overviewCountry) ? S.overviewCountry : 'all';
    const steps = funnelSteps(from, to, country);
    const weak = C.weakest(steps);
    const weakLine = weak > 0
      ? `Weakest step: ${steps[C.prevStep(steps, weak)].name} → ${steps[weak].name}, ${U.pct(steps[weak].n / steps[C.prevStep(steps, weak)].n, 1)} continue.`
      : 'The weakest step appears once two consecutive steps have data.';
    const picker = `<label class="field market-select"><span>Country</span><select id="goal-country" aria-label="Select country"><option value="all"${country === 'all' ? ' selected' : ''}>All countries</option>${options.map((name) => `<option value="${U.esc(name)}"${name === country ? ' selected' : ''}>${U.esc(name)}</option>`).join('')}</select></label>`;
    const note = `<p class="card-note">Each step comes from its own source and is not linked person by person, so the % between steps is indicative. Accounts created is the same number as the 500K goal (External, internal excluded). Logins count signed_in events, not people, and include returning accounts, so they are shown for reference and Projects created is compared with Accounts created. ${country === 'all' ? '' : `${NOT_SPLIT}: clicks, forms, logins and projects; impressions only when the ad platforms store a country split.`}</p>`;
    return U.card({
      cls: 'chart-card', title: 'Funnel · 7 steps',
      sub: `${U.win(from, to)} · ${country === 'all' ? 'All countries' : U.esc(country)} · % versus the previous step`,
      right: picker,
      body: C.funnel(steps, 'Funnel from impressions to projects created') + `<p class="card-note"><b>${U.esc(weakLine)}</b></p>${note}<button class="btn btn-secondary btn-sm" type="button" data-go="executive">Open the Executive funnel</button>`,
    });
  }

  // ---------- last two complete periods (in-progress bucket excluded)
  function periodComparison(comparison = A.D.completeBucketComparison()) {
    const U = A.ui, D = A.D;
    const title = `Last complete ${D.grainName()} period vs previous`;
    if (!comparison) return U.section(title, `No comparison yet: available history since launch must contain two fully completed ${D.grainName().toLowerCase()} buckets.`, U.card({ title: 'Comparison unavailable', body: U.empty('Not enough completed history', 'The in-progress bucket is excluded from comparisons.') }));
    const cur = comparison.current, prev = comparison.previous;
    const a = D.ga(cur.from, cur.to), b = D.ga(prev.from, prev.to);
    const fields = [
      { label: 'GA4 sessions', source: 'GA4', cur: a && a.sessions, prev: b && b.sessions, format: U.fmt, delta: U.delta },
      { label: 'Engagement rate', source: 'GA4', cur: a && a.rate, prev: b && b.rate, format: U.pct, delta: U.deltaPoints },
      { label: 'HubSpot sessions', source: 'HubSpot', cur: D.has('hubspot', 'sessions') ? D.sessions(cur.from, cur.to) : null, prev: D.has('hubspot', 'sessions') ? D.sessions(prev.from, prev.to) : null, format: U.fmt, delta: U.delta },
      { label: 'CRM contacts', source: 'HubSpot', cur: D.crmTotal(cur.from, cur.to), prev: D.crmTotal(prev.from, prev.to), format: U.fmt, delta: U.delta },
      { label: 'Accounts created (PostHog first $identify)', source: 'PostHog', cur: D.accounts(cur.from, cur.to), prev: D.accounts(prev.from, prev.to), format: U.fmt, delta: U.delta },
      { label: 'Registration starts', source: 'PostHog', cur: D.registrations(cur.from, cur.to), prev: D.registrations(prev.from, prev.to), format: U.fmt, delta: U.delta },
    ].filter((x) => x.cur != null || x.prev != null);
    const tiles = fields.map((x) => U.kpi({ label: x.label, source: x.source, value: x.format(x.cur), delta: x.delta(x.cur, x.prev), compare: `${prev.label}: ${x.format(x.prev)}` }));
    const body = tiles.length ? U.kpiRow(tiles, 3) : U.empty('No comparable metrics yet', 'The connected sources have no daily facts for these completed buckets.');
    return U.section(title, `${cur.label} vs ${prev.label} · last two complete ${D.grainName().toLowerCase()} buckets since launch; independent of the selected date range; in-progress bucket excluded`, body);
  }

  function render() {
    const U = A.ui, S = A.S;
    const from = S.from, to = S.to;
    const links = `<nav class="ov-links" aria-label="Open a detailed view">${[['acquisition', 'Acquisition', 'bullhorn'], ['conversion', 'Conversion', 'filter'], ['product', 'Product usage', 'cubes'], ['executive', 'Executive', 'chart-line']].map(([go, label, icon]) => `<button class="btn btn-ghost btn-sm" type="button" data-go="${go}">${U.icon(icon)} ${U.esc(label)}</button>`).join('')}</nav>`;
    return U.section('Overview', `Monthly sign-up goal for the Month selected at the top (goal from Targets, else the 500K plan) · America/Bogota`, goalCard(), links)
      + U.section('Funnel', `${from} to ${to} · seven steps from impression to project · pick a country to focus on one market`, funnelCard(from, to))
      + periodComparison()
      + U.section('What matters', 'Evidence-based reading of the selected period.', A.assistant.render());
  }
  function mount(el) {
    A.assistant.mount(el);
    A.bindGoalMonthChart(el);
    const hist = el.querySelector('#ov-history');
    if (hist) hist.addEventListener('toggle', () => { A.S.ovHistoryOpen = hist.open; });
    const pick = el.querySelector('#goal-country');
    if (pick) pick.addEventListener('change', () => { A.S.overviewCountry = pick.value; A.render(); });
  }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

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
    const fit = !!opts.fit && p.status === 'loaded';
    // opts.focus = { from, to }: the dates typed in From/To. Those days stay solid and the rest of the month dims.
    const focus = opts.focus && p.dates.some((d) => d >= opts.focus.from && d <= opts.focus.to) ? opts.focus : null;
    const chart = C.goalProgress({ dates: p.dates, values: p.values, goal: p.goal, pace: p.pace, goalLine: true, fit, focus, label: `Sign-ups vs goal · ${U.monthName(month)}`, unit: 'sign-ups' });
    const through = p.to ? `Through ${U.dshort(p.to)}. ` : '';
    const fitNote = fit ? ' Scaled to the actual: the required pace line leaves the top of the chart and the goal is off the scale.' : '';
    const focusNote = focus ? ` Highlighted: ${U.win(focus.from, focus.to)}, the dates in From/To; the other days of the month are dimmed.` : '';
    return `${head}${chart}<p class="card-note">${U.esc(through)}Bars: cumulative External accounts created this month (first account_created or $identify, internal always excluded). Dashed line: required pace = goal × day ÷ days in month. Days without data yet are empty.${U.esc(fitNote)}${U.esc(focusNote)}</p>`;
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
    // Accounts created for the top-bar Group by period, always inside the selected Month's dates
    // (memory #141 population: External first account_created or $identify, all hosts, internal always excluded).
    // Ends at To when To is in the Month (same window as the 7-step funnel), else at the Month's last day.
    // Dates typed in From/To win: the block then counts exactly From -> To (the same window and number as
    // step 5 of the 7-step funnel) and leads the card; the Month total moves to second place.
    const ow = A.overviewWindow();
    const byRange = ow.mode === 'range';
    const mr = A.monthRange(month);
    const pTo = S.to >= mr.from && S.to <= mr.to ? S.to : mr.to;
    const pFrom = S.from >= mr.from && S.from <= pTo ? S.from : mr.from;
    const pw = byRange ? ow : A.grainWindow(D.grain(), pFrom, pTo);
    const pOk = D.covered('posthog', 'account_coverage', pw.from, pw.to);
    const pVal = pOk ? D.sum('posthog', 'ph_accounts', (r) => r.dim === 'account_type' && r.dim_value !== 'Internal', pw.from, pw.to) : null;
    const pMarkets = new Set(Object.keys((S.data && S.data.goalPlan && S.data.goalPlan.countries) || {}));
    const pLatam = pOk ? D.sum('posthog', 'ph_accounts_geo', (r) => r.dim === 'country' && pMarkets.has(r.dim_value), pw.from, pw.to) : null;
    const periodBlock = `<div class="acct-hero-period"><span class="acct-hero-label">${byRange ? `Selected dates · Accounts created · ${U.esc(U.win(pw.from, pw.to))}` : `Selected period · ${U.esc(D.grainName())}`}</span><div class="acct-hero-nums">${pOk ? `<span class="acct-hero-actual">${U.fmt(pVal)}</span>` : '<span class="acct-hero-actual"><span class="kpi-awaiting">Pending</span></span>'}</div><small class="acct-hero-hint">${pOk ? `of which LATAM: ${U.fmt(pLatam)} (${U.esc(U.pct(pVal ? pLatam / pVal : 0, 1))}) · ${byRange ? 'follows From/To at the top' : `${U.esc(U.win(pw.from, pw.to))} · follows Group by`}` : `Account coverage unavailable for ${U.esc(U.win(pw.from, pw.to))}; not zero.`}</small></div>`;
    const paceOk = p.status === 'loaded' && p.goal > 0;
    const paceVal = paceOk
      ? `<span class="gp-status gp-${p.ahead ? 'ahead' : 'behind'}">${U.icon(p.ahead ? 'arrow-trend-up' : 'arrow-trend-down')} ${p.ahead ? 'Ahead' : 'Behind'} · ${p.ahead ? '+' : '−'}${U.fmt(Math.round(Math.abs(p.delta)))}</span>`
      : '<span class="text-muted">Pending</span>';
    // Far below the goal (under 20% of the minimum to date) the full-goal scale flattens the bars, so the
    // chart opens scaled to the actual; the toggle shows the full goal.
    const canFit = paceOk && p.required > 0 && p.value < p.required * 0.2;
    const fit = canFit && !S.ovPaceFull;
    const scaleToggle = canFit ? `<div class="seg" role="group" aria-label="Chart scale"><button type="button" class="btn btn-ghost btn-sm" data-ov-scale="fit" aria-pressed="${fit}">Fit to actual</button><button type="button" class="btn btn-ghost btn-sm" data-ov-scale="full" aria-pressed="${!fit}">Full goal</button></div>` : '';
    const side = [
      ['Of which LATAM', loaded ? `${U.fmt(g.latam)}<small>${U.esc(U.pct(g.latamShare || 0, 1))}</small>` : '–', 'The 11 plan countries'],
      ['Minimum to date', paceOk ? U.fmt(Math.ceil(p.required)) : '–', 'Goal × day ÷ days in month'],
      ['Pace', paceVal, 'Versus the minimum to date'],
      ['vs previous month', loaded ? A.goalPrevHtml(g) : '–', A.goalPrevHint(g)],
    ].map(([dt, dd, hint]) => `<div class="acct-stat"><dt>${U.esc(dt)}</dt><dd>${dd}</dd><dd class="acct-hero-hint">${U.esc(hint)}</dd></div>`).join('');
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
      sub: 'Monthly · External accounts created, sign-ups once per person (first account_created or $identify, all hosts, all countries) · internal accounts always excluded · America/Bogota',
      right: `<button class="btn btn-secondary btn-sm" type="button" data-go="targets">${U.icon('bullseye')} View targets</button>`,
      body: `<div class="acct-hero"><div class="acct-hero-main"><div class="acct-hero-top${byRange ? ' is-range' : ''}"><div class="acct-hero-now"><span class="acct-hero-label">This month · Accounts created · ${U.esc(mName)}</span><div class="acct-hero-nums">${nums}</div></div>${periodBlock}${cumBlock}</div>${progress}<div class="acct-hero-foot">${foot}</div></div><dl class="acct-hero-side">${side}</dl><div class="acct-hero-trend"><div class="acct-hero-trend-head"><h4 class="cf-sub">Sign-ups vs goal · ${U.esc(mName)}</h4>${scaleToggle}</div>${A.goalPaceChart(month, { head: false, fit, focus: byRange ? { from: pw.from, to: pw.to } : null })}</div></div>${historyPanel}`,
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
  // Targets for the % that should continue from the step above. Clicks and Started sign-up are team targets
  // (2026-11-17); the rest come from market benchmarks. Logins have none: they are a reference, not part of the step %.
  const STEP_TARGETS = {
    'Clicks to the landing': { pct: 0.1, basis: 'team target; the market CTR for technology ads is about 2 to 4% (WordStream)' },
    'Landing sessions': { pct: 0.85, basis: 'ad clicks that become GA4 sessions, normally 85 to 95%' },
    'Started sign-up': { pct: 0.5, atLeast: true, basis: 'team target, half of the landing sessions start signing up; the SaaS landing page median is 3.8% (Unbounce)' },
    'Accounts created': { pct: 0.7, basis: 'sign-up completion after an email code; no solid benchmark, a verification gate costs 8 to 20 points' },
    'Projects created': { pct: 0.4, basis: '7-day activation, median about 41.7% and average 37.5% (Userpilot)' },
  };
  function funnelSteps(from, to, country) {
    const D = A.D, all = !country || country === 'all';
    const inCountry = (r) => r.dim === 'country' && r.dim_value === country;
    const split = (name, src) => ({ name, src, n: null, note: NOT_SPLIT });
    const add = (parts) => parts.reduce((s, v) => s + (Number(v) || 0), 0);
    const steps = [];
    // 1. Impressions: Meta Ads + Google Ads + the organic LinkedIn company page (no LinkedIn Ads, memory #151).
    // LinkedIn page statistics have no country, so a country view counts the ads only.
    const impMetric = all ? 'ad_impressions' : 'ad_impressions_geo';
    const impNets = ['meta', 'google_ads'].filter((k) => D.has(k, impMetric));
    const liImp = all && D.has('linkedin', 'post_impressions') ? D.sum('linkedin', 'post_impressions', null, from, to) : null;
    const impSrc = all ? 'Meta Ads · Google Ads · LinkedIn page' : 'Meta Ads · Google Ads';
    if (impNets.length || liImp != null) steps.push({ name: 'Impressions', src: impSrc, n: add([...impNets.map((k) => D.sum(k, impMetric, all ? null : inCountry, from, to)), liImp]) });
    else steps.push(all ? { name: 'Impressions', src: impSrc, n: null, note: 'No ad platform has reported' } : split('Impressions', impSrc));
    steps[0].group = all ? 'Ads and LinkedIn page' : 'Ads';
    // 2. Clicks: Meta outbound + Google Ads clicks + clicks on the LinkedIn company page posts (decided
    // 2026-11-17). LinkedIn reports every click on a post, not only clicks to the landing. Never split by country.
    if (!all) steps.push(split('Clicks to the landing', 'Meta outbound · Google Ads clicks · LinkedIn page clicks'));
    else {
      const parts = [];
      if (D.has('meta', 'ad_outbound_clicks')) parts.push(D.sum('meta', 'ad_outbound_clicks', null, from, to));
      if (D.has('google_ads', 'ad_clicks')) parts.push(D.sum('google_ads', 'ad_clicks', null, from, to));
      if (D.has('linkedin', 'post_clicks')) parts.push(D.sum('linkedin', 'post_clicks', null, from, to));
      steps.push({ name: 'Clicks to the landing', src: 'Meta outbound · Google Ads clicks · LinkedIn page clicks', n: parts.length ? add(parts) : null, note: 'No outbound clicks reported' });
    }
    // 3. Landing sessions (GA4, go.think4ever.com only)
    // Bars restart here: impressions are ~100x larger than every on-site step, so one scale would
    // flatten steps 4 to 7.
    const onSite = { group: 'On the site · bars restart at landing sessions', rescale: true, why: 'organic, direct and email land too', over: 'landing sessions come from every source (organic, direct, emails), not only from ad clicks' };
    steps.push(D.has('ga4', 'ga_exec_geo_sessions')
      ? { name: 'Landing sessions', src: 'GA4 · go.think4ever.com', n: D.sum('ga4', 'ga_exec_geo_sessions', all ? null : inCountry, from, to), ...onSite }
      : { name: 'Landing sessions', src: 'GA4 · go.think4ever.com', n: null, note: 'GA4 go-host sessions not synced', ...onSite });
    // 4. Started sign-up (PostHog): people whose first registration_started, account_created or $identify falls in the
    // window, internal excluded. Every account created started, so step 5 is always part of step 4. The landing signs
    // up without a HubSpot form, so HubSpot form submissions are a separate path, under the funnel and in the channel table.
    const notInternal = (r) => r.dim === 'account_type' && r.dim_value !== 'Internal';
    const startsReady = D.covered('posthog', 'signup_start_coverage', from, to);
    if (!all) steps.push(split('Started sign-up', 'PostHog · registration started or account created'));
    else steps.push({ name: 'Started sign-up', src: 'PostHog · registration started or account created · External', n: startsReady ? D.sum('posthog', 'ph_signup_starts', notInternal, from, to) : null,
      withReg: startsReady ? D.sum('posthog', 'ph_signup_starts_reg', notInternal, from, to) : null, note: 'Sign-up coverage unavailable; not zero' });
    // 5. Accounts created (memory #134: External first account_created or $identify, all hosts, internal excluded)
    const covered = D.covered('posthog', 'account_coverage', from, to);
    const accounts = !covered ? null : all
      ? D.sum('posthog', 'ph_accounts', (r) => r.dim === 'account_type' && r.dim_value !== 'Internal', from, to)
      : D.sum('posthog', 'ph_accounts_geo', inCountry, from, to);
    steps.push({ name: 'Accounts created', src: 'PostHog · first account_created or $identify · External', n: accounts, note: 'Account coverage unavailable; not zero',
      why: 'some started before these dates', over: 'an account created in these dates can have started signing up before them' });
    // 6. Logins: unique people (portal accounts) with a signed_in in the window, internal excluded, from the PostHog
    // product usage rows. Shown in place but `aside`: they include accounts created earlier, so they are not part of
    // step 5 and never enter a step % or the weakest step. Projects compare with accounts.
    const loginsAside = { aside: true, em: 'people', bridge: 'Unique people who signed in, including accounts created earlier · not part of the step %' };
    const logins = uniqueLogins(from, to);
    if (!all) steps.push({ ...split('Logins', 'PostHog · signed_in · unique people'), ...loginsAside });
    else steps.push({ name: 'Logins', src: 'PostHog · signed_in · unique people, internal excluded', n: logins, note: 'Product usage not synced yet', ...loginsAside });
    // 7. Projects created (PostHog project_created)
    if (!all) steps.push(split('Projects created', 'PostHog · project_created'));
    else steps.push({ name: 'Projects created', src: 'PostHog · project_created', n: D.has('posthog', 'ph_event') ? D.sum('posthog', 'ph_event', (r) => r.dim_value === 'project_created', from, to) : null, note: 'PostHog events not synced',
      why: 'older accounts build too, some several', over: 'counts every project created in these dates, also by accounts created earlier, and an account can create several' });
    for (const st of steps) {
      const t = STEP_TARGETS[st.name];
      if (t) Object.assign(st, { target: t.pct, targetMax: t.max, targetAtLeast: !!t.atLeast });
    }
    return steps;
  }
  // Unique portal accounts with at least one signed_in day in the window (product usage rows, America/Bogota days).
  function uniqueLogins(from, to) {
    const snaps = (A.S.data && A.S.data.snapshots) || [];
    const head = snaps.filter((x) => x.source === 'posthog' && x.key === 'product_usage' && x.rows && x.rows[0] && x.rows[0].available === true)
      .sort((a, b) => String(b.pulled_at || b._at || '').localeCompare(String(a.pulled_at || a._at || '')))[0];
    if (!head || head.from > from) return null;
    const rows = snaps.filter((x) => x.source === 'posthog' && /^product_usage_\d+$/.test(String(x.key || '')) && x.from === head.from && x.to === head.to).flatMap((x) => x.rows || []);
    return rows.filter((r) => !r.internal && (r.signin_days || []).some((d) => d >= from && d <= to)).length;
  }
  const pageCountry = () => (countryOptions().includes(A.S.overviewCountry) ? A.S.overviewCountry : 'all');
  // Everything the funnel card shows, as data: the assistant reads this, so its findings quote the same
  // window, country, steps, % versus the previous step and tables as the page.
  A.overviewFunnel = () => {
    const U = A.ui, C = A.charts, w = A.overviewWindow(), country = pageCountry();
    const steps = funnelSteps(w.from, w.to, country);
    const weak = C.weakest(steps);
    const prevOf = (i) => (i > 0 && !steps[i].aside ? C.prevStep(steps, i) : -1);
    const all = country === 'all';
    const byChannel = all ? channelSplit(w.from, w.to) : null;
    // The same number of days just before the window, so the assistant can say what moved.
    const days = U.diffDays(w.from, w.to) + 1;
    const prevTo = U.addDays(w.from, -1), prevFrom = U.addDays(w.from, -days);
    const prevSteps = prevTo >= A.LAUNCH ? funnelSteps(prevFrom < A.LAUNCH ? A.LAUNCH : prevFrom, prevTo, country) : [];
    const D = A.D;
    const spendOf = (k, a, b) => (D.has(k, 'ad_spend') ? D.sum(k, 'ad_spend', null, a, b) : null);
    return {
      previous_window: prevSteps.length ? { window: U.win(prevFrom < A.LAUNCH ? A.LAUNCH : prevFrom, prevTo), steps: prevSteps.map((x) => ({ step: x.name, value: x.n == null ? null : Number(x.n) })) } : null,
      spend: all ? [['Meta Ads', 'meta'], ['Google Ads', 'google_ads']].map(([name, k]) => ({ platform: name, spend: spendOf(k, w.from, w.to), previous_spend: prevSteps.length ? spendOf(k, prevFrom, prevTo) : null })).filter((x) => x.spend != null) : [],
      from: w.from, to: w.to, window: U.win(w.from, w.to),
      set_by: w.mode === 'range' ? 'From/To' : `Group by ${A.D.grainName()}`,
      country: all ? 'All countries' : country,
      steps: steps.map((s, i) => {
        const p = prevOf(i), base = p >= 0 ? steps[p] : null;
        return {
          step: s.name, source: s.src, value: s.n == null ? null : Number(s.n), counts: s.aside ? (s.em === 'people' ? 'people' : 'events') : undefined, note: s.n == null ? s.note : undefined,
          with_registration_started: s.withReg != null ? s.withReg : undefined,
          pct_of_previous: base && base.n > 0 && s.n != null ? s.n / base.n : null, previous_step: base ? base.name : undefined,
          above_previous_because: base && base.n != null && s.n != null && s.n > base.n ? s.over : undefined,
          target_pct_of_previous: s.target != null ? s.target : undefined,
          target_max_pct_of_previous: s.targetMax != null ? s.targetMax : undefined,
        };
      }),
      weakest_step: weak > 0 ? { from: steps[C.prevStep(steps, weak)].name, to: steps[weak].name, continue: steps[weak].n / steps[C.prevStep(steps, weak)].n } : null,
      channels: all ? channelRows(w.from, w.to).map((r) => ({ channel: r.name, impressions: r.impressions, clicks: r.clicks, clicks_kind: r.kind, impressions_to_clicks: r.ctr, organic: !!r.organic })) : [],
      forms: all ? formRows(w.from, w.to).map(([form, n]) => ({ form, submissions: n })) : [],
      by_channel: byChannel ? byChannel.rows.map((r) => ({ channel: r.label, group: r.group, builders: r.builders, accounts: r.accounts, forms: r.forms })) : null,
    };
  };
  // Step 1 → 2 per channel, from the same metrics and window as the funnel: the rows add up to steps 1 and 2.
  // LinkedIn is the organic company page (no LinkedIn Ads); its clicks are every click on a post.
  function channelRows(from, to) {
    const D = A.D;
    return [
      { name: 'Meta Ads', imp: ['meta', 'ad_impressions'], clk: ['meta', 'ad_outbound_clicks'], kind: 'outbound clicks' },
      { name: 'Google Ads', imp: ['google_ads', 'ad_impressions'], clk: ['google_ads', 'ad_clicks'], kind: 'clicks' },
      { name: 'LinkedIn · organic page', imp: ['linkedin', 'post_impressions'], clk: ['linkedin', 'post_clicks'], kind: 'content clicks', organic: true },
    ].filter((c) => D.has(c.imp[0], c.imp[1])).map((c) => {
      const imp = D.sum(c.imp[0], c.imp[1], null, from, to);
      const clicks = D.has(c.clk[0], c.clk[1]) ? D.sum(c.clk[0], c.clk[1], null, from, to) : null;
      return { ...c, impressions: imp, clicks, ctr: clicks != null && imp ? clicks / imp : null };
    });
  }
  function channelCtr(from, to) {
    const U = A.ui, rows = channelRows(from, to);
    if (!rows.length) return '';
    const paid = rows.filter((r) => !r.organic);
    const best = Math.max(0, ...paid.map((r) => r.ctr || 0));
    const table = U.table([
      { t: 'Channel', f: (r) => (r.organic ? `${U.esc(r.name)}<br><small class="text-muted">Organic posts · every click on a post, not only clicks to the landing</small>` : U.esc(r.name)) },
      { t: 'Impressions', num: 1, f: (r) => U.fmt(r.impressions) },
      { t: 'Clicks to the landing', num: 1, f: (r) => (r.clicks == null ? '<span class="text-muted">Pending</span>' : `${U.fmt(r.clicks)} <small class="text-muted">${r.kind}</small>`) },
      { t: 'Impressions → clicks', num: 1, f: (r) => (r.ctr == null ? '–' : !r.organic && r.ctr === best && paid.length > 1 && best > 0 ? `<b>${U.pct(r.ctr, 2)}</b>` : U.pct(r.ctr, 2)) },
    ], rows);
    const note = rows.some((r) => r.organic) ? '<p class="card-note">Steps 1 and 2 add up the three rows. LinkedIn is the organic company page: it reports every click on a post, so its clicks can include clicks that do not open the landing.</p>' : '';
    return `<div class="ov-channel-ctr"><h4 class="cf-sub">Impressions → clicks by channel</h4>${table}${note}</div>`;
  }
  // Steps 4 and 5 by channel (public/js/channels.js, the rule of the Early Builders dashboard): forms from the
  // HubSpot first-touch UTMs of each submission, accounts from the PostHog person first-touch UTMs (classified
  // by the connector from the same rows as step 5). Each row counts once, so the columns add up to the steps.
  function channelSplit(from, to) {
    const D = A.D, CH = A.channels;
    const forms = {};
    for (const e of D.forms(from, to)) { const k = CH.classify(CH.formUtm(e)); forms[k] = (forms[k] || 0) + 1; }
    const accountsReady = !!D.covered('posthog', 'account_origin_coverage', from, to);
    const buildersReady = !!D.covered('posthog', 'builders_coverage', from, to);
    const rows = CH.CHANNELS.map((c) => ({
      key: c.key, label: c.label, rule: c.rule, group: c.group, forms: forms[c.key] || 0,
      accounts: accountsReady ? D.sum('posthog', 'ph_accounts_origin', (r) => r.dim === 'origin' && r.dim_value === c.key, from, to) : null,
      builders: buildersReady ? D.sum('posthog', 'ph_builders_origin', (r) => r.dim === 'origin' && r.dim_value === c.key, from, to) : null,
    })).filter((r) => r.group !== 'test' || r.forms || r.accounts || r.builders);
    // Gmail ads is a Google Ads campaign: its spend and clicks in the window, to read the cost per builder.
    const gmailCampaign = (r) => /gmail|early.?builders/i.test(String(r.dim_value || ''));
    const gmail = D.has('google_ads', 'ad_spend') ? { spend: D.sum('google_ads', 'ad_spend', gmailCampaign, from, to), clicks: D.sum('google_ads', 'ad_clicks', gmailCampaign, from, to) } : null;
    const internalBuilders = buildersReady ? D.sum('posthog', 'ph_builders_internal', null, from, to) : null;
    return { rows, accountsReady, buildersReady, gmail, internalBuilders };
  }
  // Form submissions split by HubSpot form, so Developer Network registrations (the Early Builders form)
  // read apart from the landing sign-up form. Same window and test filter as step 4.
  function formRows(from, to) {
    const byForm = {};
    for (const e of A.D.forms(from, to)) {
      const name = String(e.form || 'Form not named').replace(/^T4E\s*[–-]\s*/, '');
      byForm[name] = (byForm[name] || 0) + 1;
    }
    return Object.entries(byForm).sort((a, b) => b[1] - a[1]);
  }
  function channelTable(from, to, steps) {
    const U = A.ui, sp = channelSplit(from, to);
    const sum = (rs, f) => rs.reduce((t, r) => t + (r[f] || 0), 0);
    const group = (key, label) => {
      const rs = sp.rows.filter((r) => r.group === key);
      return { label, forms: sum(rs, 'forms'), builders: sp.buildersReady ? sum(rs, 'builders') : null, accounts: sp.accountsReady ? sum(rs, 'accounts') : null };
    };
    const rows = [group('program', 'Campaigns'), group('general', 'General traffic')];
    const n = (v) => (v == null ? '<span class="kpi-awaiting">Pending</span>' : U.fmt(v));
    const table = U.table([
      { t: '', f: (r) => `<b>${U.esc(r.label)}</b> <small class="text-muted">${U.fmt(r.forms)} form${r.forms === 1 ? '' : 's'}</small>` },
      { t: 'Builders (verified)', num: 1, f: (r) => `<b>${n(r.builders)}</b>` },
      { t: 'Accounts created', num: 1, f: (r) => n(r.accounts) },
    ], rows);
    const internal = sp.internalBuilders ? ` ${U.fmt(sp.internalBuilders)} internal builder${sp.internalBuilders === 1 ? '' : 's'} left out.` : '';
    return `<div class="ov-by-channel"><h4 class="cf-sub">Builders · campaigns vs general traffic</h4>${table}<p class="card-note">Campaigns = the Developer Network program links (Gmail ads, LinkedIn paid, Referrals and HubSpot emails, builder links). Builders = verified accounts, as in Early Builders.${U.esc(internal)}${sp.buildersReady ? '' : ' Pending is not zero.'}</p></div>`;
  }
  // One line per step: where the number comes from and what it counts, so a step larger than the one above reads as expected.
  function howMeasured() {
    const U = A.ui;
    const items = [
      ['Impressions', 'Meta Ads and Google Ads, plus the posts of the LinkedIn company page (organic). Ads are campaign traffic; the LinkedIn page is general.'],
      ['Clicks to the landing', 'Meta outbound clicks, Google Ads clicks and the clicks on the LinkedIn company page posts. LinkedIn reports every click on a post, so its part can include clicks that do not open the landing.'],
      ['Landing sessions', 'GA4 sessions on go.think4ever.com from every source: ads, organic, direct and emails.'],
      ['Started sign-up', 'PostHog, people who typed their email on the landing and asked for the 6-digit code (registration_started), plus people who created the account directly, as one-click sign-up with Google does without that event. Internal excluded. Every account created is part of this step.'],
      ['Accounts created', 'PostHog, the first account_created or $identify of each person, External only: the visitor entered the code, or signed up in one click with Google.'],
      ['Logins', 'PostHog, unique people who signed in at least once in these dates, internal excluded. They include accounts created before these dates, so they are shown for reference and are not part of the step %.'],
      ['Projects created', 'PostHog project_created events in these dates. It can be larger than Accounts created: older accounts create projects too, and one account can create several.'],
    ];
    const targets = Object.entries(STEP_TARGETS).map(([t, x]) => `<div><dt>${U.esc(t)} · target ${U.esc(A.charts.targetLabel(x))}</dt><dd>${U.esc(x.basis)}</dd></div>`).join('');
    return `<details class="collapsible ov-how"><summary>${U.icon('chevron-right', 'fa-solid', 'chev')}How each step is measured</summary><div class="collapsible-body"><dl class="defs">${items.map(([t, d]) => `<div><dt>${U.esc(t)}</dt><dd>${U.esc(d)}</dd></div>`).join('')}</dl><h4 class="cf-sub">Targets per step</h4><dl class="defs">${targets}</dl><p class="card-note">Targets are the % that should continue from the step above. Red is below the target, amber within 20% of it, green on target, grey a step larger than the one above. HubSpot form submissions (the Early Builders program form and other site forms) are not a step: the landing has no HubSpot form. They are listed under the funnel and in the channel table. Each step comes from its own source (ad platforms, GA4, HubSpot, PostHog) and is not the same group of people moving down, so the % between steps is indicative. When a step is larger than the one above, the funnel says why instead of showing more than 100%.</p></div></details>`;
  }
  function funnelCard(from, to) {
    const U = A.ui, C = A.charts, S = A.S;
    const options = countryOptions();
    const country = pageCountry();
    const steps = funnelSteps(from, to, country);
    const weak = C.weakest(steps);
    const st = steps[3];
    const regLine = st && st.n != null && st.withReg != null ? `<p class="card-note">Started sign-up: ${U.fmt(st.n)} people, ${U.fmt(st.withReg)} of them through the landing code (registration_started) and ${U.fmt(st.n - st.withReg)} who created the account directly (one-click sign-up or a direct link).</p>` : '';
    const weakLine = weak > 0
      ? `Biggest leak: ${steps[C.prevStep(steps, weak)].name} → ${steps[weak].name}, ${U.pct(steps[weak].n / steps[C.prevStep(steps, weak)].n, 1)} continue${steps[weak].target != null ? ` against a target of ${C.targetLabel({ pct: steps[weak].target, max: steps[weak].targetMax, atLeast: steps[weak].targetAtLeast })}` : ''}.`
      : 'The biggest leak appears once two consecutive steps have data.';
    const forms = country === 'all' ? formRows(from, to) : [];
    const channels = country === 'all' ? channelCtr(from, to) : '';
    const formTotal = forms.reduce((t, [, n]) => t + n, 0);
    const formLine = forms.length ? `<p class="card-note ov-forms-by-form">HubSpot form submissions: <b>${U.fmt(formTotal)}</b> (${forms.map(([name, n]) => `${U.esc(name)} ${U.fmt(n)}`).join(' · ')}). A separate path, not a funnel step: the landing signs up with the email and a 6-digit code, without a HubSpot form. Early Builders is the Developer Network program form.</p>` : '';
    const byChannel = country === 'all' ? channelTable(from, to, steps) : '';
    const picker = `<label class="field market-select"><span>Country</span><select id="goal-country" aria-label="Select country"><option value="all"${country === 'all' ? ' selected' : ''}>All countries</option>${options.map((name) => `<option value="${U.esc(name)}"${name === country ? ' selected' : ''}>${U.esc(name)}</option>`).join('')}</select></label>`;
    const note = `<p class="card-note">Accounts created is the same number as the 500K goal (External, internal excluded). Open "How each step is measured" for what each number counts. ${country === 'all' ? '' : `${NOT_SPLIT}: clicks, forms, logins and projects; impressions only when the ad platforms store a country split.`}</p>`;
    return U.card({
      cls: 'chart-card', title: 'Funnel · 7 steps',
      sub: `${U.win(from, to)} · ${country === 'all' ? 'All countries' : U.esc(country)} · % versus the previous step`,
      right: picker,
      body: C.funnel(steps, 'Funnel from impressions to projects created', { verdicts: true }) + `<p class="card-note"><b>${U.esc(weakLine)}</b></p>${regLine}${howMeasured()}${channels}${formLine}${byChannel}${note}<button class="btn btn-secondary btn-sm" type="button" data-go="executive">Open the Executive funnel</button>`,
    });
  }

  // ---------- last two complete periods (in-progress bucket excluded)
  // Follows the Group by selector in the top bar, like the 7-step funnel.
  function periodComparison(comparison = A.D.completeBucketComparison()) {
    const U = A.ui, D = A.D;
    const title = `Last complete ${D.grainName()} period vs previous`;
    if (!comparison) return U.section(title, `No comparison yet: available history since launch must contain two fully completed ${D.grainName().toLowerCase()} buckets. Change Group by at the top to compare another period.`, U.card({ title: 'Comparison unavailable', body: U.empty('Not enough completed history', 'The in-progress bucket is excluded from comparisons.') }));
    const cur = comparison.current, prev = comparison.previous;
    const a = D.ga(cur.from, cur.to), b = D.ga(prev.from, prev.to);
    const fields = [
      { label: 'GA4 sessions', source: 'GA4', cur: a && a.sessions, prev: b && b.sessions, format: U.fmt, delta: U.delta },
      { label: 'Engagement rate', source: 'GA4', cur: a && a.rate, prev: b && b.rate, format: U.pct, delta: U.deltaPoints },
      { label: 'HubSpot sessions', source: 'HubSpot', cur: D.has('hubspot', 'sessions') ? D.sessions(cur.from, cur.to) : null, prev: D.has('hubspot', 'sessions') ? D.sessions(prev.from, prev.to) : null, format: U.fmt, delta: U.delta },
      { label: 'CRM contacts', source: 'HubSpot', cur: D.crmTotal(cur.from, cur.to), prev: D.crmTotal(prev.from, prev.to), format: U.fmt, delta: U.delta },
      { label: 'Accounts created (PostHog first account_created or $identify)', source: 'PostHog', cur: D.accounts(cur.from, cur.to), prev: D.accounts(prev.from, prev.to), format: U.fmt, delta: U.delta },
      { label: 'Registration starts', source: 'PostHog', cur: D.registrations(cur.from, cur.to), prev: D.registrations(prev.from, prev.to), format: U.fmt, delta: U.delta },
    ].filter((x) => x.cur != null || x.prev != null);
    const tiles = fields.map((x) => U.kpi({ label: x.label, source: x.source, value: x.format(x.cur), delta: x.delta(x.cur, x.prev), compare: `${prev.label}: ${x.format(x.prev)}` }));
    const body = tiles.length ? U.kpiRow(tiles, tiles.length === 4 ? 4 : 3) : U.empty('No comparable metrics yet', 'The connected sources have no daily facts for these completed buckets.');
    return U.section(title, `${cur.label} vs ${prev.label} · last two complete ${D.grainName().toLowerCase()} buckets since launch · set by Group by at the top; in-progress bucket excluded`, body);
  }

  function render() {
    const U = A.ui, S = A.S;
    // The 7-step funnel uses the Overview window: From -> To when the dates were typed, else the Group by
    // preset ending at To (A.overviewWindow).
    const win = A.overviewWindow();
    const from = win.from, to = win.to;
    const span = from === to ? from : `${from} to ${to}`;
    const links = `<nav class="ov-links" aria-label="Open a detailed view">${[['acquisition', 'Acquisition', 'bullhorn'], ['conversion', 'Conversion', 'filter'], ['product', 'Product usage', 'cubes'], ['executive', 'Executive', 'chart-line']].map(([go, label, icon]) => `<button class="btn btn-ghost btn-sm" type="button" data-go="${go}">${U.icon(icon)} ${U.esc(label)}</button>`).join('')}</nav>`;
    return U.section('Overview', `Monthly sign-up goal for the Month selected at the top (goal from Targets, else the 500K plan) · America/Bogota`, goalCard(), links)
      + U.section('Funnel', `${span} · ${win.mode === 'range' ? 'From/To at the top' : `${A.D.grainName()} (Group by at the top)`} · seven steps from impression to project · pick a country to focus on one market`, funnelCard(from, to))
      + periodComparison()
      + U.section('What matters', 'Evidence-based reading of the selected period.', A.assistant.render());
  }
  function mount(el) {
    A.assistant.mount(el);
    A.bindGoalMonthChart(el);
    const hist = el.querySelector('#ov-history');
    if (hist) hist.addEventListener('toggle', () => { A.S.ovHistoryOpen = hist.open; });
    el.querySelectorAll('[data-ov-scale]').forEach((b) => b.addEventListener('click', () => { A.S.ovPaceFull = b.dataset.ovScale === 'full'; A.render(); }));

    const pick = el.querySelector('#goal-country');
    if (pick) pick.addEventListener('change', () => { A.S.overviewCountry = pick.value; A.render(); });
  }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

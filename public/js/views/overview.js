
'use strict';
/* Overview: the CEO glance. Five KPIs with % change, month goals, channel mix, daily sessions with timeline notes,
   the visit-to-active-account funnel and what the data says. */
(function (A) {
  const TONE = { crit: 'bad', bad: 'bad', warn: 'watch', watch: 'watch', info: 'watch', ok: 'good', good: 'good' };
  function insight(o) {
    const ic = { bad: 'triangle-exclamation', watch: 'eye', good: 'arrow-trend-up' }[o.tone];
    const lb = { bad: 'Critical', watch: 'Watch', good: 'Good' }[o.tone];
    return `<div class="insight"><span class="insight-icon ${o.tone}">${A.ui.icon(ic)}</span><p><span class="tone ${o.tone}">${lb}</span>${o.html}</p></div>`;
  }

  // Where the project stands against the LATAM 500K goal. Measurement only: no deadline and no
  // pace. The count is cumulative since launch whatever period is selected, because the goal is a
  // total, and it is people whose account was created (first identify), counted once each.
  function accountsGoal() {
    const U = A.ui, D = A.D, S = A.S, p = S.data && S.data.goalPlan;
    if (!p) return '';
    const from = A.LAUNCH, to = U.today();
    const total = D.platform(from, to);
    const goal = Number(p.verified_users) || 0;
    const sub = `Since launch · ${U.win(from, to)} · accounts created, counted once per person (first identify in PostHog)`;
    if (total == null) return U.section('LATAM 500K goal', sub, U.card({ title: 'Accounts created', right: U.srcPill('posthog'), body: U.awaiting('posthog', 'Accounts created are counted from PostHog.') }));

    const ratio = goal ? total / goal : 0;
    const markets = Object.entries(p.countries || {}).sort((a, b) => b[1] - a[1]);
    const byCountry = D.accountsCountries(from, to);
    const planned = new Set(markets.map(([name]) => name));
    const rows = markets.map(([name, target]) => {
      const accounts = D.accountsCountry(name, from, to);
      const sessions = D.countryMetric('ga_geo_sessions', name, from, to) || null;
      return { name, target: Number(target) || 0, accounts, sessions, rate: sessions && accounts != null ? accounts / sessions : null };
    });
    const other = Object.entries(byCountry).filter(([name]) => !planned.has(name)).reduce((s2, [, n]) => s2 + n, 0);
    const known = rows.reduce((s2, r) => s2 + (r.accounts || 0), 0) + other;
    const unknown = Math.max(0, total - known);
    const hasSplit = D.has('posthog', 'ph_new_persons_geo') || !!D.snap('posthog', 'countries', from, to);
    const active = rows.filter((r) => r.accounts > 0).length;
    const daysAll = U.days(from, to), dailyAcc = D.byDay('posthog', 'ph_new_persons', from, to, (r) => !S.exInt || r.dim_value !== 'Internal');
    const trend = `<div class="goal-hero-trend"><div class="goal-hero-label">Accounts created per day</div>${A.charts.accountsTrend({ dates: daysAll, daily: daysAll.map((d) => dailyAcc[d] || 0) })}</div>`;
    const bar = (r) => `<div class="goal-bar slim" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, r * 100))}"><i style="width:${Math.min(100, Math.max(0, r * 100)).toFixed(1)}%"></i></div>`;

    const hero = `<div class="goal-hero"><div class="goal-hero-main"><span class="goal-hero-label">Accounts created</span>
      <div class="goal-nums"><span class="goal-hero-actual">${U.fmt(total)}</span><span class="goal-target">of ${U.fmt(goal)}</span></div>
      <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, ratio * 100))}" aria-label="Accounts created toward the goal"><i style="width:${Math.min(100, ratio * 100).toFixed(2)}%"></i></div>
      <div class="goal-meta"><span><b>${U.pct(ratio)}</b> of the goal</span><span>${U.fmt(Math.max(0, goal - total))} remaining</span></div></div>
      <dl class="goal-hero-side"><div><dt>In this period</dt><dd>${U.fmt(D.platform())}</dd></div><div><dt>Markets with accounts</dt><dd>${hasSplit ? `${active} of ${rows.length}` : '–'}</dd></div><div><dt>Form leads</dt><dd>${U.fmt(D.forms(from, to).length)}</dd></div></dl>${trend}</div>`;

    const body = hasSplit ? U.table([
      { t: 'Country', f: (r) => U.esc(r.name) },
      { t: 'Accounts', num: 1, f: (r) => (r.accounts == null ? '–' : `<b>${U.fmt(r.accounts)}</b>`) },
      { t: 'Goal', num: 1, f: (r) => U.fmt(r.target) },
      { t: '% of goal', num: 1, f: (r) => (r.accounts == null ? '–' : `<span class="cty-pct">${U.pct(r.target ? r.accounts / r.target : null)}</span>${bar(r.target ? r.accounts / r.target : 0)}`) },
      { t: 'Sessions (GA4)', num: 1, f: (r) => U.fmt(r.sessions) },
      { t: 'Visit to account', num: 1, f: (r) => U.pct(r.rate) },
    ], [...rows, ...(other ? [{ name: 'Other markets', target: null, accounts: other, sessions: null, rate: null }] : []),
      { name: 'No country on the account', target: null, accounts: unknown, sessions: null, rate: null }])
      : U.empty('No country split yet', 'PostHog has no country for new accounts. Enable GeoIP or send a country property with identify, and each market fills in here.', 'earth-americas');
    const note = '<p class="card-note" style="padding:0 20px 16px">Goal per country is its share of the 500K plan (editable in Targets). Sessions come from GA4 and are traffic, not accounts.</p>';
    return U.section('LATAM 500K goal', sub, `<div class="card goal-hero-card">${hero}</div>`)
      + U.section('Accounts by country', 'Since launch · same count as above, split by the country on the account', U.card({ title: 'How each market is going', sub: hasSplit ? `${U.fmt(known)} of ${U.fmt(total)} accounts have a country` : '', right: U.srcPill('posthog', 'country'), body: body + (hasSplit ? note : '') }));
  }

  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const prev = D.prev();
    const cmp = prev ? `vs previous ${prev.len} days` : 'Since launch · no comparison';
    const days = U.days(S.from, S.to);
    const hasSess = D.has('hubspot', 'sessions');
    const sess = D.sessions(), pSess = prev ? D.sessions(prev.from, prev.to) : null;
    const ga = D.snap('ga4', 'totals'), gt = ga && ga.rows && ga.rows[0];
    const form = D.forms().length, pForm = prev ? D.forms(prev.from, prev.to).length : null;
    const plat = D.platform(), pPlat = prev ? D.platform(prev.from, prev.to) : null;
    const total = plat || 0, pTotal = prev ? (pPlat || 0) : null;
    const rate = sess ? total / sess : null, pRate = prev && pSess ? pTotal / pSess : null;
    const sessDay = D.byDay('hubspot', 'sessions');
    const suDay = D.dailySignups();

    const kpis = U.kpiRow([
      // Accounts created lead the page (first identify in PostHog); form submissions are leads before the account.
      plat != null
        ? U.kpi({ label: 'Accounts Created', source: 'PostHog', value: U.fmt(plat), hero: true, delta: U.delta(plat, pPlat), spark: days.map((d) => suDay[d].platform), compare: `First identify, once per person · ${cmp}` })
        : U.kpi({ label: 'Accounts Created', source: 'PostHog', hero: true, awaiting: 'PostHog' }),
      U.kpi({ label: 'Form Leads', source: 'HubSpot', value: U.fmt(form), delta: U.delta(form, pForm), spark: days.map((d) => suDay[d].form), compare: `Landing form, before the account · ${cmp}` }),
      hasSess && plat != null ? U.kpi({ label: 'Visit-to-Account Rate', source: 'Derived', value: U.pct(rate), delta: U.delta(rate, pRate), spark: days.map((d) => (sessDay[d] ? suDay[d].platform / sessDay[d] : 0)), compare: cmp })
        : U.kpi({ label: 'Visit-to-Account Rate', source: 'Derived', awaiting: hasSess ? 'PostHog' : 'HubSpot' }),
      hasSess ? U.kpi({ label: 'Landing Sessions', source: 'HubSpot', value: U.fmt(sess), delta: U.delta(sess, pSess), spark: days.map((d) => sessDay[d]), compare: cmp })
        : U.kpi({ label: 'Landing Sessions', source: 'HubSpot', awaiting: 'HubSpot' }),
      gt ? U.kpi({ label: 'Unique Visitors', source: 'GA4', value: U.fmt(gt.users), delta: U.delta(null, null), compare: `GA4 window ${U.win(ga.from, ga.to)} · ${U.fmt(gt.new_users)} new` })
        : U.kpi({ label: 'Unique Visitors', source: 'GA4', awaiting: 'GA4' }),
    ], 5);

    // Sign-ups by persona (utm_content p01–p13): whether the launch reaches the audience it was designed for.
    const personas = {};
    for (const e of D.forms()) { const c = String(e.utm_content || '').trim(); if (c) personas[c] = (personas[c] || 0) + 1; }
    const pRows = Object.entries(personas).sort((a, b) => b[1] - a[1]);
    const personaTotal = pRows.reduce((s, r) => s + r[1], 0);
    const personaCard = U.card({
      title: 'Sign-ups by persona', sub: pRows.length ? `External sign-ups carrying a persona code in utm_content · ${U.fmt(personaTotal)} of ${U.fmt(form)}` : 'Every ad piece carries its persona (p01–p13) in utm_content',
      right: U.srcPill('hubspot', 'utm_content'),
      body: pRows.length ? C.hbars(pRows, personaTotal)
        : `${U.empty('No persona-tagged sign-ups yet', 'Sign-ups show here per persona once campaigns with utm_content run, so leadership can see which audience the launch actually reaches.', 'users')}`,
    });

    const goals = A.targets.strip(['total_signups', 'visit_to_signup_rate', 'landing_sessions', 'unique_visitors', 'engagement_rate']);

    const ch = D.channels();
    const mix = U.card({ title: 'Channel mix', sub: `Share of landing sessions · <span class="mono">${U.fmt(sess)} sessions</span>`, right: U.srcPill('hubspot'), body: hasSess ? C.mix(ch) : U.awaiting('hubspot') });

    const notes = ((S.data.notes) || []).filter((n) => n.date >= S.from && n.date <= S.to).sort((a, b) => (a.date < b.date ? -1 : 1));
    const daily = D.dailyChannels();
    const chart = U.card({
      cls: 'chart-card', title: 'Daily sessions by channel', sub: 'Stacked in fixed channel order · numbered markers are timeline notes',
      right: `<button type="button" class="btn btn-secondary btn-sm" data-go="notes">${U.icon('message', 'fa-regular')} Timeline Notes</button>`,
      body: (hasSess ? C.stacked({ dates: days, keys: C.CHANNELS, value: (d, i) => daily[d][i], notes, label: `Daily sessions by channel, ${U.win(S.from, S.to)}` }) : U.awaiting('hubspot'))
        + `<ul class="notes-chips">${notes.length ? notes.map((n, i) => `<li class="note-chip"><span class="note-idx">${i + 1}</span><span class="mono">${U.dshort(n.date)}</span><span class="note-type note-${U.esc(n.kind || 'other')}">${U.esc(n.kind || 'other')}</span><span class="note-txt">${U.esc(n.label)}</span></li>`).join('') : '<li class="text-muted">No timeline notes in this period.</li>'}</ul>`,
    });

    const steps = D.funnel();
    const funnel = U.card({ cls: 'chart-card', title: 'Visit-to-active-account funnel', sub: `7 steps · count, % of step 1 and step-to-step % · internal tests ${S.exInt ? 'excluded' : 'included'}`, right: U.pill('neutral', 'GA4 · HubSpot · PostHog'), body: C.funnel(steps) });

    const items = [];
    const w = C.weakest(steps);
    if (w > 0) items.push({ tone: 'bad', html: `Only <b>${U.pct(steps[w].n / steps[w - 1].n)}</b> of ${U.esc(steps[w - 1].name.toLowerCase())} reach ${U.esc(steps[w].name.toLowerCase())}: the weakest step in the funnel.` });
    if (plat == null) items.push({ tone: 'watch', html: '<b>Accounts created</b> are awaiting PostHog; the landing form only counts leads.' });
    if (hasSess && sess) {
      let top = 0; ch.forEach((v, i) => { if (v > ch[top]) top = i; });
      const pch = prev ? D.channels(prev.from, prev.to)[top] : null;
      items.push({ tone: 'good', html: `${U.esc(C.CHANNELS[top].name)} leads with <b>${U.fmt(ch[top])}</b> sessions (${U.pct(ch[top] / sess)} share)${pch ? `, ${ch[top] >= pch ? 'up' : 'down'} ${U.pct(Math.abs(ch[top] - pch) / pch)} vs previous period.` : '.'}` });
    }
    const internal = D.formsAll().length - D.forms().length;
    if (internal > 0) items.push({ tone: 'watch', html: `<b>${internal}</b> think4ever.com test sign-ups are ${S.exInt ? 'excluded from' : 'included in'} the counts.` });
    const rs = D.snap('research', 'readings');
    if (rs) for (const r of rs.rows || []) items.push({ tone: TONE[r.tone] || 'watch', html: `<b>${U.esc(r.title)}</b> ${U.esc(r.text)}` });
    const order = { bad: 0, watch: 1, good: 2 };
    items.sort((a, b) => order[a.tone] - order[b.tone]);
    const readings = U.card({
      title: 'What the data says', sub: `Computed from the live numbers${rs ? ` and the Research reading · ${U.win(rs.from, rs.to)}` : ''}`,
      body: items.length ? `<div class="insights">${items.slice(0, 3).map(insight).join('')}</div>${items.length > 3 ? `<details class="more"><summary>${U.icon('chevron-right')}More readings <span class="pill pill-neutral">${items.length - 3}</span></summary><div class="insights">${items.slice(3).map(insight).join('')}</div></details>` : ''}`
        : U.empty('No readings yet', 'Readings appear as soon as the sources send data.'),
    });

    return accountsGoal()
      + U.section('Launch at a glance', `Five numbers, accounts first · ${U.win(S.from, S.to)} · ${cmp}`, kpis)
      + goals
      + `<section class="section grid-2-1">${personaCard}${mix}</section>`
      + `<section class="section">${chart}</section>`
      + `<section class="section grid-2-1">${funnel}${readings}</section>`;
  }
  function mount() {}
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

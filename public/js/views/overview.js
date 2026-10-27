
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

  // The plan is intentionally separate from monthly targets. It starts with
  // the 500K verified-user outcome and shows the traffic/media inputs implied
  // by that scenario. Live values retain their source labels and are never
  // fabricated for a country that has not been identified by a source.
  function goalMetric(label, target, actual, note) {
    const U = A.ui;
    return `<div class="plan-metric"><span>${U.esc(label)}</span><b>${U.esc(target)}</b><em>${actual == null ? 'No live value yet' : `Actual ${U.esc(actual)}`}</em><small>${U.esc(note)}</small></div>`;
  }

  function goalPanels() {
    const U = A.ui, D = A.D, S = A.S, p = S.data && S.data.goalPlan;
    if (!p) return '';
    const accounts = D.platform();
    const landing = D.sessions();
    const impressions = D.anyPaid() ? D.paidSum('ad_impressions') : null;
    const spend = D.anyPaid() ? D.paidSum('ad_spend') : null;
    const conversion = landing && accounts != null ? accounts / landing : null;
    const impressionVisit = impressions && landing ? landing / impressions : null;
    const markets = Object.keys(p.countries || {});
    if (!markets.length) return '';
    const country = markets.includes(S.goalCountry) ? S.goalCountry : markets[0];
    const target = Number(p.countries[country]) || 0;
    const geoSessions = D.countryMetric('ga_geo_sessions', country);
    const geoUsers = D.countryMetric('ga_geo_users', country);
    const geoEngaged = D.countryMetric('ga_geo_engaged_sessions', country);
    const snapshot = D.countrySnapshot(country);
    const sessions = geoSessions || (snapshot && Number(snapshot.sessions)) || null;
    const users = geoUsers || (snapshot && Number(snapshot.users)) || null;
    const engagement = sessions && geoEngaged ? geoEngaged / sessions : null;
    const forms = D.forms().filter((e) => e.country === country).length;
    const plannedSessions = target ? Number(p.landing_sessions) * target / Number(p.verified_users) : null;
    const options = markets.map((name) => `<option value="${U.esc(name)}"${name === country ? ' selected' : ''}>${U.esc(name)}</option>`).join('');

    return `<section class="section goal-plan-section"><details class="goal-panel"><summary><span><b>LATAM 500K goal</b><small>Top-down funnel and live progress</small></span><span class="goal-summary">500,000 verified users <i>View plan</i></span></summary><div class="goal-body">
      <p>This is a planning scenario: it starts with 500,000 verified users and derives the required traffic, media and efficiency. It does not replace the monthly targets below.</p>
      <div class="plan-grid">
        ${goalMetric('Verified users', U.fmt(p.verified_users), accounts == null ? null : U.fmt(accounts), 'PostHog new people across active markets.')}
        ${goalMetric('Landing sessions', U.fmt(p.landing_sessions), U.fmt(landing), 'Traffic required at the planned conversion.')}
        ${goalMetric('Visit to verified user', U.pct(p.visit_to_signup), conversion == null ? null : U.pct(conversion), 'Verified users divided by landing sessions.')}
        ${goalMetric('Impression to landing visit', U.pct(p.impression_to_visit), impressionVisit == null ? null : U.pct(impressionVisit), 'Link efficiency, not generic platform CTR.')}
        ${goalMetric('Paid impressions', U.fmt(p.impressions), impressions == null ? null : U.fmt(impressions), 'Reach required for the planned traffic.')}
        ${goalMetric('Paid media budget', U.money(p.paid_budget), spend == null ? null : U.money(spend), `Planned cost per sign-up: ${U.money(p.paid_cps)}.`)}
      </div></div></details>
      <details class="goal-panel"><summary><span><b>Country goal</b><small>${U.esc(country)} within the LATAM plan</small></span><span class="goal-summary">${U.fmt(target)} verified users <i>View country</i></span></summary><div class="goal-body">
        <label class="goal-select">Country <select id="goal-country" aria-label="Country goal">${options}</select></label>
        <p>Country traffic comes from GA4. Verified accounts remain blank until the product or PostHog sends a trusted country code for each account.</p>
        <div class="plan-grid">
          ${goalMetric('Verified-user target', U.fmt(target), null, 'This market’s allocation within the 500K plan.')}
          ${goalMetric('Planned landing sessions', U.fmt(plannedSessions), sessions == null ? null : U.fmt(sessions), 'Actual sessions come from GA4.')}
          ${goalMetric('GA4 users', 'Traffic readout', users == null ? null : U.fmt(users), 'Users observed in this country.')}
          ${goalMetric('GA4 engagement rate', 'Quality readout', engagement == null ? null : U.pct(engagement), 'Engaged sessions divided by sessions.')}
          ${goalMetric('HubSpot form sign-ups', 'Lead readout', U.fmt(forms), 'Contacts with a matching CRM country.')}
          ${goalMetric('Verified accounts by country', 'Identity coverage', null, 'Requires a country code on the verified account.')}
        </div></div></details></section>`;
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
    const total = form + (plat || 0), pTotal = prev ? pForm + (pPlat || 0) : null;
    const rate = sess ? total / sess : null, pRate = prev && pSess ? pTotal / pSess : null;
    const sessDay = D.byDay('hubspot', 'sessions');
    const suDay = D.dailySignups();

    const kpis = U.kpiRow([
      // Sign-ups lead the page: the number leadership asks for first, then the metrics that build it.
      U.kpi({ label: 'Total Sign-ups', source: 'HubSpot + PostHog', value: U.fmt(total), hero: true, delta: U.delta(total, pTotal), spark: days.map((d) => suDay[d].form + suDay[d].platform), compare: `${U.fmt(form)} form + ${plat == null ? 'PostHog pending' : `${U.fmt(plat)} platform`} · ${cmp}` }),
      U.kpi({ label: 'Form Sign-ups', source: 'HubSpot', value: U.fmt(form), delta: U.delta(form, pForm), spark: days.map((d) => suDay[d].form), compare: cmp }),
      plat != null
        ? U.kpi({ label: 'Platform Sign-ups', source: 'PostHog', value: U.fmt(plat), delta: U.delta(plat, pPlat), spark: days.map((d) => suDay[d].platform), compare: cmp })
        : U.kpi({ label: 'Platform Sign-ups', source: 'PostHog', awaiting: 'PostHog' }),
      hasSess ? U.kpi({ label: 'Visit-to-Sign-up Rate', source: 'Derived', value: U.pct(rate), delta: U.delta(rate, pRate), spark: days.map((d) => (sessDay[d] ? (suDay[d].form + suDay[d].platform) / sessDay[d] : 0)), compare: cmp })
        : U.kpi({ label: 'Visit-to-Sign-up Rate', source: 'Derived', awaiting: 'HubSpot' }),
      hasSess ? U.kpi({ label: 'Landing Sessions', source: 'HubSpot', value: U.fmt(sess), delta: U.delta(sess, pSess), spark: days.map((d) => sessDay[d]), compare: cmp })
        : U.kpi({ label: 'Landing Sessions', source: 'HubSpot', awaiting: 'HubSpot' }),
      gt ? U.kpi({ label: 'Unique Visitors', source: 'GA4', value: U.fmt(gt.users), delta: U.delta(null, null), compare: `GA4 window ${U.win(ga.from, ga.to)} · ${U.fmt(gt.new_users)} new` })
        : U.kpi({ label: 'Unique Visitors', source: 'GA4', awaiting: 'GA4' }),
    ], 6);

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

    const goals = A.targets.strip(['total_signups', 'platform_signups', 'visit_to_signup_rate', 'landing_sessions', 'unique_visitors', 'engagement_rate']);

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
    if (plat == null) items.push({ tone: 'watch', html: '<b>Platform sign-ups</b> are awaiting PostHog, so total sign-ups only count the landing form.' });
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

    return goalPanels()
      + U.section('Launch at a glance', `Six numbers, sign-ups first · ${U.win(S.from, S.to)} · ${cmp}`, kpis)
      + goals
      + `<section class="section grid-2-1">${personaCard}${mix}</section>`
      + `<section class="section">${chart}</section>`
      + `<section class="section grid-2-1">${funnel}${readings}</section>`;
  }
  function mount(el) {
    el.addEventListener('change', (e) => {
      if (e.target.id === 'goal-country') { A.S.goalCountry = e.target.value; A.render(); }
    });
  }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);


'use strict';
/* Overview: the CEO glance. Five KPIs with % change, month goals, channel mix, daily sessions with timeline notes,
   and the visit-to-active-account funnel. The right-hand reading is a placeholder until an AI agent explains the data. */
(function (A) {
  // The plan is intentionally separate from monthly targets. It starts with
  // the 500K verified-user outcome and shows the traffic/media inputs implied
  // by that scenario. Live values retain their source labels and are never
  // fabricated for a country that has not been identified by a source.
  // Completion is actual ÷ target. A target of 500 and an actual of 100 is 20% of the goal.
  // Rates use the same ratio: 3.20% against a 4.02% plan is 79.6% of that rate goal.
  function completionOf(actual, target) {
    const U = A.ui;
    if (!U.num(actual) || !U.num(target) || Number(target) === 0) return null;
    return Number(actual) / Number(target);
  }
  function completionLabel(ratio) {
    const p = Math.abs(ratio) * 100;
    const digits = p !== 0 && p < 0.1 ? 3 : p < 10 ? 2 : 1;
    return A.ui.pct(ratio, digits);
  }
  function goalMetric(label, target, actual, note, raw) {
    const U = A.ui;
    const ratio = raw ? completionOf(raw.actual, raw.target) : null;
    const tracked = !!raw;
    const width = ratio == null ? 0 : Math.min(100, Math.max(0, ratio * 100));
    const bar = tracked ? `<span class="plan-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(width)}" aria-label="${U.esc(label)} goal completion"><i style="width:${width.toFixed(1)}%"></i></span>` : '';
    const complete = tracked ? `<strong class="plan-complete">${ratio == null ? '– of goal' : `${completionLabel(ratio)} of goal`}</strong>` : '';
    return `<div class="plan-metric"><span>${U.esc(label)}</span><b>${U.esc(target)}</b><em>${actual == null ? 'No live value yet' : `Actual ${U.esc(actual)}`}</em>${bar}${complete}<small>${U.esc(note)}</small></div>`;
  }

  function goalPanels() {
    const U = A.ui, D = A.D, S = A.S, p = S.data && S.data.goalPlan;
    if (!p) return '';
    const signups = D.signups();
    const landing = D.sessions();
    const impressions = D.anyPaid() ? D.paidSum('ad_impressions') : null;
    const conversion = landing ? signups / landing : null;
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
      <div class="plan-grid plan-grid-4">
        ${goalMetric('Sign-ups', U.fmt(p.verified_users), U.fmt(signups), 'HubSpot form sign-ups plus PostHog platform sign-ups.', { target: p.verified_users, actual: signups })}
        ${goalMetric('Impression to landing visit', U.pct(p.impression_to_visit), impressionVisit == null ? null : U.pct(impressionVisit), 'Link efficiency, not generic platform CTR.', { target: p.impression_to_visit, actual: impressionVisit })}
        ${goalMetric('Landing sessions', U.fmt(p.landing_sessions), U.fmt(landing), 'Traffic required at the planned conversion.', { target: p.landing_sessions, actual: landing })}
        ${goalMetric('Visit to verified user sign-up', U.pct(p.visit_to_signup), conversion == null ? null : U.pct(conversion), 'Sign-ups divided by landing sessions.', { target: p.visit_to_signup, actual: conversion })}
      </div></div></details>
      <details class="goal-panel"><summary><span><b>Country goal</b><small>${U.esc(country)} within the LATAM plan</small></span><span class="goal-summary">${U.fmt(target)} verified users <i>View country</i></span></summary><div class="goal-body">
        <label class="goal-select">Country <select id="goal-country" aria-label="Country goal">${options}</select></label>
        <p>Country traffic comes from GA4. Each percentage is the live count divided by this market’s target.</p>
        <div class="plan-grid">
          ${goalMetric('Verified-user target', U.fmt(target), users == null ? null : U.fmt(users), 'GA4 users observed in this country, against this market’s allocation.', { target, actual: users })}
          ${goalMetric('Planned landing sessions', U.fmt(plannedSessions), sessions == null ? null : U.fmt(sessions), 'Actual sessions come from GA4.', { target: plannedSessions, actual: sessions })}
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
    const g = D.ga(), pg = prev ? D.ga(prev.from, prev.to) : null;
    const siteUser = (r) => r.dim !== 'channel';
    const hasSiteUsers = D.M().some((r) => r.source === 'ga4' && r.metric === 'ga_users' && siteUser(r));
    const gaUsersDay = hasSiteUsers ? D.byDay('ga4', 'ga_users', S.from, S.to, siteUser) : null;
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
      hasSess ? U.kpi({ label: 'Landing Sessions', source: 'HubSpot · todo el sitio', value: U.fmt(sess), delta: U.delta(sess, pSess), spark: days.map((d) => sessDay[d]), compare: cmp })
        : U.kpi({ label: 'Landing Sessions', source: 'HubSpot · todo el sitio', awaiting: 'HubSpot' }),
      !g ? U.kpi({ label: 'Unique Visitors', source: 'GA4', awaiting: 'GA4' })
        : g.users == null ? U.kpi({ label: 'Unique Visitors', source: 'GA4', value: '–', compare: 'Deduped visitors for this range appear after the next GA4 sync' })
          : U.kpi({ label: 'Unique Visitors', source: 'GA4', value: U.fmt(g.users), delta: U.delta(g.users, pg && pg.users), spark: gaUsersDay ? days.map((d) => gaUsersDay[d]) : null, compare: `GA4 total${g.newUsers != null ? ` · ${U.fmt(g.newUsers)} new` : ''} · ${cmp}` }),
    ], 6);

    const goals = A.targets.strip(['total_signups', 'platform_signups', 'visit_to_signup_rate', 'landing_sessions', 'unique_visitors', 'engagement_rate']);

    const ch = D.channels();
    const mix = U.card({ title: 'Channel mix', sub: `Share of landing sessions · <span class="mono">${U.fmt(sess)} sessions</span>`, right: U.srcPill('hubspot', 'todo el sitio'), body: hasSess ? C.mix(ch) : U.awaiting('hubspot') });

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

    const readings = U.card({
      cls: 'agent-placeholder',
      title: 'Coming soon',
      body: U.empty('Coming soon', 'We are integrating an AI agent to explain the Overview of the data.', 'robot'),
    });

    return goalPanels()
      + U.section('Launch at a glance', `Six numbers, sign-ups first · ${U.win(S.from, S.to)} · ${cmp}`, kpis)
      + goals
      + `<section class="section">${mix}</section>`
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

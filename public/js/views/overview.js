'use strict';
(function (A) {
  function planMetric(label, target, actual, note) {
    const U = A.ui, ratio = A.measurement.ratio(actual, target);
    return `<div class="plan-metric"><span>${U.esc(label)}</span><b>${U.fmt(target)}</b><em>${actual == null ? 'Actual pending' : `Actual ${U.fmt(actual)}`}</em>${ratio == null ? '' : `<span class="plan-bar"><i style="width:${Math.min(100, ratio * 100)}%"></i></span><strong>${U.pct(ratio, 3)} of goal</strong>`}<small>${U.esc(note)}</small></div>`;
  }
  function goalPanels() {
    const U = A.ui, D = A.D, S = A.S, p = S.data.goalPlan;
    if (!p) return '';
    const goal = Number(p.verified_users), month = S.to.slice(0, 7), first = `${month}-01`, end = S.to;
    const actual = D.verified(first, end), check = A.measurement.planCheck(p);
    const mismatch = check.issues.length ? `<p class="measurement-note">Plan needs review: ${check.issues.map((x) => `${U.esc(x.label)} saved ${x.key === 'paid_cps' ? U.money(x.saved) : U.pct(x.saved, 3)}, implied by inputs ${x.key === 'paid_cps' ? U.money(x.implied) : U.pct(x.implied, 3)}`).join(' · ')}. Review Targets; saved values have not been changed.</p>` : '';
    let running = 0;
    const days = U.days(first, end), cumulative = days.map((date) => {
      running += D.sum('posthog', 'ph_verified_accounts', (r) => r.dim === 'account_type' && (!S.exInt || r.dim_value === 'External'), date, date);
      return running;
    });
    const hero = U.card({ cls: 'chart-card goal-hero', title: `LATAM ${U.fmt(goal)} verified-account goal`,
      sub: `Monthly · ${U.monthName(month)} · one confirmed verification per product account. CRM contacts and PostHog people are not added to this goal.`,
      right: U.pill(actual == null ? 'neutral' : 'info', actual == null ? 'Verified actual pending' : `${U.fmt(actual)} · ${U.pct(A.measurement.ratio(actual, goal), 3)} of goal`),
      body: (actual == null ? U.empty('Verified registration report is not connected', 'Traffic, CRM contacts and new observed people remain visible below. These are useful signals, not confirmed verified accounts.', 'user-check') : A.charts.goalProgress({ dates: days, values: cumulative, goal, label: 'Verified accounts month to date' })) + mismatch,
    });
    const markets = Object.keys(p.countries || {}), country = markets.includes(S.goalCountry) ? S.goalCountry : markets[0];
    if (!country) return `<section class="section">${hero}</section>`;
    const target = Number(p.countries[country]), share = A.measurement.ratio(target, goal), planned = share == null ? null : share * Number(p.landing_sessions);
    const sessions = D.has('ga4', 'ga_geo_sessions') ? D.countryMetric('ga_geo_sessions', country, first, end) : null;
    const engaged = D.has('ga4', 'ga_geo_engaged_sessions') ? D.countryMetric('ga_geo_engaged_sessions', country, first, end) : null;
    const users = D.countryUsers(country, first, end), verified = D.verified(first, end, country);
    const options = markets.map((name) => `<option${name === country ? ' selected' : ''}>${U.esc(name)}</option>`).join('');
    const panel = `<details class="goal-panel"><summary><span><b>Country goal</b><small>${U.esc(country)} · ${U.monthName(month)}</small></span><span class="goal-summary">${U.fmt(target)} verified accounts <i>View country</i></span></summary><div class="goal-body">
      <label class="goal-select">Country <select id="goal-country" aria-label="Country goal">${options}</select></label>
      <p>Verified-account goals and traffic are separate. Visitors are not registrations. Monthly actuals use ${U.win(first, end)}.</p>
      <div class="plan-grid">
        ${planMetric('Verified-account target', target, verified, 'Actual requires verified product accounts with a trusted country; otherwise pending.')}
        ${planMetric('Planned GA4 site sessions', planned, sessions, 'Traffic requirement implied by this market allocation; GA4 configured hosts.')}
        <div class="plan-metric"><span>Unique visitors · GA4</span><b>${U.fmt(users)}</b><small>${users == null ? 'An exact-window country snapshot is required. Daily user counts are never added.' : 'Deduplicated for the month window; not verified accounts.'}</small></div>
        <div class="plan-metric"><span>Engagement · GA4</span><b>${U.pct(A.measurement.ratio(engaged, sessions))}</b><small>Engaged sessions / GA4 sessions in this country.</small></div>
        <div class="plan-metric"><span>CRM contacts · HubSpot</span><b>${U.fmt(D.crmTotal(first, end) == null ? null : D.forms(first, end).filter((e) => e.country === country).length)}</b><small>Contact creation date and CRM country; separate from product people.</small></div>
      </div>${check.allocationMatches ? '' : `<p class="measurement-note">Country allocations total ${U.fmt(check.countryTotal)} versus ${U.fmt(goal)} globally. Review Targets.</p>`}</div></details>`;
    return `<section class="section goal-plan-section">${hero}${panel}</section>`;
  }
  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S, ga = D.ga();
    const crm = D.crmTotal(), people = D.platform(), verified = D.verified();
    const unknown = D.peopleClassified() ? D.sum('posthog', 'ph_new_persons', (r) => r.dim_value === 'Unknown') : null;
    const kpis = U.kpiRow([
      U.kpi({ label: 'Site sessions', source: 'GA4', value: U.fmt(ga && ga.sessions), compare: 'Configured hosts · may include test traffic' }),
      U.kpi({ label: 'Unique visitors', source: 'GA4', value: U.fmt(ga && ga.users), compare: ga && ga.userWarning ? 'GA4 user counts need review; original values retained' : 'Deduplicated snapshot for this range' }),
      U.kpi({ label: 'Engagement rate', source: 'GA4', value: U.pct(ga && ga.rate), compare: ga ? `${U.fmt(ga.engaged)} engaged / ${U.fmt(ga.sessions)} GA4 sessions` : 'Awaiting GA4' }),
      U.kpi({ label: 'CRM contacts', source: 'HubSpot', value: U.fmt(crm), compare: 'Contact creation date; may overlap product people' }),
      U.kpi({ label: 'New observed people', source: 'PostHog', value: U.fmt(people), compare: people == null ? 'Sync PostHog to classify internal accounts' : `${S.exInt ? 'Known internal accounts excluded' : 'Internal accounts included'} · ${U.fmt(unknown)} unknown identity class · not verified sign-ups` }),
      U.kpi({ label: 'Verified accounts', source: 'Product verification', value: U.fmt(verified), compare: 'Canonical 500K outcome · never contacts + people' }),
    ], 3);
    const coverage = U.card({ title: 'Measurement coverage', sub: 'Independent signals; no impression-to-session conversion is inferred', body: U.table([
      { t: 'Signal', k: 'name' }, { t: 'Value', f: (r) => U.fmt(r.value) }, { t: 'Scope', k: 'note' },
    ], [
      { name: 'HubSpot sessions', value: D.has('hubspot', 'sessions') ? D.sessions() : null, note: 'Whole site; not the denominator for GA4 engagement' },
      { name: 'Paid impressions', value: D.paidTotals().impressions, note: 'Connected ad reports only; missing is not zero' },
      { name: 'LinkedIn organic impressions', value: D.has('linkedin', 'post_impressions') ? D.sum('linkedin', 'post_impressions') : null, note: 'Organic LinkedIn only; not the whole LATAM impression universe' },
      { name: 'Project-start click proxy', value: D.proxy(), note: 'First Action click since launch; tests excluded; not confirmed creation or seven-day activation' },
    ]) });
    const sessionsByBucket = D.rollNum(D.byDay('ga4', 'ga_sessions'));
    const chart = U.card({ cls: 'chart-card', title: `${D.grainName()} GA4 site sessions`, sub: `Grouped by ${D.grainBar()} · ${U.win(S.from, S.to)}`, body: C.stacked({ dates: D.ticks(), keys: [{ name: 'GA4 sessions', color: 'var(--series-a)' }], value: (d) => sessionsByBucket[d] || 0, label: 'GA4 site sessions' }) });
    const stages = U.card({ cls: 'chart-card', title: 'Measurement stages', sub: 'Independent populations; a linked user cohort is required for conversion/drop-off rates', body: C.funnel(D.funnel(), 'Independent measurement stages') });
    return goalPanels() + U.section('Launch at a glance', `${S.from} to ${S.to} · counts for the range; charts grouped ${D.grainName().toLowerCase()}`, kpis)
      + A.targets.strip(['total_signups', 'engagement_rate', 'unique_visitors'])
      + `<section class="section">${coverage}</section><section class="section">${chart}</section><section class="section">${stages}</section>`;
  }
  function mount(el) { el.addEventListener('change', (e) => { if (e.target.id === 'goal-country') { A.S.goalCountry = e.target.value; A.render(); } }); }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

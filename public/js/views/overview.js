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
    const actual = D.registrations(first, end), check = A.measurement.planCheck(p);
    let running = 0;
    const days = U.days(first, end), cumulative = days.map((date) => {
      running += D.sum('posthog', 'ph_signups', D.peopleFilter, date, date);
      return running;
    });
    const monthDays = U.days(first, U.endOfMonth(month)).length;
    const hero = U.card({ cls: 'chart-card goal-hero', title: 'Sign-ups vs planned sign-ups',
      sub: `${U.monthName(month)} · PostHog sign-up: registration_started · plan from Targets`,
      right: U.pill('info', actual == null ? 'Sync PostHog' : `${U.fmt(actual)} sign-ups · ${U.pct(A.measurement.ratio(actual, goal), 3)} of goal`),
      body: A.charts.goalProgress({ dates: days, values: actual == null ? days.map(() => null) : cumulative, goal, planned: days.map((_, i) => goal * (i + 1) / monthDays), unit: 'sign-ups', label: 'Sign-ups vs planned sign-ups' }),
    });
    const markets = Object.keys(p.countries || {}), country = markets.includes(S.goalCountry) ? S.goalCountry : markets[0];
    if (!country) return `<section class="section">${hero}</section>`;
    const target = Number(p.countries[country]), share = A.measurement.ratio(target, goal), planned = share == null ? null : share * Number(p.landing_sessions);
    const sessions = D.has('ga4', 'ga_geo_sessions') ? D.countryMetric('ga_geo_sessions', country, first, end) : null;
    const engaged = D.has('ga4', 'ga_geo_engaged_sessions') ? D.countryMetric('ga_geo_engaged_sessions', country, first, end) : null;
    const users = D.countryUsers(country, first, end), signups = D.registrations(first, end, country);
    const options = markets.map((name) => `<option${name === country ? ' selected' : ''}>${U.esc(name)}</option>`).join('');
    const panel = `<details class="goal-panel"><summary><span><b>Country goal</b><small>${U.esc(country)} · ${U.monthName(month)}</small></span><span class="goal-summary">${U.fmt(target)} sign-ups <i>View country</i></span></summary><div class="goal-body">
      <label class="goal-select">Country <select id="goal-country" aria-label="Country goal">${options}</select></label>
      <p>Sign-up = first registration_started per person. Monthly actuals use ${U.win(first, end)}.</p>
      <div class="plan-grid">
        ${planMetric('Sign-up target', target, signups, 'registration_started · person country from PostHog.')}
        ${planMetric('Planned GA4 site sessions', planned, sessions, 'Traffic requirement implied by this market allocation; GA4 configured hosts.')}
        <div class="plan-metric"><span>Unique visitors · GA4</span><b>${U.fmt(users)}</b><small>${users == null ? 'An exact-window country snapshot is required. Daily user counts are never added.' : 'Deduplicated for the month window; not verified accounts.'}</small></div>
        <div class="plan-metric"><span>Engagement · GA4</span><b>${U.pct(A.measurement.ratio(engaged, sessions))}</b><small>Engaged sessions / GA4 sessions in this country.</small></div>
        <div class="plan-metric"><span>CRM contacts · HubSpot</span><b>${U.fmt(D.crmTotal(first, end) == null ? null : D.forms(first, end).filter((e) => e.country === country).length)}</b><small>Contact creation date and CRM country; separate from product people.</small></div>
      </div>${check.allocationMatches ? '' : `<p class="measurement-note">Country allocations total ${U.fmt(check.countryTotal)} versus ${U.fmt(goal)} globally. Review Targets.</p>`}</div></details>`;
    return `<section class="section goal-plan-section">${hero}${panel}</section>`;
  }
  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S, ga = D.ga();
    const crm = D.crmTotal(), people = D.platform(), signups = D.registrations();
    const activity = D.rollSignups(D.dailySignups());
    const unknown = D.peopleClassified() ? D.sum('posthog', 'ph_new_persons', (r) => r.dim_value === 'Unknown') : null;
    const kpis = U.kpiRow([
      U.kpi({ label: 'Site sessions', source: 'GA4', value: U.fmt(ga && ga.sessions), spark: ga ? D.series(D.byDay('ga4', 'ga_sessions')) : null, compare: 'Configured hosts · may include test traffic' }),
      U.kpi({ label: 'Unique visitors', source: 'GA4', value: U.fmt(ga && ga.users), compare: ga && ga.userWarning ? 'GA4 user counts need review; original values retained' : 'Deduplicated snapshot for this range' }),
      U.kpi({ label: 'Engagement rate', source: 'GA4', value: U.pct(ga && ga.rate), spark: ga ? D.seriesRate(D.byDay('ga4', 'ga_engaged_sessions'), D.byDay('ga4', 'ga_sessions')) : null, compare: ga ? `${U.fmt(ga.engaged)} engaged / ${U.fmt(ga.sessions)} GA4 sessions` : 'Awaiting GA4' }),
      U.kpi({ label: 'CRM contacts', source: 'HubSpot', value: U.fmt(crm), spark: crm == null ? null : D.ticks().map((d) => activity[d].form), compare: 'Contact creation date; may overlap product people' }),
      U.kpi({ label: 'New observed people', source: 'PostHog', value: U.fmt(people), spark: people == null ? null : D.series(D.byDay('posthog', 'ph_new_persons', S.from, S.to, D.peopleFilter)), compare: people == null ? 'Sync PostHog to classify internal accounts' : `${S.exInt ? 'Known internal accounts excluded' : 'Internal accounts included'} · ${U.fmt(unknown)} unknown identity class · not verified sign-ups` }),
      U.kpi({ label: 'Sign-ups', source: 'PostHog', value: U.fmt(signups), spark: signups == null ? null : D.series(D.byDay('posthog', 'ph_signups', S.from, S.to, D.peopleFilter)), compare: 'registration_started · first per person' }),
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
    const hasSessions = D.has('hubspot', 'sessions');
    const mix = U.card({ title: 'Channel mix', sub: `Share of HubSpot whole-site sessions · ${U.fmt(D.sessions())} sessions`, right: U.srcPill('hubspot', 'whole site'), body: hasSessions ? C.mix(D.channels()) : U.awaiting('hubspot') });
    const notes = (S.data.notes || []).filter((n) => n.date >= S.from && n.date <= S.to).sort((a, b) => a.date.localeCompare(b.date));
    const channels = D.rollChannels(D.dailyChannels());
    const channelChart = U.card({ cls: 'chart-card', title: `${D.grainName()} sessions by channel`, sub: `HubSpot whole site · one bar per ${D.grainBar()} · ${U.win(S.from, S.to)} · numbered markers are timeline notes`,
      right: `<button type="button" class="btn btn-secondary btn-sm" data-go="notes">${U.icon('message', 'fa-regular')} Timeline Notes</button>`,
      body: (hasSessions ? C.stacked({ dates: D.ticks(), keys: C.CHANNELS, value: (d, i) => (channels[d] || [])[i] || 0, notes, label: 'HubSpot sessions by channel' }) : U.awaiting('hubspot'))
        + `<ul class="notes-chips">${notes.length ? notes.map((n, i) => `<li class="note-chip"><span class="note-idx">${i + 1}</span><span class="mono">${U.dshort(n.date)}</span><span class="note-txt">${U.esc(n.label)}</span></li>`).join('') : '<li class="text-muted">No timeline notes in this period.</li>'}</ul>`,
    });
    const stages = A.platformFunnels.render();
    const readings = U.card({ cls: 'agent-placeholder', title: 'Coming soon', body: U.empty('Coming soon', 'We are integrating an AI agent to explain the Overview of the data.', 'robot') });
    return goalPanels() + U.section('Launch at a glance', `${S.from} to ${S.to} · counts for the range; charts grouped ${D.grainName().toLowerCase()}`, kpis)
      + A.targets.strip(['total_signups', 'engagement_rate', 'unique_visitors'])
      + `<section class="section">${mix}</section><section class="section">${channelChart}</section><section class="section grid-2-1">${stages}${readings}</section><section class="section">${coverage}</section><section class="section">${chart}</section>`;
  }
  function mount(el) { A.platformFunnels.mount(el); el.addEventListener('change', (e) => { if (e.target.id === 'goal-country') { A.S.goalCountry = e.target.value; A.render(); } }); }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

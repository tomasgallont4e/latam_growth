'use strict';
(function (A) {
  // Where the project stands against the LATAM 500K goal. Measurement only: no deadline and no
  // pace. The count is cumulative since launch whatever period is selected, because the goal is a
  // total, and it is people whose account was created (first identify), counted once each.
  function accountsGoal() {
    const U = A.ui, D = A.D, S = A.S, p = S.data && S.data.goalPlan;
    if (!p) return '';
    // The count runs up to the last synced day, so a sync that ended yesterday still reads as covered.
    const cov = D.snap('posthog', 'account_coverage'), from = A.LAUNCH, to = cov && cov.to < U.today() ? cov.to : U.today();
    const total = D.accounts(from, to);
    const goal = Number(p.verified_users) || 0;
    const sub = `Since launch · ${U.win(from, to)} · accounts created, once per person · first identify in PostHog`;
    if (total == null) return U.section('LATAM 500K goal', sub, U.card({ title: 'Accounts created', right: U.srcPill('posthog'), body: U.awaiting('posthog', 'Accounts created (first identify) are counted from PostHog.') }));

    const ratio = goal ? total / goal : 0;
    const markets = Object.entries(p.countries || {}).sort((a, b) => b[1] - a[1]);
    const byCountry = D.accountsCountries(from, to);
    const geoOk = D.covered('posthog', 'account_coverage', from, to) && D.covered('posthog', 'account_coverage', from, to).country_available === true;
    const planned = new Set(markets.map(([name]) => name));
    const rows = markets.map(([name, target]) => {
      const accounts = geoOk ? D.accounts(from, to, name) : null;
      const sessions = D.has('ga4', 'ga_geo_sessions') ? (D.countryMetric('ga_geo_sessions', name, from, to) || null) : null;
      return { name, target: Number(target) || 0, accounts, sessions, rate: sessions && accounts != null ? accounts / sessions : null };
    });
    const other = Object.entries(byCountry).filter(([name]) => !planned.has(name)).reduce((s2, [, n]) => s2 + n, 0);
    const known = rows.reduce((s2, r) => s2 + (r.accounts || 0), 0) + other;
    const unknown = Math.max(0, total - known);
    const hasSplit = !!geoOk;
    const active = rows.filter((r) => r.accounts > 0).length;
    const bar = (r) => `<div class="goal-bar slim" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, r * 100))}"><i style="width:${Math.min(100, Math.max(0, r * 100)).toFixed(1)}%"></i></div>`;
    const meter = (r, label) => `<div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, r * 100))}" aria-label="${U.esc(label)}"><i style="width:${Math.min(100, Math.max(0, r * 100)).toFixed(4)}%"></i></div>`;
    const daysAll = U.days(from, to), dailyAcc = D.accountsByDay(from, to);
    const trendOf = (daily, target, caption) => `<div class="acct-hero-trend"><div class="acct-hero-label">${U.esc(caption)}</div>${A.charts.goalShare({ dates: daysAll, daily, goal: target, label: caption })}</div>`;
    const trend = trendOf(daysAll.map((d) => dailyAcc[d] || 0), goal, 'Progress toward 500K · share of the goal');
    const geoDaily = (name) => D.accountsByDay(from, to, name);
    const countrySeries = rows.map((r, i) => ({ name: r.name, color: A.charts.COUNTRY_COLORS[i % A.charts.COUNTRY_COLORS.length], byDay: A.charts.runningByMonth(daysAll, geoDaily(r.name)) }));
    const countryChart = hasSplit ? `<div class="card acct-hero-card">${A.charts.stacked({
      dates: daysAll,
      keys: countrySeries,
      value: (d, i) => countrySeries[i].byDay[d] || 0,
      label: 'Accounts created by country',
    })}</div>` : '';

    const hero = `<div class="acct-hero"><div class="acct-hero-main"><span class="acct-hero-label">Accounts created</span>
      <div class="goal-nums"><span class="acct-hero-actual">${U.fmt(total)}</span><span class="goal-target">of ${U.fmt(goal)}</span></div>
      ${meter(ratio, 'Accounts created toward the goal')}
      <div class="goal-meta"><span><b>${A.charts.sharePct(ratio)}</b> of the goal</span><span>${U.fmt(Math.max(0, goal - total))} remaining</span></div></div>
      <dl class="acct-hero-side"><div><dt>In this period</dt><dd>${U.fmt(D.accounts())}</dd></div><div><dt>Markets with accounts</dt><dd>${hasSplit ? `${active} of ${rows.length}` : '–'}</dd></div><div><dt>CRM contacts</dt><dd>${U.fmt((D.crmTotal(from, to) || 0))}</dd></div></dl>${trend}</div>`;

    const body = hasSplit ? U.table([
      { t: 'Country', f: (r) => U.esc(r.name) },
      { t: 'Accounts', num: 1, f: (r) => (r.accounts == null ? '–' : `<b>${U.fmt(r.accounts)}</b>`) },
      { t: 'Goal', num: 1, f: (r) => U.fmt(r.target) },
      { t: '% of goal', num: 1, f: (r) => (r.accounts == null ? '–' : `<span class="cty-pct">${A.charts.sharePct(r.target ? r.accounts / r.target : null)}</span>${bar(r.target ? r.accounts / r.target : 0)}`) },
      { t: 'Sessions (GA4)', num: 1, f: (r) => U.fmt(r.sessions) },
      { t: 'Visit to account', num: 1, f: (r) => U.pct(r.rate) },
    ], [...rows, ...(other ? [{ name: 'Other markets', target: null, accounts: other, sessions: null, rate: null }] : []),
      { name: 'No country on the account', target: null, accounts: unknown, sessions: null, rate: null }])
      : U.empty('No country split yet', 'PostHog has no country for new accounts. Enable GeoIP or send a country property with identify, and each market fills in here.', 'earth-americas');
    const note = '<p class="card-note" style="padding:0 20px 16px">Goal per country is its share of the 500K plan (editable in Targets). Sessions come from GA4 and are traffic, not accounts.</p>';
    return U.section('LATAM 500K goal', sub, `<div class="card acct-hero-card">${hero}</div>`)
      + (countryChart ? U.section('Sign-ups by country', 'Since launch · each column is the month-to-date total, stacked by country · the count starts again at 0 on the 1st', countryChart) : '')
      + U.section('Accounts by country', 'Since launch · same count as above, split by the country on the account', U.card({ title: 'How each market is going', sub: hasSplit ? `${U.fmt(known)} of ${U.fmt(total)} accounts have a country` : '', right: U.srcPill('posthog', 'country'), body: body + (hasSplit ? note : '') }));
  }

  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S, ga = D.ga();
    const crm = D.crmTotal(), people = D.platform();
    const activity = D.rollSignups(D.dailySignups());
    const unknown = D.peopleClassified() ? D.sum('posthog', 'ph_new_persons', (r) => r.dim_value === 'Unknown') : null;
    const kpis = U.kpiRow([
      U.kpi({ label: 'Site sessions', source: 'GA4', value: U.fmt(ga && ga.sessions), spark: ga ? D.series(D.byDay('ga4', 'ga_sessions')) : null, compare: 'Configured hosts · may include test traffic' }),
      U.kpi({ label: 'Unique visitors', source: 'GA4', value: U.fmt(ga && ga.users), compare: ga && ga.userWarning ? 'GA4 user counts need review; original values retained' : 'Deduplicated snapshot for this range' }),
      U.kpi({ label: 'Engagement rate', source: 'GA4', value: U.pct(ga && ga.rate), spark: ga ? D.seriesRate(D.byDay('ga4', 'ga_engaged_sessions'), D.byDay('ga4', 'ga_sessions')) : null, compare: ga ? `${U.fmt(ga.engaged)} engaged / ${U.fmt(ga.sessions)} GA4 sessions` : 'Awaiting GA4' }),
      U.kpi({ label: 'CRM contacts', source: 'HubSpot', value: U.fmt(crm), spark: crm == null ? null : D.ticks().map((d) => activity[d].form), compare: 'Contact creation date; may overlap product people' }),
      U.kpi({ label: 'New observed people', source: 'PostHog', value: U.fmt(people), spark: people == null ? null : D.series(D.byDay('posthog', 'ph_new_persons', S.from, S.to, D.peopleFilter)), compare: people == null ? 'Sync PostHog to classify internal accounts' : `${S.exInt ? 'Known internal accounts excluded' : 'Internal accounts included'} · ${U.fmt(unknown)} unknown identity class · not verified sign-ups` }),
      U.kpi({ label: 'Registrations started', source: 'PostHog', value: U.fmt(D.registrations()), spark: D.registrations() == null ? null : D.series(D.byDay('posthog', 'ph_signups', S.from, S.to, D.peopleFilter)), compare: 'registration_started · funnel step before the account; not added to accounts created' }),
    ], 3);
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
    return accountsGoal() + U.section('Launch at a glance', `${S.from} to ${S.to} · counts for the range; charts grouped ${D.grainName().toLowerCase()}`, kpis)
      + `<section class="section">${mix}</section><section class="section">${channelChart}</section><section class="section grid-2-1">${stages}${readings}</section><section class="section">${chart}</section>`;
  }
  function mount(el) { A.platformFunnels.mount(el); el.addEventListener('change', (e) => { if (e.target.id === 'goal-country') { A.S.goalCountry = e.target.value; A.render(); } }); }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

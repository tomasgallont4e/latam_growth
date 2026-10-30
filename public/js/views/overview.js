'use strict';
(function (A) {
  // Where the project stands against the LATAM 500K goal. Measurement only: no deadline and no
  // pace. The count is cumulative since launch whatever period is selected, because the goal is a
  // total, and it is people whose account was created (first identify), counted once each.
  function accountsGoal() {
    const U = A.ui, D = A.D, S = A.S, p = S.data && S.data.goalPlan;
    if (!p) return '';
    const cov = D.snap('posthog', 'account_coverage'), from = A.LAUNCH, to = cov && cov.to < U.today() ? cov.to : U.today();
    const total = D.accounts(from, to);
    const goal = Number(p.verified_users) || 0;
    const sub = `Since launch · ${U.win(from, to)} · accounts created once per person · first identify in PostHog`;
    if (total == null) return U.section('LATAM 500K goal', sub, U.card({ title: 'Accounts created', right: U.srcPill('posthog'), body: U.awaiting('posthog', 'Accounts created (first identify) are counted from PostHog.') }));

    const ratio = goal ? total / goal : 0;
    const markets = Object.entries(p.countries || {}).sort((a, b) => b[1] - a[1]);
    const byCountry = D.accountsCountries(from, to);
    const coverage = D.covered('posthog', 'account_coverage', from, to);
    const geoOk = coverage && coverage.country_available === true;
    const planned = new Set(markets.map(([name]) => name));
    const other = Object.entries(byCountry).filter(([name]) => !planned.has(name)).reduce((s2, [, n]) => s2 + n, 0);
    const known = Object.values(byCountry).reduce((s2, n) => s2 + n, 0);
    const unknown = Math.max(0, total - known);
    const active = markets.filter(([name]) => (byCountry[name] || 0) > 0).length;
    const bar = (r, label) => `<div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, r * 100))}" aria-label="${U.esc(label)}"><i style="width:${Math.min(100, Math.max(0, r * 100)).toFixed(4)}%"></i></div>`;
    const goalPeriods = D.periods(from, to), dailyAcc = D.accountsByDay(from, to);
    const goalNew = goalPeriods.map((period) => U.days(period.from, period.to).reduce((sum, day) => sum + (Number(dailyAcc[day]) || 0), 0));
    const goalComparison = D.completeBucketComparison(from, to);
    const goalCurrentAccounts = goalComparison ? D.accounts(goalComparison.current.from, goalComparison.current.to) : null;
    const goalPreviousAccounts = goalComparison ? D.accounts(goalComparison.previous.from, goalComparison.previous.to) : null;
    const goalChange = goalComparison ? `<div><dt>Latest complete ${D.grainName()}</dt><dd>${U.fmt(goalCurrentAccounts)} ${U.delta(goalCurrentAccounts, goalPreviousAccounts)} <small>${U.esc(goalComparison.current.label)} vs ${U.esc(goalComparison.previous.label)}</small></dd></div>` : '<div><dt>Period change</dt><dd>Not enough complete history</dd></div>';
    const trend = `<div class="acct-hero-trend"><div class="acct-hero-label">Progress toward 500K · ${D.grainName().toLowerCase()} buckets</div>${A.charts.goalShare({ dates: goalPeriods.map((p) => p.from), labels: goalPeriods.map((p) => p.label), daily: goalNew, goal, label: 'Progress toward 500K goal' })}</div>`;
    const hero = `<div class="acct-hero"><div class="acct-hero-main"><span class="acct-hero-label">Accounts created</span>
      <div class="goal-nums"><span class="acct-hero-actual">${U.fmt(total)}</span><span class="goal-target">of ${U.fmt(goal)}</span></div>
      ${bar(ratio, 'Accounts created toward the goal')}
      <div class="goal-meta"><span><b>${A.charts.sharePct(ratio)}</b> of the goal</span><span>${U.fmt(Math.max(0, goal - total))} remaining</span></div></div>
      <dl class="acct-hero-side"><div><dt>Selected date range</dt><dd>${U.fmt(D.accounts())}</dd></div>${goalChange}<div><dt>Markets with accounts</dt><dd>${geoOk ? `${active} of ${markets.length}` : '–'}</dd></div><div><dt>CRM contacts</dt><dd>${U.fmt(D.crmTotal(from, to) || 0)}</dd></div></dl>${trend}</div>`;

    const countryRows = Object.entries(byCountry).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const countryBars = countryRows.map(([name, value], i) => ({ name, value, color: A.charts.COUNTRY_COLORS[i % A.charts.COUNTRY_COLORS.length], label: U.fmt(value) }));
    const countryPeriodRows = geoOk && goalComparison ? countryRows.map(([country]) => ({
      country,
      current: D.accounts(goalComparison.current.from, goalComparison.current.to, country),
      previous: D.accounts(goalComparison.previous.from, goalComparison.previous.to, country),
    })) : [];
    const countryPeriodTable = countryPeriodRows.length ? `<p class="card-note">New accounts by country · ${D.grainName().toLowerCase()} · latest two complete buckets</p>${U.table([
      { t: 'Country', k: 'country' }, { t: goalComparison.current.label, num: 1, f: (r) => U.fmt(r.current) },
      { t: goalComparison.previous.label, num: 1, f: (r) => U.fmt(r.previous) }, { t: 'Change', f: (r) => U.delta(r.current, r.previous) },
    ], countryPeriodRows)}` : '';
    const countryChart = geoOk ? U.card({ cls: 'chart-card', title: 'Accounts created by market', sub: `Since launch · ${U.fmt(known)} accounts assigned · ranked by accounts created`, body: (countryBars.length ? A.charts.hbars(countryBars, known) : U.empty('No country-attributed accounts in this period')) + countryPeriodTable }) : '';

    const options = [...new Set([...markets.map(([name]) => name), ...Object.keys(byCountry)])];
    const selectedCountry = options.includes(S.goalCountry) ? S.goalCountry : options[0];
    if (selectedCountry) S.goalCountry = selectedCountry;
    const target = Number((p.countries || {})[selectedCountry]) || null;
    const accounts = geoOk ? D.accounts(from, to, selectedCountry) : null;
    const sessions = D.has('ga4', 'ga_geo_sessions') ? D.countryMetric('ga_geo_sessions', selectedCountry, from, to) : null;
    const rate = sessions != null && sessions > 0 && accounts != null ? accounts / sessions * 1000 : null;
    const marketCurrent = geoOk && goalComparison ? D.accounts(goalComparison.current.from, goalComparison.current.to, selectedCountry) : null;
    const marketPrevious = geoOk && goalComparison ? D.accounts(goalComparison.previous.from, goalComparison.previous.to, selectedCountry) : null;
    const marketAccountNote = goalComparison ? `First identify · since launch; ${goalComparison.current.label}: ${U.fmt(marketCurrent)} ${U.delta(marketCurrent, marketPrevious)} vs ${goalComparison.previous.label}` : 'First identify · once per person; since launch';
    const countryPicker = `<label class="field market-select"><span>Country</span><select id="goal-country" aria-label="Select country">${options.map((name) => `<option value="${U.esc(name)}"${name === selectedCountry ? ' selected' : ''}>${U.esc(name)}</option>`).join('')}</select></label>`;
    const marketKpis = U.kpiRow([
      U.kpi({ label: 'Accounts created', source: 'PostHog', value: U.fmt(accounts), compare: marketAccountNote }),
      U.kpi({ label: 'Plan target', source: '500K plan', value: U.fmt(target), compare: 'Country allocation in Targets' }),
      U.kpi({ label: 'Progress vs plan', source: 'PostHog / plan', value: A.charts.sharePct(target && accounts != null ? accounts / target : null), compare: target ? `${U.fmt(accounts)} of ${U.fmt(target)} accounts` : 'No country allocation set' }),
      U.kpi({ label: 'GA4 sessions', source: 'GA4', value: U.fmt(sessions), compare: 'Traffic in the selected period' }),
      U.kpi({ label: 'Accounts per 1,000 sessions', source: 'Directional', value: rate == null ? '–' : U.fmt(rate, 1), compare: 'Not a cohort conversion rate' }),
    ], 5);
    const marketNote = '<p class="card-note">Accounts and sessions are separate source populations, not linked journeys. Use the ratio as a directional market comparison—not as a visit-to-account conversion rate. Unmatched country names appear in the chart above but do not inherit a plan target.</p>';
    const marketCard = geoOk ? U.card({ title: selectedCountry || 'Country metrics', sub: `Since launch · ${U.win(from, to)}`, right: countryPicker, body: marketKpis + marketNote })
      : U.card({ title: 'Country metrics', right: U.srcPill('posthog', 'country'), body: U.empty('No country split yet', 'PostHog has no country for new accounts. Enable GeoIP or send a country property with identify, and each market fills in here.', 'earth-americas') });
    const coverageNote = geoOk ? `<p class="card-note">${U.fmt(known)} of ${U.fmt(total)} accounts have a country · ${U.fmt(unknown)} have no country · ${U.fmt(other)} are outside the plan markets.</p>` : '';
    return U.section('LATAM 500K goal', sub, U.card({ cls: 'acct-hero-card', body: hero }))
      + (countryChart ? U.section('New accounts by country', 'One horizontal bar per identified country · sorted by accounts created', countryChart) : '')
      + U.section('Accounts by country', 'Select a market to focus on its accounts, plan target and traffic context', marketCard + coverageNote);
  }

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
      { label: 'Accounts created', source: 'PostHog', cur: D.accounts(cur.from, cur.to), prev: D.accounts(prev.from, prev.to), format: U.fmt, delta: U.delta },
      { label: 'Registration starts', source: 'PostHog', cur: D.registrations(cur.from, cur.to), prev: D.registrations(prev.from, prev.to), format: U.fmt, delta: U.delta },
    ].filter((x) => x.cur != null || x.prev != null);
    const tiles = fields.map((x) => U.kpi({ label: x.label, source: x.source, value: x.format(x.cur), delta: x.delta(x.cur, x.prev), compare: `${prev.label}: ${x.format(x.prev)}` }));
    const body = tiles.length ? U.kpiRow(tiles, 3) : U.empty('No comparable metrics yet', 'The connected sources have no daily facts for these completed buckets.');
    return U.section(title, `${cur.label} vs ${prev.label} · last two complete ${D.grainName().toLowerCase()} buckets since launch; independent of selected date range; in-progress bucket excluded`, body);
  }

  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S, ga = D.ga();
    const crm = D.crmTotal(), people = D.platform();
    const activity = D.rollSignups(D.dailySignups());
    const unknown = D.peopleClassified() ? D.sum('posthog', 'ph_new_persons', (r) => r.dim_value === 'Unknown') : null;
    const bucketComparison = D.completeBucketComparison();
    const bucketCurrentGA = bucketComparison ? D.ga(bucketComparison.current.from, bucketComparison.current.to) : null;
    const bucketPreviousGA = bucketComparison ? D.ga(bucketComparison.previous.from, bucketComparison.previous.to) : null;
    const bucketDeltaLabel = bucketComparison ? `Latest complete ${D.grainName().toLowerCase()}: ${bucketComparison.current.label} vs ${bucketComparison.previous.label}` : `No two complete ${D.grainName().toLowerCase()} buckets since launch`;
    const countDelta = (current, previous) => bucketComparison ? U.delta(current, previous) : null;
    const currentCRM = bucketComparison ? D.crmTotal(bucketComparison.current.from, bucketComparison.current.to) : null;
    const previousCRM = bucketComparison ? D.crmTotal(bucketComparison.previous.from, bucketComparison.previous.to) : null;
    const currentPeople = bucketComparison ? D.platform(bucketComparison.current.from, bucketComparison.current.to) : null;
    const previousPeople = bucketComparison ? D.platform(bucketComparison.previous.from, bucketComparison.previous.to) : null;
    const currentRegistrations = bucketComparison ? D.registrations(bucketComparison.current.from, bucketComparison.current.to) : null;
    const previousRegistrations = bucketComparison ? D.registrations(bucketComparison.previous.from, bucketComparison.previous.to) : null;
    const kpis = U.kpiRow([
      U.kpi({ label: 'Site sessions', source: 'GA4', value: U.fmt(ga && ga.sessions), delta: countDelta(bucketCurrentGA && bucketCurrentGA.sessions, bucketPreviousGA && bucketPreviousGA.sessions), spark: ga ? D.series(D.byDay('ga4', 'ga_sessions')) : null, compare: `Configured hosts · may include test traffic · ${bucketDeltaLabel}` }),
      U.kpi({ label: 'Unique visitors', source: 'GA4', value: U.fmt(ga && ga.users), delta: countDelta(bucketCurrentGA && bucketCurrentGA.users, bucketPreviousGA && bucketPreviousGA.users), compare: `Deduplicated snapshot for this range; per-bucket change requires exact snapshots · ${bucketDeltaLabel}` }),
      U.kpi({ label: 'Engagement rate', source: 'GA4', value: U.pct(ga && ga.rate), delta: bucketComparison ? U.deltaPoints(bucketCurrentGA && bucketCurrentGA.rate, bucketPreviousGA && bucketPreviousGA.rate) : null, spark: ga ? D.seriesRate(D.byDay('ga4', 'ga_engaged_sessions'), D.byDay('ga4', 'ga_sessions')) : null, compare: `${ga ? `${U.fmt(ga.engaged)} engaged / ${U.fmt(ga.sessions)} range sessions` : 'Awaiting GA4'} · ${bucketDeltaLabel}` }),
      U.kpi({ label: 'CRM contacts', source: 'HubSpot', value: U.fmt(crm), delta: countDelta(currentCRM, previousCRM), spark: crm == null ? null : D.ticks().map((d) => activity[d].form), compare: `Contact creation date; may overlap product people · ${bucketDeltaLabel}` }),
      U.kpi({ label: 'New observed people', source: 'PostHog', value: U.fmt(people), delta: countDelta(currentPeople, previousPeople), spark: people == null ? null : D.series(D.byDay('posthog', 'ph_new_persons', S.from, S.to, D.peopleFilter)), compare: `${people == null ? 'Sync PostHog to classify internal accounts' : `${S.exInt ? 'Known internal accounts excluded' : 'Internal accounts included'} · ${U.fmt(unknown)} unknown identity class · not verified sign-ups`} · ${bucketDeltaLabel}` }),
      U.kpi({ label: 'Registrations started', source: 'PostHog', value: U.fmt(D.registrations()), delta: countDelta(currentRegistrations, previousRegistrations), spark: D.registrations() == null ? null : D.series(D.byDay('posthog', 'ph_signups', S.from, S.to, D.peopleFilter)), compare: `registration_started · funnel step before the account; not added to accounts created · ${bucketDeltaLabel}` }),
    ], 3);
    const sessionsByBucket = D.rollNum(D.byDay('ga4', 'ga_sessions'));
    const chart = U.card({ cls: 'chart-card', title: `${D.grainName()} GA4 site sessions`, sub: `Grouped by ${D.grainBar()} · ${U.win(S.from, S.to)}`, body: C.stacked({ dates: D.ticks(), keys: [{ name: 'GA4 sessions', color: 'var(--series-a)' }], value: (d) => sessionsByBucket[d] || 0, label: 'GA4 site sessions' }) + '<p class="card-note">A GA4 session is a group of interactions with your site or app. By default, it ends after 30 minutes of inactivity; one person can have multiple sessions.</p>' });
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
    const readings = A.assistant.render();
    return accountsGoal() + U.section('Launch at a glance', `${S.from} to ${S.to} · KPI values are range totals; deltas compare the latest two complete ${D.grainName().toLowerCase()} buckets`, kpis)
      + periodComparison(bucketComparison) + `<section class="section">${mix}</section><section class="section">${channelChart}</section><section class="section">${stages}</section><section class="section">${readings}</section><section class="section">${chart}</section>`;
  }
  function mount(el) { A.platformFunnels.mount(el); A.assistant.mount(el); el.addEventListener('change', (e) => { if (e.target.id === 'goal-country') { A.S.goalCountry = e.target.value; A.render(); } }); }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

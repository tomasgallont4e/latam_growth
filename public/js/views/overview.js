'use strict';
(function (A) {
  // Where the project stands against the LATAM 500K goal. Measurement only: no deadline and no
  // pace. The count is cumulative since launch whatever period is selected, because the goal is a
  // total, and it is people whose account was created (first identify), counted once each.
  const UNIT = { day: 'day', week: 'week', biweek: 'two weeks', month: 'month', quarter: 'quarter', year: 'year' };
  // Gain/loss pill for the active temporality: last complete bucket vs the one before it.
  function changeBlock(ch, compact) {
    const U = A.ui;
    if (!ch || !ch.ok) return compact ? '' : `<span class="text-muted">Not enough history yet for a ${U.esc(UNIT[ch ? ch.grain : 'day'])}-over-${U.esc(UNIT[ch ? ch.grain : 'day'])} change</span>`;
    const span = (b) => U.win(b.start, b.end);
    const tip = `${span(ch.last)}: ${U.fmt(ch.cur)} vs ${span(ch.prior)}: ${U.fmt(ch.prev)}`;
    const pill = ch.prev ? U.delta(ch.cur, ch.prev) : (ch.cur ? '<span class="delta delta-up">new</span>' : '<span class="delta delta-neutral">0.0%</span>');
    return `<span class="chg" title="${U.esc(tip)}">${pill}${compact ? '' : `<small>last full ${U.esc(UNIT[ch.grain])} (${U.esc(span(ch.last))}) vs the ${U.esc(UNIT[ch.grain])} before</small>`}</span>`;
  }

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
      return { name, target: Number(target) || 0, accounts, sessions, rate: sessions && accounts != null ? accounts / sessions : null, chg: geoOk ? D.change(D.accountsByDay(from, to, name)) : null };
    });
    const other = Object.entries(byCountry).filter(([name]) => !planned.has(name)).reduce((s2, [, n]) => s2 + n, 0);
    const known = rows.reduce((s2, r) => s2 + (r.accounts || 0), 0) + other;
    const unknown = Math.max(0, total - known);
    const hasSplit = !!geoOk;
    const unmatched = Object.entries(byCountry).filter(([name]) => !planned.has(name)).sort((a, b) => b[1] - a[1]);
    const active = rows.filter((r) => r.accounts > 0).length;
    const bar = (r) => `<div class="goal-bar slim" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, r * 100))}"><i style="width:${Math.min(100, Math.max(0, r * 100)).toFixed(1)}%"></i></div>`;
    const daysAll = U.days(from, to), dailyAcc = D.accountsByDay(from, to);
    const trend = `<div class="acct-hero-trend"><div class="acct-hero-label">Progress toward 500K · share of the goal, axis fixed at 0–100%</div>${A.charts.goalShare({ dates: daysAll, daily: daysAll.map((d) => dailyAcc[d] || 0), goal, label: 'Accounts created as a share of the 500K goal' })}</div>`;
    // One small chart per market, all on the same 0-100% axis, so the markets compare at a glance.
    const geoDaily = (name) => D.accountsByDay(from, to, name);
    const cards = hasSplit ? rows.map((r) => {
      const dd = geoDaily(r.name);
      const share = r.accounts == null || !r.target ? null : r.accounts / r.target;
      return `<div class="goal-card cty-card"><div class="goal-top"><span>${U.esc(r.name)}</span><span class="cty-share">${changeBlock(D.change(D.accountsByDay(from, to, r.name)), true)} ${U.pct(share)}</span></div>
        <div class="goal-nums"><span class="goal-actual">${r.accounts == null ? '–' : U.fmt(r.accounts)}</span><span class="goal-target">of ${U.fmt(r.target)}</span></div>
        ${dd ? A.charts.goalShare({ dates: daysAll, daily: daysAll.map((d) => dd[d] || 0), goal: r.target, mini: true, label: `${r.name} accounts as a share of its goal` }) : bar(share || 0)}</div>`;
    }).join('') : '';

    const hero = `<div class="acct-hero"><div class="acct-hero-main"><span class="acct-hero-label">Accounts created</span>
      <div class="goal-nums"><span class="acct-hero-actual">${U.fmt(total)}</span><span class="goal-target">of ${U.fmt(goal)}</span></div>
      <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, ratio * 100))}" aria-label="Accounts created toward the goal"><i style="width:${Math.min(100, ratio * 100).toFixed(2)}%"></i></div>
      <div class="goal-meta"><span><b>${U.pct(ratio)}</b> of the goal</span><span>${U.fmt(Math.max(0, goal - total))} remaining</span></div></div>
      <dl class="acct-hero-side"><div><dt>Gain / loss · by ${U.esc(UNIT[D.grain()])}</dt><dd class="chg-dd">${changeBlock(D.change(D.accountsByDay(from, to)))}</dd></div><div><dt>In this period</dt><dd>${U.fmt(D.accounts())}</dd></div><div><dt>Markets with accounts</dt><dd>${hasSplit ? `${active} of ${rows.length}` : '–'}</dd></div><div><dt>CRM contacts</dt><dd>${U.fmt((D.crmTotal(from, to) || 0))}</dd></div></dl>${trend}</div>`;

    // ---- Metrics by country: every country-level metric the dashboard has, for the SELECTED range.
    // Each cell comes from the same function Targets uses (A.targets.actual), so the two screens never disagree.
    // null shows as a dash and is never filled in; the availability list below says why.
    const T = A.targets, rf = S.from, rt = S.to;
    const val = (key, name) => T.actual(key, name, rf, rt);
    const mrow = (name, isLatam) => {
      const c = isLatam ? 'LATAM' : name;
      const acc = isLatam ? D.accounts(rf, rt) : (geoOk ? D.accounts(rf, rt, name) : null);
      const sess = val('landing_sessions', c);
      return {
        name: isLatam ? 'LATAM total' : name, latam: !!isLatam,
        sessions: sess, users: val('unique_visitors', c), engagement: val('engagement_rate', c),
        crm: val('crm_contacts', c), reg: isLatam ? D.registrations(rf, rt) : D.registrations(rf, rt, name),
        accounts: acc, per1k: sess && acc != null ? (acc / sess) * 1000 : null,
        chg: isLatam ? D.change(D.accountsByDay(from, to)) : (geoOk ? D.change(D.accountsByDay(from, to, name)) : null),
        spend: val('ad_spend_budget', c), impressions: val('total_impressions', c), clicks: val('clicks', c), ctr: val('ctr', c),
      };
    };
    const mrows = markets.map(([name]) => mrow(name));
    // Other markets and No country only carry accounts: the other sources do not report them.
    const tail = [
      { name: 'Other markets', accounts: other || null }, { name: 'No country on the account', accounts: unknown },
    ].map((r) => ({ ...r, tail: true }));
    const latam = mrow('LATAM', true);
    const dash = '<span class="text-muted">&ndash;</span>';
    const cell = (fn) => (r) => { const v = fn(r); return v == null || v === '' ? dash : v; };
    const cols = [
      { t: 'Country', f: (r) => (r.latam ? `<b>${U.esc(r.name)}</b>` : U.esc(r.name)) },
      { t: 'Accounts', num: 1, f: cell((r) => (r.accounts == null ? null : `<b>${U.fmt(r.accounts)}</b>`)) },
      { t: `Change · ${UNIT[D.grain()]}`, num: 1, f: (r) => (r.chg ? changeBlock(r.chg, true) : '') },
      { t: 'Registrations started', num: 1, f: cell((r) => (r.reg == null ? null : U.fmt(r.reg))) },
      { t: 'CRM contacts', num: 1, f: cell((r) => (r.crm == null ? null : U.fmt(r.crm))) },
      { t: 'Sessions', num: 1, f: cell((r) => (r.sessions == null ? null : U.fmt(r.sessions))) },
      { t: 'Unique visitors', num: 1, f: cell((r) => (r.users == null ? null : U.fmt(r.users))) },
      { t: 'Engagement', num: 1, f: cell((r) => (r.engagement == null ? null : U.pct(r.engagement))) },
      { t: 'Accounts / 1,000 sessions', num: 1, f: cell((r) => (r.per1k == null ? null : U.fmt(r.per1k))) },
      { t: 'Ad spend', num: 1, f: cell((r) => (r.spend == null ? null : U.money(r.spend))) },
      { t: 'Impressions', num: 1, f: cell((r) => (r.impressions == null ? null : U.fmt(r.impressions))) },
      { t: 'Clicks', num: 1, f: cell((r) => (r.clicks == null ? null : U.fmt(r.clicks))) },
      { t: 'CTR', num: 1, f: cell((r) => (r.ctr == null ? null : U.pct(r.ctr))) },
    ];
    const allRows = [...mrows, ...tail, latam];
    const has = (fn) => allRows.some((r) => !r.tail && !r.latam && fn(r) != null);
    const STATUS = [
      ['Accounts created', 'PostHog first identify, country on the person', has((r) => r.accounts), 'No account carries a country yet. Send country with identify.'],
      ['Registrations started', 'PostHog registration_started, country on the person', has((r) => r.reg), 'Registration coverage or country missing in the last sync.'],
      ['CRM contacts', 'HubSpot contact country', has((r) => r.crm), 'No HubSpot contacts with a country in this range.'],
      ['Sessions', 'GA4 geo report', has((r) => r.sessions), 'GA4 country rows not synced yet.'],
      ['Unique visitors', 'GA4 country snapshot, exact range only', has((r) => r.users), 'Needs a GA4 country snapshot for exactly this date range; daily users are never summed.'],
      ['Engagement', 'GA4 engaged sessions divided by sessions', has((r) => r.engagement), 'GA4 country engaged sessions not synced yet.'],
      ['Ad spend, impressions, clicks, CTR', 'Meta and Google Ads country breakdown', has((r) => r.spend), 'No paid country report in this range (ads not running or the report failed). LinkedIn has no country split.'],
      ['Cost per account', 'Ad spend divided by attributed accounts', false, 'Needs each account attributed to a paid country; not available, so it is not estimated.'],
      ['Activation (7 days)', 'PostHog action', false, 'No country split and no cohort link to the sign-up yet.'],
    ];
    const status = U.table([
      { t: 'Metric', f: (r) => U.esc(r[0]) }, { t: 'Source', f: (r) => U.esc(r[1]) },
      { t: 'By country', f: (r) => (r[2] ? U.pill('success', 'Available', true) : U.pill('warning', 'No data', true)) },
      { t: 'Why a cell is empty', f: (r) => (r[2] ? '' : U.esc(r[3])) },
    ], STATUS);
    const note = `<p class="card-note" style="padding:0 20px 16px">Range ${U.win(rf, rt)}. Accounts / 1,000 sessions is a ratio, not a cohort conversion: GA4 sessions and PostHog accounts are not linked person by person.${unmatched.length ? ` Country values that do not match a plan market (counted in Other markets): ${unmatched.slice(0, 8).map(([n, v]) => `${U.esc(n)} (${U.fmt(v)})`).join(', ')}. Plan markets are written in English, e.g. Brazil, Mexico.` : ''}${unknown ? ` ${U.fmt(unknown)} accounts carry no country at all.` : ''}</p>`;
    const metricsCard = U.card({ cls: 'metrics-card', title: 'All metrics by country', sub: `Selected range ${U.win(rf, rt)} · a dash means the source has no value for that country`, right: U.srcPill('posthog', 'country'), body: U.table(cols, allRows, (r) => (r.latam ? 'row-total' : '')) + note });
    const statusCard = U.details('Which country metrics have data', `${STATUS.filter((r) => r[2]).length} of ${STATUS.length} available`, status);
    return U.section('LATAM 500K goal', sub, `<div class="card acct-hero-card">${hero}</div>`)
      + (cards ? U.section('Progress by country', 'Each market against its own goal, same 0-100% axis everywhere, so the gap to the goal reads the same in every card', `<div class="goal-row cty-grid">${cards}</div>`) : '')
      + U.section('Metrics by country', 'Every country-level metric the sources can give, side by side', metricsCard + statusCard);
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
    return accountsGoal() + U.section('Launch at a glance', `${S.from} to ${S.to} · counts for the range; charts grouped ${D.grainName().toLowerCase()}`, kpis)
      + A.targets.strip(['total_signups', 'engagement_rate', 'unique_visitors'])
      + `<section class="section">${mix}</section><section class="section">${channelChart}</section><section class="section grid-2-1">${stages}${readings}</section><section class="section">${coverage}</section><section class="section">${chart}</section>`;
  }
  function mount(el) { A.platformFunnels.mount(el); el.addEventListener('change', (e) => { if (e.target.id === 'goal-country') { A.S.goalCountry = e.target.value; A.render(); } }); }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

'use strict';
/* Acquisition: who signed up and where they came from, then the traffic that brought them.
   Users acquired: PostHog accounts created (non-Internal, the same people as Overview), split by first-touch
   channel, country and source / medium / campaign, with spend per account for the paid platforms.
   Traffic: GA4 sessions, users and engagement by channel, with UTM, entry-page and country detail. */
(function (A) {
  const external = (r) => r.dim === 'account_type' && r.dim_value !== 'Internal';
  // Channel keys of public/js/channels.js onto the dashboard colors.
  const ORIGIN_COLOR = { referral: 'var(--ch-referral)', gmail: 'var(--pf-google)', linkedin: 'var(--pf-linkedin)', influencer: 'var(--ch-organic-social)', other: 'var(--ch-paid-social)', none: 'var(--ch-direct)', test: 'var(--ch-other)' };

  function acquired(U, C, D, S) {
    const CH = A.channels, P = A.paid;
    const grain = D.grainName();
    const ready = !!D.covered('posthog', 'account_coverage', S.from, S.to);
    if (!ready) {
      return U.section('Users acquired', 'Accounts created in the platform · PostHog', U.kpiRow([
        U.kpi({ label: 'Accounts created', source: 'PostHog', awaiting: 'PostHog' }),
        U.kpi({ label: 'With a first-touch UTM', source: 'PostHog', awaiting: 'PostHog' }),
        U.kpi({ label: 'From paid ads', source: 'PostHog · UTM', awaiting: 'PostHog' }),
        U.kpi({ label: 'Spend per paid account', source: 'Ads · PostHog', awaiting: 'PostHog' }),
      ], 4));
    }
    const total = D.sum('posthog', 'ph_accounts', external, S.from, S.to);
    const cmp = D.completeBucketComparison();
    const inBucket = (p) => (p && D.covered('posthog', 'account_coverage', p.from, p.to) ? D.sum('posthog', 'ph_accounts', external, p.from, p.to) : null);
    const cmpLabel = cmp ? `Latest complete ${grain.toLowerCase()}: ${cmp.current.label} vs ${cmp.previous.label}` : `No two complete ${grain.toLowerCase()} buckets since launch`;
    const now = cmp ? inBucket(cmp.current) : null, before = cmp ? inBucket(cmp.previous) : null;

    // First-touch UTMs: attributed = any utm_source, medium or campaign; paid = a paid platform's source and medium.
    const utm = D.accountsByUtm();
    const withUtm = utm ? utm.filter((r) => CH.classify(r) !== 'none') : null;
    const attributed = withUtm ? withUtm.reduce((s, r) => s + r.accounts, 0) : null;
    const paidBy = { meta: 0, google_ads: 0, linkedin: 0 };
    if (utm) for (const r of utm) { const k = P.platform(r.source, r.medium); if (k) paidBy[k] += r.accounts; }
    const paidAccounts = utm ? paidBy.meta + paidBy.google_ads + paidBy.linkedin : null;
    const platforms = C.PLATFORMS.map((p) => ({ ...p, spend: D.paidStats(p.key).spend, accounts: utm ? paidBy[p.key] : null }));
    const spendAll = platforms.some((p) => p.spend != null) ? platforms.reduce((s, p) => s + (p.spend || 0), 0) : null;
    const utmPending = 'Waiting for the next PostHog sync (accounts by first-touch UTM)';

    const kpis = U.kpiRow([
      U.kpi({ label: 'Accounts created', source: 'PostHog', hero: true, value: U.fmt(total), delta: cmp ? U.delta(now, before) : null,
        spark: D.series(D.byDay('posthog', 'ph_accounts', S.from, S.to, external)),
        compare: `Selected-range total · first account_created or $identify per person · internal excluded, same count as Overview · ${cmpLabel}` }),
      utm ? U.kpi({ label: 'With a first-touch UTM', source: 'PostHog', value: U.fmt(attributed), compare: `${U.pct(total ? attributed / total : null)} of ${U.fmt(total)} accounts · the rest arrived with no UTM, so their campaign is unknown` })
        : U.kpi({ label: 'With a first-touch UTM', source: 'PostHog', value: '–', compare: utmPending }),
      utm ? U.kpi({ label: 'From paid ads', source: 'PostHog · UTM', value: U.fmt(paidAccounts), compare: `Meta ${U.fmt(paidBy.meta)} · Google Ads ${U.fmt(paidBy.google_ads)} · LinkedIn ${U.fmt(paidBy.linkedin)} · first-touch UTM with a paid medium` })
        : U.kpi({ label: 'From paid ads', source: 'PostHog · UTM', value: '–', compare: utmPending }),
      spendAll == null ? U.kpi({ label: 'Spend per paid account', source: 'Ads · PostHog', awaiting: 'Ads' })
        : U.kpi({ label: 'Spend per paid account', source: 'Ads · PostHog', value: U.money(P.cost(spendAll, paidAccounts)),
          compare: `${U.money(spendAll)} spend ÷ ${U.fmt(paidAccounts)} accounts with a paid UTM · an upper bound: paid sign-ups without a UTM are not counted` }),
    ], 4);

    const origin = D.accountsByOrigin();
    const originRows = origin ? CH.CHANNELS.map((c) => ({ name: c.label, color: ORIGIN_COLOR[c.key] || 'var(--ch-other)', value: origin[c.key] || 0 }))
      .filter((r) => r.value).sort((a, b) => b.value - a.value) : [];
    const byChannel = U.card({ title: 'Accounts by channel', sub: `${U.fmt(total)} accounts · first-touch UTM · the same split as Overview · ${U.win(S.from, S.to)}`, right: U.srcPill('posthog', 'first touch'),
      body: origin ? C.hbars(originRows, total) + '<p class="card-note">Channels follow the Developer Network links. Meta and any other campaign outside those links count as Other UTM; the campaign table below names them.</p>' : U.empty('Waiting for PostHog', 'Accounts by channel appear after the next PostHog sync.') });

    const geo = {};
    for (const r of D.M()) if (r.source === 'posthog' && r.metric === 'ph_accounts_geo' && r.dim === 'country' && r.date >= S.from && r.date <= S.to) geo[r.dim_value] = (geo[r.dim_value] || 0) + (Number(r.value) || 0);
    const geoRows = Object.entries(geo).sort((a, b) => b[1] - a[1]);
    const assigned = geoRows.reduce((s, [, v]) => s + v, 0);
    const countryBars = geoRows.slice(0, 10).map(([name, value]) => ({ name, color: 'var(--ch-direct)', value }));
    if (total > assigned) countryBars.push({ name: 'No country', color: 'var(--ch-other)', value: total - assigned });
    const byCountry = U.card({ title: 'Accounts by country', sub: `${U.fmt(assigned)} of ${U.fmt(total)} accounts with a country · ${U.win(S.from, S.to)}`, right: U.srcPill('posthog', 'country'),
      body: countryBars.length ? C.hbars(countryBars, total) + '<p class="card-note">Country comes from the first sign-in in the browser. Accounts created only on the server have no country and are shown as No country, never guessed.</p>' : U.empty('No account countries yet') });

    const costTable = U.card({ title: 'Spend per account by paid platform', sub: `${U.win(S.from, S.to)} · accounts whose first-touch UTM names the platform with a paid medium`, body: U.table([
      { t: 'Platform', f: (r) => `<span class="ch-dot" style="--ch:${r.color};margin-right:8px"></span>${U.esc(r.name)}` },
      { t: 'Spend', num: 1, f: (r) => (r.spend == null ? '<span class="text-muted">Not connected</span>' : U.money(r.spend)) },
      { t: 'Accounts (paid UTM)', num: 1, f: (r) => (r.accounts == null ? '–' : U.fmt(r.accounts)) },
      { t: 'Spend per account', num: 1, f: (r) => (r.spend == null || r.accounts == null ? '–' : r.accounts ? U.money(P.cost(r.spend, r.accounts)) : '<span class="text-muted">No accounts yet</span>') },
    ], platforms) + '<p class="card-note">Spend in each ad account\'s reported currency. A paid sign-up that lost its UTM is not counted, so spend per account here is an upper bound.</p>' });

    const campaignRows = (utm || []).filter((r) => CH.classify(r) !== 'none');
    const campaigns = U.card({ title: 'Accounts by campaign', sub: utm ? `${U.fmt(campaignRows.length)} source / medium / campaign rows · first-touch UTM · ${U.win(S.from, S.to)}` : '', right: U.srcPill('posthog', 'first touch'),
      body: !utm ? U.empty('Waiting for PostHog', 'Accounts by campaign appear after the next PostHog sync.') : campaignRows.length ? U.table([
        { t: 'Campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` },
        { t: 'Source / medium', f: (r) => `${U.esc(r.source)} / ${U.esc(r.medium)}` },
        { t: 'Channel', f: (r) => { const k = P.platform(r.source, r.medium); const pf = k && C.PLATFORMS.find((p) => p.key === k); return `${U.esc(CH.label(CH.classify(r)))}${pf ? ` ${U.pill('info', `Paid · ${pf.name}`)}` : ''}`; } },
        { t: 'Accounts', num: 1, f: (r) => U.fmt(r.accounts) },
        { t: 'Share of accounts', num: 1, f: (r) => U.pct(total ? r.accounts / total : null) },
      ], campaignRows.slice(0, 25)) + (campaignRows.length > 25 ? `<p class="card-note">Top 25 of ${U.fmt(campaignRows.length)} rows.</p>` : '') + `<p class="card-note">${U.fmt(total - attributed)} accounts have no first-touch UTM and are not listed.</p>`
        : U.empty('No accounts with a UTM in this period') });

    return U.section('Users acquired', `${U.win(S.from, S.to)} · accounts created in the platform (PostHog), internal excluded · change compares the latest two complete ${grain.toLowerCase()} buckets since launch`, kpis)
      + `<section class="section grid-2">${byChannel}${byCountry}</section>`
      + `<section class="section grid-2">${campaigns}${costTable}</section>`;
  }

  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const grain = D.grainName();
    const ticks = D.ticks(), periods = D.periods();
    const periodIndex = new Map(periods.map((period, index) => [period.key, index]));
    const periodFor = (date) => periods.find((period) => date >= period.from && date <= period.to) || null;
    const g = D.ga();
    const siteUser = (r) => r.dim !== 'channel';
    const hasSiteUsers = D.M().some((r) => r.source === 'ga4' && (r.metric === 'ga_users' || r.metric === 'ga_new_users') && siteUser(r));
    const gaNewDay = hasSiteUsers ? D.byDay('ga4', 'ga_new_users', S.from, S.to, siteUser) : null;
    const gaSessDay = D.byDay('ga4', 'ga_sessions', S.from, S.to, (r) => r.dim === 'channel');
    const gaEngDay = D.byDay('ga4', 'ga_engaged_sessions', S.from, S.to, (r) => r.dim === 'channel');
    const gaChannels = D.gaChannels();
    const channelTotal = g && g.sessions;
    const topChannel = gaChannels[0];
    const bucketComparison = D.completeBucketComparison();
    const bucketNow = bucketComparison ? D.ga(bucketComparison.current.from, bucketComparison.current.to) : null;
    const bucketPrevious = bucketComparison ? D.ga(bucketComparison.previous.from, bucketComparison.previous.to) : null;
    const bucketDeltaLabel = bucketComparison ? `Latest complete ${grain.toLowerCase()}: ${bucketComparison.current.label} vs ${bucketComparison.previous.label}` : `No two complete ${grain.toLowerCase()} buckets since launch`;
    const channelInBucket = (period) => period ? D.gaChannels(period.from, period.to)[0] : null;
    const currentTop = bucketComparison && channelInBucket(bucketComparison.current);
    const previousTop = bucketComparison && channelInBucket(bucketComparison.previous);
    const channelDeltaLabel = bucketComparison ? `Latest complete ${grain}: ${currentTop ? `${U.esc(currentTop.channel)} (${U.fmt(currentTop.sessions)})` : 'no channel data'} · previous ${grain}: ${previousTop ? `${U.esc(previousTop.channel)} (${U.fmt(previousTop.sessions)})` : 'no channel data'}` : bucketDeltaLabel;
    const hasBucketGA = !!(bucketNow || bucketPrevious);
    const countDelta = (metric) => bucketComparison ? U.delta(bucketNow && bucketNow[metric], bucketPrevious && bucketPrevious[metric]) : null;
    const rateDelta = () => bucketComparison ? U.deltaPoints(bucketNow && bucketNow.rate, bucketPrevious && bucketPrevious.rate) : null;
    const missingRangeKpi = (label, delta, note) => hasBucketGA
      ? U.kpi({ label, source: 'GA4', value: '–', delta, compare: `No selected-range value · ${note} · ${bucketDeltaLabel}` })
      : U.kpi({ label, source: 'GA4', awaiting: 'GA4' });

    const kpis = U.kpiRow([
      !g ? missingRangeKpi('GA4 sessions', countDelta('sessions'), 'bucket counts are still shown') : U.kpi({ label: 'GA4 sessions', source: 'GA4', value: U.fmt(g.sessions), delta: countDelta('sessions'), spark: D.series(gaSessDay), compare: `Selected-range total · ${bucketDeltaLabel}` }),
      // Unique visitors are deduplicated over the whole range; GA4 daily uniques cannot be added, so there is no period change.
      !g ? U.kpi({ label: 'Unique visitors', source: 'GA4', awaiting: 'GA4' })
        : U.kpi({ label: 'Unique visitors', source: 'GA4', value: g.users == null ? '–' : U.fmt(g.users), compare: g.users == null ? 'Deduplicated total not available for this range' : 'Deduplicated selected-range total · no period change: daily unique visitors cannot be added' }),
      !g ? missingRangeKpi('New users', countDelta('newUsers'), 'bucket counts are still shown')
        : g.newUsers == null ? U.kpi({ label: 'New users', source: 'GA4', value: '–', delta: countDelta('newUsers'), compare: `New-user total unavailable for this range · ${bucketDeltaLabel}` })
          : U.kpi({ label: 'New users', source: 'GA4', value: U.fmt(g.newUsers), delta: countDelta('newUsers'), spark: gaNewDay ? D.series(gaNewDay) : null, compare: `First visits; selected-range total · ${bucketDeltaLabel}` }),
      !g ? missingRangeKpi('Engagement rate', rateDelta(), 'bucket rates are still shown when both rates exist')
        : !g.sessions ? U.kpi({ label: 'Engagement rate', source: 'GA4', value: '–', delta: rateDelta(), compare: `No selected-range sessions · ${bucketDeltaLabel}` })
          : U.kpi({ label: 'Engagement rate', source: 'GA4', value: U.pct(g.rate), delta: rateDelta(), spark: D.seriesRate(gaEngDay, gaSessDay), compare: `${U.fmt(g.engaged)} engaged of ${U.fmt(g.sessions)} range sessions · ${bucketDeltaLabel}` }),
      topChannel ? U.kpi({ label: 'Top channel', source: 'GA4', value: U.esc(topChannel.channel), small: true, compare: `Selected-range share · ${U.fmt(topChannel.sessions)} sessions · ${U.pct(channelTotal ? topChannel.sessions / channelTotal : null)} of total · ${channelDeltaLabel}` })
        : (currentTop || previousTop) ? U.kpi({ label: 'Top channel', source: 'GA4', value: '–', small: true, compare: `No top channel in selected range · ${channelDeltaLabel}` })
          : U.kpi({ label: 'Top channel', source: 'GA4', awaiting: 'GA4' }),
    ]);
    const goals = A.targets.strip(['landing_sessions', 'unique_visitors', 'engagement_rate']);

    const channelBars = gaChannels.map((r) => ({ name: r.channel, color: C.CHANNELS[C.channelOf(r.channel)].color, value: r.sessions, label: U.fmt(r.sessions) }));
    const perf = U.card({ title: 'GA4 sessions by channel', sub: `${U.fmt(channelTotal)} sessions · session-attributed traffic · ${U.win(S.from, S.to)}`, right: U.srcPill('ga4', 'session channel'), body: channelBars.length ? C.hbars(channelBars, channelTotal) : U.awaiting('ga4') });
    const channelEngagement = U.card({ title: 'Engagement by channel', sub: 'Selected-range channel totals · engaged sessions / sessions; the detail table below is split by time bucket', body: gaChannels.length ? U.table([
      { t: 'Channel', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.channel)].color};margin-right:8px"></span>${U.esc(r.channel)}` },
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engaged sessions', num: 1, f: (r) => U.fmt(r.engaged_sessions) },
      { t: 'Engagement rate', num: 1, f: (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null) },
    ], gaChannels) : U.awaiting('ga4') });
    const channelPeriodRows = periods.flatMap((period) => D.gaChannels(period.from, period.to).map((row) => ({ ...row, periodKey: period.key, period: period.label })))
      .sort((a, b) => periodIndex.get(a.periodKey) - periodIndex.get(b.periodKey) || b.sessions - a.sessions);
    const periodRowsNote = (rows, shown) => rows > shown ? `<p class="card-note" style="padding:0 20px 16px">Showing the latest ${U.fmt(shown)} of ${U.fmt(rows)} period rows; headline totals and charts cover the full selected range.</p>` : '';
    const channelPeriodDetails = U.details('GA4 channel engagement by period', `${grain} · ${U.fmt(channelPeriodRows.length)} channel-period rows`, channelPeriodRows.length ? U.table([
      { t: 'Period', f: (r) => U.esc(r.period) },
      { t: 'Channel', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.channel)].color};margin-right:8px"></span>${U.esc(r.channel)}` },
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engaged sessions', num: 1, f: (r) => U.fmt(r.engaged_sessions) },
      { t: 'Engagement rate', num: 1, f: (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null) },
    ], channelPeriodRows.slice(-300)) + periodRowsNote(channelPeriodRows.length, 300) : U.awaiting('ga4'));
    const rawDaily = Object.fromEntries(U.days(S.from, S.to).map((d) => [d, Array(8).fill(0)]));
    for (const r of D.M()) if (r.source === 'ga4' && r.metric === 'ga_sessions' && r.dim === 'channel' && rawDaily[r.date]) rawDaily[r.date][C.channelOf(r.dim_value)] += Number(r.value) || 0;
    const daily = D.rollChannels(rawDaily);
    const chart = U.card({ cls: 'chart-card', title: `${grain} GA4 sessions by channel`, sub: `One bar per ${D.grainBar()} · ${U.win(S.from, S.to)}`, body: C.stacked({ dates: ticks, keys: C.CHANNELS, value: (d, i) => (daily[d] || [])[i] || 0, label: `${grain} GA4 sessions by channel` })
      + '<p class="card-note">GA4 attributes sessions to the channel that started each session. This report does not contain new users by first-user channel, so that attribution is not inferred.</p>' });

    // Collapsed detail tables
    const utmSnap = D.snap('ga4', 'utm_attribution'), utmRows = D.utmRows(), utmCov = D.utmCoverage();
    const F = ['sessions', 'engaged_sessions', 'users', 'key_events'];
    const bySessions = (a, b) => b.sessions - a.sessions;
    const byPeriod = (a, b) => periodIndex.get(a.periodKey) - periodIndex.get(b.periodKey) || bySessions(a, b);
    const latestPeriodRows = (rows, limit) => rows.slice().sort((a, b) => periodIndex.get(b.periodKey) - periodIndex.get(a.periodKey) || bySessions(a, b)).slice(0, limit).sort(byPeriod);
    const utmDated = utmRows.map((row) => { const period = periodFor(row.date); return period ? { ...row, periodKey: period.key, period: period.label } : null; }).filter(Boolean);
    const utm = D.group(utmDated, (r) => [r.periodKey, r.campaign, r.source, r.medium, r.content].join('\u0001'), F)
      .map((r) => { const [periodKey, campaign, source, medium, content] = r.key.split('\u0001'); const period = periods.find((p) => p.key === periodKey); return { ...r, periodKey, period: period ? period.label : '', campaign, source, medium, content }; }).sort(byPeriod);
    const pages = D.group(utmDated, (r) => [r.periodKey, D.path(r.landing_page)].join('\u0001'), F)
      .map((r) => { const [periodKey, page] = r.key.split('\u0001'); const period = periods.find((p) => p.key === periodKey); return { ...r, periodKey, period: period ? period.label : '', page }; }).sort(byPeriod);
    const utmVisible = latestPeriodRows(utm, 100), pageVisible = latestPeriodRows(pages, 100);
    const rateOf = (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null);
    const sumCols = [
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engagement', num: 1, f: rateOf },
      { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
    ];
    const utmCoverageNote = utmSnap && !(utmSnap.from <= S.from && utmSnap.to >= S.to) ? ' Stored snapshot coverage does not span the full selected range, so some buckets may be partial.' : '';
    // Older loads have no coverage row and were cut at one GA4 page of 1,000 rows.
    const utmCut = utmCov ? utmCov.truncated : utmSnap && (utmSnap.rows || []).length >= 1000;
    const utmNote = `<p class="card-note" style="padding:0 20px 16px">(not set) means the visit arrived without that UTM value. Every ad, post and email should carry utm_source, utm_medium, utm_campaign and utm_content (starting with the persona code pNN).${utmCut ? ' The GA4 report reached its row limit, so the oldest detail may be missing.' : ''}${utmCoverageNote}${utm.length > 100 ? ` Showing the latest 100 of ${U.fmt(utm.length)} campaign-period rows.` : ''}</p>`;
    const crow = periods.flatMap((period) => {
      const countries = {};
      for (const row of D.gaCountries(period.from, period.to)) countries[row.country] = { ...row, periodKey: period.key, period: period.label };
      for (const event of D.forms(period.from, period.to)) if (event.country) {
        countries[event.country] = countries[event.country] || { country: event.country, periodKey: period.key, period: period.label };
        countries[event.country].forms = (countries[event.country].forms || 0) + 1;
      }
      return Object.values(countries);
    }).sort((a, b) => periodIndex.get(a.periodKey) - periodIndex.get(b.periodKey) || (b.sessions || 0) - (a.sessions || 0) || (b.forms || 0) - (a.forms || 0));
    const details = `<div class="detail-group">
      ${channelPeriodDetails}
      ${U.details('UTM campaigns by period (GA4)', utmSnap ? `${U.fmt(utm.length)} campaign-period rows · ${grain} · snapshot ${U.win(utmSnap.from, utmSnap.to)}` : '', utmSnap ? (utm.length ? U.table([
        { t: 'Period', f: (r) => U.esc(r.period) }, { t: 'Campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` },
        { t: 'Source / medium', f: (r) => `${U.esc(r.source)} / ${U.esc(r.medium)}` },
        { t: 'Piece (utm_content)', f: (r) => { const p = D.persona(r.content); return `<code>${U.esc(r.content)}</code>${p ? ` ${U.pill('info', p)}` : ''}`; } },
        ...sumCols,
      ], utmVisible) + utmNote : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Entry pages by period (GA4)', utmSnap ? `${U.fmt(pages.length)} page-period rows · ${grain}` : '', utmSnap ? (pages.length ? U.table([{ t: 'Period', f: (r) => U.esc(r.period) }, { t: 'Page', f: (r) => `<code>${U.esc(r.page)}</code>` }, ...sumCols], pageVisible) + periodRowsNote(pages.length, 100) : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Countries by period (GA4)', crow.length ? `${U.fmt(crow.length)} country-period rows · ${grain}` : '', crow.length ? U.table([
        { t: 'Period', f: (r) => U.esc(r.period) }, { t: 'Country', k: 'country' }, { t: 'Sessions (GA4)', num: 1, f: (r) => U.fmt(r.sessions) },
        { t: 'Engagement', num: 1, f: rateOf }, { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
        { t: 'Form sign-ups (HubSpot)', num: 1, f: (r) => U.fmt(r.forms || 0) },
      ], crow.slice(-300)) + periodRowsNote(crow.length, 300) : U.empty('No country data yet', 'GA4 country rows and HubSpot form sign-ups by country appear here once loaded.'))}
    </div>`;

    return acquired(U, C, D, S)
      + U.section('Traffic to the sites', `${U.win(S.from, S.to)} · GA4 on the landing, portal and main site · KPI values are selected-range totals; changes compare the latest two complete ${grain.toLowerCase()} buckets since launch`, kpis)
      + goals
      + `<section class="section grid-2">${perf}${channelEngagement}</section>`
      + `<section class="section">${chart}</section>`
      + U.section('Details', `Period detail uses ${grain.toLowerCase()} buckets; GA4 unique users are never summed across days`, details);
  }
  A.views.acquisition = { title: 'Acquisition', render };
})(window.App);

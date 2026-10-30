'use strict';
/* Acquisition: where visits come from. KPIs, goals, channel performance with % share and change, daily stack, details. */
(function (A) {
  function periodComparison(U, D) {
    const comparison = D.completeBucketComparison(), title = `Last complete ${D.grainName()} period vs previous`;
    if (!comparison) return U.section(title, `No comparison yet: available history since launch must contain two fully completed ${D.grainName().toLowerCase()} buckets.`, U.empty('Not enough completed history', 'The current in-progress bucket is excluded.'));
    const a = D.ga(comparison.current.from, comparison.current.to), b = D.ga(comparison.previous.from, comparison.previous.to);
    const fields = [
      { label: 'GA4 sessions', cur: a && a.sessions, prev: b && b.sessions, format: U.fmt, delta: U.delta },
      { label: 'New users', cur: a && a.newUsers, prev: b && b.newUsers, format: U.fmt, delta: U.delta },
      { label: 'Unique visitors', cur: a && a.users, prev: b && b.users, format: U.fmt, delta: U.delta },
      { label: 'Engagement rate', cur: a && a.rate, prev: b && b.rate, format: U.pct, delta: U.deltaPoints },
    ].filter((x) => x.cur != null || x.prev != null);
    const tiles = fields.map((x) => U.kpi({ label: x.label, source: 'GA4', value: x.format(x.cur), delta: x.delta(x.cur, x.prev), compare: `${comparison.previous.label}: ${x.format(x.prev)}` }));
    const body = tiles.length ? U.kpiRow(tiles, 4) : U.empty('No comparable GA4 metrics', 'GA4 has no daily values for these completed buckets. Unique visitors are shown only when deduplicated bucket snapshots exist.');
    return U.section(title, `${comparison.current.label} vs ${comparison.previous.label} · last two complete ${D.grainName().toLowerCase()} buckets since launch; independent of selected date range; partial bucket excluded`, body);
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
    const gaUsersDay = hasSiteUsers ? D.byDay('ga4', 'ga_users', S.from, S.to, siteUser) : null;
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
      !g ? missingRangeKpi('GA4 sessions', countDelta('sessions'), 'bucket counts are still shown') : U.kpi({ label: 'GA4 sessions', source: 'GA4', value: U.fmt(g.sessions), delta: countDelta('sessions'), compare: `Selected-range total · ${bucketDeltaLabel}` }),
      !g ? missingRangeKpi('Unique visitors', countDelta('users'), 'unique-user deltas require exact snapshots for both buckets')
        : g.users == null ? U.kpi({ label: 'Unique visitors', source: 'GA4', value: '–', delta: countDelta('users'), compare: `Deduplicated visitor total unavailable for this range; per-bucket delta needs exact snapshots · ${bucketDeltaLabel}` })
          : U.kpi({ label: 'Unique visitors', source: 'GA4', value: U.fmt(g.users), delta: countDelta('users'), spark: gaUsersDay && D.grain() === 'day' ? U.days(S.from, S.to).map((d) => gaUsersDay[d]) : null, compare: `Deduplicated selected-range total; daily uniques are not summed · per-bucket change requires exact snapshots · ${bucketDeltaLabel}` }),
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
    const srcRows = periods.flatMap((period) => {
      const total = D.sessions(period.from, period.to);
      return D.byDim('hubspot', 'sessions', period.from, period.to).map(([k, s]) => {
        const match = (r) => (r.dim_value || 'Total') === k;
        return { periodKey: period.key, period: period.label, k, s, total, pv: D.sum('hubspot', 'pageviews', match, period.from, period.to), b: D.sum('hubspot', 'bounces', match, period.from, period.to), c: D.sum('hubspot', 'contacts', match, period.from, period.to) };
      });
    }).sort((a, b) => periodIndex.get(a.periodKey) - periodIndex.get(b.periodKey) || b.s - a.s);
    const utmSnap = D.snap('ga4', 'utm_attribution'), utmRows = D.utmRows();
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
    const utmNote = `<p class="card-note" style="padding:0 20px 16px">(not set) means the visit arrived without that UTM value. Every ad, post and email should carry utm_source, utm_medium, utm_campaign and utm_content (starting with the persona code pNN).${utmSnap && (utmSnap.rows || []).length >= 1000 ? ' The GA4 report is capped at 1,000 rows, so older detail may be missing.' : ''}${utmCoverageNote}${utm.length > 100 ? ` Showing the latest 100 of ${U.fmt(utm.length)} campaign-period rows.` : ''}</p>`;
    const crow = periods.flatMap((period) => {
      const countries = {};
      for (const row of D.gaCountries(period.from, period.to)) countries[row.country] = { ...row, users: D.countryUsers(row.country, period.from, period.to), periodKey: period.key, period: period.label };
      for (const event of D.forms(period.from, period.to)) if (event.country) {
        countries[event.country] = countries[event.country] || { country: event.country, periodKey: period.key, period: period.label };
        countries[event.country].forms = (countries[event.country].forms || 0) + 1;
      }
      return Object.values(countries);
    }).sort((a, b) => periodIndex.get(a.periodKey) - periodIndex.get(b.periodKey) || (b.sessions || 0) - (a.sessions || 0) || (b.forms || 0) - (a.forms || 0));
    const countryUserNote = '<p class="card-note" style="padding:0 20px 16px">GA4 users are deduplicated only when a snapshot exactly matches the bucket; daily unique-user counts are not summed.</p>';
    const details = `<div class="detail-group">
      ${channelPeriodDetails}
      ${U.details('HubSpot sessions by source and period', `${U.fmt(srcRows.length)} source-period rows · ${grain}`, srcRows.length ? U.table([
        { t: 'Period', f: (r) => U.esc(r.period) },
        { t: 'Source', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.k)].color};margin-right:8px"></span>${U.esc(r.k)}` },
        { t: 'Sessions', num: 1, f: (r) => U.fmt(r.s) }, { t: 'Share in period', num: 1, f: (r) => U.pct(r.total ? r.s / r.total : null) },
        { t: 'Page views', num: 1, f: (r) => U.fmt(r.pv) }, { t: 'Bounce rate', num: 1, f: (r) => U.pct(r.s ? r.b / r.s : null) }, { t: 'Contacts', num: 1, f: (r) => U.fmt(r.c) },
      ], srcRows.slice(-300)) + periodRowsNote(srcRows.length, 300) : U.awaiting('hubspot'))}
      ${U.details('UTM campaigns by period (GA4)', utmSnap ? `${U.fmt(utm.length)} campaign-period rows · ${grain} · snapshot ${U.win(utmSnap.from, utmSnap.to)}` : '', utmSnap ? (utm.length ? U.table([
        { t: 'Period', f: (r) => U.esc(r.period) }, { t: 'Campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` },
        { t: 'Source / medium', f: (r) => `${U.esc(r.source)} / ${U.esc(r.medium)}` },
        { t: 'Piece (utm_content)', f: (r) => { const p = D.persona(r.content); return `<code>${U.esc(r.content)}</code>${p ? ` ${U.pill('info', p)}` : ''}`; } },
        ...sumCols,
      ], utmVisible) + utmNote : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Entry pages by period (GA4)', utmSnap ? `${U.fmt(pages.length)} page-period rows · ${grain}` : '', utmSnap ? (pages.length ? U.table([{ t: 'Period', f: (r) => U.esc(r.period) }, { t: 'Page', f: (r) => `<code>${U.esc(r.page)}</code>` }, ...sumCols], pageVisible) + periodRowsNote(pages.length, 100) : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Countries by period (GA4)', crow.length ? `${U.fmt(crow.length)} country-period rows · ${grain}` : '', crow.length ? U.table([
        { t: 'Period', f: (r) => U.esc(r.period) }, { t: 'Country', k: 'country' }, { t: 'Sessions (GA4)', num: 1, f: (r) => U.fmt(r.sessions) },
        { t: 'Users (GA4)', num: 1, f: (r) => U.fmt(r.users) },
        { t: 'Engagement', num: 1, f: rateOf }, { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
        { t: 'CRM contacts (HubSpot)', num: 1, f: (r) => U.fmt(r.forms || 0) },
      ], crow.slice(-300)) + countryUserNote + periodRowsNote(crow.length, 300) : U.empty('No country data yet', 'GA4 country rows and HubSpot contacts by country appear here once loaded.'))}
    </div>`;

    return U.section('Acquisition at a glance', `${U.win(S.from, S.to)} · KPI values are selected-range totals; deltas compare the latest two complete ${grain.toLowerCase()} buckets since launch`, kpis)
      + periodComparison(U, D) + goals
      + `<section class="section grid-2">${perf}${channelEngagement}</section>`
      + `<section class="section">${chart}</section>`
      + U.section('Details', `Period detail uses ${grain.toLowerCase()} buckets; GA4 unique users are never summed across days`, details);
  }
  A.views.acquisition = { title: 'Acquisition', render };
})(window.App);

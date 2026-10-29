'use strict';
/* Acquisition: where visits come from. KPIs, goals, channel performance with % share and change, daily stack, details. */
(function (A) {
  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const prev = D.prev();
    const cmp = D.versus();
    const grain = D.grainName();
    const ticks = D.ticks();
    const g = D.ga(), pg = prev ? D.ga(prev.from, prev.to) : null;
    const siteUser = (r) => r.dim !== 'channel';
    const hasSiteUsers = D.M().some((r) => r.source === 'ga4' && (r.metric === 'ga_users' || r.metric === 'ga_new_users') && siteUser(r));
    const gaUsersDay = hasSiteUsers ? D.byDay('ga4', 'ga_users', S.from, S.to, siteUser) : null;
    const gaNewDay = hasSiteUsers ? D.byDay('ga4', 'ga_new_users', S.from, S.to, siteUser) : null;
    const gaSessDay = D.byDay('ga4', 'ga_sessions', S.from, S.to, (r) => r.dim === 'channel');
    const gaEngDay = D.byDay('ga4', 'ga_engaged_sessions', S.from, S.to, (r) => r.dim === 'channel');
    const gaChannels = D.gaChannels();
    const channelTotal = g && g.sessions;
    const topChannel = gaChannels[0];

    const kpis = U.kpiRow([
      !g ? U.kpi({ label: 'GA4 sessions', source: 'GA4', awaiting: 'GA4' }) : U.kpi({ label: 'GA4 sessions', source: 'GA4', value: U.fmt(g.sessions), compare: 'Visits grouped into sessions for the selected period' }),
      !g ? U.kpi({ label: 'Unique visitors', source: 'GA4', awaiting: 'GA4' })
        : g.users == null ? U.kpi({ label: 'Unique visitors', source: 'GA4', value: '–', compare: 'Deduplicated visitors for this range appear after the next GA4 sync' })
          : U.kpi({ label: 'Unique visitors', source: 'GA4', value: U.fmt(g.users), delta: U.delta(g.users, pg && pg.users), spark: gaUsersDay && D.grain() === 'day' ? U.days(S.from, S.to).map((d) => gaUsersDay[d]) : null, compare: 'Deduplicated GA4 users in the selected range' }),
      !g ? U.kpi({ label: 'New users', source: 'GA4', awaiting: 'GA4' })
        : g.newUsers == null ? U.kpi({ label: 'New users', source: 'GA4', value: '–', compare: 'New users for this range appear after the next GA4 sync' })
          : U.kpi({ label: 'New users', source: 'GA4', value: U.fmt(g.newUsers), delta: U.delta(g.newUsers, pg && pg.newUsers), spark: gaNewDay ? D.series(gaNewDay) : null, compare: 'First visits; a person may return in later sessions' }),
      !g ? U.kpi({ label: 'Engagement rate', source: 'GA4', awaiting: 'GA4' })
        : !g.sessions ? U.kpi({ label: 'Engagement rate', source: 'GA4', value: '–', compare: 'No GA4 sessions in this period' })
          : U.kpi({ label: 'Engagement rate', source: 'GA4', value: U.pct(g.rate), delta: U.delta(g.rate, pg && pg.sessions ? pg.rate : null), spark: D.seriesRate(gaEngDay, gaSessDay), compare: `${U.fmt(g.engaged)} engaged of ${U.fmt(g.sessions)} sessions` }),
      topChannel ? U.kpi({ label: 'Top channel', source: 'GA4', value: U.esc(topChannel.channel), small: true, compare: `${U.fmt(topChannel.sessions)} sessions · ${U.pct(channelTotal ? topChannel.sessions / channelTotal : null)} of total` }) : U.kpi({ label: 'Top channel', source: 'GA4', awaiting: 'GA4' }),
    ]);
    const goals = A.targets.strip(['landing_sessions', 'unique_visitors', 'engagement_rate']);

    const channelBars = gaChannels.map((r) => ({ name: r.channel, color: C.CHANNELS[C.channelOf(r.channel)].color, value: r.sessions, label: U.fmt(r.sessions) }));
    const perf = U.card({ title: 'GA4 sessions by channel', sub: `${U.fmt(channelTotal)} sessions · session-attributed traffic · ${U.win(S.from, S.to)}`, right: U.srcPill('ga4', 'session channel'), body: channelBars.length ? C.hbars(channelBars, channelTotal) : U.awaiting('ga4') });
    const channelEngagement = U.card({ title: 'Engagement by channel', sub: 'Engaged sessions / sessions · same GA4 session-channel grouping', body: gaChannels.length ? U.table([
      { t: 'Channel', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.channel)].color};margin-right:8px"></span>${U.esc(r.channel)}` },
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engaged sessions', num: 1, f: (r) => U.fmt(r.engaged_sessions) },
      { t: 'Engagement rate', num: 1, f: (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null) },
    ], gaChannels) : U.awaiting('ga4') });
    const rawDaily = Object.fromEntries(U.days(S.from, S.to).map((d) => [d, Array(8).fill(0)]));
    for (const r of D.M()) if (r.source === 'ga4' && r.metric === 'ga_sessions' && r.dim === 'channel' && rawDaily[r.date]) rawDaily[r.date][C.channelOf(r.dim_value)] += Number(r.value) || 0;
    const daily = D.rollChannels(rawDaily);
    const chart = U.card({ cls: 'chart-card', title: `${grain} GA4 sessions by channel`, sub: `One bar per ${D.grainBar()} · ${U.win(S.from, S.to)}`, body: C.stacked({ dates: ticks, keys: C.CHANNELS, value: (d, i) => (daily[d] || [])[i] || 0, label: `${grain} GA4 sessions by channel` })
      + '<p class="card-note">GA4 attributes sessions to the channel that started each session. This report does not contain new users by first-user channel, so that attribution is not inferred.</p>' });

    // Collapsed detail tables
    const src = D.byDim('hubspot', 'sessions');
    const srcRows = src.map(([k, v]) => ({ k, s: v, pv: D.sum('hubspot', 'pageviews', (r) => r.dim_value === k), b: D.sum('hubspot', 'bounces', (r) => r.dim_value === k), c: D.sum('hubspot', 'contacts', (r) => r.dim_value === k) }));
    const utmSnap = D.snap('ga4', 'utm_attribution'), utmRows = D.utmRows();
    const F = ['sessions', 'engaged_sessions', 'users', 'key_events'];
    const bySessions = (a, b) => b.sessions - a.sessions;
    const utm = D.group(utmRows, (r) => [r.campaign, r.source, r.medium, r.content].join('\u0001'), F)
      .map((r) => { const [campaign, source, medium, content] = r.key.split('\u0001'); return { ...r, campaign, source, medium, content }; }).sort(bySessions);
    const pages = D.group(utmRows, (r) => D.path(r.landing_page), F).sort(bySessions).slice(0, 25);
    const rateOf = (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null);
    const sumCols = [
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engagement', num: 1, f: rateOf },
      { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
    ];
    const utmNote = `<p class="card-note" style="padding:0 20px 16px">(not set) means the visit arrived without that UTM value. Every ad, post and email should carry utm_source, utm_medium, utm_campaign and utm_content (starting with the persona code pNN).${utmSnap && (utmSnap.rows || []).length >= 1000 ? ' The GA4 report is capped at 1,000 rows, so the oldest detail may be missing.' : ''}</p>`;
    const exactC = true;
    const cmap = {};
    for (const r of D.gaCountries()) {
      cmap[r.country] = { ...r, users: D.countryUsers(r.country) };
    }
    for (const e of D.forms()) if (e.country) { cmap[e.country] = cmap[e.country] || { country: e.country }; cmap[e.country].forms = (cmap[e.country].forms || 0) + 1; }
    const crow = Object.values(cmap).sort((a, b) => (b.sessions || 0) - (a.sessions || 0) || (b.forms || 0) - (a.forms || 0));
    const details = `<div class="detail-group">
      ${U.details('HubSpot sessions by source', srcRows.length ? `${srcRows.length} sources` : '', srcRows.length ? U.table([
        { t: 'Source', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.k)].color};margin-right:8px"></span>${U.esc(r.k)}` },
        { t: 'Sessions', num: 1, f: (r) => U.fmt(r.s) }, { t: 'Share', num: 1, f: (r) => U.pct(D.sessions() ? r.s / D.sessions() : null) },
        { t: 'Page views', num: 1, f: (r) => U.fmt(r.pv) }, { t: 'Bounce rate', num: 1, f: (r) => U.pct(r.s ? r.b / r.s : null) }, { t: 'Contacts', num: 1, f: (r) => U.fmt(r.c) },
      ], srcRows) : U.awaiting('hubspot'))}
      ${U.details('UTM campaigns (GA4)', utmSnap ? `${utm.length} combinations · ${U.win(S.from, S.to)}` : '', utmSnap ? (utm.length ? U.table([
        { t: 'Campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` },
        { t: 'Source / medium', f: (r) => `${U.esc(r.source)} / ${U.esc(r.medium)}` },
        { t: 'Piece (utm_content)', f: (r) => { const p = D.persona(r.content); return `<code>${U.esc(r.content)}</code>${p ? ` ${U.pill('info', p)}` : ''}`; } },
        ...sumCols,
      ], utm.slice(0, 100)) + utmNote : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Entry pages (GA4)', utmSnap ? `${pages.length} pages` : '', utmSnap ? (pages.length ? U.table([{ t: 'Page', f: (r) => `<code>${U.esc(r.key)}</code>` }, ...sumCols], pages) : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Countries (GA4)', crow.length ? `${crow.length} countries` : '', crow.length ? U.table([
        { t: 'Country', k: 'country' }, { t: 'Sessions (GA4)', num: 1, f: (r) => U.fmt(r.sessions) },
        { t: 'Users (GA4)', num: 1, f: (r) => U.fmt(r.users) },
        { t: 'Engagement', num: 1, f: rateOf }, { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
        { t: 'CRM contacts (HubSpot)', num: 1, f: (r) => U.fmt(r.forms || 0) },
      ], crow) : U.empty('No country data yet', 'GA4 country rows and HubSpot contacts by country appear here once loaded.'))}
    </div>`;

    return U.section('Acquisition at a glance', `${U.win(S.from, S.to)} · ${cmp}`, kpis)
      + goals
      + `<section class="section grid-2">${perf}${channelEngagement}</section>`
      + `<section class="section">${chart}</section>`
      + U.section('Details', 'Collapsed tables for analysts', details);
  }
  A.views.acquisition = { title: 'Acquisition', render };
})(window.App);

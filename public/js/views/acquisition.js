'use strict';
/* Acquisition: where visits come from. KPIs, goals, channel performance with % share and change, daily stack, details. */
(function (A) {
  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const prev = D.prev();
    const cmp = prev ? `vs previous ${prev.len} days` : 'Since launch · no comparison';
    const days = U.days(S.from, S.to);
    const hasSess = D.has('hubspot', 'sessions');
    const ch = D.channels(), total = ch.reduce((a, b) => a + b, 0);
    const pch = prev ? D.channels(prev.from, prev.to) : null, ptotal = pch ? pch.reduce((a, b) => a + b, 0) : null;
    const g = D.ga(), pg = prev ? D.ga(prev.from, prev.to) : null;
    const siteUser = (r) => r.dim !== 'channel';
    const hasSiteUsers = D.M().some((r) => r.source === 'ga4' && (r.metric === 'ga_users' || r.metric === 'ga_new_users') && siteUser(r));
    const gaUsersDay = hasSiteUsers ? D.byDay('ga4', 'ga_users', S.from, S.to, siteUser) : null;
    const gaNewDay = hasSiteUsers ? D.byDay('ga4', 'ga_new_users', S.from, S.to, siteUser) : null;
    const gaSessDay = D.byDay('ga4', 'ga_sessions'), gaEngDay = D.byDay('ga4', 'ga_engaged_sessions');
    let top = 0; ch.forEach((v, i) => { if (v > ch[top]) top = i; });
    const sessDay = D.byDay('hubspot', 'sessions');

    const kpis = U.kpiRow([
      hasSess ? U.kpi({ label: 'Landing Sessions', source: 'HubSpot · todo el sitio', value: U.fmt(total), delta: U.delta(total, ptotal), spark: days.map((d) => sessDay[d]), compare: cmp }) : U.kpi({ label: 'Landing Sessions', source: 'HubSpot · todo el sitio', awaiting: 'HubSpot' }),
      !g ? U.kpi({ label: 'Unique Visitors', source: 'GA4', awaiting: 'GA4' })
        : g.users == null ? U.kpi({ label: 'Unique Visitors', source: 'GA4', value: '–', compare: 'Deduped visitors for this range appear after the next GA4 sync' })
          : U.kpi({ label: 'Unique Visitors', source: 'GA4', value: U.fmt(g.users), delta: U.delta(g.users, pg && pg.users), spark: gaUsersDay ? days.map((d) => gaUsersDay[d]) : null, compare: `GA4 total for the period · ${cmp}` }),
      !g ? U.kpi({ label: 'New Users', source: 'GA4', awaiting: 'GA4' })
        : g.newUsers == null ? U.kpi({ label: 'New Users', source: 'GA4', value: '–', compare: 'New users for this range appear after the next GA4 sync' })
          : U.kpi({ label: 'New Users', source: 'GA4', value: U.fmt(g.newUsers), delta: U.delta(g.newUsers, pg && pg.newUsers), spark: gaNewDay ? days.map((d) => gaNewDay[d]) : null, compare: `${g.usersExact ? 'GA4 total for the period' : 'First visits, one count per day'} · ${cmp}` }),
      !g ? U.kpi({ label: 'Engagement Rate', source: 'GA4', awaiting: 'GA4' })
        : !g.sessions ? U.kpi({ label: 'Engagement Rate', source: 'GA4', value: '–', compare: 'No GA4 sessions in this period' })
          : U.kpi({ label: 'Engagement Rate', source: 'GA4', value: U.pct(g.rate), delta: U.delta(g.rate, pg && pg.sessions ? pg.rate : null), spark: days.map((d) => (gaSessDay[d] ? gaEngDay[d] / gaSessDay[d] : 0)), compare: `${U.fmt(g.engaged)} engaged of ${U.fmt(g.sessions)} GA4 sessions` }),
      hasSess && total ? U.kpi({ label: 'Top Channel', source: 'HubSpot · todo el sitio', value: U.esc(C.CHANNELS[top].name), small: true, delta: U.delta(ch[top], pch ? pch[top] : null), compare: `${U.fmt(ch[top])} sessions · ${U.pct(ch[top] / total)} share` }) : U.kpi({ label: 'Top Channel', source: 'HubSpot', awaiting: 'HubSpot' }),
    ]);
    const goals = A.targets.strip(['landing_sessions', 'unique_visitors', 'engagement_rate']);

    const rows = C.CHANNELS.map((c, i) => ({ name: c.name, color: c.color, value: ch[i], extra: pch ? U.delta(ch[i], pch[i]) : '' })).filter((r) => r.value || (pch && pch[C.CHANNELS.findIndex((c) => c.name === r.name)]));
    const perf = U.card({ title: 'Sessions by channel', sub: `${U.fmt(total)} sessions · share of total and % change ${prev ? `vs previous ${prev.len} days` : '(no comparison since launch)'}`, right: U.srcPill('hubspot', 'todo el sitio'), body: hasSess ? C.hbars(rows, total) : U.awaiting('hubspot') });
    const mix = U.card({ title: 'Channel mix', sub: 'Share of landing sessions', body: hasSess ? C.mix(ch) : U.awaiting('hubspot') });
    const daily = D.dailyChannels();
    const chart = U.card({ cls: 'chart-card', title: 'Daily sessions by channel', sub: U.win(S.from, S.to), body: hasSess ? C.stacked({ dates: days, keys: C.CHANNELS, value: (d, i) => daily[d][i], label: 'Daily sessions by channel' }) : U.awaiting('hubspot') });

    // Collapsed detail tables
    const src = D.byDim('hubspot', 'sessions');
    const srcRows = src.map(([k, v]) => ({ k, s: v, pv: D.sum('hubspot', 'pageviews', (r) => r.dim_value === k), b: D.sum('hubspot', 'bounces', (r) => r.dim_value === k), c: D.sum('hubspot', 'contacts', (r) => r.dim_value === k) }));
    const hasGa = D.has('ga4', 'ga_sessions');
    const gch = D.gaChannels();
    const utmSnap = D.snap('ga4', 'utm_attribution'), utmRows = D.utmRows();
    const F = ['sessions', 'engaged_sessions', 'users', 'key_events'];
    const bySessions = (a, b) => b.sessions - a.sessions;
    const utm = D.group(utmRows, (r) => [r.campaign, r.source, r.medium, r.content].join('\u0001'), F)
      .map((r) => { const [campaign, source, medium, content] = r.key.split('\u0001'); return { ...r, campaign, source, medium, content }; }).sort(bySessions);
    const pages = D.group(utmRows, (r) => D.path(r.landing_page), F).sort(bySessions).slice(0, 25);
    const cities = D.group(utmRows, (r) => r.city || '(not set)', F).sort(bySessions).slice(0, 25);
    const rateOf = (r) => U.pct(r.sessions ? r.engaged_sessions / r.sessions : null);
    const sumCols = [
      { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engagement', num: 1, f: rateOf },
      { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
    ];
    const utmNote = `<p class="card-note" style="padding:0 20px 16px">(not set) means the visit arrived without that UTM value. Every ad, post and email should carry utm_source, utm_medium, utm_campaign and utm_content (starting with the persona code pNN).${utmSnap && (utmSnap.rows || []).length >= 1000 ? ' The GA4 report is capped at 1,000 rows, so the oldest detail may be missing.' : ''}</p>`;
    const exactC = D.gaCovers();
    const cmap = {};
    for (const r of D.gaCountries()) {
      const sn = exactC ? D.countrySnapshot(r.country) : null;
      cmap[r.country] = { ...r, users: sn && sn.users != null ? Number(sn.users) : null };
    }
    for (const e of D.forms()) if (e.country) { cmap[e.country] = cmap[e.country] || { country: e.country }; cmap[e.country].forms = (cmap[e.country].forms || 0) + 1; }
    const crow = Object.values(cmap).sort((a, b) => (b.sessions || 0) - (a.sessions || 0) || (b.forms || 0) - (a.forms || 0));
    const details = `<div class="detail-group">
      ${U.details('HubSpot sessions by source', srcRows.length ? `${srcRows.length} sources` : '', srcRows.length ? U.table([
        { t: 'Source', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.k)].color};margin-right:8px"></span>${U.esc(r.k)}` },
        { t: 'Sessions', num: 1, f: (r) => U.fmt(r.s) }, { t: 'Share', num: 1, f: (r) => U.pct(total ? r.s / total : null) },
        { t: 'Page views', num: 1, f: (r) => U.fmt(r.pv) }, { t: 'Bounce rate', num: 1, f: (r) => U.pct(r.s ? r.b / r.s : null) }, { t: 'Contacts', num: 1, f: (r) => U.fmt(r.c) },
      ], srcRows) : U.awaiting('hubspot'))}
      ${U.details('GA4 channels', hasGa ? `${gch.length} channels · ${U.win(S.from, S.to)}` : '', hasGa ? (gch.length ? U.table([
        { t: 'Channel', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.channel)].color};margin-right:8px"></span>${U.esc(r.channel)}` },
        { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engaged', num: 1, f: (r) => U.fmt(r.engaged_sessions) },
        { t: 'Engagement', num: 1, f: rateOf },
      ], gch) : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('UTM campaigns (GA4)', utmSnap ? `${utm.length} combinations · ${U.win(S.from, S.to)}` : '', utmSnap ? (utm.length ? U.table([
        { t: 'Campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` },
        { t: 'Source / medium', f: (r) => `${U.esc(r.source)} / ${U.esc(r.medium)}` },
        { t: 'Piece (utm_content)', f: (r) => { const p = D.persona(r.content); return `<code>${U.esc(r.content)}</code>${p ? ` ${U.pill('info', p)}` : ''}`; } },
        ...sumCols,
      ], utm.slice(0, 100)) + utmNote : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Entry pages (GA4)', utmSnap ? `${pages.length} pages` : '', utmSnap ? (pages.length ? U.table([{ t: 'Page', f: (r) => `<code>${U.esc(r.key)}</code>` }, ...sumCols], pages) : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Cities (GA4)', utmSnap ? `${cities.length} cities` : '', utmSnap ? (cities.length ? U.table([{ t: 'City', f: (r) => U.esc(r.key) }, ...sumCols], cities) : U.empty('No GA4 sessions in this period')) : U.awaiting('ga4'))}
      ${U.details('Countries', crow.length ? `${crow.length} countries` : '', crow.length ? U.table([
        { t: 'Country', k: 'country' }, { t: 'Sessions (GA4)', num: 1, f: (r) => U.fmt(r.sessions) },
        { t: 'Users (GA4)', num: 1, f: (r) => U.fmt(r.users) },
        { t: 'Engagement', num: 1, f: rateOf }, { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
        { t: 'Form sign-ups (HubSpot)', num: 1, f: (r) => U.fmt(r.forms || 0) },
      ], crow) : U.empty('No country data yet', 'GA4 country rows and HubSpot sign-ups by country appear here once loaded.'))}
    </div>`;

    return U.section('Acquisition at a glance', `${U.win(S.from, S.to)} · ${cmp}`, kpis)
      + goals
      + `<section class="section grid-2">${perf}${mix}</section>`
      + `<section class="section">${chart}</section>`
      + U.section('Details', 'Collapsed tables for analysts', details);
  }
  A.views.acquisition = { title: 'Acquisition', render };
})(window.App);

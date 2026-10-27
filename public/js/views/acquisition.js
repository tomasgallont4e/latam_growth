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
    const ga = D.snap('ga4', 'totals'), gt = ga && ga.rows && ga.rows[0];
    let top = 0; ch.forEach((v, i) => { if (v > ch[top]) top = i; });
    const sessDay = D.byDay('hubspot', 'sessions');

    const kpis = U.kpiRow([
      hasSess ? U.kpi({ label: 'Landing Sessions', source: 'HubSpot', value: U.fmt(total), delta: U.delta(total, ptotal), spark: days.map((d) => sessDay[d]), compare: cmp }) : U.kpi({ label: 'Landing Sessions', source: 'HubSpot', awaiting: 'HubSpot' }),
      gt ? U.kpi({ label: 'Unique Visitors', source: 'GA4', value: U.fmt(gt.users), delta: U.delta(null, null), compare: `GA4 window ${U.win(ga.from, ga.to)}` }) : U.kpi({ label: 'Unique Visitors', source: 'GA4', awaiting: 'GA4' }),
      gt ? U.kpi({ label: 'New Users', source: 'GA4', value: U.fmt(gt.new_users), delta: U.delta(null, null), compare: `${U.pct(gt.users ? gt.new_users / gt.users : null)} of visitors are new` }) : U.kpi({ label: 'New Users', source: 'GA4', awaiting: 'GA4' }),
      gt ? U.kpi({ label: 'Engagement Rate', source: 'GA4', value: U.pct(gt.engagement_rate), delta: U.delta(null, null), compare: `${gt.avg_engagement_sec ? `${gt.avg_engagement_sec}s average engagement` : `${U.fmt(gt.engaged_sessions)} engaged sessions`}` }) : U.kpi({ label: 'Engagement Rate', source: 'GA4', awaiting: 'GA4' }),
      hasSess && total ? U.kpi({ label: 'Top Channel', source: 'HubSpot', value: U.esc(C.CHANNELS[top].name), small: true, delta: U.delta(ch[top], pch ? pch[top] : null), compare: `${U.fmt(ch[top])} sessions · ${U.pct(ch[top] / total)} share` }) : U.kpi({ label: 'Top Channel', source: 'HubSpot', awaiting: 'HubSpot' }),
    ]);
    const goals = A.targets.strip(['landing_sessions', 'unique_visitors', 'engagement_rate']);

    const rows = C.CHANNELS.map((c, i) => ({ name: c.name, color: c.color, value: ch[i], extra: pch ? U.delta(ch[i], pch[i]) : '' })).filter((r) => r.value || (pch && pch[C.CHANNELS.findIndex((c) => c.name === r.name)]));
    const perf = U.card({ title: 'Sessions by channel', sub: `${U.fmt(total)} sessions · share of total and % change ${prev ? `vs previous ${prev.len} days` : '(no comparison since launch)'}`, right: U.srcPill('hubspot'), body: hasSess ? C.hbars(rows, total) : U.awaiting('hubspot') });
    const mix = U.card({ title: 'Channel mix', sub: 'Share of landing sessions', body: hasSess ? C.mix(ch) : U.awaiting('hubspot') });
    const daily = D.dailyChannels();
    const chart = U.card({ cls: 'chart-card', title: 'Daily sessions by channel', sub: U.win(S.from, S.to), body: hasSess ? C.stacked({ dates: days, keys: C.CHANNELS, value: (d, i) => daily[d][i], label: 'Daily sessions by channel' }) : U.awaiting('hubspot') });

    // Collapsed detail tables
    const src = D.byDim('hubspot', 'sessions');
    const srcRows = src.map(([k, v]) => ({ k, s: v, pv: D.sum('hubspot', 'pageviews', (r) => r.dim_value === k), b: D.sum('hubspot', 'bounces', (r) => r.dim_value === k), c: D.sum('hubspot', 'contacts', (r) => r.dim_value === k) }));
    const gch = D.snap('ga4', 'channels'), utm = D.snap('hubspot', 'utm_campaigns');
    const hc = D.snap('hubspot', 'countries'), gc = D.snap('ga4', 'countries');
    const countries = {};
    (hc ? hc.rows : []).forEach((r) => { countries[r.country] = { ...(countries[r.country] || {}), s: r.sessions }; });
    (gc ? gc.rows : []).forEach((r) => { countries[r.country] = { ...(countries[r.country] || {}), u: r.users, k: r.key_events }; });
    const crow = Object.entries(countries).map(([c, v]) => ({ c, ...v })).sort((a, b) => (b.s || 0) - (a.s || 0));
    const details = `<div class="detail-group">
      ${U.details('HubSpot sessions by source', srcRows.length ? `${srcRows.length} sources` : '', srcRows.length ? U.table([
        { t: 'Source', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.k)].color};margin-right:8px"></span>${U.esc(r.k)}` },
        { t: 'Sessions', num: 1, f: (r) => U.fmt(r.s) }, { t: 'Share', num: 1, f: (r) => U.pct(total ? r.s / total : null) },
        { t: 'Page views', num: 1, f: (r) => U.fmt(r.pv) }, { t: 'Bounce rate', num: 1, f: (r) => U.pct(r.s ? r.b / r.s : null) }, { t: 'Contacts', num: 1, f: (r) => U.fmt(r.c) },
      ], srcRows) : U.awaiting('hubspot'))}
      ${U.details('GA4 channels', gch ? U.win(gch.from, gch.to) : '', gch ? U.table([
        { t: 'Channel', f: (r) => `<span class="ch-dot" style="--ch:${C.CHANNELS[C.channelOf(r.channel)].color};margin-right:8px"></span>${U.esc(r.channel)}` },
        { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Engaged', num: 1, f: (r) => U.fmt(r.engaged_sessions) },
        { t: 'Engagement', num: 1, f: (r) => U.pct(r.engagement_rate) }, { t: 'Key events', num: 1, f: (r) => U.fmt(r.key_events) },
      ], gch.rows || []) : U.awaiting('ga4'))}
      ${U.details('UTM campaigns', utm ? U.win(utm.from, utm.to) : '', utm ? U.table([
        { t: 'utm_campaign', f: (r) => `<code>${U.esc(r.campaign)}</code>` }, { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) },
        { t: 'Visitors', num: 1, f: (r) => U.fmt(r.visitors) }, { t: 'Contacts', num: 1, f: (r) => U.fmt(r.contacts) },
        { t: 'Status', f: (r) => (r.test ? U.pill('info', 'Test link') : U.pill('success', 'Live')) },
      ], utm.rows || []) + '<p class="card-note" style="padding:0 20px 16px">Every ad, post and email should carry utm_source, utm_medium and utm_campaign so each sign-up traces back to the piece that produced it.</p>' : U.awaiting('hubspot'))}
      ${U.details('Countries', crow.length ? `${crow.length} countries` : '', crow.length ? U.table([
        { t: 'Country', k: 'c' }, { t: 'Sessions (HubSpot)', num: 1, f: (r) => U.fmt(r.s) }, { t: 'Users (GA4)', num: 1, f: (r) => U.fmt(r.u) }, { t: 'Key events', num: 1, f: (r) => U.fmt(r.k) },
      ], crow) : U.empty('No country data yet', 'HubSpot and GA4 country tables appear here once loaded.'))}
    </div>`;

    return U.section('Acquisition at a glance', `${U.win(S.from, S.to)} · ${cmp}`, kpis)
      + goals
      + `<section class="section grid-2">${perf}${mix}</section>`
      + `<section class="section">${chart}</section>`
      + U.section('Details', 'Collapsed tables for analysts', details);
  }
  A.views.acquisition = { title: 'Acquisition', render };
})(window.App);

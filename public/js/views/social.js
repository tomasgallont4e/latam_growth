'use strict';
/* Social and Paid: spend, clicks, CTR and attributed acquisition costs (a cost drop is good),
   spend by platform, daily spend, per-platform campaigns, LinkedIn organic, Clarity and ad library checks. */
(function (A) {
  // Followers is a running total (not additive): take the latest value up to 1 day after the period end,
  // because the connector stamps it with the UTC date (a day ahead in LATAM evenings).
  function addDay(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function lastFollowers() {
    const lim = addDay(A.S.to, 1);
    const fol = A.D.M().filter((r) => r.source === 'linkedin' && r.metric === 'followers' && r.date <= lim).sort((a, b) => (a.date < b.date ? -1 : 1));
    return fol[fol.length - 1] || null;
  }
  function platformDetail(p) {
    const U = A.ui, D = A.D;
    const rows = D.byDim(p.key, 'ad_spend');
    if (rows.length) {
      const r = rows.map(([c, spend]) => {
        const f = (m) => D.sum(p.key, m, (x) => x.dim_value === c);
        const imp = f('ad_impressions'), res = f('ad_results');
        const clickMetric = p.key === 'meta' ? 'ad_link_clicks' : 'ad_clicks';
        const clk = D.has(p.key, clickMetric) ? f(clickMetric) : null;
        return { c, spend, imp, clk, res, ctr: imp && clk != null ? clk / imp : null, cpm: A.paid.cost(spend, imp, 1000), cpc: A.paid.cost(spend, clk), cpr: A.paid.cost(spend, res) };
      });
      return U.details(`${p.name} campaigns`, `${r.length} campaigns · ${U.money(r.reduce((s, x) => s + x.spend, 0))}`, U.table([
        { t: 'Campaign', k: 'c' }, { t: 'Spend', num: 1, f: (x) => U.money(x.spend) }, { t: 'Impressions', num: 1, f: (x) => U.fmt(x.imp) },
        { t: 'Clicks (Meta: link clicks)', num: 1, f: (x) => U.fmt(x.clk) }, { t: 'CTR', num: 1, f: (x) => U.pct(x.ctr) }, { t: 'CPM', num: 1, f: (x) => U.money(x.cpm) }, { t: 'CPC', num: 1, f: (x) => U.money(x.cpc) },
        { t: 'Platform results', num: 1, f: (x) => U.fmt(x.res) }, { t: 'Cost / platform result', num: 1, f: (x) => U.money(x.cpr) },
      ], r));
    }
    const other = [...new Set(D.M().filter((x) => x.source === p.key).map((x) => x.metric))];
    // LinkedIn page metrics (followers, views, post engagement) are the cards in LinkedIn organic.
    const shown = p.key === 'linkedin' ? other.filter((m) => /^ad_/.test(m)) : other;
    if (p.key === 'linkedin' && other.length && !shown.length) return '';
    if (shown.length) {
      const metricRows = shown.map((m) => ({ m: m.replace(/_/g, ' '), v: D.sum(p.key, m) }));
      return U.details(`${p.name} metrics`, `${shown.length} metrics`, U.table([{ t: 'Metric', k: 'm' }, { t: 'Total in period', num: 1, f: (x) => U.fmt(x.v) }], metricRows));
    }
    const s = D.source(p.key);
    return U.details(p.name, s.state === 'connected' ? 'No rows in this period' : 'Awaiting data', `<div class="pad">${U.awaiting(p.key, s.provides)}${s.connect ? `<p class="card-note">How to connect: ${U.esc(s.connect)}</p>` : ''}</div>`);
  }
  // Same metrics the LinkedIn details table used to list, in a reading order for the cards.
  const ORGANIC_ORDER = ['followers', 'new_followers', 'page_views', 'post_impressions', 'post_clicks', 'post_reactions', 'post_comments', 'post_reposts'];
  function organicMetrics() {
    const names = [];
    const seen = new Set();
    for (const r of A.D.M()) {
      if (r.source !== 'linkedin' || /^ad_/.test(r.metric) || seen.has(r.metric)) continue;
      seen.add(r.metric);
      names.push(r.metric);
    }
    return names.sort((a, b) => {
      const ia = ORGANIC_ORDER.indexOf(a), ib = ORGANIC_ORDER.indexOf(b);
      return (ia < 0 ? ORGANIC_ORDER.length : ia) - (ib < 0 ? ORGANIC_ORDER.length : ib) || (a < b ? -1 : 1);
    });
  }
  function organicCard(metric, last, period) {
    const U = A.ui, D = A.D;
    if (metric === 'followers') return U.kpi({ label: 'Followers', source: 'LinkedIn', value: U.fmt(last ? last.value : null), compare: last ? `Latest total · on ${U.dshort(last.date)}` : period });
    const words = metric.replace(/_/g, ' ');
    return U.kpi({
      label: words.charAt(0).toUpperCase() + words.slice(1),
      source: 'LinkedIn',
      value: U.fmt(D.sum('linkedin', metric)),
      compare: metric === 'new_followers' ? `Net gains · ${period}` : `Total in period · ${period}`,
    });
  }
  function linkedinOrganic() {
    const U = A.ui, D = A.D;
    const S = A.S;
    const posts = D.snap('linkedin', 'posts');
    const tot = D.snap('linkedin', 'page_totals'), loc = D.snap('linkedin', 'follower_locations');
    const t = tot && tot.rows && tot.rows[0];
    const last = lastFollowers();
    const metrics = organicMetrics();
    if (!posts && !t && !metrics.length) return '';
    const period = U.win(S.from, S.to);
    const cards = metrics.length ? metrics.map((m) => organicCard(m, last, period)) : [];
    if (!metrics.length && (last || t)) cards.push(U.kpi({ label: 'Followers', source: 'LinkedIn', value: U.fmt(last ? last.value : t.followers), compare: last ? `Latest total · on ${U.dshort(last.date)}` : U.win(tot.from, tot.to) }));
    if (!metrics.length && t) {
      cards.push(U.kpi({ label: 'New followers', source: '30 days', value: U.fmt(t.new_followers), compare: t.new_followers_change ? `${U.esc(t.new_followers_change)} vs prior 30 days` : '' }));
      cards.push(U.kpi({ label: 'Post impressions', source: '30 days', value: U.fmt(t.impressions), compare: t.impressions_change ? `${U.esc(t.impressions_change)} vs prior 30 days` : '' }));
      cards.push(U.kpi({ label: 'Page views', source: '30 days', value: U.fmt(t.page_views), compare: t.page_views_change ? `${U.esc(t.page_views_change)} vs prior 30 days` : '' }));
    }
    const cols = { 3: 3, 4: 4, 6: 6 }[cards.length];
    const tiles = cards.length ? U.kpiRow(cards, cols) : '';
    if (!posts) {
      return U.section('LinkedIn organic', `Think4Ever Global page · ${U.win(S.from, S.to)}${loc ? ` · followers in ${(loc.rows || []).slice(0, 4).map((r) => U.esc(r.location)).join(', ')}` : ''}`, tiles);
    }
    const hasAdmin = (posts.rows || []).some((r) => r.impressions != null);
    const table = hasAdmin
      ? U.table([{ t: 'Published', f: (r) => `<span class="mono">${U.dshort(r.date)}</span>` }, { t: 'Post', k: 'title' }, { t: 'Lifetime impressions', num: 1, f: (r) => U.fmt(r.impressions) }, { t: 'Lifetime content clicks', num: 1, f: (r) => U.fmt(r.clicks) }, { t: 'Content CTR', num: 1, f: (r) => U.pct(r.ctr) }, { t: 'Reactions', num: 1, f: (r) => U.fmt(r.reactions) }, { t: 'Engagement', num: 1, f: (r) => U.pct(r.engagement_rate) }], (posts.rows || []).filter((r) => r.date >= S.from && r.date <= S.to))
      : U.table([{ t: 'Date', f: (r) => `<span class="mono">${U.dshort(r.date)}</span>` }, { t: 'Post', k: 'title' }, { t: 'Reactions', num: 1, f: (r) => U.fmt(r.reactions) }, { t: 'Comments', num: 1, f: (r) => U.fmt(r.comments) }, { t: 'Reposts', num: 1, f: (r) => U.fmt(r.reposts) }], posts.rows || []);
    return U.section('LinkedIn organic', `Think4Ever Global page · ${U.win(posts.from, posts.to)}${loc ? ` · followers in ${(loc.rows || []).slice(0, 4).map((r) => U.esc(r.location)).join(', ')}` : ''}`,
      `${tiles}<p class="card-note">Posts are filtered by publication date. Their statistics are lifetime snapshots, not daily performance; content clicks are not proven outbound site visits.</p><div class="detail-group" style="margin-top:16px">${U.details('LinkedIn posts', `${(posts.rows || []).length} posts in snapshot`, table)}</div>`);
  }

  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const prev = D.prev();
    const cmp = D.versus();
    const grain = D.grainName();
    const ticks = D.ticks();
    const any = D.anyPaid();
    const m = (from, to) => D.paidTotals(from, to);
    const cur = m(S.from, S.to), p = prev ? m(prev.from, prev.to) : {};
    const spendDay = Object.fromEntries(C.PLATFORMS.map((pf) => [pf.key, D.rollNum(D.byDay(pf.key, 'ad_spend'))]));
    const aw = 'Meta, LinkedIn or Google Ads';
    const kpis = U.kpiRow([
      U.kpi({ label: 'Ad Spend', source: 'All platforms', value: U.money(cur.spend), hero: true, delta: U.delta(cur.spend, p.spend, { invert: true }), spark: ticks.map((d) => C.PLATFORMS.reduce((s, pf) => s + (spendDay[pf.key][d] || 0), 0)), compare: cmp }),
      U.kpi({ label: 'Impressions', source: 'All platforms', value: U.fmt(cur.impressions), delta: U.delta(cur.impressions, p.impressions), compare: cmp }),
      U.kpi({ label: 'Clicks (Meta: link clicks)', source: 'Ads', value: U.fmt(cur.clicks), delta: U.delta(cur.clicks, p.clicks), compare: cur.clicks == null ? 'Sync Meta to load link-click data' : 'Clicks are not landing sessions' }),
      U.kpi({ label: 'Click-through Rate', source: 'Derived', value: U.pct(cur.ctr), delta: U.delta(cur.ctr, p.ctr), compare: 'Clicks / impressions' }),
      U.kpi({ label: 'Cost per Click', source: 'Derived', value: U.money(cur.cpc), delta: U.delta(cur.cpc, p.cpc, { invert: true }), compare: 'Lower is better' }),
      U.kpi({ label: 'CPM', source: 'Derived', value: U.money(cur.cpm), delta: U.delta(cur.cpm, p.cpm, { invert: true }), compare: 'Spend / impressions × 1,000' }),
      U.kpi({ label: 'Paid UTM sessions', source: 'GA4', value: U.fmt(cur.sessions), compare: 'UTM-classified traffic, even when an ad-spend report is unavailable' }),
      U.kpi({ label: 'Cost / paid session', source: 'GA4 + ads', value: U.money(cur.costSession), delta: U.delta(cur.costSession, p.costSession, { invert: true }), compare: cur.sessions == null ? 'Sync GA4 to load the paid-session report' : 'Spend / paid UTM sessions' }),
      U.kpi({ label: 'Cost / attributed CRM contact', source: 'HubSpot + ads', value: U.money(cur.costForm), delta: U.delta(cur.costForm, p.costForm, { invert: true }), compare: cur.forms == null ? 'Awaiting HubSpot UTM fields and sync' : 'Spend / paid UTM contacts; not verified product accounts' }),
    ], 3);
    const goals = A.targets.strip(['ad_spend_budget', 'clicks', 'ctr']);

    const bars = C.PLATFORMS.map((pf) => ({ name: pf.name, color: pf.color, value: D.sum(pf.key, 'ad_spend'), label: U.money(D.sum(pf.key, 'ad_spend')), extra: prev ? U.delta(D.sum(pf.key, 'ad_spend'), D.sum(pf.key, 'ad_spend', null, prev.from, prev.to), { invert: true }) : '' }));
    const byPlat = U.card({ title: 'Spend by platform', sub: `${U.money(cur.spend)} total · share and % change`, body: any ? C.hbars(bars, cur.spend) : U.empty('No ad spend yet', 'Spend by platform appears with the first campaign.', 'sack-dollar') });
    const clicksMix = U.card({ title: 'Clicks by platform', sub: `${U.fmt(cur.clicks)} clicks · Meta uses link clicks`, body: any && cur.clicks != null ? C.mix(C.PLATFORMS.map((pf) => D.paidStats(pf.key).clicks || 0), C.PLATFORMS, 'clicks') : U.empty('No comparable click data yet', 'Sync Meta to update old all-click reports to link clicks.', 'arrow-pointer') });
    const chart = U.card({ cls: 'chart-card', title: `${grain} spend by platform`, sub: `One bar per ${D.grainBar()} · selected range · ${U.win(S.from, S.to)}`, body: any ? C.stacked({ dates: ticks, keys: C.PLATFORMS, value: (d, i) => spendDay[C.PLATFORMS[i].key][d], label: `${grain} ad spend by platform`, fmt: (v) => `$${U.fmt(v)}` }) : U.empty('No spend in selected range', 'The chart switches on with the first campaign that sends data.', 'chart-column') });
    const periods = D.periods();
    const unitRows = periods.flatMap((p) => C.PLATFORMS.map((pf) => ({ ...D.paidStats(pf.key, p.from, p.to), platform: pf.name, period: U.win(p.from, p.to) })));
    const unitCosts = U.card({ cls: 'period-table', title: `${grain} unit costs by paid channel`, sub: `${S.from} to ${S.to} · ratios recomputed per period · reported account currency; compare only matching currencies`, body: U.table([
      { t: 'Period', k: 'period' }, { t: 'Channel', k: 'platform' }, { t: 'Spend', num: 1, f: (r) => U.money(r.spend) }, { t: 'Impressions', num: 1, f: (r) => U.fmt(r.impressions) },
      { t: 'Clicks', num: 1, f: (r) => U.fmt(r.clicks) }, { t: 'CTR', num: 1, f: (r) => U.pct(r.ctr) }, { t: 'CPM', num: 1, f: (r) => U.money(r.cpm) }, { t: 'CPC', num: 1, f: (r) => U.money(r.cpc) },
      { t: 'GA4 paid sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Cost / session', num: 1, f: (r) => U.money(r.costSession) },
      { t: 'CRM contacts (UTM)', num: 1, f: (r) => U.fmt(r.forms) }, { t: 'Cost / CRM contact', num: 1, f: (r) => U.money(r.costForm) },
    ], unitRows) + '<p class="card-note">Meta: link clicks can lead to destinations on or off Meta. LinkedIn Ads: CSV until the Advertising API is connected. Missing inputs or zero denominators show —. Form attribution prefers first-touch UTM when available; it does not prove an ad caused a verified account.</p>' });
    const attribution = U.card({ cls: 'period-table', title: `${grain} CRM contact attribution`, sub: 'These categories reconcile to the contact total; missing UTM is not assumed direct or organic', body: U.table([
      { t: 'Period', k: 'period' }, { t: 'Paid UTM', num: 1, f: (r) => U.fmt(r.total == null ? null : r.paid) },
      { t: 'Other identified source', num: 1, f: (r) => U.fmt(r.total == null ? null : r.other) },
      { t: 'Unknown / incomplete', num: 1, f: (r) => U.fmt(r.total == null ? null : r.unknown) },
      { t: 'Internal / QA included', num: 1, f: (r) => U.fmt(r.total == null ? null : r.tests) }, { t: 'CRM total', num: 1, f: (r) => U.fmt(r.total) },
    ], periods.map((p) => ({ ...D.contactAttribution(p.from, p.to), period: U.win(p.from, p.to) }))) });

    const cl = D.snap('clarity', 'live_insights'), libs = D.snap('research', 'ad_libraries');
    const details = `<div class="detail-group">
      ${C.PLATFORMS.map(platformDetail).join('')}
      ${libs ? U.details('Paid activity check (public ad libraries)', U.win(libs.from, libs.to), U.table([{ t: 'Library', k: 'library' }, { t: 'Ads found', num: 1, f: (r) => U.fmt(r.ads) }, { t: 'Reading', k: 'note' }], libs.rows || [])) : ''}
      ${cl ? U.details('Microsoft Clarity', U.win(cl.from, cl.to), U.table([{ t: 'Metric', k: 'metric' }, { t: 'Detail', f: (r) => U.esc(Object.entries(r).filter(([k]) => k !== 'metric').map(([k, v]) => `${k}: ${v}`).join(' · ')) }], (cl.rows || []).slice(0, 30)))
        : U.details('Microsoft Clarity', 'Awaiting data', `<div class="pad">${U.awaiting('clarity', 'Heatmaps, scroll depth, rage and dead clicks on the landing')}</div>`)}
    </div>`;

    return U.section('Social and paid at a glance', `${U.win(S.from, S.to)} · ${cmp} · cost metrics read green when they go down`, kpis)
      + goals
      + `<section class="section">${unitCosts}</section>`
      + `<section class="section">${attribution}</section>`
      + `<section class="section grid-2">${byPlat}${clicksMix}</section>`
      + `<section class="section">${chart}</section>`
      + linkedinOrganic()
      + U.section('Details', 'Campaign tables per platform and supporting tools', details);
  }
  A.views.social = { title: 'Social and Paid', render };
})(window.App);

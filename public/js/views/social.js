'use strict';
/* Social and Paid: spend, clicks, CTR and cost per sign-up (costs read inverted: a drop is good),
   spend by platform, daily spend, per-platform campaigns, LinkedIn organic, Clarity and ad library checks. */
(function (A) {
  function platformDetail(p) {
    const U = A.ui, D = A.D;
    const rows = D.byDim(p.key, 'ad_spend');
    if (rows.length) {
      const r = rows.map(([c, spend]) => {
        const f = (m) => D.sum(p.key, m, (x) => x.dim_value === c);
        const imp = f('ad_impressions'), clk = f('ad_clicks'), res = f('ad_results');
        return { c, spend, imp, clk, res, ctr: imp ? clk / imp : null, cpc: clk ? spend / clk : null, cpr: res ? spend / res : null };
      });
      return U.details(`${p.name} campaigns`, `${r.length} campaigns · ${U.money(r.reduce((s, x) => s + x.spend, 0))}`, U.table([
        { t: 'Campaign', k: 'c' }, { t: 'Spend', num: 1, f: (x) => U.money(x.spend) }, { t: 'Impressions', num: 1, f: (x) => U.fmt(x.imp) },
        { t: 'Clicks', num: 1, f: (x) => U.fmt(x.clk) }, { t: 'CTR', num: 1, f: (x) => U.pct(x.ctr) }, { t: 'CPC', num: 1, f: (x) => U.money(x.cpc) },
        { t: 'Results', num: 1, f: (x) => U.fmt(x.res) }, { t: 'Cost per result', num: 1, f: (x) => U.money(x.cpr) },
      ], r));
    }
    const other = [...new Set(D.M().filter((x) => x.source === p.key).map((x) => x.metric))];
    if (other.length) return U.details(`${p.name} metrics`, `${other.length} metrics`, U.table([{ t: 'Metric', k: 'm' }, { t: 'Total in period', num: 1, f: (x) => U.fmt(x.v) }], other.map((m) => ({ m: m.replace(/_/g, ' '), v: D.sum(p.key, m) }))));
    const s = D.source(p.key);
    return U.details(p.name, s.state === 'connected' ? 'No rows in this period' : 'Awaiting data', `<div class="pad">${U.awaiting(p.key, s.provides)}${s.connect ? `<p class="card-note">How to connect: ${U.esc(s.connect)}</p>` : ''}</div>`);
  }
  function linkedinOrganic() {
    const U = A.ui, D = A.D;
    const posts = D.snap('linkedin', 'posts');
    if (!posts) return '';
    const tot = D.snap('linkedin', 'page_totals'), loc = D.snap('linkedin', 'follower_locations');
    const t = tot && tot.rows && tot.rows[0];
    const fol = D.M().filter((r) => r.source === 'linkedin' && r.metric === 'followers').sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = fol[fol.length - 1];
    const hasAdmin = (posts.rows || []).some((r) => r.impressions != null);
    const tiles = t ? U.kpiRow([
      U.kpi({ label: 'Followers', source: 'LinkedIn', value: U.fmt(last ? last.value : t.followers), compare: last ? `on ${U.dshort(last.date)}` : U.win(tot.from, tot.to) }),
      U.kpi({ label: 'New followers', source: '30 days', value: U.fmt(t.new_followers), compare: t.new_followers_change ? `${U.esc(t.new_followers_change)} vs prior 30 days` : '' }),
      U.kpi({ label: 'Post impressions', source: '30 days', value: U.fmt(t.impressions), compare: t.impressions_change ? `${U.esc(t.impressions_change)} vs prior 30 days` : '' }),
      U.kpi({ label: 'Page views', source: '30 days', value: U.fmt(t.page_views), compare: t.page_views_change ? `${U.esc(t.page_views_change)} vs prior 30 days` : '' }),
    ], 4) : '';
    const table = hasAdmin
      ? U.table([{ t: 'Date', f: (r) => `<span class="mono">${U.dshort(r.date)}</span>` }, { t: 'Post', k: 'title' }, { t: 'Impressions', num: 1, f: (r) => U.fmt(r.impressions) }, { t: 'Clicks', num: 1, f: (r) => U.fmt(r.clicks) }, { t: 'CTR', num: 1, f: (r) => U.pct(r.ctr) }, { t: 'Reactions', num: 1, f: (r) => U.fmt(r.reactions) }, { t: 'Engagement', num: 1, f: (r) => U.pct(r.engagement_rate) }], posts.rows || [])
      : U.table([{ t: 'Date', f: (r) => `<span class="mono">${U.dshort(r.date)}</span>` }, { t: 'Post', k: 'title' }, { t: 'Reactions', num: 1, f: (r) => U.fmt(r.reactions) }, { t: 'Comments', num: 1, f: (r) => U.fmt(r.comments) }, { t: 'Reposts', num: 1, f: (r) => U.fmt(r.reposts) }], posts.rows || []);
    return U.section('LinkedIn organic', `Think4Ever Global page · ${U.win(posts.from, posts.to)}${loc ? ` · followers in ${(loc.rows || []).slice(0, 4).map((r) => U.esc(r.location)).join(', ')}` : ''}`,
      `${tiles}<div class="detail-group" style="margin-top:16px">${U.details('LinkedIn posts', `${(posts.rows || []).length} posts`, table)}</div>`);
  }

  function render() {
    const U = A.ui, C = A.charts, D = A.D, S = A.S;
    const prev = D.prev();
    const cmp = prev ? `vs previous ${prev.len} days` : 'Since launch · no comparison';
    const days = U.days(S.from, S.to);
    const any = D.anyPaid();
    const m = (from, to) => {
      const spend = D.paidSum('ad_spend', from, to), imp = D.paidSum('ad_impressions', from, to), clk = D.paidSum('ad_clicks', from, to), su = D.signups(from, to);
      return { spend, imp, clk, ctr: imp ? clk / imp : null, cpc: clk ? spend / clk : null, cps: spend && su ? spend / su : null };
    };
    const cur = m(S.from, S.to), p = prev ? m(prev.from, prev.to) : {};
    const spendDay = Object.fromEntries(C.PLATFORMS.map((pf) => [pf.key, D.byDay(pf.key, 'ad_spend')]));
    const aw = 'Meta, LinkedIn or Google Ads';
    const kpis = U.kpiRow(any ? [
      U.kpi({ label: 'Ad Spend', source: 'All platforms', value: U.money(cur.spend), hero: true, delta: U.delta(cur.spend, p.spend, { invert: true }), spark: days.map((d) => C.PLATFORMS.reduce((s, pf) => s + spendDay[pf.key][d], 0)), compare: cmp }),
      U.kpi({ label: 'Impressions', source: 'All platforms', value: U.fmt(cur.imp), delta: U.delta(cur.imp, p.imp), compare: cmp }),
      U.kpi({ label: 'Clicks', source: 'All platforms', value: U.fmt(cur.clk), delta: U.delta(cur.clk, p.clk), compare: cmp }),
      U.kpi({ label: 'Click-through Rate', source: 'Derived', value: U.pct(cur.ctr), delta: U.delta(cur.ctr, p.ctr), compare: 'Clicks / impressions' }),
      U.kpi({ label: 'Cost per Click', source: 'Derived', value: U.money(cur.cpc), delta: U.delta(cur.cpc, p.cpc, { invert: true }), compare: 'Lower is better' }),
      U.kpi({ label: 'Cost per Sign-up', source: 'Derived', value: U.money(cur.cps), delta: U.delta(cur.cps, p.cps, { invert: true }), compare: 'Spend / total sign-ups' }),
    ] : ['Ad Spend', 'Impressions', 'Clicks', 'Click-through Rate', 'Cost per Click', 'Cost per Sign-up'].map((l) => U.kpi({ label: l, source: 'Ads', awaiting: aw, compare: 'No paid campaign has sent data yet. Connect a platform on Data Sources or load its CSV.' })), 6);
    const goals = A.targets.strip(['ad_spend_budget', 'clicks', 'ctr']);

    const bars = C.PLATFORMS.map((pf) => ({ name: pf.name, color: pf.color, value: D.sum(pf.key, 'ad_spend'), label: U.money(D.sum(pf.key, 'ad_spend')), extra: prev ? U.delta(D.sum(pf.key, 'ad_spend'), D.sum(pf.key, 'ad_spend', null, prev.from, prev.to), { invert: true }) : '' }));
    const byPlat = U.card({ title: 'Spend by platform', sub: `${U.money(cur.spend)} total · share and % change`, body: any ? C.hbars(bars, cur.spend) : U.empty('No ad spend yet', 'Spend by platform appears with the first campaign.', 'sack-dollar') });
    const clicksMix = U.card({ title: 'Clicks by platform', sub: `${U.fmt(cur.clk)} clicks`, body: any ? C.mix(C.PLATFORMS.map((pf) => D.sum(pf.key, 'ad_clicks')), C.PLATFORMS, 'clicks') : U.empty('No clicks yet', '', 'arrow-pointer') });
    const chart = U.card({ cls: 'chart-card', title: 'Daily spend by platform', sub: U.win(S.from, S.to), body: any ? C.stacked({ dates: days, keys: C.PLATFORMS, value: (d, i) => spendDay[C.PLATFORMS[i].key][d], label: 'Daily ad spend by platform', fmt: (v) => `$${U.fmt(v)}` }) : U.empty('No spend in this period', 'The chart switches on with the first campaign that sends data.', 'chart-column') });

    const cl = D.snap('clarity', 'live_insights'), libs = D.snap('research', 'ad_libraries');
    const details = `<div class="detail-group">
      ${C.PLATFORMS.map(platformDetail).join('')}
      ${libs ? U.details('Paid activity check (public ad libraries)', U.win(libs.from, libs.to), U.table([{ t: 'Library', k: 'library' }, { t: 'Ads found', num: 1, f: (r) => U.fmt(r.ads) }, { t: 'Reading', k: 'note' }], libs.rows || [])) : ''}
      ${cl ? U.details('Microsoft Clarity', U.win(cl.from, cl.to), U.table([{ t: 'Metric', k: 'metric' }, { t: 'Detail', f: (r) => U.esc(Object.entries(r).filter(([k]) => k !== 'metric').map(([k, v]) => `${k}: ${v}`).join(' · ')) }], (cl.rows || []).slice(0, 30)))
        : U.details('Microsoft Clarity', 'Awaiting data', `<div class="pad">${U.awaiting('clarity', 'Heatmaps, scroll depth, rage and dead clicks on the landing')}</div>`)}
    </div>`;

    return U.section('Social and paid at a glance', `${U.win(S.from, S.to)} · ${cmp} · cost metrics read green when they go down`, kpis)
      + goals
      + `<section class="section grid-2">${byPlat}${clicksMix}</section>`
      + `<section class="section">${chart}</section>`
      + linkedinOrganic()
      + U.section('Details', 'Campaign tables per platform and supporting tools', details);
  }
  A.views.social = { title: 'Social and Paid', render };
})(window.App);

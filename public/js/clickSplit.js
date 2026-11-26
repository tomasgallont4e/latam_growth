'use strict';
// Clicks that open the page vs clicks that never request it, paired with landing sessions by network.
// Shared by the Overview (browser) and the Executive campaign funnel (lib/campaignFunnel.js), so both
// read the same numbers. Reads only stored rows: metric rows and snapshots as api/data returns them.
//
// Per network, in the same window:
//   all clicks          every click the network reports
//   do not open page    clicks that never request the landing (Meta: profile, reactions, expand media;
//                       Google Ads: Gmail video teaser clicks; LinkedIn page: not separable)
//   open the page       Meta outbound clicks; Google Ads clicks minus Gmail video teaser clicks
//   landing sessions    GA4 sessions on go.think4ever.com whose UTM source/medium map to the network
//   lost after click    open the page - landing sessions (the real loss: slow load, back before the tag fires)
// Honesty rules: a network without rows in the window is "No data", never 0; a figure that cannot be
// separated is null with its reason; sessions without a UTM are not given to any network.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./paid'));
  else window.App.clickSplit = factory(window.App.paid);
})(function (paid) {
  // Meta Pixel on go.think4ever.com since GTM version 7 (2026-11-18): Meta landing page views exist from then on.
  const PIXEL_SINCE = '2026-11-18';
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const ratio = (a, b) => (a != null && b != null && b > 0 ? a / b : null);
  const LINKEDIN = ['linkedin', 'linkedin.com', 'lnkd.in', 'www.linkedin.com'];
  const DEVICES = ['Phone', 'Computer', 'Tablet', 'Other'];
  const NAMES = { meta: 'Meta Ads', google_ads: 'Google Ads', linkedin: 'LinkedIn page' };

  // Network of a GA4 session row from its UTM source and medium. Meta and Google Ads only with a paid
  // medium (public/js/paid.js); LinkedIn with any medium except QA/test, because step 2 counts the clicks of
  // the LinkedIn company page posts, which arrive as linkedin / social.
  function networkOf(source, medium) {
    const p = paid.platform(source, medium);
    if (p === 'meta' || p === 'google_ads' || p === 'linkedin') return p;
    if (LINKEDIN.includes(norm(source)) && !/^(qa|test)/.test(norm(medium))) return 'linkedin';
    return null;
  }
  function deviceName(v) {
    const d = norm(v);
    if (d === 'mobile') return 'Phone';
    if (d === 'desktop') return 'Computer';
    if (d === 'tablet') return 'Tablet';
    return 'Other';
  }

  function build(input = {}) {
    const metrics = input.metrics || [];
    const snapshots = input.snapshots || [];
    const from = input.from, to = input.to;
    if (!DAY.test(from || '') || !DAY.test(to || '') || to < from) return { status: 'pending', from: from || null, to: to || null, networks: [], devices: [], total: null, step2: null };
    const inWindow = (d) => DAY.test(d || '') && d >= from && d <= to;
    const rows = (source, metric, f) => metrics.filter((r) => r.source === source && r.metric === metric && inWindow(r.date) && (!f || f(r)));
    const has = (source, metric) => metrics.some((r) => r.source === source && r.metric === metric);
    const sum = (list) => list.reduce((t, r) => t + num(r.value), 0);
    const stamp = (s) => String(s.pulled_at || s._at || s.to || '');
    const latest = (source, key) => snapshots.filter((s) => s.source === source && s.key === key).sort((a, b) => stamp(b).localeCompare(stamp(a)))[0] || null;
    const coverage = (source, key) => { const s = latest(source, key); return (s && (s.rows || [])[0]) || null; };
    const ready = (source, key) => { const c = coverage(source, key); return !!(c && c.available === true); };
    const chunkRows = (source, key) => {
      const head = latest(source, key);
      if (!head) return [];
      const prefix = `${key}_`;
      const index = (s) => Number(String(s.key).slice(prefix.length));
      return snapshots
        .filter((s) => s.source === source && String(s.key || '').startsWith(prefix) && /^\d+$/.test(String(s.key).slice(prefix.length)) && s.from === head.from && s.to === head.to)
        .sort((a, b) => index(a) - index(b))
        .flatMap((s) => s.rows || []);
    };

    // ---------- GA4 landing sessions by network (and device when the device report is synced)
    const deviceReady = ready('ga4', 'landing_device');
    const utmReady = ready('ga4', 'executive_landing_utm');
    const sessionRows = deviceReady ? chunkRows('ga4', 'landing_device') : utmReady ? chunkRows('ga4', 'executive_landing_utm') : [];
    const sessionsBasis = deviceReady ? 'GA4 go.think4ever.com sessions by UTM and device' : utmReady ? 'GA4 go.think4ever.com sessions by UTM (no device split yet)' : null;
    const sessionsBy = new Map();
    const sessionsByDevice = new Map();
    for (const r of sessionRows) {
      if (!inWindow(r.date)) continue;
      const net = networkOf(r.source, r.medium);
      if (!net) continue;
      sessionsBy.set(net, (sessionsBy.get(net) || 0) + num(r.sessions));
      if (deviceReady) {
        const k = `${net}|${deviceName(r.device)}`;
        sessionsByDevice.set(k, (sessionsByDevice.get(k) || 0) + num(r.sessions));
      }
    }
    const sessionsOf = (net) => (deviceReady || utmReady ? sessionsBy.get(net) || 0 : null);

    const finish = (n) => {
      n.sessions = n.status === 'loaded' ? sessionsOf(n.key) : null;
      n.sessions_basis = sessionsBasis;
      if (n.open_page != null && n.sessions != null) {
        n.lost_after_click = Math.max(0, n.open_page - n.sessions);
        n.click_to_session = ratio(n.sessions, n.open_page);
        n.more_sessions_than_clicks = n.sessions > n.open_page;
      } else {
        n.lost_after_click = null; n.click_to_session = null; n.more_sessions_than_clicks = false;
      }
      return n;
    };
    const networks = [];

    // ---------- Meta Ads: all clicks > link clicks (include Instagram profile) > outbound clicks (leave Meta)
    if (has('meta', 'ad_impressions') || has('meta', 'ad_platform_clicks')) {
      const reported = rows('meta', 'ad_impressions').length + rows('meta', 'ad_platform_clicks').length > 0;
      const outboundReady = ready('meta', 'outbound_coverage');
      const all = reported && has('meta', 'ad_platform_clicks') ? sum(rows('meta', 'ad_platform_clicks')) : null;
      const link = reported && has('meta', 'ad_link_clicks') ? sum(rows('meta', 'ad_link_clicks')) : null;
      const open = reported && outboundReady ? sum(rows('meta', 'ad_outbound_clicks')) : null;
      const lpvReady = ready('meta', 'landing_view_coverage') && to >= PIXEL_SINCE;
      const lpvFrom = from > PIXEL_SINCE ? from : PIXEL_SINCE;
      networks.push(finish({
        key: 'meta', name: NAMES.meta, status: reported ? 'loaded' : 'no_data',
        all_clicks: all, link_clicks: link, open_page: open,
        no_page: all != null && open != null ? Math.max(0, all - open) : null,
        page_views: reported && lpvReady ? sum(rows('meta', 'ad_landing_page_views', (r) => r.date >= lpvFrom)) : null,
        page_views_note: lpvReady ? (from < PIXEL_SINCE ? `Meta landing page views count from ${PIXEL_SINCE}, when the Meta Pixel went live.` : null) : 'Meta landing page views need the Meta Pixel (live since 2026-11-18) and the next Meta sync.',
        open_basis: 'Outbound clicks (leave Meta toward the link)',
        no_page_basis: 'Clicks that stay on Instagram or Facebook: profile, reactions, comments, expanding the image',
        note: reported ? (link != null && open != null && link > open ? `${link - open} link clicks went to a destination on Instagram or Facebook (for example the profile), not to the page.` : null) : 'No Meta ad data in these dates.',
      }));
    }

    // ---------- Google Ads: clicks minus Gmail video teaser clicks; device from the click detail report
    if (has('google_ads', 'ad_impressions') || has('google_ads', 'ad_clicks')) {
      const reported = rows('google_ads', 'ad_impressions').length + rows('google_ads', 'ad_clicks').length > 0;
      const all = reported ? sum(rows('google_ads', 'ad_clicks')) : null;
      const detailReady = ready('google_ads', 'ad_click_detail');
      const detail = detailReady ? chunkRows('google_ads', 'ad_click_detail').filter((r) => inWindow(r.date)) : [];
      const teaser = (r) => r.kind === 'video' && String(r.network || '').toUpperCase() === 'GMAIL';
      const noPage = reported && detailReady ? detail.filter(teaser).reduce((t, r) => t + num(r.clicks), 0) : null;
      const n = finish({
        key: 'google_ads', name: NAMES.google_ads, status: reported ? 'loaded' : 'no_data',
        all_clicks: all, link_clicks: null,
        open_page: all == null ? null : Math.max(0, all - (noPage || 0)),
        no_page: noPage, page_views: null, page_views_note: null,
        open_basis: detailReady ? 'Clicks on image ads (a Gmail image ad click opens the page)' : 'All Google Ads clicks (video teaser clicks not separated yet)',
        no_page_basis: 'Clicks on Gmail video ads: they open the video, not the page',
        note: reported ? (detailReady ? null : 'Device and ad type split pending the next Google Ads sync.') : 'No Google Ads data in these dates.',
      });
      // Clicks that open the page and sessions by device: phones against computers is the load-loss test.
      if (reported && detailReady) {
        const byDevice = new Map();
        for (const r of detail) {
          if (teaser(r)) continue;
          const d = deviceName(r.device);
          byDevice.set(d, (byDevice.get(d) || 0) + num(r.clicks));
        }
        n.devices = DEVICES.map((d) => {
          const clicks = byDevice.get(d) || 0;
          const sessions = deviceReady ? sessionsByDevice.get(`google_ads|${d}`) || 0 : null;
          return { device: d, open_page: clicks, sessions, lost_after_click: sessions == null ? null : Math.max(0, clicks - sessions), click_to_session: ratio(sessions, clicks), more_sessions_than_clicks: sessions != null && sessions > clicks };
        }).filter((x) => x.open_page || x.sessions);
      }
      networks.push(n);
    }

    // ---------- LinkedIn company page: every click on a post; the API does not say which ones open a link
    if (has('linkedin', 'post_clicks')) {
      const list = rows('linkedin', 'post_clicks');
      const reported = list.length > 0 || rows('linkedin', 'post_impressions').length > 0;
      networks.push(finish({
        key: 'linkedin', name: NAMES.linkedin, status: reported ? 'loaded' : 'no_data',
        all_clicks: reported ? sum(list) : null, link_clicks: null, open_page: null, no_page: null,
        page_views: null, page_views_note: null,
        open_basis: null, no_page_basis: null,
        note: reported ? 'LinkedIn reports every click on a post (text, image, company name) and does not separate the clicks on the link.' : 'No LinkedIn page data in these dates.',
      }));
    }

    // ---------- total over the networks where both sides are known (the real loss after a click)
    const paired = networks.filter((n) => n.status === 'loaded' && n.open_page != null && n.sessions != null);
    const total = paired.length ? (() => {
      const open = paired.reduce((t, n) => t + n.open_page, 0);
      const sessions = paired.reduce((t, n) => t + n.sessions, 0);
      return { networks: paired.map((n) => n.name), open_page: open, sessions, lost_after_click: Math.max(0, open - sessions), click_to_session: ratio(sessions, open) };
    })() : null;

    // ---------- what the Overview step 2 adds: Meta outbound + Google Ads clicks + LinkedIn page post clicks
    const meta = networks.find((n) => n.key === 'meta' && n.status === 'loaded');
    const google = networks.find((n) => n.key === 'google_ads' && n.status === 'loaded');
    const linkedin = networks.find((n) => n.key === 'linkedin' && n.status === 'loaded');
    const parts = [meta && meta.open_page, google && google.all_clicks, linkedin && linkedin.all_clicks].filter((v) => v != null);
    const step2 = parts.length ? {
      counted: parts.reduce((t, v) => t + v, 0),
      open_page: (meta && meta.open_page || 0) + (google && google.open_page || 0),
      no_page: google && google.no_page != null ? google.no_page : null,
      not_separable: linkedin ? linkedin.all_clicks : 0,
    } : null;

    return { status: 'loaded', from, to, sessions_basis: sessionsBasis, networks, total, step2 };
  }

  return { build, networkOf, deviceName, PIXEL_SINCE, DEVICES };
});

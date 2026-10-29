'use strict';
/* Social and Paid: spend, clicks, CTR and attributed acquisition costs (a cost drop is good),
   spend by platform, daily spend, per-platform campaigns, LinkedIn organic, where Clarity
   sessions opened, and ad library checks. */
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

  // Clarity's export is always the last 72 hours. Percents from the API are 0–100, not fractions.
  const HEALTH = [
    ['ScriptErrorCount', 'Script errors', 'The page hit a code error', 'errors'],
    ['DeadClickCount', 'Dead clicks', 'Taps that did nothing', 'clicks'],
    ['RageClickCount', 'Rage clicks', 'The same spot tapped again and again', 'clicks'],
    ['QuickbackClick', 'Quick backs', 'Left again immediately', 'backs'],
    ['ErrorClickCount', 'Error clicks', 'A tap that caused an error', 'clicks'],
    ['ExcessiveScroll', 'Excessive scrolling', 'Scrolling up and down without a click', 'sessions'],
  ];
  const WATCH_AT = 5;
  function clarityNum(v) {
    const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  function clarityRows(snap, metric) {
    return ((snap && snap.rows) || []).filter((r) => r.metric === metric);
  }
  function clarityField(row, names) {
    for (const name of names) if (row && row[name] != null && String(row[name]) !== '') return row[name];
    return '';
  }
  function apiPct(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '–';
    return `${x.toFixed(x > 0 && x < 10 ? 1 : 0)}%`;
  }
  function browserLabel(name) {
    const known = {
      InstagramApp: 'Instagram app', FacebookApp: 'Facebook app', ChromeMobile: 'Chrome on mobile',
      MobileSafari: 'Safari on iPhone', SamsungInternet: 'Samsung Internet', Chrome: 'Chrome',
      Edge: 'Edge', Firefox: 'Firefox', Safari: 'Safari', Other: 'Other',
    };
    if (known[name]) return known[name];
    return String(name || 'Unknown').replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  function deviceLabel(name) {
    const s = String(name || '');
    if (/^mobile$/i.test(s)) return 'Phone';
    if (/^tablet$/i.test(s)) return 'Tablet';
    if (/^(pc|desktop)$/i.test(s)) return 'Desktop';
    return s || 'Unknown';
  }
  function browserColor(name) {
    const s = String(name).toLowerCase();
    if (s.includes('instagram') || s.includes('facebook')) return 'var(--pf-meta)';
    if (s.includes('chrome')) return 'var(--series-a)';
    if (s.includes('safari')) return 'var(--ch-referral)';
    if (s.includes('samsung')) return 'var(--ch-paid-search)';
    return 'var(--ch-other)';
  }
  function deviceColor(name) {
    const s = String(name).toLowerCase();
    if (s === 'mobile' || s === 'phone') return 'var(--pf-meta)';
    if (s === 'tablet') return 'var(--series-b)';
    return 'var(--series-a)';
  }
  function inApp(name) { return /instagram|facebook/i.test(String(name || '')); }
  // totalTime and activeTime are seconds. A figure larger than half an hour, whose
  // per-session value is still plausible, is a sum across sessions.
  function asAverageSeconds(value, sessions) {
    const n = clarityNum(value);
    if (n == null) return null;
    if (sessions > 1 && n > 1800) {
      const per = n / sessions;
      if (per <= 1800) return per;
    }
    return n;
  }
  function secondsLabel(n) {
    if (n == null || !Number.isFinite(n)) return '–';
    if (n >= 90) return `${Math.round(n / 60)} min`;
    return `${Math.round(n)}s`;
  }
  function pageParts(raw) {
    const s = String(raw || '').trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
    const m = withScheme.match(/^https?:\/\/([^/?#]+)([^?#]*)/i);
    if (!m) return { host: '', path: '', short: s.slice(0, 90) };
    const host = m[1].toLowerCase();
    const path = (m[2] || '/').toLowerCase();
    const clean = path.replace(/\/$/, '') || '/';
    return { host, path, short: `${host}${clean}` };
  }
  function pageKind(url) {
    const p = pageParts(url);
    if (!p.host) return '';
    if (p.host.startsWith('portal.') || p.host.includes('.portal.') || /\/(login|log-in|signin|sign-in)\b/.test(p.path)) return 'Login';
    if (p.host.startsWith('go.')) return 'Landing';
    return 'Site';
  }
  function clarityReading(metaShare, mobileShare, scroll) {
    const where = metaShare >= 0.5
      ? 'Most visitors open the ad inside Instagram or Facebook'
      : metaShare >= 0.25
        ? 'Many visitors open the ad inside Instagram or Facebook'
        : 'Visitors arrive from a mix of browsers';
    const device = mobileShare >= 0.8 ? 'on a phone' : mobileShare >= 0.5 ? 'mostly on a phone' : '';
    const end = scroll != null && scroll < 25 ? 'and leave before the first screen' : scroll != null && scroll < 50 ? 'and only read part of the page' : '';
    const tail = [device, end].filter(Boolean).join(' ');
    return tail ? `${where} ${tail}.` : `${where}.`;
  }
  function totalRow(snap, metric) {
    const dim = ['Browser', 'Device', 'OS', 'Channel', 'Campaign', 'Url', 'URL', 'Country/Region', 'Source', 'Medium', 'name'];
    const rows = clarityRows(snap, metric);
    return rows.find((r) => !clarityField(r, dim)) || rows[0] || null;
  }
  function shareRows(rows, labelOf, colorOf) {
    const items = rows.map((r) => {
      const raw = String(clarityField(r, ['name', 'Name', 'Browser', 'Device', 'OS', 'Country/Region', 'Country']) || '');
      return { raw, name: labelOf(raw), value: clarityNum(r.sessionsCount) || clarityNum(r.totalSessionCount) || 0, color: colorOf(raw) };
    }).filter((r) => r.raw).sort((a, b) => b.value - a.value);
    return { items, total: items.reduce((s, r) => s + r.value, 0) };
  }
  function rowSig(r) {
    return ['Channel', 'Campaign', 'Browser', 'Device', 'OS'].map((k) => clarityField(r, [k])).concat([urlOf(r)]).join('|');
  }
  function clarityGroups(snap, keyFn) {
    const sessionsBySig = new Map();
    const groups = new Map();
    for (const r of clarityRows(snap, 'Traffic')) {
      const key = keyFn(r);
      if (!key) continue;
      sessionsBySig.set(rowSig(r), clarityNum(r.totalSessionCount) || 0);
      const g = groups.get(key) || { key, sessions: 0, sample: r };
      g.sessions += clarityNum(r.totalSessionCount) || 0;
      groups.set(key, g);
    }
    const weightOf = (r) => clarityNum(r.sessionsCount) || clarityNum(r.totalSessionCount) || sessionsBySig.get(rowSig(r)) || 1;
    const weighted = (metric, read) => {
      const map = new Map();
      for (const r of clarityRows(snap, metric)) {
        const key = keyFn(r);
        const v = read(r);
        if (!key || v == null) continue;
        const w = weightOf(r);
        const a = map.get(key) || { s: 0, w: 0 };
        a.s += v * w;
        a.w += w;
        map.set(key, a);
      }
      return map;
    };
    const scroll = weighted('ScrollDepth', (r) => clarityNum(r.averageScrollDepth));
    const errors = weighted('ScriptErrorCount', (r) => clarityNum(r.sessionsWithMetricPercentage));
    const dead = weighted('DeadClickCount', (r) => clarityNum(r.sessionsWithMetricPercentage));
    const take = (map, key) => (map.get(key) && map.get(key).w ? map.get(key).s / map.get(key).w : null);
    return [...groups.values()].map((g) => ({ ...g, scroll: take(scroll, g.key), errors: take(errors, g.key), dead: take(dead, g.key) }))
      .sort((a, b) => b.sessions - a.sessions);
  }
  function channelOf(r) { return String(clarityField(r, ['Channel']) || 'Unknown'); }
  function campaignOf(r) {
    const c = String(clarityField(r, ['Campaign']) || '');
    if (!c || c === 'null' || c === '(not set)') return 'Not tagged';
    return c;
  }
  function urlOf(r) { return String(clarityField(r, ['Url', 'URL']) || ''); }
  function popularPages(snap) {
    return (snap.rows || []).filter((r) => r.metric === 'PopularPages' || r.metric === 'PageTitle').map((r) => {
      const url = String(clarityField(r, ['url', 'Url', 'URL', 'name', 'pageTitle', 'PageTitle']) || '');
      return { url, sessions: clarityNum(clarityField(r, ['sessionsCount', 'visitsCount', 'totalSessionCount'])) || 0, kind: pageKind(url) };
    }).filter((r) => r.url).sort((a, b) => b.sessions - a.sessions).slice(0, 8);
  }
  function browserHealth(snap) {
    const scroll = new Map(clarityRows(snap, 'ScrollDepth').map((r) => [String(clarityField(r, ['Browser', 'name'])), clarityNum(r.averageScrollDepth)]));
    return clarityRows(snap, 'ScriptErrorCount').map((r) => {
      const raw = String(clarityField(r, ['Browser', 'name']) || '');
      return { name: browserLabel(raw), sessions: clarityNum(r.sessionsCount) || 0, errors: clarityNum(r.sessionsWithMetricPercentage), scroll: scroll.has(raw) ? scroll.get(raw) : null };
    }).filter((r) => r.name).sort((a, b) => b.sessions - a.sessions).slice(0, 8);
  }
  function barCard(title, sub, share) {
    const U = A.ui, C = A.charts;
    const bars = share.items.map((r) => ({ name: r.name, color: r.color, value: r.value, label: U.fmt(r.value) }));
    return U.card({ title, sub, body: bars.length ? C.hbars(bars, share.total) : U.empty('Nothing to show yet') });
  }
  function claritySection() {
    const U = A.ui, D = A.D;
    const cl = D.snap('clarity', 'live_insights');
    const sub = 'Last 72 hours · Microsoft Clarity · this window does not follow the date picker, and these are not GA4 sessions';
    if (!cl) return U.section('Where visitors open the site', sub, `<div class="card">${U.awaiting('clarity', 'Where sessions open, how far people scroll, and whether the page throws errors.')}</div>`);
    const traffic = totalRow(cl, 'Traffic') || {};
    const scrollRow = totalRow(cl, 'ScrollDepth') || {};
    const timeRow = totalRow(cl, 'EngagementTime') || {};
    const sessions = clarityNum(traffic.totalSessionCount);
    const people = clarityNum(clarityField(traffic, ['distinctUserCount', 'distantUserCount']));
    const bots = clarityNum(traffic.totalBotSessionCount) || 0;
    const pages = clarityNum(clarityField(traffic, ['pagesPerSessionPercentage', 'PagesPerSessionPercentage']));
    const scroll = clarityNum(scrollRow.averageScrollDepth);
    const active = asAverageSeconds(timeRow.activeTime, sessions);
    const browsers = shareRows(clarityRows(cl, 'Browser'), browserLabel, browserColor);
    const devices = shareRows(clarityRows(cl, 'Device'), deviceLabel, deviceColor);
    const metaSessions = browsers.items.filter((r) => inApp(r.raw)).reduce((s, r) => s + r.value, 0);
    const metaShare = browsers.total ? metaSessions / browsers.total : null;
    const phone = devices.items.filter((r) => r.raw.toLowerCase() === 'mobile' || r.name === 'Phone').reduce((s, r) => s + r.value, 0);
    const mobileShare = devices.total ? phone / devices.total : null;
    const botNote = sessions && bots / sessions >= 0.05 ? ` · ${U.fmt(bots)} of these are bots` : '';
    const kpis = U.kpiRow([
      U.kpi({ label: 'Sessions', source: 'Clarity', value: U.fmt(sessions), compare: `${U.fmt(people)} people${botNote}` }),
      U.kpi({ label: 'Inside Instagram or Facebook', source: 'Clarity', value: metaShare == null ? '–' : U.pct(metaShare), compare: browsers.total ? `${U.fmt(metaSessions)} of ${U.fmt(browsers.total)} sessions` : '' }),
      U.kpi({ label: 'On a phone', source: 'Clarity', value: mobileShare == null ? '–' : U.pct(mobileShare), compare: devices.total ? `${U.fmt(phone)} sessions` : '' }),
      U.kpi({ label: 'How far they scrolled', source: 'Clarity', value: apiPct(scroll), compare: `${secondsLabel(active)} active · ${pages == null ? '–' : pages.toFixed(1)} pages per session` }),
    ], 4);
    const reading = clarityReading(metaShare || 0, mobileShare || 0, scroll);
    const os = shareRows(clarityRows(cl, 'OS'), (n) => n || 'Unknown', () => 'var(--series-b)');
    const country = shareRows((cl.rows || []).filter((r) => r.metric === 'Country' || r.metric === 'Country/Region'), (n) => n || 'Unknown', () => 'var(--ch-organic-search)');
    const refs = (cl.rows || []).filter((r) => r.metric === 'ReferrerUrl' || r.metric === 'ReferrerURL' || r.metric === 'Referrer')
      .map((r) => ({ name: String(clarityField(r, ['name', 'url', 'Url', 'URL']) || ''), value: clarityNum(r.sessionsCount) || 0 }))
      .filter((r) => r.name).sort((a, b) => b.value - a.value).slice(0, 4);
    const refNote = refs.length ? ` Top referrers: ${refs.map((r) => r.name).join(', ')}.` : '';
    const charts = [barCard('App or browser', `${U.fmt(browsers.total)} sessions${refNote}`, browsers), barCard('Device', `${U.fmt(devices.total)} sessions`, devices)];
    if (os.items.length) charts.push(barCard('Operating system', `${U.fmt(os.total)} sessions`, os));
    if (country.items.length) charts.push(barCard('Country', `${U.fmt(country.total)} sessions`, country));
    const opened = U.section('Where visitors open the site', `${sub} · ${U.win(cl.from, cl.to)}`, `${kpis}<p class="clarity-read">${U.esc(reading)}</p><div class="grid-2" style="margin-top:16px">${charts.join('')}</div>`);

    const health = U.kpiRow(HEALTH.map(([metric, label, hint, unit]) => {
      const row = totalRow(cl, metric) || {};
      const rate = clarityNum(row.sessionsWithMetricPercentage);
      const count = clarityNum(row.subTotal);
      const views = clarityNum(row.pagesViews);
      const watch = rate != null && rate >= WATCH_AT;
      const noun = (n, word) => `${U.fmt(n)} ${n === 1 ? word.replace(/s$/, '') : word}`;
      const compare = count ? `${noun(count, unit)}${views ? ` · ${noun(views, 'page views')}` : ''}` : 'None in this window';
      return U.kpi({ label, source: 'Clarity', value: apiPct(rate), cls: watch ? 'watch' : '', compare: `${compare} · ${hint}` });
    }), 3);
    const byBrowser = D.snap('clarity', 'by_browser');
    const perApp = byBrowser ? browserHealth(byBrowser) : [];
    const appTable = perApp.length ? `<div class="detail-group" style="margin-top:16px">${U.card({ title: 'Script errors by app', sub: 'Same 72 hours, split by browser · amber when 5% or more of that app’s sessions hit an error', body: U.table([
      { t: 'App', k: 'name' }, { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Script errors', num: 1, f: (r) => apiPct(r.errors) }, { t: 'Scroll', num: 1, f: (r) => apiPct(r.scroll) },
    ], perApp, (r) => (r.errors != null && r.errors >= WATCH_AT ? 'watch-row' : '')) })}</div>` : '';
    const worked = U.section('Whether the page worked', 'Share of sessions · amber at 5% or more · this is the landing Clarity records, not what people do after login', health + appTable + '<p class="card-note">Dead clicks, rage clicks and quick backs say the page frustrated someone. Script errors say the page failed to run, which matters most inside an in-app browser.</p>');

    const byAcq = D.snap('clarity', 'by_acquisition');
    const waiting = '<p class="card-note">Campaign and page detail arrives on the next Clarity sync.</p>';
    let campaignCard, pageCard;
    if (byAcq && clarityRows(byAcq, 'Traffic').length) {
      const campaigns = clarityGroups(byAcq, (r) => `${channelOf(r)}|${campaignOf(r)}`).slice(0, 8).map((g) => ({ channel: channelOf(g.sample), campaign: campaignOf(g.sample), sessions: g.sessions, scroll: g.scroll, errors: g.errors }));
      const pages = clarityGroups(byAcq, urlOf).filter((g) => g.key).slice(0, 8).map((g) => ({ url: pageParts(g.key).short, kind: pageKind(g.key), sessions: g.sessions, scroll: g.scroll, dead: g.dead, errors: g.errors }));
      campaignCard = U.card({ title: 'Campaigns that opened', sub: 'Channel and campaign · sessions can land on more than one page', body: U.table([
        { t: 'Channel', k: 'channel' }, { t: 'Campaign', k: 'campaign' }, { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Scroll', num: 1, f: (r) => apiPct(r.scroll) }, { t: 'Script errors', num: 1, f: (r) => apiPct(r.errors) },
      ], campaigns) });
      pageCard = U.card({ title: 'Pages they opened', sub: 'Login is the portal or a login path · landing is go.think4ever.com', body: U.table([
        { t: 'Page', k: 'url' }, { t: 'Kind', f: (r) => (r.kind ? U.pill(r.kind === 'Login' ? 'warning' : r.kind === 'Landing' ? 'success' : 'neutral', r.kind) : '') },
        { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }, { t: 'Scroll', num: 1, f: (r) => apiPct(r.scroll) }, { t: 'Dead clicks', num: 1, f: (r) => apiPct(r.dead) }, { t: 'Script errors', num: 1, f: (r) => apiPct(r.errors) },
      ], pages) });
    } else {
      const popular = popularPages(cl);
      campaignCard = U.card({ title: 'Campaigns that opened', sub: 'Channel and campaign', body: waiting });
      pageCard = U.card({
        title: 'Pages they opened', sub: popular.length ? 'From the Clarity page list · scroll and errors arrive with the next sync' : 'Landing, login, or another page',
        body: popular.length ? U.table([{ t: 'Page', f: (r) => U.esc(pageParts(r.url).short) }, { t: 'Kind', f: (r) => (r.kind ? U.pill(r.kind === 'Login' ? 'warning' : r.kind === 'Landing' ? 'success' : 'neutral', r.kind) : '') }, { t: 'Sessions', num: 1, f: (r) => U.fmt(r.sessions) }], popular) : waiting,
      });
    }
    const which = U.section('Which ad, and which page', 'Last 72 hours · a campaign session and a login session stay separate', `<div class="grid-2">${campaignCard}${pageCard}</div>`);
    return opened + worked + which;
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
    const rawRows = (cl && cl.rows || []).slice(0, 80);
    const details = `<div class="detail-group">
      ${C.PLATFORMS.map(platformDetail).join('')}
      ${libs ? U.details('Paid activity check (public ad libraries)', U.win(libs.from, libs.to), U.table([{ t: 'Library', k: 'library' }, { t: 'Ads found', num: 1, f: (r) => U.fmt(r.ads) }, { t: 'Reading', k: 'note' }], libs.rows || [])) : ''}
      ${cl ? U.details('Microsoft Clarity export', U.win(cl.from, cl.to), U.table([{ t: 'Metric', k: 'metric' }, { t: 'Detail', f: (r) => U.esc(Object.entries(r).filter(([k]) => k !== 'metric').map(([k, v]) => `${k}: ${v}`).join(' · ')) }], rawRows))
        : ''}
    </div>`;

    return U.section('Social and paid at a glance', `${U.win(S.from, S.to)} · ${cmp} · cost metrics read green when they go down`, kpis)
      + goals
      + `<section class="section">${unitCosts}</section>`
      + `<section class="section">${attribution}</section>`
      + `<section class="section grid-2">${byPlat}${clicksMix}</section>`
      + `<section class="section">${chart}</section>`
      + linkedinOrganic()
      + claritySection()
      + U.section('Details', 'Campaign tables per platform, and the raw Clarity export', details);
  }
  A.views.social = { title: 'Social and Paid', render };
})(window.App);

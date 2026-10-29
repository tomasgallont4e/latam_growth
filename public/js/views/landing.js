'use strict';
/* Landing: where Clarity sessions opened, whether the page worked, and which ad or page. */
(function (A) {
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

  function render() { return claritySection(); }
  A.views.landing = { title: 'Landing', render };
})(window.App);

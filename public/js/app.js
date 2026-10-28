'use strict';
/* Boot, shared state, header controls and the data helpers every screen uses.
   All numbers come from api/data (connectors, CSV loads, daily routine) — nothing is invented here. */
(function (A) {
  const U = A.ui;
  const LAUNCH = A.LAUNCH = '2026-10-01';
  const S = A.S = { data: null, tab: 'overview', grain: 'day', from: LAUNCH, to: U.today(), exInt: true, me: null, goalCountry: 'Colombia' };

  // ---------- data helpers
  const D = A.D = {};
  const inR = (d, f, t) => d >= f && d <= t;
  D.M = () => (S.data && S.data.metrics) || [];
  D.sum = (src, metric, filter, from = S.from, to = S.to) => {
    let s = 0;
    for (const r of D.M()) if (r.source === src && r.metric === metric && inR(r.date, from, to) && (!filter || filter(r))) s += Number(r.value) || 0;
    return s;
  };
  D.has = (src, metric) => D.M().some((r) => r.source === src && r.metric === metric);
  D.byDay = (src, metric, from = S.from, to = S.to, filter) => {
    const out = {};
    for (const d of U.days(from, to)) out[d] = 0;
    for (const r of D.M()) if (r.source === src && r.metric === metric && inR(r.date, from, to) && (!filter || filter(r))) out[r.date] += Number(r.value) || 0;
    return out;
  };
  D.byDim = (src, metric, from = S.from, to = S.to) => {
    const out = {};
    for (const r of D.M()) if (r.source === src && r.metric === metric && inR(r.date, from, to)) out[r.dim_value || 'Total'] = (out[r.dim_value || 'Total'] || 0) + (Number(r.value) || 0);
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  };
  // GA4 stores daily country rows independently of its aggregate snapshots.
  // They are the only live country readout we currently have; do not infer an
  // account country from a PostHog person without an explicit country property.
  D.countryMetric = (metric, country, from = S.from, to = S.to) => D.sum(
    'ga4', metric,
    (r) => r.dim === 'country' && r.dim_value === country,
    from, to,
  );
  D.countrySnapshot = (country, from = S.from, to = S.to) => {
    const s = D.snap('ga4', 'countries', from, to);
    return s && (s.rows || []).find((r) => r.country === country);
  };
  // Snapshot (table pulled for a fixed window): exact window first, then the best overlap, then the latest.
  D.snap = (src, key, from = S.from, to = S.to) => {
    const list = ((S.data && S.data.snapshots) || []).filter((s) => s.source === src && s.key === key);
    if (!list.length) return null;
    const exact = list.find((s) => s.from === from && s.to === to); if (exact) return exact;
    const ov = (s) => Math.max(0, U.diffDays(s.from > from ? s.from : from, s.to < to ? s.to : to) + 1);
    return list.slice().sort((a, b) => ov(b) - ov(a) || (b.to > a.to ? 1 : b.to < a.to ? -1 : 0) || U.diffDays(b.from, b.to) - U.diffDays(a.from, a.to))[0];
  };
  D.snapIn = (src, key, from, to) => { const s = D.snap(src, key, from, to); return s && s.from <= to && s.to >= from ? s : null; };
  D.source = (key) => ((S.data && S.data.sources) || []).find((s) => s.key === key) || { key, name: key, state: 'pending' };
  D.forms = (from = S.from, to = S.to) => ((S.data && S.data.events) || []).filter((e) => e.kind === 'form_signup' && inR(e.date, from, to) && (!S.exInt || !e.internal));
  D.formsAll = (from = S.from, to = S.to) => ((S.data && S.data.events) || []).filter((e) => e.kind === 'form_signup' && inR(e.date, from, to));
  D.platform = (from = S.from, to = S.to) => (D.has('posthog', 'ph_new_persons') ? D.sum('posthog', 'ph_new_persons', (r) => !S.exInt || r.dim_value !== 'Internal', from, to) : null);
  D.sessions = (from = S.from, to = S.to) => D.sum('hubspot', 'sessions', null, from, to);
  D.signups = (from = S.from, to = S.to) => D.forms(from, to).length + (D.platform(from, to) || 0);
  const GRAIN_META = {
    day: { name: 'Daily', bar: 'day' },
    week: { name: 'Weekly', bar: 'week' },
    biweek: { name: 'Bi-weekly', bar: 'two weeks' },
    month: { name: 'Monthly', bar: 'month' },
    quarter: { name: 'Quarterly', bar: 'quarter' },
    year: { name: 'Yearly', bar: 'year' },
  };
  D.grain = () => (GRAIN_META[S.grain] ? S.grain : 'day');
  D.grainName = () => GRAIN_META[D.grain()].name;
  D.grainBar = () => GRAIN_META[D.grain()].bar;
  D.ticks = (from = S.from, to = S.to) => U.ticks(from, to, D.grain(), LAUNCH);
  const bucketOf = (d) => U.bucketKey(d, D.grain(), LAUNCH);
  // Sum a day-keyed number map onto the active temporality. Daily keeps one point per day.
  D.series = (byDay) => {
    const ticks = D.ticks();
    if (D.grain() === 'day') return ticks.map((t) => Number(byDay && byDay[t]) || 0);
    const sums = Object.fromEntries(ticks.map((t) => [t, 0]));
    for (const [d, v] of Object.entries(byDay || {})) {
      const k = bucketOf(d);
      if (sums[k] != null) sums[k] += Number(v) || 0;
    }
    return ticks.map((t) => sums[t]);
  };
  D.seriesRate = (numDay, denDay) => {
    const n = D.series(numDay), d = D.series(denDay);
    return n.map((v, i) => (d[i] ? v / d[i] : 0));
  };
  D.rollNum = (byDay) => {
    if (D.grain() === 'day') return byDay;
    const out = Object.fromEntries(D.ticks().map((t) => [t, 0]));
    for (const [d, v] of Object.entries(byDay || {})) if (out[bucketOf(d)] != null) out[bucketOf(d)] += Number(v) || 0;
    return out;
  };
  D.rollChannels = (byDay) => {
    if (D.grain() === 'day') return byDay;
    const out = Object.fromEntries(D.ticks().map((t) => [t, Array(8).fill(0)]));
    for (const [d, arr] of Object.entries(byDay || {})) {
      const bucket = out[bucketOf(d)];
      if (bucket) arr.forEach((v, i) => { bucket[i] += Number(v) || 0; });
    }
    return out;
  };
  D.rollSignups = (byDay) => {
    if (D.grain() === 'day') return byDay;
    const out = Object.fromEntries(D.ticks().map((t) => [t, { form: 0, platform: 0 }]));
    for (const [d, row] of Object.entries(byDay || {})) {
      const bucket = out[bucketOf(d)];
      if (!bucket) continue;
      bucket.form += row.form || 0;
      bucket.platform += row.platform || 0;
    }
    return out;
  };
  // The window is always launch through today, so there is no earlier stretch to compare.
  D.prev = () => null;
  D.versus = () => 'Since launch';
  D.channels = (from = S.from, to = S.to) => {
    const out = Array(8).fill(0);
    for (const r of D.M()) if (r.source === 'hubspot' && r.metric === 'sessions' && inR(r.date, from, to)) out[A.charts.channelOf(r.dim_value)] += Number(r.value) || 0;
    return out;
  };
  D.dailyChannels = (from = S.from, to = S.to) => {
    const out = {};
    for (const d of U.days(from, to)) out[d] = Array(8).fill(0);
    for (const r of D.M()) if (r.source === 'hubspot' && r.metric === 'sessions' && inR(r.date, from, to)) out[r.date][A.charts.channelOf(r.dim_value)] += Number(r.value) || 0;
    return out;
  };
  D.dailySignups = (from = S.from, to = S.to) => {
    const out = {};
    for (const d of U.days(from, to)) out[d] = { form: 0, platform: 0 };
    for (const e of D.forms(from, to)) if (out[e.date]) out[e.date].form += 1;
    if (D.has('posthog', 'ph_new_persons')) {
      const p = D.byDay('posthog', 'ph_new_persons', from, to, (r) => !S.exInt || r.dim_value !== 'Internal');
      for (const d of Object.keys(p)) if (out[d]) out[d].platform = p[d];
    }
    return out;
  };
  D.ga4Event = (name, from = S.from, to = S.to) => {
    if (D.has('ga4', 'ga_event')) return { count: D.sum('ga4', 'ga_event', (r) => r.dim_value === name, from, to), users: null, label: U.win(from, to) };
    const s = D.snap('ga4', 'events', from, to);
    if (!s) return null;
    const row = (s.rows || []).find((r) => r.event === name) || { count: 0, users: 0 };
    return { count: row.count, users: row.users, label: U.win(s.from, s.to) };
  };
  // ---------- GA4 by period
  // totalUsers and newUsers are not additive across days or channels. Headline counts come
  // from a deduped totals snapshot. New users may also be the sum of site-wide daily rows
  // (one first visit per person). Channel rows are never added into a visitor total.
  const gaSnaps = () => ((S.data && S.data.snapshots) || []).filter((s) => s.source === 'ga4' && s.key === 'totals' && s.rows && s.rows[0]);
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  D.gaWindow = () => gaSnaps().slice().sort((a, b) => U.diffDays(b.from, b.to) - U.diffDays(a.from, a.to) || (a.from < b.from ? -1 : 1))[0] || null;
  D.gaExact = (from = S.from, to = S.to) => gaSnaps().find((s) => s.from === from && s.to === to) || null;
  // True when the selected range contains the whole synced window, so that window's total applies.
  D.gaCovers = (from = S.from, to = S.to) => {
    const s = D.gaWindow(); if (!s) return false;
    return from <= s.from && D.sum('ga4', 'ga_sessions', null, U.addDays(to, 1), s.to) === 0;
  };
  const siteUser = (r) => r.dim !== 'channel';
  D.ga = (from = S.from, to = S.to) => {
    const has = D.has('ga4', 'ga_sessions');
    const snap = D.gaExact(from, to) || (D.gaCovers(from, to) ? D.gaWindow() : null);
    const row = snap && snap.rows[0];
    if (!has && !row) return null;
    const sessions = has ? D.sum('ga4', 'ga_sessions', null, from, to) : num(row.sessions);
    const engaged = has ? D.sum('ga4', 'ga_engaged_sessions', null, from, to) : num(row.engaged_sessions);
    const hasSiteNew = D.M().some((r) => r.source === 'ga4' && r.metric === 'ga_new_users' && siteUser(r) && inR(r.date, from, to));
    return {
      sessions, engaged, rate: sessions ? engaged / sessions : (row ? num(row.engagement_rate) : null),
      users: row ? num(row.users) : null, usersExact: !!row,
      newUsers: row ? num(row.new_users) : (hasSiteNew ? D.sum('ga4', 'ga_new_users', siteUser, from, to) : null),
    };
  };
  D.group = (rows, keyFn, fields) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r); if (k == null) continue;
      const o = m.get(k) || Object.assign({ key: k }, ...fields.map((f) => ({ [f]: 0 })));
      fields.forEach((f) => { o[f] += Number(r[f]) || 0; });
      m.set(k, o);
    }
    return [...m.values()];
  };
  D.gaChannels = (from = S.from, to = S.to) => {
    const out = {};
    for (const [metric, f] of [['ga_sessions', 'sessions'], ['ga_engaged_sessions', 'engaged_sessions']]) {
      for (const r of D.M()) if (r.source === 'ga4' && r.metric === metric && inR(r.date, from, to)) {
        const k = r.dim_value || '(not set)';
        out[k] = out[k] || { channel: k, sessions: 0, engaged_sessions: 0 };
        out[k][f] += Number(r.value) || 0;
      }
    }
    return Object.values(out).sort((a, b) => b.sessions - a.sessions);
  };
  D.gaEvents = (from = S.from, to = S.to) => D.byDim('ga4', 'ga_event', from, to).map(([event, count]) => ({ event, count }));
  D.gaCountries = (from = S.from, to = S.to) => {
    const out = {};
    for (const [metric, f] of [['ga_geo_sessions', 'sessions'], ['ga_geo_users', 'users'], ['ga_geo_engaged_sessions', 'engaged_sessions'], ['ga_geo_key_events', 'key_events']]) {
      for (const r of D.M()) if (r.source === 'ga4' && r.metric === metric && inR(r.date, from, to)) {
        const k = r.dim_value || '(not set)';
        out[k] = out[k] || { country: k, sessions: 0, users: 0, engaged_sessions: 0, key_events: 0 };
        out[k][f] += Number(r.value) || 0;
      }
    }
    return Object.values(out);
  };
  // GA4 sessions by UTM / landing page / city for the period (snapshot rows carry their date).
  D.utmRows = (from = S.from, to = S.to) => {
    const s = D.snap('ga4', 'utm_attribution');
    return s ? (s.rows || []).filter((r) => inR(r.date, from, to)) : [];
  };
  D.path = (p) => String(p || '(not set)').split('?')[0] || '/';
  // Persona = the pNN prefix of utm_content (p03, p03_video_a -> p03).
  D.persona = (v) => { const m = /^p(\d{1,2})(?!\d)/i.exec(String(v || '').trim()); return m ? `p${m[1].padStart(2, '0')}` : null; };
  D.formPersona = (e) => D.persona(e.first_utm_content) || D.persona(e.utm_content);
  D.formCampaign = (e) => e.first_utm_campaign || e.utm_campaign || '';
  D.PAID = ['meta', 'linkedin', 'google_ads'];
  D.anyPaid = () => D.M().some((r) => D.PAID.includes(r.source) && /^ad_/.test(r.metric));
  D.paidSum = (metric, from = S.from, to = S.to, only) => (only ? [only] : D.PAID).reduce((s, k) => s + D.sum(k, metric, null, from, to), 0);
  // Paid impressions from Meta, LinkedIn and Google Ads, plus organic LinkedIn post impressions.
  // Organic Meta and Google Search impressions are not connected, so they are never filled in.
  D.impressionParts = (from = S.from, to = S.to) => {
    const names = { linkedin: 'LinkedIn', meta: 'Meta', google_ads: 'Google' };
    return D.PAID.map((key) => ({
      key,
      name: names[key] || key,
      paid: D.sum(key, 'ad_impressions', null, from, to),
      organic: key === 'linkedin' ? D.sum('linkedin', 'post_impressions', null, from, to) : null,
      organicKnown: key === 'linkedin' && D.has('linkedin', 'post_impressions'),
    }));
  };
  D.impressions = (from = S.from, to = S.to) => {
    const parts = D.impressionParts(from, to);
    const known = parts.some((p) => D.has(p.key, 'ad_impressions') || p.organicKnown);
    if (!known) return null;
    return parts.reduce((s, p) => s + p.paid + (p.organicKnown ? p.organic : 0), 0);
  };
  D.funnel = (from = S.from, to = S.to) => {
    const gaF = D.ga(from, to);
    const fs = D.ga4Event('form_start', from, to), su = D.ga4Event('sign_up', from, to);
    const users = (e) => (e ? (e.users != null ? e.users : e.count) : null);
    return [
      { name: 'Landing sessions', src: 'HubSpot · todo el sitio', n: D.has('hubspot', 'sessions') ? D.sessions(from, to) : null },
      { name: 'Engaged sessions', src: 'GA4', n: gaF ? gaF.engaged : null },
      { name: 'Form start', src: 'GA4', n: users(fs) },
      { name: 'Sign-up submit', src: 'GA4', n: users(su) },
      { name: S.exInt ? 'External form sign-ups' : 'Form sign-ups', src: 'HubSpot', n: D.forms(from, to).length },
      { name: 'Platform sign-ups', src: 'PostHog', n: D.platform(from, to) },
      { name: 'Activated (first project)', src: 'PostHog', n: null, note: 'Event not tracked yet' },
    ];
  };
  // Actual value of a targeted metric for a date range (used by the monthly goals).
  D.actual = (key, from, to) => {
    switch (key) {
      case 'landing_sessions': return D.has('hubspot', 'sessions') ? D.sessions(from, to) : null;
      case 'unique_visitors': { const g = D.ga(from, to); return g ? g.users : null; }
      case 'engagement_rate': { const g = D.ga(from, to); return g ? g.rate : null; }
      case 'total_signups': return D.signups(from, to);
      case 'platform_signups': return D.platform(from, to);
      case 'visit_to_signup_rate': { const s = D.sessions(from, to); return s ? D.signups(from, to) / s : null; }
      // Cost per external sign-up: the CEO efficiency question, target = the plan's paid_cps.
      case 'cps': { const s = D.signups(from, to); const spend = D.anyPaid() ? D.paidSum('ad_spend', from, to) : null; return spend && s ? spend / s : null; }
      // Activation: share of new platform people whose first "Proyecto creado" action is in the window.
      case 'activation_7d': { const base = D.platform(from, to); if (!base) return null; const act = D.sum('posthog', 'ph_activated_users', null, from, to); return act / base; }
      case 'total_impressions': return D.impressions(from, to);
      case 'ad_spend_budget': return D.anyPaid() ? D.paidSum('ad_spend', from, to) : null;
      case 'clicks': return D.anyPaid() ? D.paidSum('ad_clicks', from, to) : null;
      case 'ctr': { const i = D.paidSum('ad_impressions', from, to); return i ? D.paidSum('ad_clicks', from, to) / i : null; }
      default: return null;
    }
  };

  // ---------- load and period
  A.load = async () => {
    try { S.data = await A.api('api/data'); A.render(); }
    catch (e) {
      if (e.message !== 'code') document.getElementById('view').innerHTML = `<section class="card">${U.empty('Could not load the data', `${U.esc(e.message)}. Reload the page; if it persists, check the app logs.`, 'triangle-exclamation')}</section>`;
    }
  };
  A.footer = () => {
    const last = ((S.data && S.data.sources) || []).filter((s) => s.last_sync).map((s) => s.last_sync).sort().pop();
    document.getElementById('foot').textContent = `Since launch ${U.win(S.from, S.to)} · ${D.grainName().toLowerCase()} · internal tests ${S.exInt ? 'excluded' : 'included'} · last data load ${last ? U.stamp(last) : 'none'} · Research, Think4Ever LATAM`;
    const ss = (S.data && S.data.sources) || [];
    document.getElementById('sources-foot').textContent = `${ss.filter((s) => s.state === 'connected').length} of ${ss.length} sources connected`;
  };
  A.setGrain = (v) => {
    const sel = document.getElementById('period');
    if (![...sel.options].some((o) => o.value === v)) v = 'day';
    sel.value = v;
    S.grain = v;
    S.from = LAUNCH;
    S.to = U.today();
    A.store('t4e-growth-grain', v);
    if (A.targets) A.targets.ensure(S.to.slice(0, 7));
    if (S.data) A.render();
  };

  // ---------- header controls
  document.getElementById('period').addEventListener('change', (e) => A.setGrain(e.target.value));
  document.getElementById('ex-int').addEventListener('change', (e) => {
    S.exInt = e.target.checked; A.store('t4e-growth-exclude-internal', S.exInt ? '1' : '0');
    if (S.data) A.render();
  });
  document.getElementById('theme-btn').addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    A.store('t4e-growth-theme', root.dataset.theme);
  });
  document.getElementById('logout-btn').addEventListener('click', A.logout);

  // ---------- boot
  (() => {
    S.exInt = A.store('t4e-growth-exclude-internal') !== '0';
    document.getElementById('ex-int').checked = S.exInt;
    const hash = location.hash.slice(1);
    S.tab = A.resolve(hash || A.store('t4e-growth-tab') || 'overview');
    A.setGrain(A.store('t4e-growth-grain') || 'day');
    A.render();
    A.load();
    // The role decides which controls show; the server enforces the same rule on every write.
    A.api('api/me').then((me) => {
      S.me = me;
      document.body.dataset.role = me.role || 'admin';
      document.getElementById('user-name').textContent = me.user || 'Signed in';
      document.getElementById('user-role').textContent = { admin: 'Research · full access', read: 'View only · targets', ads: 'View · ad loader' }[me.role] || '';
      document.getElementById('user-avatar').textContent = String(me.user || '?').slice(0, 2);
    }).catch(() => {});
  })();
})(window.App);

'use strict';
/* Boot, shared state, header controls and the data helpers every screen uses.
   All numbers come from api/data (connectors, CSV loads, daily routine) — nothing is invented here. */
(function (A) {
  const U = A.ui;
  const LAUNCH = A.LAUNCH = '2026-10-01';
  const S = A.S = { data: null, tab: 'overview', period: '28', from: LAUNCH, to: U.today(), exInt: true, me: null };

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
  D.prev = () => {
    if (S.period === 'launch' || S.from <= LAUNCH) return null;
    const len = U.diffDays(S.from, S.to) + 1;
    return { from: U.addDays(S.from, -len), to: U.addDays(S.from, -1), len };
  };
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
  D.PAID = ['meta', 'linkedin', 'google_ads'];
  D.anyPaid = () => D.M().some((r) => D.PAID.includes(r.source) && /^ad_/.test(r.metric));
  D.paidSum = (metric, from = S.from, to = S.to, only) => (only ? [only] : D.PAID).reduce((s, k) => s + D.sum(k, metric, null, from, to), 0);
  D.funnel = (from = S.from, to = S.to) => {
    const ga = D.snap('ga4', 'totals', from, to), gt = ga && ga.rows && ga.rows[0];
    const fs = D.ga4Event('form_start', from, to), su = D.ga4Event('sign_up', from, to);
    const users = (e) => (e ? (e.users != null ? e.users : e.count) : null);
    return [
      { name: 'Landing sessions', src: 'HubSpot', n: D.has('hubspot', 'sessions') ? D.sessions(from, to) : null },
      { name: 'Engaged sessions', src: 'GA4', n: gt ? gt.engaged_sessions : null },
      { name: 'Form start', src: 'GA4', n: users(fs) },
      { name: 'Sign-up submit', src: 'GA4', n: users(su) },
      { name: S.exInt ? 'External form sign-ups' : 'Form sign-ups', src: 'HubSpot', n: D.forms(from, to).length },
      { name: 'Platform sign-ups', src: 'PostHog', n: D.platform(from, to) },
      { name: 'Activated (first project)', src: 'PostHog', n: null, note: 'Event not tracked yet' },
    ];
  };
  // Actual value of a targeted metric for a date range (used by the monthly goals).
  D.actual = (key, from, to) => {
    const ga = () => { const s = D.snapIn('ga4', 'totals', from, to); return s && s.rows && s.rows[0]; };
    switch (key) {
      case 'landing_sessions': return D.has('hubspot', 'sessions') ? D.sessions(from, to) : null;
      case 'unique_visitors': { const g = ga(); return g ? Number(g.users) : null; }
      case 'engagement_rate': { const g = ga(); return g ? Number(g.engagement_rate) : null; }
      case 'total_signups': return D.signups(from, to);
      case 'platform_signups': return D.platform(from, to);
      case 'visit_to_signup_rate': { const s = D.sessions(from, to); return s ? D.signups(from, to) / s : null; }
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
    document.getElementById('foot').textContent = `Period ${U.win(S.from, S.to)} · internal tests ${S.exInt ? 'excluded' : 'included'} · last data load ${last ? U.stamp(last) : 'none'} · Research, Think4Ever LATAM`;
    const ss = (S.data && S.data.sources) || [];
    document.getElementById('sources-foot').textContent = `${ss.filter((s) => s.state === 'connected').length} of ${ss.length} sources connected`;
  };
  A.setPeriod = (v) => {
    const sel = document.getElementById('period');
    if (![...sel.options].some((o) => o.value === v)) v = '28';
    sel.value = v; S.period = v;
    document.getElementById('custom-range').hidden = v !== 'custom';
    const t = U.today();
    if (v === 'launch') { S.from = LAUNCH; S.to = t; }
    else if (v === 'custom') {
      S.from = document.getElementById('from').value || S.from;
      S.to = document.getElementById('to').value || S.to;
    } else { S.to = t; S.from = U.addDays(t, -(Number(v) - 1)); }
    if (S.from > S.to) [S.from, S.to] = [S.to, S.from];
    document.getElementById('from').value = S.from;
    document.getElementById('to').value = S.to;
    A.store('t4e-growth-period', v);
    if (A.targets) A.targets.ensure(S.to.slice(0, 7));
    if (S.data) A.render();
  };

  // ---------- header controls
  document.getElementById('period').addEventListener('change', (e) => A.setPeriod(e.target.value));
  ['from', 'to'].forEach((id) => document.getElementById(id).addEventListener('change', () => A.setPeriod('custom')));
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
    A.setPeriod(A.store('t4e-growth-period') || '28');
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

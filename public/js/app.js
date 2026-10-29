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
  D.isTestForm = (e) => !!e.internal || /^(qa|test)$/i.test(String(e.utm_medium || '')) || /^qa[_-]/i.test(String(e.utm_campaign || ''));
  D.forms = (from = S.from, to = S.to) => ((S.data && S.data.events) || []).filter((e) => e.kind === 'form_signup' && inR(e.date, from, to) && (!S.exInt || !D.isTestForm(e)));
  D.formsAll = (from = S.from, to = S.to) => ((S.data && S.data.events) || []).filter((e) => e.kind === 'form_signup' && inR(e.date, from, to));
  D.covered = (src, key, from = S.from, to = S.to) => {
    const s = D.snapIn(src, key, from, to);
    return s && s.from <= from && s.to >= to && s.rows && s.rows[0] && s.rows[0].available === true ? s.rows[0] : null;
  };
  D.peopleClassified = (from = S.from, to = S.to) => !!D.covered('posthog', 'people_coverage', from, to) || D.M().some((r) => r.source === 'posthog' && r.metric === 'ph_new_persons' && r.dim === 'account_type');
  D.peopleFilter = (r) => !S.exInt || (r.dim === 'account_type' && r.dim_value !== 'Internal');
  D.platform = (from = S.from, to = S.to) => {
    if ((!D.has('posthog', 'ph_new_persons') && !D.covered('posthog', 'people_coverage', from, to)) || (S.exInt && !D.peopleClassified(from, to))) return null;
    return D.sum('posthog', 'ph_new_persons', D.peopleFilter, from, to);
  };
  D.crmTotal = (from = S.from, to = S.to) => D.formsAll(from, to).length || D.snap('hubspot', 'utm_capture', from, to) || D.has('hubspot', 'sessions') ? D.forms(from, to).length : null;
  D.registrations = (from = S.from, to = S.to, country) => {
    if (!D.covered('posthog', 'registration_coverage', from, to)) return null;
    if (country) {
      const f = (r) => r.dim === 'country' && r.dim_value === country;
      return D.sum('posthog', 'ph_signups_geo', f, from, to) + (S.exInt ? 0 : D.sum('posthog', 'ph_signups_geo_internal', f, from, to));
    }
    return D.sum('posthog', 'ph_signups', D.peopleFilter, from, to);
  };
  // Accounts created = first PostHog identify per person (the dashboard's sign-up definition).
  // registration_started (D.registrations) is the funnel step before it, never added on top.
  D.accounts = (from = S.from, to = S.to, country) => {
    if (!D.covered('posthog', 'account_coverage', from, to)) return null;
    if (country) {
      const f = (r) => r.dim === 'country' && r.dim_value === country;
      return D.sum('posthog', 'ph_accounts_geo', f, from, to) + (S.exInt ? 0 : D.sum('posthog', 'ph_accounts_geo_internal', f, from, to));
    }
    return D.sum('posthog', 'ph_accounts', D.peopleFilter, from, to);
  };
  // Every country that has accounts (planned markets and the rest), for the "Other markets" row.
  D.accountsCountries = (from = S.from, to = S.to) => {
    const out = {};
    for (const r of D.M()) {
      if (r.source !== 'posthog' || r.dim !== 'country' || !inR(r.date, from, to)) continue;
      if (r.metric === 'ph_accounts_geo' || (!S.exInt && r.metric === 'ph_accounts_geo_internal')) out[r.dim_value] = (out[r.dim_value] || 0) + (Number(r.value) || 0);
    }
    return out;
  };
  D.accountsByDay = (from = S.from, to = S.to, country) => {
    if (country) {
      const out = {};
      for (const d of U.days(from, to)) out[d] = 0;
      for (const r of D.M()) if (r.source === 'posthog' && r.dim === 'country' && r.dim_value === country && inR(r.date, from, to) && (r.metric === 'ph_accounts_geo' || (!S.exInt && r.metric === 'ph_accounts_geo_internal'))) out[r.date] += Number(r.value) || 0;
      return out;
    }
    return D.byDay('posthog', 'ph_accounts', from, to, D.peopleFilter);
  };
  D.verified = (from = S.from, to = S.to, country) => {
    const coverage = D.covered('posthog', 'verified_accounts', from, to);
    if (!coverage || coverage.unit !== 'verified_account') return null;
    if (country) {
      if (!coverage.country_complete || (!S.exInt && !coverage.country_internal_complete)) return null;
      const f = (r) => r.dim === 'country' && r.dim_value === country;
      return D.sum('posthog', 'ph_verified_accounts_geo', f, from, to)
        + (S.exInt ? 0 : D.sum('posthog', 'ph_verified_accounts_geo_internal', f, from, to));
    }
    return D.sum('posthog', 'ph_verified_accounts', (r) => r.dim === 'account_type' && (!S.exInt || r.dim_value === 'External'), from, to);
  };
  D.proxy = (from = S.from, to = S.to) => D.covered('posthog', 'activation_action', from, to) || D.has('posthog', 'ph_activated_users') ? D.sum('posthog', 'ph_activated_users', null, from, to) : null;
  D.sessions = (from = S.from, to = S.to) => D.sum('hubspot', 'sessions', null, from, to);
  D.signups = (from = S.from, to = S.to) => D.accounts(from, to);
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
  D.versus = () => 'Selected date range';
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
      const p = D.byDay('posthog', 'ph_new_persons', from, to, D.peopleFilter);
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
      userWarning: !!(row && (row.user_counts_inconsistent || Number(row.new_users) > Number(row.users))),
      thresholded: !!(row && row.subject_to_thresholding),
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
  D.countryUsers = (country, from = S.from, to = S.to) => {
    const s = D.snap('ga4', 'countries', from, to);
    if (!s || s.from !== from || s.to !== to) return null;
    const r = (s.rows || []).find((r) => r.country === country);
    return r ? Number(r.users) : 0;
  };
  D.periods = (from = S.from, to = S.to) => D.ticks(from, to).map((key) => {
    const span = U.bucketSpan(key);
    return { key, label: U.axis(key), from: span.start < from ? from : span.start, to: span.end > to ? to : span.end };
  });
  D.contactAttribution = (from = S.from, to = S.to) => {
    const out = { paid: 0, other: 0, unknown: 0, tests: 0, total: D.crmTotal(from, to) };
    for (const e of D.forms(from, to)) {
      const source = e.first_utm_source && e.first_utm_medium ? e.first_utm_source : e.utm_source;
      const medium = e.first_utm_source && e.first_utm_medium ? e.first_utm_medium : e.utm_medium;
      if (D.isTestForm(e)) out.tests++;
      else if (A.paid.platform(source, medium)) out.paid++;
      else if ((source && medium && !/^\(not set\)$|^unknown$/i.test(source) && !/^\(not set\)$|^unknown$/i.test(medium)) || e.original_source || e.channel) out.other++;
      else out.unknown++;
    }
    return out;
  };
  D.PAID = ['meta', 'linkedin', 'google_ads'];
  D.anyPaid = () => D.M().some((r) => D.PAID.includes(r.source) && /^ad_/.test(r.metric));
  D.paidSum = (metric, from = S.from, to = S.to, only) => (only ? [only] : D.PAID).reduce((s, k) => s + D.sum(k, metric, null, from, to), 0);
  D.paidStats = (key, from = S.from, to = S.to) => {
    const value = (metric) => D.has(key, metric) ? D.sum(key, metric, null, from, to) : null;
    const spend = value('ad_spend'), impressions = value('ad_impressions');
    // Older Meta loads contain all-clicks. Require a new sync rather than
    // relabelling those historical rows as link clicks.
    const clicks = value(key === 'meta' ? 'ad_link_clicks' : 'ad_clicks');
    const complete = (s) => s && s.from <= from && s.to >= to && s.rows && s.rows[0] && s.rows[0].available === true;
    const sessionsReady = complete(D.snapIn('ga4', 'paid_sessions', from, to));
    const sessions = sessionsReady ? D.sum('ga4', 'ga_paid_sessions', (r) => r.dim_value === key, from, to) : null;
    const touch = (e) => e.first_utm_source && e.first_utm_medium
      ? [e.first_utm_source, e.first_utm_medium] : [e.utm_source, e.utm_medium];
    const formsReady = complete(D.snapIn('hubspot', 'utm_capture', from, to)) || D.formsAll(from, to).some((e) => touch(e).every(Boolean));
    const forms = formsReady ? D.forms(from, to).filter((e) => A.paid.platform(...touch(e)) === key).length : null;
    return {
      key, spend, impressions, clicks, sessions, forms,
      ctr: impressions && clicks != null ? clicks / impressions : null,
      cpm: A.paid.cost(spend, impressions, 1000), cpc: A.paid.cost(spend, clicks),
      costSession: A.paid.cost(spend, sessions), costForm: A.paid.cost(spend, forms),
    };
  };
  D.paidTotals = (from = S.from, to = S.to) => {
    const rows = D.PAID.map((key) => D.paidStats(key, from, to));
    // A channel without an ad report must not contribute free conversions to
    // another channel's denominator. Unknown inputs remain unknown.
    const reporting = rows.filter((r) => ['spend', 'impressions', 'clicks'].some((key) => r[key] != null));
    const funded = reporting.filter((r) => r.spend > 0);
    const sum = (list, field) => list.length && list.every((r) => r[field] != null) ? list.reduce((n, r) => n + r[field], 0) : null;
    const spend = sum(reporting, 'spend'), impressions = sum(reporting, 'impressions'), clicks = sum(reporting, 'clicks');
    const sessions = sum(rows, 'sessions'), forms = sum(rows, 'forms');
    const fundedSessions = sum(funded, 'sessions'), fundedForms = sum(funded, 'forms');
    return { spend, impressions, clicks, sessions, forms,
      ctr: impressions && clicks != null ? clicks / impressions : null,
      cpm: A.paid.cost(spend, impressions, 1000), cpc: A.paid.cost(spend, clicks),
      costSession: A.paid.cost(spend, fundedSessions), costForm: A.paid.cost(spend, fundedForms) };
  };
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
      { name: 'Site sessions', src: 'GA4 · configured hosts', n: gaF ? gaF.sessions : null, separate: true },
      { name: 'Engagement rate', src: 'GA4 · engaged sessions / GA4 sessions', n: gaF ? gaF.rate : null, kind: 'rate', bridge: 'Same-source quality metric, not a cohort conversion' },
      { name: 'Form starts (events)', src: 'GA4', n: users(fs), separate: true, bridge: 'Independent event count; repeat events are possible' },
      { name: 'Form submits (events)', src: 'GA4', n: users(su), separate: true, bridge: 'Independent event count; not deduplicated registrations' },
      { name: S.exInt ? 'CRM contacts (tests excluded)' : 'CRM contacts', src: 'HubSpot · contact creation date', n: D.crmTotal(from, to), separate: true, bridge: 'Contacts may overlap product users; never added together' },
      { name: 'New observed people', src: 'PostHog · not verified accounts', n: D.platform(from, to), separate: true, note: 'Sync PostHog for internal classification', bridge: 'Independent product population, not the next step after a contact' },
      { name: 'Project started (click proxy)', src: 'PostHog · first click since launch · test accounts excluded', n: D.proxy(from, to), note: 'Awaiting activation Action sync', separate: true, bridge: 'First create-project click per person; creation is not confirmed. This is not a sign-up cohort.' },
    ];
  };
  // Actual value of a targeted metric for a date range (used by the monthly goals).
  D.actual = (key, from, to) => {
    switch (key) {
      case 'landing_sessions': { const g = D.ga(from, to); return g ? g.sessions : null; }
      case 'unique_visitors': { const g = D.ga(from, to); return g ? g.users : null; }
      case 'engagement_rate': { const g = D.ga(from, to); return g ? g.rate : null; }
      case 'total_signups': return D.signups(from, to);
      case 'platform_signups': return D.accounts(from, to);
      case 'crm_contacts': return D.crmTotal(from, to);
      case 'new_people': return D.platform(from, to);
      case 'visit_to_signup_rate': return null; // Needs accounts linked to the measured session population.
      // Cost per external sign-up: the CEO efficiency question, target = the plan's paid_cps.
      case 'cps': return D.paidTotals(from, to).costForm;
      // Activation: share of new platform people whose first "Proyecto creado" action is in the window.
      case 'activation_7d': return null; // The Action has no linked signup/project dates or mature cohort.
      case 'total_impressions': return D.paidTotals(from, to).impressions;
      case 'ad_spend_budget': return D.paidTotals(from, to).spend;
      case 'clicks': return D.paidTotals(from, to).clicks;
      case 'ctr': return D.paidTotals(from, to).ctr;
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
    document.getElementById('foot').textContent = `Range ${S.from} to ${S.to} · grouped ${D.grainName().toLowerCase()} · CRM/product tests ${S.exInt ? 'excluded where classified' : 'included'}; GA4 traffic can include tests · last data load ${last ? U.stamp(last) : 'none'} · Research, Think4Ever LATAM`;
    const ss = (S.data && S.data.sources) || [];
    document.getElementById('sources-foot').textContent = `${ss.filter((s) => s.state === 'connected').length} of ${ss.length} sources connected`;
  };
  A.setGrain = (v) => {
    const sel = document.getElementById('period');
    if (![...sel.options].some((o) => o.value === v)) v = 'day';
    sel.value = v;
    S.grain = v;
    A.store('t4e-growth-grain', v);
    if (A.targets) A.targets.ensure(S.to.slice(0, 7));
    if (S.data) A.render();
  };
  A.setRange = (from, to, persist = true) => {
    const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
    if (!valid(from) || !valid(to)) return;
    S.from = from < LAUNCH ? LAUNCH : from;
    S.to = to > U.today() ? U.today() : to < LAUNCH ? LAUNCH : to;
    if (S.from > S.to) S.from = S.to;
    document.getElementById('range-from').value = S.from;
    document.getElementById('range-to').value = S.to;
    if (persist) { A.store('t4e-growth-range-from', S.from); A.store('t4e-growth-range-to', S.to === U.today() ? 'today' : S.to); }
    if (A.targets) A.targets.ensure(S.to.slice(0, 7));
    if (S.data) A.render();
  };

  // ---------- header controls
  document.getElementById('period').addEventListener('change', (e) => A.setGrain(e.target.value));
  for (const id of ['range-from', 'range-to']) document.getElementById(id).addEventListener('change', () => A.setRange(document.getElementById('range-from').value, document.getElementById('range-to').value));
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
    for (const id of ['range-from', 'range-to']) { document.getElementById(id).min = LAUNCH; document.getElementById(id).max = U.today(); }
    const savedTo = A.store('t4e-growth-range-to');
    A.setRange(A.store('t4e-growth-range-from') || LAUNCH, !savedTo || savedTo === 'today' ? U.today() : savedTo, false);
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

'use strict';
// All-channel funnel: one top-to-bottom view across sources, one source per step.
// Ad impressions and clicks (ad platforms) -> landing sessions (GA4) -> CTA, registration,
// sign-up, login and project (PostHog ordered persons). Units change between sources and are
// labelled on every step; a rate across different units is only shown where a same-unit
// basis exists (paid sessions per ad click, persons per persons). Missing sources stay
// "No data connected" and are never filled in.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else window.App.aggregateFunnel = factory(window.App);
})(function (A) {
  const STEPS = [
    { key: 'impressions', name: 'Ad impressions', unit: 'impressions', source: 'Ad platforms · Meta Ads + LinkedIn Ads + Google Ads' },
    { key: 'clicks', name: 'Ad clicks', unit: 'clicks', source: 'Ad platforms · link clicks (Meta), clicks (LinkedIn, Google Ads)' },
    { key: 'sessions', name: 'Landing sessions', unit: 'sessions', source: 'GA4 · all sources · configured hosts' },
    { key: 'cta', name: 'CTA clicked', unit: 'persons', source: 'PostHog · marketing_cta_clicked' },
    { key: 'registration_started', name: 'Registration started', unit: 'persons', source: 'PostHog · registration_started' },
    // Persons who completed the ordered funnel up to $identify: not the sign-up KPI (posthog_accounts_created).
    { key: 'registration_finished', name: 'Sign-ups via the marketing funnel (ordered, 14-day window)', unit: 'persons', source: 'PostHog · first $identify after page view, CTA and registration' },
    { key: 'login', name: 'Login', unit: 'persons', source: 'PostHog · saved Login step' },
    { key: 'project', name: 'Project view / created', unit: 'persons', source: 'PostHog · saved Project View/Project Created step' },
  ];
  // Index of each PostHog step in the saved Marketing-to-Project funnel (0 = marketing_page_viewed).
  const POSTHOG_INDEX = { cta: 1, registration_started: 2, registration_finished: 3, login: 4, project: 5 };
  const PH_KEYS = Object.keys(POSTHOG_INDEX);
  const NO_DATA = 'No data connected';
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const ratio = (n, d) => (n != null && d != null && d > 0 ? n / d : null);
  const sumKnown = (list) => (list.some((v) => v != null) ? list.reduce((s, v) => s + (v == null ? 0 : v), 0) : null);
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  // "(not set)" (GA4) and "(none)" (PostHog, empty value) both mean the value is missing: one row.
  const UNSET = '(not set)';
  const keyOf = (v) => { const k = norm(v); return !k || k === '(not set)' || k === '(none)' ? UNSET : k; };
  const labelOf = (v) => (keyOf(v) === UNSET ? UNSET : String(v));
  // Campaign names sent to the assistant: plain names only (utm_campaign is free text anyone can type).
  const SAFE_CAMPAIGN = /^[\w .\-]{1,60}$/;

  // input: { from, to, exclude, platforms: [{ key, name, channel, impressions, clicks, spend, paid_sessions, campaigns: [{ campaign, impressions, clicks, spend }] }],
  //          ga4: { sessions, channels: [{ channel, sessions }], campaigns: [{ campaign, sessions }], campaigns_capped } | null,
  //          posthog: { status: 'loaded'|'loading'|'error', error, steps: [{ name, n }] },
  //          posthogChannels / posthogCampaigns: { status, error, groups: [{ value, steps: [{ n }] }] } }
  function build(input = {}) {
    const platforms = (input.platforms || []).map((p) => ({
      key: p.key, name: p.name || p.key, channel: p.channel || 'Paid Social',
      impressions: num(p.impressions), clicks: num(p.clicks), spend: num(p.spend), paid_sessions: num(p.paid_sessions),
      campaigns: (p.campaigns || []).map((c) => ({ campaign: String(c.campaign || '(not set)'), impressions: num(c.impressions), clicks: num(c.clicks), spend: num(c.spend) })),
    })).map((p) => ({ ...p, connected: p.impressions != null || p.clicks != null }));
    const ga4 = input.ga4 && num(input.ga4.sessions) != null ? input.ga4 : null;
    const ph = input.posthog || { status: 'loading' };
    const phSteps = ph.status === 'loaded' && Array.isArray(ph.steps) ? ph.steps : null;
    const phN = (i) => (phSteps && phSteps[i] ? num(phSteps[i].n) : null);
    const pagePersons = phN(0);

    const values = {
      impressions: sumKnown(platforms.map((p) => p.impressions)),
      clicks: sumKnown(platforms.map((p) => p.clicks)),
      sessions: ga4 ? num(ga4.sessions) : null,
    };
    for (const key of PH_KEYS) values[key] = phN(POSTHOG_INDEX[key]);

    const ctrBase = platforms.filter((p) => p.impressions != null && p.clicks != null);
    const paidBase = platforms.filter((p) => p.clicks != null && p.paid_sessions != null);
    const paidSessions = sumKnown(paidBase.map((p) => p.paid_sessions));
    const paidClicks = sumKnown(paidBase.map((p) => p.clicks));

    const steps = STEPS.map((def, i) => {
      const value = values[def.key];
      let status = value == null ? 'no_data' : 'loaded', reason = '';
      if (def.key === 'impressions' || def.key === 'clicks') reason = platforms.some((p) => p.connected) ? 'No platform reports this metric' : 'No ad platform data connected';
      else if (def.key === 'sessions') reason = 'GA4 not connected';
      else if (ph.status === 'loading') { status = value == null ? 'loading' : status; reason = 'Loading PostHog funnel…'; }
      else if (ph.status === 'error') reason = ph.error || 'PostHog funnel unavailable';
      else reason = 'Awaiting events';
      let rate = null, basis = '', unitChange = '';
      if (i > 0) {
        const prev = STEPS[i - 1];
        if (prev.unit !== def.unit && prev.source.split(' · ')[0] !== def.source.split(' · ')[0]) unitChange = `${prev.unit} (${prev.source.split(' · ')[0]}) → ${def.unit} (${def.source.split(' · ')[0]})`;
        if (def.key === 'clicks') {
          rate = ratio(sumKnown(ctrBase.map((p) => p.clicks)), sumKnown(ctrBase.map((p) => p.impressions)));
          basis = `CTR · ad clicks ÷ ad impressions${ctrBase.length ? ` · ${ctrBase.map((p) => p.name).join(' + ')}` : ''}`;
        } else if (def.key === 'sessions') {
          rate = ratio(paidSessions, paidClicks);
          basis = paidSessions == null ? 'GA4 paid UTM sessions not available to compare with ad clicks' : `Paid landing sessions per ad click · ${fmt(paidSessions)} GA4 paid UTM sessions ÷ ${fmt(paidClicks)} ad clicks · the other ${fmt(value == null ? null : Math.max(0, value - paidSessions))} sessions came from non-paid sources`;
        } else if (def.key === 'cta') {
          rate = ratio(value, pagePersons);
          basis = pagePersons == null ? 'Persons who viewed a marketing page not available' : `of ${fmt(pagePersons)} persons who viewed a marketing page (PostHog) · not divided by GA4 sessions`;
        } else {
          rate = ratio(value, values[prev.key]);
          basis = 'persons ÷ persons in the previous step · ordered PostHog funnel';
        }
      }
      return { ...def, value, status, reason: status === 'loaded' ? '' : reason, rate, basis, unitChange };
    });

    // Per-step split shown under each step.
    const gaChannels = ga4 ? (ga4.channels || []).map((r) => ({ label: String(r.channel || '(not set)'), value: num(r.sessions) })).filter((r) => r.value != null).sort((a, b) => b.value - a.value) : [];
    const phChannels = input.posthogChannels && input.posthogChannels.status === 'loaded' ? (input.posthogChannels.groups || []) : null;
    for (const step of steps) {
      if (step.key === 'impressions' || step.key === 'clicks') step.split = platforms.map((p) => ({ label: p.name, value: p[step.key], status: p[step.key] == null ? 'no_data' : 'loaded' }));
      else if (step.key === 'sessions') step.split = gaChannels.map((r) => ({ ...r, status: 'loaded' }));
      else if (phChannels) step.split = phChannels.map((g) => ({ label: g.value, value: num(g.steps && g.steps[POSTHOG_INDEX[step.key]] && g.steps[POSTHOG_INDEX[step.key]].n), status: 'loaded' })).filter((r) => r.value != null).sort((a, b) => b.value - a.value);
      else step.split = null;
    }

    // Channel matrix: ad platforms map to their paid channel; GA4 default channel group;
    // PostHog $channel_type of the first funnel step. Joined by channel name only.
    const rows = new Map();
    const row = (label) => {
      const k = keyOf(label);
      if (!rows.has(k)) rows.set(k, { channel: labelOf(label), impressions: null, clicks: null, sessions: null, page_persons: null, cta: null, registration_started: null, registration_finished: null, login: null, project: null });
      return rows.get(k);
    };
    const add = (r, field, v) => { if (v != null) r[field] = (r[field] || 0) + v; };
    for (const p of platforms) if (p.connected) { const r = row(p.channel); add(r, 'impressions', p.impressions); add(r, 'clicks', p.clicks); }
    for (const c of gaChannels) add(row(c.label), 'sessions', c.value);
    if (phChannels) for (const g of phChannels) {
      const r = row(g.value), n = (i) => num(g.steps && g.steps[i] && g.steps[i].n);
      add(r, 'page_persons', n(0));
      for (const key of PH_KEYS) add(r, key, n(POSTHOG_INDEX[key]));
    }
    // A connected source that has no row for a channel reports zero there; an unconnected one stays unknown.
    // Ad metrics of a paid channel depend on that channel's own platforms (Paid Social: Meta + LinkedIn;
    // Paid Search: Google Ads): none reporting -> null ("No data connected"); only some -> partial.
    // Channels no ad platform maps to get 0 once any ad platform reports.
    const connected = { ads: platforms.some((p) => p.connected), ga4: !!ga4, posthog: !!phChannels };
    const phKeys = new Set((phChannels || []).map((g) => keyOf(g.value)));
    const phOther = phKeys.has('other');
    const channels = [...rows.entries()].map(([k, r]) => {
      const out = { ...r, partial: false, missing_platforms: [], posthog_in_other: false };
      const mine = platforms.filter((p) => keyOf(p.channel) === k);
      for (const field of ['impressions', 'clicks']) {
        if (!mine.length) { if (connected.ads && out[field] == null) out[field] = 0; continue; }
        const missing = mine.filter((p) => p[field] == null);
        if (missing.length === mine.length) out[field] = null;
        else if (missing.length) { out.partial = true; for (const p of missing) if (!out.missing_platforms.includes(p.name)) out.missing_platforms.push(p.name); }
      }
      if (connected.ga4 && out.sessions == null) out.sessions = 0;
      // PostHog folds groups beyond breakdown_limit into "Other": a channel without its own group is counted there, not zero.
      if (connected.posthog && !phKeys.has(k)) {
        if (phOther) out.posthog_in_other = true;
        else for (const key of ['page_persons', ...PH_KEYS]) if (out[key] == null) out[key] = 0;
      }
      out.signups_per_1000_sessions = out.sessions > 0 && out.registration_finished != null ? out.registration_finished / out.sessions * 1000 : null;
      out.signup_rate_of_cta = ratio(out.registration_finished, out.cta);
      return out;
    }).sort((a, b) => (b.sessions || 0) - (a.sessions || 0) || (b.page_persons || 0) - (a.page_persons || 0) || (b.impressions || 0) - (a.impressions || 0));

    // Campaign view: ad platform campaign names and utm_campaign values joined on the normalized
    // name (case, spaces, "-" and "_" ignored).
    const camps = new Map();
    const camp = (name) => {
      const k = keyOf(name);
      if (!camps.has(k)) camps.set(k, { campaign: labelOf(name), platform: '', impressions: null, clicks: null, spend: null, sessions: null, cta: null, registration_started: null, registration_finished: null, login: null, project: null });
      return camps.get(k);
    };
    for (const p of platforms) for (const c of p.campaigns) {
      const r = camp(c.campaign);
      r.platform = r.platform && r.platform !== p.name ? `${r.platform}, ${p.name}` : p.name;
      add(r, 'impressions', c.impressions); add(r, 'clicks', c.clicks); add(r, 'spend', c.spend);
    }
    if (ga4) for (const c of ga4.campaigns || []) add(camp(c.campaign), 'sessions', num(c.sessions));
    const phCampaigns = input.posthogCampaigns && input.posthogCampaigns.status === 'loaded' ? (input.posthogCampaigns.groups || []) : null;
    if (phCampaigns) for (const g of phCampaigns) {
      const r = camp(g.value);
      for (const key of PH_KEYS) add(r, key, num(g.steps && g.steps[POSTHOG_INDEX[key]] && g.steps[POSTHOG_INDEX[key]].n));
    }
    const campaigns = [...camps.values()].sort((a, b) => (b.sessions || 0) - (a.sessions || 0) || (b.impressions || 0) - (a.impressions || 0));

    const topSessions = channels.filter((c) => c.sessions > 0)[0] || null;
    const highlights = {
      total_impressions: values.impressions, total_ad_clicks: values.clicks, total_landing_sessions: values.sessions,
      top_channel_by_landing_sessions: topSessions ? { channel: topSessions.channel, sessions: topSessions.sessions, share_of_sessions: ratio(topSessions.sessions, values.sessions) } : null,
      persons_viewed_marketing_page: pagePersons,
      // Ordered-funnel completions up to $identify (14-day window), not the sign-up KPI.
      marketing_funnel_signups_ordered: values.registration_finished,
      marketing_funnel_signups_of_marketing_page_persons: ratio(values.registration_finished, pagePersons),
      marketing_funnel_signups_per_1000_landing_sessions: values.sessions > 0 && values.registration_finished != null ? values.registration_finished / values.sessions * 1000 : null,
    };
    return {
      from: input.from || null, to: input.to || null, exclude: !!input.exclude,
      steps, platforms, channels, campaigns, highlights, page_persons: pagePersons,
      ga4_campaigns_capped: !!(ga4 && ga4.campaigns_capped),
      posthog_channels: input.posthogChannels || null, posthog_campaigns: input.posthogCampaigns || null,
    };
  }
  function fmt(n) { return n == null || !Number.isFinite(Number(n)) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }

  // Compact, bounded summary for the Growth assistant (aggregates only). It never uses the optional
  // PostHog campaign split, so opening "Campaign / ad" does not change the context.
  function summarize(model) {
    const clip = (s, max = 60) => String(s == null ? '' : s).slice(0, max);
    return {
      period: { from: model.from, to: model.to },
      // 160 = what the server keeps of rate_basis (safeText).
      steps: model.steps.map((s) => ({ step: s.name, source: clip(s.source.split(' · ')[0]), unit: s.unit, value: s.value, rate_vs_previous: s.rate, rate_basis: clip(s.basis, 160), status: s.status })),
      platforms: model.platforms.map((p) => ({ platform: p.name, connected: p.connected, impressions: p.impressions, clicks: p.clicks, spend: p.spend, paid_sessions: p.paid_sessions })),
      channels: model.channels.slice(0, 10).map((c) => ({ channel: clip(c.channel), impressions: c.impressions, clicks: c.clicks, partial: c.partial, missing_platforms: c.missing_platforms, sessions: c.sessions, page_persons: c.page_persons, cta_persons: c.cta, registration_started: c.registration_started, marketing_funnel_signups: c.registration_finished, login: c.login, project: c.project, posthog_in_other: c.posthog_in_other })),
      // Only campaigns that exist on an ad platform and have a plain name: GA4 utm_campaign values are free text.
      campaigns: model.campaigns.filter((c) => c.platform && keyOf(c.campaign) !== UNSET && SAFE_CAMPAIGN.test(c.campaign)).slice(0, 10)
        .map((c) => ({ campaign: c.campaign, impressions: c.impressions, clicks: c.clicks, spend: c.spend, sessions: c.sessions })),
      highlights: model.highlights,
      posthog_channel_split_available: !!(model.posthog_channels && model.posthog_channels.status === 'loaded'),
    };
  }

  if (!A) return { STEPS, POSTHOG_INDEX, build, summarize, NO_DATA };

  // ---------- browser: collect from the dashboard data, render and load
  const PLATFORMS = [
    { key: 'meta', name: 'Meta Ads', channel: 'Paid Social' },
    { key: 'linkedin', name: 'LinkedIn Ads', channel: 'Paid Social' },
    { key: 'google_ads', name: 'Google Ads', channel: 'Paid Search' },
  ];
  const state = { view: 'channel' };
  const optsOf = (o = {}) => ({ path: 'marketing_project', from: o.from || A.S.from, to: o.to || A.S.to, exclude: o.exclude == null ? A.S.exInt : !!o.exclude });
  function entryState(entry) {
    if (!entry || (!entry.data && !entry.error)) return { status: 'loading' };
    if (entry.error) return { status: 'error', error: entry.error };
    return { status: 'loaded', ...entry.data };
  }
  function collect(o = {}, { withCampaignSplit = true } = {}) {
    const D = A.D, { from, to, exclude, path } = optsOf(o);
    const platforms = PLATFORMS.map((p) => {
      const stats = D.paidStats(p.key, from, to);
      const clickMetric = p.key === 'meta' ? 'ad_link_clicks' : 'ad_clicks';
      const byName = (metric) => Object.fromEntries(D.has(p.key, metric) ? D.byDim(p.key, metric, from, to) : []);
      const imp = byName('ad_impressions'), clk = byName(clickMetric), spend = byName('ad_spend');
      const names = [...new Set([...Object.keys(imp), ...Object.keys(clk)])];
      return { ...p, impressions: stats.impressions, clicks: stats.clicks, spend: stats.spend, paid_sessions: stats.sessions,
        campaigns: names.map((campaign) => ({ campaign, impressions: imp[campaign] ?? null, clicks: clk[campaign] ?? null, spend: spend[campaign] ?? null })) };
    });
    const ga = D.ga(from, to);
    const utm = D.utmRows(from, to), byCampaign = {};
    for (const r of utm) byCampaign[r.campaign || '(not set)'] = (byCampaign[r.campaign || '(not set)'] || 0) + (Number(r.sessions) || 0);
    // Cap check on the whole GA4 snapshot (as Acquisition does), not the rows left after the date filter.
    const utmSnap = D.snap('ga4', 'utm_attribution');
    const ga4 = ga ? { sessions: ga.sessions, channels: D.gaChannels(from, to).map((r) => ({ channel: r.channel, sessions: r.sessions })), campaigns: Object.entries(byCampaign).map(([campaign, sessions]) => ({ campaign, sessions })), campaigns_capped: !!(utmSnap && (utmSnap.rows || []).length >= 1000) } : null;
    const F = A.posthogFunnel;
    const posthog = F && F.cached ? entryState(F.cached({ path, from, to, exclude })) : { status: 'error', error: 'PostHog funnel unavailable' };
    const posthogChannels = F && F.cached ? entryState(F.cached({ path, from, to, exclude, breakdown: 'channel' })) : null;
    const campaignsEntry = withCampaignSplit && F && F.cached ? F.cached({ path, from, to, exclude, breakdown: 'campaign' }) : null;
    return build({ from, to, exclude, platforms, ga4, posthog, posthogChannels, posthogCampaigns: campaignsEntry ? entryState(campaignsEntry) : null });
  }
  function bar(value, max) {
    if (value == null || !(max > 0)) return 0;
    // Log scale: impressions and persons differ by orders of magnitude; linear bars would hide the bottom.
    return Math.max(value > 0 ? 1 : 0, Math.min(100, Math.log10(value + 1) / Math.log10(max + 1) * 100));
  }
  function splitLine(step) {
    const U = A.ui;
    if (!step.split) {
      if (step.unit !== 'persons' || step.status !== 'loaded') return '';
      const ch = collectState.channels;
      return `<div class="agg-split text-muted">By channel: ${ch && ch.status === 'error' ? `unavailable · ${U.esc(ch.error)}` : 'loading PostHog channel split…'}</div>`;
    }
    if (!step.split.length) return '<div class="agg-split text-muted">By channel: no rows in this period</div>';
    const parts = step.split.slice(0, 5).map((r) => `${U.esc(r.label)} <b>${r.status === 'no_data' ? `<span class="awaiting-chip">${NO_DATA}</span>` : U.fmt(r.value)}</b>`);
    const more = step.split.length > 5 ? ` · +${step.split.length - 5} more` : '';
    return `<div class="agg-split">${step.key === 'impressions' || step.key === 'clicks' ? 'By platform' : 'By channel'}: ${parts.join(' · ')}${more}</div>`;
  }
  const collectState = { channels: null };
  function funnelHtml(model) {
    const U = A.ui, max = Math.max(...model.steps.map((s) => s.value || 0));
    let html = '';
    model.steps.forEach((s, i) => {
      if (i > 0) {
        const rate = s.rate == null ? 'n/a' : U.pct(s.rate);
        html += `<div class="funnel-conn"><span class="keep">${U.icon('arrow-down')} ${rate}</span><span class="drop">${U.esc(s.basis)}</span>${s.unitChange ? `<span class="agg-unit">${U.icon('right-left')} Unit changes: ${U.esc(s.unitChange)}</span>` : ''}</div>`;
      }
      const waiting = s.status !== 'loaded';
      const count = waiting ? `<span class="awaiting-chip">${U.esc(s.status === 'loading' ? 'Loading…' : s.key === 'impressions' || s.key === 'clicks' ? NO_DATA : s.reason)}</span>` : `${U.fmt(s.value)} <em>${U.esc(s.unit)}</em>`;
      html += `<div class="funnel-step" role="listitem"><span class="funnel-idx">${i + 1}</span><span class="funnel-name">${U.esc(s.name)}<small>${U.esc(s.source)}</small></span><div class="funnel-track${waiting ? ' pending' : ''}">${waiting ? '' : `<div class="funnel-fill" style="width:${bar(s.value, max).toFixed(2)}%"></div>`}</div><span class="funnel-count">${count}</span></div>${splitLine(s)}`;
    });
    return `<div class="funnel" role="list" aria-label="All-channel funnel">${html}</div>`;
  }
  function tableHtml(model) {
    const U = A.ui, n = (v) => (v == null ? `<span class="text-muted">${NO_DATA}</span>` : U.fmt(v));
    const select = `<label class="field"><span>View by</span><select data-agg-view aria-label="All-channel funnel breakdown">${[['channel', 'Channel'], ['platform', 'Ad platform'], ['campaign', 'Campaign / ad']].map(([id, label]) => `<option value="${id}"${state.view === id ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
    let body;
    if (state.view === 'platform') {
      body = U.table([
        { t: 'Platform', k: 'name' }, { t: 'Impressions', num: 1, f: (r) => n(r.impressions) }, { t: 'Ad clicks', num: 1, f: (r) => n(r.clicks) },
        { t: 'CTR', num: 1, f: (r) => U.pct(ratio(r.clicks, r.impressions)) }, { t: 'Spend', num: 1, f: (r) => (r.spend == null ? `<span class="text-muted">${NO_DATA}</span>` : U.money(r.spend)) },
        { t: 'GA4 paid sessions', num: 1, f: (r) => (r.paid_sessions == null ? '–' : U.fmt(r.paid_sessions)) }, { t: 'Paid sessions per click', num: 1, f: (r) => U.pct(ratio(r.paid_sessions, r.clicks)) },
      ], model.platforms) + '<p class="card-note">Impressions, clicks and spend come from each ad platform. GA4 paid sessions are UTM sessions matched to the platform (utm_source and a paid utm_medium). A platform without a connected report shows "No data connected"; it is never estimated.</p>';
    } else if (state.view === 'campaign') {
      const ph = model.posthog_campaigns;
      const phNote = !ph ? 'PostHog split by utm_campaign loads when this view opens.' : ph.status === 'error' ? `PostHog split by utm_campaign unavailable: ${U.esc(ph.error)}.` : ph.status === 'loading' ? 'Loading PostHog split by utm_campaign…' : 'PostHog persons by utm_campaign of the first funnel step.';
      const rows = model.campaigns.slice(0, 25);
      body = (rows.length ? U.table([
        { t: 'Campaign', f: (r) => `${U.esc(r.campaign)}${r.platform ? `<br><small class="text-muted">${U.esc(r.platform)}</small>` : ''}` },
        { t: 'Impressions', num: 1, f: (r) => (r.impressions == null ? '–' : U.fmt(r.impressions)) }, { t: 'Ad clicks', num: 1, f: (r) => (r.clicks == null ? '–' : U.fmt(r.clicks)) },
        { t: 'GA4 sessions', num: 1, f: (r) => (r.sessions == null ? '–' : U.fmt(r.sessions)) }, { t: 'CTA persons', num: 1, f: (r) => (r.cta == null ? '–' : U.fmt(r.cta)) },
        { t: 'Reg. started', num: 1, f: (r) => (r.registration_started == null ? '–' : U.fmt(r.registration_started)) }, { t: 'Funnel sign-ups (ordered)', num: 1, f: (r) => (r.registration_finished == null ? '–' : U.fmt(r.registration_finished)) },
        { t: 'Project', num: 1, f: (r) => (r.project == null ? '–' : U.fmt(r.project)) },
      ], rows) : U.empty('No campaign rows yet', 'No ad campaign, UTM campaign or PostHog campaign data in this period.', 'bullhorn'))
        + `<p class="card-note">Ad platform campaign names and utm_campaign values are joined when the names match ignoring case, spaces, "-" and "_"; "(not set)" also groups PostHog "(none)". "–" means that source has no row with that name. GA4 sessions by campaign come from the UTM detail snapshot${model.ga4_campaigns_capped ? ', which hit its 1,000-row cap and can omit rows' : ''}. ${phNote}</p>`;
    } else {
      const ph = model.posthog_channels;
      const phNote = !ph || ph.status === 'loading' ? 'Loading PostHog split by channel…' : ph.status === 'error' ? `PostHog split by channel unavailable: ${U.esc(ph.error)}. Ad and GA4 columns are unaffected.` : 'PostHog persons by $channel_type of the first funnel step (first touch).';
      const ad = (r, v) => (v != null && r.partial ? `${U.fmt(v)} <span class="awaiting-chip" title="${U.esc(`${r.missing_platforms.join(', ')}: ${NO_DATA}`)}">partial · no ${U.esc(r.missing_platforms.join(', '))}</span>` : n(v));
      const phCell = (r, v) => (r.posthog_in_other ? '<span class="text-muted">in Other</span>' : n(v));
      body = (model.channels.length ? U.table([
        { t: 'Channel', k: 'channel' }, { t: 'Impressions', num: 1, f: (r) => ad(r, r.impressions) }, { t: 'Ad clicks', num: 1, f: (r) => ad(r, r.clicks) },
        { t: 'Landing sessions', num: 1, f: (r) => n(r.sessions) }, { t: 'CTA persons', num: 1, f: (r) => phCell(r, r.cta) },
        { t: 'Reg. started', num: 1, f: (r) => phCell(r, r.registration_started) }, { t: 'Funnel sign-ups (ordered)', num: 1, f: (r) => phCell(r, r.registration_finished) },
        { t: 'Login', num: 1, f: (r) => phCell(r, r.login) }, { t: 'Project', num: 1, f: (r) => phCell(r, r.project) },
        { t: 'Funnel sign-ups ÷ CTA persons', num: 1, f: (r) => U.pct(r.signup_rate_of_cta) }, { t: 'Sign-ups per 1,000 sessions', num: 1, f: (r) => (r.signups_per_1000_sessions == null ? '–' : U.fmt(r.signups_per_1000_sessions, 1)) },
      ], model.channels) : U.empty('No channel rows yet', 'No ad, GA4 or PostHog channel data in this period.', 'diagram-project'))
        + `<p class="card-note">Ad platforms map to their paid channel (Meta and LinkedIn: Paid Social; Google Ads: Paid Search); a paid channel whose platforms are not connected shows "No data connected", and "partial" when only some of them report. Landing sessions use the GA4 default channel group. ${phNote} Rows are joined by channel name; "in Other" means PostHog counted that channel inside its "Other" group. "(not set)" groups GA4 "(not set)" and PostHog "(none)". "Sign-ups per 1,000 sessions" divides PostHog persons by GA4 sessions: a directional comparison between channels, not a conversion rate.</p>`;
    }
    return `<div class="funnel-controls">${select}</div><div class="agg-table">${body}</div>`;
  }
  function body(o = {}) {
    const model = collect(o), U = A.ui, h = model.highlights;
    collectState.channels = model.posthog_channels;
    const top = h.top_channel_by_landing_sessions;
    const lead = `<p class="card-note">${U.win(model.from, model.to)} · ${model.exclude ? 'internal/test accounts excluded in PostHog' : 'internal/test accounts included'} · GA4 traffic can include tests${top ? ` · most landing sessions: <b>${U.esc(top.channel)}</b> (${U.fmt(top.sessions)} of ${U.fmt(h.total_landing_sessions)})` : ''}${h.marketing_funnel_signups_ordered != null && h.persons_viewed_marketing_page ? ` · <b>${U.fmt(h.marketing_funnel_signups_ordered)}</b> sign-ups via the marketing funnel (ordered, 14-day window) of ${U.fmt(h.persons_viewed_marketing_page)} persons who viewed a marketing page · not the sign-up KPI` : ''}</p>`;
    const units = '<p class="card-note">Each step keeps its own source and unit: impressions and clicks (ad platforms), sessions (GA4; one person can have several), persons (PostHog ordered funnel, 14-day window; its sign-up step counts only persons who went through page view, CTA and registration first, so it is not the sign-up KPI and is not compared with it). Bar length uses a log scale so every step stays visible. Percentages under each step say exactly what they divide.</p>';
    return lead + funnelHtml(model) + units + tableHtml(model);
  }
  function render(o = {}) {
    const U = A.ui;
    return U.card({ cls: 'chart-card agg-funnel-card', title: 'All-channel funnel', sub: 'Impressions → ad clicks → landing sessions → CTA → registration → sign-up → login → project · one source per step · all channels combined', body: `<div data-agg-funnel>${body(o)}</div>` });
  }
  async function ensure(o = {}, { campaign = false } = {}) {
    const F = A.posthogFunnel;
    if (!F || !F.load) return null;
    const base = optsOf(o);
    const jobs = [F.load(base), F.load({ ...base, breakdown: 'channel' })];
    if (campaign) jobs.push(F.load({ ...base, breakdown: 'campaign' }));
    await Promise.all(jobs.map((p) => Promise.resolve(p).catch(() => null)));
    return assistantSummary(o);
  }
  function assistantSummary(o = {}) { return summarize(collect(o, { withCampaignSplit: false })); }
  function mount(el, o = {}) {
    const box = el.querySelector('[data-agg-funnel]');
    if (!box) return Promise.resolve(null);
    const refresh = () => { if (box.isConnected) box.innerHTML = body(o); };
    el.addEventListener('change', (e) => {
      if (!e.target.hasAttribute || !e.target.hasAttribute('data-agg-view')) return;
      state.view = ['channel', 'platform', 'campaign'].includes(e.target.value) ? e.target.value : 'channel';
      refresh();
      if (state.view === 'campaign') ensure(o, { campaign: true }).then(refresh);
    });
    return ensure(o, { campaign: state.view === 'campaign' }).then((summary) => { refresh(); return summary; });
  }
  return { STEPS, POSTHOG_INDEX, build, summarize, collect, render, mount, ensure, summary: assistantSummary, state };
});

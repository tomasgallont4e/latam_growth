'use strict';
// Executive overview: source-native acquisition totals plus a separate ordered PostHog person funnel.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else window.App.aggregateFunnel = factory(window.App);
})(function (A) {
  const POSTHOG_STEPS = [
    { key: 'page', name: 'Page view', event: 'marketing_page_viewed' },
    { key: 'cta', name: 'CTA clicked', event: 'marketing_cta_clicked' },
    { key: 'registration_started', name: 'Registration started', event: 'registration_started' },
    { key: 'signup', name: 'Sign-up ($identify)', event: 'first $identify per person' },
    { key: 'login', name: 'Login', event: 'saved Login step' },
    { key: 'project', name: 'Project', event: 'saved Project View/Project Created step' },
  ];
  const num = (v) => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const sumKnown = (items) => items.some((x) => x != null) ? items.reduce((n, x) => n + (x == null ? 0 : x), 0) : null;
  const ratio = (n, d) => n != null && d != null && d > 0 ? n / d : null;
  const CONTACT_METRICS = ['contacts', 'hs_contacts'];
  const contactTotal = (D, from, to) => {
    const metric = CONTACT_METRICS.find((key) => D.has('hubspot', key));
    return metric ? D.sum('hubspot', metric, null, from, to) : D.crmTotal(from, to);
  };
  const fmt = (v) => v == null ? 'Pending' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
  function coverage(from, to, cutoff, source) {
    if (!source || source.available === false) return { status: 'pending', from: source?.from || null, to: source?.to || null, cutoff };
    const start = source.from || from, end = source.to || to;
    return { status: start <= from && end >= cutoff ? 'covered' : 'partial', from: start, to: end, cutoff };
  }
  function build(input = {}) {
    const from = input.from || null, to = input.to || null, cutoff = input.cutoff || to;
    const platforms = (input.platforms || []).map((p) => ({ key: p.key, name: p.name || p.key, impressions: num(p.impressions), clicks: num(p.clicks), spend: num(p.spend) }));
    const adsTotals = { impressions: sumKnown(platforms.map((p) => p.impressions)), clicks: sumKnown(platforms.map((p) => p.clicks)) };
    const ga4 = input.ga4 || {}, hubspot = input.hubspot || {};
    const adsCov = coverage(from, to, cutoff, input.adsCoverage || { available: platforms.some((p) => p.impressions != null || p.clicks != null) });
    const gaCov = coverage(from, to, cutoff, ga4.coverage || { available: ga4.sessions != null, from: ga4.from, to: ga4.to });
    const hsCov = coverage(from, to, cutoff, hubspot.coverage || { available: hubspot.contacts != null, from: hubspot.from, to: hubspot.to });
    const acquisition = { period: { from, to, cutoff }, sources: {
      ads: { totals: adsTotals, coverage: adsCov, platforms },
      ga4: { totals: { sessions: num(ga4.sessions) }, coverage: gaCov, channels: (ga4.channels || []).map((r) => ({ channel: String(r.channel || '(not set)'), sessions: num(r.sessions) })) },
      hubspot: { totals: { contacts: num(hubspot.contacts) }, coverage: hsCov },
    } };
    const coverageRows = [adsCov, gaCov, hsCov];
    acquisition.coverage_mismatch = coverageRows.some((c) => c.status !== 'covered') || coverageRows.some((c) => c.from !== coverageRows[0].from || c.to !== coverageRows[0].to);
    const ph = input.posthog || { status: 'loading' };
    const rawSteps = ph.status === 'loaded' && Array.isArray(ph.steps) ? ph.steps : null;
    const steps = POSTHOG_STEPS.map((def, index) => {
      const value = rawSteps && rawSteps[index] ? num(rawSteps[index].n) : null;
      const previous = index && rawSteps && rawSteps[index - 1] ? num(rawSteps[index - 1].n) : null;
      return { ...def, value, status: value != null ? 'loaded' : ph.status === 'loading' ? 'loading' : ph.status === 'error' ? 'error' : 'pending', rate: index ? ratio(value, previous) : null, rate_basis: index ? 'within saved ordered PostHog funnel' : null };
    });
    const product_funnel = { period: { from, to, cutoff }, coverage: { from: ph.from || from, to: ph.to || to, cutoff, status: ph.status || 'pending' }, steps, window_days: ph.window_days || null };
    return { from, to, cutoff, exclude: !!input.exclude, acquisition, product_funnel };
  }
  function summarize(model) { return { period: { from: model.from, to: model.to, cutoff: model.cutoff }, acquisition: model.acquisition, product_funnel: model.product_funnel, rule: 'Source totals are independent populations. No cross-source conversion rates or identity joins.' }; }
  if (!A) return { POSTHOG_STEPS, build, summarize };

  const PLATFORMS = [{ key: 'meta', name: 'Meta Ads' }, { key: 'linkedin', name: 'LinkedIn Ads' }, { key: 'google_ads', name: 'Google Ads' }];
  const options = (o = {}) => ({ from: o.from || A.S.from, to: o.to || A.S.to, exclude: o.exclude == null ? A.S.exInt : !!o.exclude });
  function collect(o = {}) {
    const D = A.D, { from, to, exclude } = options(o);
      const platforms = PLATFORMS.map((p) => { const stats = D.paidStats(p.key, from, to); return { ...p, impressions: stats.impressions, clicks: stats.clicks, spend: stats.spend }; });
    const ga = D.ga(from, to), gaSnap = D.snap && D.snap('ga4', 'totals', from, to);
    const contacts = contactTotal(D, from, to);
    const contactCoverage = D.snap && D.snap('hubspot', 'utm_capture', from, to);
    const F = A.posthogFunnel, entry = F && F.cached ? F.cached({ path: 'marketing_project', from, to, exclude }) : null;
    return build({ from, to, cutoff: to, exclude, platforms,
      ga4: { sessions: ga ? ga.sessions : null, channels: D.gaChannels(from, to), from: gaSnap && gaSnap.from, to: gaSnap && gaSnap.to, coverage: { available: ga != null, from: gaSnap && gaSnap.from, to: gaSnap && gaSnap.to } },
      hubspot: { contacts, from: contactCoverage && contactCoverage.from, to: contactCoverage && contactCoverage.to, coverage: { available: contacts != null, from: contactCoverage && contactCoverage.from, to: contactCoverage && contactCoverage.to } },
      posthog: entry ? entry.error ? { status: 'error', error: entry.error } : entry.data ? { ...entry.data, status: 'loaded' } : { status: 'loading' } : { status: 'loading' },
    });
  }
  const statusLabel = (cov) => cov.status === 'covered' ? 'Covered' : cov.status === 'partial' ? `Partial · ${cov.from || 'unknown'} to ${cov.to || 'unknown'}` : 'Pending';
  function acquisitionHtml(model) {
    const U = A.ui, a = model.acquisition.sources;
    const card = (title, source, rows) => `<section class="agg-source"><h4>${title}</h4><p class="card-note">${model.from} to ${model.to} · cutoff ${model.cutoff} · ${statusLabel(source.coverage)}</p>${rows}</section>`;
    const adRows = U.table([{ t: 'Platform', k: 'name' }, { t: 'Impressions', num: 1, f: (r) => fmt(r.impressions) }, { t: 'Clicks', num: 1, f: (r) => fmt(r.clicks) }, { t: 'Spend', num: 1, f: (r) => r.spend == null ? 'Pending' : U.money(r.spend) }], a.ads.platforms);
    const gaRows = a.ga4.channels.length ? U.table([{ t: 'GA4 channel', k: 'channel' }, { t: 'Sessions', num: 1, f: (r) => fmt(r.sessions) }], a.ga4.channels) : '<p class="card-note">No GA4 channel detail available.</p>';
    return `<h3>Acquisition totals by source</h3><p class="card-note">Totals are source-native and describe different populations. No cross-source conversion rates or identity joins are shown.</p><div class="agg-source-grid">${card('Ads platforms', a.ads, `<p>Impressions <b>${fmt(a.ads.totals.impressions)}</b> · Clicks <b>${fmt(a.ads.totals.clicks)}</b></p>${adRows}`)}${card('Google Analytics 4', a.ga4, `<p>Sessions <b>${fmt(a.ga4.totals.sessions)}</b></p>${gaRows}`)}${card('HubSpot', a.hubspot, `<p>Contacts <b>${fmt(a.hubspot.totals.contacts)}</b></p><p class="card-note">Contacts are leads/contacts, not product sign-ups.</p>`)}</div>${model.acquisition.coverage_mismatch ? '<p class="awaiting-chip">Coverage mismatch: source windows or availability differ; compare totals with care.</p>' : ''}`;
  }
  function productHtml(model) {
    const U = A.ui, f = model.product_funnel, max = Math.max(0, ...f.steps.map((s) => s.value || 0));
    const html = f.steps.map((s, i) => {
      const count = s.status === 'loaded' ? `${fmt(s.value)} <em>persons</em>` : `<span class="awaiting-chip">${U.esc(s.status === 'error' ? 'PostHog funnel unavailable' : s.status === 'loading' ? 'Loading…' : 'Pending')}</span>`;
      const width = max && s.value != null ? Math.max(1, s.value / max * 100) : 0;
      const rate = s.rate == null ? '' : `<p class="card-note">${U.pct(s.rate)} of previous step · ${U.esc(s.rate_basis)}</p>`;
      return `<div class="funnel-step" role="listitem"><span class="funnel-idx">${i + 1}</span><span class="funnel-name">${U.esc(s.name)}<small>PostHog · ${U.esc(s.event)}</small></span><div class="funnel-track"><div class="funnel-fill" style="width:${width.toFixed(2)}%"></div></div><span class="funnel-count">${count}</span></div>${rate}`;
    }).join('');
    return `<h3>Ordered PostHog person funnel</h3><p class="card-note">${model.from} to ${model.to} · cutoff ${model.cutoff} · ${f.window_days || 'Saved'}-day saved ordered funnel · exclude internal/test: ${model.exclude ? 'on' : 'off'} · each percentage is only within this PostHog funnel.</p><div class="funnel" role="list" aria-label="Ordered PostHog person funnel">${html}</div><p class="card-note">Sign-up is the first $identify per person. It is not joined to Ads, GA4 sessions, or HubSpot contacts.</p>`;
  }
  function render(o = {}) { const model = collect(o); return A.ui.card({ cls: 'chart-card agg-funnel-card', title: 'Executive funnel', sub: 'Source totals and a separate ordered PostHog person journey', body: `<div data-agg-funnel>${acquisitionHtml(model)}${productHtml(model)}</div>` }); }
  async function ensure(o = {}) { const F = A.posthogFunnel; if (F && F.load) await Promise.resolve(F.load({ ...options(o), path: 'marketing_project' })).catch(() => null); return summarize(collect(o)); }
  function mount(el, o = {}) { const box = el.querySelector('[data-agg-funnel]'); if (!box) return Promise.resolve(null); const refresh = () => { if (box.isConnected) { const model = collect(o); box.innerHTML = acquisitionHtml(model) + productHtml(model); } }; return ensure(o).then((summary) => { refresh(); return summary; }); }
  return { POSTHOG_STEPS, build, summarize, collect, render, mount, ensure, summary: (o) => summarize(collect(o)) };
});

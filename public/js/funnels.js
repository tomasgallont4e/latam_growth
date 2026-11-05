'use strict';
(function (A) {
  const platforms = { posthog: 'PostHog', ga4: 'Google Analytics 4', hubspot: 'HubSpot', meta: 'Meta Ads', linkedin: 'LinkedIn', google_ads: 'Google Ads' };
  const paths = { marketing_project: 'Marketing-to-Project Activation Funnel', website: 'Website → Registration', mvp: 'MVP acquisition → completed review', landing_project: 'Landing → cuenta y proyecto (sin internos)' };
  const cache = new Map();
  const state = { platform: 'posthog', path: 'marketing_project' };
  const keyFor = (path, from = A.S.from, to = A.S.to, exclude = A.S.exInt) => [path, from, to, exclude].join('|');
  const key = () => keyFor(state.path);
  function nativeBody(data) {
    const U = A.ui;
    const base = data.steps[0]?.n;
    return `<p class="card-note">Ordered persons · ${U.esc(data.window_days)}-day window · ${U.win(data.from, data.to)} · whole selected range; Group by does not split this funnel into ${A.D.grainName().toLowerCase()} cohorts</p><div class="native-funnel" role="list" aria-label="${U.esc(data.title)}">${data.steps.map((s, i) => {
      const previous = data.steps[i - 1]?.n, missing = s.n == null;
      const pct = base > 0 && !missing ? s.n / base : null;
      const continuation = i > 0 && previous > 0 && !missing ? s.n / previous : null;
      return `<div class="native-funnel-step" role="listitem"><b>${i + 1}. ${U.esc(s.name)}</b><div class="native-funnel-track"><i style="width:${pct == null ? 0 : Math.min(100, pct * 100)}%"></i></div><div class="native-funnel-caption">${missing ? '<span class="text-muted">Awaiting events</span>' : `<strong>${U.fmt(s.n)} persons</strong>${pct == null ? '' : ` · ${U.pct(pct)} of first step`}`}${continuation == null ? '' : ` · ${U.pct(continuation)} continue · ${U.fmt(Math.max(0, previous - s.n))} drop off`}${s.median_seconds == null ? '' : ` · median ${U.fmt(s.median_seconds)}s`}</div></div>`;
    }).join('')}</div>`;
  }
  function body() {
    const U = A.ui, D = A.D;
    if (state.platform === 'posthog') {
      const entry = cache.get(key());
      if (!entry) return '<div class="empty-state slim">Loading PostHog funnel…</div>';
      if (entry.error) {
        const permanent = /\((?:401|403)\)/.test(entry.error);
        return `<div class="empty-state slim"><b>Funnel unavailable</b><span>${U.esc(entry.error)}</span>${permanent ? '' : '<button class="btn btn-secondary btn-sm" data-funnel-retry>Retry</button>'}</div>`;
      }
      if (!entry.data) return '<div class="empty-state slim">Loading PostHog funnel…</div>';
      return nativeBody(entry.data);
    }
    let steps;
    const step = (name, n) => ({ name, src: platforms[state.platform], n, separate: true, bridge: 'Platform activity counts; not an ordered person funnel' });
    if (state.platform === 'ga4') {
      const ga = D.ga();
      steps = [step('Sessions', ga?.sessions ?? null), step('Engaged sessions', ga?.engaged ?? null), ...['form_start', 'sign_up', 'login', 'generate_lead'].map((e) => step(`${e} · events`, D.ga4Event(e)?.count ?? null))];
    } else if (state.platform === 'hubspot') {
      steps = [step('Site sessions', D.has('hubspot', 'sessions') ? D.sessions() : null), step('CRM contacts', D.crmTotal())];
    } else {
      const stats = D.paidStats(state.platform);
      steps = [step('Ad impressions', stats.impressions), step('Ad clicks', stats.clicks)];
      if (state.platform === 'linkedin') steps.push(step('Organic post impressions', D.has('linkedin', 'post_impressions') ? D.sum('linkedin', 'post_impressions') : null));
    }
    return A.charts.funnel(steps, `${platforms[state.platform]} activity`);
  }
  function render() {
    const U = A.ui;
    const controls = `<div class="funnel-controls"><label>Platform <select aria-label="Funnel platform" data-funnel-platform>${Object.entries(platforms).map(([id, name]) => `<option value="${id}"${id === state.platform ? ' selected' : ''}>${name}</option>`).join('')}</select></label>${state.platform === 'posthog' ? `<label>Funnel <select aria-label="PostHog funnel" data-funnel-path>${Object.entries(paths).map(([id, name]) => `<option value="${id}"${id === state.path ? ' selected' : ''}>${name}</option>`).join('')}</select></label>` : ''}</div>`;
    const posthogSub = state.path === 'landing_project'
      ? `Ordered persons · ${U.win(A.S.from, A.S.to)} · full selected range, not split into ${A.D.grainName().toLowerCase()} cohorts · Landing → CTA → registration → Identify ($identify) → Proyecto creado (clic) · click proxy, not confirmed creation · ${A.S.exInt ? 'internal/test filter on' : 'internal/test filter off'}`
      : state.path === 'marketing_project'
        ? `Ordered persons · ${U.win(A.S.from, A.S.to)} · saved PostHog steps, action IDs and filters are reused · Marketing page → CTA → registration → Registration Finished → Login → Project View/Project Created · ${A.S.exInt ? 'internal/test filter on' : 'internal/test filter off'}`
        : `PostHog: ${U.win(A.S.from, A.S.to)} · full selected-range funnel, not split into ${A.D.grainName().toLowerCase()} cohorts · registration_started is the step before account creation (first identify) · ${A.S.exInt ? 'internal/test filter on' : 'internal/test filter off'}`;
    return U.card({ cls: 'chart-card', title: 'Funnels by platform', sub: state.platform === 'posthog' ? posthogSub : `Selected-range activity totals · not split into ${A.D.grainName().toLowerCase()} buckets · each platform keeps its own definitions`, body: `${controls}<div data-platform-funnel>${body()}</div>` });
  }
  function summary() {
    if (state.platform !== 'posthog') return null;
    const entry = cache.get(key()), data = entry && entry.data;
    if (!data) return null;
    return {
      name: String(data.title || paths[state.path]), platform: 'posthog', path: state.path,
      from: String(data.from || A.S.from), to: String(data.to || A.S.to), window_days: Number(data.window_days) || null,
      steps: (data.steps || []).slice(0, 10).map((s) => ({
        name: String(s.name || 'Funnel step'),
        n: Number.isFinite(Number(s.n)) ? Number(s.n) : null,
        median_seconds: s.median_seconds == null ? null : Number(s.median_seconds),
      })),
    };
  }
  function loadCached(path, from, to, exclude, force = false) {
    const cacheKey = keyFor(path, from, to, exclude);
    let entry = cache.get(cacheKey);
    if (entry && !force && Date.now() - entry.at < 300000) {
      return entry.promise ? entry.promise.then(() => entry) : Promise.resolve(entry);
    }
    entry = { at: Date.now() };
    cache.set(cacheKey, entry);
    const query = `funnel=${encodeURIComponent(path)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&exclude=${exclude ? '1' : '0'}`;
    entry.promise = A.api(`api/funnels/posthog?${query}`).then((data) => { entry.data = data; }).catch((error) => { entry.error = error.message; });
    return entry.promise.then(() => entry);
  }
  async function loadData(force = false) {
    if (state.platform !== 'posthog') return null;
    return loadCached(state.path, A.S.from, A.S.to, A.S.exInt, force);
  }
  async function ensureSummary() {
    if (state.platform !== 'posthog') return null;
    await loadData();
    return summary();
  }
  function mount(el) {
    async function load(force = false) {
      const box = el.querySelector('[data-platform-funnel]');
      if (!box || state.platform !== 'posthog') return;
      const k = key();
      await loadData(force);
      if (box.isConnected && key() === k && state.platform === 'posthog') box.innerHTML = body();
    }
    el.addEventListener('change', (e) => {
      if (e.target.hasAttribute('data-funnel-platform') && platforms[e.target.value]) { state.platform = e.target.value; A.render(); }
      if (e.target.hasAttribute('data-funnel-path') && paths[e.target.value]) { state.path = e.target.value; A.render(); }
    });
    el.addEventListener('click', (e) => { if (e.target.closest('[data-funnel-retry]')) load(true); });
    load();
  }
  A.platformFunnels = { render, mount, nativeBody, summary, ensureSummary };
  A.posthogFunnel = {
    render: ({ path = 'marketing_project', from = A.S.from, to = A.S.to, exclude = A.S.exInt } = {}) => {
      const cacheEntry = cache.get(keyFor(path, from, to, exclude));
      const data = cacheEntry && cacheEntry.data;
      return `<div data-posthog-funnel>${data ? nativeBody(data) : '<div class="empty-state slim">Loading PostHog funnel…</div>'}</div>`;
    },
    mount: (el, options = {}) => {
      const { path = 'marketing_project', from = A.S.from, to = A.S.to, exclude = A.S.exInt } = options;
      const box = el.querySelector('[data-posthog-funnel]');
      if (!box) return Promise.resolve(null);
      const load = (force = false) => loadCached(path, from, to, exclude, force).then((entry) => {
        if (!box.isConnected) return entry;
        if (entry.error) {
          const permanent = /\((?:401|403)\)/.test(entry.error);
          box.innerHTML = `<div class="empty-state slim"><b>Funnel unavailable</b><span>${A.ui.esc(entry.error)}</span>${permanent ? '' : '<button class="btn btn-secondary btn-sm" data-funnel-retry>Retry</button>'}</div>`;
        } else if (entry.data) box.innerHTML = nativeBody(entry.data);
        return entry;
      });
      el.addEventListener('click', (event) => {
        if (event.target.closest('[data-funnel-retry]')) load(true);
      });
      return load();
    },
  };
})(window.App);

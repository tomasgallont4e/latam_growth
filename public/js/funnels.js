'use strict';
(function (A) {
  const platforms = { posthog: 'PostHog', ga4: 'Google Analytics 4', hubspot: 'HubSpot', meta: 'Meta Ads', linkedin: 'LinkedIn', google_ads: 'Google Ads' };
  const paths = { website: 'Website → Registration', mvp: 'MVP acquisition → completed review', landing_project: 'Landing → cuenta y proyecto (sin internos)' };
  const cache = new Map();
  const state = { platform: 'posthog', path: 'website' };
  const key = () => [state.path, A.S.from, A.S.to, A.S.exInt].join('|');
  function nativeBody(data) {
    const U = A.ui;
    const base = data.steps[0]?.n;
    return `<p class="card-note">Ordered persons · ${U.esc(data.window_days)}-day window · ${U.win(data.from, data.to)}</p><div class="native-funnel" role="list" aria-label="${U.esc(data.title)}">${data.steps.map((s, i) => {
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
      ? `Ordered persons · Landing → CTA → registration → Identify ($identify) → Proyecto creado (clic) · click proxy, not confirmed creation · ${A.S.exInt ? 'internal/test filter on' : 'internal/test filter off'}`
      : `PostHog: registration_started is the step before account creation (first identify) · ${A.S.exInt ? 'internal/test filter on' : 'internal/test filter off'}`;
    return U.card({ cls: 'chart-card', title: 'Funnels by platform', sub: state.platform === 'posthog' ? posthogSub : 'Each platform keeps its own activity definitions', body: controls + `<div data-platform-funnel>${body()}</div>` });
  }
  function mount(el) {
    async function load(force = false) {
      const box = el.querySelector('[data-platform-funnel]');
      if (!box || state.platform !== 'posthog') return;
      const k = key(), old = cache.get(k);
      let entry = old;
      if (force || !entry || Date.now() - entry.at >= 300000) {
        entry = { at: Date.now() }; cache.set(k, entry);
        const query = `funnel=${state.path}&from=${A.S.from}&to=${A.S.to}&exclude=${A.S.exInt ? '1' : '0'}`;
        entry.promise = A.api(`api/funnels/posthog?${query}`).then((data) => { entry.data = data; }).catch((e) => { entry.error = e.message; });
      }
      await entry.promise;
      if (box.isConnected && key() === k && state.platform === 'posthog') box.innerHTML = body();
    }
    el.addEventListener('change', (e) => {
      if (e.target.hasAttribute('data-funnel-platform') && platforms[e.target.value]) { state.platform = e.target.value; A.render(); }
      if (e.target.hasAttribute('data-funnel-path') && paths[e.target.value]) { state.path = e.target.value; A.render(); }
    });
    el.addEventListener('click', (e) => { if (e.target.closest('[data-funnel-retry]')) load(true); });
    load();
  }
  A.platformFunnels = { render, mount, nativeBody };
})(window.App);

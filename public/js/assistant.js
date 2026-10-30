'use strict';
(function (A) {
  const state = { ready: null, model: '', statusRequested: false, statusError: '', question: '', answer: '', answerPeriod: null, error: '', loading: false, insightKey: '', insightStatus: 'idle', insightText: '', insightError: '', insightPeriod: '', insightSeq: 0, insightPreparing: false };
  const finite = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  function context() {
    const S = A.S, D = A.D, ga = D.ga() || {}, paid = D.paidTotals() || {};
    const countries = new Map();
    for (const row of D.gaCountries() || []) {
      const name = String(row.country || '').trim();
      if (name) countries.set(name, { country: name, sessions: finite(row.sessions), accounts_created: null });
    }
    for (const [country, count] of Object.entries(D.accountsCountries() || {})) {
      const name = String(country || '').trim();
      if (!name) continue;
      const row = countries.get(name) || { country: name, sessions: null, accounts_created: null };
      row.accounts_created = finite(count); countries.set(name, row);
    }
    const funnel = A.platformFunnels && A.platformFunnels.summary ? A.platformFunnels.summary() : null;
    const hubspotTotals = D.channels() || [];
    const hubspotChannels = (A.charts.CHANNELS || []).map((channel, i) => ({ channel: channel.name, sessions: finite(hubspotTotals[i]) })).filter((row) => row.sessions > 0);
    return {
      period: { from: S.from, to: S.to, grouping: D.grainName() },
      internal_tests_excluded: !!S.exInt,
      previous_period_available: typeof D.prev === 'function' && !!D.prev(),
      funnel_name: funnel ? funnel.name : null,
      kpis: {
        ga4_sessions: finite(ga.sessions), ga4_users: finite(ga.users),
        ga4_engaged_sessions: finite(ga.engaged), ga4_engagement_rate: finite(ga.rate),
        hubspot_sessions: finite(D.sessions()), hubspot_contacts: finite(D.crmTotal()),
        posthog_accounts_created: finite(D.accounts()),
        posthog_accounts_created_since_launch: finite(D.accounts(A.LAUNCH || S.from, S.to)),
        posthog_registration_starts: finite(D.registrations()),
        posthog_project_create_clicks: finite(D.proxy()),
        posthog_new_observed_people: finite(D.platform()),
        goal_500k_target: finite(S.data && S.data.goalPlan && S.data.goalPlan.verified_users),
        paid_spend: finite(paid.spend), paid_clicks: finite(paid.clicks),
        paid_sessions: finite(paid.sessions), paid_contacts: finite(paid.forms),
      },
      ga4_channels: (D.gaChannels() || []).slice(0, 10).map((row) => ({ channel: row.channel, sessions: finite(row.sessions), engaged_sessions: finite(row.engaged_sessions) })),
      hubspot_channels: hubspotChannels,
      countries: [...countries.values()].sort((a, b) => ((b.sessions || 0) + (b.accounts_created || 0)) - ((a.sessions || 0) + (a.accounts_created || 0))).slice(0, 10),
      posthog_funnel: funnel ? (funnel.steps || []).slice(0, 10).map((step) => ({ step: step.name, persons: finite(step.n), median_seconds: finite(step.median_seconds) })) : [],
    };
  }
  function inlineMarkdown(value) {
    return A.ui.esc(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function richText(value) {
    const out = []; let list = false;
    const closeList = () => { if (list) { out.push('</ul>'); list = false; } };
    for (const raw of String(value || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { closeList(); continue; }
      const h2 = /^##\s+(.+)$/.exec(line), h3 = /^###\s+(.+)$/.exec(line), item = /^[-*]\s+(.+)$/.exec(line);
      if (h2) { closeList(); out.push(`<h3>${inlineMarkdown(h2[1])}</h3>`); }
      else if (h3) { closeList(); out.push(`<h4>${inlineMarkdown(h3[1])}</h4>`); }
      else if (item) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inlineMarkdown(item[1])}</li>`); }
      else { closeList(); out.push(`<p>${inlineMarkdown(line)}</p>`); }
    }
    closeList();
    return out.join('');
  }
  function cardStatus() {
    if (state.ready === true) return `Ready · ${A.ui.esc(state.model || 'Anthropic')}`;
    if (state.ready === false) return 'Not configured · set ANTHROPIC_API_KEY in the Think4Ever service variables.';
    return state.statusError ? 'Assistant setup could not be checked.' : 'Checking assistant setup…';
  }
  function insightPanel() {
    if (state.ready === false) return '<div class="growth-insight-state">Overview insights need the server-side ANTHROPIC_API_KEY.</div>';
    if (state.insightStatus === 'loading' || state.insightPreparing) return '<div class="growth-insight-state" role="status">Analyzing Overview data…</div>';
    if (state.insightStatus === 'error') return `<div class="growth-insight-state growth-assistant-error" role="alert">${A.ui.esc(state.insightError || 'Insights could not be generated.')}</div><button class="btn btn-secondary btn-sm" type="button" data-insights-retry>Retry insights</button>`;
    if (state.insightStatus === 'ready' && state.insightText) return `<div class="growth-assistant-report">${richText(state.insightText)}</div><div class="growth-insight-meta">Selected period · ${A.ui.esc(state.insightPeriod)}</div><button class="btn btn-ghost btn-sm" type="button" data-insights-retry>Refresh insights</button>`;
    return '<div class="growth-insight-state">Insights will be generated automatically for this Overview period.</div>';
  }
  function render() {
    const U = A.ui;
    const answer = state.answer
      ? `<div class="growth-assistant-answer" aria-live="polite"><b>Follow-up · ${U.esc(state.answerPeriod || '')}</b><div>${richText(state.answer)}</div></div>`
      : state.error ? `<div class="growth-assistant-error" role="alert">${U.esc(state.error)}</div>`
        : state.loading ? '<div class="growth-assistant-answer" aria-live="polite">Thinking about your question…</div>' : '';
    const disabled = state.loading || state.ready === false ? ' disabled' : '';
    const body = `<div class="growth-assistant-status" role="status">${U.esc(cardStatus())}</div>
      <section class="growth-insights" aria-label="Automatic Overview insights"><div class="growth-insights-heading"><div><b>Overview insights</b><span>Prioritized findings from available data</span></div>${state.insightStatus === 'loading' ? '<span class="insight-pulse">Analyzing</span>' : ''}</div>
        ${insightPanel()}</section>
      <form id="growth-assistant-form" class="growth-assistant-form">
        <label for="growth-assistant-question">Ask a follow-up</label>
        <textarea id="growth-assistant-question" name="question" maxlength="800" rows="2" placeholder="Why is this channel dominant, and what should we check?" required>${U.esc(state.question)}</textarea>
        <div class="growth-assistant-actions"><button class="btn btn-primary" type="submit"${disabled}>Ask assistant</button>
          <button class="btn btn-secondary" type="button" data-assistant-prompt="Explain the largest drop in the visible funnel and what to verify next.">Review funnel</button></div>
      </form>
      ${answer}<p class="growth-assistant-note">Overview analysis runs automatically when the selected data changes. It sends aggregated data to Anthropic, not raw person records. This app does not save the conversation; 10 requests per minute. Do not include personal data or API keys in follow-up questions.</p>`;
    return U.card({ cls: 'chart-card growth-assistant-card', title: 'Growth assistant', sub: 'Executive findings for the selected period, channels, countries and funnel.', body });
  }
  async function ask(question) {
    const snapshot = context();
    state.question = String(question || '').trim(); state.loading = true; state.answer = ''; state.error = ''; state.answerPeriod = `${snapshot.period.from} to ${snapshot.period.to}`;
    try {
      const result = await A.api('api/assistant/ask', { method: 'POST', body: JSON.stringify({ mode: 'question', question: state.question, context: snapshot }) });
      state.answer = String(result.answer || '');
      return result;
    } catch (error) {
      state.error = error.message || 'The assistant could not answer.';
      throw error;
    } finally { state.loading = false; }
  }
  function rerender() { if (A.S.tab === 'overview' && typeof A.render === 'function') A.render(); }
  async function generateInsights(force = false) {
    if (state.ready !== true || state.insightPreparing || (!force && state.insightStatus === 'loading')) return;
    state.insightPreparing = true;
    try { if (A.platformFunnels && A.platformFunnels.ensureSummary) await A.platformFunnels.ensureSummary(); } catch { /* Overview metrics can still be analyzed without the funnel */ }
    const snapshot = context(), key = JSON.stringify(snapshot);
    state.insightPreparing = false;
    if (!force && key === state.insightKey && ['loading', 'ready', 'error'].includes(state.insightStatus)) return;
    state.insightKey = key; state.insightStatus = 'loading'; state.insightText = ''; state.insightError = '';
    state.insightPeriod = `${snapshot.period.from} to ${snapshot.period.to}`;
    const sequence = ++state.insightSeq;
    rerender();
    try {
      const result = await A.api('api/assistant/ask', { method: 'POST', body: JSON.stringify({
        mode: 'insights', question: 'Generate the Overview executive insight report from the supplied data. Follow the required headings and prioritize evidence over metric listings.', context: snapshot,
      }) });
      if (sequence !== state.insightSeq) return;
      if (JSON.stringify(context()) !== key) {
        state.insightKey = ''; state.insightStatus = 'idle'; rerender(); return;
      }
      state.insightText = String(result.answer || '');
      state.insightStatus = state.insightText ? 'ready' : 'error';
      if (!state.insightText) state.insightError = 'The model returned no findings.';
    } catch (error) {
      if (sequence !== state.insightSeq) return;
      state.insightStatus = 'error'; state.insightError = error.message || 'Insights could not be generated.';
    } finally { if (sequence === state.insightSeq) rerender(); }
  }
  function mount(el) {
    el.addEventListener('submit', async (event) => {
      if (event.target.id !== 'growth-assistant-form') return;
      event.preventDefault();
      const question = String(new FormData(event.target).get('question') || '').trim();
      if (!question || state.loading || state.ready === false) return;
      const pending = ask(question);
      if (A.S.tab === 'overview') A.render();
      try { await pending; } catch { /* the safe message is kept in state */ }
      if (A.S.tab === 'overview') A.render();
    });
    el.addEventListener('click', (event) => {
      if (event.target.closest('[data-insights-retry]')) { state.insightStatus = 'idle'; state.insightKey = ''; void generateInsights(true); return; }
      const button = event.target.closest('[data-assistant-prompt]');
      if (!button) return;
      state.question = button.dataset.assistantPrompt || '';
      rerender();
      document.getElementById('growth-assistant-question')?.focus();
    });
    if (!state.statusRequested) {
      state.statusRequested = true;
      A.api('api/assistant/status').then((info) => {
        state.ready = !!info.ready; state.model = String(info.model || '');
        if (state.ready) void generateInsights();
      }).catch((error) => { state.statusError = error.message || 'unavailable'; })
        .finally(() => rerender());
    } else if (state.ready === true) void generateInsights();
  }
  A.assistant = { context, render, ask, generateInsights, mount, state, richText };
})(window.App);
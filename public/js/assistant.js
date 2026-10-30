'use strict';
(function (A) {
  const state = { ready: null, model: '', statusRequested: false, statusError: '', question: '', answer: '', answerPeriod: null, error: '', loading: false };
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
    return {
      period: { from: S.from, to: S.to, grouping: D.grainName() },
      internal_tests_excluded: !!S.exInt,
      funnel_name: funnel ? funnel.name : null,
      kpis: {
        ga4_sessions: finite(ga.sessions), ga4_users: finite(ga.users),
        ga4_engaged_sessions: finite(ga.engaged), ga4_engagement_rate: finite(ga.rate),
        hubspot_contacts: finite(D.crmTotal()),
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
      countries: [...countries.values()].sort((a, b) => ((b.sessions || 0) + (b.accounts_created || 0)) - ((a.sessions || 0) + (a.accounts_created || 0))).slice(0, 10),
      posthog_funnel: funnel ? (funnel.steps || []).slice(0, 10).map((step) => ({ step: step.name, persons: finite(step.n), median_seconds: finite(step.median_seconds) })) : [],
    };
  }
  function render() {
    const U = A.ui;
    const status = state.ready === true
      ? `Ready · ${U.esc(state.model || 'Anthropic')}`
      : state.ready === false
        ? 'Not configured · set ANTHROPIC_API_KEY in the Think4Ever service variables.'
        : state.statusError ? 'Assistant setup could not be checked.' : 'Checking assistant setup…';
    const answer = state.answer
      ? `<div class="growth-assistant-answer" aria-live="polite"><b>Answer · ${U.esc(state.answerPeriod || '')}</b><p>${U.esc(state.answer)}</p></div>`
      : state.error ? `<div class="growth-assistant-error" role="alert">${U.esc(state.error)}</div>`
        : state.loading ? '<div class="growth-assistant-answer" aria-live="polite">Analyzing the selected dashboard summary…</div>' : '';
    const disabled = state.loading || state.ready === false ? ' disabled' : '';
    const body = `<div class="growth-assistant-status" role="status">${U.esc(status)}</div>
      <form id="growth-assistant-form" class="growth-assistant-form">
        <label for="growth-assistant-question">Ask about this dashboard</label>
        <textarea id="growth-assistant-question" name="question" maxlength="800" rows="2" placeholder="What changed in acquisition this period?" required>${U.esc(state.question)}</textarea>
        <div class="growth-assistant-actions"><button class="btn btn-primary" type="submit"${disabled}>${state.loading ? 'Thinking…' : 'Ask assistant'}</button>
          <button class="btn btn-secondary" type="button" data-assistant-prompt="Summarize the main changes in the selected period.">Summarize this period</button>
          <button class="btn btn-secondary" type="button" data-assistant-prompt="Where is the largest drop between the displayed funnel steps? State the counts and caveats.">Review funnel</button></div>
      </form>
      ${answer}<p class="growth-assistant-note">Read-only dashboard summary. Only the question and aggregated metrics for this date range are sent to Anthropic; no raw events or person-level records are included. This app does not save the conversation. Usage is limited to 10 requests per minute. Do not include personal data or API keys in your question.</p>`;
    return U.card({ cls: 'chart-card growth-assistant-card', title: 'Growth assistant', sub: 'Ask about the selected period, channels, countries and visible funnel.', body });
  }
  async function ask(question) {
    const snapshot = context();
    state.question = String(question || '').trim(); state.loading = true; state.answer = ''; state.error = ''; state.answerPeriod = `${snapshot.period.from} to ${snapshot.period.to}`;
    try {
      const result = await A.api('api/assistant/ask', { method: 'POST', body: JSON.stringify({ question: state.question, context: snapshot }) });
      state.answer = String(result.answer || '');
      return result;
    } catch (error) {
      state.error = error.message || 'The assistant could not answer.';
      throw error;
    } finally { state.loading = false; }
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
      const button = event.target.closest('[data-assistant-prompt]');
      if (!button) return;
      state.question = button.dataset.assistantPrompt || '';
      if (A.S.tab === 'overview') A.render();
      document.getElementById('growth-assistant-question')?.focus();
    });
    if (!state.statusRequested) {
      state.statusRequested = true;
      A.api('api/assistant/status').then((info) => { state.ready = !!info.ready; state.model = String(info.model || ''); })
        .catch((error) => { state.statusError = error.message || 'unavailable'; })
        .finally(() => { if (A.S.tab === 'overview') A.render(); });
    }
  }
  A.assistant = { context, render, ask, mount, state };
})(window.App);
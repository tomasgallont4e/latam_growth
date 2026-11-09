'use strict';
(function (A) {
  function metricCard({ title, source, value, detail, destination }) {
    const display = value == null ? '<span class="kpi-awaiting">Pending</span>' : typeof value === 'string' ? A.ui.esc(value) : A.ui.fmt(value);
    return A.ui.card({ title, sub: source, body: `<div class="overview-metric-value">${display}</div><p class="card-note">${A.ui.esc(detail || '')}</p><button class="btn btn-secondary btn-sm" type="button" data-go="${A.ui.esc(destination)}">View details</button>` });
  }
  function render() {
    const U = A.ui, D = A.D, S = A.S;
    const from = S.from, to = S.to;
    const goal = Number(S.data && S.data.goalPlan && S.data.goalPlan.verified_users) || null;
    const coverage = D.snap('posthog', 'account_coverage');
    const through = coverage && coverage.to < U.today() ? coverage.to : U.today();
    const signupsSince = D.signups(A.LAUNCH, through);
    const signupsRange = D.signups(from, to);
    const signupCovered = D.covered('posthog', 'account_coverage', A.LAUNCH, through);
    const accountsRange = D.outcome('accounts_created', from, to);
    const projectsRange = D.outcome('projects_created', from, to);
    const ga = D.ga(from, to);
    const paid = D.paidTotals(from, to) || {};
    const platformRows = (D.PAID || []).map((key) => ({ key, ...D.paidStats(key, from, to) }));
    const spend = platformRows.some((row) => row.spend != null)
      ? platformRows.reduce((sum, row) => sum + (Number(row.spend) || 0), 0)
      : null;
    const adDetail = platformRows.map((row) => `${row.key}: ${row.spend == null ? 'pending' : U.money(row.spend)}`).join(' · ');
    const cards = [
      U.card({
        cls: 'acct-hero-card', title: 'LATAM 500K goal',
        sub: `Since launch · ${U.win(A.LAUNCH, through)} · sign-ups once per person · first $identify in PostHog · America/Bogota`,
        body: `<div class="overview-metric-value">${signupsSince == null || !signupCovered ? '<span class="kpi-awaiting">Pending</span>' : U.fmt(signupsSince)}${goal == null ? '' : ` <small>of ${U.fmt(goal)}</small>`}</div><p class="card-note">${signupsSince == null || !signupCovered ? 'Coverage unavailable. $identify sign-ups are separate from account_created outcomes.' : `${U.pct(goal ? signupsSince / goal : 0)} of sign-up proxy goal`}</p><button class="btn btn-secondary btn-sm" type="button" data-go="targets">View targets</button>`,
      }),
      U.card({ title: 'Ads', sub: 'Meta, Google Ads and LinkedIn Ads', body: `<div class="overview-metric-value">${spend == null ? '<span class="kpi-awaiting">Pending</span>' : U.money(spend)}</div><p class="card-note">${U.fmt(paid.impressions)} impressions · ${U.fmt(paid.clicks)} clicks · ${U.esc(adDetail)}</p><button class="btn btn-secondary btn-sm" type="button" data-go="social">View details</button>` }),
      metricCard({ title: 'Sign-ups', source: 'PostHog · first $identify per unique person', value: signupCovered ? signupsRange : null, detail: `Operational sign-up proxy. ${signupsRange == null ? 'Coverage unavailable; not zero.' : `${U.fmt(signupsRange)} first $identify people in this period.`} Not the same as account_created.`, destination: 'conversion' }),
      metricCard({ title: 'GA4 sessions', source: 'Google Analytics 4', value: ga && ga.sessions, detail: 'Source-native sessions. Not linked to product accounts.', destination: 'acquisition' }),
      metricCard({ title: 'HubSpot contacts', source: 'HubSpot', value: D.crmTotal(from, to), detail: 'CRM contacts are separate from product sign-ups and account_created.', destination: 'acquisition' }),
      metricCard({ title: 'Accounts created', source: 'PostHog · account_created', value: accountsRange, detail: 'Canonical account outcome for the selected period.', destination: 'conversion' }),
      metricCard({ title: 'Projects created', source: 'PostHog · project_created', value: projectsRange, detail: 'Confirmed project_created events. One account can create multiple projects.', destination: 'conversion' }),
    ];
    return U.section('Overview', `${from} to ${to} · source-native acquisition and confirmed product outcomes · America/Bogota`, `<div class="grid-2">${cards.join('')}</div>`)
      + U.section('What matters', 'Evidence-based reading of the selected period.', A.assistant.render());
  }
  function mount(el) { A.assistant.mount(el); }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

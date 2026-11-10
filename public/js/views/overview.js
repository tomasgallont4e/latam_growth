'use strict';
/* Overview: the three numbers Management asked for (impressions, people on the landing, sign-ups),
   each from its own source and unit, then links to the detail tabs. The three sources are not
   linked person by person, so no rate is computed between them. */
(function (A) {
  const PAID_NAMES = { meta: 'Meta Ads', google_ads: 'Google Ads', linkedin: 'LinkedIn Ads' };
  function keyCard({ title, source, unit, value, lines, destination }) {
    const U = A.ui;
    const display = value == null ? '<span class="kpi-awaiting">Pending</span>' : U.fmt(value);
    const notes = lines.filter(Boolean).map((line) => `<p class="card-note">${U.esc(line)}</p>`).join('');
    return U.card({ cls: 'overview-key-card', title, sub: `${source} · ${unit}`, body: `<div class="overview-metric-value">${display}</div>${notes}<button class="btn btn-secondary btn-sm" type="button" data-go="${U.esc(destination)}">View details</button>` });
  }
  function impressions(from, to) {
    const D = A.D;
    const parts = D.PAID.map((key) => ({ key, name: PAID_NAMES[key] || key, reported: D.has(key, 'ad_impressions'), value: D.sum(key, 'ad_impressions', null, from, to) }));
    const reported = parts.filter((p) => p.reported);
    const value = reported.length ? reported.reduce((s, p) => s + p.value, 0) : null;
    const byPlatform = parts.map((p) => (p.key === 'linkedin' && !p.reported ? 'LinkedIn Ads: not connected' : `${p.name}: ${p.reported ? A.ui.fmt(p.value) : 'not reported'}`)).join(' · ');
    const partial = reported.length && reported.length < parts.length ? 'Partial: only reporting platforms are added.' : null;
    return { value, lines: [byPlatform, partial, 'Ad platforms report impressions, not people; the same person can be counted many times.'] };
  }
  function landingPeople(from, to) {
    const s = ((A.S.data && A.S.data.snapshots) || []).find((x) => x.source === 'ga4' && x.key === 'landing_people' && x.from === from && x.to === to);
    const row = s && s.rows && s.rows[0];
    if (!row || row.available !== true) {
      return { value: null, lines: [row && row.reason ? row.reason : 'Unique people need an exact-window GA4 query; available windows: launch to date, last 7 and last 28 days.', 'Daily users are never added together.'] };
    }
    return { value: Number(row.users) || 0, lines: [`GA4 users on go.think4ever.com, deduplicated for ${A.ui.win(from, to)}.`, row.subject_to_thresholding ? 'GA4 applied thresholding; the value may be rounded.' : null, 'GA4 traffic can include internal visits.'] };
  }
  function render() {
    const U = A.ui, D = A.D, S = A.S;
    const from = S.from, to = S.to;
    const goal = Number(S.data && S.data.goalPlan && S.data.goalPlan.verified_users) || null;
    const signupCovered = D.covered('posthog', 'account_coverage', from, to);
    const signups = signupCovered ? D.signups(from, to) : null;
    const imp = impressions(from, to), people = landingPeople(from, to);
    const key = [
      keyCard({ title: 'Impressions', source: 'Ads · Meta, Google Ads, LinkedIn Ads', unit: 'impressions', value: imp.value, lines: imp.lines, destination: 'social' }),
      keyCard({ title: 'People on the landing', source: 'GA4 · go.think4ever.com', unit: 'unique users', value: people.value, lines: people.lines, destination: 'landing' }),
      keyCard({ title: 'Sign-ups', source: 'PostHog · first $identify per unique person', unit: 'people', value: signups, lines: [
        signupCovered ? (S.exInt ? 'Internal and test accounts excluded (think4ever, moadbus, t4e).' : 'Internal and test accounts included.') : 'Coverage unavailable; not zero.',
        'Operational sign-up proxy. Not the same as account_created.',
      ], destination: 'conversion' }),
    ];
    const coverage = D.snap('posthog', 'account_coverage');
    const through = coverage && coverage.to < U.today() ? coverage.to : U.today();
    const since = D.covered('posthog', 'account_coverage', A.LAUNCH, through) ? D.signups(A.LAUNCH, through) : null;
    const goalCard = U.card({
      cls: 'acct-hero-card', title: 'LATAM 500K goal',
      sub: `Since launch · ${U.win(A.LAUNCH, through)} · sign-ups once per person · first $identify in PostHog · America/Bogota`,
      body: `<div class="overview-metric-value">${since == null ? '<span class="kpi-awaiting">Pending</span>' : U.fmt(since)}${goal == null ? '' : ` <small>of ${U.fmt(goal)}</small>`}</div><p class="card-note">${since == null ? 'Coverage unavailable.' : `${U.pct(goal ? since / goal : 0)} of the sign-up goal`}</p><button class="btn btn-secondary btn-sm" type="button" data-go="targets">View targets</button>`,
    });
    const links = `<div class="form-row">${[['acquisition', 'Acquisition'], ['conversion', 'Conversion'], ['product', 'Product usage'], ['executive', 'Executive']].map(([go, label]) => `<button class="btn btn-ghost btn-sm" type="button" data-go="${go}">${U.esc(label)}</button>`).join('')}</div>`;
    return U.section('Overview', `${from} to ${to} · three key numbers, each from its own source · America/Bogota`, `<div class="grid-3">${key.join('')}</div><p class="card-note">These three sources are not linked person by person, so they are never divided into one another.</p>${links}`)
      + U.section('Goal', 'Cumulative since launch; independent of the date picker.', goalCard)
      + U.section('What matters', 'Evidence-based reading of the selected period.', A.assistant.render());
  }
  function mount(el) { A.assistant.mount(el); }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

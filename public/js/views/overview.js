'use strict';
/* Overview: the three numbers Management asked for (impressions, people on the landing, sign-ups),
   each from its own source and unit, then links to the detail tabs. The three sources are not
   linked person by person, so no rate is computed between them. The 500K goal card is MONTHLY and
   follows the global top-bar Month (memory #141). */
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
  // Monthly 500K goal for the global Month, plus one bar per month since launch.
  function goalCard() {
    const U = A.ui, D = A.D, S = A.S;
    const month = S.goalMonth;
    const g = D.goalAccounts(month);
    const loaded = g.status === 'loaded';
    const value = loaded ? `${U.fmt(g.value)}${g.goal ? ` <small>of ${U.fmt(g.goal)}</small>` : ''}` : '<span class="kpi-awaiting">Pending</span>';
    const pctLine = !loaded ? (g.reason || 'Coverage unavailable.') : g.goal ? `${U.pct(g.value / g.goal, 1)} of the ${U.monthName(month)} goal` : 'No monthly goal saved in Targets.';
    const latam = loaded ? `Of which LATAM: ${U.fmt(g.latam)} (${U.pct(g.latamShare || 0, 1)}) · the 11 plan countries` : null;
    const rows = A.months().map((m) => ({ ...m, g: D.goalAccounts(m.id) }));
    const bar = (r) => {
      if (r.g.status !== 'loaded' || !r.g.goal) return '<span class="text-muted">–</span>';
      const ratio = r.g.value / r.g.goal, width = Math.min(100, Math.max(0, ratio * 100));
      return `<div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(width)}" aria-label="${U.esc(r.label)} percent of goal"><i style="width:${width.toFixed(1)}%"></i></div><small>${U.pct(ratio, 1)}</small>`;
    };
    const history = U.table([
      { t: 'Month', f: (r) => (r.id === month ? `<b>${U.esc(r.label)}</b>` : U.esc(r.label)) },
      { t: 'Accounts created', num: 1, f: (r) => (r.g.status === 'loaded' ? U.fmt(r.g.value) : '<span class="text-muted">Pending</span>') },
      { t: '% of goal', f: bar },
    ], rows);
    const span = g.to ? U.win(g.from, g.to) : 'no covered day yet';
    return U.card({
      cls: 'acct-hero-card', title: `LATAM 500K goal · ${U.monthName(month)}`,
      sub: `Monthly · ${span} · External accounts created, sign-ups once per person (first $identify, all hosts, all countries) · internal accounts always excluded · America/Bogota`,
      body: `<div class="overview-metric-value">${value}</div><p class="card-note">${U.esc(pctLine)}</p>${latam ? `<p class="card-note">${U.esc(latam)}</p>` : ''}<h4 class="cf-sub">Accounts created by month</h4>${history}<button class="btn btn-secondary btn-sm" type="button" data-go="targets">View targets</button>`,
    });
  }
  function render() {
    const U = A.ui, D = A.D, S = A.S;
    const from = S.from, to = S.to;
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
    const links = `<div class="form-row">${[['acquisition', 'Acquisition'], ['conversion', 'Conversion'], ['product', 'Product usage'], ['executive', 'Executive']].map(([go, label]) => `<button class="btn btn-ghost btn-sm" type="button" data-go="${go}">${U.esc(label)}</button>`).join('')}</div>`;
    return U.section('Overview', `${from} to ${to} · three key numbers, each from its own source · America/Bogota`, `<div class="grid-3">${key.join('')}</div><p class="card-note">These three sources are not linked person by person, so they are never divided into one another.</p>${links}`)
      + U.section('Goal', 'Monthly goal for the Month selected at the top; independent of From/To.', goalCard())
      + U.section('What matters', 'Evidence-based reading of the selected period.', A.assistant.render());
  }
  function mount(el) { A.assistant.mount(el); }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

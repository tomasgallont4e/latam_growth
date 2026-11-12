'use strict';
/* Overview: the three key numbers (impressions, people on the landing, sign-ups), the MONTHLY 500K
   goal for the global top-bar Month (memory #141), the 7-step funnel with a country selector, and the
   last two complete periods compared. The funnel uses the same step definitions as the Executive
   campaign funnel (lib/campaignFunnel.js, docs/executive-campaign-funnel.md). Its steps come from
   different sources, so % between steps are indicative, not a tracked person-by-person journey. */
(function (A) {
  const PAID_NAMES = { meta: 'Meta Ads', google_ads: 'Google Ads', linkedin: 'LinkedIn Ads' };
  const NOT_SPLIT = 'Not split by country';
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

  // ---------- 7-step funnel (From/To window, optional country)
  function metricsList() {
    const D = A.D;
    return typeof D.M === 'function' ? D.M() : ((A.S.data && A.S.data.metrics) || []);
  }
  function countryOptions() {
    const plan = (A.S.data && A.S.data.goalPlan && A.S.data.goalPlan.countries) || {};
    const seen = new Set(Object.keys(plan));
    for (const r of metricsList()) {
      if (r.dim === 'country' && r.dim_value && (r.metric === 'ph_accounts_geo' || r.metric === 'ga_exec_geo_sessions')) seen.add(r.dim_value);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }
  function funnelSteps(from, to, country) {
    const D = A.D, all = !country || country === 'all';
    const inCountry = (r) => r.dim === 'country' && r.dim_value === country;
    const split = (name, src) => ({ name, src, n: null, note: NOT_SPLIT });
    const add = (parts) => parts.reduce((s, v) => s + (Number(v) || 0), 0);
    const steps = [];
    // 1. Impressions (Meta Ads + Google Ads; LinkedIn Ads is not used, memory #151)
    const impMetric = all ? 'ad_impressions' : 'ad_impressions_geo';
    const impNets = ['meta', 'google_ads'].filter((k) => D.has(k, impMetric));
    if (impNets.length) steps.push({ name: 'Impressions', src: 'Meta Ads · Google Ads', n: add(impNets.map((k) => D.sum(k, impMetric, all ? null : inCountry, from, to))) });
    else steps.push(all ? { name: 'Impressions', src: 'Meta Ads · Google Ads', n: null, note: 'No ad platform has reported' } : split('Impressions', 'Meta Ads · Google Ads'));
    // 2. Clicks to the landing (Meta outbound + Google Ads clicks); never split by country
    if (!all) steps.push(split('Clicks to the landing', 'Meta outbound · Google Ads clicks'));
    else {
      const parts = [];
      if (D.has('meta', 'ad_outbound_clicks')) parts.push(D.sum('meta', 'ad_outbound_clicks', null, from, to));
      if (D.has('google_ads', 'ad_clicks')) parts.push(D.sum('google_ads', 'ad_clicks', null, from, to));
      steps.push({ name: 'Clicks to the landing', src: 'Meta outbound · Google Ads clicks', n: parts.length ? add(parts) : null, note: 'No outbound clicks reported' });
    }
    // 3. Landing sessions (GA4, go.think4ever.com only)
    steps.push(D.has('ga4', 'ga_exec_geo_sessions')
      ? { name: 'Landing sessions', src: 'GA4 · go.think4ever.com', n: D.sum('ga4', 'ga_exec_geo_sessions', all ? null : inCountry, from, to) }
      : { name: 'Landing sessions', src: 'GA4 · go.think4ever.com', n: null, note: 'GA4 go-host sessions not synced' });
    // 4. Form submissions (HubSpot)
    if (!all) steps.push(split('Form submissions', 'HubSpot · CRM contacts'));
    else {
      const crm = D.crmTotal(from, to);
      steps.push({ name: 'Form submissions', src: 'HubSpot · CRM contacts', n: crm == null ? null : crm, note: 'HubSpot has not reported' });
    }
    // 5. Accounts created (memory #134: External first $identify, all hosts, internal excluded)
    const covered = D.covered('posthog', 'account_coverage', from, to);
    const accounts = !covered ? null : all
      ? D.sum('posthog', 'ph_accounts', (r) => r.dim === 'account_type' && r.dim_value !== 'Internal', from, to)
      : D.sum('posthog', 'ph_accounts_geo', inCountry, from, to);
    steps.push({ name: 'Accounts created', src: 'PostHog · first $identify · External', n: accounts, note: 'Account coverage unavailable; not zero' });
    // 6. Credits loaded (PostHog events whose name contains "credit")
    const creditNames = [...new Set(metricsList().filter((r) => r.source === 'posthog' && r.metric === 'ph_event' && /credit/i.test(String(r.dim_value || ''))).map((r) => r.dim_value))];
    if (!creditNames.length) steps.push({ name: 'Credits loaded', src: 'PostHog · credits event', n: null, note: 'No credits event is synced yet' });
    else if (!all) steps.push(split('Credits loaded', `PostHog · ${creditNames.join(', ')}`));
    else steps.push({ name: 'Credits loaded', src: `PostHog · ${creditNames.join(', ')}`, n: D.sum('posthog', 'ph_event', (r) => creditNames.includes(r.dim_value), from, to) });
    // 7. Projects created (PostHog project_created)
    if (!all) steps.push(split('Projects created', 'PostHog · project_created'));
    else steps.push({ name: 'Projects created', src: 'PostHog · project_created', n: D.has('posthog', 'ph_event') ? D.sum('posthog', 'ph_event', (r) => r.dim_value === 'project_created', from, to) : null, note: 'PostHog events not synced' });
    return steps;
  }
  function funnelCard(from, to) {
    const U = A.ui, C = A.charts, S = A.S;
    const options = countryOptions();
    const country = options.includes(S.overviewCountry) ? S.overviewCountry : 'all';
    const steps = funnelSteps(from, to, country);
    const weak = C.weakest(steps);
    const weakLine = weak > 0
      ? `Weakest step: ${steps[weak - 1].name} → ${steps[weak].name}, ${U.pct(steps[weak].n / steps[weak - 1].n, 1)} continue.`
      : 'The weakest step appears once two consecutive steps have data.';
    const picker = `<label class="field market-select"><span>Country</span><select id="goal-country" aria-label="Select country"><option value="all"${country === 'all' ? ' selected' : ''}>All countries</option>${options.map((name) => `<option value="${U.esc(name)}"${name === country ? ' selected' : ''}>${U.esc(name)}</option>`).join('')}</select></label>`;
    const note = `<p class="card-note">Each step comes from its own source and is not linked person by person, so the % between steps is indicative. Accounts created is the same number as the 500K goal (External, internal excluded). ${country === 'all' ? '' : `${NOT_SPLIT}: clicks, forms, credits and projects; impressions only when the ad platforms store a country split.`}</p>`;
    return U.card({
      cls: 'chart-card', title: 'Funnel · 7 steps',
      sub: `${U.win(from, to)} · ${country === 'all' ? 'All countries' : U.esc(country)} · % versus the previous step`,
      right: picker,
      body: C.funnel(steps, 'Funnel from impressions to projects created') + `<p class="card-note"><b>${U.esc(weakLine)}</b></p>${note}<button class="btn btn-secondary btn-sm" type="button" data-go="executive">Open the Executive funnel</button>`,
    });
  }

  // ---------- last two complete periods (in-progress bucket excluded)
  function periodComparison(comparison = A.D.completeBucketComparison()) {
    const U = A.ui, D = A.D;
    const title = `Last complete ${D.grainName()} period vs previous`;
    if (!comparison) return U.section(title, `No comparison yet: available history since launch must contain two fully completed ${D.grainName().toLowerCase()} buckets.`, U.card({ title: 'Comparison unavailable', body: U.empty('Not enough completed history', 'The in-progress bucket is excluded from comparisons.') }));
    const cur = comparison.current, prev = comparison.previous;
    const a = D.ga(cur.from, cur.to), b = D.ga(prev.from, prev.to);
    const fields = [
      { label: 'GA4 sessions', source: 'GA4', cur: a && a.sessions, prev: b && b.sessions, format: U.fmt, delta: U.delta },
      { label: 'Engagement rate', source: 'GA4', cur: a && a.rate, prev: b && b.rate, format: U.pct, delta: U.deltaPoints },
      { label: 'HubSpot sessions', source: 'HubSpot', cur: D.has('hubspot', 'sessions') ? D.sessions(cur.from, cur.to) : null, prev: D.has('hubspot', 'sessions') ? D.sessions(prev.from, prev.to) : null, format: U.fmt, delta: U.delta },
      { label: 'CRM contacts', source: 'HubSpot', cur: D.crmTotal(cur.from, cur.to), prev: D.crmTotal(prev.from, prev.to), format: U.fmt, delta: U.delta },
      { label: 'Accounts created (PostHog first $identify)', source: 'PostHog', cur: D.accounts(cur.from, cur.to), prev: D.accounts(prev.from, prev.to), format: U.fmt, delta: U.delta },
      { label: 'Registration starts', source: 'PostHog', cur: D.registrations(cur.from, cur.to), prev: D.registrations(prev.from, prev.to), format: U.fmt, delta: U.delta },
    ].filter((x) => x.cur != null || x.prev != null);
    const tiles = fields.map((x) => U.kpi({ label: x.label, source: x.source, value: x.format(x.cur), delta: x.delta(x.cur, x.prev), compare: `${prev.label}: ${x.format(x.prev)}` }));
    const body = tiles.length ? U.kpiRow(tiles, 3) : U.empty('No comparable metrics yet', 'The connected sources have no daily facts for these completed buckets.');
    return U.section(title, `${cur.label} vs ${prev.label} · last two complete ${D.grainName().toLowerCase()} buckets since launch; independent of the selected date range; in-progress bucket excluded`, body);
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
    return U.section('Overview', `${from} to ${to} · three key numbers, each from its own source · America/Bogota`, `<div class="grid-3">${key.join('')}</div><p class="card-note">These three key numbers are not linked person by person.</p>${links}`)
      + U.section('Goal', 'Monthly goal for the Month selected at the top; independent of From/To.', goalCard())
      + U.section('Funnel', `${from} to ${to} · seven steps from impression to project · pick a country to focus on one market`, funnelCard(from, to))
      + periodComparison()
      + U.section('What matters', 'Evidence-based reading of the selected period.', A.assistant.render());
  }
  function mount(el) {
    A.assistant.mount(el);
    const pick = el.querySelector('#goal-country');
    if (pick) pick.addEventListener('change', () => { A.S.overviewCountry = pick.value; A.render(); });
  }
  A.views.overview = { title: 'Overview', render, mount };
})(window.App);

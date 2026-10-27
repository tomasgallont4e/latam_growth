'use strict';
// Builds the data the executive view (sample/executive) reads, using ONLY real rows stored in gd_items
// (connectors, CSV loads, the daily routine). Nothing is invented: a metric without a real source is
// returned with a noData label naming the source to connect. Targets start blank (see api/targets).

const UNSPLIT = 'Not split by country';
const CHANNELS = { meta: 'Meta', linkedin: 'LinkedIn', google_ads: 'Google Ads' };
const PAID_SOURCES = new Set(['paid social', 'paid search']);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const targets = require('./targets');

const MSG = {
  hubspot: 'No data yet: connect HubSpot',
  posthog: 'No data yet: connect PostHog',
  ga4: 'No data yet: connect Google Analytics 4 (daily sync)',
  ads: 'No data yet: connect Meta, LinkedIn Ads or Google Ads',
  linkedin: 'No data yet: connect LinkedIn (page analytics)',
  attribution: 'No data yet: connect paid sign-up attribution',
  product: 'No data yet: connect PostHog (product events)',
  billing: 'No data yet: connect platform billing',
  retention: 'No data yet: connect PostHog (retention)',
};
// Which source feeds each base series.
const BASE = {
  landing_sessions: 'hubspot', paid_sessions: 'hubspot', form_signups: 'hubspot',
  platform_signups: 'posthog', dau: 'posthog',
  visitors: 'ga4', ga_sessions: 'ga4', engaged: 'ga4', form_starts: 'ga4', form_submits: 'ga4',
  ad_spend: 'ads', impressions: 'ads', clicks: 'ads',
  li_impressions: 'linkedin', li_engagements: 'linkedin', li_followers: 'linkedin',
  paid_signups: 'attribution',
  activated: 'product', first_builds: 'product', open_accounts: 'product', active_7d: 'product',
  with_project: 'product', project_count: 'product', credits: 'product', canceled: 'product',
  paid_subs: 'billing', paying: 'billing', churned: 'billing',
  retention: 'retention',
};
const SERIES = Object.keys(BASE).filter((k) => !k.startsWith('li_') && k !== 'retention');

const AD = 'Meta, LinkedIn, Google Ads';
const METRICS = [
  { id: 'ad_spend', need: ['ad_spend'], section: 'Marketing campaigns', name: 'Ad spend', unit: 'currency', direction: 'budget', split: 'Campaign geo', source: AD, definition: 'Sum of Meta, LinkedIn, and Google Ads spend in the period. Close to 100% of the monthly budget is the goal.' },
  { id: 'impressions', need: ['impressions'], section: 'Marketing campaigns', name: 'Impressions', unit: 'count', direction: 'higher', split: 'Campaign geo', source: AD, definition: 'Paid impressions across Meta, LinkedIn, and Google Ads.' },
  { id: 'clicks', need: ['clicks'], section: 'Marketing campaigns', name: 'Clicks', unit: 'count', direction: 'higher', split: 'Campaign geo', source: AD, definition: 'Paid clicks across Meta, LinkedIn, and Google Ads.' },
  { id: 'ctr', need: ['clicks', 'impressions'], section: 'Marketing campaigns', name: 'Click-through rate', unit: 'rate', direction: 'higher', split: 'Campaign geo', source: AD, definition: 'Paid clicks divided by paid impressions.' },
  { id: 'cpc', need: ['ad_spend', 'clicks'], section: 'Marketing campaigns', name: 'Cost per click', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: AD, definition: 'Ad spend divided by paid clicks. Lower is better.' },
  { id: 'paid_sessions', need: ['paid_sessions'], section: 'Marketing campaigns', name: 'Paid landing sessions', unit: 'count', direction: 'higher', split: 'Campaign geo', source: 'HubSpot', definition: 'HubSpot landing sessions whose source is Paid social or Paid search.' },
  { id: 'paid_signups', need: ['paid_signups'], section: 'Marketing campaigns', name: 'Paid sign-ups', unit: 'count', direction: 'higher', split: 'Campaign geo', source: 'PostHog', definition: 'External platform sign-ups attributed to a paid campaign. Internal accounts are excluded.' },
  { id: 'cost_per_signup', need: ['ad_spend', 'paid_signups'], section: 'Marketing campaigns', name: 'Cost per sign-up', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: `${AD}, PostHog`, definition: 'Ad spend divided by paid sign-ups. Lower is better.' },
  { id: 'li_impressions', need: ['li_impressions'], section: 'Marketing campaigns', name: 'LinkedIn post impressions', unit: 'count', direction: 'higher', split: 'No', source: 'LinkedIn', definition: 'Organic post impressions on the Think4Ever Global page. Stays app-wide when a country is selected.' },
  { id: 'li_engagement', need: ['li_engagements', 'li_impressions'], section: 'Marketing campaigns', name: 'LinkedIn engagement rate', unit: 'rate', direction: 'higher', split: 'No', source: 'LinkedIn', definition: 'Post clicks, reactions, comments and reposts divided by post impressions. Stays app-wide when a country is selected.' },
  { id: 'li_followers', need: ['li_followers'], section: 'Marketing campaigns', name: 'New LinkedIn followers', unit: 'count', direction: 'higher', split: 'No', source: 'LinkedIn', definition: 'New followers of the Think4Ever Global page in the period. Stays app-wide when a country is selected.' },
  { id: 'campaigns', need: ['ad_spend'], section: 'Marketing campaigns', name: 'Campaigns with spend', unit: 'count', direction: 'higher', split: 'Campaign geo', source: AD, definition: 'Count of campaigns that spent money.' },
  { id: 'landing_sessions', need: ['landing_sessions'], section: 'Growth', name: 'Landing sessions', unit: 'count', direction: 'higher', split: 'Yes', source: 'HubSpot', definition: 'Visits to the HubSpot-tracked landing pages, all sources.' },
  { id: 'visitors', need: ['visitors'], section: 'Growth', name: 'Visitors', unit: 'count', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'Users on the landing in Google Analytics.' },
  { id: 'engaged', need: ['engaged'], section: 'Growth', name: 'Engaged sessions', unit: 'count', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'Sessions that lasted more than 10 seconds, viewed 2 or more pages, or fired a key event.' },
  { id: 'engagement_rate', need: ['engaged', 'ga_sessions'], section: 'Growth', name: 'Engagement rate', unit: 'rate', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'Engaged sessions divided by sessions.' },
  { id: 'form_starts', need: ['form_starts'], section: 'Growth', name: 'Sign-up form starts', unit: 'count', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'The form_start event on the landing sign-up form.' },
  { id: 'form_submits', need: ['form_submits'], section: 'Growth', name: 'Form completed', unit: 'count', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'The sign_up event sent when the landing sign-up form is completed.' },
  { id: 'form_completion', need: ['form_submits', 'form_starts'], section: 'Growth', name: 'Form completion', unit: 'rate', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'Form completed divided by form started.' },
  { id: 'form_signups', need: ['form_signups'], section: 'Growth', name: 'External form sign-ups', unit: 'count', direction: 'higher', split: 'Yes', source: 'HubSpot', definition: 'HubSpot contacts from the landing form. Internal (think4ever.com) contacts are removed. Split by the contact country.' },
  { id: 'platform_signups', need: ['platform_signups'], section: 'Growth', name: 'New accounts', unit: 'count', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'New external people in PostHog. Days split by type count only External.' },
  { id: 'visit_to_signup', need: ['platform_signups', 'landing_sessions'], section: 'Growth', name: 'Visit-to-sign-up rate', unit: 'rate', direction: 'higher', split: 'Yes', source: 'HubSpot, PostHog', definition: 'New external accounts divided by landing sessions.' },
  { id: 'open_accounts', need: ['open_accounts'], section: 'Core product', name: 'Customers', unit: 'count', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'External accounts still open at the end of the period.' },
  { id: 'active_7d', need: ['active_7d'], section: 'Core product', name: 'Active customers', unit: 'count', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'Open accounts that used the app in the 7 days ending on the last day of the period.' },
  { id: 'activity_rate', need: ['active_7d', 'open_accounts'], section: 'Core product', name: 'Activity', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Active customers divided by open accounts.' },
  { id: 'with_project', need: ['with_project'], section: 'Core product', name: 'Accounts with a project', unit: 'count', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'Open accounts that have at least one project.' },
  { id: 'project_rate', need: ['with_project', 'open_accounts'], section: 'Core product', name: 'Share with a project', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Accounts with at least one project divided by open accounts.' },
  { id: 'avg_projects', need: ['project_count', 'open_accounts'], section: 'Core product', name: 'Avg projects per account', unit: 'decimal', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'Projects divided by open accounts, at the end of the period.' },
  { id: 'avg_credits', need: ['credits', 'active_7d'], section: 'Core product', name: 'Avg credits per active customer', unit: 'decimal', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'Credits spent in the last 7 days divided by active customers.' },
  { id: 'cancellation_rate', need: ['canceled', 'open_accounts'], section: 'Core product', name: 'Cancellation rate', unit: 'rate', direction: 'lower', split: 'Yes', source: 'PostHog', definition: 'Accounts canceled in the period divided by open accounts at the start. Lower is better.' },
  { id: 'churn_rate', need: ['churned', 'paying'], section: 'Core product', name: 'Churn rate', unit: 'rate', direction: 'lower', split: 'Yes', source: 'Platform billing (to confirm)', definition: 'Customers who paid last month and are no longer paying, divided by everyone paying at the end of last month.' },
  { id: 'new_accounts', need: ['platform_signups'], section: 'Core product', name: 'New external accounts', unit: 'count', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Same count as new accounts on Growth.' },
  { id: 'activated', need: ['activated'], section: 'Core product', name: 'Activation proxy', unit: 'count', direction: 'higher', split: 'No', source: 'PostHog', definition: 'External people whose first matching “Proyecto creado (clic)” Action falls in the period. This is a temporary proxy: a click does not confirm that a project was created.' },
  { id: 'activation_rate', need: ['activated', 'platform_signups'], section: 'Core product', name: 'Activation rate', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Activated accounts divided by new external accounts.' },
  { id: 'first_builds', need: ['first_builds'], section: 'Core product', name: 'First builds', unit: 'count', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Activated accounts that completed a first build.' },
  { id: 'build_rate', need: ['first_builds', 'activated'], section: 'Core product', name: 'Build rate', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'First builds divided by activated accounts.' },
  { id: 'mau', need: ['dau'], section: 'Core product', name: 'Active users (peak day)', unit: 'count', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Highest daily count of active people in PostHog during the period. Distinct monthly users are not synced yet.' },
  { id: 'retention', need: ['retention'], section: 'Core product', name: 'New-account retention', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Share of last month’s new external accounts who were active this month.' },
  { id: 'paid_subs', need: ['paid_subs'], section: 'Core product', name: 'New paid subscriptions', unit: 'count', direction: 'higher', split: 'Yes', source: 'Platform billing (to confirm)', definition: 'External accounts that start a paid subscription.' },
  { id: 'signup_to_paid', need: ['paid_subs', 'platform_signups'], section: 'Core product', name: 'Sign-up to paid conversion', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog, platform billing (to confirm)', definition: 'Of the new external accounts in the period, how many start a paid subscription.' },
  { id: 'acq_spend', need: ['ad_spend'], section: 'Unit economics', name: 'Total acquisition spend', unit: 'currency', direction: 'budget', split: 'Campaign geo', source: AD, definition: 'Same dollars as ad spend, so this section can be read on its own.' },
  { id: 'cac', need: ['ad_spend', 'platform_signups'], section: 'Unit economics', name: 'CAC', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: `${AD}, PostHog`, definition: 'Ad spend divided by new sign-ups. Lower is better.' },
  { id: 'cost_per_paid', need: ['ad_spend', 'paid_subs'], section: 'Unit economics', name: 'Cost per paying customer', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: `${AD}, platform billing (to confirm)`, definition: 'Ad spend divided by new paid subscriptions. Lower is better.' },
  { id: 'cost_per_activated', need: ['ad_spend', 'activated'], section: 'Unit economics', name: 'Cost per activated account', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: `${AD}, PostHog`, definition: 'Ad spend divided by activated accounts. Lower is better.' },
];

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
// When a day has split rows (by source, channel, campaign), use those; otherwise use the day total.
function pickByDate(rows) {
  const split = new Set(rows.filter((r) => r.dim).map((r) => r.date));
  return rows.filter((r) => (r.dim ? true : !split.has(r.date)));
}

async function build(store) {
  const goalPlan = await targets.getPlan(store);
  const countryGoals = goalPlan.countries || {};
  const metricRows = (await store.list('metric')).filter((r) => isDate(r.date));
  const eventRows = (await store.list('event')).filter((r) => isDate(r.date));
  const snapshots = await store.list('snapshot');
  const latestSnapshot = (source, key) => snapshots
    .filter((s) => s.source === source && s.key === key)
    .sort((a, b) => String(b.pulled_at || b._at || '').localeCompare(String(a.pulled_at || a._at || '')))[0];

  const dates = [...metricRows, ...eventRows].map((r) => r.date).sort();
  const asOf = dates.length ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10);
  const first = dates.length ? dates[0] : asOf;
  const days = [];
  for (let d = first; d <= asOf; d = addDays(d, 1)) days.push(d);
  const pos = new Map(days.map((d, i) => [d, i]));

  const signupEvents = eventRows.filter((e) => e.kind === 'form_signup');
  const eventCountries = [...new Set(signupEvents.map((e) => e.country).filter(Boolean))].sort();
  const gaCountries = [...new Set(metricRows
    .filter((r) => String(r.metric || '').startsWith('ga_geo_') && r.dim === 'country')
    .map((r) => r.dim_value).filter(Boolean))].sort();
  const countryNames = [...new Set([UNSPLIT, ...Object.keys(countryGoals), ...eventCountries, ...gaCountries])];

  const zeros = () => Array(days.length).fill(0);
  const perCountry = () => Object.fromEntries(countryNames.map((c) => [c, zeros()]));
  const series = Object.fromEntries(SERIES.map((k) => [k, perCountry()]));
  const globalSeries = { li_impressions: zeros(), li_engagements: zeros(), li_followers: zeros() };
  const platformSeries = {};
  for (const name of Object.values(CHANNELS)) {
    platformSeries[name] = { clicks: perCountry(), impressions: perCountry(), ad_spend: perCountry(), paid_sessions: perCountry(), paid_signups: perCountry() };
  }

  const has = new Set();
  const add = (key, date, value, country = UNSPLIT) => {
    has.add(key);
    const i = pos.get(date);
    const v = Number(value);
    if (i == null || !Number.isFinite(v)) return;
    series[key][country][i] += v;
  };
  const addG = (key, date, value) => {
    has.add(key);
    const i = pos.get(date);
    const v = Number(value);
    if (i == null || !Number.isFinite(v)) return;
    globalSeries[key][i] += v;
  };

  const byMetric = new Map();
  for (const r of metricRows) {
    if (!byMetric.has(r.metric)) byMetric.set(r.metric, []);
    byMetric.get(r.metric).push(r);
  }
  const rowsOf = (name, sources) => {
    const rows = (byMetric.get(name) || []).filter((r) => !sources || sources.includes(r.source));
    const out = [];
    for (const src of new Set(rows.map((r) => r.source))) out.push(...pickByDate(rows.filter((r) => r.source === src)));
    return out;
  };

  // HubSpot: landing sessions (all sources) and paid sessions (Paid social, Paid search).
  for (const r of rowsOf('sessions', ['hubspot'])) {
    add('landing_sessions', r.date, r.value);
    has.add('paid_sessions');
    if (r.dim === 'source' && PAID_SOURCES.has(String(r.dim_value || '').toLowerCase())) add('paid_sessions', r.date, r.value);
  }
  // HubSpot: external form sign-ups by contact country.
  for (const e of signupEvents) {
    has.add('form_signups');
    if (e.internal === true || e.internal === 'true') continue;
    add('form_signups', e.date, 1, e.country && countryNames.includes(e.country) ? e.country : UNSPLIT);
  }
  // PostHog: new external accounts. Days split by type count only External; untyped days use the day total.
  const np = byMetric.get('ph_new_persons') || [];
  const typedDays = new Set(np.filter((r) => r.dim).map((r) => r.date));
  for (const r of np) {
    if (r.dim) {
      has.add('platform_signups');
      if (String(r.dim_value || '').toLowerCase() === 'external') add('platform_signups', r.date, r.value);
    } else if (!typedDays.has(r.date)) add('platform_signups', r.date, r.value);
  }
  for (const r of rowsOf('ph_active_users', ['posthog'])) add('dau', r.date, r.value);
  // A conservative, explicitly-labelled PostHog proxy until Product emits a
  // backend project_created event. The connector counts each external person
  // only on their first matching activation Action.
  for (const r of rowsOf('ph_activated_users', ['posthog'])) add('activated', r.date, r.value);
  // GA4: when the connector returned country/day rows, use them instead of
  // duplicating global totals under "Not split by country".
  for (const [m, key, geoMetric] of [['ga_users', 'visitors', 'ga_geo_users'], ['ga_sessions', 'ga_sessions', 'ga_geo_sessions'], ['ga_engaged_sessions', 'engaged', 'ga_geo_engaged_sessions']]) {
    const geoRows = rowsOf(geoMetric, ['ga4']);
    if (geoRows.length) {
      for (const r of geoRows) add(key, r.date, r.value, r.dim_value || UNSPLIT);
    } else {
      for (const r of rowsOf(m, ['ga4'])) add(key, r.date, r.value);
    }
  }
  for (const r of rowsOf('ga_event', ['ga4'])) {
    has.add('form_starts'); has.add('form_submits');
    if (r.dim_value === 'form_start') add('form_starts', r.date, r.value);
    else if (r.dim_value === 'sign_up') add('form_submits', r.date, r.value);
  }
  // Ad platforms: spend, impressions, clicks per channel; campaigns with spend.
  const campaigns = new Set();
  for (const [m, key] of [['ad_spend', 'ad_spend'], ['ad_impressions', 'impressions'], ['ad_clicks', 'clicks']]) {
    for (const r of rowsOf(m)) {
      add(key, r.date, r.value);
      const ch = CHANNELS[r.source];
      const i = pos.get(r.date);
      if (ch && i != null) platformSeries[ch][key][UNSPLIT][i] += Number(r.value) || 0;
      if (key === 'ad_spend' && Number(r.value) > 0) campaigns.add(`${r.source}|${r.dim_value || 'all'}`);
    }
  }
  // LinkedIn page: post impressions, engagements and new followers.
  for (const r of rowsOf('post_impressions', ['linkedin'])) addG('li_impressions', r.date, r.value);
  for (const m of ['post_clicks', 'post_reactions', 'post_comments', 'post_reposts']) {
    for (const r of rowsOf(m, ['linkedin'])) addG('li_engagements', r.date, r.value);
  }
  for (const r of rowsOf('new_followers', ['linkedin'])) addG('li_followers', r.date, r.value);

  const metrics = METRICS.map(({ need, ...m }) => {
    const missing = need.find((k) => !has.has(k));
    return missing ? { ...m, noData: MSG[BASE[missing]] } : m;
  });

  const months = [];
  const lastPlan = [0, 1, 2, 3].reduce((ym) => nextMonth(ym), asOf.slice(0, 7));
  for (let ym = first.slice(0, 7); ym !== nextMonth(lastPlan); ym = nextMonth(ym)) {
    const [y, mo] = ym.split('-').map(Number);
    months.push({ id: ym, label: `${MON[mo - 1]} ${y}`, hasActuals: days.some((d) => d.startsWith(ym)) });
  }

  return {
    live: true,
    generated_at: new Date().toISOString(),
    asOf,
    days,
    months,
    countries: countryNames.map((name) => ({
      name,
      goal: countryGoals[name] || null,
      seenIn: name === UNSPLIT
        ? 'Totals not yet attributable to a country, including current PostHog account counts'
        : [gaCountries.includes(name) && 'GA4 traffic', eventCountries.includes(name) && 'HubSpot form sign-ups'].filter(Boolean).join(', ') || 'Planned market',
      include: 'Yes',
    })),
    goalPlan,
    campaignCounts: { [UNSPLIT]: campaigns.size },
    metrics,
    targets: {},
    monthTarget: {},
    opening: {},
    series,
    globalSeries,
    platformSeries,
    // Kept separate from headline series because attribution is a multi-key
    // drill-down (UTM + landing + city), not a country aggregate.
    attribution: {
      ga4: (latestSnapshot('ga4', 'utm_attribution') || {}).rows || [],
      hubspot: signupEvents.filter((e) => !(e.internal === true || e.internal === 'true')).map((e) => ({
        date: e.date, source: e.utm_source || e.latest_source || e.original_source || '(not set)',
        medium: e.utm_medium || '(not set)', campaign: e.utm_campaign || '(not set)',
        content: e.utm_content || '(not set)', landing_page: e.landing_page || '(not set)',
      })),
      projects: (latestSnapshot('posthog', 'project_attribution') || {}).rows || [],
    },
  };
}

module.exports = { build, UNSPLIT };

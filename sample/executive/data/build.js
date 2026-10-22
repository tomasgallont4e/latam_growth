'use strict';
/* Builds invented preview figures. Not live data. Writes JSON the executive page reads. */
const fs = require('fs');
const path = require('path');

const MONTHS = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
const MONTH_LABEL = {
  '2026-10': 'Oct 2026', '2026-11': 'Nov 2026', '2026-12': 'Dec 2026',
  '2027-01': 'Jan 2027', '2027-02': 'Feb 2027', '2027-03': 'Mar 2027',
};

const COUNTRIES = [
  { name: 'Colombia', seenIn: 'HubSpot, GA4, PostHog', user: 22, campaign: 45, signup: 1.45, activate: 1.25, pay: 1.35, engage: 1.15 },
  { name: 'United States', seenIn: 'HubSpot, GA4, PostHog', user: 14, campaign: 15, signup: 0.85, activate: 0.95, pay: 1.1, engage: 0.95 },
  { name: 'Canada', seenIn: 'HubSpot, GA4, PostHog', user: 7, campaign: 8, signup: 1.1, activate: 1.05, pay: 1.05, engage: 1.05 },
  { name: 'India', seenIn: 'HubSpot, PostHog', user: 10, campaign: 0, signup: 0.5, activate: 0.7, pay: 0.45, engage: 0.75 },
  { name: 'Bangladesh', seenIn: 'HubSpot, GA4, PostHog', user: 5, campaign: 0, signup: 0.55, activate: 0.65, pay: 0.4, engage: 0.7 },
  { name: 'Curaçao', seenIn: 'PostHog', user: 2, campaign: 0, signup: 0.6, activate: 0.8, pay: 0.5, engage: 0.85 },
  { name: 'Philippines', seenIn: 'PostHog', user: 6, campaign: 5, signup: 0.8, activate: 0.85, pay: 0.7, engage: 0.9 },
  { name: 'Malaysia', seenIn: 'PostHog', user: 4, campaign: 0, signup: 0.75, activate: 0.9, pay: 0.6, engage: 0.9 },
  { name: 'Bulgaria', seenIn: 'PostHog', user: 3, campaign: 0, signup: 0.65, activate: 0.75, pay: 0.5, engage: 0.8 },
  { name: 'Singapore', seenIn: 'PostHog', user: 3, campaign: 0, signup: 1.2, activate: 1.15, pay: 1.4, engage: 1.1 },
  { name: 'Trinidad and Tobago', seenIn: 'PostHog', user: 2, campaign: 0, signup: 0.9, activate: 0.85, pay: 0.7, engage: 0.9 },
  { name: 'Serbia', seenIn: 'PostHog', user: 3, campaign: 0, signup: 0.6, activate: 0.7, pay: 0.45, engage: 0.8 },
  { name: 'Brazil', seenIn: 'PostHog', user: 11, campaign: 22, signup: 1.2, activate: 1.1, pay: 1.15, engage: 1.05 },
  { name: 'The Netherlands', seenIn: 'PostHog', user: 4, campaign: 3, signup: 1.15, activate: 1.1, pay: 1.2, engage: 1.1 },
  { name: 'Australia', seenIn: 'PostHog', user: 4, campaign: 2, signup: 1.0, activate: 1.0, pay: 1.05, engage: 1.0 },
];

const OCT = {
  ad_spend: 8400,
  impressions: 420000,
  clicks: 7800,
  paid_sessions: 5100,
  paid_signups: 86,
  campaigns: 5,
  landing_sessions: 12400,
  visitors: 8600,
  ga_sessions: 9100,
  engaged: 4700,
  form_starts: 980,
  form_submits: 310,
  form_signups: 142,
  platform_signups: 148,
  activated: 70,
  first_builds: 36,
  mau: 410,
  paid_subs: 27,
  li_impressions: 54000,
  li_engagements: 1890,
  li_followers: 310,
};

const OCT_TARGET = {
  ad_spend: 8000,
  impressions: 400000,
  clicks: 8000,
  paid_sessions: 5000,
  paid_signups: 80,
  campaigns: 6,
  landing_sessions: 13000,
  visitors: 9000,
  ga_sessions: 9500,
  engaged: 5000,
  form_starts: 1100,
  form_submits: 360,
  form_signups: 160,
  platform_signups: 160,
  activated: 72,
  first_builds: 36,
  mau: 450,
  paid_subs: 24,
  li_impressions: 60000,
  li_engagements: 2400,
  li_followers: 400,
  open_accounts: 1150,
  active_7d: 210,
  with_project: 660,
};

const CAMPAIGNS = { Colombia: 2, Brazil: 1, 'United States': 1, Canada: 1 };
const PLATFORMS = [
  { name: 'Meta', reach: 52, click: 1.05, price: 0.72, convert: 0.85 },
  { name: 'LinkedIn', reach: 28, click: 0.62, price: 1.85, convert: 1.7 },
  { name: 'Google Ads', reach: 20, click: 1.55, price: 0.95, convert: 1.2 },
];

function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map((x) => Math.floor(x));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < left; k++) out[order[k][1]]++;
  return out;
}

function allocateCapped(total, caps, weights) {
  const out = allocate(total, weights);
  for (let guard = 0; guard < 30; guard++) {
    let overflow = 0;
    const room = [];
    for (let i = 0; i < out.length; i++) {
      if (out[i] > caps[i]) { overflow += out[i] - caps[i]; out[i] = caps[i]; }
      else if (out[i] < caps[i]) room.push(i);
    }
    if (!overflow) return out;
    if (!room.length) return out;
    const extra = allocate(overflow, room.map((i) => weights[i]));
    room.forEach((i, k) => { out[i] += extra[k]; });
  }
  return out;
}

function weights(key, extra) {
  return COUNTRIES.map((c) => {
    const base = key === 'campaign' ? c.campaign : c.user;
    return base * (extra ? c[extra] : 1);
  });
}

const ASOF = '2026-10-21';
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dates(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const DAYS = dates(addDays(ASOF, -89), ASOF);

function randFactory(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = randFactory(20261021);

function dayFactor(iso) {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay();
  const weekend = dow === 0 || dow === 6 ? 0.62 : 1;
  const t = (Date.parse(iso) - Date.parse(DAYS[0])) / (Date.parse(ASOF) - Date.parse(DAYS[0]));
  return weekend * (0.38 + 0.62 * t);
}
function noisy(base, iso) {
  return Math.max(0, Math.round(base * dayFactor(iso) * (0.78 + rand() * 0.44)));
}

const BASE = {
  platform_signups: 6,
  landing_sessions: 520,
  visitors: 360,
  ga_sessions: 380,
  engaged: 200,
  form_starts: 42,
  form_submits: 15,
  form_signups: 7,
  activated: 3,
  first_builds: 1.6,
  paid_subs: 1.3,
  paid_sessions: 210,
  paid_signups: 3.6,
  ad_spend: 340,
  impressions: 17000,
  clicks: 320,
  dau: 52,
  li_impressions: 2200,
  li_engagements: 80,
  li_followers: 15,
};

const carry = {};
function split(key, total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  if (!carry[key]) carry[key] = weights.map(() => 0);
  const exact = weights.map((w, i) => (total * w) / sum + carry[key][i]);
  const out = exact.map((x) => Math.max(0, Math.floor(x)));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  let k = 0;
  while (left > 0 && k < order.length * 4) { out[order[k % order.length][1]]++; left--; k++; }
  while (left < 0) {
    const i = out.findIndex((v) => v > 0);
    if (i < 0) break;
    out[i]--;
    left++;
  }
  carry[key] = exact.map((x, i) => x - out[i]);
  return out;
}
function clamp(values, caps) {
  return values.map((v, i) => Math.min(v, caps[i]));
}

const series = {};
for (const key of ['ad_spend', 'impressions', 'clicks', 'paid_sessions', 'paid_signups', 'landing_sessions', 'visitors', 'ga_sessions', 'engaged', 'form_starts', 'form_submits', 'form_signups', 'platform_signups', 'activated', 'first_builds', 'paid_subs', 'dau']) {
  series[key] = Object.fromEntries(COUNTRIES.map((c) => [c.name, []]));
}
const globalSeries = { li_impressions: [], li_engagements: [], li_followers: [] };
const platformSeries = {};
for (const p of PLATFORMS) {
  platformSeries[p.name] = {
    clicks: Object.fromEntries(COUNTRIES.map((c) => [c.name, []])),
    impressions: Object.fromEntries(COUNTRIES.map((c) => [c.name, []])),
    ad_spend: Object.fromEntries(COUNTRIES.map((c) => [c.name, []])),
    paid_sessions: Object.fromEntries(COUNTRIES.map((c) => [c.name, []])),
    paid_signups: Object.fromEntries(COUNTRIES.map((c) => [c.name, []])),
  };
}

for (const iso of DAYS) {
  const signups = noisy(BASE.platform_signups, iso);
  const activated = Math.min(signups, noisy(BASE.activated, iso));
  const builds = Math.min(activated, noisy(BASE.first_builds, iso));
  const paid = Math.min(signups, noisy(BASE.paid_subs, iso));
  const formStarts = noisy(BASE.form_starts, iso);
  const formSubmits = Math.min(formStarts, noisy(BASE.form_submits, iso));
  const formSignups = Math.min(formSubmits, noisy(BASE.form_signups, iso));
  const sessions = noisy(BASE.landing_sessions, iso);
  const visitors = Math.min(sessions, noisy(BASE.visitors, iso));
  const ga = noisy(BASE.ga_sessions, iso);
  const engaged = Math.min(ga, noisy(BASE.engaged, iso));
  const impressions = noisy(BASE.impressions, iso);
  const clicks = Math.min(impressions, noisy(BASE.clicks, iso));
  const spend = noisy(BASE.ad_spend, iso);
  const paidSessions = noisy(BASE.paid_sessions, iso);
  const paidSignups = Math.min(signups, noisy(BASE.paid_signups, iso));
  const dau = Math.max(signups, noisy(BASE.dau, iso));
  const totals = {
    platform_signups: signups, activated, first_builds: builds, paid_subs: paid,
    form_starts: formStarts, form_submits: formSubmits, form_signups: formSignups,
    landing_sessions: sessions, visitors, ga_sessions: ga, engaged,
    impressions, clicks, ad_spend: spend, paid_sessions: paidSessions, paid_signups: paidSignups, dau,
  };
  const signupsBy = split('platform_signups', totals.platform_signups, weights('user', 'signup'));
  const putUser = (metric, values) => COUNTRIES.forEach((c, i) => series[metric][c.name].push(values[i]));
  putUser('platform_signups', signupsBy);
  const activatedBy = clamp(split('activated', totals.activated, weights('user', 'activate')), signupsBy);
  putUser('activated', activatedBy);
  putUser('first_builds', clamp(split('first_builds', totals.first_builds, weights('user', 'activate')), activatedBy));
  putUser('paid_subs', clamp(split('paid_subs', totals.paid_subs, weights('user', 'pay')), signupsBy));
  const formStartBy = split('form_starts', totals.form_starts, weights('user'));
  putUser('form_starts', formStartBy);
  const formSubmitBy = clamp(split('form_submits', totals.form_submits, weights('user', 'signup')), formStartBy);
  putUser('form_submits', formSubmitBy);
  putUser('form_signups', clamp(split('form_signups', totals.form_signups, weights('user', 'signup')), formSubmitBy));
  const sessionBy = split('landing_sessions', totals.landing_sessions, weights('user'));
  putUser('landing_sessions', sessionBy);
  putUser('visitors', clamp(split('visitors', totals.visitors, weights('user')), sessionBy));
  const gaBy = split('ga_sessions', totals.ga_sessions, weights('user'));
  putUser('ga_sessions', gaBy);
  putUser('engaged', clamp(split('engaged', totals.engaged, weights('user', 'engage')), gaBy));
  putUser('dau', split('dau', totals.dau, weights('user')));
  const imps = split('impressions', totals.impressions, weights('campaign'));
  const clickBy = clamp(split('clicks', totals.clicks, weights('campaign')), imps);
  const spendBy = split('ad_spend', totals.ad_spend, weights('campaign'));
  putUser('impressions', imps);
  putUser('clicks', clickBy);
  putUser('ad_spend', spendBy);
  const paidSessionsBy = split('paid_sessions', totals.paid_sessions, weights('campaign'));
  const paidSignupsBy = split('paid_signups', totals.paid_signups, weights('campaign', 'signup'));
  putUser('paid_sessions', paidSessionsBy);
  putUser('paid_signups', paidSignupsBy);
  globalSeries.li_impressions.push(noisy(BASE.li_impressions, iso));
  globalSeries.li_engagements.push(Math.min(globalSeries.li_impressions.at(-1), noisy(BASE.li_engagements, iso)));
  globalSeries.li_followers.push(noisy(BASE.li_followers, iso));
  COUNTRIES.forEach((c, i) => {
    const reachW = PLATFORMS.map((p) => p.reach * (0.9 + rand() * 0.2));
    const pImps = allocate(imps[i], reachW);
    const clickW = PLATFORMS.map((p, pi) => reachW[pi] * p.click);
    const pClicks = allocate(clickBy[i], clickW);
    const priceW = PLATFORMS.map((p, pi) => Math.max(pClicks[pi], 0) * p.price);
    const pSpend = allocate(spendBy[i], priceW);
    const sessionW = pClicks.map((n) => Math.max(n, 0));
    const pSessions = split(`psess-${c.name}`, paidSessionsBy[i], sessionW);
    const signupW = PLATFORMS.map((p, pi) => Math.max(pClicks[pi], 0) * p.convert);
    const pSignups = split(`psign-${c.name}`, paidSignupsBy[i], signupW);
    PLATFORMS.forEach((p, pi) => {
      platformSeries[p.name].impressions[c.name].push(pImps[pi]);
      platformSeries[p.name].clicks[c.name].push(pClicks[pi]);
      platformSeries[p.name].ad_spend[c.name].push(pSpend[pi]);
      platformSeries[p.name].paid_sessions[c.name].push(pSessions[pi]);
      platformSeries[p.name].paid_signups[c.name].push(pSignups[pi]);
    });
  });
}

/* End-of-day stocks. Flows above stay as they were. Open accounts, payers, projects, and credits are invented on top of those flows. */
function walkStocks() {
  const open0 = allocate(820, weights('user'));
  const pay0 = allocate(210, weights('user', 'pay')).map((n, i) => Math.min(n, open0[i]));
  const with0 = open0.map((n, i) => Math.min(n, Math.round(n * (0.48 + 0.08 * COUNTRIES[i].activate))));
  const proj0 = with0.map((n) => n + Math.round(n * 0.55));
  const opening = { open_accounts: {}, paying: {}, with_project: {}, project_count: {} };
  const open = open0.slice();
  const paying = pay0.slice();
  const withP = with0.slice();
  const proj = proj0.slice();
  let payBase = pay0.slice();
  let month = DAYS[0].slice(0, 7);
  const dauHist = COUNTRIES.map(() => []);
  const pCancel = 1 - Math.pow(1 - 0.028, 1 / 30);
  const pChurn = 1 - Math.pow(1 - 0.06, 1 / 30);
  for (const key of ['open_accounts', 'active_7d', 'with_project', 'project_count', 'paying', 'canceled', 'churned', 'credits']) {
    series[key] = Object.fromEntries(COUNTRIES.map((c) => [c.name, []]));
  }
  COUNTRIES.forEach((c, i) => {
    opening.open_accounts[c.name] = open0[i];
    opening.paying[c.name] = pay0[i];
    opening.with_project[c.name] = with0[i];
    opening.project_count[c.name] = proj0[i];
  });

  DAYS.forEach((iso, di) => {
    const ym = iso.slice(0, 7);
    if (ym !== month) {
      month = ym;
      payBase = paying.slice();
    }
    COUNTRIES.forEach((c, i) => {
      const signups = series.platform_signups[c.name][di];
      const activated = series.activated[c.name][di];
      const newPaid = series.paid_subs[c.name][di];
      const dau = series.dau[c.name][di];
      const openBefore = open[i];
      const payBefore = paying[i];

      let canceled = 0;
      for (let k = 0; k < openBefore; k++) if (rand() < pCancel) canceled++;
      let churned = 0;
      const pool = Math.min(payBefore, payBase[i]);
      for (let k = 0; k < pool; k++) if (rand() < pChurn) churned++;

      const loseWith = openBefore ? Math.min(withP[i], Math.round(canceled * withP[i] / openBefore)) : 0;
      const loseProj = openBefore ? Math.min(proj[i], Math.round(canceled * proj[i] / openBefore)) : 0;

      open[i] = openBefore - canceled + signups;
      withP[i] = Math.max(0, withP[i] - loseWith);
      proj[i] = Math.max(0, proj[i] - loseProj);
      paying[i] = payBefore - churned;
      payBase[i] -= churned;

      withP[i] = Math.min(open[i], withP[i] + activated);
      proj[i] += activated;
      if (withP[i] > 0 && rand() < 0.18) proj[i] += 1;
      const dormant = open[i] - withP[i];
      if (dormant > 0 && rand() < Math.min(0.85, dormant * 0.004)) {
        withP[i] += 1;
        proj[i] += 1;
      }
      proj[i] = Math.max(proj[i], withP[i]);

      paying[i] += newPaid;
      if (paying[i] > open[i]) {
        const extra = paying[i] - open[i];
        const fromBase = Math.min(extra, payBase[i]);
        churned += fromBase;
        payBase[i] -= fromBase;
        paying[i] = open[i];
      }

      dauHist[i].push(dau);
      const recent = dauHist[i].slice(-7);
      const summed = recent.reduce((a, b) => a + b, 0);
      const active = Math.min(open[i], Math.max(Math.min(dau, open[i]), Math.round(summed * 0.62)));
      const credits = Math.round(dau * (12 + rand() * 22));

      series.open_accounts[c.name].push(open[i]);
      series.active_7d[c.name].push(active);
      series.with_project[c.name].push(withP[i]);
      series.project_count[c.name].push(proj[i]);
      series.paying[c.name].push(paying[i]);
      series.canceled[c.name].push(canceled);
      series.churned[c.name].push(churned);
      series.credits[c.name].push(credits);
    });
  });
  return opening;
}

const opening = walkStocks();

function scaleCount(n, monthIndex) {
  return Math.round(n * Math.pow(1.08, monthIndex));
}

const RATE_TARGETS = {
  ctr: OCT_TARGET.clicks / OCT_TARGET.impressions,
  cpc: OCT_TARGET.ad_spend / OCT_TARGET.clicks,
  cost_per_signup: OCT_TARGET.ad_spend / OCT_TARGET.paid_signups,
  li_engagement: OCT_TARGET.li_engagements / OCT_TARGET.li_impressions,
  engagement_rate: OCT_TARGET.engaged / OCT_TARGET.ga_sessions,
  visit_to_signup: OCT_TARGET.platform_signups / OCT_TARGET.landing_sessions,
  activation_rate: OCT_TARGET.activated / OCT_TARGET.platform_signups,
  build_rate: OCT_TARGET.first_builds / OCT_TARGET.activated,
  signup_to_paid: OCT_TARGET.paid_subs / OCT_TARGET.platform_signups,
  form_completion: 0.35,
  activity_rate: 0.2,
  project_rate: 0.55,
  cancellation_rate: 0.028,
  churn_rate: 0.06,
  cac: OCT_TARGET.ad_spend / OCT_TARGET.platform_signups,
  cost_per_paid: OCT_TARGET.ad_spend / OCT_TARGET.paid_subs,
  cost_per_activated: OCT_TARGET.ad_spend / OCT_TARGET.activated,
};

const DECIMAL_TARGETS = {
  avg_projects: 1.1,
  avg_credits: 40,
};

const COUNT_TARGET_KEYS = [
  'ad_spend', 'impressions', 'clicks', 'paid_sessions', 'paid_signups', 'campaigns',
  'landing_sessions', 'visitors', 'engaged', 'form_starts', 'form_submits', 'form_signups',
  'platform_signups', 'activated', 'first_builds', 'mau', 'paid_subs', 'li_impressions', 'li_followers',
  'open_accounts', 'active_7d', 'with_project',
];

const targets = {};
MONTHS.forEach((m, i) => {
  targets[m] = {};
  for (const k of COUNT_TARGET_KEYS) targets[m][k] = scaleCount(OCT_TARGET[k], i);
  Object.assign(targets[m], RATE_TARGETS, DECIMAL_TARGETS);
  targets[m].new_accounts = targets[m].platform_signups;
  targets[m].acq_spend = targets[m].ad_spend;
});

const metrics = [
  { id: 'ad_spend', section: 'Marketing campaigns', name: 'Ad spend', unit: 'currency', direction: 'budget', split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads', definition: 'Sum of Meta, LinkedIn, and Google Ads spend in the month. Close to 100% of the monthly budget is the goal.' },
  { id: 'impressions', section: 'Marketing campaigns', name: 'Impressions', unit: 'count', direction: 'higher', split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads', definition: 'Paid impressions across Meta, LinkedIn, and Google Ads. The dashboard breaks this out by platform.' },
  { id: 'clicks', section: 'Marketing campaigns', name: 'Clicks', unit: 'count', direction: 'higher', split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads', definition: 'Paid clicks across Meta, LinkedIn, and Google Ads.' },
  { id: 'ctr', section: 'Marketing campaigns', name: 'Click-through rate', unit: 'rate', direction: 'higher', split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads', definition: 'Paid clicks divided by paid impressions.' },
  { id: 'cpc', section: 'Marketing campaigns', name: 'Cost per click', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads', definition: 'Ad spend divided by paid clicks. Lower is better. A shorter range keeps this cost. It does not scale it.' },
  { id: 'paid_sessions', section: 'Marketing campaigns', name: 'Paid landing sessions', unit: 'count', direction: 'higher', split: 'Campaign geo', source: 'HubSpot', definition: 'Landing sessions whose UTM medium is paid (cpc or paid social).' },
  { id: 'paid_signups', section: 'Marketing campaigns', name: 'Paid sign-ups', unit: 'count', direction: 'higher', split: 'Campaign geo', source: 'PostHog', definition: 'External platform sign-ups attributed to a paid campaign. Internal accounts are excluded.' },
  { id: 'cost_per_signup', section: 'Marketing campaigns', name: 'Cost per sign-up', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads, PostHog', definition: 'Ad spend divided by paid sign-ups. Lower is better. A shorter range keeps this cost. It does not scale it.' },
  { id: 'li_impressions', section: 'Marketing campaigns', name: 'LinkedIn post impressions', unit: 'count', direction: 'higher', split: 'No', source: 'LinkedIn', definition: 'Organic impressions on the Think4Ever Global page. This stays app-wide when a country is selected.' },
  { id: 'li_engagement', section: 'Marketing campaigns', name: 'LinkedIn engagement rate', unit: 'rate', direction: 'higher', split: 'No', source: 'LinkedIn', definition: 'Organic engagements divided by organic impressions on the Think4Ever Global page. Stays app-wide when a country is selected.' },
  { id: 'li_followers', section: 'Marketing campaigns', name: 'New LinkedIn followers', unit: 'count', direction: 'higher', split: 'No', source: 'LinkedIn', definition: 'Net new followers of the Think4Ever Global page in the month. Stays app-wide when a country is selected.' },
  { id: 'campaigns', section: 'Marketing campaigns', name: 'Campaigns with spend', unit: 'count', direction: 'higher', split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads', definition: 'Count of campaigns that spent money in the month.' },
  { id: 'landing_sessions', section: 'Growth', name: 'Landing sessions', unit: 'count', direction: 'higher', split: 'Yes', source: 'HubSpot', definition: 'Visits to the HubSpot-tracked landing pages.' },
  { id: 'visitors', section: 'Growth', name: 'Visitors', unit: 'count', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'Users on the landing in Google Analytics.' },
  { id: 'engaged', section: 'Growth', name: 'Engaged sessions', unit: 'count', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'Sessions that lasted more than 10 seconds, viewed 2 or more pages, or fired a key event.' },
  { id: 'engagement_rate', section: 'Growth', name: 'Engagement rate', unit: 'rate', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'Engaged sessions divided by sessions.' },
  { id: 'form_starts', section: 'Growth', name: 'Sign-up form starts', unit: 'count', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'People who started the landing sign-up form.' },
  { id: 'form_submits', section: 'Growth', name: 'Form completed', unit: 'count', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'People who completed the landing sign-up form (the sign_up event).' },
  { id: 'form_completion', section: 'Growth', name: 'Form completion', unit: 'rate', direction: 'higher', split: 'Yes', source: 'Google Analytics 4', definition: 'Form completed divided by form started. The share of people who finish the sign-up form.' },
  { id: 'form_signups', section: 'Growth', name: 'External form sign-ups', unit: 'count', direction: 'higher', split: 'Yes', source: 'HubSpot', definition: 'HubSpot contacts from the landing form. think4ever.com addresses are removed.' },
  { id: 'platform_signups', section: 'Growth', name: 'New accounts', unit: 'count', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'New external accounts created in the product. Internal accounts are removed. The Growth page compares this count with the previous month.' },
  { id: 'visit_to_signup', section: 'Growth', name: 'Visit-to-sign-up rate', unit: 'rate', direction: 'higher', split: 'Yes', source: 'HubSpot, PostHog', definition: 'External platform sign-ups divided by landing sessions.' },
  { id: 'open_accounts', section: 'Core product', name: 'Customers', unit: 'count', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'External accounts that are still open at the end of the period. Canceled and deleted accounts are not included.' },
  { id: 'active_7d', section: 'Core product', name: 'Active customers', unit: 'count', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'Open accounts that used the app in the 7 days ending on the last day of the period.' },
  { id: 'activity_rate', section: 'Core product', name: 'Activity', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Active customers divided by open accounts. Active means they used the app in the last 7 days.' },
  { id: 'with_project', section: 'Core product', name: 'Accounts with a project', unit: 'count', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'Open accounts that have at least one project.' },
  { id: 'project_rate', section: 'Core product', name: 'Share with a project', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Accounts with at least one project divided by open accounts.' },
  { id: 'avg_projects', section: 'Core product', name: 'Avg projects per account', unit: 'decimal', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'Projects divided by open accounts, at the end of the period. Accounts with no project pull this average down.' },
  { id: 'avg_credits', section: 'Core product', name: 'Avg credits per active customer', unit: 'decimal', direction: 'higher', point: true, split: 'Yes', source: 'PostHog', definition: 'Credits spent in the last 7 days divided by customers who used the app in those 7 days.' },
  { id: 'cancellation_rate', section: 'Core product', name: 'Cancellation rate', unit: 'rate', direction: 'lower', split: 'Yes', source: 'PostHog', definition: 'Accounts canceled or deleted in the period divided by open accounts at the start of the period. Lower is better.' },
  { id: 'churn_rate', section: 'Core product', name: 'Churn rate', unit: 'rate', direction: 'lower', split: 'Yes', source: 'Platform billing (to confirm)', definition: 'Customers who paid last month and are no longer paying, divided by everyone who was paying at the end of last month. Lower is better.' },
  { id: 'new_accounts', section: 'Core product', name: 'New external accounts', unit: 'count', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Same count as new accounts on Growth, repeated so the product section stands alone.' },
  { id: 'activated', section: 'Core product', name: 'Activated accounts', unit: 'count', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'New external accounts that created a first project in the month.' },
  { id: 'activation_rate', section: 'Core product', name: 'Activation rate', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Activated accounts divided by new external accounts.' },
  { id: 'first_builds', section: 'Core product', name: 'First builds', unit: 'count', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Activated accounts that completed a first build in the month.' },
  { id: 'build_rate', section: 'Core product', name: 'Build rate', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'First builds divided by activated accounts.' },
  { id: 'mau', section: 'Core product', name: 'Monthly active users', unit: 'count', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Distinct external people active in the product during the month.' },
  { id: 'retention', section: 'Core product', name: 'New-account retention', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog', definition: 'Share of last month’s new external accounts who were active this month. October is blank because this window has no prior month.' },
  { id: 'paid_subs', section: 'Core product', name: 'New paid subscriptions', unit: 'count', direction: 'higher', split: 'Yes', source: 'Platform billing (to confirm)', definition: 'External accounts that start a paid subscription. Internal accounts are excluded.' },
  { id: 'signup_to_paid', section: 'Core product', name: 'Sign-up to paid conversion', unit: 'rate', direction: 'higher', split: 'Yes', source: 'PostHog, platform billing (to confirm)', definition: 'Of the external platform sign-ups in the month, how many start a paid subscription. The number is paid accounts of that month’s sign-ups. A person counts in the month they signed up, including if they pay later.' },
  { id: 'acq_spend', section: 'Unit economics', name: 'Total acquisition spend', unit: 'currency', direction: 'budget', split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads', definition: 'Same dollars as ad spend, so this section can be read on its own. Close to 100% of the monthly budget is the goal.' },
  { id: 'cac', section: 'Unit economics', name: 'CAC', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads, PostHog', definition: 'Ad spend divided by new sign-ups. For one day it is that day’s spend divided by that day’s new sign-ups. For a month it is the month’s spend divided by the month’s new sign-ups. Lower is better. Spend uses the campaign’s target country. Sign-ups use the account country.' },
  { id: 'cost_per_paid', section: 'Unit economics', name: 'Cost per paying customer', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads, platform billing (to confirm)', definition: 'Ad spend divided by new paid subscriptions. This is what it costs to get one customer who starts paying. Lower is better.' },
  { id: 'cost_per_activated', section: 'Unit economics', name: 'Cost per activated account', unit: 'currency', direction: 'lower', ratio: true, split: 'Campaign geo', source: 'Meta, LinkedIn, Google Ads, PostHog', definition: 'Ad spend divided by activated accounts. Lower is better. Spend uses the campaign’s target country. Activated accounts use the account country.' },
];

const data = {
  note: 'Invented daily figures through 21 Oct 2026 so the executive pages and charts can be reviewed. Not live Think4Ever data.',
  asOf: ASOF,
  days: DAYS,
  months: MONTHS.map((id) => ({ id, label: MONTH_LABEL[id], hasActuals: id === '2026-10' })),
  countries: COUNTRIES.map(({ name, seenIn }) => ({ name, seenIn, include: 'Yes' })),
  campaignCounts: CAMPAIGNS,
  metrics,
  targets,
  monthTarget: targets['2026-10'],
  assumptions: { planPrice: 49, grossMargin: 0.8 },
  opening,
  series,
  globalSeries,
  platformSeries,
};

const out = path.join(__dirname, 'preview.json');
fs.writeFileSync(out, JSON.stringify(data, null, 2));

function sumRange(metric, from) {
  const start = DAYS.indexOf(from);
  return COUNTRIES.reduce((s, c) => s + series[metric][c.name].slice(start).reduce((a, b) => a + b, 0), 0);
}
function stockAt(metric, i) {
  return COUNTRIES.reduce((s, c) => s + series[metric][c.name][i], 0);
}
function sumBetween(metric, a, b) {
  let n = 0;
  for (const c of COUNTRIES) {
    for (let i = a; i <= b; i++) n += series[metric][c.name][i];
  }
  return n;
}
for (const c of COUNTRIES) {
  const n = series.platform_signups[c.name].length;
  let openPrev = opening.open_accounts[c.name];
  let payPrev = opening.paying[c.name];
  for (let i = 0; i < n; i++) {
    if (series.activated[c.name][i] > series.platform_signups[c.name][i]) throw new Error(`activated > signups ${c.name} ${DAYS[i]}`);
    if (series.first_builds[c.name][i] > series.activated[c.name][i]) throw new Error(`builds > activated ${c.name}`);
    if (series.paid_subs[c.name][i] > series.platform_signups[c.name][i]) throw new Error(`paid > signups ${c.name}`);
    if (series.clicks[c.name][i] > series.impressions[c.name][i]) throw new Error(`clicks > impressions ${c.name}`);
    const openNow = openPrev + series.platform_signups[c.name][i] - series.canceled[c.name][i];
    if (series.open_accounts[c.name][i] !== openNow) throw new Error(`open identity ${c.name} ${DAYS[i]}`);
    if (series.with_project[c.name][i] > series.open_accounts[c.name][i]) throw new Error(`projects > open ${c.name}`);
    if (series.paying[c.name][i] > series.open_accounts[c.name][i]) throw new Error(`paying > open ${c.name}`);
    if (series.active_7d[c.name][i] > series.open_accounts[c.name][i]) throw new Error(`active > open ${c.name}`);
    if (series.project_count[c.name][i] < series.with_project[c.name][i]) throw new Error(`project count ${c.name}`);
    openPrev = series.open_accounts[c.name][i];
    payPrev = series.paying[c.name][i];
  }
  if (payPrev < 0) throw new Error(`paying < 0 ${c.name}`);
}
const aug31 = DAYS.indexOf('2026-08-31');
const sep30 = DAYS.indexOf('2026-09-30');
const oct21 = DAYS.indexOf(ASOF);
const sepChurn = sumBetween('churned', aug31 + 1, sep30);
const sepBase = stockAt('paying', aug31);
const sepPayEnd = stockAt('paying', sep30);
const sepNewPaid = sumBetween('paid_subs', aug31 + 1, sep30);
if (sepPayEnd !== sepBase + sepNewPaid - sepChurn) {
  throw new Error(`paying identity ${sepPayEnd} != ${sepBase} + ${sepNewPaid} - ${sepChurn}`);
}
const last30 = addDays(ASOF, -29);
console.log('Wrote', out, 'days', DAYS.length, DAYS[0], 'to', ASOF);
console.log('Last 30 sign-ups', sumRange('platform_signups', last30), 'paid', sumRange('paid_subs', last30), 'clicks', sumRange('clicks', last30));
console.log('India spend last 30', series.ad_spend.India.slice(-30).reduce((a, b) => a + b, 0));
for (const field of ['impressions', 'clicks', 'ad_spend', 'paid_sessions', 'paid_signups']) {
  const fromChannels = PLATFORMS.reduce((s, p) => s + COUNTRIES.reduce((t, c) => t + platformSeries[p.name][field][c.name].reduce((a, b) => a + b, 0), 0), 0);
  const fromTotal = COUNTRIES.reduce((s, c) => s + series[field][c.name].reduce((a, b) => a + b, 0), 0);
  if (fromChannels !== fromTotal) throw new Error(`${field} channels ${fromChannels} != total ${fromTotal}`);
}
const lastStart = DAYS.indexOf(last30);
const channelRollup = {};
for (const p of PLATFORMS) {
  const take = (field) => COUNTRIES.reduce((s, c) => s + platformSeries[p.name][field][c.name].slice(lastStart).reduce((a, b) => a + b, 0), 0);
  const clicks = take('clicks');
  const imps = take('impressions');
  const spend = take('ad_spend');
  const signups = take('paid_signups');
  channelRollup[p.name] = {
    imps, clicks, spend, signups,
    ctr: imps ? (clicks / imps) : 0,
    cpc: clicks ? spend / clicks : 0,
    cps: signups ? spend / signups : 0,
  };
}
console.log(JSON.stringify(channelRollup));
const last7 = oct21 - 6;
const openEnd = stockAt('open_accounts', oct21);
const activeEnd = stockAt('active_7d', oct21);
const withEnd = stockAt('with_project', oct21);
const projEnd = stockAt('project_count', oct21);
const payEnd = stockAt('paying', oct21);
const credits7 = sumBetween('credits', last7, oct21);
const oct1 = DAYS.indexOf('2026-10-01');
const sep1 = DAYS.indexOf('2026-09-01');
const openBeforeOct = stockAt('open_accounts', oct1 - 1);
const canceledOct = sumBetween('canceled', oct1, oct21);
const churnOct = sumBetween('churned', oct1, oct21);
const spend30 = sumRange('ad_spend', last30);
const sign30 = sumRange('platform_signups', last30);
const spendOct = sumBetween('ad_spend', oct1, oct21);
const signOct = sumBetween('platform_signups', oct1, oct21);
const spendSep = sumBetween('ad_spend', sep1, sep30);
const signSep = sumBetween('platform_signups', sep1, sep30);
const daySpend = sumBetween('ad_spend', oct21, oct21);
const daySign = sumBetween('platform_signups', oct21, oct21);
const formStart30 = sumRange('form_starts', last30);
const formDone30 = sumRange('form_submits', last30);
console.log(JSON.stringify({
  openEnd, activeEnd, activity: activeEnd / openEnd, withEnd, projectRate: withEnd / openEnd,
  avgProjects: projEnd / openEnd, payEnd, avgCredits: credits7 / activeEnd,
  canceledOct, openBeforeOct, cancelRate: canceledOct / openBeforeOct,
  churnOct, sepBase, churnMtd: churnOct / sepBase, sepChurnRate: sepChurn / sepBase,
  cac30: spend30 / sign30, cacOct: spendOct / signOct, cacSep: spendSep / signSep,
  cacDay: daySign ? daySpend / daySign : null, daySpend, daySign,
  formCompletion30: formDone30 / formStart30, formStart30, formDone30, sign30,
}, null, 2));

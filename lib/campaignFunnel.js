'use strict';
// Consolidated campaign funnel for the Executive view:
//   1 ad + page impressions → 2 outbound clicks → 3 landing sessions → 4 form submissions
//   → 5 accounts created / verified → 6 builders.
// Reads only stored rows (gd_items). Rules that keep the attribution honest:
// - Impressions are added as reported by each platform; they are never deduplicated as people.
// - Clicks are outbound clicks that can create a landing visit.
// - Click → session conversion uses one date window and only campaigns whose ad campaign
//   name equals the utm_campaign recorded by GA4.
// - HubSpot ↔ PostHog are linked by an HMAC of the email (the email is never stored).
// - A network that has not reported is shown as pending and the total is Under review.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOT_SET = '(not set)';
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ratio = (a, b) => (a != null && b != null && b > 0 ? a / b : null);
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const review = (reason) => (reason ? { label: 'Under review', reason } : null);
const col = (t, k, kind) => (kind ? { t, k, kind } : { t, k });

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayCount(from, to) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5) + 1;
}
function monthLastDay(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const NOTES = [
  'Impressions are added as each platform reports them. They are not people and are not deduplicated across platforms; unique reach would need a shared identity source.',
  'Video plays are not counted as impressions.',
  'Clicks are outbound clicks that can create a landing visit: Meta outbound clicks and Google Ads clicks. Meta all-clicks and link clicks are not used.',
  'Click-to-session conversion uses the same date window and only campaigns whose ad campaign name equals the utm_campaign recorded by GA4.',
  'HubSpot forms and PostHog accounts are linked by an HMAC of the email. The email is not stored in the dashboard.',
  'Builder = account with a real project (PostHog project_created) and published content. Published content is not integrated yet.',
];

// Groups rows by a label (case-insensitive) and adds the given numeric fields.
function groupBy(list, keyFn, fields) {
  const out = new Map();
  for (const item of list) {
    const label = String(keyFn(item) || '').trim() || NOT_SET;
    const key = norm(label);
    const row = out.get(key) || { name: label, ...Object.fromEntries(Object.keys(fields).map((f) => [f, 0])) };
    for (const [f, fn] of Object.entries(fields)) row[f] += fn(item);
    out.set(key, row);
  }
  return out;
}
const sortedRows = (map, field, limit = 50) => [...map.values()].sort((a, b) => b[field] - a[field]).slice(0, limit);

// Month-to-date progress and pace (#113): green ≥100%, yellow 90–<100%, red <90% of the
// target prorated to the days elapsed in the month.
function targetProgress(key, target, value, elapsedShare, basis) {
  const t = Number(target);
  if (!key || target == null || !Number.isFinite(t) || t <= 0) return null;
  if (value == null) return { key, value: t, progress: null, paceRatio: null, status: null, basis };
  const expected = elapsedShare > 0 ? t * elapsedShare : null;
  const paceRatio = expected ? value / expected : null;
  const status = paceRatio == null ? null : paceRatio >= 1 ? 'green' : paceRatio >= 0.9 ? 'yellow' : 'red';
  return { key, value: t, progress: value / t, paceRatio, status, basis };
}

function buildCampaignFunnel(input = {}) {
  const { metricRows = [], eventRows = [], snapshots = [], sources = [], from, to, monthTarget = {} } = input;
  if (!DAY.test(from || '') || !DAY.test(to || '') || to < from) {
    return { status: 'pending', reason: 'No complete day in this period yet.', from: from || null, to: to || null, stages: [], notes: NOTES };
  }
  const monthStart = `${to.slice(0, 7)}-01`;
  const monthEnd = DAY.test(input.monthEnd || '') ? input.monthEnd : monthLastDay(to);
  const elapsedShare = Math.min(1, dayCount(monthStart, to) / dayCount(monthStart, monthEnd));
  const inWindow = (d) => DAY.test(d || '') && d >= from && d <= to;

  const latest = (source, key) => snapshots
    .filter((s) => s.source === source && s.key === key)
    .sort((a, b) => String(b.pulled_at || b._at || '').localeCompare(String(a.pulled_at || a._at || '')))[0] || null;
  const coverage = (source, key) => { const s = latest(source, key); return (s && (s.rows || [])[0]) || null; };
  const chunkRows = (source, key) => {
    const head = latest(source, key);
    if (!head) return [];
    const prefix = `${key}_`;
    const index = (s) => Number(String(s.key).slice(prefix.length));
    return snapshots
      .filter((s) => s.source === source && String(s.key || '').startsWith(prefix) && /^\d+$/.test(String(s.key).slice(prefix.length)) && s.from === head.from && s.to === head.to)
      .sort((a, b) => index(a) - index(b))
      .flatMap((s) => s.rows || []);
  };
  const rows = (source, metric, filter) => metricRows.filter((r) => r.source === source && r.metric === metric && inWindow(r.date) && (!filter || filter(r)));
  const sum = (list) => list.reduce((total, r) => total + num(r.value), 0);
  const covered = (source) => {
    const s = sources.find((x) => x._k === source);
    const m = s && /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(String(s.window || ''));
    if (m && m[1] <= from && m[2] >= to) return true;
    return metricRows.some((r) => r.source === source) || eventRows.some((e) => e.source === source);
  };
  const campaignMap = (source, metric) => {
    const out = new Map();
    for (const r of rows(source, metric)) {
      const k = r.dim_value || 'Campaign';
      out.set(k, (out.get(k) || 0) + num(r.value));
    }
    return out;
  };

  // ---------- networks
  const outboundCov = coverage('meta', 'outbound_coverage');
  const outboundReady = !!(outboundCov && outboundCov.available === true);
  const paid = [];
  if (covered('meta')) {
    paid.push({
      key: 'meta', name: 'Meta Ads', status: 'loaded',
      impressions: sum(rows('meta', 'ad_impressions')), spend: sum(rows('meta', 'ad_spend')),
      clicks: outboundReady ? sum(rows('meta', 'ad_outbound_clicks')) : null, clickBasis: 'Outbound clicks',
      clickReason: outboundReady ? null : 'Meta outbound clicks are not synced yet.',
      campaigns: { impressions: campaignMap('meta', 'ad_impressions'), spend: campaignMap('meta', 'ad_spend'), clicks: outboundReady ? campaignMap('meta', 'ad_outbound_clicks') : new Map() },
    });
  } else paid.push({ key: 'meta', name: 'Meta Ads', status: 'pending', reason: 'Meta Ads has not reported for this period.' });
  if (covered('google_ads')) {
    paid.push({
      key: 'google_ads', name: 'Google Ads', status: 'loaded',
      impressions: sum(rows('google_ads', 'ad_impressions')), spend: sum(rows('google_ads', 'ad_spend')),
      clicks: sum(rows('google_ads', 'ad_clicks')), clickBasis: 'Clicks to the ad final URL', clickReason: null,
      campaigns: { impressions: campaignMap('google_ads', 'ad_impressions'), spend: campaignMap('google_ads', 'ad_spend'), clicks: campaignMap('google_ads', 'ad_clicks') },
    });
  } else paid.push({ key: 'google_ads', name: 'Google Ads', status: 'pending', reason: 'Google Ads has not reported for this period.' });
  paid.push({ key: 'linkedin_ads', name: 'LinkedIn Ads', status: 'pending', reason: 'LinkedIn Ads reporting is not connected.' });

  const organicCov = coverage('meta', 'organic_coverage') || {};
  const organic = [];
  for (const [platform, label] of [['Facebook', 'Facebook page'], ['Instagram', 'Instagram account']]) {
    const c = organicCov[platform.toLowerCase()] || {};
    organic.push(c.available === true
      ? { key: platform.toLowerCase(), name: label, status: 'loaded', impressions: sum(rows('meta', 'organic_views', (r) => r.dim_value === platform)) }
      : { key: platform.toLowerCase(), name: label, status: 'pending', reason: c.reason || 'Organic page views are not synced yet.' });
  }
  organic.push(covered('linkedin')
    ? { key: 'linkedin_page', name: 'LinkedIn page', status: 'loaded', impressions: sum(rows('linkedin', 'post_impressions')) }
    : { key: 'linkedin_page', name: 'LinkedIn page', status: 'pending', reason: 'LinkedIn page analytics have not reported.' });

  const paidLoaded = paid.filter((n) => n.status === 'loaded');
  const organicLoaded = organic.filter((n) => n.status === 'loaded');
  const knownSpend = paidLoaded.length ? paidLoaded.reduce((s, n) => s + n.spend, 0) : null;
  const spendPending = paid.filter((n) => n.status !== 'loaded').map((n) => n.name);
  const spendNote = spendPending.length ? `Known spend only: ${spendPending.join(', ')} not reported.` : null;
  const cost = (volume, label, basis, spend, partialReason) => {
    if (spend == null) return { value: null, label, basis, reason: 'No paid spend reported for this period.' };
    if (volume == null || !(volume > 0)) return { value: null, label, basis, reason: 'No results yet.' };
    return { value: spend / volume, label, basis, partial: !!partialReason, reason: partialReason || null };
  };
  const stages = [];

  // ---------- 1. impressions
  const paidImpressions = paidLoaded.length ? paidLoaded.reduce((s, n) => s + n.impressions, 0) : null;
  const organicImpressions = organicLoaded.length ? organicLoaded.reduce((s, n) => s + n.impressions, 0) : null;
  const impressionsValue = paidImpressions == null && organicImpressions == null ? null : (paidImpressions || 0) + (organicImpressions || 0);
  const impressionsPending = [...paid, ...organic].filter((n) => n.status !== 'loaded').map((n) => n.name);
  const campaignRows = [];
  for (const n of paidLoaded) {
    const names = new Set([...n.campaigns.impressions.keys(), ...n.campaigns.spend.keys(), ...n.campaigns.clicks.keys()]);
    for (const c of names) {
      campaignRows.push({
        network: n.name, campaign: c, impressions: n.campaigns.impressions.get(c) || 0,
        clicks: n.clicks == null ? null : n.campaigns.clicks.get(c) || 0, spend: n.campaigns.spend.get(c) || 0,
      });
    }
  }
  campaignRows.sort((a, b) => b.impressions - a.impressions);
  const networkRow = (group) => (n) => ({ group, network: n.name, status: n.status, value: n.status === 'loaded' ? n.impressions : null, note: n.reason || '' });
  stages.push({
    id: 'impressions', name: 'Ad and page impressions', source: 'Meta · Google Ads · LinkedIn (reported impressions)',
    status: impressionsValue == null ? 'pending' : 'loaded',
    reason: impressionsValue == null ? 'No network has reported impressions for this period.' : null,
    value: impressionsValue, split: { paid: paidImpressions, organic: organicImpressions },
    underReview: review(impressionsPending.length ? `Not reported yet: ${impressionsPending.join(', ')}. The total includes only reported networks.` : null),
    conversion: null,
    target: targetProgress('total_impressions', monthTarget.total_impressions, paidImpressions, elapsedShare, 'Paid impressions vs monthly target'),
    cost: cost(paidImpressions == null ? null : paidImpressions / 1000, 'CPM (paid)', 'Known paid spend ÷ paid impressions × 1,000', knownSpend, spendNote),
    extras: [
      { label: 'Paid impressions', value: paidImpressions, kind: 'count' },
      { label: 'Organic page impressions', value: organicImpressions, kind: 'count' },
    ],
    breakdowns: [
      { title: 'By network and platform', columns: [col('Type', 'group'), col('Network / platform', 'network'), col('Status', 'status', 'status'), col('Impressions', 'value', 'count'), col('Note', 'note')], rows: [...paid.map(networkRow('Paid')), ...organic.map(networkRow('Organic'))] },
      { title: 'By campaign (paid)', columns: [col('Network', 'network'), col('Campaign', 'campaign'), col('Impressions', 'impressions', 'count'), col('Outbound clicks', 'clicks', 'count'), col('Spend', 'spend', 'money')], rows: campaignRows.slice(0, 50), empty: 'No paid campaigns in this period.' },
    ],
    definition: 'Total = paid + organic impressions as reported by each platform. Not unique people.',
  });

  // ---------- 2. outbound clicks
  const clickNets = paidLoaded.filter((n) => n.clicks != null);
  const clicksValue = clickNets.length ? clickNets.reduce((s, n) => s + n.clicks, 0) : null;
  const clickNetImpressions = clickNets.length ? clickNets.reduce((s, n) => s + n.impressions, 0) : null;
  const clickNetSpend = clickNets.length ? clickNets.reduce((s, n) => s + n.spend, 0) : null;
  const clickPending = paid.filter((n) => n.status !== 'loaded' || n.clicks == null).map((n) => n.name);
  stages.push({
    id: 'clicks', name: 'Clicks to the landing', source: 'Meta outbound clicks · Google Ads clicks',
    status: clicksValue == null ? 'pending' : 'loaded',
    reason: clicksValue == null ? 'No network has reported outbound clicks for this period.' : null,
    value: clicksValue,
    underReview: review(clickPending.length ? `Not reported yet: ${clickPending.join(', ')}. The total includes only reported networks.` : null),
    conversion: { value: ratio(clicksValue, clickNetImpressions), basis: 'Outbound clicks ÷ paid impressions of the same networks' },
    target: targetProgress('clicks', monthTarget.clicks, clicksValue, elapsedShare, 'Clicks vs monthly target'),
    cost: cost(clicksValue, 'Cost per outbound click', 'Spend of the same networks ÷ their clicks', clickNetSpend, spendNote),
    extras: [],
    breakdowns: [
      { title: 'By network', columns: [col('Network', 'network'), col('Status', 'status', 'status'), col('Counted as', 'basis'), col('Clicks', 'clicks', 'count'), col('Note', 'note')], rows: paid.map((n) => ({ network: n.name, status: n.status === 'loaded' && n.clicks != null ? 'loaded' : 'pending', basis: n.clickBasis || '', clicks: n.clicks == null ? null : n.clicks, note: n.reason || n.clickReason || '' })) },
      { title: 'By campaign', columns: [col('Network', 'network'), col('Campaign', 'campaign'), col('Clicks', 'clicks', 'count'), col('Spend', 'spend', 'money')], rows: campaignRows.filter((r) => r.clicks != null).sort((a, b) => b.clicks - a.clicks).slice(0, 50), empty: 'No campaign reported outbound clicks.' },
    ],
    definition: 'Only clicks that leave the ad toward a destination that can create a landing visit.',
  });

  // ---------- 3. landing sessions
  const landingCov = coverage('ga4', 'executive_landing');
  const landingReady = !!(landingCov && landingCov.available === true);
  const sessionsValue = landingReady ? sum(rows('ga4', 'ga_exec_geo_sessions')) : null;
  const utmCov = coverage('ga4', 'executive_landing_utm');
  const utmReady = !!(utmCov && utmCov.available === true);
  const utmRows = utmReady ? chunkRows('ga4', 'executive_landing_utm').filter((r) => inWindow(r.date)) : [];
  const sessionsOf = (r) => num(r.sessions);
  const bySource = groupBy(utmRows, (r) => r.source, { sessions: sessionsOf });
  const byContent = groupBy(utmRows, (r) => r.content, { sessions: sessionsOf });
  const byCampaign = groupBy(utmRows, (r) => r.campaign, { sessions: sessionsOf });
  const adByCampaign = new Map();
  for (const n of clickNets) {
    for (const [c, v] of n.campaigns.clicks) {
      const k = norm(c);
      const a = adByCampaign.get(k) || { clicks: 0, spend: 0, networks: new Set() };
      a.clicks += v;
      a.spend += n.campaigns.spend.get(c) || 0;
      a.networks.add(n.name);
      adByCampaign.set(k, a);
    }
  }
  let matchedClicks = 0, matchedSessions = 0, matchedSpend = 0, matchedCount = 0;
  const campaignSessionRows = [...byCampaign.values()].map((row) => {
    const ad = row.name === NOT_SET ? null : adByCampaign.get(norm(row.name));
    if (ad && ad.clicks > 0) { matchedClicks += ad.clicks; matchedSessions += row.sessions; matchedSpend += ad.spend; matchedCount += 1; }
    return { campaign: row.name, sessions: row.sessions, networks: ad ? [...ad.networks].join(', ') : '', clicks: ad ? ad.clicks : null, rate: ad ? ratio(row.sessions, ad.clicks) : null };
  }).sort((a, b) => b.sessions - a.sessions);
  const notSetSessions = (byCampaign.get(norm(NOT_SET)) || { sessions: 0 }).sessions;
  const utmReason = utmReady ? null : (utmCov && utmCov.reason) || 'GA4 go-host UTM report not synced yet.';
  stages.push({
    id: 'sessions', name: 'Landing sessions', source: 'GA4 · go.think4ever.com',
    status: sessionsValue == null ? 'pending' : 'loaded',
    reason: sessionsValue == null ? 'GA4 go-host coverage is unavailable for this period.' : null,
    value: sessionsValue,
    underReview: review(utmCov && utmCov.truncated ? 'The GA4 UTM table reached its row limit; the UTM detail is incomplete.' : null),
    conversion: matchedCount
      ? { value: matchedSessions / matchedClicks, basis: `Campaign-matched: ${matchedCount} campaign(s), same window` }
      : { value: null, basis: 'Campaign-matched', reason: utmReason || 'No ad campaign name matches a utm_campaign in this window.' },
    target: targetProgress('landing_sessions', monthTarget.landing_sessions, sessionsValue, elapsedShare, 'Sessions vs monthly target'),
    cost: matchedCount
      ? cost(matchedSessions, 'Cost per landing session', 'Spend of matched campaigns ÷ their sessions', matchedSpend, null)
      : { value: null, label: 'Cost per landing session', reason: 'Needs campaigns matched by utm_campaign.' },
    extras: utmReady ? [
      { label: 'Sessions with utm_campaign', value: Math.max(0, utmRows.reduce((s, r) => s + sessionsOf(r), 0) - notSetSessions), kind: 'count' },
      { label: 'Sessions without utm_campaign', value: notSetSessions, kind: 'count' },
    ] : [{ label: 'UTM detail', value: null, reason: utmReason }],
    breakdowns: [
      { title: 'By utm_source', columns: [col('utm_source', 'name'), col('Sessions', 'sessions', 'count')], rows: sortedRows(bySource, 'sessions', 25), empty: utmReason || 'No sessions in this period.' },
      { title: 'By utm_campaign (matched to ad campaigns)', columns: [col('utm_campaign', 'campaign'), col('Ad network', 'networks'), col('Sessions', 'sessions', 'count'), col('Ad clicks', 'clicks', 'count'), col('Click → session', 'rate', 'rate')], rows: campaignSessionRows.slice(0, 50), empty: utmReason || 'No sessions in this period.' },
      { title: 'By utm_content', columns: [col('utm_content', 'name'), col('Sessions', 'sessions', 'count')], rows: sortedRows(byContent, 'sessions', 25), empty: utmReason || 'No sessions in this period.' },
    ],
    definition: 'All GA4 sessions on go.think4ever.com in the window, including non-paid traffic. Conversion uses only campaigns present in both the ad platform and utm_campaign.',
  });

  // ---------- 4. form submissions
  const hubspotReady = covered('hubspot');
  const isInternal = (e) => e.internal === true || e.internal === 'true';
  const formEvents = eventRows.filter((e) => e.kind === 'form_signup' && !isInternal(e));
  const formsIn = formEvents.filter((e) => inWindow(e.date));
  const formsValue = hubspotReady ? formsIn.length : null;
  const touch = (e, k) => e[`first_utm_${k}`] || e[`utm_${k}`] || NOT_SET;
  const gaSignupReady = metricRows.some((r) => r.source === 'ga4' && r.metric === 'ga_event');
  const one = () => 1;
  stages.push({
    id: 'forms', name: 'Form submissions', source: 'HubSpot · external contacts',
    status: formsValue == null ? 'pending' : 'loaded',
    reason: formsValue == null ? 'HubSpot has not reported for this period.' : null,
    value: formsValue, underReview: null,
    conversion: { value: ratio(formsValue, sessionsValue), basis: 'Forms ÷ all go-host sessions (same window)' },
    target: targetProgress('crm_contacts', monthTarget.crm_contacts, formsValue, elapsedShare, 'CRM contacts vs monthly target'),
    cost: cost(formsValue, 'Cost per form', 'Blended: known paid spend ÷ forms', knownSpend, spendNote),
    extras: [{ label: 'GA4 sign_up events (all site hosts)', value: gaSignupReady ? sum(rows('ga4', 'ga_event', (r) => r.dim_value === 'sign_up')) : null, kind: 'count', reason: gaSignupReady ? null : 'GA4 events not synced.' }],
    breakdowns: [
      { title: 'By utm_source (first touch)', columns: [col('utm_source', 'name'), col('Forms', 'forms', 'count')], rows: sortedRows(groupBy(formsIn, (e) => touch(e, 'source'), { forms: one }), 'forms', 25), empty: 'No forms in this period.' },
      { title: 'By utm_campaign (first touch)', columns: [col('utm_campaign', 'name'), col('Forms', 'forms', 'count')], rows: sortedRows(groupBy(formsIn, (e) => touch(e, 'campaign'), { forms: one }), 'forms', 50), empty: 'No forms in this period.' },
      { title: 'By HubSpot channel', columns: [col('Channel', 'name'), col('Forms', 'forms', 'count')], rows: sortedRows(groupBy(formsIn, (e) => e.channel, { forms: one }), 'forms', 25), empty: 'No forms in this period.' },
    ],
    definition: 'HubSpot contacts from the site forms; internal contacts removed. First-touch UTMs are preferred.',
  });

  // ---------- 5. accounts created / verified
  const accountCov = coverage('posthog', 'executive_accounts');
  const accountReady = !!(accountCov && accountCov.available === true);
  const createdValue = accountReady ? sum(rows('posthog', 'ph_exec_accounts', (r) => norm(r.dim_value) === 'external')) : null;
  const cohortCov = coverage('posthog', 'identity_cohort');
  const cohortReady = !!(cohortCov && cohortCov.available === true);
  const cohortReason = cohortReady ? null : (cohortCov && cohortCov.reason) || 'PostHog identity cohort not synced yet.';
  const cohortIn = cohortReady ? chunkRows('posthog', 'identity_cohort').filter((r) => inWindow(r.created)) : [];
  const verifiedValue = cohortReady ? cohortIn.filter((r) => r.verified && r.verified <= to).length : null;
  const formHashes = new Set(formEvents.filter((e) => e.date <= to && e.email_hmac).map((e) => e.email_hmac));
  const matchedFromForm = (r) => !!(r.id_hash && formHashes.has(r.id_hash));
  const fromCampaignValue = cohortReady && formHashes.size ? cohortIn.filter(matchedFromForm).length : null;
  const matchReason = !cohortReady ? cohortReason : !formHashes.size ? 'HubSpot form events do not carry email_hmac yet (next HubSpot sync with IDENTITY_HMAC_KEY).' : null;
  const verifiedReason = !cohortReady ? cohortReason : verifiedValue === 0 && cohortIn.length ? 'No account_verified events found; the event may not be sent yet.' : null;
  const accountReviews = [];
  if (accountCov && Number(accountCov.excluded_host_accounts) > 0) accountReviews.push('Unclassified first-identify hosts are excluded; approved hosts only.');
  if (cohortCov && cohortCov.truncated) accountReviews.push('The identity cohort reached its row limit; verified and matched counts are incomplete.');
  const cohortFields = { accounts: one, verified: (r) => (r.verified && r.verified <= to ? 1 : 0), from_form: (r) => (matchedFromForm(r) ? 1 : 0) };
  const cohortCols = (label) => [col(label, 'name'), col('Accounts', 'accounts', 'count'), col('Verified', 'verified', 'count'), col('Matched to a form', 'from_form', 'count')];
  stages.push({
    id: 'accounts', name: 'Accounts created · verified', source: 'PostHog · approved hosts · external',
    status: createdValue == null ? 'pending' : 'loaded',
    reason: createdValue == null ? 'PostHog account coverage is unavailable for this period.' : null,
    value: createdValue,
    underReview: review(accountReviews.join(' ') || null),
    conversion: { value: ratio(createdValue, formsValue), basis: 'Accounts ÷ forms (blended; not every account comes from a form)' },
    target: targetProgress('platform_signups', monthTarget.platform_signups, createdValue, elapsedShare, 'Sign-ups vs monthly target'),
    cost: cost(createdValue, 'Cost per account', 'Blended: known paid spend ÷ accounts', knownSpend, spendNote),
    extras: [
      { label: 'Verified (account_verified)', value: verifiedValue, kind: 'count', reason: verifiedReason },
      { label: 'Matched to a campaign form (HMAC)', value: fromCampaignValue, kind: 'count', reason: matchReason },
    ],
    breakdowns: [
      { title: 'By first-touch utm_source', columns: cohortCols('utm_source'), rows: sortedRows(groupBy(cohortIn, (r) => r.utm_source, cohortFields), 'accounts', 25), empty: cohortReason || 'No accounts in this period.' },
      { title: 'By first-touch utm_campaign', columns: cohortCols('utm_campaign'), rows: sortedRows(groupBy(cohortIn, (r) => r.utm_campaign, cohortFields), 'accounts', 50), empty: cohortReason || 'No accounts in this period.' },
    ],
    definition: 'Created = first $identify per external person on an approved host. Verified = account_verified. Matched = the account email HMAC equals a HubSpot form email HMAC.',
  });

  // ---------- 6. builders
  const diff = (a, b) => dayCount(a, b) - 1;
  const built = cohortIn.filter((r) => r.project && r.project <= to);
  const day0 = built.filter((r) => r.project === r.created).length;
  const within14 = built.filter((r) => diff(r.created, r.project) <= 14).length;
  const mature = cohortIn.filter((r) => addDays(r.created, 14) <= to);
  const matureBuilt = mature.filter((r) => r.project && r.project <= to && diff(r.created, r.project) <= 14).length;
  const buildersValue = cohortReady ? built.length : null;
  const builderFields = { accounts: one, builders: (r) => (r.project && r.project <= to ? 1 : 0) };
  const published = { status: 'pending', label: 'No data yet', definition: 'Published content: URL and publication date per builder. The source is not integrated yet.' };
  stages.push({
    id: 'builders', name: 'Active builders', source: 'PostHog · project_created',
    status: buildersValue == null ? 'pending' : 'loaded',
    reason: buildersValue == null ? cohortReason : null,
    value: buildersValue,
    underReview: review('Counts project_created only; the published-content half of the builder definition is not integrated yet.'),
    conversion: { value: cohortReady ? ratio(buildersValue, cohortIn.length) : null, basis: 'Builders ÷ accounts created in the window (cohort)', reason: cohortReady ? null : cohortReason },
    target: null,
    cost: cost(buildersValue, 'Cost per builder', 'Blended: known paid spend ÷ builders', knownSpend, spendNote),
    builders: cohortReady ? { day0, within14, mature: mature.length, rate14: ratio(matureBuilt, mature.length) } : null,
    published,
    extras: [
      { label: 'Project on day 0', value: cohortReady ? day0 : null, kind: 'count', reason: cohortReason },
      { label: 'Project within 14 days', value: cohortReady ? within14 : null, kind: 'count' },
      { label: '14-day rate (cohorts 14+ days old)', value: cohortReady ? ratio(matureBuilt, mature.length) : null, kind: 'rate', reason: cohortReady && !mature.length ? 'No cohort is 14 days old yet.' : null },
      { label: 'Published content', value: null, kind: 'count', reason: published.definition },
    ],
    breakdowns: [
      { title: 'By first-touch utm_campaign', columns: [col('utm_campaign', 'name'), col('Accounts', 'accounts', 'count'), col('Builders', 'builders', 'count')], rows: sortedRows(groupBy(cohortIn, (r) => r.utm_campaign, builderFields), 'builders', 50), empty: cohortReason || 'No accounts in this period.' },
    ],
    definition: 'Builder = real project (first project_created) and published content. Day 0 = project on the account day; 14 days = project within 14 days of the account.',
  });

  return {
    status: 'loaded', from, to, stages,
    spend: { known: knownSpend, complete: !spendPending.length, pending: spendPending },
    notes: NOTES,
  };
}

module.exports = { buildCampaignFunnel };

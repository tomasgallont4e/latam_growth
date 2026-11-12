
'use strict';
// Daily Landing Funnel Report (Executive). Read-only: it is built only from rows the connectors already
// stored in gd_items. It never calls an external API, never writes, and never touches a connector (#111).
// One row per day × channel × campaign:
//   spend · impressions · clicks (ad platforms) → landing sessions (GA4 UTM) → forms (HubSpot UTMs)
//   → accounts created (PostHog first $identify) → logins (signed_in) → projects created (first project_created).
// Honesty rules:
// - A stage without a connector is not_connected. A day outside a source's synced window is null (No data),
//   never zero. A day inside the window without rows is a real zero.
// - A campaign is never inferred: rows without a UTM stay under "(no UTM source)" / "(no UTM campaign)".
// - Ad metrics join sessions, forms and accounts only when the ad campaign name equals utm_campaign
//   (case-insensitive), the same rule as the campaign funnel.
// - HubSpot and PostHog people are joined only by the existing identity hash. The output carries
//   aggregated counts only: no emails, no hashes, no person rows.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const TZ = 'America/Bogota';
const NO_CAMPAIGN = '(no UTM campaign)';
const NO_SOURCE = '(no UTM source)';
const UNNAMED_AD = '(unnamed ad campaign)';
const BLANK = new Set(['', '(not set)', 'not set', '(not provided)', 'null', 'undefined']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clean = (v) => String(v == null ? '' : v).trim();
const blank = (v) => BLANK.has(clean(v).toLowerCase());
const norm = (v) => clean(v).toLowerCase();
const real = (r) => !!r && r.seed !== true && r.seed !== 'true';
const div = (a, b) => (a != null && b != null && b > 0 ? a / b : null);
const isInternal = (e) => e.internal === true || e.internal === 'true';

function bogotaDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const monthOk = (m) => MONTH.test(String(m || ''));
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
function latest(snapshots, source, key) {
  const stamp = (s) => String(s.pulled_at || s._at || s.to || '');
  return snapshots.filter((s) => s.source === source && s.key === key).sort((a, b) => stamp(b).localeCompare(stamp(a)))[0] || null;
}
function chunkRows(snapshots, source, key, head) {
  if (!head) return [];
  const prefix = `${key}_`;
  const index = (s) => Number(String(s.key).slice(prefix.length));
  return snapshots
    .filter((s) => s.source === source && String(s.key || '').startsWith(prefix) && /^\d+$/.test(String(s.key).slice(prefix.length)) && s.from === head.from && s.to === head.to)
    .sort((a, b) => index(a) - index(b))
    .flatMap((s) => s.rows || []);
}
const windowOf = (head) => (head && DAY.test(head.from || '') && DAY.test(head.to || '') && head.from <= head.to ? { from: head.from, to: head.to } : null);
function windowFromSource(src) {
  const m = src && /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(String(src.window || ''));
  return m ? { from: m[1], to: m[2] } : null;
}
const covers = (w, d) => !!(w && d >= w.from && d <= w.to);
function daySums(rows) {
  const out = new Map();
  for (const r of rows) if (DAY.test(r.date || '')) out.set(r.date, (out.get(r.date) || 0) + num(r.value));
  return out;
}
function derive(r, sessions, forms, accounts) {
  const spend = r.spend;
  const cost = (d) => (spend != null && d != null && d > 0 ? spend / d : null);
  return {
    cpm: spend != null && r.impressions != null && r.impressions > 0 ? (spend / r.impressions) * 1000 : null,
    cpc: cost(r.clicks),
    costPerSession: cost(sessions),
    costPerForm: cost(forms),
    costPerAccount: cost(accounts),
    ctr: div(r.clicks, r.impressions),
    clickToSession: div(sessions, r.clicks),
    sessionToForm: div(r.forms, r.sessions),
    sessionToAccount: div(r.accounts, r.sessions),
    accountToProject: div(r.projects, r.accounts),
  };
}

const NOTES = [
  'Days are calendar days. The report keeps the day each connector stored; it does not re-bucket dates. Each stage lists the day basis of its source.',
  'Ad spend, impressions and clicks join sessions, forms and accounts only when the ad campaign name equals the utm_campaign (case-insensitive). Everything else stays under its utm_source, or "(no UTM source)" / "(no UTM campaign)". A campaign is never inferred.',
  'Sessions use the GA4 session source / medium / campaign on go.think4ever.com. Forms use the HubSpot UTM properties (first touch when present, otherwise last touch). Internal contacts are excluded.',
  'Accounts and projects per campaign come from the PostHog identity cohort. When an account matches a HubSpot form through the shared identity hash, the HubSpot UTMs are used; otherwise the PostHog first-touch UTMs; otherwise it stays unattributed.',
  'Accounts created in the daily totals is the PostHog first $identify count (External, all hosts), the same number as Overview. The campaign split covers the identity cohort.',
  'Cost per session, form and account use campaign-matched results only (rows with ad spend). Blended cost per account divides all known spend by all accounts created.',
  '– means the value does not apply (an organic row has no spend) or the source has not synced that day. 0 is a real zero inside the synced window.',
];

function build(input = {}) {
  const metrics = (input.metricRows || []).filter(real);
  const events = (input.eventRows || []).filter(real);
  const snaps = (input.snapshots || []).filter(real);
  const sources = input.sources || [];
  const sampleExcluded = (input.metricRows || []).length - metrics.length + (input.eventRows || []).length - events.length + (input.snapshots || []).length - snaps.length;
  const now = input.now instanceof Date ? input.now : new Date(Date.parse(input.now || '') || Date.now());
  const launch = DAY.test(input.launch || '') ? input.launch : '2026-10-01';
  const today = bogotaDay(now);
  const month = monthOk(input.month) ? input.month : today.slice(0, 7);
  const first = `${month}-01`;
  const from = first < launch ? launch : first;
  const end = monthEnd(month);
  const to = end < today ? end : today;
  const base = { month, timezone: TZ, today, from, to, sampleExcluded, notes: NOTES };
  if (from > to) {
    return { ...base, status: 'pending', reason: 'This month has no day between launch and today (America/Bogota).', stages: [], networks: [], days: [], rows: [] };
  }
  const inMonth = (d) => DAY.test(d || '') && d >= from && d <= to;
  const sourceOf = (k) => sources.find((s) => s && (s._k === k || s.key === k)) || null;
  const connected = (k) => { const s = sourceOf(k); return !!(s && s.state === 'connected'); };

  // ---------- ad platforms
  const NETS = [
    { key: 'meta', name: 'Meta Ads', clicks: 'ad_outbound_clicks', clickCoverage: 'outbound_coverage', basis: 'Day as reported by Meta (ad account time zone)' },
    { key: 'google_ads', name: 'Google Ads', clicks: 'ad_clicks', clickCoverage: null, basis: 'Day as reported by Google Ads (account time zone)' },
  ];
  const networks = NETS.map((n) => {
    const of = (metric) => metrics.filter((r) => r.source === n.key && r.metric === metric && r.dim === 'campaign');
    const spendRows = of('ad_spend');
    const imprRows = of('ad_impressions');
    const has = spendRows.length + imprRows.length > 0;
    const covHead = n.clickCoverage ? latest(snaps, n.key, n.clickCoverage) : null;
    const window = windowOf(covHead) || windowFromSource(sourceOf(n.key));
    const out = { key: n.key, name: n.name, basis: n.basis, window, spendRows: [], imprRows: [], clickRows: [], clicksReady: false };
    if (!has && !connected(n.key)) return { ...out, status: 'not_connected', reason: `${n.name} is not connected.` };
    const cov = covHead && (covHead.rows || [])[0];
    const clicksReady = !n.clickCoverage || !!(cov && cov.available === true);
    const clickRows = clicksReady ? of(n.clicks) : [];
    const status = has || window ? 'loaded' : 'no_data';
    const reason = status === 'no_data' ? `${n.name} is connected but has not reported spend or impressions.`
      : clicksReady ? null : `${n.name} outbound clicks are not synced yet; all-clicks are not substituted.`;
    return { ...out, status, reason, spendRows, imprRows, clickRows, clicksReady };
  });
  for (const n of networks) {
    n.spendBy = daySums(n.spendRows);
    n.imprBy = daySums(n.imprRows);
    n.clickBy = daySums(n.clickRows);
    n.active = new Set([...n.spendRows, ...n.imprRows, ...n.clickRows].map((r) => r.date));
  }
  // LinkedIn reports impressions only; its spend is not synced, so it never makes spend partial.
  networks.push({ key: 'linkedin_ads', name: 'LinkedIn Ads', status: 'not_connected', tracksSpend: false, reason: 'LinkedIn Ads reporting is not connected; only LinkedIn page analytics are synced.', basis: '—', window: null, spendRows: [], imprRows: [], clickRows: [], clicksReady: false, spendBy: new Map(), imprBy: new Map(), clickBy: new Map(), active: new Set() });
  const loadedNets = networks.filter((n) => n.status === 'loaded');
  const onDay = (n, date) => n.status === 'loaded' && (covers(n.window, date) || n.active.has(date));
  const netByKey = new Map(networks.map((n) => [n.key, n]));

  const adName = (r) => (blank(r.dim_value) ? UNNAMED_AD : clean(r.dim_value));
  const adCampaigns = new Map();
  for (const n of loadedNets) {
    for (const r of [...n.spendRows, ...n.imprRows, ...n.clickRows]) {
      if (!inMonth(r.date)) continue;
      const name = adName(r);
      const c = adCampaigns.get(norm(name)) || { name, nets: new Set() };
      c.nets.add(n.key);
      adCampaigns.set(norm(name), c);
    }
  }
  const adChannel = (c) => [...c.nets].map((k) => netByKey.get(k).name).join(' + ');

  // ---------- detail rows: date × channel × campaign
  const detail = new Map();
  const rowFor = (date, channel, campaign, ad) => {
    const key = `${date}|${norm(channel)}|${norm(campaign)}`;
    let row = detail.get(key);
    if (!row) {
      row = { date, channel, campaign, paid: !!ad, nets: ad ? ad.nets : null, mediums: new Set(), spend: null, impressions: null, clicks: null, sessions: null, forms: null, accounts: null, projects: null };
      detail.set(key, row);
    }
    return row;
  };
  const add = (row, field, value) => { row[field] = (row[field] || 0) + value; };
  const place = (date, source, medium, campaign) => {
    const ad = blank(campaign) ? null : adCampaigns.get(norm(campaign));
    const row = ad ? rowFor(date, adChannel(ad), ad.name, ad)
      : rowFor(date, blank(source) ? NO_SOURCE : norm(source), blank(campaign) ? NO_CAMPAIGN : clean(campaign), null);
    if (!blank(medium)) row.mediums.add(norm(medium));
    return row;
  };

  for (const n of loadedNets) {
    for (const [rows, field] of [[n.spendRows, 'spend'], [n.imprRows, 'impressions'], [n.clickRows, 'clicks']]) {
      for (const r of rows) {
        if (!inMonth(r.date)) continue;
        const ad = adCampaigns.get(norm(adName(r)));
        add(rowFor(r.date, adChannel(ad), ad.name, ad), field, num(r.value));
      }
    }
  }

  // GA4 landing sessions by source / medium / campaign (go host).
  const utmHead = latest(snaps, 'ga4', 'executive_landing_utm');
  const utmCov = utmHead && (utmHead.rows || [])[0];
  const gaReady = !!(utmCov && utmCov.available === true);
  const gaWindow = gaReady ? windowOf(utmHead) : null;
  const gaDay = new Map();
  if (gaReady) {
    for (const r of chunkRows(snaps, 'ga4', 'executive_landing_utm', utmHead)) {
      if (!real(r) || !inMonth(r.date)) continue;
      const s = num(r.sessions);
      add(place(r.date, r.source, r.medium, r.campaign), 'sessions', s);
      gaDay.set(r.date, (gaDay.get(r.date) || 0) + s);
    }
  }
  const gaStatus = gaReady ? 'loaded' : connected('ga4') || utmHead ? 'no_data' : 'not_connected';
  const gaReason = gaReady ? (utmCov.truncated ? 'The GA4 UTM table reached its row limit; some sessions are missing.' : null)
    : gaStatus === 'no_data' ? (utmCov && utmCov.reason) || 'The GA4 go-host UTM report is not synced.' : 'GA4 is not connected.';

  // HubSpot forms (external contacts) with their UTM properties.
  const forms = events.filter((e) => e.source === 'hubspot' && e.kind === 'form_signup' && !isInternal(e));
  const hubspotOn = connected('hubspot') || forms.length > 0;
  const hsWindow = windowOf(latest(snaps, 'hubspot', 'utm_capture')) || windowFromSource(sourceOf('hubspot'));
  const touchOf = (e) => (!blank(e.first_utm_source) || !blank(e.first_utm_campaign)
    ? { source: e.first_utm_source, medium: e.first_utm_medium, campaign: e.first_utm_campaign, basis: 'first' }
    : { source: e.utm_source, medium: e.utm_medium, campaign: e.utm_campaign, basis: 'last' });
  const formDay = new Map();
  const formTouch = { first: 0, last: 0, none: 0 };
  for (const e of forms) {
    if (!inMonth(e.date)) continue;
    const t = touchOf(e);
    formTouch[blank(t.source) && blank(t.campaign) ? 'none' : t.basis] += 1;
    add(place(e.date, t.source, t.medium, t.campaign), 'forms', 1);
    formDay.set(e.date, (formDay.get(e.date) || 0) + 1);
  }
  const formByHash = new Map();
  for (const e of [...forms].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))) {
    if (e.email_hmac && !formByHash.has(e.email_hmac)) formByHash.set(e.email_hmac, e);
  }

  // PostHog: daily accounts total, identity cohort (accounts and projects by campaign), signed_in events (logins).
  const accHead = latest(snaps, 'posthog', 'account_coverage');
  const accCov = accHead && (accHead.rows || [])[0];
  const accReady = !!(accCov && accCov.available === true);
  const accWindow = accReady ? windowOf(accHead) : null;
  const accDay = daySums(metrics.filter((r) => r.source === 'posthog' && r.metric === 'ph_accounts' && r.dim === 'account_type' && norm(r.dim_value) === 'external'));
  const cohortHead = latest(snaps, 'posthog', 'identity_cohort');
  const cohortCov = cohortHead && (cohortHead.rows || [])[0];
  const cohortReady = !!(cohortCov && cohortCov.available === true);
  const cohortWindow = cohortReady ? windowOf(cohortHead) : null;
  const seen = new Set();
  const people = [];
  for (const p of cohortReady ? chunkRows(snaps, 'posthog', 'identity_cohort', cohortHead) : []) {
    if (!real(p)) continue;
    if (p.id_hash) { if (seen.has(p.id_hash)) continue; seen.add(p.id_hash); }
    people.push(p);
  }
  const attributeOf = (p) => {
    const f = p.id_hash ? formByHash.get(p.id_hash) : null;
    if (f) { const t = touchOf(f); if (!blank(t.source) || !blank(t.campaign)) return { ...t, basis: 'hubspot' }; }
    if (!blank(p.utm_source) || !blank(p.utm_campaign)) return { source: p.utm_source, medium: null, campaign: p.utm_campaign, basis: 'posthog' };
    return { source: null, medium: null, campaign: null, basis: 'none' };
  };
  const accountTouch = { hubspot: 0, posthog: 0, none: 0 };
  const cohortDay = new Map();
  const projectDay = new Map();
  for (const p of people) {
    const created = DAY.test(p.created || '') ? p.created : null;
    const t = attributeOf(p);
    if (created && inMonth(created)) {
      accountTouch[t.basis] += 1;
      add(place(created, t.source, t.medium, t.campaign), 'accounts', 1);
      cohortDay.set(created, (cohortDay.get(created) || 0) + 1);
    }
    if (DAY.test(p.project || '') && inMonth(p.project) && (!created || p.project >= created)) {
      add(place(p.project, t.source, t.medium, t.campaign), 'projects', 1);
      projectDay.set(p.project, (projectDay.get(p.project) || 0) + 1);
    }
  }
  const loginRows = metrics.filter((r) => r.source === 'posthog' && r.metric === 'ph_event' && r.dim_value === 'signed_in');
  const loginsReady = loginRows.length > 0;
  const loginWindow = loginsReady ? accWindow || windowFromSource(sourceOf('posthog')) : null;
  const loginDay = daySums(loginRows);
  const posthogOn = connected('posthog') || !!accHead || !!cohortHead;

  // A row inside a synced window without a value is a real zero; outside it stays null.
  for (const row of detail.values()) {
    if (row.paid) {
      const nets = [...row.nets].map((k) => netByKey.get(k));
      if (nets.some((n) => onDay(n, row.date))) { row.spend ??= 0; row.impressions ??= 0; }
      if (nets.some((n) => n.clicksReady && onDay(n, row.date))) row.clicks ??= 0;
    }
    if (gaReady && covers(gaWindow, row.date)) row.sessions ??= 0;
    if (hubspotOn && covers(hsWindow, row.date)) row.forms ??= 0;
    if (cohortReady && covers(cohortWindow, row.date)) { row.accounts ??= 0; row.projects ??= 0; }
  }
  const rows = [...detail.values()].map((r) => ({
    date: r.date, channel: r.channel, campaign: r.campaign, paid: r.paid, mediums: [...r.mediums].sort(),
    spend: r.spend, impressions: r.impressions, clicks: r.clicks, sessions: r.sessions, forms: r.forms, accounts: r.accounts, projects: r.projects,
    metrics: derive(r, r.sessions, r.forms, r.accounts),
  })).sort((a, b) => b.date.localeCompare(a.date) || (b.paid - a.paid) || ((b.spend || 0) - (a.spend || 0)) || ((b.sessions || 0) - (a.sessions || 0)) || a.channel.localeCompare(b.channel));

  // ---------- daily totals
  const paidByDay = new Map();
  for (const r of rows) {
    if (!r.paid) continue;
    const p = paidByDay.get(r.date) || { sessions: null, forms: null, accounts: null };
    for (const f of ['sessions', 'forms', 'accounts']) if (r[f] != null) p[f] = (p[f] || 0) + r[f];
    paidByDay.set(r.date, p);
  }
  const days = daysBetween(from, to).map((date) => {
    const netsOn = loadedNets.filter((n) => onDay(n, date));
    const clickNets = netsOn.filter((n) => n.clicksReady);
    const sumOf = (list, field) => (list.length ? list.reduce((s, n) => s + (n[field].get(date) || 0), 0) : null);
    const t = {
      date, partial: date === today,
      spend: sumOf(netsOn, 'spendBy'), impressions: sumOf(netsOn, 'imprBy'), clicks: sumOf(clickNets, 'clickBy'),
      sessions: gaReady && (covers(gaWindow, date) || gaDay.has(date)) ? gaDay.get(date) || 0 : null,
      forms: hubspotOn && (covers(hsWindow, date) || formDay.has(date)) ? formDay.get(date) || 0 : null,
      accounts: accReady && covers(accWindow, date) ? accDay.get(date) || 0 : null,
      accountsCohort: cohortReady && covers(cohortWindow, date) ? cohortDay.get(date) || 0 : null,
      logins: loginsReady && (covers(loginWindow, date) || loginDay.has(date)) ? loginDay.get(date) || 0 : null,
      projects: cohortReady && covers(cohortWindow, date) ? projectDay.get(date) || 0 : null,
    };
    const paid = paidByDay.get(date) || { sessions: null, forms: null, accounts: null };
    const sessionsPaid = t.spend != null && t.sessions != null ? paid.sessions || 0 : paid.sessions;
    const formsPaid = t.spend != null && t.forms != null ? paid.forms || 0 : paid.forms;
    const accountsPaid = t.spend != null && t.accountsCohort != null ? paid.accounts || 0 : paid.accounts;
    const m = derive(t, sessionsPaid, formsPaid, accountsPaid);
    m.costPerAccountBlended = t.spend != null && t.accounts > 0 ? t.spend / t.accounts : null;
    return { ...t, paidMatched: { sessions: sessionsPaid, forms: formsPaid, accounts: accountsPaid }, metrics: m };
  });

  // ---------- stage status
  const missingNets = networks.filter((n) => n.status !== 'loaded').map((n) => n.name);
  const missingSpendNets = networks.filter((n) => n.status !== 'loaded' && n.tracksSpend !== false).map((n) => n.name);
  const adStatus = loadedNets.length ? 'loaded' : networks.some((n) => n.status === 'no_data') ? 'no_data' : 'not_connected';
  const spendReason = missingSpendNets.length ? `Known spend only: ${missingSpendNets.join(', ')} not included.` : null;
  const adReason = missingNets.length ? `Not included: ${missingNets.join(', ')}.` : null;
  const adBasis = loadedNets.map((n) => `${n.name}: ${n.basis}`).join(' · ') || '—';
  const clickReady = loadedNets.filter((n) => n.clicksReady);
  const clickReason = [adReason, ...loadedNets.filter((n) => !n.clicksReady).map((n) => n.reason)].filter(Boolean).join(' ') || null;
  const stage = (id, name, source, status, reason, basis, window) => ({ id, name, source, status, reason: reason || null, basis, window: window || null });
  const posthogBasis = 'PostHog project time zone (HogQL toDate on the event timestamp)';
  const stages = [
    stage('spend', 'Spend', 'Meta Ads · Google Ads', adStatus, spendReason, adBasis),
    stage('impressions', 'Impressions', 'Meta Ads · Google Ads · LinkedIn Ads', adStatus, adReason, adBasis),
    stage('clicks', 'Clicks', 'Meta outbound clicks · Google Ads clicks', clickReady.length ? 'loaded' : adStatus === 'loaded' ? 'no_data' : adStatus, clickReason, adBasis),
    stage('sessions', 'Landing sessions', 'GA4 · go.think4ever.com · session source / medium / campaign', gaStatus, gaReason, 'GA4 property time zone', gaWindow),
    stage('forms', 'Forms / sign-ups (HubSpot)', 'HubSpot form submissions · external contacts · UTM properties', hubspotOn ? 'loaded' : 'not_connected',
      hubspotOn ? (hsWindow ? null : 'HubSpot has no synced window; days without forms show No data.') : 'HubSpot is not connected.', 'UTC day of the HubSpot contact createdate (not re-bucketed to Bogota)', hsWindow),
    stage('accounts', 'Accounts created', 'PostHog · first $identify · External · all hosts', accReady ? 'loaded' : posthogOn ? 'no_data' : 'not_connected',
      accReady ? (cohortReady ? (cohortCov.truncated ? 'The identity cohort reached its row limit; the campaign split is incomplete.' : null) : 'Campaign split unavailable: the PostHog identity cohort is not synced.')
        : (accCov && accCov.reason) || 'PostHog first-identify coverage is unavailable.', posthogBasis, accWindow),
    stage('logins', 'Logins', 'PostHog · signed_in', loginsReady ? 'loaded' : 'not_connected',
      loginsReady ? 'Event count, not people: returning accounts are included and internal accounts are not separated. No campaign split.' : 'No signed_in event is synced from PostHog.', posthogBasis, loginWindow),
    stage('projects', 'Projects created', 'PostHog · first project_created per person (identity cohort)', cohortReady ? 'loaded' : posthogOn ? 'no_data' : 'not_connected',
      cohortReady ? 'Counted on the project day; only people whose account is in the cohort window.' : (cohortCov && cohortCov.reason) || 'The PostHog identity cohort is not synced.', posthogBasis, cohortWindow),
  ];

  return {
    ...base,
    status: 'loaded',
    stages,
    networks: networks.map((n) => ({ key: n.key, name: n.name, status: n.status, reason: n.reason || null, basis: n.basis, window: n.window, clicks: n.clicksReady })),
    attribution: { forms: formTouch, accounts: accountTouch },
    days,
    rows,
    notes: missingNets.length ? [...NOTES, `Not included in impressions or clicks: ${missingNets.join(', ')}.${spendReason ? ` ${spendReason}` : ''}`] : NOTES,
  };
}

module.exports = { build, monthOk, bogotaDay, TZ, NO_CAMPAIGN, NO_SOURCE };

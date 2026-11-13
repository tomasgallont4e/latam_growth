'use strict';
// Server-side connectors. Each one runs only when its service variables exist, pulls the window
// LAUNCH_DATE..today and returns a load in the ingest format. Credentials live in the service
// variables (never in files or in the database). Emails are reduced to their domain.
const crypto = require('crypto');
const paid = require('../public/js/paid');

const LAUNCH = process.env.LAUNCH_DATE || '2026-10-01';
// One internal/test rule for every source (think4ever, moadbus, t4e by default): lib/internal.js.
const internal = require('./internal');
// Only these hosts are measured (landing, portal and main site). Editable through SITE_HOSTS
// without touching code. Values are reduced to bare host names and validated, so they are safe
// to embed in GA4 filters and HogQL.
const DEFAULT_SITE_HOSTS = ['think4ever.com', 'www.think4ever.com', 'go.think4ever.com', 'portal.think4ever.com'];
const parsedHosts = String(process.env.SITE_HOSTS || '').split(',')
  .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:?#].*$/, ''))
  .filter((h) => /^[a-z0-9.-]{1,253}$/.test(h));
const SITE_HOSTS = parsedHosts.length ? [...new Set(parsedHosts)] : DEFAULT_SITE_HOSTS;
// Executive PostHog account attribution follows the allowlist in the approved spec.
// Cell/preview hosts stay unclassified until Product confirms them explicitly.
const DEFAULT_POSTHOG_EXECUTIVE_HOSTS = ['portal.think4ever.com', 'think4ever.com', 'www.think4ever.com'];
const parsedExecutiveHosts = String(process.env.POSTHOG_EXECUTIVE_HOSTS || '').split(',')
  .map((h) => h.trim().toLowerCase())
  .filter((h) => /^[a-z0-9.-]{1,253}$/.test(h));
const POSTHOG_EXECUTIVE_HOSTS = [...new Set([...parsedExecutiveHosts, ...DEFAULT_POSTHOG_EXECUTIVE_HOSTS])];
// Host of a URL ('' when it is empty or not a URL). Accepts URLs without a scheme.
const hostOf = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase(); } catch { return ''; }
};
const onSite = (u) => SITE_HOSTS.includes(hostOf(u));
const today = () => new Date().toISOString().slice(0, 10);
const compact = (d) => d.replace(/-/g, '');
// Pseudonymous identity key shared by HubSpot and PostHog: HMAC-SHA256 of the normalized
// email with IDENTITY_HMAC_KEY. Only the hash leaves memory; the email is never stored.
const identityHash = (email) => {
  const key = process.env.IDENTITY_HMAC_KEY;
  const value = String(email || '').trim().toLowerCase();
  if (!key || !value || !value.includes('@')) return '';
  return crypto.createHmac('sha256', key).update(value).digest('hex').slice(0, 32);
};
// ingest keeps at most 1000 rows per snapshot, so long tables are split into numbered keys
// (key_1, key_2, ...). The un-numbered key carries the coverage row.
const SNAPSHOT_CHUNK = 1000, SNAPSHOT_MAX_CHUNKS = 20;
function chunkSnapshots(key, from, to, rows, note) {
  const out = [];
  for (let i = 0; i < rows.length && out.length < SNAPSHOT_MAX_CHUNKS; i += SNAPSHOT_CHUNK) {
    out.push({ key: `${key}_${out.length + 1}`, from, to, note, rows: rows.slice(i, i + SNAPSHOT_CHUNK) });
  }
  return out;
}

async function http(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

// Last good Clarity export (in memory only), used to stay under Clarity's daily API limit.
const clarityCache = { at: 0, data: null };
const CLARITY_URL = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
// Each call returns every metric. The two breakdowns are what the Social and Paid
// section needs beyond the totals: errors per app, and channel / campaign / page.
const CLARITY_CALLS = [
  { key: 'live_insights', query: 'numOfDays=3' },
  { key: 'by_browser', query: 'numOfDays=3&dimension1=Browser' },
  { key: 'by_acquisition', query: 'numOfDays=3&dimension1=Channel&dimension2=Campaign&dimension3=URL' },
];
const CLARITY_KEEP = {
  by_browser: new Set(['Traffic', 'ScrollDepth', 'ScriptErrorCount', 'DeadClickCount', 'EngagementTime', 'RageClickCount']),
  by_acquisition: new Set(['Traffic', 'ScrollDepth', 'ScriptErrorCount', 'DeadClickCount']),
};
// Three requests per refresh, and sync runs every few hours, so the floor is 20 hours
// (10 requests per project per day). A higher CLARITY_CACHE_HOURS still waits longer.
function clarityTtlMs() {
  const hours = Number(process.env.CLARITY_CACHE_HOURS);
  const configured = Number.isFinite(hours) && hours >= 0 ? hours : 3;
  return Math.max(configured, 20) * 36e5;
}
function flattenClarity(res, key) {
  const keep = CLARITY_KEEP[key];
  const rows = [];
  for (const m of Array.isArray(res) ? res : []) {
    if (keep && !keep.has(m.metricName)) continue;
    for (const info of m.information || []) rows.push({ metric: m.metricName, ...info });
  }
  return rows;
}
// A failed call keeps the previous snapshot for that key, so a later ingest
// does not delete the last good breakdown.
function assembleClarity(from, to, results, previous) {
  const snapshots = [];
  for (const call of CLARITY_CALLS) {
    const got = (results || []).find((r) => r.key === call.key && Array.isArray(r.rows));
    if (got) snapshots.push({ key: call.key, from, to, rows: got.rows });
    else {
      const kept = (previous || []).find((s) => s.key === call.key);
      if (kept) snapshots.push({ key: call.key, from: kept.from, to: kept.to, rows: kept.rows || [] });
    }
  }
  return snapshots;
}

const SRC_LABEL = { direct: 'Direct', email: 'Email', other: 'Other campaigns', paid: 'Paid search', 'paid-social': 'Paid social', referrals: 'Referrals', social: 'Organic social', organic: 'Organic search', offline: 'Offline' };

const connectors = {
  async hubspot() {
    const H = { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' };
    const from = LAUNCH, to = today();
    // These custom contact properties are optional. Configure the list only
    // after the fields have been created in HubSpot; requesting a property that
    // does not exist makes the CRM search fail.
    const utmProperties = String(process.env.HUBSPOT_UTM_PROPERTIES || '')
      .split(',').map((v) => v.trim()).filter((v) => /^[a-zA-Z0-9_]{1,100}$/.test(v));
    const daily = await http(`https://api.hubapi.com/analytics/v2/reports/sources/daily?start=${compact(from)}&end=${compact(to)}`, { headers: H });
    const metrics = [];
    for (const [date, rows] of Object.entries(daily)) {
      for (const x of Array.isArray(rows) ? rows : []) {
        if (!x.breakdown) continue;
        const dim_value = SRC_LABEL[x.breakdown] || x.breakdown;
        for (const [metric, key] of [['sessions', 'visits'], ['new_visitors', 'visitors'], ['pageviews', 'rawViews'], ['bounces', 'bounces'], ['contacts', 'contacts']]) {
          if (x[key]) metrics.push({ metric, date, dim: 'source', dim_value, value: x[key] });
        }
      }
    }
    const baseProps = [
      'email', 'createdate', 'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
      'hs_latest_source', 'hs_latest_source_data_1', 'hs_latest_source_data_2',
      'ip_country', 'country', 'recent_conversion_event_name',
      'company', 'firstname', 'lastname',
      'hs_analytics_first_url', 'hs_analytics_last_url',
    ];
    const search = async (props) => {
    const events = [];
    let after;
    do {
      const body = {
        filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(Date.parse(from + 'T05:00:00Z')) }] }],
        properties: [...new Set(props)],
        limit: 100, after,
      };
      const res = await http('https://api.hubapi.com/crm/v3/objects/contacts/search', { method: 'POST', headers: H, body: JSON.stringify(body) });
      for (const c of res.results || []) {
        const p = c.properties || {};
        // Sign-ups count only when the contact's first visit, last visit or landing_page
        // was on one of SITE_HOSTS (landing or portal).
        const siteUrl = [p.hs_analytics_first_url, p.hs_analytics_last_url, p.landing_page].find(onSite);
        if (!siteUrl) continue;
        const domain = String(p.email || '').split('@')[1] || '';
        const isInternal = internal.isInternal({ email: p.email, company: p.company, name: [p.firstname, p.lastname].filter(Boolean).join(' ') });
        events.push({
          id: String(c.id || ''),
          site_host: hostOf(siteUrl),
          kind: 'form_signup',
          date: String(p.createdate || '').slice(0, 10),
          form: String(p.recent_conversion_event_name || '').split(': ').pop(),
          channel: SRC_LABEL[String(p.hs_analytics_source || '').toLowerCase().replace('_', '-')] || p.hs_analytics_source || '',
          country: p.country || p.ip_country || '',
          internal: isInternal,
          domain_type: isInternal ? 'internal' : domain ? 'external' : 'unknown',
          // These values are present when the landing writes the documented
          // hidden HubSpot fields and their names are set in HUBSPOT_UTM_PROPERTIES.
          utm_source: p.utm_source || '', utm_medium: p.utm_medium || '', utm_campaign: p.utm_campaign || '',
          utm_content: p.utm_content || '', utm_term: p.utm_term || '', landing_page: p.landing_page || '',
          // First-touch values (hidden fields first_utm_*): the dashboard prefers them for attribution.
          first_utm_source: p.first_utm_source || '', first_utm_medium: p.first_utm_medium || '',
          first_utm_campaign: p.first_utm_campaign || '', first_utm_content: p.first_utm_content || '',
          original_source: p.hs_analytics_source || '', original_source_detail: p.hs_analytics_source_data_1 || '',
          latest_source: p.hs_latest_source || '', latest_source_detail: p.hs_latest_source_data_1 || '',
          // Campaign funnel join key with PostHog (only when IDENTITY_HMAC_KEY exists).
          ...(identityHash(p.email) ? { email_hmac: identityHash(p.email) } : {}),
        });
      }
      after = res.paging && res.paging.next && res.paging.next.after;
    } while (after);
    return events;
    };
    // A property listed in HUBSPOT_UTM_PROPERTIES that does not exist in HubSpot makes the search
    // fail. Retry once without the custom properties so the sign-up count keeps flowing.
    let events;
    let utmRead = utmProperties.includes('utm_source') && utmProperties.includes('utm_medium');
    try {
      events = await search([...baseProps, ...utmProperties]);
    } catch (e) {
      if (!utmProperties.length) throw e;
      console.warn('hubspot: contact search failed with HUBSPOT_UTM_PROPERTIES; retrying without them. Check that every listed property exists in HubSpot:', e.message);
      events = await search(baseProps);
      utmRead = false;
    }
    // The traffic report above has no domain filter in HubSpot's API: it covers the whole site.
    return { source: 'hubspot', from, to, metrics, events, snapshots: [{ key: 'utm_capture', from, to, rows: [{ available: utmRead }] }], status: { state: 'connected', note: 'Tráfico: todo el sitio (sin filtro de dominio)' } };
  },

  async ga4() {
    const sa = JSON.parse(process.env.GA4_SERVICE_ACCOUNT);
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
    const tok = await http('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${sig}`,
    });
    const from = LAUNCH, to = today();
    // Every report is limited to SITE_HOSTS (landing, portal and main site).
    const hostFilter = { filter: { fieldName: 'hostName', inListFilter: { values: SITE_HOSTS, caseSensitive: false } } };
    const run = (body) => http(`https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateRanges: [{ startDate: from, endDate: to }], limit: 10000, dimensionFilter: hostFilter, ...body }),
    });
    const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const addDays = (isoDate, n) => { const d = new Date(`${isoDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const metrics = [];
    const executiveSnapshots = [];
    // Sessions are additive across channels. totalUsers and newUsers are not: a person
    // in two channels is counted twice, and newUsers with a session channel can exceed sessions.
    const ch = await run({ dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }] });
    for (const r of ch.rows || []) {
      const [date, channel] = r.dimensionValues.map((v) => v.value);
      ['ga_sessions', 'ga_engaged_sessions'].forEach((m, i) => metrics.push({ metric: m, date: iso(date), dim: 'channel', dim_value: channel, value: Number(r.metricValues[i].value) }));
    }
    // Site-wide daily users. newUsers is one person on the day of their first visit, so a
    // later sum across days is the period total. totalUsers is only a per-day figure.
    try {
      const dailyUsers = await run({ dimensions: [{ name: 'date' }], metrics: [{ name: 'totalUsers' }, { name: 'newUsers' }] });
      for (const r of dailyUsers.rows || []) {
        const date = iso(r.dimensionValues[0].value);
        const [users, newUsers] = r.metricValues.map((v) => Number(v.value || 0));
        metrics.push({ metric: 'ga_users', date, value: users }, { metric: 'ga_new_users', date, value: newUsers });
      }
    } catch (e) {
      console.warn('ga4 daily users report skipped:', e.message);
    }
    const ev = await run({ dimensions: [{ name: 'date' }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }] });
    for (const r of ev.rows || []) {
      const [date, name] = r.dimensionValues.map((v) => v.value);
      metrics.push({ metric: 'ga_event', date: iso(date), dim: 'event', dim_value: name, value: Number(r.metricValues[0].value) });
    }
    const co = await run({ dimensions: [{ name: 'country' }], metrics: [{ name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'keyEvents' }] });
    // The executive dashboard needs daily country rows, not only the aggregate
    // country snapshot above. Keep this separate from the global daily report so
    // a country selector never has to infer a user's country from a global total.
    let geo = { rows: [] };
    try {
      geo = await run({
        dimensions: [{ name: 'date' }, { name: 'country' }],
        metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
      });
    } catch (e) {
      console.warn('ga4 daily country report skipped:', e.message);
    }
    for (const r of geo.rows || []) {
      const [date, country] = r.dimensionValues.map((v) => v.value);
      const [users, sessions, engaged, keyEvents] = r.metricValues.map((v) => Number(v.value || 0));
      metrics.push(
        { metric: 'ga_geo_users', date: iso(date), dim: 'country', dim_value: country, value: users },
        { metric: 'ga_geo_sessions', date: iso(date), dim: 'country', dim_value: country, value: sessions },
        { metric: 'ga_geo_engaged_sessions', date: iso(date), dim: 'country', dim_value: country, value: engaged },
        { metric: 'ga_geo_key_events', date: iso(date), dim: 'country', dim_value: country, value: keyEvents },
      );
    }
    // Executive v1 uses only the confirmed LATAM landing host. Keep this separate
    // from shared GA4 rows, whose hostName filter intentionally covers SITE_HOSTS.
    try {
      const goGeo = await run({
        dimensionFilter: { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: 'go.think4ever.com', caseSensitive: false } } },
        dimensions: [{ name: 'date' }, { name: 'country' }],
        metrics: [{ name: 'sessions' }],
      });
      const goRows = goGeo.rows || [];
      for (const r of goRows) {
        const [date, country] = r.dimensionValues.map((v) => v.value);
        metrics.push({ metric: 'ga_exec_geo_sessions', date: iso(date), dim: 'country', dim_value: country || '(not set)', value: Number(r.metricValues[0].value || 0) });
      }
      // Form starts stay on their own go-host report. A failure here must not
      // blank the landing-session coverage or the shared ga_event series.
      let formStartAvailable = false;
      let formStartReason = '';
      try {
        const goForm = await run({
          dimensionFilter: { andGroup: { expressions: [
            { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: 'go.think4ever.com', caseSensitive: false } } },
            { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'form_start' } } },
          ] } },
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'eventCount' }],
        });
        formStartAvailable = true;
        for (const r of goForm.rows || []) {
          const date = r.dimensionValues[0] && r.dimensionValues[0].value;
          if (!date) continue;
          metrics.push({ metric: 'ga_exec_form_starts', date: iso(date), value: Number(r.metricValues[0].value || 0) });
        }
      } catch (e) {
        console.warn('ga4 executive go-host form_start report skipped:', e.message);
        formStartReason = 'Sign-up form starts are not available for go.think4ever.com.';
      }
      executiveSnapshots.push({ key: 'executive_landing', from, to, rows: [{
        available: true, host: 'go.think4ever.com',
        country_available: goRows.some((r) => { const country = r.dimensionValues[1] && r.dimensionValues[1].value; return country && country !== '(not set)'; }),
        form_start_available: formStartAvailable,
        ...(formStartReason ? { form_start_reason: formStartReason } : {}),
      }] });
    } catch (e) {
      console.warn('ga4 executive go-host report skipped:', e.message);
      executiveSnapshots.push({ key: 'executive_landing', from, to, rows: [{ available: false, host: 'go.think4ever.com', country_available: false, form_start_available: false }] });
    }
    // Campaign funnel: go-host sessions by UTM source, medium, campaign and content.
    // Separate and guarded: a failure only marks this table unavailable.
    const utmLandingSnapshots = [];
    try {
      const goHostFilter = { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: 'go.think4ever.com', caseSensitive: false } } };
      const utmDims = ['date', 'sessionManualSource', 'sessionManualMedium', 'sessionManualCampaignName', 'sessionManualAdContent'];
      const utmRows = [];
      const maxRows = SNAPSHOT_CHUNK * SNAPSHOT_MAX_CHUNKS;
      let offset = 0;
      let report;
      do {
        report = await run({
          dimensionFilter: goHostFilter,
          dimensions: utmDims.map((name) => ({ name })),
          metrics: [{ name: 'sessions' }], limit: 10000, offset,
          orderBys: utmDims.map((dimensionName) => ({ dimension: { dimensionName } })),
        });
        for (const r of report.rows || []) {
          const [date, source, medium, campaign, content] = r.dimensionValues.map((v) => v.value || '(not set)');
          utmRows.push({ date: iso(date), source, medium, campaign, content, sessions: Number(r.metricValues[0].value || 0) });
        }
        const length = (report.rows || []).length;
        if (!length && offset < Number(report.rowCount || 0)) throw new Error('Incomplete go-host UTM report');
        offset += length;
      } while (offset < Number(report.rowCount || 0) && offset < maxRows);
      const chunks = chunkSnapshots('executive_landing_utm', from, to, utmRows, 'go.think4ever.com sessions by UTM source, medium, campaign and content.');
      utmLandingSnapshots.push({ key: 'executive_landing_utm', from, to, rows: [{
        available: true, host: 'go.think4ever.com', rows: utmRows.length, chunks: chunks.length,
        truncated: offset < Number(report.rowCount || 0) || utmRows.length > maxRows,
      }] }, ...chunks);
    } catch (e) {
      console.warn('ga4 executive go-host UTM report skipped:', e.message);
      utmLandingSnapshots.push({ key: 'executive_landing_utm', from, to, rows: [{ available: false, host: 'go.think4ever.com', reason: 'GA4 go-host UTM report failed.' }] });
    }
    // Deduped user totals cannot be rebuilt by adding days. Store one snapshot for
    // launch through today, plus the fixed windows below. The dashboard groups
    // launch through today in the browser, so those windows are only a fallback.
    const totalNames = ['totalUsers', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate', 'screenPageViews', 'eventCount', 'keyEvents'];
    const totalsSnapshot = async (start, end) => {
      const tot = await run({ dateRanges: [{ startDate: start, endDate: end }], metrics: totalNames.map((name) => ({ name })) });
      const t = (tot.rows && tot.rows[0] && tot.rows[0].metricValues.map((v) => Number(v.value))) || [];
      return { key: 'totals', from: start, to: end, rows: [{ users: t[0] || 0, new_users: t[1] || 0, sessions: t[2] || 0, engaged_sessions: t[3] || 0, engagement_rate: t[4] || 0, pageviews: t[5] || 0, events: t[6] || 0, key_events: t[7] || 0, subject_to_thresholding: !!(tot.metadata && tot.metadata.subjectToThresholding), user_counts_inconsistent: (t[1] || 0) > (t[0] || 0) }] };
    };
    const windows = new Map([[`${from}|${to}`, [from, to]]]);
    for (const n of [7, 14, 28, 30]) {
      const start = addDays(to, -(n - 1));
      const prevEnd = addDays(start, -1);
      windows.set(`${start}|${to}`, [start, to]);
      windows.set(`${addDays(prevEnd, -(n - 1))}|${prevEnd}`, [addDays(prevEnd, -(n - 1)), prevEnd]);
    }
    const totalSnaps = [];
    for (const [start, end] of windows.values()) {
      if (start === from && end === to) {
        totalSnaps.push(await totalsSnapshot(start, end));
        continue;
      }
      try { totalSnaps.push(await totalsSnapshot(start, end)); }
      catch (e) { console.warn(`ga4 totals ${start}..${end} skipped:`, e.message); }
    }
    // Landing people: deduplicated GA4 users on go.think4ever.com. totalUsers is not additive,
    // so each window (launch to date, last/previous 7 and 28 days) is its own query.
    const landingPeople = [];
    const goOnly = { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: 'go.think4ever.com', caseSensitive: false } } };
    const peopleWindows = new Map([[`${from}|${to}`, [from, to]]]);
    for (const n of [7, 28]) {
      const start = addDays(to, -(n - 1)), prevEnd = addDays(start, -1);
      peopleWindows.set(`${start}|${to}`, [start, to]);
      peopleWindows.set(`${addDays(prevEnd, -(n - 1))}|${prevEnd}`, [addDays(prevEnd, -(n - 1)), prevEnd]);
    }
    for (const [start, end] of peopleWindows.values()) {
      try {
        const r = await run({ dateRanges: [{ startDate: start, endDate: end }], dimensionFilter: goOnly, metrics: [{ name: 'totalUsers' }, { name: 'newUsers' }] });
        const v = (r.rows && r.rows[0] && r.rows[0].metricValues.map((m) => Number(m.value || 0))) || [0, 0];
        landingPeople.push({ key: 'landing_people', from: start, to: end, rows: [{ available: true, host: 'go.think4ever.com', users: v[0], new_users: v[1], subject_to_thresholding: !!(r.metadata && r.metadata.subjectToThresholding) }] });
      } catch (e) {
        console.warn(`ga4 landing people ${start}..${end} skipped:`, e.message);
        landingPeople.push({ key: 'landing_people', from: start, to: end, rows: [{ available: false, host: 'go.think4ever.com', reason: 'GA4 go-host users query failed.' }] });
      }
    }
    // UTM attribution is deliberately a separate report: detailed dimensions
    // can have more rows than the headline reports, and a compatibility issue
    // must never prevent the normal GA4 sync from completing.
    let attributionRows = [];
    try {
      const attr = await run({
        dimensions: [
          { name: 'date' }, { name: 'sessionManualSource' }, { name: 'sessionManualMedium' },
          { name: 'sessionManualCampaignName' }, { name: 'sessionManualAdContent' },
          { name: 'landingPagePlusQueryString' }, { name: 'city' },
        ],
        metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
        limit: 1000,
      });
      attributionRows = (attr.rows || []).map((r) => {
        const [date, source, medium, campaign, content, landing_page, city] = r.dimensionValues.map((v) => v.value || '(not set)');
        const [sessions, engaged_sessions, key_events] = r.metricValues.map((v) => Number(v.value || 0));
        return { date: iso(date), source, medium, campaign, content, landing_page, city, sessions, engaged_sessions, key_events };
      });
    } catch (e) {
      console.warn('ga4 UTM attribution report skipped:', e.message);
    }
    // Acquisition costs need an additive daily source/medium report, not the
    // capped city/page detail snapshot. Never mark a failed report as zero.
    const paidSnapshots = [];
    try {
      const paidMetrics = [];
      let offset = 0;
      let report;
      do {
        report = await run({
          dimensions: ['date', 'sessionManualSource', 'sessionManualMedium'].map((name) => ({ name })),
          metrics: [{ name: 'sessions' }], limit: 10000, offset,
          orderBys: ['date', 'sessionManualSource', 'sessionManualMedium'].map((dimensionName) => ({ dimension: { dimensionName } })),
        });
        for (const row of report.rows || []) {
          const [date, source, medium] = row.dimensionValues.map((v) => v.value);
          const platform = paid.platform(source, medium);
          if (platform) paidMetrics.push({ metric: 'ga_paid_sessions', date: iso(date), dim: 'platform', dim_value: platform, value: Number(row.metricValues[0].value || 0) });
        }
        const length = (report.rows || []).length;
        if (!length && offset < Number(report.rowCount || 0)) throw new Error('Incomplete paid session report');
        offset += length;
      } while (offset < Number(report.rowCount || 0));
      // More than one source alias/medium can map to a platform. Combine rows
      // before ingest's per-day/platform upsert, otherwise the last wins.
      const totals = new Map();
      for (const row of paidMetrics) {
        const key = `${row.date}|${row.dim_value}`;
        if (totals.has(key)) totals.get(key).value += row.value;
        else totals.set(key, row);
      }
      metrics.push(...totals.values());
      paidSnapshots.push({ key: 'paid_sessions', from, to, rows: [{ available: true }], note: 'Daily paid UTM sessions by platform; excludes qa and organic media.' });
    } catch (e) { console.warn('ga4 paid session report skipped:', e.message); }
    return {
      source: 'ga4', from, to, metrics,
      snapshots: [
        { key: 'countries', from, to, rows: (co.rows || []).map((r) => ({ country: r.dimensionValues[0].value, users: +r.metricValues[0].value, engaged_sessions: +r.metricValues[1].value, key_events: +r.metricValues[2].value })) },
        ...executiveSnapshots,
        ...utmLandingSnapshots,
        ...totalSnaps,
        ...landingPeople,
        ...paidSnapshots,
        { key: 'utm_attribution', from, to, note: 'GA4 sessions by UTM, landing page and city. (not set) means the visit arrived without that value.', rows: attributionRows },
      ],
    };
  },

  async posthog() {
    const host = process.env.POSTHOG_HOST.replace(/\/$/, '');
    const q = (sql, filters) => http(`${host}/api/projects/${process.env.POSTHOG_PROJECT_ID}/query/`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql, ...(filters ? { filters } : {}) } }),
    });
    const from = LAUNCH, to = today();
    const metrics = [];
    // This is the authoritative product event Product must emit from the
    // backend. Unlike the Action below, it confirms a project was created.
    const configuredEvent = String(process.env.POSTHOG_PROJECT_CREATED_EVENT || 'project_created');
    // Product outcome queries must remain gated until identity, project unit and history coverage are verified.
    const projectEvent = /^[A-Za-z0-9_.$:-]{1,120}$/.test(configuredEvent) ? configuredEvent : 'project_created';
    // Domain filter: events on SITE_HOSTS. Backend events carry no $host (they come from the
    // portal), so an empty host is kept. People count only with a real visit on SITE_HOSTS.
    const hostList = SITE_HOSTS.map((h) => `'${h}'`).join(', ');
    const hostExpr = `lower(coalesce(toString(properties.$host), ''))`;
    const onSiteSql = `(${hostExpr} IN (${hostList}) OR ${hostExpr} = '')`;
    // New people are read from their events on SITE_HOSTS (person.* fields, one count per person).
    // PostHog rejects a persons query with an events subquery, so this avoids that join.
    const siteEvents = `timestamp >= toDate('${from}') AND ${hostExpr} IN (${hostList}) AND person.created_at >= toDate('${from}')`;
    const emailExpr = `lower(coalesce(toString(person.properties.email), ''))`;
    const companyExpr = `lower(coalesce(toString(person.properties.company), ''))`;
    const nameExpr = `lower(coalesce(toString(person.properties.name), ''))`;
    const internalSql = internal.hogql({ email: emailExpr, company: companyExpr, name: nameExpr });
    const accountType = `CASE WHEN ${internalSql} THEN 'Internal' WHEN ${emailExpr} != '' OR ${companyExpr} != '' THEN 'External' ELSE 'Unknown' END`;
    const notInternal = `NOT ${internalSql}`;
    // registration_started is the funnel step before account creation; it is not the dashboard's sign-up total.
    // Count the first registration start per person since launch and aggregate country separately.
    let registrationReady = false;
    let registrationStale = null;
    try {
      const reg = await q(`SELECT toString(toDate(first_at)) AS d, account_type, country, count() AS n FROM (SELECT person_id, min(timestamp) AS first_at, argMin(${accountType}, tuple(timestamp, uuid)) AS account_type, argMin(coalesce(nullIf(toString(person.properties.country), ''), nullIf(toString(person.properties.$geoip_country), ''), ''), tuple(timestamp, uuid)) AS country FROM events WHERE event = 'registration_started' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND (${onSiteSql} OR endsWith(${hostExpr}, '.portal.think4ever.com')) AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters} GROUP BY person_id) GROUP BY d, account_type, country ORDER BY d`,
        { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } });
      const daily = new Map(), geo = new Map();
      for (const [d, type, country, n] of reg.results || []) {
        const dailyKey = `${d}|${type}`;
        daily.set(dailyKey, { metric: 'ph_signups', date: d, dim: 'account_type', dim_value: type, value: (daily.get(dailyKey)?.value || 0) + Number(n) });
        if (country) {
          const metric = type === 'Internal' ? 'ph_signups_geo_internal' : 'ph_signups_geo', key = `${metric}|${d}|${country}`;
          geo.set(key, { metric, date: d, dim: 'country', dim_value: country, value: (geo.get(key)?.value || 0) + Number(n) });
        }
      }
      metrics.push(...daily.values(), ...geo.values()); registrationReady = true;
    } catch (e) {
      console.warn('posthog registration report skipped:', e.message);
      // A PostHog timeout must not erase the last good result on ingest: re-emit the stored
      // registration rows and mark the coverage stale. Without a previous good pull, nothing is invented.
      try {
        const store = require('./store');
        const prev = (await store.list('snapshot'))
          .filter((s) => s && s.source === 'posthog' && s.key === 'registration_coverage' && s.rows && s.rows[0] && s.rows[0].available === true)
          .sort((a, b) => String(b.pulled_at || b._at || '').localeCompare(String(a.pulled_at || a._at || '')))[0];
        if (prev) {
          const keep = new Set(['ph_signups', 'ph_signups_geo', 'ph_signups_geo_internal']);
          const rows = (await store.list('metric'))
            .filter((r) => r && r.source === 'posthog' && keep.has(r.metric))
            .map((r) => ({ metric: r.metric, date: r.date, dim: r.dim, dim_value: r.dim_value, value: Number(r.value) || 0 }));
          metrics.push(...rows);
          registrationReady = true;
          registrationStale = {
            stale: true,
            last_good_pulled_at: prev.rows[0].last_good_pulled_at || prev.pulled_at || prev._at || null,
            stale_reason: `PostHog registration query failed (${String(e.message || '').slice(0, 120)}); showing the last good result.`,
          };
        }
      } catch (fallbackError) { console.warn('posthog registration last-good fallback skipped:', fallbackError.message); }
    }
    // Account creation = the person's FIRST account_created or $identify, whichever comes first, one count
    // per person. account_created is the backend event (sent since 2026-10-29); the one-click sign-up creates
    // accounts that never send $identify, so counting identify alone missed them (12 of 22 accounts on
    // Nov 10-13). People created before launch are excluded, so a returning user is never counted twice.
    // Country comes from the person's first $identify only: account_created is sent by the server, whose
    // GeoIP is the server's location, so an account without identify has no country (never a wrong one).
    // registration_started stays above as the funnel step before the account.
    let accountsReady = false;
    let accountGeo = new Map();
    try {
      const acc = await q(`SELECT toString(toDate(first_at)) AS d, account_type, country, count() AS n FROM (SELECT person_id,
          min(timestamp) AS first_at,
          argMin(${accountType}, tuple(timestamp, uuid)) AS account_type,
          argMinIf(coalesce(nullIf(toString(properties.$geoip_country_name), ''), nullIf(toString(properties.$geoip_country), ''), nullIf(toString(person.properties.country), ''), nullIf(toString(person.properties.$geoip_country), ''), ''), tuple(timestamp, uuid), event = '$identify') AS country
        FROM events WHERE event IN ('$identify', 'account_created') AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
          AND person.created_at >= toDate('${from}') AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1')
        GROUP BY person_id) GROUP BY d, account_type, country ORDER BY d`);
      const accDaily = new Map(); accountGeo = new Map();
      for (const [d, type, country, n] of acc.results || []) {
        const dailyKey = `${d}|${type}`;
        accDaily.set(dailyKey, { metric: 'ph_accounts', date: d, dim: 'account_type', dim_value: type, value: (accDaily.get(dailyKey)?.value || 0) + Number(n) });
        if (country) {
          const metric = type === 'Internal' ? 'ph_accounts_geo_internal' : 'ph_accounts_geo', key = `${metric}|${d}|${country}`;
          accountGeo.set(key, { metric, date: d, dim: 'country', dim_value: country, value: (accountGeo.get(key)?.value || 0) + Number(n) });
        }
      }
      metrics.push(...accDaily.values(), ...accountGeo.values()); accountsReady = true;
    } catch (e) { console.warn('posthog accounts (first account_created or identify) report skipped:', e.message); }
    // Canonical product outcomes. $identify remains a separate identity signal.
    const accountEvent = 'account_created';
    // Event identity, unit semantics and start date are not verified by Product yet.
    // Keep these outcomes unavailable until the event contract and dedupe key are certified.
    const outcomeSnapshots = [
      { key: 'accounts_created_coverage', from, to, rows: [{ available: false, event: accountEvent, unit: 'account', reason: 'Waiting for verified account_created identity, uniqueness and coverage contract.' }] },
      { key: 'projects_created_coverage', from, to, rows: [{ available: false, event: projectEvent, unit: 'project', reason: 'Waiting for verified project_created event unit and coverage contract.' }] },
      { key: 'executive_outcomes', from, to, rows: [{ available: false, accountOutcome: true, projectOutcome: true }] },
    ];
    // Executive accounts are separate from the shared ph_accounts metric: use the
    // country GeoIP on each person's earliest identify event and only certify
    // hosts in the PDF allowlist. Cell/hostless accounts are surfaced as excluded
    // aggregates until Product classifies them; no IDs or profile data are stored.
    let executiveAccountsReady = false;
    let executiveAccountsReason = '';
    let executivePlanReady = false;
    let executivePlanReason = '';
    let executivePlanAttempted = false;
    const executivePlanCounts = { free: 0, paid: 0, other: 0, unknown: 0 };
    let executiveExternalAccounts = 0;
    const executiveTotalByDate = new Map(), executiveGeoByDate = new Map(), excludedExecutiveHosts = new Map();
    try {
      const executiveAcc = await q(`SELECT toString(toDate(first_at)) AS d, account_type, country, first_host, count() AS n FROM (
        SELECT person_id, min(timestamp) AS first_at,
          argMin(${accountType}, tuple(timestamp, uuid)) AS account_type,
          argMin(coalesce(nullIf(toString(properties.$geoip_country_name), ''), ''), tuple(timestamp, uuid)) AS country,
          argMin(${hostExpr}, tuple(timestamp, uuid)) AS first_host
        FROM events
        WHERE event = '$identify' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
          AND person.created_at >= toDate('${from}')
          AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters}
        GROUP BY person_id
      ) GROUP BY d, account_type, country, first_host ORDER BY d LIMIT 5001`,
      { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } });
      const executiveRows = Array.isArray(executiveAcc.results) ? executiveAcc.results : [];
      if (executiveAcc.hasMore === true || executiveRows.length >= 5000) {
        executiveAccountsReason = 'Executive first-identify query reached its result safety limit; the report is incomplete.';
      } else {
        for (const [d, type, countryValue, hostValue, rawCount] of executiveRows) {
          if (String(type || '').toLowerCase() !== 'external') continue;
          const count = Number(rawCount);
          if (!Number.isFinite(count) || count <= 0) continue;
          const hostName = String(hostValue || '').toLowerCase();
          if (!POSTHOG_EXECUTIVE_HOSTS.includes(hostName)) {
            const key = hostName || '(not set)';
            excludedExecutiveHosts.set(key, (excludedExecutiveHosts.get(key) || 0) + count);
            continue;
          }
          executiveTotalByDate.set(d, (executiveTotalByDate.get(d) || 0) + count);
          const country = String(countryValue || '').trim();
          if (!country || country.toLowerCase() === '(not set)') continue;
          const key = `${d}|${country}`;
          executiveGeoByDate.set(key, (executiveGeoByDate.get(key) || 0) + count);
        }
        executiveExternalAccounts = [...executiveTotalByDate.values()].reduce((sum, value) => sum + value, 0);
        for (const [date, value] of executiveTotalByDate) metrics.push({ metric: 'ph_exec_accounts', date, dim: 'account_type', dim_value: 'External', value });
        for (const [key, value] of executiveGeoByDate) {
          const [date, country] = key.split('|');
          metrics.push({ metric: 'ph_exec_accounts_geo', date, dim: 'country', dim_value: country, value });
        }
        executiveAccountsReady = true;
      }
    } catch (e) {
      executiveAccountsReason = 'Executive first-identify query failed; the report is unavailable.';
      console.warn('posthog Executive account report skipped:', e.message);
    }
    // Plan events show the last plan reported by the portal, not authoritative billing status.
    // Keep the plan field configurable; don't assume that event payloads carry a current plan.
    const planProperty = String(process.env.POSTHOG_PLAN_PROPERTY || '').trim();
    if (planProperty && /^[A-Za-z0-9_]{1,80}$/.test(planProperty) && executiveAccountsReady) try {
      executivePlanAttempted = true;
      const executiveHostList = POSTHOG_EXECUTIVE_HOSTS.map((name) => `'${name}'`).join(', ');
      const planSql = `SELECT plan, count() AS n FROM (
        SELECT person_id, argMaxIf(nullIf(lower(toString(properties.${planProperty})), ''), tuple(timestamp, uuid), nullIf(toString(properties.${planProperty}), '') IS NOT NULL) AS plan
        FROM events WHERE event IN ('signed_in','plan_changed')
          AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
          AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1')
          AND person.created_at >= toDate('${from}') AND {filters}
          AND lower(${accountType}) = 'external'
          AND person_id IN (SELECT person_id FROM events
            WHERE event = '$identify' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
              AND person.created_at >= toDate('${from}') AND ${hostExpr} IN (${executiveHostList})
              AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters}
            GROUP BY person_id)
        GROUP BY person_id
      ) GROUP BY plan ORDER BY plan`;
      const report = await q(planSql, { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } });
      const values = { free: 0, paid: 0, other: 0, unknown: 0 };
      for (const [rawPlan, rawCount] of report.results || []) {
        const plan = String(rawPlan || '').trim().toLowerCase();
        const count = Number(rawCount);
        if (!Number.isFinite(count) || count < 0) continue;
        if (plan === 'free' || plan === 'paid') values[plan] += count;
        else if (!plan || plan === '(not set)') values.unknown += count;
        else values.other += count;
      }
      const reportedPlanAccounts = Object.values(values).reduce((sum, count) => sum + count, 0);
      if (reportedPlanAccounts > executiveExternalAccounts) {
        throw new Error('Plan-event cohort exceeds approved-host account coverage.');
      }
      executivePlanCounts.free = values.free;
      executivePlanCounts.paid = values.paid;
      executivePlanCounts.other = values.other;
      // Accounts without signed_in/plan_changed events have no current observation;
      // count them as unknown, never as free.
      executivePlanCounts.unknown = executiveExternalAccounts - values.free - values.paid - values.other;
      executivePlanReady = true;
    } catch (e) {
      executivePlanReason = 'Could not read the last reported plan for approved-host accounts.';
      console.warn('posthog plan report skipped:', e.message);
    }
    const ev = await q(`SELECT toString(toDate(timestamp)) AS d, event, count() AS n FROM events WHERE timestamp >= toDate('${from}') AND event NOT LIKE '$%' AND (${onSiteSql} OR event = '${projectEvent}') GROUP BY d, event ORDER BY d LIMIT 5000`);
    for (const [d, event, n] of ev.results || []) metrics.push({ metric: 'ph_event', date: d, dim: 'event', dim_value: event, value: n });
    const pv = await q(`SELECT toString(toDate(timestamp)) AS d, ${accountType} AS account_type, count(DISTINCT person_id) AS n FROM events WHERE timestamp >= toDate('${from}') AND ${onSiteSql} GROUP BY d, account_type ORDER BY d`);
    for (const [d, type, n] of pv.results || []) metrics.push({ metric: 'ph_active_users', date: d, dim: 'account_type', dim_value: type, value: n });
    const np = await q(`SELECT toString(toDate(person.created_at)) AS d, ${accountType} AS account_type, count(DISTINCT person_id) AS n FROM events WHERE ${siteEvents} GROUP BY d, account_type ORDER BY d`);
    for (const [d, type, n] of np.results || []) metrics.push({ metric: 'ph_new_persons', date: d, dim: 'account_type', dim_value: type, value: n });
    let geoReady = false;
    // Per-country sign-ups, ready for when the PostHog GeoIP enrichment (or a country property
    // sent by the product) exists. Wrapped: without the enrichment the property is null and the
    // query returns no rows, so the sync is unaffected.
    // The product's own 'country' person property wins; PostHog GeoIP is the fallback.
    try {
      const geo = await q(`SELECT coalesce(nullIf(toString(person.properties.country), ''), nullIf(toString(person.properties.$geoip_country), '')) AS c, toString(toDate(person.created_at)) AS d, ${accountType} AS account_type, count(DISTINCT person_id) AS n FROM events WHERE ${siteEvents} GROUP BY c, d, account_type HAVING c IS NOT NULL ORDER BY d LIMIT 2000`);
      const totals = new Map();
      for (const [c, d, type, n] of geo.results || []) if (c) {
        const metric = type === 'Internal' ? 'ph_new_persons_geo_internal' : 'ph_new_persons_geo';
        const key = `${metric}|${c}|${d}`;
        if (totals.has(key)) totals.get(key).value += Number(n);
        else totals.set(key, { metric, date: d, dim: 'country', dim_value: c, value: Number(n) });
      }
      metrics.push(...totals.values()); geoReady = true;
    } catch (e) { console.warn('posthog country report skipped:', e.message); }
    // New people by first-touch UTM (sent by the portal in posthog.identify; the web SDK's
    // $initial_utm_* is the fallback). Optional: a failure leaves the rest of the sync intact.
    let signupAttribution = null;
    try {
      const u = (k) => `coalesce(nullIf(toString(person.properties.${k}), ''), nullIf(toString(person.properties.$initial_${k}), ''), '(not set)')`;
      const sa = await q(`SELECT toString(toDate(person.created_at)) AS d, ${u('utm_source')} AS source, ${u('utm_medium')} AS medium, ${u('utm_campaign')} AS campaign, ${u('utm_content')} AS content, ${accountType} AS account_type, count(DISTINCT person_id) AS n FROM events WHERE ${siteEvents} GROUP BY d, source, medium, campaign, content, account_type ORDER BY d LIMIT 2000`);
      signupAttribution = (sa.results || []).map(([date, source, medium, campaign, content, type, n]) => ({ date, source, medium, campaign, content, account_type: type, people: Number(n) }));
    } catch (e) { console.warn('posthog sign-up attribution report skipped:', e.message); }

    // Temporary activation proxy: the PostHog Action owns the UI matching
    // rules (currently "Proyecto creado (clic)"). Count each person on their
    // first matching action within the dashboard period. The Action remains a
    // click does not confirm that a project was created server-side.
    const actionId = Number(process.env.POSTHOG_ACTIVATION_ACTION_ID || 407660);
    let activationReady = false;
    if (Number.isInteger(actionId) && actionId > 0) try {
      // This dashboard is a launch-period readout. Searching every event since
      // 2020 merely to find a person's lifetime first click can time out on a
      // large PostHog project. Restrict the Action scan to LAUNCH_DATE..today.
      const activated = await q(
        `SELECT toString(toDate(first_at)) AS d, count() AS n FROM (SELECT person_id, min(timestamp) AS first_at FROM events WHERE timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND matchesAction(${actionId}) AND ${onSiteSql} AND ${notInternal} AND {filters} GROUP BY person_id) GROUP BY d ORDER BY d`,
        { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } },
      );
      for (const [d, n] of activated.results || []) metrics.push({ metric: 'ph_activated_users', date: d, dim: 'action', dim_value: String(actionId), value: n });
      activationReady = true;
    } catch (e) {
      // Do not discard all PostHog metrics if this optional click proxy is slow.
      console.warn('posthog activation Action report skipped:', e.message);
    }
    // project_created (projectEvent, defined above) is never domain-filtered.
    let projectAttribution = [];
    // Property-level aggregation is expensive in HogQL. Do not run it against
    // a project that has not yet deployed the real backend event.
    if (process.env.POSTHOG_PROJECT_CREATED_ENABLED === '1') try {
      const projects = await q(`SELECT
          toString(toDate(timestamp)) AS d,
          coalesce(nullIf(toString(properties.utm_source), ''), '(not set)') AS source,
          coalesce(nullIf(toString(properties.utm_medium), ''), '(not set)') AS medium,
          coalesce(nullIf(toString(properties.utm_campaign), ''), '(not set)') AS campaign,
          coalesce(nullIf(toString(properties.utm_content), ''), '(not set)') AS content,
          coalesce(nullIf(toString(properties.landing_page), ''), '(not set)') AS landing_page,
          count() AS projects_created,
          count(DISTINCT person_id) AS people
        FROM events
        WHERE event = '${projectEvent}' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
        GROUP BY d, source, medium, campaign, content, landing_page
        ORDER BY d LIMIT 1000`);
      projectAttribution = (projects.results || []).map(([date, source, medium, campaign, content, landing_page, projects_created, people]) => ({
        date, source, medium, campaign, content, landing_page, projects_created: Number(projects_created), people: Number(people),
      }));
      for (const r of projectAttribution) metrics.push({ metric: 'ph_projects_created', date: r.date, dim: 'campaign', dim_value: r.campaign, value: r.projects_created });
    } catch (e) {
      console.warn('posthog project attribution report skipped:', e.message);
    }
    // Campaign funnel identity cohort (needs IDENTITY_HMAC_KEY): one compact row per external
    // person first identified on an approved host since launch, with the first account_verified
    // and project event dates plus first-touch UTMs. Emails are hashed in memory; neither emails
    // nor person ids are stored.
    const cohortSnapshots = [];
    if (process.env.IDENTITY_HMAC_KEY) {
      try {
        const u = (k) => `coalesce(nullIf(toString(person.properties.${k}), ''), nullIf(toString(person.properties.$initial_${k}), ''), '(not set)')`;
        const cohort = await q(`SELECT
            toString(toDate(minIf(timestamp, event = '$identify'))) AS created,
            toString(toDate(minIf(timestamp, event = 'account_verified'))) AS verified,
            toString(toDate(minIf(timestamp, event = '${projectEvent}'))) AS project,
            countIf(event = '$identify') AS identifies,
            argMinIf(${hostExpr}, tuple(timestamp, uuid), event = '$identify') AS first_host,
            any(${accountType}) AS account_type,
            any(${emailExpr}) AS email,
            any(${u('utm_source')}) AS source,
            any(${u('utm_campaign')}) AS campaign,
            any(${u('utm_content')}) AS content
          FROM events
          WHERE event IN ('$identify', 'account_verified', '${projectEvent}')
            AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1)
            AND person.created_at >= toDate('${from}')
            AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters}
          GROUP BY person_id
          HAVING identifies > 0
          LIMIT 20001`, { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } });
        const results = Array.isArray(cohort.results) ? cohort.results : [];
        const truncated = cohort.hasMore === true || results.length > 20000;
        const validDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && String(v) >= from ? String(v) : null);
        const rows = [];
        for (const [created, verified, project, , firstHost, type, email, source, campaign, content] of results.slice(0, 20000)) {
          if (String(type || '').toLowerCase() !== 'external') continue;
          if (!POSTHOG_EXECUTIVE_HOSTS.includes(String(firstHost || '').toLowerCase())) continue;
          const createdDay = validDay(created);
          if (!createdDay) continue;
          rows.push({
            created: createdDay, verified: validDay(verified), project: validDay(project),
            id_hash: identityHash(email) || null,
            utm_source: source || '(not set)', utm_campaign: campaign || '(not set)', utm_content: content || '(not set)',
          });
        }
        const chunks = chunkSnapshots('identity_cohort', from, to, rows, 'External approved-host people: account, verification and first project dates. id_hash = HMAC of the email.');
        cohortSnapshots.push({ key: 'identity_cohort', from, to, rows: [{
          available: true, people: rows.length, hashed: rows.filter((r) => r.id_hash).length, chunks: chunks.length,
          truncated, verified_event: 'account_verified', project_event: projectEvent,
        }] }, ...chunks);
      } catch (e) {
        console.warn('posthog identity cohort report skipped:', e.message);
        cohortSnapshots.push({ key: 'identity_cohort', from, to, rows: [{ available: false, reason: 'PostHog identity cohort query failed.' }] });
      }
    } else {
      cohortSnapshots.push({ key: 'identity_cohort', from, to, rows: [{ available: false, reason: 'IDENTITY_HMAC_KEY is not configured.' }] });
    }
    // Product usage (handoff 6.4.20): one row per portal account, keyed inside PostHog by the
    // backend's portal_user_id. Only dates and an internal flag leave PostHog; no identifiers.
    // Days are America/Bogota calendar days; lib/productUsage.js derives every metric.
    const productSnapshots = [];
    const bogotaDay = `toString(toDate(toTimeZone(timestamp, 'America/Bogota')))`;
    const notQa = `coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1')`;
    try {
      const usage = await q(`SELECT created, first_project, signin_days, internal FROM (
          SELECT toString(properties.portal_user_id) AS uid,
            if(countIf(event = 'account_created') > 0, minIf(${bogotaDay}, event = 'account_created'), '') AS created,
            if(countIf(event = '${projectEvent}') > 0, minIf(${bogotaDay}, event = '${projectEvent}'), '') AS first_project,
            arraySort(groupUniqArrayIf(${bogotaDay}, event = 'signed_in')) AS signin_days,
            max(if(${internalSql}, 1, 0)) AS internal
          FROM events
          WHERE event IN ('account_created', '${projectEvent}', 'signed_in')
            AND timestamp >= toDate('${from}') AND ${notQa}
            AND toString(properties.portal_user_id) != ''
          GROUP BY uid
        ) LIMIT 20001`);
      const results = Array.isArray(usage.results) ? usage.results : [];
      const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && String(v) >= from ? String(v) : null);
      const rows = results.slice(0, 20000).map(([created, firstProject, days, isInternal]) => ({
        created: day(created), first_project: day(firstProject),
        signin_days: (Array.isArray(days) ? days : []).map(day).filter(Boolean),
        internal: Number(isInternal) === 1,
      }));
      const projects = await q(`SELECT ${bogotaDay} AS d, if(${internalSql}, 1, 0) AS internal, count(DISTINCT toString(properties.project_id)) AS n
        FROM events WHERE event = '${projectEvent}' AND timestamp >= toDate('${from}') AND ${notQa}
          AND toString(properties.project_id) != ''
        GROUP BY d, internal ORDER BY d LIMIT 5000`);
      productSnapshots.push(
        { key: 'product_usage', from, to, rows: [{
          available: true, accounts: rows.length, truncated: usage.hasMore === true || results.length > 20000,
          account_key: 'portal_user_id', timezone: 'America/Bogota', internal_patterns: internal.PATTERNS,
        }], note: 'One row per portal account: account_created day, first project day and signed_in days (America/Bogota). No identifiers stored.' },
        ...chunkSnapshots('product_usage', from, to, rows, 'Portal accounts: dates and internal flag only.'),
        { key: 'product_projects', from, to, rows: (projects.results || []).map(([d, isInternal, n]) => ({ date: String(d), internal: Number(isInternal) === 1, projects: Number(n) || 0 })), note: 'Distinct project_id per America/Bogota day.' },
      );
    } catch (e) {
      console.warn('posthog product usage report skipped:', e.message);
      productSnapshots.push({ key: 'product_usage', from, to, rows: [{ available: false, reason: 'PostHog product usage query failed.' }] });
    }
    const executiveCountryAssigned = [...executiveGeoByDate.values()].reduce((sum, value) => sum + value, 0);
    const excludedHostRows = [...excludedExecutiveHosts].map(([host, external_accounts]) => ({ host, external_accounts })).sort((a, b) => b.external_accounts - a.external_accounts);
    const executiveExcludedHostAccounts = excludedHostRows.reduce((sum, row) => sum + row.external_accounts, 0);
    const snapshots = [
      { key: 'account_coverage', from, to, rows: [{ available: accountsReady, event: 'account_created or $identify', unit: 'person', country_available: accountsReady && [...accountGeo.values()].some((row) => row.metric === 'ph_accounts_geo' && row.value > 0) }], note: 'Account created = first $identify per person since launch (person created on or after launch). Internal accounts are split by email domain and company.' },
      { key: 'executive_accounts', from, to, rows: [{
        available: executiveAccountsReady, event: '$identify', unit: 'external_person',
        country_available: executiveAccountsReady && executiveCountryAssigned > 0,
        external_accounts: executiveExternalAccounts, country_assigned: executiveCountryAssigned,
        country_missing: Math.max(0, executiveExternalAccounts - executiveCountryAssigned),
        allowed_hosts: POSTHOG_EXECUTIVE_HOSTS, excluded_host_accounts: executiveExcludedHostAccounts,
        excluded_hosts: excludedHostRows,
        ...(executiveAccountsReason ? { reason: executiveAccountsReason } : {}),
        ...(executiveExcludedHostAccounts ? { reason: 'Unclassified first-identify hosts are excluded from the certified Executive total.' } : {}),
        ...(!executiveAccountsReady && !executiveAccountsReason ? { reason: 'Executive first-identify query unavailable.' } : {}),
      }] },
      { key: 'executive_plan_accounts', from, to, rows: [{
        available: executivePlanReady,
        last_reported_plan: executivePlanCounts,
        semantics: 'last_observed_plan_from_signed_in_or_plan_changed_not_verified_billing_status',
        ...(executivePlanReason ? { reason: executivePlanReason } : {}),
        ...(!planProperty ? { reason: 'POSTHOG_PLAN_PROPERTY is not configured.' } : {}),
        ...(planProperty && !executivePlanAttempted && !executiveAccountsReady ? { reason: 'Approved-host account coverage is unavailable.' } : {}),
      }] },
      { key: 'registration_coverage', from, to, rows: [{ available: registrationReady, event: 'registration_started', unit: 'person', country_available: registrationReady, ...(registrationStale || {}) }], note: 'Sign-up = first registration_started per person since launch. qa_probe and project test accounts excluded; account_created is a separate downstream step.' },
      { key: 'people_coverage', from, to, rows: [{ available: true, classified: true, country_available: geoReady }], note: 'New observed people, not verified registrations. Unknown means no email/company classification.' },
      { key: 'activation_action', from, to, rows: [{ available: activationReady, action_id: actionId, internal_excluded: true }], note: 'First create-project click since launch, not confirmed creation or seven-day activation.' },
      {
      key: 'project_attribution', from, to,
      note: `Confirmed ${projectEvent} events by UTM. Rows appear after Product sends the event with these properties.`,
      rows: projectAttribution,
    }];
    snapshots.push(...cohortSnapshots);
    snapshots.push(...productSnapshots);
    if (signupAttribution) snapshots.push({ key: 'signup_attribution', from, to, note: 'New people by first-touch UTM and Internal/External/Unknown class; not verified sign-ups.', rows: signupAttribution });
    return { source: 'posthog', from, to, metrics, snapshots: [...snapshots, ...outcomeSnapshots] };
  },

  async meta() {
    const from = LAUNCH, to = today();
    const metrics = [];
    let url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v23.0'}/act_${process.env.META_AD_ACCOUNT_ID.replace(/^act_/, '')}/insights?level=campaign&time_increment=1&fields=campaign_name,spend,impressions,inline_link_clicks,clicks,actions&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}&limit=500&access_token=${encodeURIComponent(process.env.META_TOKEN)}`;
    while (url) {
      const res = await http(url);
      for (const r of res.data || []) {
        const dv = r.campaign_name || 'Campaign';
        metrics.push({ metric: 'ad_spend', date: r.date_start, dim: 'campaign', dim_value: dv, value: Number(r.spend || 0) });
        metrics.push({ metric: 'ad_impressions', date: r.date_start, dim: 'campaign', dim_value: dv, value: Number(r.impressions || 0) });
        // Link clicks may lead to destinations on or off Meta; only GA4 proves
        // an actual site session. Never substitute all-clicks for link clicks.
        const clicks = Number(r.inline_link_clicks || 0);
        metrics.push({ metric: 'ad_clicks', date: r.date_start, dim: 'campaign', dim_value: dv, value: clicks });
        metrics.push({ metric: 'ad_link_clicks', date: r.date_start, dim: 'campaign', dim_value: dv, value: clicks });
        metrics.push({ metric: 'ad_platform_clicks', date: r.date_start, dim: 'campaign', dim_value: dv, value: Number(r.clicks || 0) });
        const leads = (r.actions || []).filter((a) => /lead|complete_registration/.test(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
        if (leads) metrics.push({ metric: 'ad_results', date: r.date_start, dim: 'campaign', dim_value: dv, value: leads });
      }
      url = res.paging && res.paging.next;
    }
    // Country split for the per-country goals: the same insights with breakdowns=country, kept
    // under *_geo metric names (dim 'country') so the campaign totals above are never double counted.
    const geoMetrics = [];
    const ISO = { BR: 'Brazil', MX: 'Mexico', CO: 'Colombia', AR: 'Argentina', PE: 'Peru', CL: 'Chile', EC: 'Ecuador', DO: 'Dominican Republic', BO: 'Bolivia', PY: 'Paraguay', UY: 'Uruguay', US: 'United States', CA: 'Canada' };
    let gurl = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v23.0'}/act_${process.env.META_AD_ACCOUNT_ID.replace(/^act_/, '')}/insights?level=campaign&breakdowns=country&time_increment=1&fields=spend,impressions,inline_link_clicks,actions&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}&limit=500&access_token=${encodeURIComponent(process.env.META_TOKEN)}`;
    while (gurl) {
      const res = await http(gurl);
      for (const r of res.data || []) {
        const code = r.country || (r.breakdowns && r.breakdowns[0]) || '';
        const dv = ISO[code] || code || 'Unknown';
        geoMetrics.push({ metric: 'ad_spend_geo', date: r.date_start, dim: 'country', dim_value: dv, value: Number(r.spend || 0) });
        geoMetrics.push({ metric: 'ad_impressions_geo', date: r.date_start, dim: 'country', dim_value: dv, value: Number(r.impressions || 0) });
        geoMetrics.push({ metric: 'ad_clicks_geo', date: r.date_start, dim: 'country', dim_value: dv, value: Number(r.inline_link_clicks || 0) });
        const leads = (r.actions || []).filter((a) => /lead|complete_registration/.test(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
        if (leads) geoMetrics.push({ metric: 'ad_results_geo', date: r.date_start, dim: 'country', dim_value: dv, value: leads });
      }
      gurl = res.paging && res.paging.next;
    }
    // Country/date is an ingest key: combine all campaigns and pages first.
    const geoTotals = new Map();
    for (const row of geoMetrics) {
      const key = `${row.metric}|${row.date}|${row.dim_value}`;
      if (geoTotals.has(key)) geoTotals.get(key).value += row.value;
      else geoTotals.set(key, row);
    }
    metrics.push(...geoTotals.values());
    const base = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v23.0'}`;
    const snapshots = [];
    // Outbound clicks (clicks that leave Meta toward the landing) for the campaign funnel.
    // Separate and guarded: the campaign rows above never depend on this call.
    try {
      const outbound = new Map();
      let ourl = `${base}/act_${process.env.META_AD_ACCOUNT_ID.replace(/^act_/, '')}/insights?level=campaign&time_increment=1&fields=campaign_name,outbound_clicks&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}&limit=500&access_token=${encodeURIComponent(process.env.META_TOKEN)}`;
      while (ourl) {
        const res = await http(ourl);
        for (const r of res.data || []) {
          const dv = r.campaign_name || 'Campaign';
          const value = (Array.isArray(r.outbound_clicks) ? r.outbound_clicks : [])
            .filter((a) => a.action_type === 'outbound_click')
            .reduce((s, a) => s + Number(a.value || 0), 0);
          const key = `${r.date_start}|${dv}`;
          if (outbound.has(key)) outbound.get(key).value += value;
          else outbound.set(key, { metric: 'ad_outbound_clicks', date: r.date_start, dim: 'campaign', dim_value: dv, value });
        }
        ourl = res.paging && res.paging.next;
      }
      metrics.push(...outbound.values());
      snapshots.push({ key: 'outbound_coverage', from, to, rows: [{ available: true }] });
    } catch (e) {
      console.warn('meta outbound clicks report skipped:', e.message);
      snapshots.push({ key: 'outbound_coverage', from, to, rows: [{ available: false, reason: 'Meta outbound clicks report failed.' }] });
    }
    // Organic views of the brand's Facebook page and Instagram account (campaign funnel).
    // Optional: runs only with META_PAGE_ID / META_IG_USER_ID; a failure never affects the
    // ad rows above. Page views reported by Meta can include views of promoted posts.
    const pageToken = process.env.META_PAGE_TOKEN || process.env.META_TOKEN;
    const shiftDay = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const insightWindows = (days) => {
      const out = [];
      let start = from;
      while (start <= to) {
        const candidate = shiftDay(start, days - 1);
        const end = candidate < to ? candidate : to;
        out.push([start, end]);
        start = shiftDay(end, 1);
      }
      return out;
    };
    const organicSeries = async (id, metric, days, platform) => {
      const byDate = new Map();
      for (const [since, until] of insightWindows(days)) {
        const res = await http(`${base}/${encodeURIComponent(id)}/insights?metric=${metric}&period=day&since=${since}&until=${shiftDay(until, 1)}&access_token=${encodeURIComponent(pageToken)}`);
        for (const series of res.data || []) {
          for (const v of series.values || []) {
            // Daily values end at midnight of the following day.
            const end = String(v.end_time || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
            const date = shiftDay(end, -1);
            if (date < from || date > to) continue;
            byDate.set(date, Number(v.value || 0));
          }
        }
      }
      return [...byDate].map(([date, value]) => ({ metric: 'organic_views', date, dim: 'platform', dim_value: platform, value }));
    };
    const organicCoverage = {};
    const pageId = String(process.env.META_PAGE_ID || '').trim();
    const igId = String(process.env.META_IG_USER_ID || '').trim();
    if (!pageId) {
      organicCoverage.facebook = { available: false, reason: 'META_PAGE_ID is not configured.' };
    } else {
      let pageRows = null;
      let lastError = '';
      for (const metric of ['page_media_view', 'page_impressions']) {
        try {
          pageRows = await organicSeries(pageId, metric, 90, 'Facebook');
          organicCoverage.facebook = { available: true, metric };
          break;
        } catch (e) { lastError = e.message; }
      }
      if (pageRows) metrics.push(...pageRows);
      else {
        console.warn('meta Facebook page views skipped:', lastError);
        organicCoverage.facebook = { available: false, reason: 'Facebook page insights request failed.' };
      }
    }
    if (!igId) {
      organicCoverage.instagram = { available: false, reason: 'META_IG_USER_ID is not configured.' };
    } else {
      try {
        metrics.push(...await organicSeries(igId, 'views', 30, 'Instagram'));
        organicCoverage.instagram = { available: true, metric: 'views' };
      } catch (e) {
        console.warn('meta Instagram views skipped:', e.message);
        organicCoverage.instagram = { available: false, reason: 'Instagram insights request failed.' };
      }
    }
    snapshots.push({ key: 'organic_coverage', from, to, rows: [organicCoverage] });
    return { source: 'meta', from, to, metrics, snapshots };
  },

  // LinkedIn page analytics through the Community Management API. Needs an app with that product approved by
  // LinkedIn and a token from a page admin (r_organization_social, rw_organization_admin). Tokens last 60 days, so the
  // refresh token is used when it exists.
  async linkedin() {
    let token = process.env.LINKEDIN_TOKEN;
    if (process.env.LINKEDIN_REFRESH_TOKEN) {
      const t = await http('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.LINKEDIN_REFRESH_TOKEN, client_id: process.env.LINKEDIN_CLIENT_ID || '', client_secret: process.env.LINKEDIN_CLIENT_SECRET || '' }).toString(),
      });
      token = t.access_token;
    }
    // Versions are monthly (YYYYMM) and each is supported for about a year: three months back is always valid.
    const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 3);
    const version = process.env.LINKEDIN_API_VERSION || `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const H = { Authorization: `Bearer ${token}`, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' };
    const org = `urn:li:organization:${process.env.LINKEDIN_ORG_ID || '129864039'}`;
    const enc = encodeURIComponent(org);
    const from = LAUNCH, to = today();
    const range = `timeIntervals=(timeRange:(start:${Date.parse(from + 'T00:00:00Z')},end:${Date.parse(to + 'T23:59:59Z')}),timeGranularityType:DAY)`;
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const metrics = [];
    const size = await http(`https://api.linkedin.com/rest/networkSizes/${enc}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { headers: H });
    if (size.firstDegreeSize != null) metrics.push({ metric: 'followers', date: to, value: size.firstDegreeSize });
    const fol = await http(`https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${enc}&${range}`, { headers: H });
    for (const e of fol.elements || []) {
      const g = e.followerGains || {};
      metrics.push({ metric: 'new_followers', date: day(e.timeRange.start), value: (g.organicFollowerGain || 0) + (g.paidFollowerGain || 0) });
    }
    const sh = await http(`https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc}&${range}`, { headers: H });
    for (const e of sh.elements || []) {
      const s = e.totalShareStatistics || {}, date = day(e.timeRange.start);
      for (const [metric, v] of [['post_impressions', s.impressionCount], ['post_clicks', s.clickCount], ['post_reactions', s.likeCount], ['post_comments', s.commentCount], ['post_reposts', s.shareCount]]) if (v) metrics.push({ metric, date, value: v });
    }
    const pv = await http(`https://api.linkedin.com/rest/organizationPageStatistics?q=organization&organization=${enc}&${range}`, { headers: H });
    for (const e of pv.elements || []) {
      const v = (((e.totalPageStatistics || {}).views || {}).allPageViews || {}).pageViews;
      if (v) metrics.push({ metric: 'page_views', date: day(e.timeRange.start), value: v });
    }
    // Recent posts with their own statistics (first line of the post only; no names of people who interacted).
    const posts = await http(`https://api.linkedin.com/rest/posts?q=author&author=${enc}&count=30&sortBy=LAST_MODIFIED`, { headers: { ...H, 'X-RestLi-Method': 'FINDER' } });
    const rows = (posts.elements || []).filter((p) => p.publishedAt && day(p.publishedAt) >= from)
      .map((p) => ({ id: p.id, date: day(p.publishedAt), title: Array.from(String(p.commentary || '').split('\n')[0]).slice(0, 90).join('').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '') }));
    for (const kind of ['shares', 'ugcPosts']) {
      const ids = rows.filter((r) => (r.id.startsWith('urn:li:share') ? 'shares' : 'ugcPosts') === kind).map((r) => encodeURIComponent(r.id));
      if (!ids.length) continue;
      const st = await http(`https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc}&${kind}=List(${ids.join(',')})`, { headers: H });
      for (const e of st.elements || []) {
        const r = rows.find((x) => x.id === (e.share || e.ugcPost)); const s = e.totalShareStatistics || {};
        if (r) Object.assign(r, { impressions: s.impressionCount, clicks: s.clickCount, ctr: s.impressionCount ? (s.clickCount || 0) / s.impressionCount : 0, reactions: s.likeCount, reposts: s.shareCount, engagement_rate: s.engagement });
      }
    }
    return { source: 'linkedin', from, to, metrics, snapshots: rows.length ? [{ key: 'posts', from, to, note: 'Posts on the Think4Ever Global page since the LATAM launch', rows: rows.map(({ id, ...r }) => r) }] : [] };
  },

  // Google Ads campaign results. Needs a developer token (from the manager account's API Center), an OAuth client and
  // a refresh token of a user with access to the ad account.
  async google_ads() {
    const tok = await http('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN, client_id: process.env.GOOGLE_ADS_CLIENT_ID, client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET }).toString(),
    });
    const cid = process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
    const H = { Authorization: `Bearer ${tok.access_token}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN, 'Content-Type': 'application/json' };
    if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) H['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, '');
    const from = LAUNCH, to = today();
    const query = `SELECT segments.date, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;
    const batches = await http(`https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || 'v21'}/customers/${cid}/googleAds:searchStream`, { method: 'POST', headers: H, body: JSON.stringify({ query }) });
    const metrics = [];
    for (const b of Array.isArray(batches) ? batches : [batches]) {
      for (const r of b.results || []) {
        const date = r.segments.date, dv = (r.campaign && r.campaign.name) || 'Campaign', m = r.metrics || {};
        metrics.push({ metric: 'ad_spend', date, dim: 'campaign', dim_value: dv, value: Number(m.costMicros || 0) / 1e6 });
        metrics.push({ metric: 'ad_impressions', date, dim: 'campaign', dim_value: dv, value: Number(m.impressions || 0) });
        metrics.push({ metric: 'ad_clicks', date, dim: 'campaign', dim_value: dv, value: Number(m.clicks || 0) });
        if (Number(m.conversions)) metrics.push({ metric: 'ad_results', date, dim: 'campaign', dim_value: dv, value: Number(m.conversions) });
      }
    }
    // Country split by the user's physical location (user_location_view), for the per-country
    // goals. Everything is wrapped: if the report fails, the sync keeps its campaign totals.
    // Rows go under *_geo names (dim 'country') to avoid double counting.
    try {
      const v = process.env.GOOGLE_ADS_API_VERSION || 'v21';
      const geoQuery = `SELECT segments.date, user_location_view.country_criterion_id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM user_location_view WHERE segments.date BETWEEN '${from}' AND '${to}'`;
      const geoBatches = await http(`https://googleads.googleapis.com/${v}/customers/${cid}/googleAds:searchStream`, { method: 'POST', headers: H, body: JSON.stringify({ query: geoQuery }) });
      // Google Ads country criterion ids (fixed by Google), so no name lookup calls are needed.
      const names = {
        2076: 'Brazil', 2484: 'Mexico', 2170: 'Colombia', 2032: 'Argentina', 2604: 'Peru', 2152: 'Chile', 2218: 'Ecuador',
        2214: 'Dominican Republic', 2068: 'Bolivia', 2600: 'Paraguay', 2858: 'Uruguay', 2840: 'United States', 2124: 'Canada',
      };
      // user_location_view can return several rows for the same country and day (one per campaign
      // and targeting flag), so they are summed before being emitted as one row per date+country.
      const agg = new Map();
      for (const b of Array.isArray(geoBatches) ? geoBatches : [geoBatches]) {
        for (const r of b.results || []) {
          const date = r.segments && r.segments.date, m2 = r.metrics || {};
          if (!date) continue;
          const raw = String((r.userLocationView && r.userLocationView.countryCriterionId) || '');
          const dv = names[raw] || raw || 'Unknown';
          const k = `${date}|${dv}`;
          const a = agg.get(k) || { date, dv, spend: 0, impressions: 0, clicks: 0, conversions: 0 };
          a.spend += Number(m2.costMicros || 0) / 1e6;
          a.impressions += Number(m2.impressions || 0);
          a.clicks += Number(m2.clicks || 0);
          a.conversions += Number(m2.conversions || 0);
          agg.set(k, a);
        }
      }
      for (const a of agg.values()) {
        metrics.push({ metric: 'ad_spend_geo', date: a.date, dim: 'country', dim_value: a.dv, value: a.spend });
        metrics.push({ metric: 'ad_impressions_geo', date: a.date, dim: 'country', dim_value: a.dv, value: a.impressions });
        metrics.push({ metric: 'ad_clicks_geo', date: a.date, dim: 'country', dim_value: a.dv, value: a.clicks });
        if (a.conversions) metrics.push({ metric: 'ad_results_geo', date: a.date, dim: 'country', dim_value: a.dv, value: a.conversions });
      }
    } catch (e) { console.warn('google ads country report skipped:', e.message); }
    return { source: 'google_ads', from, to, metrics, snapshots: [] };
  },

  async clarity() {
    // The export allows 10 requests a day and ignores the dashboard date picker.
    if (clarityCache.data && Date.now() - clarityCache.at < clarityTtlMs()) return clarityCache.data;
    const to = today();
    const from = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const headers = { Authorization: `Bearer ${process.env.CLARITY_TOKEN}` };
    const results = [];
    for (const call of CLARITY_CALLS) {
      try {
        const res = await http(`${CLARITY_URL}?${call.query}`, { headers });
        if (!Array.isArray(res)) throw new Error('clarity response was not a list');
        results.push({ key: call.key, rows: flattenClarity(res, call.key) });
      } catch (e) {
        console.warn(`clarity ${call.key} skipped:`, e.message);
        results.push({ key: call.key, error: e });
      }
    }
    let previous = (clarityCache.data && clarityCache.data.snapshots) || [];
    let snapshots = assembleClarity(from, to, results, previous);
    if (snapshots.length < CLARITY_CALLS.length) {
      try {
        const store = require('./store');
        const saved = await store.list('snapshot');
        const prior = [];
        for (const call of CLARITY_CALLS) {
          const hit = saved.filter((s) => s.source === 'clarity' && s.key === call.key)
            .sort((a, b) => String(b.pulled_at || '').localeCompare(String(a.pulled_at || '')))[0];
          if (hit) prior.push({ key: hit.key, from: hit.from, to: hit.to, rows: hit.rows || [] });
        }
        previous = previous.concat(prior);
        snapshots = assembleClarity(from, to, results, previous);
      } catch (e) { console.warn('clarity could not keep prior snapshots:', e.message); }
    }
    const baseline = results.find((r) => r.key === 'live_insights');
    if (!baseline || !baseline.rows) {
      if (clarityCache.data) {
        // A 429 still spends a request. Wait out the quota instead of retrying every sync.
        if (baseline && baseline.error && /^429\b/.test(String(baseline.error.message))) clarityCache.at = Date.now();
        console.warn('clarity baseline unavailable; using cached result from', new Date(clarityCache.at).toISOString());
        return clarityCache.data;
      }
      throw (baseline && baseline.error) || new Error('clarity live insights unavailable');
    }
    const data = { source: 'clarity', from, to, metrics: [], snapshots };
    clarityCache.data = data;
    clarityCache.at = Date.now();
    return data;
  },
};

const REQUIRED = {
  hubspot: ['HUBSPOT_TOKEN'], ga4: ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT'],
  posthog: ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY'], meta: ['META_TOKEN', 'META_AD_ACCOUNT_ID'], clarity: ['CLARITY_TOKEN'],
  linkedin: ['LINKEDIN_ORG_ID'],
  google_ads: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'],
};
// LinkedIn works with a token or with a refresh token plus the app's client id and secret.
const linkedinAuth = () => !!process.env.LINKEDIN_TOKEN || ['LINKEDIN_REFRESH_TOKEN', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'].every((v) => process.env[v]);
const configured = (key) => !!REQUIRED[key] && REQUIRED[key].every((v) => process.env[v]) && (key !== 'linkedin' || linkedinAuth());

module.exports = { connectors, configured, REQUIRED, SITE_HOSTS, CLARITY_CALLS, clarityTtlMs, flattenClarity, assembleClarity, identityHash, chunkSnapshots };

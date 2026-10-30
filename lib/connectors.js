'use strict';
// Server-side connectors. Each one runs only when its service variables exist, pulls the window
// LAUNCH_DATE..today and returns a load in the ingest format. Credentials live in the service
// variables (never in files or in the database). Emails are reduced to their domain.
const crypto = require('crypto');
const paid = require('../public/js/paid');

const LAUNCH = process.env.LAUNCH_DATE || '2026-10-01';
const INTERNAL = (process.env.INTERNAL_DOMAINS || 'think4ever.com').split(',').map((d) => d.trim().toLowerCase());
const INTERNAL_COMPANIES = (process.env.INTERNAL_COMPANIES || 'think4ever,moadbus').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9 .-]{2,100}$/.test(s));
// Only these hosts are measured (landing, portal and main site). Editable through SITE_HOSTS
// without touching code. Values are reduced to bare host names and validated, so they are safe
// to embed in GA4 filters and HogQL.
const DEFAULT_SITE_HOSTS = ['think4ever.com', 'www.think4ever.com', 'go.think4ever.com', 'portal.think4ever.com'];
const parsedHosts = String(process.env.SITE_HOSTS || '').split(',')
  .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:?#].*$/, ''))
  .filter((h) => /^[a-z0-9.-]{1,253}$/.test(h));
const SITE_HOSTS = parsedHosts.length ? [...new Set(parsedHosts)] : DEFAULT_SITE_HOSTS;
// Host of a URL ('' when it is empty or not a URL). Accepts URLs without a scheme.
const hostOf = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase(); } catch { return ''; }
};
const onSite = (u) => SITE_HOSTS.includes(hostOf(u));
const today = () => new Date().toISOString().slice(0, 10);
const compact = (d) => d.replace(/-/g, '');

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
      'company',
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
        const internal = INTERNAL.includes(domain.toLowerCase()) || INTERNAL_COMPANIES.some((name) => String(p.company || '').toLowerCase().includes(name));
        events.push({
          id: String(c.id || ''),
          site_host: hostOf(siteUrl),
          kind: 'form_signup',
          date: String(p.createdate || '').slice(0, 10),
          form: String(p.recent_conversion_event_name || '').split(': ').pop(),
          channel: SRC_LABEL[String(p.hs_analytics_source || '').toLowerCase().replace('_', '-')] || p.hs_analytics_source || '',
          country: p.country || p.ip_country || '',
          internal,
          domain_type: internal ? 'internal' : domain ? 'external' : 'unknown',
          // These values are present when the landing writes the documented
          // hidden HubSpot fields and their names are set in HUBSPOT_UTM_PROPERTIES.
          utm_source: p.utm_source || '', utm_medium: p.utm_medium || '', utm_campaign: p.utm_campaign || '',
          utm_content: p.utm_content || '', utm_term: p.utm_term || '', landing_page: p.landing_page || '',
          // First-touch values (hidden fields first_utm_*): the dashboard prefers them for attribution.
          first_utm_source: p.first_utm_source || '', first_utm_medium: p.first_utm_medium || '',
          first_utm_campaign: p.first_utm_campaign || '', first_utm_content: p.first_utm_content || '',
          original_source: p.hs_analytics_source || '', original_source_detail: p.hs_analytics_source_data_1 || '',
          latest_source: p.hs_latest_source || '', latest_source_detail: p.hs_latest_source_data_1 || '',
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
        ...totalSnaps,
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
    const internalRules = [
      ...INTERNAL.filter((d) => /^[a-z0-9.-]+$/.test(d)).map((d) => `endsWith(${emailExpr}, '@${d}')`),
      ...INTERNAL_COMPANIES.map((c) => `position(${companyExpr}, '${c}') > 0`),
    ];
    const internalSql = internalRules.length ? `(${internalRules.join(' OR ')})` : 'false';
    const accountType = `CASE WHEN ${internalSql} THEN 'Internal' WHEN ${emailExpr} != '' OR ${companyExpr} != '' THEN 'External' ELSE 'Unknown' END`;
    const notInternal = `NOT ${internalSql}`;
    // registration_started is the funnel step before account creation; it is not the dashboard's sign-up total.
    // Count the first registration start per person since launch and aggregate country separately.
    let registrationReady = false;
    try {
      const reg = await q(`SELECT toString(toDate(first_at)) AS d, account_type, country, count() AS n FROM (SELECT person_id, min(timestamp) AS first_at, ${accountType} AS account_type, coalesce(nullIf(toString(person.properties.country), ''), nullIf(toString(person.properties.$geoip_country), ''), '') AS country FROM events WHERE event = 'registration_started' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND (${onSiteSql} OR endsWith(${hostExpr}, '.portal.think4ever.com')) AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') AND {filters} GROUP BY person_id, account_type, country) GROUP BY d, account_type, country ORDER BY d`,
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
    } catch (e) { console.warn('posthog registration report skipped:', e.message); }
    // Account creation = the person's FIRST identify (the dashboard's sign-up definition). People
    // created before launch are excluded, so a returning user who identifies again is never counted twice.
    // registration_started stays above as the funnel step before the account.
    let accountsReady = false;
    try {
      const acc = await q(`SELECT toString(toDate(first_at)) AS d, account_type, country, count() AS n FROM (SELECT person_id, min(timestamp) AS first_at, ${accountType} AS account_type, coalesce(nullIf(toString(person.properties.country), ''), nullIf(toString(person.properties.$geoip_country), ''), '') AS country FROM events WHERE event = '$identify' AND timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND person.created_at >= toDate('${from}') AND coalesce(toString(properties.qa_probe), '') NOT IN ('true', '1') GROUP BY person_id, account_type, country) GROUP BY d, account_type, country ORDER BY d`);
      const accDaily = new Map(), accGeo = new Map();
      for (const [d, type, country, n] of acc.results || []) {
        const dailyKey = `${d}|${type}`;
        accDaily.set(dailyKey, { metric: 'ph_accounts', date: d, dim: 'account_type', dim_value: type, value: (accDaily.get(dailyKey)?.value || 0) + Number(n) });
        if (country) {
          const metric = type === 'Internal' ? 'ph_accounts_geo_internal' : 'ph_accounts_geo', key = `${metric}|${d}|${country}`;
          accGeo.set(key, { metric, date: d, dim: 'country', dim_value: country, value: (accGeo.get(key)?.value || 0) + Number(n) });
        }
      }
      metrics.push(...accDaily.values(), ...accGeo.values()); accountsReady = true;
    } catch (e) { console.warn('posthog accounts (first identify) report skipped:', e.message); }
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
    const snapshots = [
      { key: 'account_coverage', from, to, rows: [{ available: accountsReady, event: '$identify', unit: 'person', country_available: accountsReady }], note: 'Account created = first $identify per person since launch (person created on or after launch). Internal accounts are split by email domain and company.' },
      { key: 'registration_coverage', from, to, rows: [{ available: registrationReady, event: 'registration_started', unit: 'person', country_available: registrationReady }], note: 'Sign-up = first registration_started per person since launch. qa_probe and project test accounts excluded; account_created is a separate downstream step.' },
      { key: 'people_coverage', from, to, rows: [{ available: true, classified: true, country_available: geoReady }], note: 'New observed people, not verified registrations. Unknown means no email/company classification.' },
      { key: 'activation_action', from, to, rows: [{ available: activationReady, action_id: actionId, internal_excluded: true }], note: 'First create-project click since launch, not confirmed creation or seven-day activation.' },
      {
      key: 'project_attribution', from, to,
      note: `Confirmed ${projectEvent} events by UTM. Rows appear after Product sends the event with these properties.`,
      rows: projectAttribution,
    }];
    if (signupAttribution) snapshots.push({ key: 'signup_attribution', from, to, note: 'New people by first-touch UTM and Internal/External/Unknown class; not verified sign-ups.', rows: signupAttribution });
    return { source: 'posthog', from, to, metrics, snapshots };
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
    return { source: 'meta', from, to, metrics, snapshots: [] };
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

module.exports = { connectors, configured, REQUIRED, SITE_HOSTS, CLARITY_CALLS, clarityTtlMs, flattenClarity, assembleClarity };

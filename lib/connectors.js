'use strict';
// Server-side connectors. Each one runs only when its service variables exist, pulls the window
// LAUNCH_DATE..today and returns a load in the ingest format. Credentials live in the service
// variables (never in files or in the database). Emails are reduced to their domain.
const crypto = require('crypto');

const LAUNCH = process.env.LAUNCH_DATE || '2026-10-01';
const INTERNAL = (process.env.INTERNAL_DOMAINS || 'think4ever.com').split(',').map((d) => d.trim().toLowerCase());
const today = () => new Date().toISOString().slice(0, 10);
const compact = (d) => d.replace(/-/g, '');

async function http(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
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
    const events = [];
    let after;
    do {
      const body = {
        filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(Date.parse(from + 'T05:00:00Z')) }] }],
        properties: [...new Set([
          'email', 'createdate', 'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
          'hs_latest_source', 'hs_latest_source_data_1', 'hs_latest_source_data_2',
          'ip_country', 'country', 'recent_conversion_event_name', ...utmProperties,
        ])],
        limit: 100, after,
      };
      const res = await http('https://api.hubapi.com/crm/v3/objects/contacts/search', { method: 'POST', headers: H, body: JSON.stringify(body) });
      for (const c of res.results || []) {
        const p = c.properties || {};
        const domain = String(p.email || '').split('@')[1] || '';
        events.push({
          kind: 'form_signup',
          date: String(p.createdate || '').slice(0, 10),
          form: String(p.recent_conversion_event_name || '').split(': ').pop(),
          channel: SRC_LABEL[String(p.hs_analytics_source || '').toLowerCase().replace('_', '-')] || p.hs_analytics_source || '',
          country: p.country || p.ip_country || '',
          internal: INTERNAL.includes(domain.toLowerCase()),
          domain_type: !domain ? 'none' : INTERNAL.includes(domain.toLowerCase()) ? 'internal' : 'external',
          // These values are present when the landing writes the documented
          // hidden HubSpot fields and their names are set in HUBSPOT_UTM_PROPERTIES.
          utm_source: p.utm_source || '', utm_medium: p.utm_medium || '', utm_campaign: p.utm_campaign || '',
          utm_content: p.utm_content || '', utm_term: p.utm_term || '', landing_page: p.landing_page || '',
          original_source: p.hs_analytics_source || '', original_source_detail: p.hs_analytics_source_data_1 || '',
          latest_source: p.hs_latest_source || '', latest_source_detail: p.hs_latest_source_data_1 || '',
        });
      }
      after = res.paging && res.paging.next && res.paging.next.after;
    } while (after);
    return { source: 'hubspot', from, to, metrics, events, snapshots: [] };
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
    const run = (body) => http(`https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateRanges: [{ startDate: from, endDate: to }], limit: 10000, ...body }),
    });
    const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const metrics = [];
    const ch = await run({ dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'totalUsers' }] });
    for (const r of ch.rows || []) {
      const [date, channel] = r.dimensionValues.map((v) => v.value);
      ['ga_sessions', 'ga_engaged_sessions', 'ga_users'].forEach((m, i) => metrics.push({ metric: m, date: iso(date), dim: 'channel', dim_value: channel, value: Number(r.metricValues[i].value) }));
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
    const tot = await run({ metrics: ['totalUsers', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate', 'screenPageViews', 'eventCount', 'keyEvents'].map((name) => ({ name })) });
    const t = (tot.rows && tot.rows[0] && tot.rows[0].metricValues.map((v) => Number(v.value))) || [];
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
        metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'totalUsers' }, { name: 'keyEvents' }],
        limit: 1000,
      });
      attributionRows = (attr.rows || []).map((r) => {
        const [date, source, medium, campaign, content, landing_page, city] = r.dimensionValues.map((v) => v.value || '(not set)');
        const [sessions, engaged_sessions, users, key_events] = r.metricValues.map((v) => Number(v.value || 0));
        return { date: iso(date), source, medium, campaign, content, landing_page, city, sessions, engaged_sessions, users, key_events };
      });
    } catch (e) {
      console.warn('ga4 UTM attribution report skipped:', e.message);
    }
    return {
      source: 'ga4', from, to, metrics,
      snapshots: [
        { key: 'countries', from, to, rows: (co.rows || []).map((r) => ({ country: r.dimensionValues[0].value, users: +r.metricValues[0].value, engaged_sessions: +r.metricValues[1].value, key_events: +r.metricValues[2].value })) },
        { key: 'totals', from, to, rows: [{ users: t[0], new_users: t[1], sessions: t[2], engaged_sessions: t[3], engagement_rate: t[4], pageviews: t[5], events: t[6], key_events: t[7] }] },
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
    const ev = await q(`SELECT toString(toDate(timestamp)) AS d, event, count() AS n FROM events WHERE timestamp >= toDate('${from}') AND event NOT LIKE '$%' GROUP BY d, event ORDER BY d LIMIT 5000`);
    for (const [d, event, n] of ev.results || []) metrics.push({ metric: 'ph_event', date: d, dim: 'event', dim_value: event, value: n });
    const pv = await q(`SELECT toString(toDate(timestamp)) AS d, count(DISTINCT person_id) AS n FROM events WHERE timestamp >= toDate('${from}') GROUP BY d ORDER BY d`);
    for (const [d, n] of pv.results || []) metrics.push({ metric: 'ph_active_users', date: d, value: n });
    // Account creation = the person's first identify. With person profiles set to identified-only,
    // a person row is created at the first identify, so persons.created_at is the first-identify
    // date and each person counts once, however many times they sign in later (Google or email).
    // Split internal (think4ever.com) from external by email so the dashboard toggle works.
    const internalSql = INTERNAL.map((d) => `endsWith(lower(toString(properties.email)), '@${d.replace(/[^a-z0-9.-]/g, '')}')`).join(' OR ');
    const np = await q(`SELECT toString(toDate(created_at)) AS d, if(${internalSql}, 'Internal', 'External') AS k, count() AS n FROM persons WHERE created_at >= toDate('${from}') AND is_identified GROUP BY d, k ORDER BY d`)
      .catch(async () => q(`SELECT toString(toDate(created_at)) AS d, if(${internalSql}, 'Internal', 'External') AS k, count() AS n FROM persons WHERE created_at >= toDate('${from}') GROUP BY d, k ORDER BY d`));
    for (const [d, k, n] of np.results || []) metrics.push({ metric: 'ph_new_persons', date: d, dim: 'audience', dim_value: k, value: n });
    // Per-country sign-ups, ready for when the PostHog GeoIP enrichment (or a country property
    // sent by the product) exists. Wrapped: without the enrichment the property is null and the
    // query returns no rows, so the sync is unaffected.
    try {
      const geo = await q(`SELECT properties.$geoip_country AS c, toString(toDate(created_at)) AS d, count() AS n FROM persons WHERE created_at >= toDate('${from}') AND properties.$geoip_country IS NOT NULL AND NOT endsWith(properties.email, '@think4ever.com') GROUP BY c, d ORDER BY d LIMIT 2000`);
      for (const [c, d, n] of geo.results || []) metrics.push({ metric: 'ph_new_persons_geo', date: d, dim: 'country', dim_value: c, value: n });
    } catch (e) { console.warn('posthog country report skipped:', e.message); }

    // Temporary activation proxy: the PostHog Action owns the UI matching
    // rules (currently "Proyecto creado (clic)"). Count each person on their
    // first matching action within the dashboard period. The Action remains a
    // click does not confirm that a project was created server-side.
    const actionId = Number(process.env.POSTHOG_ACTIVATION_ACTION_ID || 407660);
    if (Number.isInteger(actionId) && actionId > 0) try {
      // This dashboard is a launch-period readout. Searching every event since
      // 2020 merely to find a person's lifetime first click can time out on a
      // large PostHog project. Restrict the Action scan to LAUNCH_DATE..today.
      const activated = await q(
        `SELECT toString(toDate(first_at)) AS d, count() AS n FROM (SELECT person_id, min(timestamp) AS first_at FROM events WHERE timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND matchesAction(${actionId}) AND {filters} GROUP BY person_id) GROUP BY d ORDER BY d`,
        { filterTestAccounts: true, dateRange: { date_from: from, date_to: to } },
      );
      for (const [d, n] of activated.results || []) metrics.push({ metric: 'ph_activated_users', date: d, dim: 'action', dim_value: String(actionId), value: n });
    } catch (e) {
      // Do not discard all PostHog metrics if this optional click proxy is slow.
      console.warn('posthog activation Action report skipped:', e.message);
    }
    // This is the authoritative product event Product must emit from the
    // backend. Unlike the Action above, it confirms a project was created.
    const configuredEvent = String(process.env.POSTHOG_PROJECT_CREATED_EVENT || 'project_created');
    const projectEvent = /^[A-Za-z0-9_.$:-]{1,120}$/.test(configuredEvent) ? configuredEvent : 'project_created';
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
    return { source: 'posthog', from, to, metrics, snapshots: [{
      key: 'project_attribution', from, to,
      note: `Confirmed ${projectEvent} events by UTM. Rows appear after Product sends the event with these properties.`,
      rows: projectAttribution,
    }] };
  },

  async meta() {
    const from = LAUNCH, to = today();
    const metrics = [];
    let url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v23.0'}/act_${process.env.META_AD_ACCOUNT_ID.replace(/^act_/, '')}/insights?level=campaign&time_increment=1&fields=campaign_name,spend,impressions,clicks,actions&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}&limit=500&access_token=${encodeURIComponent(process.env.META_TOKEN)}`;
    while (url) {
      const res = await http(url);
      for (const r of res.data || []) {
        const dv = r.campaign_name || 'Campaign';
        metrics.push({ metric: 'ad_spend', date: r.date_start, dim: 'campaign', dim_value: dv, value: Number(r.spend || 0) });
        metrics.push({ metric: 'ad_impressions', date: r.date_start, dim: 'campaign', dim_value: dv, value: Number(r.impressions || 0) });
        metrics.push({ metric: 'ad_clicks', date: r.date_start, dim: 'campaign', dim_value: dv, value: Number(r.clicks || 0) });
        const leads = (r.actions || []).filter((a) => /lead|complete_registration/.test(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
        if (leads) metrics.push({ metric: 'ad_results', date: r.date_start, dim: 'campaign', dim_value: dv, value: leads });
      }
      url = res.paging && res.paging.next;
    }
    // Country split for the per-country goals: the same insights with breakdowns=country, kept
    // under *_geo metric names (dim 'country') so the campaign totals above are never double counted.
    const ISO = { BR: 'Brazil', MX: 'Mexico', CO: 'Colombia', AR: 'Argentina', PE: 'Peru', CL: 'Chile', EC: 'Ecuador', DO: 'Dominican Republic', BO: 'Bolivia', PY: 'Paraguay', UY: 'Uruguay', US: 'United States', CA: 'Canada' };
    let gurl = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v23.0'}/act_${process.env.META_AD_ACCOUNT_ID.replace(/^act_/, '')}/insights?level=campaign&breakdowns=country&time_increment=1&fields=spend,impressions,clicks,actions&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}&limit=500&access_token=${encodeURIComponent(process.env.META_TOKEN)}`;
    while (gurl) {
      const res = await http(gurl);
      for (const r of res.data || []) {
        const code = (r.breakdowns && r.breakdowns[0]) || '';
        const dv = ISO[code] || code || 'Unknown';
        metrics.push({ metric: 'ad_spend_geo', date: r.date_start, dim: 'country', dim_value: dv, value: Number(r.spend || 0) });
        metrics.push({ metric: 'ad_impressions_geo', date: r.date_start, dim: 'country', dim_value: dv, value: Number(r.impressions || 0) });
        metrics.push({ metric: 'ad_clicks_geo', date: r.date_start, dim: 'country', dim_value: dv, value: Number(r.clicks || 0) });
        const leads = (r.actions || []).filter((a) => /lead|complete_registration/.test(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
        if (leads) metrics.push({ metric: 'ad_results_geo', date: r.date_start, dim: 'country', dim_value: dv, value: leads });
      }
      gurl = res.paging && res.paging.next;
    }
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
      .map((p) => ({ id: p.id, date: day(p.publishedAt), title: String(p.commentary || '').split('\n')[0].slice(0, 90) }));
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
    // Country split by the user's physical location (user_location_report), for the per-country
    // goals. Everything is wrapped: if the report or the geo-target name lookup fails, the sync
    // keeps its campaign totals. Rows go under *_geo names (dim 'country') to avoid double counting.
    try {
      const v = process.env.GOOGLE_ADS_API_VERSION || 'v21';
      const geoQuery = `SELECT segments.date, segments.geo_target_constant, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM user_location_report WHERE segments.date BETWEEN '${from}' AND '${to}'`;
      const geoBatches = await http(`https://googleads.googleapis.com/${v}/customers/${cid}/googleAds:searchStream`, { method: 'POST', headers: H, body: JSON.stringify({ query: geoQuery }) });
      const names = {};
      for (const name of ['Brazil', 'Mexico', 'Colombia', 'Argentina', 'Peru', 'Chile', 'Ecuador', 'Dominican Republic', 'Bolivia', 'Paraguay', 'Uruguay']) {
        try {
          const s = await http(`https://googleads.googleapis.com/${v}/geoTargetConstants:search`, { method: 'POST', headers: H, body: JSON.stringify({ queryText: name }) });
          const t = (s.results || []).find((x) => x.geoTarget && /country/i.test(x.geoTarget.targetType || ''));
          if (t) names[t.geoTarget.resourceName] = name;
        } catch (e) { /* the name lookup is optional; raw ids still work */ }
      }
      for (const b of Array.isArray(geoBatches) ? geoBatches : [geoBatches]) {
        for (const r of b.results || []) {
          const date = r.segments && r.segments.date, raw = (r.segments && r.segments.geo_target_constant) || '', m2 = r.metrics || {};
          const dv = names[raw] || raw || 'Unknown';
          if (!date) continue;
          metrics.push({ metric: 'ad_spend_geo', date, dim: 'country', dim_value: dv, value: Number(m2.costMicros || 0) / 1e6 });
          metrics.push({ metric: 'ad_impressions_geo', date, dim: 'country', dim_value: dv, value: Number(m2.impressions || 0) });
          metrics.push({ metric: 'ad_clicks_geo', date, dim: 'country', dim_value: dv, value: Number(m2.clicks || 0) });
          if (Number(m2.conversions)) metrics.push({ metric: 'ad_results_geo', date, dim: 'country', dim_value: dv, value: Number(m2.conversions) });
        }
      }
    } catch (e) { console.warn('google ads country report skipped:', e.message); }
    return { source: 'google_ads', from, to, metrics, snapshots: [] };
  },

  async clarity() {
    const res = await http('https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3', { headers: { Authorization: `Bearer ${process.env.CLARITY_TOKEN}` } });
    const to = today();
    const from = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const rows = [];
    for (const m of Array.isArray(res) ? res : []) for (const info of m.information || []) rows.push({ metric: m.metricName, ...info });
    return { source: 'clarity', from, to, metrics: [], snapshots: [{ key: 'live_insights', from, to, rows: rows.slice(0, 200) }] };
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

module.exports = { connectors, configured, REQUIRED };

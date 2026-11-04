'use strict';

// Source-native, ordered person funnels. Never derive these from sums of daily events.
const DEFINITIONS = {
  website: { title: 'Website → Registration — signup CTAs only', search: 'Website', events: ['marketing_page_viewed', 'marketing_cta_clicked', 'registration_started'] },
  mvp: { title: 'MVP acquisition → completed review', search: 'MVP acquisition', events: ['marketing_cta_clicked', 'registration_started', 'account_created', 'first_use_path_selected', 'blueprint_generated'] },
  landing_project: {
    title: 'Embudo landing a cuenta y proyecto (sin internos)', search: 'Embudo landing a cuenta y proyecto', exact: true,
    steps: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked' },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'EventsNode', event: '$identify', custom_name: 'Identify' },
      { kind: 'ActionsNode', custom_name: 'Proyecto creado (clic)', activationActionId: true },
    ],
  },
  marketing_project: {
    title: 'Marketing-to-Project Activation Funnel', search: 'Marketing-to-Project Activation Funnel', exact: true, exactTitle: true, requiresSaved: true,
    displayNames: [null, null, null, 'Registration Finished', 'Login', 'Project View/Project Created'],
    steps: [
      { kind: 'EventsNode', event: 'marketing_page_viewed' },
      { kind: 'EventsNode', event: 'marketing_cta_clicked' },
      { kind: 'EventsNode', event: 'registration_started' },
      { kind: 'AnyNode', labels: ['Registration Finished', 'REGISTGRATION FINISHED IDENTIFY'], custom_name: 'Registration Finished' },
      { kind: 'AnyNode', labels: ['Login'], custom_name: 'Login' },
      { kind: 'AnyNode', labels: ['Project View/Project Created'], custom_name: 'Project View/Project Created' },
    ],
  },
};
const cache = new Map();
const clone = (v) => JSON.parse(JSON.stringify(v));
const dateOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function internalPersonFilters() {
  const domains = String(process.env.INTERNAL_DOMAINS || 'think4ever.com').split(',').map((v) => v.trim().toLowerCase()).filter((v) => /^[a-z0-9.-]+$/.test(v));
  const companies = String(process.env.INTERNAL_COMPANIES || 'think4ever,moadbus').split(',').map((v) => v.trim().toLowerCase()).filter((v) => /^[a-z0-9 .-]{2,100}$/.test(v));
  return [
    ...domains.map((domain) => ({ key: 'email', type: 'person', operator: 'not_icontains', value: [`@${domain}`] })),
    ...companies.map((company) => ({ key: 'company', type: 'person', operator: 'not_icontains', value: [company] })),
  ];
}
function activationActionId() {
  const id = Number(process.env.POSTHOG_ACTIVATION_ACTION_ID || 407660);
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid POSTHOG_ACTIVATION_ACTION_ID');
  return id;
}
function querySteps(def) {
  return def.steps ? def.steps.map((step) => {
    if (step.kind === 'AnyNode') return { kind: 'AnyNode', labels: step.labels || [], custom_name: step.custom_name };
    if (step.kind !== 'ActionsNode') return { kind: step.kind, event: step.event, ...(step.custom_name ? { custom_name: step.custom_name } : {}) };
    const id = step.id != null ? Number(step.id) : step.activationActionId ? activationActionId() : null;
    return { kind: 'ActionsNode', ...(id == null ? {} : { id }), ...(step.custom_name ? { custom_name: step.custom_name } : {}) };
  }) : def.events.map((event) => ({ kind: 'EventsNode', event }));
}
function matchesDefinition(def, series, insight = {}) {
  const expected = querySteps(def);
  if (!Array.isArray(series) || series.length < expected.length || (def.exact && series.length !== expected.length)) return false;
  if (def.exactTitle && insight.name !== def.title && insight.derived_name !== def.title) return false;
  return expected.every((step, i) => {
    const actual = series[i] || {};
    if (step.kind === 'AnyNode') {
      const labels = [actual.custom_name, actual.name, actual.event].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
      if (labels.some((label) => step.labels.some((candidate) => String(candidate).trim().toLowerCase() === label))) return ['EventsNode', 'ActionsNode'].includes(actual.kind);
      if (labels.length) return false;
      const actionId = Number(actual.id);
      return actual.kind === 'ActionsNode' && Number.isInteger(actionId) && actionId > 0;
    }
    if (step.kind === 'ActionsNode') {
      const named = String(actual.custom_name || actual.name || '').toLowerCase();
      return actual.kind === 'ActionsNode' && ((step.id != null && Number(actual.id) === step.id) || named === String(step.custom_name || '').toLowerCase());
    }
    return actual.kind === 'EventsNode' && actual.event === step.event;
  });
}
function unwrap(q) { return q && q.kind === 'InsightVizNode' ? unwrap(q.source) : q; }
function buildQuery(key, from, to, exclude, saved) {
  const def = DEFINITIONS[key];
  if (!def || !dateOk(from) || !dateOk(to) || from > to) throw new Error('Invalid funnel or date range');
  const original = unwrap(saved);
  if (def.requiresSaved && (!original || original.kind !== 'FunnelsQuery')) throw new Error(`A saved PostHog insight is required for “${def.title}”`);
  const query = original && original.kind === 'FunnelsQuery' ? clone(original) : {
    kind: 'FunnelsQuery', series: querySteps(def),
    funnelsFilter: { funnelOrderType: 'ordered', funnelWindowInterval: 14, funnelWindowIntervalUnit: 'day' },
  };
  query.dateRange = { date_from: from, date_to: to };
  query.filterTestAccounts = exclude;
  if (exclude) {
    const existing = Array.isArray(query.properties) ? query.properties : [];
    const seen = new Set(existing.map((p) => JSON.stringify(p)));
    query.properties = [...existing, ...internalPersonFilters().filter((p) => !seen.has(JSON.stringify(p)))];
  }
  query.funnelsFilter = { ...query.funnelsFilter, funnelVizType: 'steps' };
  delete query.breakdownFilter;
  delete query.compareFilter;
  return query;
}
function normalize(result, query, observed) {
  if (!Array.isArray(result.results) || result.results.some(Array.isArray)) throw new Error('Unexpected PostHog funnel response');
  return query.series.map((s, i) => {
    const r = result.results.find((row) => row.order === i) || result.results[i];
    if (!r || !Number.isFinite(Number(r.count))) throw new Error('Incomplete PostHog funnel response');
    const isAction = s.kind === 'ActionsNode';
    const event = isAction ? null : (s.event || String(s.id || s.name || ''));
    const n = Number(r.count);
    // Absent event instrumentation is different from an observed zero; Actions are resolved by PostHog.
    const missing = !isAction && observed && !observed.has(event) && n === 0;
    return { name: s.custom_name || s.name || event || `Action ${s.id}`, event, ...(isAction ? { action_id: Number(s.id) } : {}), n: missing ? null : n, missing, median_seconds: r.median_conversion_time == null ? null : Number(r.median_conversion_time) };
  });
}
async function read(key, from, to, exclude, request = fetch) {
  const def = DEFINITIONS[key];
  if (!def || !dateOk(from) || !dateOk(to) || from > to) throw new Error('Invalid funnel or date range');
  const host = String(process.env.POSTHOG_HOST || '').replace(/\/$/, '');
  const project = String(process.env.POSTHOG_PROJECT_ID || '');
  const token = process.env.POSTHOG_API_KEY;
  if (!host || !/^\d+$/.test(project) || !token) throw new Error('PostHog is not configured');
  const cacheKey = `${host}|${project}|${key}|${from}|${to}|${exclude}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.promise;
  const run = async (path, body) => {
    const url = /^https?:\/\//i.test(path) ? path : `${host}/api/projects/${project}/${path}`;
    const response = await request(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const endpoint = new URL(url).pathname.includes('/insights/') ? 'saved insights' : 'queries';
    if (!response.ok) {
      if (response.status === 403) throw new Error(`PostHog denied access (403). The configured key needs insight:read to find saved funnels and query:read to run them in project ${project}.`);
      if (response.status === 401) throw new Error(`PostHog rejected POSTHOG_API_KEY (401) for ${endpoint}; check the configured project key.`);
      throw new Error(`PostHog funnel request failed (${response.status})`);
    }
    return response.json();
  };
  const promise = (async () => {
    // The screenshot titles identify the saved insights: reuse their exact CTA,
    // QA, host and person filters, including any additional downstream steps.
    const allInsights = [];
    let next = `insights/?search=${encodeURIComponent(def.search)}&limit=100`;
    const visited = new Set();
    let pagesRead = 0;
    const maxPages = 100;
    while (next) {
      if (pagesRead >= maxPages) throw new Error(`PostHog insights lookup exceeded the ${maxPages}-page safety limit`);
      const pageUrl = new URL(next, `${host}/api/projects/${project}/`);
      const expectedHost = new URL(host);
      if (pageUrl.hash) throw new Error('Invalid PostHog insights pagination link');
      const pageKey = pageUrl.toString();
      if (pageUrl.origin !== expectedHost.origin || pageUrl.pathname !== `/api/projects/${project}/insights/` || visited.has(pageKey)) throw new Error('Invalid PostHog insights pagination link');
      visited.add(pageKey);
      const page = await run(pageKey, null);
      pagesRead++;
      allInsights.push(...(Array.isArray(page.results) ? page.results : []));
      next = page.next || null;
      if (allInsights.length > 10000) throw new Error('PostHog returned too many saved insights to scan safely');
    }
    const matches = allInsights.filter((r) => {
      const q = unwrap(r.query);
      return q && q.kind === 'FunnelsQuery' && matchesDefinition(def, q.series, r);
    }).map((r) => ({ ...r, name: r.name === def.title || r.derived_name === def.title ? def.title : String(r.name || r.derived_name || '') }));
    const titled = matches.filter((r) => {
      const name = String(r.name || r.derived_name || '');
      return def.exactTitle ? name === def.title : name.toLowerCase().startsWith(def.title.toLowerCase());
    });
    const candidates = def.exactTitle ? titled : (titled.length ? titled : matches);
    if (candidates.length !== 1) {
      if (!candidates.length && key === 'landing_project') throw new Error('Saved PostHog funnel not found. Expected “Embudo landing a cuenta y proyecto (sin internos)” with marketing_page_viewed → marketing_cta_clicked → registration_started → $identify → Action “Proyecto creado (clic)”.');
      if (!candidates.length && key === 'marketing_project') throw new Error('Saved PostHog funnel “Marketing-to-Project Activation Funnel” not found. Expected exactly: marketing_page_viewed → marketing_cta_clicked → registration_started → Registration Finished (or REGISTGRATION FINISHED IDENTIFY) → Login → Project View/Project Created.');
      throw new Error(candidates.length ? 'Multiple matching PostHog funnels; give the saved insights distinct titles' : 'The pictured funnel was not found in PostHog saved insights');
    }
    const saved = candidates[0], query = buildQuery(key, from, to, exclude, saved.query);
    if (key === 'landing_project') query.series = query.series.map((s) => {
      if (s.kind === 'EventsNode' && s.event === '$identify' && !s.custom_name) return { ...s, custom_name: 'Identify' };
      if (s.kind === 'ActionsNode' && !s.custom_name && !s.name) return { ...s, custom_name: 'Proyecto creado (clic)' };
      return s;
    });
    const result = await run('query/', { query });
    const names = query.series.filter((s) => s.kind === 'EventsNode').map((s) => s.event).filter(Boolean);
    const quoted = names.filter((s) => /^[a-zA-Z0-9_.$:-]{1,120}$/.test(s)).map((s) => `'${s}'`).join(',');
    let observed;
    if (quoted) {
      const presence = await run('query/', { query: { kind: 'HogQLQuery', query: `SELECT event FROM events WHERE timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND event IN (${quoted}) GROUP BY event LIMIT 100` } });
      observed = new Set((presence.results || []).map((r) => r[0]));
    }
    const steps = normalize(result, query, observed).map((step, i) => key === 'marketing_project' && def.displayNames[i] ? { ...step, name: def.displayNames[i] } : step);
    return { title: saved.name || def.title, from, to, window_days: query.funnelsFilter.funnelWindowInterval || 14, steps, saved_insight: saved.short_id || saved.id };
  })();
  cache.set(cacheKey, { until: Date.now() + 5 * 60000, promise });
  // Bound memory and evict failures so a retry is meaningful.
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  promise.catch(() => cache.delete(cacheKey));
  return promise;
}
module.exports = { DEFINITIONS, buildQuery, normalize, read };

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
      // The live insight labels this $identify step "Registgration Finished" (typo kept in PostHog).
      { kind: 'AnyNode', labels: ['Registration Finished', 'REGISTGRATION FINISHED IDENTIFY', 'Registgration Finished'], events: ['$identify'], custom_name: 'Registration Finished' },
      { kind: 'AnyNode', labels: ['Login'], custom_name: 'Login' },
      { kind: 'AnyNode', labels: ['Project View/Project Created'], custom_name: 'Project View/Project Created' },
    ],
  },
};
// Optional split of the same saved funnel, for the all-channel funnel. PostHog attributes each
// person to the value on the first step (first touch), so groups add up to the funnel total.
// Both shapes were run read-only against the live project on 2026-11-06: the session
// $channel_type groups add up to the unsplit funnel; utm_campaign is an event property of
// marketing_page_viewed but is set on few events, so most persons fall in "(none)".
const BREAKDOWNS = {
  channel: { breakdown_type: 'session', breakdown: '$channel_type', breakdown_limit: 12 },
  campaign: { breakdown_type: 'event', breakdown: 'utm_campaign', breakdown_limit: 15 },
};
const cache = new Map();
// Saved-insight lookup and event presence do not depend on the breakdown: cached apart so the
// channel and campaign splits reuse them instead of repeating the paginated insights scan.
const shared = new Map();
const SHARED_TTL = 5 * 60000;
function memo(cacheKey, fn) {
  const hit = shared.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.promise;
  const promise = Promise.resolve().then(fn);
  shared.set(cacheKey, { until: Date.now() + SHARED_TTL, promise });
  if (shared.size > 60) shared.delete(shared.keys().next().value);
  promise.catch(() => shared.delete(cacheKey));
  return promise;
}
// Request values are looked up only as own keys: "toString", "constructor" or "__proto__" are not funnels or breakdowns.
const own = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const definition = (key) => (own(DEFINITIONS, key) ? DEFINITIONS[key] : null);
const isBreakdown = (value) => own(BREAKDOWNS, value);
const clone = (v) => JSON.parse(JSON.stringify(v));
const dateOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
// Same internal/test rule as the connectors (lib/internal.js), read at call time.
function internalPersonFilters() {
  delete require.cache[require.resolve('./internal')];
  return require('./internal').posthogPersonFilters();
}
function activationActionId() {
  const id = Number(process.env.POSTHOG_ACTIVATION_ACTION_ID || 407660);
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid POSTHOG_ACTIVATION_ACTION_ID');
  return id;
}
function querySteps(def) {
  return def.steps ? def.steps.map((step) => {
    if (step.kind === 'AnyNode') return { kind: 'AnyNode', labels: step.labels || [], ...(step.events ? { events: step.events } : {}), custom_name: step.custom_name };
    if (step.kind !== 'ActionsNode') return { kind: step.kind, event: step.event, ...(step.custom_name ? { custom_name: step.custom_name } : {}) };
    const id = step.id != null ? Number(step.id) : step.activationActionId ? activationActionId() : null;
    return { kind: 'ActionsNode', ...(id == null ? {} : { id }), ...(step.custom_name ? { custom_name: step.custom_name } : {}) };
  }) : def.events.map((event) => ({ kind: 'EventsNode', event }));
}
function stepMatches(step, actual) {
  if (step.kind === 'AnyNode') {
    // A step defined by its source event (e.g. $identify) is recognized whatever its label.
    if (Array.isArray(step.events) && actual.kind === 'EventsNode' && step.events.includes(actual.event)) return true;
    const label = String(actual.custom_name || actual.name || actual.event || '').trim().toLowerCase();
    // PostHog may omit saved Action labels; the exact titled insight and position then identify the node.
    if (!label) { const actionId = Number(actual.id); return actual.kind === 'ActionsNode' && Number.isInteger(actionId) && actionId > 0; }
    return ['EventsNode', 'ActionsNode'].includes(actual.kind) && step.labels.some((candidate) => String(candidate).trim().toLowerCase() === label);
  }
  if (step.kind === 'ActionsNode') {
    const named = String(actual.custom_name || actual.name || '').toLowerCase();
    return actual.kind === 'ActionsNode' && ((step.id != null && Number(actual.id) === step.id) || named === String(step.custom_name || '').toLowerCase());
  }
  return actual.kind === 'EventsNode' && actual.event === step.event;
}
function matchesDefinition(def, series, insight = {}) {
  const expected = querySteps(def);
  if (!Array.isArray(series) || series.length < expected.length || (def.exact && series.length !== expected.length)) return false;
  if (def.exactTitle && insight.name !== def.title && insight.derived_name !== def.title) return false;
  return expected.every((step, i) => stepMatches(step, series[i] || {}));
}
function describeExpected(step) {
  if (step.kind === 'AnyNode') return step.labels.map((l) => `“${l}”`).join(' or ') + (step.events ? ` (or event ${step.events.join('/')})` : '');
  if (step.kind === 'ActionsNode') return `Action “${step.custom_name}”`;
  return `event ${step.event}`;
}
function describeActual(actual) {
  const label = actual.custom_name || actual.name || '';
  const source = actual.kind === 'EventsNode' ? `event ${actual.event}` : actual.kind === 'ActionsNode' ? `Action ${actual.id != null ? actual.id : '?'}` : String(actual.kind || 'empty step');
  return label ? `“${label}” (${source})` : source;
}
// Explains why an insight with the right title still fails the step signature.
function mismatchReason(def, series) {
  const expected = querySteps(def);
  if (!Array.isArray(series)) return 'it has no steps';
  if (series.length < expected.length || (def.exact && series.length !== expected.length)) return `it has ${series.length} steps; expected ${expected.length}`;
  for (let i = 0; i < expected.length; i++) {
    if (!stepMatches(expected[i], series[i] || {})) return `step ${i + 1} does not match: expected ${describeExpected(expected[i])}, found ${describeActual(series[i] || {})}`;
  }
  return null;
}
function unwrap(q) { return q && q.kind === 'InsightVizNode' ? unwrap(q.source) : q; }
function buildQuery(key, from, to, exclude, saved, breakdown = null) {
  const def = definition(key);
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
  if (breakdown) {
    if (!isBreakdown(breakdown)) throw new Error('Invalid funnel breakdown');
    query.breakdownFilter = { ...BREAKDOWNS[breakdown] };
  }
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
// A breakdown response is one array of steps per value. Counts per value are ordered persons.
function normalizeBreakdown(result, query, observed) {
  if (!Array.isArray(result.results)) throw new Error('Unexpected PostHog funnel response');
  const groups = result.results.every(Array.isArray) ? result.results : [result.results];
  return groups.map((group) => {
    const first = group[0] || {};
    const raw = Array.isArray(first.breakdown_value) ? first.breakdown_value.join(' · ') : first.breakdown_value;
    const value = raw == null || raw === '' || raw === '$$_posthog_breakdown_null_$$' ? '(none)' : String(raw) === '$$_posthog_breakdown_other_$$' ? 'Other' : String(raw);
    const steps = normalize({ results: group }, query, observed).map((s) => ({ name: s.name, n: s.n }));
    return { value, steps };
  }).sort((a, b) => (b.steps[0]?.n || 0) - (a.steps[0]?.n || 0));
}
async function read(key, from, to, exclude, request = fetch, breakdown = null) {
  const def = definition(key);
  if (!def || !dateOk(from) || !dateOk(to) || from > to) throw new Error('Invalid funnel or date range');
  if (breakdown != null && !isBreakdown(breakdown)) throw new Error('Invalid funnel breakdown');
  const host = String(process.env.POSTHOG_HOST || '').replace(/\/$/, '');
  const project = String(process.env.POSTHOG_PROJECT_ID || '');
  const token = process.env.POSTHOG_API_KEY;
  if (!host || !/^\d+$/.test(project) || !token) throw new Error('PostHog is not configured');
  const cacheKey = `${host}|${project}|${key}|${from}|${to}|${exclude}|${breakdown || ''}`;
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
  const findSaved = async () => {
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
      if (!candidates.length && key === 'marketing_project') {
        const sequence = 'marketing_page_viewed → marketing_cta_clicked → registration_started → Registration Finished ($identify, or labeled REGISTGRATION FINISHED IDENTIFY / Registgration Finished) → Login → Project View/Project Created';
        const titledFunnel = allInsights.find((r) => (r.name === def.title || r.derived_name === def.title) && unwrap(r.query) && unwrap(r.query).kind === 'FunnelsQuery');
        if (titledFunnel) {
          const why = mismatchReason(def, unwrap(titledFunnel.query).series) || 'its steps do not match';
          throw new Error(`Saved PostHog funnel “${def.title}” was found (${titledFunnel.short_id || titledFunnel.id}), but ${why}. Expected: ${sequence}.`);
        }
        throw new Error(`Saved PostHog funnel “${def.title}” not found. Expected exactly: ${sequence}.`);
      }
      throw new Error(candidates.length ? 'Multiple matching PostHog funnels; give the saved insights distinct titles' : 'The pictured funnel was not found in PostHog saved insights');
    }
    return candidates[0];
  };
  const promise = (async () => {
    const saved = await memo(`${host}|${project}|saved|${key}`, findSaved);
    const query = buildQuery(key, from, to, exclude, saved.query, breakdown);
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
      observed = await memo(`${host}|${project}|observed|${key}|${from}|${to}|${quoted}`, async () => {
        const presence = await run('query/', { query: { kind: 'HogQLQuery', query: `SELECT event FROM events WHERE timestamp >= toDate('${from}') AND timestamp < addDays(toDate('${to}'), 1) AND event IN (${quoted}) GROUP BY event LIMIT 100` } });
        return new Set((presence.results || []).map((r) => r[0]));
      });
    }
    const rename = (step, i) => key === 'marketing_project' && def.displayNames[i] ? { ...step, name: def.displayNames[i] } : step;
    if (breakdown) {
      const groups = normalizeBreakdown(result, query, observed).map((g) => ({ ...g, steps: g.steps.map(rename) }));
      return { title: saved.name || def.title, from, to, window_days: query.funnelsFilter.funnelWindowInterval || 14, breakdown, breakdown_property: BREAKDOWNS[breakdown].breakdown, groups, saved_insight: saved.short_id || saved.id };
    }
    const steps = normalize(result, query, observed).map(rename);
    return { title: saved.name || def.title, from, to, window_days: query.funnelsFilter.funnelWindowInterval || 14, steps, saved_insight: saved.short_id || saved.id };
  })();
  cache.set(cacheKey, { until: Date.now() + 5 * 60000, promise });
  // Bound memory and evict failures so a retry is meaningful.
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  promise.catch(() => cache.delete(cacheKey));
  return promise;
}
// GET /api/funnels/posthog. Kept here so the route's validation is testable without booting the server.
function route(request = (...args) => fetch(...args)) {
  return async (req, res) => {
    try {
      const from = String(req.query.from || ''), to = String(req.query.to || '');
      if (from < (process.env.LAUNCH_DATE || '2026-10-01') || to > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Date outside launch window' });
      const breakdown = req.query.breakdown == null || req.query.breakdown === '' ? null : String(req.query.breakdown);
      if (breakdown && !isBreakdown(breakdown)) return res.status(400).json({ error: 'breakdown must be channel or campaign' });
      res.json(await read(String(req.query.funnel || 'website'), from, to, req.query.exclude !== '0', request, breakdown));
    } catch (e) { res.status(502).json({ error: e.message }); }
  };
}
module.exports = { DEFINITIONS, BREAKDOWNS, buildQuery, normalize, normalizeBreakdown, read, route };

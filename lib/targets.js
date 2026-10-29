'use strict';

// Target configuration is data, not dashboard code. The defaults only seed a
// newly-created database once; every subsequent read comes from gd_items.
const DEFAULT_PLAN = {
  label: 'LATAM 500K scale goal',
  verified_users: 500000,
  landing_sessions: 12438491,
  visit_to_signup: 0.0402,
  impressions: 2157556427,
  impression_to_visit: 0.00577,
  paid_budget: 9827758,
  paid_cps: 19.66,
  activation_7d: 0.30,
  valid_signups: 0.95,
  countries: {
    Brazil: 175648, Mexico: 129881, Colombia: 57598, Argentina: 42574,
    Peru: 30524, Chile: 21615, Ecuador: 16037, 'Dominican Republic': 11103,
    Bolivia: 6817, Paraguay: 4585, Uruguay: 3618,
  },
};

const METRICS = {
  landing_sessions: { label: 'Site sessions (GA4)', kind: 'count' },
  unique_visitors: { label: 'Unique visitors', kind: 'count' },
  engagement_rate: { label: 'Engagement rate', kind: 'rate' },
  total_signups: { label: 'Sign-ups (PostHog registration_started)', kind: 'count' },
  platform_signups: { label: 'Platform sign-ups (same PostHog definition)', kind: 'count' },
  crm_contacts: { label: 'CRM contacts (HubSpot)', kind: 'count' },
  new_people: { label: 'New observed people (PostHog)', kind: 'count' },
  visit_to_signup_rate: { label: 'Linked visit-to-sign-up rate (pending)', kind: 'rate' },
  ad_spend_budget: { label: 'Ad spend budget', kind: 'money' },
  clicks: { label: 'Clicks', kind: 'count' },
  ctr: { label: 'Click-through rate', kind: 'rate' },
  total_impressions: { label: 'Paid impressions', kind: 'count' },
  // CEO/CPO additions: real cost efficiency and what happens inside the product.
  cps: { label: 'Cost / attributed CRM contact', kind: 'money' },
  activation_7d: { label: 'Activation within 7 days', kind: 'rate' },
};

const PLAN_FIELDS = ['verified_users', 'landing_sessions', 'visit_to_signup', 'impressions', 'impression_to_visit', 'paid_budget', 'paid_cps', 'activation_7d', 'valid_signups'];
const RATE_FIELDS = new Set(['visit_to_signup', 'impression_to_visit', 'activation_7d', 'valid_signups']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const planKey = 'latam';

function number(value, rate = false) {
  if (typeof value === 'string' && value.trim().endsWith('%')) value = Number(value.trim().slice(0, -1)) / 100;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (rate && n > 1)) return null;
  return n;
}

async function getPlan(store) {
  const row = (await store.list('goal_plan')).find((item) => item._k === planKey);
  if (row) {
    const { _k, _at, ...saved } = row;
    return { ...clone(DEFAULT_PLAN), ...saved, countries: { ...DEFAULT_PLAN.countries, ...(saved.countries || {}) } };
  }
  const seeded = { ...clone(DEFAULT_PLAN), seeded_at: new Date().toISOString(), seeded_by: 'initial-plan' };
  await store.upsert('goal_plan', planKey, seeded);
  return seeded;
}

function cleanPlan(body, previous) {
  const out = { ...previous, countries: { ...(previous.countries || {}) } };
  if (body && typeof body.label === 'string' && body.label.trim()) out.label = body.label.trim().slice(0, 100);
  for (const field of PLAN_FIELDS) {
    if (!body || !(field in body)) continue;
    const n = number(body[field], RATE_FIELDS.has(field));
    if (n == null) { const e = new Error(`Invalid target: ${field}`); e.status = 400; throw e; }
    out[field] = n;
  }
  if (body && body.countries && typeof body.countries === 'object' && !Array.isArray(body.countries)) {
    const countries = {};
    for (const [name, value] of Object.entries(body.countries).slice(0, 50)) {
      const n = number(value);
      if (!/^[\p{L} .'-]{2,80}$/u.test(name) || n == null) { const e = new Error(`Invalid country target: ${name}`); e.status = 400; throw e; }
      countries[name] = n;
    }
    out.countries = countries;
  }
  return out;
}

async function savePlan(store, body, user) {
  const next = cleanPlan(body, await getPlan(store));
  next.updated_at = new Date().toISOString();
  next.updated_by = user || 'unknown';
  await store.upsert('goal_plan', planKey, next);
  return next;
}

function parseCell(value) {
  const raw = String(value == null ? '' : value).trim().replace(/[$,\s]/g, '');
  if (raw.endsWith('%')) return number(raw);
  return number(raw);
}

function csvRows(text) {
  const parse = (line) => {
    const out = []; let value = '', quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i += 1; } else quoted = !quoted; }
      else if (c === ',' && !quoted) { out.push(value.trim()); value = ''; }
      else value += c;
    }
    out.push(value.trim()); return out;
  };
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const header = parse(lines.shift() || '').map((v) => v.toLowerCase());
  const ix = Object.fromEntries(header.map((name, i) => [name, i]));
  // The country column is optional: rows without it set the LATAM-level target.
  return lines.map((line, i) => ({ line: i + 2, month: parse(line)[ix.month], country: ix.country != null ? (parse(line)[ix.country] || 'LATAM') : 'LATAM', metric_key: parse(line)[ix.metric_key], raw: parse(line)[ix.target_value] }));
}

const COUNTRY = /^[^|]{2,80}$/;
function countryOk(country) { return country === 'LATAM' || COUNTRY.test(country || ''); }
// LATAM keeps the original month|metric id; a country target adds the country between the two.
const targetId = (month, country, metric) => (country === 'LATAM' ? `${month}|${metric}` : `${month}|${country}|${metric}`);
function parseId(id) {
  const parts = String(id || '').split('|');
  if (parts.length >= 3) return { month: parts[0], country: parts[1], metric: parts[2] };
  return { month: parts[0], country: 'LATAM', metric: parts[1] };
}

async function monthly(store, month, country = 'LATAM') {
  const rows = await store.list('target');
  return rows.filter((r) => r.month === month && (r.country || 'LATAM') === country)
    .map((r) => ({ id: r._k, metric_key: r.metric_key, country: r.country || 'LATAM', target_value: r.target_value, updated_by: r.updated_by, updated_at: r.updated_at || r._at }));
}

function monthOk(month) { return /^\d{4}-\d{2}$/.test(month || ''); }
function validateTarget(month, key, value) {
  if (!monthOk(month) || !METRICS[key]) return null;
  const n = parseCell(value);
  if (n == null || (METRICS[key].kind === 'rate' && n > 1)) return null;
  return n;
}

async function previewImport(store, csv) {
  const rows = await csvRows(csv);
  const current = await store.list('target');
  const result = rows.map((r) => {
    const value = validateTarget(r.month, r.metric_key, r.raw);
    const previous = current.find((x) => x.month === r.month && (x.country || 'LATAM') === (r.country || 'LATAM') && x.metric_key === r.metric_key);
    if (!countryOk(r.country)) return { ...r, status: 'error', message: 'Use LATAM or a country name of up to 80 characters.' };
    if (value == null) return { ...r, status: 'error', message: 'Use a valid month, metric_key and non-negative value.' };
    return { ...r, target_value: value, label: METRICS[r.metric_key].label, previous: previous && previous.target_value, status: previous ? 'overwrite' : 'ok', message: '' };
  });
  const counts = { ok: 0, overwrite: 0, error: 0, skip: 0 };
  result.forEach((r) => { counts[r.status] += 1; });
  return { rows: result, counts };
}

async function applyImport(store, csv, user) {
  const preview = await previewImport(store, csv);
  let applied = 0;
  for (const row of preview.rows) if (row.status === 'ok' || row.status === 'overwrite') {
    await store.upsert('target', targetId(row.month, row.country, row.metric_key), { month: row.month, country: row.country, metric_key: row.metric_key, target_value: row.target_value, updated_by: user || 'unknown', updated_at: new Date().toISOString() });
    applied += 1;
  }
  return { ...preview, applied };
}

module.exports = { DEFAULT_PLAN, METRICS, getPlan, savePlan, monthly, monthOk, countryOk, targetId, parseId, validateTarget, previewImport, applyImport };

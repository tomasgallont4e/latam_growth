
'use strict';
// Read-only GA4 totals for one exact From/To range (user-approved exception to memory #111).
// Uses the same service-account auth and SITE_HOSTS host filter as the GA4 connector, with a
// single runReport call per range. Results are cached in memory; nothing is written to the
// database and the regular GA4 sync (lib/connectors.js) is untouched.
const crypto = require('crypto');
const { SITE_HOSTS } = require('./connectors');

const METRICS = ['totalUsers', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate'];
const CACHE_MAX = 200;

function validDay(d) {
  const s = String(d || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// One GA4 report row -> the same field names the totals snapshot uses. An empty report is a
// real answer from GA4 (no traffic in the range), so it maps to zeros.
function mapReport(report) {
  const row = report && Array.isArray(report.rows) ? report.rows[0] : null;
  const values = row && Array.isArray(row.metricValues) ? row.metricValues.map((m) => Number(m && m.value)) : [];
  const n = (i) => (Number.isFinite(values[i]) ? values[i] : 0);
  return {
    users: n(0), new_users: n(1), sessions: n(2), engaged_sessions: n(3), engagement_rate: n(4),
    subject_to_thresholding: !!(report && report.metadata && report.metadata.subjectToThresholding),
    user_counts_inconsistent: n(1) > n(0),
  };
}

function createReader(opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetch || ((...args) => fetch(...args));
  const nowMs = opts.now || (() => Date.now());
  const today = opts.today || (() => new Date().toISOString().slice(0, 10));
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : 30 * 60 * 1000;
  const maxConcurrent = Math.max(1, opts.maxConcurrent || 2);
  const hosts = opts.hosts || SITE_HOSTS;
  const launch = () => env.LAUNCH_DATE || '2026-10-01';

  const cache = new Map();
  const inflight = new Map();
  const waiting = [];
  let active = 0;
  let token = null;

  async function http(url, init) {
    const r = await fetchImpl(url, init);
    const text = await r.text();
    if (!r.ok) throw fail(502, `GA4 request failed (${r.status}) ${String(text || '').slice(0, 200)}`);
    try { return text ? JSON.parse(text) : {}; } catch { throw fail(502, 'GA4 returned an invalid response'); }
  }

  async function accessToken() {
    if (token && token.exp > nowMs() + 60000) return token.value;
    let sa;
    try { sa = JSON.parse(env.GA4_SERVICE_ACCOUNT); } catch { throw fail(409, 'GA4_SERVICE_ACCOUNT is not valid JSON.'); }
    const now = Math.floor(nowMs() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
    const tok = await http('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${sig}`,
    });
    if (!tok.access_token) throw fail(502, 'GA4 token response had no access token');
    token = { value: tok.access_token, exp: nowMs() + (Number(tok.expires_in) || 3600) * 1000 };
    return token.value;
  }

  // At most maxConcurrent GA4 calls at once; a finished call hands its slot to the next waiter.
  async function slot(fn) {
    if (active >= maxConcurrent) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try { return await fn(); }
    finally {
      const next = waiting.shift();
      if (next) next(); else active--;
    }
  }

  async function query(from, to) {
    const access = await accessToken();
    const report = await http(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(env.GA4_PROPERTY_ID)}:runReport`, {
      method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensionFilter: { filter: { fieldName: 'hostName', inListFilter: { values: hosts, caseSensitive: false } } },
        metrics: METRICS.map((name) => ({ name })),
      }),
    });
    return { from, to, hosts: [...hosts], ...mapReport(report), pulled_at: new Date(nowMs()).toISOString(), cached: false };
  }

  async function rangeTotals(fromIn, toIn) {
    const from = String(fromIn || ''), to = String(toIn || '');
    if (!validDay(from) || !validDay(to)) throw fail(400, 'from and to must be dates in YYYY-MM-DD format');
    if (from < launch()) throw fail(400, `from must be on or after ${launch()}`);
    if (to > today()) throw fail(400, 'to cannot be after today');
    if (from > to) throw fail(400, 'from must be on or before to');
    if (!String(env.GA4_PROPERTY_ID || '').trim() || !String(env.GA4_SERVICE_ACCOUNT || '').trim()) throw fail(409, 'GA4 is not configured.');
    const key = `${from}|${to}`;
    const hit = cache.get(key);
    if (hit && nowMs() - hit.at < ttlMs) return { ...hit.data, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    const p = slot(() => query(from, to)).then((data) => {
      cache.delete(key);
      cache.set(key, { at: nowMs(), data });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return data;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  return { rangeTotals };
}

const reader = createReader();
module.exports = { createReader, mapReport, validDay, METRICS, rangeTotals: (from, to) => reader.rangeTotals(from, to) };
